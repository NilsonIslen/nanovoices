import { NextResponse } from "next/server";
import {
  OperationType,
  PaymentStatus,
  PublicationRequestStatus,
  type Prisma,
} from "@prisma/client";
import { refreshVerifiedAccountBalances } from "@/lib/balances";
import { REQUIRED_PAYMENT_RAW, requiredReceiverAddress } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { sanitizeMessage } from "@/lib/sanitize";
import { deleteAccountDescendants, deleteReplyDescendants } from "@/lib/threads";

type Tx = Prisma.TransactionClient | typeof prisma;
const PAYMENT_CLAIM_GRACE_MS = 15 * 60_000;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const publicationRequest = await claimPaymentIfAvailable(id);

    if (!publicationRequest) {
      return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    }

    const existing = await findExistingMessage(
      publicationRequest.nanoAddress,
      publicationRequest.replyToAccountId,
      publicationRequest.replyToReplyId,
    );
    const rank = await getRank(
      publicationRequest.nanoAddress,
      publicationRequest.replyToAccountId,
      publicationRequest.replyToReplyId,
    );

    return NextResponse.json({
      id: publicationRequest.id,
      kind: publicationRequest.replyToAccountId || publicationRequest.replyToReplyId ? "reply" : "publication",
      replyToAccountId: publicationRequest.replyToAccountId,
      replyToReplyId: publicationRequest.replyToReplyId,
      status: publicationRequest.status,
      expiresAt: publicationRequest.expiresAt.toISOString(),
      completedAt: publicationRequest.completedAt?.toISOString() ?? null,
      paymentHash: publicationRequest.paymentHash,
      rank,
      existingMessage: existing?.message ?? "",
      published: Boolean(existing),
    });
  } catch (error) {
    console.error("No se pudo consultar la solicitud", error);
    return NextResponse.json(
      { error: "No se pudo consultar el estado. Revisa PostgreSQL." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const pendingMessage = sanitizeMessage(typeof body?.message === "string" ? body.message : "");

    if (!pendingMessage) {
      return NextResponse.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const publicationRequest = await tx.publicationRequest.findUnique({ where: { id } });

      if (!publicationRequest) {
        return { error: "Solicitud no encontrada." as const, status: 404 };
      }

      if (
        publicationRequest.status !== PublicationRequestStatus.COMPLETED ||
        !publicationRequest.nanoAddress ||
        !publicationRequest.paymentHash
      ) {
        return { error: "Primero debe confirmarse el pago." as const, status: 409 };
      }

      if (!publicationRequest.replyToAccountId && !publicationRequest.replyToReplyId) {
        const existingAccount = await tx.verifiedAccount.findUnique({
          where: { nanoAddress: publicationRequest.nanoAddress },
          select: { id: true },
        });
        const now = new Date();
        const operationType = existingAccount
          ? OperationType.UPDATE
          : OperationType.INITIAL_PUBLICATION;

        const account = existingAccount
          ? await tx.verifiedAccount.update({
              where: { id: existingAccount.id },
              data: {
                currentMessage: pendingMessage,
                showBalance: true,
                hiddenByModeration: false,
                moderationReason: null,
              },
            })
          : await tx.verifiedAccount.create({
              data: {
                nanoAddress: publicationRequest.nanoAddress,
                currentMessage: pendingMessage,
                showBalance: true,
              },
            });

        if (existingAccount) {
          await deleteAccountDescendants(tx, account.id);
        }

        await tx.messageHistory.updateMany({
          where: { verifiedAccountId: account.id, replacedAt: null },
          data: { replacedAt: now },
        });
        await tx.messageHistory.create({
          data: {
            verifiedAccountId: account.id,
            message: pendingMessage,
            showBalance: true,
            paymentHash: publicationRequest.paymentHash,
            publishedAt: now,
          },
        });
        await tx.payment.updateMany({
          where: { blockHash: publicationRequest.paymentHash },
          data: { operationType },
        });

        return { id: account.id, kind: "publication" as const, nanoAddress: account.nanoAddress };
      }

      const parent = await resolveRequestParent(tx, publicationRequest.replyToAccountId, publicationRequest.replyToReplyId);
      if (!parent) {
        return { error: "El mensaje padre ya no existe." as const, status: 404 };
      }

      const existingReply = await tx.reply.findFirst({
        where: {
          nanoAddress: publicationRequest.nanoAddress,
          parentAccountId: parent.parentAccountId,
          parentReplyId: parent.parentReplyId,
        },
        select: { id: true },
      });

      const reply = existingReply
        ? await tx.reply.update({
            where: { id: existingReply.id },
            data: {
              message: pendingMessage,
              showBalance: true,
              paymentHash: publicationRequest.paymentHash,
              hiddenByModeration: false,
              moderationReason: null,
            },
          })
        : await tx.reply.create({
            data: {
              parentAccountId: parent.parentAccountId,
              parentReplyId: parent.parentReplyId,
              level: parent.level,
              nanoAddress: publicationRequest.nanoAddress,
              message: pendingMessage,
              showBalance: true,
              paymentHash: publicationRequest.paymentHash,
            },
          });

      if (existingReply) {
        await deleteReplyDescendants(tx, reply.id);
      }

      await tx.payment.updateMany({
        where: { blockHash: publicationRequest.paymentHash },
        data: { operationType: OperationType.REPLY },
      });

      return { id: reply.id, kind: "reply" as const, nanoAddress: reply.nanoAddress };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await refreshVerifiedAccountBalances([result.nanoAddress]).catch((error) => {
      console.error("No se pudo actualizar el saldo tras publicar", error);
    });

    return NextResponse.json({ id: result.id, kind: result.kind });
  } catch (error) {
    console.error("No se pudo publicar el mensaje", error);
    return NextResponse.json(
      { error: "No se pudo publicar el mensaje. Revisa PostgreSQL." },
      { status: 503 },
    );
  }
}

async function claimPaymentIfAvailable(id: string) {
  return prisma.$transaction(async (tx) => {
    const publicationRequest = await tx.publicationRequest.findUnique({ where: { id } });

    if (!publicationRequest) return null;
    if (
      publicationRequest.status !== PublicationRequestStatus.PENDING &&
      !(publicationRequest.status === PublicationRequestStatus.EXPIRED && !publicationRequest.paymentHash)
    ) {
      return publicationRequest;
    }

    const now = new Date();
    const payment = await tx.payment.findFirst({
      where: {
        status: PaymentStatus.UNASSOCIATED,
        destinationAddress: requiredReceiverAddress(),
        amountRaw: REQUIRED_PAYMENT_RAW,
        detectedAt: {
          gte: new Date(publicationRequest.createdAt.getTime() - PAYMENT_CLAIM_GRACE_MS),
        },
      },
      orderBy: { detectedAt: "asc" },
    });

    if (!payment) {
      if (
        publicationRequest.status === PublicationRequestStatus.PENDING &&
        publicationRequest.expiresAt.getTime() + PAYMENT_CLAIM_GRACE_MS < now.getTime()
      ) {
        return tx.publicationRequest.update({
          where: { id },
          data: { status: PublicationRequestStatus.EXPIRED },
        });
      }

      return publicationRequest;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { requestId: id, status: PaymentStatus.PROCESSED },
    });

    return tx.publicationRequest.update({
      where: { id },
      data: {
        nanoAddress: payment.sourceAddress,
        status: PublicationRequestStatus.COMPLETED,
        completedAt: now,
        paymentHash: payment.blockHash,
      },
    });
  });
}

async function getRank(nanoAddress: string, replyToAccountId: string | null, replyToReplyId: string | null) {
  if (!nanoAddress) return null;

  if (replyToAccountId || replyToReplyId) {
    const parent = await resolveRequestParent(prisma, replyToAccountId, replyToReplyId);
    if (!parent) return null;

    const replies = await prisma.reply.findMany({
      where: {
        parentAccountId: parent.parentAccountId,
        parentReplyId: parent.parentReplyId,
        hiddenByModeration: false,
      },
      select: { nanoAddress: true, cachedBalanceRaw: true, createdAt: true },
    });
    const sorted = replies.sort((a, b) => {
      const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
      if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const rank = sorted.findIndex((reply) => reply.nanoAddress === nanoAddress) + 1;
    return rank || null;
  }

  const accounts = await prisma.verifiedAccount.findMany({
    where: { hiddenByModeration: false },
    select: { nanoAddress: true, cachedBalanceRaw: true, verifiedAt: true },
  });
  const sorted = accounts.sort((a, b) => {
    const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
    if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
    return a.verifiedAt.getTime() - b.verifiedAt.getTime();
  });
  const rank = sorted.findIndex((account) => account.nanoAddress === nanoAddress) + 1;
  return rank || null;
}

async function findExistingMessage(
  nanoAddress: string,
  replyToAccountId: string | null,
  replyToReplyId: string | null,
) {
  if (!nanoAddress) return null;

  if (!replyToAccountId && !replyToReplyId) {
    const account = await prisma.verifiedAccount.findUnique({
      where: { nanoAddress },
      select: { currentMessage: true },
    });
    return account ? { message: account.currentMessage } : null;
  }

  const parent = await resolveRequestParent(prisma, replyToAccountId, replyToReplyId);
  if (!parent) return null;

  return prisma.reply.findFirst({
    where: {
      nanoAddress,
      parentAccountId: parent.parentAccountId,
      parentReplyId: parent.parentReplyId,
    },
    select: { message: true },
  });
}

async function resolveRequestParent(
  tx: Tx,
  replyToAccountId: string | null,
  replyToReplyId: string | null,
) {
  if (replyToReplyId) {
    const parent = await tx.reply.findFirst({
      where: { id: replyToReplyId, hiddenByModeration: false },
      select: { id: true, parentAccountId: true, level: true },
    });

    if (!parent || parent.level >= 100) return null;
    return { parentAccountId: parent.parentAccountId, parentReplyId: parent.id, level: parent.level + 1 };
  }

  if (!replyToAccountId) return null;

  const account = await tx.verifiedAccount.findFirst({
    where: { id: replyToAccountId, hiddenByModeration: false },
    select: { id: true },
  });

  return account ? { parentAccountId: account.id, parentReplyId: null, level: 2 } : null;
}
