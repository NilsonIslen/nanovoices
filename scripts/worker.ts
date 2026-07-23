import WebSocket from "ws";
import {
  BALANCE_REFRESH_SECONDS,
  PAYMENT_RECOVERY_HISTORY_COUNT,
  PAYMENT_RECOVERY_INTERVAL_SECONDS,
  requiredReceiverAddress,
} from "@/lib/env";
import { refreshVerifiedAccountBalances } from "@/lib/balances";
import { processPaymentHash } from "@/lib/payments";
import {
  confirmRequiredAmountWithNode,
  getReceiverHistory,
  getReceiverReceivable,
  isNanoHash,
  type NanoConfirmationMessage,
} from "@/lib/nano/rpc";
import { prisma } from "@/lib/prisma";

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

async function main() {
  await confirmRequiredAmountWithNode();
  connectWebSocket();

  setInterval(() => {
    recoverRecentPayments().catch((error) => console.error("Fallo en recuperación RPC", error));
  }, PAYMENT_RECOVERY_INTERVAL_SECONDS * 1000);

  setInterval(() => {
    refreshVerifiedAccountBalances().catch((error) =>
      console.error("Fallo actualizando saldos", error),
    );
  }, BALANCE_REFRESH_SECONDS * 1000);

  await recoverRecentPayments().catch((error) => console.error("Fallo en recuperación RPC inicial", error));
  await refreshVerifiedAccountBalances().catch((error) =>
    console.error("Fallo inicial actualizando saldos", error),
  );
}

function connectWebSocket() {
  const wsUrl = process.env.NANO_WS_URL;
  if (!wsUrl) {
    console.warn("NANO_WS_URL no está configurado; solo se usará recuperación RPC.");
    return;
  }

  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    const receiverAddress = requiredReceiverAddress();
    ws?.send(
      JSON.stringify({
        action: "subscribe",
        topic: "confirmation",
        options: {
          accounts: [receiverAddress],
          all_local_accounts: false,
        },
      }),
    );
    console.log("WebSocket Nano conectado.");
  });

  ws.on("message", (raw) => {
    handleWebSocketMessage(raw.toString()).catch((error) =>
      console.error("No se pudo procesar confirmación WebSocket", error),
    );
  });

  ws.on("close", scheduleReconnect);
  ws.on("error", (error) => {
    console.error("Error WebSocket Nano", error);
    ws?.close();
  });
}

async function handleWebSocketMessage(raw: string) {
  const event = JSON.parse(raw) as NanoConfirmationMessage;
  const hash = event.message?.hash;

  if (!hash) {
    return;
  }

  await processPaymentHash(hash);
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 5000);
}

async function recoverRecentPayments() {
  const receiverAddress = requiredReceiverAddress();
  const receivable = await getReceiverReceivable(receiverAddress, PAYMENT_RECOVERY_HISTORY_COUNT);
  const history = await getReceiverHistory(receiverAddress, PAYMENT_RECOVERY_HISTORY_COUNT);

  for (const [hash] of receivable) {
    const normalizedHash = hash.trim().toUpperCase();

    if (isNanoHash(normalizedHash)) {
      await processPaymentHash(normalizedHash);
    }
  }

  for (const entry of history) {
    const normalizedHash = entry.hash?.trim().toUpperCase();

    if (normalizedHash && entry.confirmed === "true" && isNanoHash(normalizedHash)) {
      await processPaymentHash(normalizedHash);
    }
  }

  await prisma.publicationRequest.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
