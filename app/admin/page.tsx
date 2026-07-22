import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [accounts, unassociatedPayments] = await Promise.all([
    prisma.verifiedAccount.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { histories: { orderBy: { publishedAt: "desc" }, take: 5 } },
    }),
    prisma.payment.findMany({
      where: { status: { not: "PROCESSED" } },
      orderBy: { detectedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold text-[var(--nano-deep)]">Administración</h1>
      <p className="mt-2 text-sm text-slate-600">
        Panel básico protegido por Basic Auth. Las acciones de moderación quedan auditadas.
      </p>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Publicaciones</h2>
        <div className="mt-3 grid gap-3">
          {accounts.map((account) => (
            <article key={account.id} className="rounded border border-[var(--nano-line)] bg-white p-4">
              <p className="break-all font-mono text-sm">{account.nanoAddress}</p>
              <p className="mt-2">{account.currentMessage}</p>
              <p className="mt-2 text-sm text-slate-600">
                Estado: {account.hiddenByModeration ? "Oculta" : "Visible"}
              </p>
              <form className="mt-3 flex flex-col gap-2 md:flex-row" action={`/api/admin/publications/${account.id}`} method="post">
                <input
                  name="reason"
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Razón de moderación"
                />
                <button name="action" value="hide" className="rounded bg-[var(--nano-deep)] px-3 py-2 text-sm font-semibold text-white">
                  Ocultar
                </button>
                <button name="action" value="restore" className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold">
                  Restaurar
                </button>
              </form>
              <details className="mt-3 text-sm">
                <summary>Historial reciente</summary>
                {account.histories.map((history) => (
                  <p key={history.id} className="mt-2 break-all text-slate-600">
                    {history.publishedAt.toISOString()} - {history.paymentHash} - {history.message}
                  </p>
                ))}
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Pagos no asociados o inválidos</h2>
        <div className="mt-3 grid gap-2">
          {unassociatedPayments.map((payment) => (
            <div key={payment.id} className="rounded border border-[var(--nano-line)] bg-white p-3 text-sm">
              <p className="break-all font-mono">{payment.blockHash}</p>
              <p>
                {payment.status} - {payment.amountRaw} raw - origen {payment.sourceAddress}
              </p>
              {payment.notes ? <p className="text-slate-600">{payment.notes}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
