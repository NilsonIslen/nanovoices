import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";
import { ReplyThread } from "./ReplyThread";

export const dynamic = "force-dynamic";

type ThreadNode = {
  id: string;
  level: number;
  message: string;
  updatedAt: Date;
  balanceRaw: string;
};

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.verifiedAccount.findFirst({
    where: { id, hiddenByModeration: false },
  });

  if (account) {
    const chain: ThreadNode[] = [
      {
        id: account.id,
        level: 1,
        message: account.currentMessage,
        updatedAt: account.updatedAt,
        balanceRaw: account.cachedBalanceRaw,
      },
    ];

    return <ThreadPage currentId={account.id} currentLevel={1} chain={chain} />;
  }

  const reply = await prisma.reply.findFirst({
    where: { id, hiddenByModeration: false },
  });

  if (!reply) {
    notFound();
  }

  const root = await prisma.verifiedAccount.findFirst({
    where: { id: reply.parentAccountId, hiddenByModeration: false },
  });

  if (!root) {
    notFound();
  }

  const replies = await prisma.reply.findMany({
    where: { parentAccountId: root.id, hiddenByModeration: false },
  });
  const byId = new Map(replies.map((item) => [item.id, item]));
  const replyChain = [];
  let cursor: typeof reply | undefined = reply;

  while (cursor) {
    replyChain.unshift(cursor);
    cursor = cursor.parentReplyId ? byId.get(cursor.parentReplyId) : undefined;
  }

  const chain: ThreadNode[] = [
    {
      id: root.id,
      level: 1,
      message: root.currentMessage,
      updatedAt: root.updatedAt,
      balanceRaw: root.cachedBalanceRaw,
    },
    ...replyChain.map((item) => ({
      id: item.id,
      level: item.level,
      message: item.message,
      updatedAt: item.updatedAt,
      balanceRaw: item.cachedBalanceRaw,
    })),
  ];

  return <ThreadPage currentId={reply.id} currentLevel={reply.level} chain={chain} />;
}

function ThreadPage({
  currentId,
  currentLevel,
  chain,
}: {
  currentId: string;
  currentLevel: number;
  chain: ThreadNode[];
}) {
  const nextLevel = currentLevel + 1;

  return (
    <main className="min-h-screen bg-[#f8fbfd] px-4 py-5">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-[var(--nano-blue)]">
          Volver al ranking
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--nano-deep)]">
          Hilo hasta nivel {currentLevel}
        </h1>
        <div className="mt-4 grid gap-3">
          {chain.map((node) => (
            <article
              key={node.id}
              className="rounded border border-[var(--nano-line)] bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-[var(--nano-deep)]">Nivel {node.level}</p>
                <p className="shrink-0 text-sm font-semibold text-[var(--nano-deep)]">
                  {formatRoundedXno(rawToXno(node.balanceRaw))} XNO
                </p>
              </div>
              <div className="relative mt-3 rounded-xl border-2 border-blue-200 bg-[#f7fbff] px-4 py-3 shadow-[0_10px_28px_rgba(32,116,205,0.08)]">
                <LinkifiedMessage
                  className="relative text-lg leading-8 text-[var(--nano-deep)]"
                  text={node.message}
                />
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Actualizado {node.updatedAt.toLocaleDateString("es")}
              </p>
            </article>
          ))}
        </div>
      </section>
      {currentLevel < 100 ? (
        <ReplyThread parentId={currentId} nextLevel={nextLevel} />
      ) : (
        <p className="mx-auto mt-4 max-w-3xl rounded border border-[var(--nano-line)] bg-white px-4 py-3 text-sm text-slate-600">
          Este hilo llegó al nivel máximo.
        </p>
      )}
    </main>
  );
}

function formatRoundedXno(value: string) {
  const [wholeRaw = "0", fractionRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/[^\d]/g, "") || "0";
  const shouldRoundUp = Number(fractionRaw[0] ?? "0") >= 5;

  try {
    return (BigInt(whole) + (shouldRoundUp ? 1n : 0n)).toString();
  } catch {
    return whole;
  }
}
