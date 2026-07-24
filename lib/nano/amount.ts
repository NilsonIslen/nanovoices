export const RAW_PER_XNO = 10n ** 30n;
export const REQUIRED_PAYMENT_RAW = 2n * 10n ** 28n;

export function xnoToRaw(value: string) {
  const normalized = value.trim();

  if (!/^\d+(\.\d{1,30})?$/.test(normalized)) {
    throw new Error("Cantidad XNO inválida");
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  return (BigInt(whole) * RAW_PER_XNO + BigInt(fraction.padEnd(30, "0"))).toString();
}

export function rawToXno(raw: string) {
  if (!/^\d+$/.test(raw)) {
    throw new Error("Cantidad raw inválida");
  }

  const value = BigInt(raw);
  const whole = value / RAW_PER_XNO;
  const fraction = value % RAW_PER_XNO;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(30, "0").replace(/0+$/, "")}`;
}

export function compareRawDesc(a: string, b: string) {
  const left = BigInt(a);
  const right = BigInt(b);

  if (left === right) return 0;
  return left > right ? -1 : 1;
}

export function rawDifference(left: string, right: string) {
  const leftRaw = BigInt(left);
  const rightRaw = BigInt(right);

  return leftRaw > rightRaw ? leftRaw - rightRaw : rightRaw - leftRaw;
}
