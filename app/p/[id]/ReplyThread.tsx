"use client";

import { useEffect, useMemo, useState } from "react";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";

type ReplyItem = {
  id: string;
  rank: number;
  message: string;
  updatedAt: string;
  publicUrl: string;
  balance: { raw: string; xno: string } | null;
  directReplies: number;
  threadLevels: number;
};

type PaymentRequest = {
  id: string;
  receiverAddress: string;
  amountNano: string;
  expiresAt: string;
  status: string;
  paymentUri: string;
  qrCodeDataUrl: string;
};

type RequestStatus = {
  status: string;
  existingMessage: string;
};

const REFRESH_MS = 30000;

export function ReplyThread({ parentId, nextLevel }: { parentId: string; nextLevel: number }) {
  const [message, setMessage] = useState("");
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [paidRequestId, setPaidRequestId] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const charsLeft = 300 - message.length;
  const remainingSeconds = useCountdown(paymentRequest?.expiresAt);
  const editorReady = Boolean(paidRequestId);

  async function startPayment() {
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/publication-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      });
      const data = await readJsonResponse<PaymentRequest & { error?: string }>(response);

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo preparar la respuesta.");
      }

      setPaymentRequest(data);
      setPaidRequestId(null);
      setRequestStatus(null);
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
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la respuesta.");
      setMessage("");
      setPaidRequestId(null);
      setPaymentRequest(null);
      setRequestStatus(null);
      setRefreshKey((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadReplies() {
      const response = await fetch(`/api/publications/${parentId}/replies`);
      const data = await readJsonResponse<{ items: ReplyItem[]; error?: string }>(response);
      if (!cancelled && response.ok) {
        setReplies(data.items);
      }
    }

    loadReplies().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parentId, refreshKey]);

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
        setPaidRequestId(paymentRequest.id);
        setMessage(data.existingMessage ?? "");
        setPaymentRequest(null);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [paymentRequest]);

  return (
    <section className="mx-auto mt-4 max-w-3xl">
      <form
        className="rounded-2xl border border-[var(--nano-line)] bg-white p-3 shadow-sm md:p-4"
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
              <label className="block text-sm font-semibold text-slate-800" htmlFor="replyMessage">
                Tu mensaje
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
          </>
        ) : null}

        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

        <div className={editorReady || error ? "mt-3" : ""}>
          <p className="mb-1 text-sm font-semibold text-slate-700">
            Crea o edita el mensaje de el nivel actual por 0,02 XNO.
          </p>
          <button
            className="focus-ring w-full rounded-xl bg-[var(--nano-blue)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Procesando..." : editorReady ? "Guardar mensaje" : "Crear o editar mensaje"}
          </button>
        </div>
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
              <p className="mt-2 text-sm text-slate-700">
                Envía 0,02 XNO desde la cuenta que quieres asociar a este nivel.
              </p>
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
        <h2 className="text-2xl font-semibold text-[var(--nano-deep)]">
          Ranking de nivel {nextLevel}
        </h2>
        <div className="mt-2 grid gap-3">
          {replies.map((reply) => (
            <ReplyCard key={reply.id} reply={reply} />
          ))}
          {replies.length === 0 ? (
            <p className="rounded border border-[var(--nano-line)] bg-white px-4 py-3 text-sm text-slate-600">
              Sin mensajes todavía.
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
            <span className="block text-sm">{formatRoundedXno(reply.balance?.xno ?? "0")}</span>
            <span className="block text-[10px] uppercase tracking-[0.08em] text-slate-500">XNO</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative rounded-xl border-2 border-blue-200 bg-[#f7fbff] px-4 py-3 shadow-[0_10px_28px_rgba(32,116,205,0.08)]">
            <span className="absolute -left-[9px] top-4 h-4 w-4 rotate-45 border-b-2 border-l-2 border-blue-200 bg-[#f7fbff]" />
            <LinkifiedMessage className="relative text-lg leading-8 text-[var(--nano-deep)]" text={reply.message} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>Actualizado {new Date(reply.updatedAt).toLocaleDateString("es")}</span>
            <span>
              {reply.directReplies} respuestas · {reply.threadLevels} niveles
            </span>
          </div>
          <a
            className="focus-ring mt-3 inline-flex rounded-xl border border-[var(--nano-blue)] bg-white px-3 py-2 text-sm font-semibold text-[var(--nano-blue)]"
            href={reply.publicUrl}
          >
            Abrir hilo
          </a>
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
