import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";
import { explorerAccountUrl } from "@/lib/env";
import { rawToXno } from "@/lib/nano/amount";
import { prisma } from "@/lib/prisma";

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
    <main className="min-h-screen bg-[#f8fbfd] px-4 py-10">
      <article className="mx-auto max-w-3xl rounded border border-[var(--nano-line)] bg-white p-5 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-[var(--nano-blue)]">
          Volver al ranking
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-[var(--nano-blue)]">
            Cuenta verificada
          </span>
          <a className="text-sm font-semibold text-[var(--nano-blue)]" href={explorerAccountUrl(account.nanoAddress)}>
            Consultar en explorador
          </a>
        </div>
        <p className="mt-4 break-all font-mono text-sm text-slate-700">{account.nanoAddress}</p>
        <LinkifiedMessage
          className="mt-5 text-xl leading-8 text-[var(--nano-deep)]"
          text={account.currentMessage}
        />
        <p className="mt-5 font-semibold text-[var(--nano-deep)]">
          {account.showBalance ? `${rawToXno(account.cachedBalanceRaw)} XNO` : "Saldo oculto"}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Última actualización: {account.updatedAt.toLocaleDateString("es")}
        </p>
      </article>
    </main>
  );
}
