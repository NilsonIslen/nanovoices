import { REQUIRED_PAYMENT_RAW } from "@/lib/env";

const RPC_TIMEOUT_MS = 10_000;
const RPC_ERROR_COOLDOWN_MS = 60_000;
const rpcCooldowns = new Map<string, number>();

export type NanoBlockInfo = {
  block_account?: string;
  amount?: string;
  confirmed?: string;
  subtype?: string;
  type?: string;
  link_as_account?: string;
  linked_account?: string;
  contents?:
    | string
    | {
        link?: string;
        link_as_account?: string;
        linked_account?: string;
      };
  local_timestamp?: string;
};

export type NanoConfirmationMessage = {
  topic?: string;
  message?: {
    hash?: string;
    block?: {
      account?: string;
      link_as_account?: string;
      subtype?: string;
    };
    amount?: string;
  };
};

export type AccountHistoryEntry = {
  hash?: string;
  type?: string;
  subtype?: string;
  account?: string;
  amount?: string;
  confirmed?: string;
  local_timestamp?: string;
  timestamp?: string;
};

export type ReceivableEntry = {
  amount?: string;
  source?: string;
};

type NanoRpcOptions<T> = {
  shouldRetryWithFallback?: (data: T) => boolean;
};

export async function nanoRpc<T>(body: Record<string, unknown>, options: NanoRpcOptions<T> = {}) {
  const rpcUrls = getNanoRpcUrls();
  let lastError: unknown;

  for (let index = 0; index < rpcUrls.length; index += 1) {
    const rpcUrl = rpcUrls[index];
    const isLastRpc = index === rpcUrls.length - 1;
    const cooldownUntil = rpcCooldowns.get(rpcUrl) ?? 0;

    if (cooldownUntil > Date.now()) {
      lastError = new Error("El nodo Nano está en cooldown temporal");
      continue;
    }

    try {
      const data = await requestNanoRpc<T>(rpcUrl, body);

      if (!isLastRpc && options.shouldRetryWithFallback?.(data)) {
        continue;
      }

      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No se pudo conectar con el nodo Nano");
}

async function requestNanoRpc<T>(rpcUrl: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.NANO_RPC_TOKEN) {
      headers.Authorization = `Bearer ${process.env.NANO_RPC_TOKEN}`;
    }

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RPC Nano respondió HTTP ${response.status}`);
    }

    const data = (await response.json()) as T & { error?: string; message?: string; retry_after?: string };

    if (data.error) {
      const retryAfter = Number(data.retry_after);

      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const nowSeconds = Date.now() / 1000;
        const retrySeconds = retryAfter > nowSeconds ? retryAfter - nowSeconds : retryAfter;
        const cooldownSeconds = Math.min(Math.max(retrySeconds, 1), 30);
        rpcCooldowns.set(rpcUrl, Date.now() + cooldownSeconds * 1000);
      } else if (isRateLimitError(data.error, data.message)) {
        rpcCooldowns.set(rpcUrl, Date.now() + RPC_ERROR_COOLDOWN_MS);
      }

      throw new Error(data.message || data.error);
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("El nodo Nano tardó demasiado en responder");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getNanoRpcUrls() {
  return [
    process.env.NANO_RPC_URL ?? "http://127.0.0.1:7076",
    ...(process.env.NANO_RPC_FALLBACK_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
  ];
}

function isRateLimitError(error: string, message?: string) {
  const text = `${error} ${message ?? ""}`.toLowerCase();
  return text.includes("429") || text.includes("rate") || text.includes("limit");
}

export async function getBlockInfo(hash: string) {
  const data = await nanoRpc<NanoBlockInfo>({
    action: "block_info",
    hash,
    json_block: "true",
    include_linked_account: "true",
  });

  return normalizeBlockInfo(data);
}

export async function getReceiverHistory(receiverAddress: string, count: number) {
  const data = await nanoRpc<{ history?: AccountHistoryEntry[] | "" }>({
    action: "account_history",
    account: receiverAddress,
    count: String(count),
    raw: "true",
  }, {
    shouldRetryWithFallback: (history) =>
      !Array.isArray(history.history) || history.history.length === 0,
  });

  return Array.isArray(data.history) ? data.history : [];
}

export async function getReceiverReceivable(receiverAddress: string, count: number) {
  const data = await nanoRpc<{ blocks?: Record<string, ReceivableEntry> }>({
    action: "receivable",
    account: receiverAddress,
    count: String(count),
    source: "true",
    include_only_confirmed: "true",
  }, {
    shouldRetryWithFallback: (receivable) =>
      !receivable.blocks ||
      typeof receivable.blocks !== "object" ||
      Object.keys(receivable.blocks).length === 0,
  });

  if (!data.blocks || typeof data.blocks !== "object") {
    return [];
  }

  return Object.entries(data.blocks);
}

export async function getAccountsBalances(addresses: string[]) {
  if (addresses.length === 0) {
    return {};
  }

  const data = await nanoRpc<{
    balances?: Record<string, { balance?: string; pending?: string; receivable?: string }>;
  }>({
    action: "accounts_balances",
    accounts: addresses,
  });

  return data.balances ?? {};
}

export async function confirmRequiredAmountWithNode() {
  try {
    const data = await nanoRpc<{ amount?: string }>({
      action: "nano_to_raw",
      amount: "0.02",
    });

    if (data.amount && data.amount !== REQUIRED_PAYMENT_RAW) {
      throw new Error(`El nodo devolvió ${data.amount} raw para 0.02 XNO`);
    }

    return true;
  } catch (error) {
    console.warn(
      "No se pudo confirmar nano_to_raw con el nodo; se usará la constante validada por pruebas.",
      error,
    );
    return false;
  }
}

export function getBlockDestination(block: NanoBlockInfo) {
  if (block.link_as_account) {
    return block.link_as_account;
  }

  if (block.linked_account) {
    return block.linked_account;
  }

  if (!block.contents || typeof block.contents === "string") {
    return undefined;
  }

  return block.contents.link_as_account ?? block.contents.linked_account;
}

export function getBlockLink(block: NanoBlockInfo) {
  if (!block.contents || typeof block.contents === "string") {
    return undefined;
  }

  return block.contents.link;
}

export function getBlockKind(block: Pick<NanoBlockInfo, "subtype" | "type">) {
  return block.subtype ?? block.type;
}

export function isNanoHash(value: string) {
  return /^[A-F0-9]{64}$/.test(value.trim().toUpperCase());
}

function normalizeBlockInfo(block: NanoBlockInfo) {
  if (typeof block.contents !== "string") {
    return block;
  }

  try {
    return {
      ...block,
      contents: JSON.parse(block.contents) as NanoBlockInfo["contents"],
    };
  } catch {
    return block;
  }
}
