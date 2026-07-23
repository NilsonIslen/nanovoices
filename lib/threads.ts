import { Prisma, type PrismaClient } from "@prisma/client";
import { rawToXno } from "@/lib/nano/amount";

export const MAX_THREAD_LEVEL = 100;

type Tx = Prisma.TransactionClient | PrismaClient;

export type ThreadContext =
  | { kind: "root"; level: 1; parentAccountId: null; parentReplyId: null }
  | { kind: "account"; level: 2; parentAccountId: string; parentReplyId: null }
  | { kind: "reply"; level: number; parentAccountId: string; parentReplyId: string };

export async function resolveThreadContext(tx: Tx, parentId?: string | null): Promise<ThreadContext | null> {
  if (!parentId) {
    return { kind: "root", level: 1, parentAccountId: null, parentReplyId: null };
  }

  const account = await tx.verifiedAccount.findFirst({
    where: { id: parentId, hiddenByModeration: false },
    select: { id: true },
  });

  if (account) {
    return { kind: "account", level: 2, parentAccountId: account.id, parentReplyId: null };
  }

  const reply = await tx.reply.findFirst({
    where: { id: parentId, hiddenByModeration: false },
    select: { id: true, parentAccountId: true, level: true },
  });

  if (!reply || reply.level >= MAX_THREAD_LEVEL) {
    return null;
  }

  return {
    kind: "reply",
    level: reply.level + 1,
    parentAccountId: reply.parentAccountId,
    parentReplyId: reply.id,
  };
}

export async function deleteAccountDescendants(tx: Prisma.TransactionClient, accountId: string) {
  await tx.reply.deleteMany({ where: { parentAccountId: accountId } });
}

export async function deleteReplyDescendants(tx: Prisma.TransactionClient, replyId: string) {
  await tx.$executeRaw`
    WITH RECURSIVE descendants AS (
      SELECT "id" FROM "Reply" WHERE "parentReplyId" = ${replyId}
      UNION ALL
      SELECT r."id" FROM "Reply" r
      INNER JOIN descendants d ON r."parentReplyId" = d."id"
    )
    DELETE FROM "Reply" WHERE "id" IN (SELECT "id" FROM descendants)
  `;
}

export function rankByBalanceThenDate<T extends { cachedBalanceRaw: string; createdAt: Date }>(items: T[]) {
  return items.sort((a, b) => {
    const balanceDiff = BigInt(b.cachedBalanceRaw) - BigInt(a.cachedBalanceRaw);
    if (balanceDiff !== 0n) return balanceDiff > 0n ? 1 : -1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export async function getReplyStats(tx: Tx, replyIds: string[]) {
  if (replyIds.length === 0) {
    return new Map<string, { directReplies: number; threadLevels: number }>();
  }

  const direct = await tx.reply.groupBy({
    by: ["parentReplyId"],
    where: { parentReplyId: { in: replyIds }, hiddenByModeration: false },
    _count: { _all: true },
  });

  const descendants = await tx.$queryRaw<Array<{ origin: string; maxLevel: number }>>`
    WITH RECURSIVE descendants(origin, id, level) AS (
      SELECT "parentReplyId" AS origin, "id", "level"
      FROM "Reply"
      WHERE "parentReplyId" IN (${Prisma.join(replyIds)})
        AND "hiddenByModeration" = false
      UNION ALL
      SELECT d.origin, r."id", r."level"
      FROM "Reply" r
      INNER JOIN descendants d ON r."parentReplyId" = d.id
      WHERE r."hiddenByModeration" = false
    )
    SELECT origin, MAX(level)::int AS "maxLevel"
    FROM descendants
    GROUP BY origin
  `;

  const stats = new Map(replyIds.map((id) => [id, { directReplies: 0, threadLevels: 0 }]));

  for (const row of direct) {
    if (row.parentReplyId) {
      stats.set(row.parentReplyId, {
        ...(stats.get(row.parentReplyId) ?? { directReplies: 0, threadLevels: 0 }),
        directReplies: row._count._all,
      });
    }
  }

  for (const row of descendants) {
    stats.set(row.origin, {
      ...(stats.get(row.origin) ?? { directReplies: 0, threadLevels: 0 }),
      threadLevels: row.maxLevel,
    });
  }

  return stats;
}

export async function getAccountStats(tx: Tx, accountIds: string[]) {
  if (accountIds.length === 0) {
    return new Map<string, { directReplies: number; threadLevels: number }>();
  }

  const direct = await tx.reply.groupBy({
    by: ["parentAccountId"],
    where: { parentAccountId: { in: accountIds }, parentReplyId: null, hiddenByModeration: false },
    _count: { _all: true },
  });

  const descendants = await tx.reply.groupBy({
    by: ["parentAccountId"],
    where: { parentAccountId: { in: accountIds }, hiddenByModeration: false },
    _max: { level: true },
  });

  const stats = new Map(accountIds.map((id) => [id, { directReplies: 0, threadLevels: 1 }]));

  for (const row of direct) {
    stats.set(row.parentAccountId, {
      ...(stats.get(row.parentAccountId) ?? { directReplies: 0, threadLevels: 1 }),
      directReplies: row._count._all,
    });
  }

  for (const row of descendants) {
    stats.set(row.parentAccountId, {
      ...(stats.get(row.parentAccountId) ?? { directReplies: 0, threadLevels: 1 }),
      threadLevels: row._max.level ?? 1,
    });
  }

  return stats;
}

export function visibleBalance(raw: string) {
  return { raw, xno: rawToXno(raw) };
}
