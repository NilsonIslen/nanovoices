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
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveThreadContext } from "@/lib/threads";

const publicationSchema = z.object({
  parentId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (!rateLimit(`publication:${clientIp(request.headers)}`, 10, 60_000)) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }, { status: 429 });
    }

    const parsed = publicationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REQUEST_EXPIRATION_MINUTES * 60_000);

    const result = await prisma.$transaction(async (tx) => {
      const context = await resolveThreadContext(tx, parsed.data.parentId);
      if (!context) {
        return { error: "El hilo no existe o ya llegó al nivel máximo." as const };
      }

      await tx.publicationRequest.updateMany({
        where: {
          nanoAddress: "",
          status: PublicationRequestStatus.PENDING,
          expiresAt: { lt: now },
        },
        data: { status: PublicationRequestStatus.EXPIRED },
      });

      const created = await tx.publicationRequest.create({
        data: {
          nanoAddress: "",
          pendingMessage: "",
          showBalance: true,
          expiresAt,
          replyToAccountId: context.kind === "account" ? context.parentAccountId : null,
          replyToReplyId: context.kind === "reply" ? context.parentReplyId : null,
        },
      });

      return { request: created, reused: false, level: context.level };
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
      receiverAddress,
      amountNano: REQUIRED_PAYMENT_NANO,
      amountRaw: REQUIRED_PAYMENT_RAW,
      expiresAt: result.request.expiresAt.toISOString(),
      status: result.request.status,
      reused: result.reused,
      level: result.level,
      paymentUri,
      qrCodeDataUrl,
      statusUrl: `${publicAppUrl()}/api/publication-requests/${result.request.id}`,
    });
  } catch (error) {
    console.error("No se pudo crear la solicitud de publicación", error);
    return NextResponse.json(
      {
        error:
          "No se pudo preparar el pago. Revisa PostgreSQL y la configuración de NanoVoices.",
      },
      { status: 503 },
    );
  }
}
