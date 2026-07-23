export const REQUIRED_PAYMENT_RAW =
  process.env.REQUIRED_PAYMENT_RAW ?? "20000000000000000000000000000";

export const REQUIRED_PAYMENT_NANO = "0.02";

export const REQUEST_EXPIRATION_MINUTES = Number(
  process.env.REQUEST_EXPIRATION_MINUTES ?? "15",
);

export const BALANCE_REFRESH_SECONDS = Number(process.env.BALANCE_REFRESH_SECONDS ?? "300");

export const PAYMENT_RECOVERY_INTERVAL_SECONDS = Number(
  process.env.PAYMENT_RECOVERY_INTERVAL_SECONDS ?? "45",
);

export const PAYMENT_RECOVERY_HISTORY_COUNT = Number(
  process.env.PAYMENT_RECOVERY_HISTORY_COUNT ?? "200",
);

export function requiredReceiverAddress() {
  const address = process.env.NANOVOICES_RECEIVER_ADDRESS;

  if (!address) {
    throw new Error("Falta NANOVOICES_RECEIVER_ADDRESS");
  }

  return address;
}

export function publicAppUrl() {
  return process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function explorerAccountUrl(address: string) {
  const template =
    process.env.NANO_EXPLORER_ACCOUNT_URL ?? "https://nanobrowse.com/account/{address}";

  return template.replace("{address}", encodeURIComponent(address));
}
