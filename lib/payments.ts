import {
  OperationType,
  PaymentStatus,
  PublicationRequestStatus,
  type Prisma,
} from "@prisma/client";
import { REQUIRED_PAYMENT_RAW, requiredReceiverAddress } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { refreshVerifiedAccountBalances } from "@/lib/balances";
import { deleteAccountDescendants, deleteReplyDescendants } from "@/lib/threads";
import {
  getBlockDestination,
  getBlockInfo,
  getBlockKind,
  getBlockLink,
  isNanoHash,
  type NanoBlockInfo,
} from "@/lib/nano/rpc";

const LATE_CONFIRMATION_GRACE_MS = 60_000;

export type ProcessPaymentResult =
  | { status: "processed"; requestId: string; operationType: OperationType }
  | { status: "ignored"; reason: PaymentStatus | "DUPLICATE" };

export async function processPaymentHash(blockHash: string): Promise<ProcessPaymentResult> {
  const normalizedHash = blockHash.trim().toUpperCase();
  const candidate = await resolveSendBlock(normalizedHash);
  const existing = await prisma.payment.findUnique({ where: { blockHash: candidate.hash } });

  if (existing) {
    return { status: "ignored", reason: "DUPLICATE" };
  }

  return processConfirmedBlock(candidate.hash, candidate.block);
}

export async function processConfirmedBlock(blockHash: string, block: NanoBlockInfo) {
  const receiverAddress = requiredReceiverAddress();
  const sourceAddress = block.block_account;
  const destinationAddress = getBlockDestination(block);
  const amountRaw = block.amount;
  const now = new Date();
  const confirmedAt = block.local_timestamp
    ? new Date(Number(block.local_timestamp) * 1000)
    : now;

  if (!sourceAddress || !destinationAddress || !amountRaw) {
    return saveUnassociated(blockHash, {
      sourceAddress: sourceAddress ?? "unknown",
      destinationAddress: destinationAddress ?? "unknown",
      amountRaw: amountRaw ?? "0",
      status: PaymentStatus.UNASSOCIATED,
      confirmedAt,
      notes: "Bloque incompleto",
    });
  }

  const issue = validatePaymentBlock(block, receiverAddress);

  if (issue === PaymentStatus.UNCONFIRMED) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt: null,
    });
  }

  if (issue === PaymentStatus.UNASSOCIATED) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
      notes: "El bloque confirmado no es de envío",
    });
  }

  if (issue === PaymentStatus.INVALID_DESTINATION) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
    });
  }

  if (issue === PaymentStatus.INVALID_AMOUNT) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingPayment = await tx.payment.findUnique({ where: { blockHash } });
    if (existingPayment) {
      return { status: "ignored" as const, reason: "DUPLICATE" as const };
    }

    const request = await tx.publicationRequest.findFirst({
      where: {
        nanoAddress: sourceAddress,
        status: PublicationRequestStatus.PENDING,
        expiresAt: { gte: new Date(now.getTime() - LATE_CONFIRMATION_GRACE_MS) },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!request) {
      await tx.payment.create({
        data: {
          blockHash,
          sourceAddress,
          destinationAddress,
          amountRaw,
          confirmedAt,
          status: PaymentStatus.UNASSOCIATED,
          notes: "No existe solicitud pendiente compatible",
        },
      });

      return { status: "ignored" as const, reason: PaymentStatus.UNASSOCIATED };
    }

    if (request.replyToAccountId) {
      const parent = await tx.verifiedAccount.findFirst({
        where: { id: request.replyToAccountId, hiddenByModeration: false },
        select: { id: true },
      });

      if (!parent) {
        await tx.payment.create({
          data: {
            blockHash,
            sourceAddress,
            destinationAddress,
            amountRaw,
            confirmedAt,
            status: PaymentStatus.UNASSOCIATED,
            notes: "La publicación respondida no existe o está oculta",
          },
        });

        return { status: "ignored" as const, reason: PaymentStatus.UNASSOCIATED };
      }

      const existingReply = await tx.reply.findFirst({
        where: {
          parentAccountId: request.replyToAccountId,
          parentReplyId: null,
          nanoAddress: sourceAddress,
        },
        select: { id: true },
      });

      const reply = existingReply
        ? await tx.reply.update({
            where: { id: existingReply.id },
            data: {
              message: request.pendingMessage,
              showBalance: true,
              paymentHash: blockHash,
              hiddenByModeration: false,
              moderationReason: null,
            },
          })
        : await tx.reply.create({
            data: {
              parentAccountId: request.replyToAccountId,
              parentReplyId: null,
              level: 2,
              nanoAddress: sourceAddress,
              message: request.pendingMessage,
              showBalance: true,
              paymentHash: blockHash,
            },
          });

      if (existingReply) {
        await deleteReplyDescendants(tx, reply.id);
      }

      await tx.publicationRequest.update({
        where: { id: request.id },
        data: {
          status: PublicationRequestStatus.COMPLETED,
          completedAt: now,
          paymentHash: blockHash,
        },
      });

      await tx.payment.create({
        data: {
          blockHash,
          sourceAddress,
          destinationAddress,
          amountRaw,
          confirmedAt,
          requestId: request.id,
          status: PaymentStatus.PROCESSED,
          operationType: OperationType.REPLY,
        },
      });

      return {
        status: "processed" as const,
        requestId: request.id,
        operationType: OperationType.REPLY,
      };
    }

    const existingAccount = await tx.verifiedAccount.findUnique({
      where: { nanoAddress: sourceAddress },
      select: { id: true },
    });
    const operationType = existingAccount
      ? OperationType.UPDATE
      : OperationType.INITIAL_PUBLICATION;

    const account = existingAccount
      ? await tx.verifiedAccount.update({
          where: { id: existingAccount.id },
          data: {
            currentMessage: request.pendingMessage,
            showBalance: request.showBalance,
            hiddenByModeration: false,
            moderationReason: null,
          },
        })
      : await tx.verifiedAccount.create({
          data: {
            nanoAddress: sourceAddress,
            currentMessage: request.pendingMessage,
            showBalance: request.showBalance,
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
        message: request.pendingMessage,
        showBalance: request.showBalance,
        paymentHash: blockHash,
        publishedAt: now,
      },
    });

    await tx.publicationRequest.update({
      where: { id: request.id },
      data: {
        status: PublicationRequestStatus.COMPLETED,
        completedAt: now,
        paymentHash: blockHash,
      },
    });

    await tx.payment.create({
      data: {
        blockHash,
        sourceAddress,
        destinationAddress,
        amountRaw,
        confirmedAt,
        requestId: request.id,
        status: PaymentStatus.PROCESSED,
        operationType,
      },
    });

    return { status: "processed" as const, requestId: request.id, operationType };
  });

  if (result.status === "processed") {
    await refreshVerifiedAccountBalances([sourceAddress]).catch((error) => {
      console.error("No se pudo actualizar el saldo tras publicar", error);
    });
  }

  return result;
}

