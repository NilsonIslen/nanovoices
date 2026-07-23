import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";
import { ReplyThread } from "./ReplyThread";

export const dynamic = "force-dynamic";

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await prisma.verifiedAccount.findFirst({
    where: { id, hiddenByModeration: false },
  });

  if (!account) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f8fbfd] px-4 py-5">
      <article className="mx-auto max-w-3xl rounded-2xl border border-[var(--nano-line)] bg-white p-5 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-[var(--nano-blue)]">
          Volver al ranking
        </Link>
        <h1 className="mt-4 break-all font-mono text-lg font-semibold text-[var(--nano-deep)]">
          {account.nanoAddress}
        </h1>
        <div className="relative mt-4 rounded-xl border-2 border-blue-200 bg-[#f7fbff] px-4 py-3 shadow-[0_10px_28px_rgba(32,116,205,0.08)]">
          <LinkifiedMessage
            className="relative text-xl leading-8 text-[var(--nano-deep)]"
            text={account.currentMessage}
          />
        </div>
        <p className="mt-4 font-semibold text-[var(--nano-deep)]">
          {account.showBalance ? `${rawToXno(account.cachedBalanceRaw)} XNO` : "Saldo oculto"}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Última actualización: {account.updatedAt.toLocaleDateString("es")}
        </p>
      </article>
      <ReplyThread parent={{ id: account.id, nanoAddress: account.nanoAddress }} />
    </main>
  );
}
