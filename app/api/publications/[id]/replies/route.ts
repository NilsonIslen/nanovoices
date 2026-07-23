import { NextResponse } from "next/server";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parent = await prisma.verifiedAccount.findFirst({
      where: { id, hiddenByModeration: false },
      select: { id: true },
    });

    if (!parent) {
      return NextResponse.json({ error: "Publicación no encontrada." }, { status: 404 });
    }

    const replies = await prisma.reply.findMany({
      where: { parentAccountId: id, hiddenByModeration: false },
      select: {
        id: true,
        nanoAddress: true,
        message: true,
        showBalance: true,
        cachedBalanceRaw: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const items = replies
      .sort((a, b) => {
        const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
        if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })
      .map((reply, index) => ({
        id: reply.id,
        rank: index + 1,
        nanoAddress: reply.nanoAddress,
        message: reply.message,
        updatedAt: reply.updatedAt.toISOString(),
        balance: reply.showBalance
          ? { raw: reply.cachedBalanceRaw, xno: rawToXno(reply.cachedBalanceRaw) }
          : null,
        balanceHidden: !reply.showBalance,
      }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("No se pudo cargar el subranking", error);
    return NextResponse.json({ error: "No se pudo cargar el subranking.", items: [] }, { status: 503 });
  }
}
