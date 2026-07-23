import QRCode from "qrcode";
import { NextResponse, type NextRequest } from "next/server";
import { PublicationRequestStatus } from "@prisma/client";
import { z } from "zod";
import {
  REQUIRED_PAYMENT_NANO,
  REQUIRED_PAYMENT_RAW,
  REQUEST_EXPIRATION_MINUTES,
  publicAppUrl,
  requiredReceiverAddress,
} from "@/lib/env";
import { normalizeNanoAddress, isValidNanoAddress } from "@/lib/nano/address";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sanitizeMessage } from "@/lib/sanitize";

const replySchema = z.object({
  parentAccountId: z.string().min(1),
  nanoAddress: z.string().min(1),
  message: z.string().min(1).max(300),
  showBalance: z.boolean(),
  replacePending: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`reply:${clientIp(request.headers)}`, 10, 60_000)) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }, { status: 429 });
    }

    const parsed = replySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const nanoAddress = normalizeNanoAddress(parsed.data.nanoAddress);
    const pendingMessage = sanitizeMessage(parsed.data.message);

    if (!isValidNanoAddress(nanoAddress)) {
      return NextResponse.json({ error: "La cuenta Nano no es válida." }, { status: 400 });
    }

    if (!pendingMessage) {
      return NextResponse.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REQUEST_EXPIRATION_MINUTES * 60_000);

    const result = await prisma.$transaction(async (tx) => {
      const parent = await tx.verifiedAccount.findFirst({
        where: { id: parsed.data.parentAccountId, hiddenByModeration: false },
        select: { id: true },
      });

      if (!parent) {
        return { error: "La publicación no existe." as const };
      }

      await tx.publicationRequest.updateMany({
        where: {
          nanoAddress,
          status: PublicationRequestStatus.PENDING,
          expiresAt: { lt: now },
        },
        data: { status: PublicationRequestStatus.EXPIRED },
      });

      const active = await tx.publicationRequest.findFirst({
        where: {
          nanoAddress,
          status: PublicationRequestStatus.PENDING,
          expiresAt: { gte: now },
        },
        orderBy: { createdAt: "desc" },
      });

      if (active && !parsed.data.replacePending) {
        return { request: active, reused: true };
      }

      if (active) {
        await tx.publicationRequest.update({
          where: { id: active.id },
          data: { status: PublicationRequestStatus.REPLACED },
        });
      }

      const created = await tx.publicationRequest.create({
        data: {
          nanoAddress,
          pendingMessage,
          showBalance: parsed.data.showBalance,
          expiresAt,
          replyToAccountId: parent.id,
        },
      });

      return { request: created, reused: false };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    const receiverAddress = requiredReceiverAddress();
    const paymentUri = `nano:${receiverAddress}?amount=${REQUIRED_PAYMENT_RAW}&label=NanoVoices`;
    const qrCodeDataUrl = await QRCode.toDataURL(paymentUri, {
      margin: 1,
      width: 260,
      errorCorrectionLevel: "M",
    });

    return NextResponse.json({
      id: result.request.id,
      kind: "reply",
      replyToAccountId: result.request.replyToAccountId,
      nanoAddress: result.request.nanoAddress,
      receiverAddress,
      amountNano: REQUIRED_PAYMENT_NANO,
      amountRaw: REQUIRED_PAYMENT_RAW,
      expiresAt: result.request.expiresAt.toISOString(),
      status: result.request.status,
      reused: result.reused,
      paymentUri,
      qrCodeDataUrl,
      statusUrl: `${publicAppUrl()}/api/publication-requests/${result.request.id}`,
    });
  } catch (error) {
    console.error("No se pudo crear la solicitud de respuesta", error);
    return NextResponse.json(
      {
        error:
          "No se pudo preparar el pago. Revisa PostgreSQL y la configuración de NanoVoices.",
      },
      { status: 503 },
    );
  }
}
