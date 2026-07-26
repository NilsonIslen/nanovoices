"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LinkifiedMessage } from "@/components/LinkifiedMessage";
import { MESSAGE_MAX_LENGTH } from "@/lib/sanitize";

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
  existingId: string | null;
  existingMessage: string;
};

type StoredPaymentRequest = {
  request: PaymentRequest;
  paidRequestId: string | null;
};

type CardAction = "edit" | "delete" | "reply";

const REFRESH_MS = 30000;
const PAYMENT_STATUS_POLL_MS = 12000;

export function ReplyThread({ parentId, nextLevel }: { parentId: string; nextLevel: number }) {
  const [message, setMessage] = useState("");
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [paidRequestId, setPaidRequestId] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [validatingPayment, setValidatingPayment] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeCard, setActiveCard] = useState<{ id: string; action: CardAction } | null>(null);
  const charsLeft = MESSAGE_MAX_LENGTH - message.length;
  const remainingSeconds = useCountdown(paymentRequest?.expiresAt);
  const editorReady = Boolean(paidRequestId);
  const paymentStorageKey = `nanovoices:reply-request:${parentId}`;

  async function startPayment(
    requestParentId = parentId,
    card?: { id: string; action: CardAction },
  ) {
    setError("");
    setLoading(true);
    setActiveCard(card ?? null);

    try {
      const response = await fetch("/api/publication-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: requestParentId }),
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
      forgetPaymentRequest(paymentStorageKey);
      setRefreshKey((current) => current + 1);
      setActiveCard(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function deletePaidMessage() {
    if (!paidRequestId || !window.confirm("¿Eliminar tu mensaje y todas sus respuestas?")) return;
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/publication-requests/${paidRequestId}`, {
        method: "DELETE",
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "No se pudo eliminar la respuesta.");
      setMessage("");
      setPaidRequestId(null);
      setPaymentRequest(null);
      setRequestStatus(null);
      forgetPaymentRequest(paymentStorageKey);
      setRefreshKey((current) => current + 1);
      setActiveCard(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  const validatePaymentStatus = useCallback(
    async (request: PaymentRequest, interactive = true) => {
      if (interactive) {
        setError("");
        setValidatingPayment(true);
      }

      try {
        const response = await fetch(`/api/publication-requests/${request.id}`);
        const data = await readJsonResponse<RequestStatus & { error?: string }>(response);
        if (!response.ok) throw new Error(data.error ?? "No se pudo validar el pago.");
        setRequestStatus(data);

        if (data.status === "COMPLETED") {
          if (
            activeCard &&
            activeCard.action !== "reply" &&
            data.existingId !== activeCard.id
          ) {
            setError("El pago no proviene de la cuenta propietaria de este mensaje.");
            setPaymentRequest(null);
            forgetPaymentRequest(paymentStorageKey);
            return false;
          }
          setPaidRequestId(request.id);
          setMessage(data.existingMessage ?? "");
          setPaymentRequest(null);
          rememberPaymentRequest(paymentStorageKey, request, request.id);
          return true;
        }

        return false;
      } catch (caught) {
        if (interactive) {
          setError(caught instanceof Error ? caught.message : "No se pudo validar el pago.");
        }
        return false;
      } finally {
        if (interactive) {
          setValidatingPayment(false);
        }
      }
    },
    [activeCard, paymentStorageKey],
  );

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
    let cancelled = false;
    const stored = readStoredPaymentRequest(paymentStorageKey);
    if (!stored) return;
    const activeStored = stored;

    async function resumeStoredRequest() {
      const response = await fetch(`/api/publication-requests/${activeStored.request.id}`);
      const data = await readJsonResponse<RequestStatus & { error?: string }>(response);
      if (cancelled) return;

      if (!response.ok) {
        forgetPaymentRequest(paymentStorageKey);
        return;
      }

      if (data.status === "COMPLETED") {
        setRequestStatus(data);
        setPaidRequestId(activeStored.request.id);
        setMessage(data.existingMessage ?? "");
        rememberPaymentRequest(paymentStorageKey, activeStored.request, activeStored.request.id);
        return;
      }

      if (data.status === "PENDING") {
        forgetPaymentRequest(paymentStorageKey);
        return;
      }

      if (data.status === "EXPIRED") {
        forgetPaymentRequest(paymentStorageKey);
        return;
      }

      forgetPaymentRequest(paymentStorageKey);
    }

    resumeStoredRequest().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [paymentStorageKey]);

  useEffect(() => {
    if (!paymentRequest) return;

    const interval = setInterval(async () => {
      const completed = await validatePaymentStatus(paymentRequest, false);
      if (completed) {
        clearInterval(interval);
      }
    }, PAYMENT_STATUS_POLL_MS);

    return () => clearInterval(interval);
  }, [paymentRequest, validatePaymentStatus]);

  return (
    <section className="mx-auto mt-4 max-w-3xl">
      <h2 className="text-2xl font-semibold text-[var(--nano-deep)]">
        Ranking de nivel {nextLevel}
      </h2>
      <form
        className="mt-2 rounded-2xl border border-[var(--nano-line)] bg-white p-3 shadow-sm md:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (editorReady && !activeCard) {
            publishPaidMessage();
          } else {
            startPayment();
          }
        }}
      >
        {editorReady && !activeCard ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <label className="block text-sm font-semibold text-slate-800" htmlFor="replyMessage">
                Tu mensaje
              </label>
              <span className={charsLeft < 0 ? "text-sm text-red-600" : "text-sm text-slate-500"}>
                {message.length}/{MESSAGE_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id="replyMessage"
              className="focus-ring mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
              value={message}
              maxLength={MESSAGE_MAX_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
            />
          </>
        ) : null}

        {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

        <div className={(editorReady && !activeCard) || error ? "mt-3" : ""}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="focus-ring flex-1 rounded-xl bg-[var(--nano-blue)] px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
            >
              {loading
                ? "Procesando..."
                : editorReady && !activeCard
                  ? "Guardar mensaje"
                  : "Mensaje de nueva cuenta"}
            </button>
            {editorReady && !activeCard && requestStatus?.existingMessage ? (
              <button
                className="focus-ring rounded-xl border border-red-300 bg-white px-4 py-3 font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={loading}
                onClick={deletePaidMessage}
              >
                Eliminar mensaje
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {paymentRequest && !activeCard ? (
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
                  className="focus-ring rounded-xl border border-[var(--nano-blue)] bg-white px-4 py-3 text-sm font-semibold text-[var(--nano-blue)] disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={() => validatePaymentStatus(paymentRequest)}
                  disabled={validatingPayment}
                >
                  {validatingPayment ? "Validando..." : "Validar pago"}
                </button>
                <button
                  className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  type="button"
                  onClick={() => {
                    setPaymentRequest(null);
                    setRequestStatus(null);
                    forgetPaymentRequest(paymentStorageKey);
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

      <div className="mt-3">
        <div className="grid gap-3">
          {replies.map((reply) => (
            <div key={reply.id}>
              <ReplyCard
                reply={reply}
                disabled={loading}
                onEdit={() => startPayment(parentId, { id: reply.id, action: "edit" })}
                onDelete={() => startPayment(parentId, { id: reply.id, action: "delete" })}
                onReply={() => startPayment(reply.id, { id: reply.id, action: "reply" })}
              />
              {activeCard?.id === reply.id && paymentRequest ? (
                <div className="mt-2 rounded-2xl border border-[var(--nano-line)] bg-[#eef7fd] p-4">
                  <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                    <img className="h-52 w-52 rounded border border-[var(--nano-line)] bg-white p-3" src={paymentRequest.qrCodeDataUrl} alt="Código QR de pago Nano" />
                    <div>
                      <h3 className="text-xl font-semibold text-[var(--nano-deep)]">Esperando el pago</h3>
                      <p className="mt-2 text-sm text-slate-700">Envía 0,02 XNO desde la cuenta propietaria.</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <a className="focus-ring rounded-xl bg-[var(--nano-blue)] px-4 py-3 text-sm font-semibold text-white" href={paymentRequest.paymentUri}>Pagar con wallet Nano</a>
                        <button className="focus-ring rounded-xl border border-[var(--nano-blue)] bg-white px-4 py-3 text-sm font-semibold text-[var(--nano-blue)]" type="button" onClick={() => validatePaymentStatus(paymentRequest)} disabled={validatingPayment}>
                          {validatingPayment ? "Validando..." : "Validar pago"}
                        </button>
                        <button className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" type="button" onClick={() => { setPaymentRequest(null); setRequestStatus(null); setActiveCard(null); forgetPaymentRequest(paymentStorageKey); }}>Cancelar</button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {activeCard?.id === reply.id && editorReady ? (
                <form
                  className="mt-2 rounded-2xl border border-[var(--nano-line)] bg-white p-4 shadow-sm"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (activeCard.action === "delete") deletePaidMessage();
                    else publishPaidMessage();
                  }}
                >
                  {activeCard.action !== "delete" ? (
                    <>
                      <label className="block text-sm font-semibold" htmlFor={`reply-${reply.id}`}>
                        {activeCard.action === "reply" ? "Tu respuesta" : "Edita tu mensaje"}
                      </label>
                      <textarea id={`reply-${reply.id}`} className="focus-ring mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3" value={message} maxLength={MESSAGE_MAX_LENGTH} onChange={(event) => setMessage(event.target.value)} />
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-red-700">Confirma la eliminación del mensaje y todas sus respuestas.</p>
                  )}
                  <button className={`focus-ring mt-3 w-full rounded-xl px-4 py-3 font-semibold text-white ${activeCard.action === "delete" ? "bg-red-700" : "bg-[var(--nano-blue)]"}`} disabled={loading}>
                    {activeCard.action === "delete" ? "Eliminar mensaje" : activeCard.action === "reply" ? "Publicar respuesta" : "Guardar cambios"}
                  </button>
                </form>
              ) : null}
            </div>
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

function readStoredPaymentRequest(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPaymentRequest>;
    if (!parsed.request?.id) return null;
    return parsed as StoredPaymentRequest;
  } catch {
    return null;
  }
}

function rememberPaymentRequest(
  storageKey: string,
  request: PaymentRequest,
  paidRequestId: string | null,
) {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({ request, paidRequestId } satisfies StoredPaymentRequest),
  );
}

function forgetPaymentRequest(storageKey: string) {
  window.localStorage.removeItem(storageKey);
}

function ReplyCard({
  reply,
  onEdit,
  onDelete,
  onReply,
  disabled,
}: {
  reply: ReplyItem;
  onEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  disabled: boolean;
}) {
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="focus-ring rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" type="button" onClick={onEdit} disabled={disabled}>Editar</button>
            <button className="focus-ring rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700" type="button" onClick={onDelete} disabled={disabled}>Eliminar</button>
            <button className="focus-ring rounded-xl border border-[var(--nano-blue)] bg-white px-3 py-2 text-sm font-semibold text-[var(--nano-blue)]" type="button" onClick={onReply} disabled={disabled}>Responder</button>
            <a
              className="focus-ring inline-flex rounded-xl bg-[var(--nano-blue)] px-3 py-2 text-sm font-semibold text-white"
              href={reply.publicUrl}
            >
              Ver hilo
            </a>
          </div>
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
