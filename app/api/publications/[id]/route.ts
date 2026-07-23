import { NextResponse } from "next/server";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const account = await prisma.verifiedAccount.findFirst({
    where: { id, hiddenByModeration: false },
  });

  if (!account) {
    return NextResponse.json({ error: "Publicación no encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    id: account.id,
    message: account.currentMessage,
    updatedAt: account.updatedAt.toISOString(),
    balance: { raw: account.cachedBalanceRaw, xno: rawToXno(account.cachedBalanceRaw) },
  });
}
