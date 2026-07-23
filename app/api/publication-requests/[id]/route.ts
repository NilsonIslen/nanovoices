import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const publicationRequest = await prisma.publicationRequest.findUnique({
      where: { id },
      include: { payments: true },
    });

    if (!publicationRequest) {
      return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    }

    let rank: number | null = null;

    if (publicationRequest.status === "COMPLETED") {
      if (publicationRequest.replyToAccountId) {
        const replies = await prisma.reply.findMany({
          where: {
            parentAccountId: publicationRequest.replyToAccountId,
            hiddenByModeration: false,
          },
          orderBy: [{ createdAt: "asc" }],
          select: { nanoAddress: true, cachedBalanceRaw: true, createdAt: true },
        });

        const sorted = replies.sort((a, b) => {
          const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
          if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });

        rank = sorted.findIndex((reply) => reply.nanoAddress === publicationRequest.nanoAddress) + 1;
      } else {
        const accounts = await prisma.verifiedAccount.findMany({
          where: { hiddenByModeration: false },
          orderBy: [{ verifiedAt: "asc" }],
          select: { nanoAddress: true, cachedBalanceRaw: true, verifiedAt: true },
        });

        const sorted = accounts.sort((a, b) => {
          const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
          if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
          return a.verifiedAt.getTime() - b.verifiedAt.getTime();
        });

        rank = sorted.findIndex((account) => account.nanoAddress === publicationRequest.nanoAddress) + 1;
      }
    }

    return NextResponse.json({
      id: publicationRequest.id,
      kind: publicationRequest.replyToAccountId ? "reply" : "publication",
      replyToAccountId: publicationRequest.replyToAccountId,
      nanoAddress: publicationRequest.nanoAddress,
      status: publicationRequest.status,
      expiresAt: publicationRequest.expiresAt.toISOString(),
      completedAt: publicationRequest.completedAt?.toISOString() ?? null,
      paymentHash: publicationRequest.paymentHash,
      rank: rank || null,
    });
  } catch (error) {
    console.error("No se pudo consultar la solicitud", error);
    return NextResponse.json(
      { error: "No se pudo consultar el estado. Revisa PostgreSQL." },
      { status: 503 },
    );
  }
}
