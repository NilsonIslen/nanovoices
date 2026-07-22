import { NextResponse } from "next/server";
import { explorerAccountUrl } from "@/lib/env";
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
    nanoAddress: account.nanoAddress,
    message: account.currentMessage,
    updatedAt: account.updatedAt.toISOString(),
    explorerUrl: explorerAccountUrl(account.nanoAddress),
    balance: account.showBalance
      ? { raw: account.cachedBalanceRaw, xno: rawToXno(account.cachedBalanceRaw) }
      : null,
    balanceHidden: !account.showBalance,
  });
}
