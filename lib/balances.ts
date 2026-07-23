import { prisma } from "@/lib/prisma";
import { getAccountsBalances } from "@/lib/nano/rpc";

const BALANCE_BATCH_SIZE = 100;

export async function refreshVerifiedAccountBalances(addresses?: string[]) {
  const verifiedAccounts =
    addresses && addresses.length > 0
      ? await prisma.verifiedAccount.findMany({
          where: { nanoAddress: { in: addresses } },
          select: { id: true, nanoAddress: true },
        })
      : await prisma.verifiedAccount.findMany({
          select: { id: true, nanoAddress: true },
        });

  const replies =
    addresses && addresses.length > 0
      ? await prisma.reply.findMany({
          where: { nanoAddress: { in: addresses } },
          select: { id: true, nanoAddress: true },
        })
      : await prisma.reply.findMany({
          select: { id: true, nanoAddress: true },
        });

  const accounts = Array.from(
    new Map(
      [...verifiedAccounts, ...replies].map((account) => [account.nanoAddress, account]),
    ).values(),
  );

  for (let index = 0; index < accounts.length; index += BALANCE_BATCH_SIZE) {
    const batch = accounts.slice(index, index + BALANCE_BATCH_SIZE);
    const balances = await getAccountsBalances(batch.map((account) => account.nanoAddress));

    await prisma.$transaction(
      batch.flatMap((account) => {
        const data = {
          cachedBalanceRaw: balances[account.nanoAddress]?.balance ?? "0",
          balanceUpdatedAt: new Date(),
        };

        return [
          prisma.verifiedAccount.updateMany({
            where: { nanoAddress: account.nanoAddress },
            data,
          }),
          prisma.reply.updateMany({
            where: { nanoAddress: account.nanoAddress },
            data,
          }),
        ];
      }),
    );
  }
}
