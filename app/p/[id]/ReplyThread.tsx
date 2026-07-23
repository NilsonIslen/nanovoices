"use client";

import { useEffect, useMemo, useState } from "react";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";

type ParentPublication = {
  id: string;
  nanoAddress: string;
};

type ReplyItem = {
  id: string;
  rank: number;
  nanoAddress: string;
  message: string;
  updatedAt: string;
  balance: { raw: string; xno: string } | null;
  balanceHidden: boolean;
};

type PaymentRequest = {
  id: string;
  nanoAddress: string;
  receiverAddress: string;
  amountNano: string;
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
};

const REFRESH_MS = 30000;

export function ReplyThread({ parent }: { parent: ParentPublication }) {
  const [nanoAddress, setNanoAddress] = useState("");
  const [message, setMessage] = useState("");
  const [showBalance, setShowBalance] = useState(true);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const charsLeft = 300 - message.length;
  const remainingSeconds = useCountdown(paymentRequest?.expiresAt);

  async function submitReply(replacePending = false) {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/reply-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentAccountId: parent.id,
          nanoAddress,
          message,
          showBalance,
          replacePending,
        }),
      });
      const data = await readJsonResponse<PaymentRequest & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo preparar la respuesta.");
      }

      setPaymentRequest(data);
      setRequestStatus(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadReplies() {
      const response = await fetch(`/api/publications/${parent.id}/replies`);
      const data = await readJsonResponse<{ items: ReplyItem[]; error?: string }>(response);
      if (!cancelled && response.ok) {
        setReplies(data.items);
      }
    }

    loadReplies().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parent.id, refreshKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey((current) => current + 1);
    }, REFRESH_MS);

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
        setPaymentRequest(null);
        setRequestStatus(null);
        setMessage("");
        setRefreshKey((current) => current + 1);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [paymentRequest]);

  return (
    <section className="mx-auto mt-4 max-w-3xl">
      <form
        className="rounded-2xl border border-[var(--nano-line)] bg-white p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          submitReply(false);
        }}
      >
        <p className="mb-3 text-sm font-semibold text-slate-700">Responder con 0,01 XNO.</p>

        <label className="block text-sm font-semibold text-slate-800" htmlFor="replyNanoAddress">
          Tu cuenta Nano
        </label>
        <input
          id="replyNanoAddress"
          className="focus-ring mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
          value={nanoAddress}
          onChange={(event) => setNanoAddress(event.target.value)}
          placeholder="nano_..."
          autoComplete="off"
        />

        <div className="mt-4 flex items-center justify-between gap-4">
          <label className="block text-sm font-semibold text-slate-800" htmlFor="replyMessage">
            Tu respuesta
          </label>
          <span className={charsLeft < 0 ? "text-sm text-red-600" : "text-sm text-slate-500"}>
            {message.length}/300
          </span>
        </div>
        <textarea
          id="replyMessage"
          className="focus-ring mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
          value={message}
          maxLength={300}
          onChange={(event) => setMessage(event.target.value)}
        />

        <fieldset className="mt-4 grid grid-cols-2 gap-2">
          <legend className="sr-only">Visibilidad del saldo</legend>
          <button
            type="button"
            className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
              showBalance
                ? "border-[var(--nano-blue)] bg-blue-50 text-[var(--nano-deep)]"
                : "border-slate-300 bg-white text-slate-600"
            }`}
            onClick={() => setShowBalance(true)}
          >
            Mostrar mi saldo
          </button>
          <button
            type="button"
            className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
              !showBalance
                ? "border-[var(--nano-blue)] bg-blue-50 text-[var(--nano-deep)]"
                : "border-slate-300 bg-white text-slate-600"
            }`}
            onClick={() => setShowBalance(false)}
          >
            Ocultar mi saldo
          </button>
        </fieldset>

        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

        <button
          className="focus-ring mt-5 w-full rounded-xl bg-[var(--nano-blue)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Preparando..." : "Responder"}
        </button>
      </form>

      {paymentRequest ? (
        <div className="mt-4 rounded-2xl border border-[var(--nano-line)] bg-[#eef7fd] p-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <img
              className="h-52 w-52 rounded border border-[var(--nano-line)] bg-white p-3"
              src={paymentRequest.qrCodeDataUrl}
              alt="Código QR de pago Nano"
            />
            <div>
              <h2 className="text-xl font-semibold text-[var(--nano-deep)]">Esperando el pago</h2>
              <p className="mt-2 text-sm text-slate-700">Envía desde la misma cuenta que escribiste.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="focus-ring inline-flex rounded-xl bg-[var(--nano-blue)] px-4 py-3 text-sm font-semibold text-white"
                  href={paymentRequest.paymentUri}
                >
                  Pagar con wallet Nano
                </a>
                <button
                  className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  type="button"
                  onClick={() => {
                    setPaymentRequest(null);
                    setRequestStatus(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
              {paymentRequest.reused ? (
                <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Ya hay una solicitud pendiente para esta cuenta.
                  <button
                    className="focus-ring mt-3 block rounded bg-amber-900 px-3 py-2 text-sm font-semibold text-white"
                    type="button"
                    onClick={() => submitReply(true)}
                  >
                    Reemplazar solicitud pendiente
                  </button>
                </div>
              ) : null}
              <p className="mt-4 text-sm text-slate-700">
                Estado: <strong>{requestStatus?.status ?? paymentRequest.status}</strong>
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Temporizador: {formatRemaining(remainingSeconds)}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <h2 className="text-2xl font-semibold text-[var(--nano-deep)]">Respuestas</h2>
        <div className="mt-2 grid gap-3">
          {replies.map((reply) => (
            <ReplyCard key={reply.id} reply={reply} />
          ))}
          {replies.length === 0 ? (
            <p className="rounded border border-[var(--nano-line)] bg-white px-4 py-3 text-sm text-slate-600">
              Sin respuestas todavía.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReplyCard({ reply }: { reply: ReplyItem }) {
  return (
    <article className="rounded border border-[var(--nano-line)] bg-white p-4 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <div className="flex w-20 shrink-0 flex-col items-center gap-2">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--nano-blue)] text-base font-semibold text-white">
            #{reply.rank}
          </div>
          <div className="max-w-20 rounded-2xl border border-[var(--nano-line)] bg-white px-2 py-1.5 text-center font-semibold leading-tight text-[var(--nano-deep)]">
            {reply.balanceHidden ? (
              <span className="block text-[11px]">Saldo oculto</span>
            ) : (
              <>
                <span className="block text-sm">{formatRoundedXno(reply.balance?.xno ?? "0")}</span>
                <span className="block text-[10px] uppercase tracking-[0.08em] text-slate-500">XNO</span>
              </>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-xs text-slate-500">{reply.nanoAddress}</p>
          <div className="relative mt-3 rounded-xl border-2 border-blue-200 bg-[#f7fbff] px-4 py-3 shadow-[0_10px_28px_rgba(32,116,205,0.08)]">
            <span className="absolute -left-[9px] top-4 h-4 w-4 rotate-45 border-b-2 border-l-2 border-blue-200 bg-[#f7fbff]" />
            <LinkifiedMessage className="relative text-lg leading-8 text-[var(--nano-deep)]" text={reply.message} />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Actualizado {new Date(reply.updatedAt).toLocaleDateString("es")}
          </p>
        </div>
      </div>
    </article>
  );
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
