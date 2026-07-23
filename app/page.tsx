"use client";

import { useEffect, useMemo, useState } from "react";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";

type PaymentRequest = {
  id: string;
  receiverAddress: string;
  amountNano: string;
  amountRaw: string;
  expiresAt: string;
  status: string;
  reused: boolean;
  paymentUri: string;
  qrCodeDataUrl: string;
};

type RequestStatus = {
  status: string;
  expiresAt: string;
  completedAt: string | null;
  paymentHash: string | null;
  rank: number | null;
  existingMessage: string;
  published: boolean;
};

type RankingItem = {
  id: string;
  rank: number;
  message: string;
  updatedAt: string;
  publicUrl: string;
  balance: { raw: string; xno: string } | null;
  directReplies: number;
  threadLevels: number;
};

const RANKING_REFRESH_MS = 30000;

export default function Home() {
  const [message, setMessage] = useState("");
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [paidRequestId, setPaidRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const query = "";
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [rankingRefreshKey, setRankingRefreshKey] = useState(0);
  const [rankingError, setRankingError] = useState("");

  const remainingSeconds = useCountdown(paymentRequest?.expiresAt);
  const charsLeft = 300 - message.length;

  async function startPayment() {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/publication-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readJsonResponse<PaymentRequest & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo crear la solicitud.");
      }

      setPaymentRequest(data);
      setRequestStatus(null);
      setPaidRequestId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function publishPaidMessage() {
    if (!paidRequestId) return;
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/publication-requests/${paidRequestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "No se pudo publicar el mensaje.");
      setPaidRequestId(null);
      setPaymentRequest(null);
      setRequestStatus(null);
      setMessage("");
      setRankingRefreshKey((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreRanking() {
    const nextPage = page + 1;
    const response = await fetch(
      `/api/ranking?q=${encodeURIComponent(query)}&page=${nextPage}&limit=25`,
    );
    const data = await readJsonResponse<{
      items: RankingItem[];
      hasMore: boolean;
      error?: string;
    }>(response);
    if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el ranking.");
    setRankingError("");
    setRanking((current) => [...current, ...data.items]);
    setHasMore(data.hasMore);
    setPage(nextPage);
  }

  function cancelPaymentView() {
    setPaymentRequest(null);
    setRequestStatus(null);
    setError("");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialRanking() {
      const response = await fetch(`/api/ranking?q=${encodeURIComponent(query)}&page=1&limit=25`);
      const data = await readJsonResponse<{
        items: RankingItem[];
        hasMore: boolean;
        error?: string;
      }>(response);

      if (!cancelled && response.ok) {
        setRanking(data.items);
        setHasMore(data.hasMore);
        setPage(1);
        setRankingError("");
      }

      if (!cancelled && !response.ok) {
        setRanking([]);
        setHasMore(false);
        setRankingError(data.error ?? "No se pudo cargar el ranking.");
      }
    }

    loadInitialRanking().catch((caught) => {
      if (!cancelled) {
        setRanking([]);
        setHasMore(false);
        setRankingError(caught instanceof Error ? caught.message : "No se pudo cargar el ranking.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [query, rankingRefreshKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRankingRefreshKey((current) => current + 1);
    }, RANKING_REFRESH_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!paymentRequest) return;

    const interval = setInterval(async () => {
      const response = await fetch(`/api/publication-requests/${paymentRequest.id}`);
      const data = await readJsonResponse<RequestStatus>(response);
      if (!response.ok) return;
      setRequestStatus(data);

      if (data.status === "COMPLETED") {
        clearInterval(interval);
        setPaidRequestId(paymentRequest.id);
        setMessage(data.existingMessage ?? "");
        setRankingRefreshKey((current) => current + 1);
        setPaymentRequest(null);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [paymentRequest]);

  const editorReady = Boolean(paidRequestId);

  return (
    <main className="min-h-screen">
      <section className="border-b border-[var(--nano-line)] bg-white">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-6 pt-0 md:grid-cols-[0.95fr_1.05fr] md:gap-6 md:px-6 md:pb-8 md:pt-0">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div
                aria-hidden="true"
                className="grid h-12 w-12 place-items-center"
              >
                <div className="relative h-8 w-9 rounded bg-[var(--nano-blue)]">
                  <span className="absolute -bottom-1 left-3 h-3 w-3 rotate-45 rounded-[2px] bg-[var(--nano-blue)]" />
                  <span className="absolute left-[9px] top-[13px] h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="absolute left-[17px] top-[13px] h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="absolute right-[9px] top-[13px] h-1.5 w-1.5 rounded-full bg-white" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-semibold uppercase tracking-[0.12em] text-[var(--nano-blue)] md:text-4xl">
                  NanoVoices
                </p>
                <h1 className="mt-1 whitespace-nowrap text-sm font-semibold text-[var(--nano-deep)] md:text-base">
                  Predominan las cuentas con más XNO guardado
                </h1>
              </div>
            </div>
          </div>

          <div>
            <form
              className="rounded-2xl border border-[var(--nano-line)] bg-[#fbfdff] p-3 shadow-sm md:p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (editorReady) {
                  publishPaidMessage();
                } else {
                  startPayment();
                }
              }}
            >
            {editorReady ? (
              <>
              <div className="flex items-center justify-between gap-4">
              <label className="block text-sm font-semibold text-slate-800" htmlFor="message">
                Tu mensaje
              </label>
              <span className={charsLeft < 0 ? "text-sm text-red-600" : "text-sm text-slate-500"}>
                {message.length}/300
              </span>
            </div>
            <textarea
              id="message"
              className="focus-ring mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
              value={message}
              maxLength={300}
              onChange={(event) => setMessage(event.target.value)}
            />
              </>
            ) : null}

            {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

            <div className={editorReady || error ? "mt-3" : ""}>
              <p className="mb-1 text-sm font-semibold text-slate-700">
                Crea o edita tu mensaje en el nivel actual por 0,02 XNO.
              </p>
              <button
                className="focus-ring w-full rounded-xl bg-[var(--nano-blue)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? "Procesando..." : editorReady ? "Guardar mensaje" : "Crear o editar mensaje"}
              </button>
            </div>
            </form>
          </div>
        </div>
      </section>

      {paymentRequest ? (
        <PaymentPanel
          request={paymentRequest}
          status={requestStatus}
          remainingSeconds={remainingSeconds}
          onCancel={cancelPaymentView}
        />
      ) : null}

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-4 md:px-6 md:pt-5">
        <div className="mb-1">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--nano-deep)]">Ranking de nivel 1</h2>
          </div>
        </div>

        {rankingError ? (
          <p className="mb-5 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {rankingError}
          </p>
        ) : null}

        <div className="grid gap-3">
          {ranking.map((item) => (
            <RankingCard key={item.id} item={item} />
          ))}
        </div>

        {hasMore ? (
          <button
            className="focus-ring mt-5 rounded border border-[var(--nano-blue)] bg-white px-4 py-2 text-sm font-semibold text-[var(--nano-blue)]"
            onClick={() => loadMoreRanking()}
          >
            Cargar más
          </button>
        ) : null}
      </section>
    </main>
  );
}

function PaymentPanel({
  request,
  status,
  remainingSeconds,
  onCancel,
}: {
  request: PaymentRequest;
  status: RequestStatus | null;
  remainingSeconds: number;
  onCancel: () => void;
}) {
  return (
    <section className="border-b border-[var(--nano-line)] bg-[#eef7fd]">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-6 md:grid-cols-[280px_1fr] md:px-6">
        <img
          className="h-64 w-64 rounded border border-[var(--nano-line)] bg-white p-3"
          src={request.qrCodeDataUrl}
          alt="Código QR de pago Nano"
        />
        <div>
          <h2 className="text-2xl font-semibold text-[var(--nano-deep)]">
            Esperando el pago
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Envía 0,02 XNO desde la cuenta que quieres asociar al mensaje.
          </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                className="focus-ring inline-flex rounded-xl bg-[var(--nano-blue)] px-4 py-3 text-sm font-semibold text-white"
                href={request.paymentUri}
              >
                Pagar con wallet Nano
              </a>
              <button
                className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                type="button"
                onClick={onCancel}
              >
                Cancelar
              </button>
            </div>

          <CopyRow label="Receptor" value={request.receiverAddress} />

          <div className="mt-4 grid gap-2 text-sm text-slate-700">
            <p>
              Estado:{" "}
              <strong className="text-[var(--nano-deep)]">
                {status?.status ?? request.status}
              </strong>
            </p>
            <p>Temporizador: {formatRemaining(remainingSeconds)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4 rounded border border-[var(--nano-line)] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <code className="break-all text-sm text-[var(--nano-deep)]">{value}</code>
        <button
          className="focus-ring w-fit rounded border border-slate-300 px-3 py-2 text-sm font-semibold"
          onClick={() => navigator.clipboard.writeText(value)}
        >
          Copiar
        </button>
      </div>
    </div>
  );
}

function RankingCard({ item }: { item: RankingItem }) {
  const prominent = item.rank <= 3;

  return (
    <article
      id={item.rank === 1 ? "ranking-card" : undefined}
      className={`rounded border bg-white p-4 shadow-sm md:p-5 ${
        prominent ? "border-[var(--nano-blue)]" : "border-[var(--nano-line)]"
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="flex w-20 shrink-0 flex-col items-center gap-2">
            <div
              className={`grid h-14 w-14 place-items-center rounded-full font-semibold text-white ${
                prominent ? "bg-[var(--nano-blue)] text-xl" : "bg-[var(--nano-deep)] text-lg"
              }`}
            >
              #{item.rank}
            </div>
            <div className="max-w-20 rounded-2xl border border-[var(--nano-line)] bg-white px-2 py-1.5 text-center font-semibold leading-tight text-[var(--nano-deep)]">
              <span className="block text-sm">{formatRoundedXno(item.balance?.xno ?? "0")}</span>
              <span className="block text-[10px] uppercase tracking-[0.08em] text-slate-500">XNO</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative mt-3 rounded-xl border-2 border-blue-200 bg-[#f7fbff] px-4 py-3 shadow-[0_10px_28px_rgba(32,116,205,0.08)]">
              <span className="absolute -left-[9px] top-4 h-4 w-4 rotate-45 border-b-2 border-l-2 border-blue-200 bg-[#f7fbff]" />
              <LinkifiedMessage
                className="relative text-lg leading-8 text-[var(--nano-deep)]"
                text={item.message}
              />
            </div>
          </div>
        </div>
        <div className="shrink-0 pl-17 text-left md:pl-0 md:text-right">
          <p className="mt-1 text-sm text-slate-500">
            Actualizado {new Date(item.updatedAt).toLocaleDateString("es")}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {item.directReplies} respuestas · {item.threadLevels} niveles
          </p>
          <a
            className="focus-ring mt-3 inline-flex rounded-xl border border-[var(--nano-blue)] bg-white px-3 py-2 text-sm font-semibold text-[var(--nano-blue)]"
            href={item.publicUrl}
          >
            Abrir hilo
          </a>
        </div>
      </div>
    </article>
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

function useCountdown(expiresAt?: string) {
  const target = useMemo(() => (expiresAt ? new Date(expiresAt).getTime() : 0), [expiresAt]);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!target) return;

    const update = () => setRemaining(Math.max(Math.ceil((target - Date.now()) / 1000), 0));
    update();
    const interval = setInterval(update, 1000);

    return () => clearInterval(interval);
  }, [target]);

  return remaining;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: response.ok
        ? "La respuesta del servidor no es JSON válido."
        : `El servidor respondió ${response.status}.`,
    } as T;
  }
}

function formatRemaining(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
