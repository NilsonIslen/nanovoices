import { NextResponse } from "next/server";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";
import { getReplyStats, rankByBalanceThenDate } from "@/lib/threads";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const account = await prisma.verifiedAccount.findFirst({
      where: { id, hiddenByModeration: false },
      select: { id: true },
    });

    const parentReply = account
      ? null
      : await prisma.reply.findFirst({
          where: { id, hiddenByModeration: false },
          select: { id: true, parentAccountId: true },
        });

    if (!account && !parentReply) {
      return NextResponse.json({ error: "Publicación no encontrada." }, { status: 404 });
    }

    const replies = await prisma.reply.findMany({
      where: account
        ? { parentAccountId: id, parentReplyId: null, hiddenByModeration: false }
        : { parentAccountId: parentReply!.parentAccountId, parentReplyId: id, hiddenByModeration: false },
      select: {
        id: true,
        message: true,
        cachedBalanceRaw: true,
        createdAt: true,
        updatedAt: true,
        level: true,
      },
    });
    const stats = await getReplyStats(prisma, replies.map((reply) => reply.id));

    const items = rankByBalanceThenDate(replies)
      .map((reply, index) => ({
        id: reply.id,
        rank: index + 1,
        message: reply.message,
        updatedAt: reply.updatedAt.toISOString(),
        publicUrl: `/p/${reply.id}`,
        balance: { raw: reply.cachedBalanceRaw, xno: rawToXno(reply.cachedBalanceRaw) },
        directReplies: stats.get(reply.id)?.directReplies ?? 0,
        threadLevels: stats.get(reply.id)?.threadLevels || reply.level,
      }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("No se pudo cargar el subranking", error);
    return NextResponse.json({ error: "No se pudo cargar el subranking.", items: [] }, { status: 503 });
  }
}