export function validatePaymentBlock(block: NanoBlockInfo, receiverAddress: string) {
  if (block.confirmed !== "true") {
    return PaymentStatus.UNCONFIRMED;
  }

  if (getBlockKind(block) !== "send") {
    return PaymentStatus.UNASSOCIATED;
  }

  if (getBlockDestination(block) !== receiverAddress) {
    return PaymentStatus.INVALID_DESTINATION;
  }

  if (block.amount !== REQUIRED_PAYMENT_RAW) {
    return PaymentStatus.INVALID_AMOUNT;
  }

  return null;
}

export async function resolveSendBlock(blockHash: string) {
  const normalizedHash = blockHash.trim().toUpperCase();
  const block = await getBlockInfo(normalizedHash);
  const blockKind = getBlockKind(block);

  if (blockKind === "send") {
    return { hash: normalizedHash, block };
  }

  const linkedSendHash = getLinkedSendHash(block);

  if (linkedSendHash) {
    return { hash: linkedSendHash, block: await getBlockInfo(linkedSendHash) };
  }

  return { hash: normalizedHash, block };
}

export function getLinkedSendHash(block: NanoBlockInfo) {
  const blockKind = getBlockKind(block);
  const link = getBlockLink(block)?.trim().toUpperCase();

  if ((blockKind === "receive" || blockKind === "open") && link && isNanoHash(link)) {
    return link;
  }

  return null;
}

async function saveUnassociated(
  blockHash: string,
  data: Pick<
    Prisma.PaymentCreateInput,
    "sourceAddress" | "destinationAddress" | "amountRaw" | "status" | "confirmedAt" | "notes"
  >,
) {
  try {
    await prisma.payment.create({
      data: {
        blockHash,
        ...data,
      },
    });
  } catch {
    return { status: "ignored" as const, reason: "DUPLICATE" as const };
  }

  return { status: "ignored" as const, reason: data.status ?? PaymentStatus.UNASSOCIATED };
}
