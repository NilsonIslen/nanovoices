import { prisma } from "@/lib/prisma";
import { getAccountsBalances } from "@/lib/nano/rpc";

const BALANCE_BATCH_SIZE = 100;

export async function refreshVerifiedAccountBalances(addresses?: string[]) {
  const accounts =
    addresses && addresses.length > 0
      ? await prisma.verifiedAccount.findMany({
          where: { nanoAddress: { in: addresses } },
          select: { id: true, nanoAddress: true },
        })
      : await prisma.verifiedAccount.findMany({
          select: { id: true, nanoAddress: true },
        });

  for (let index = 0; index < accounts.length; index += BALANCE_BATCH_SIZE) {
    const batch = accounts.slice(index, index + BALANCE_BATCH_SIZE);
    const balances = await getAccountsBalances(batch.map((account) => account.nanoAddress));

    await prisma.$transaction(
      batch.map((account) =>
        prisma.verifiedAccount.update({
          where: { id: account.id },
          data: {
            cachedBalanceRaw: balances[account.nanoAddress]?.balance ?? "0",
            balanceUpdatedAt: new Date(),
          },
        }),
      ),
    );
  }
}
