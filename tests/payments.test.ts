import { PaymentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { REQUIRED_PAYMENT_RAW, rawToXno } from "@/lib/nano/amount";
import { getLinkedSendHash, validatePaymentBlock } from "@/lib/payments";
import { getBlockDestination } from "@/lib/nano/rpc";
import type { NanoBlockInfo } from "@/lib/nano/rpc";

const receiver = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";
const sendHash = "A".repeat(64);

function block(overrides: Partial<NanoBlockInfo> = {}): NanoBlockInfo {
  return {
    block_account: "nano_3t6k35jci399kqaurgxyah4r4eo6zodc8hj9itw14wc5x1q69bk7h6mf6bdt",
    amount: REQUIRED_PAYMENT_RAW.toString(),
    confirmed: "true",
    subtype: "send",
    contents: {
      link_as_account: receiver,
    },
    ...overrides,
  };
}

describe("lógica crítica de pagos Nano", () => {
  it("representa 0,02 XNO como 2 * 10^28 raw sin decimales", () => {
    expect(REQUIRED_PAYMENT_RAW.toString()).toBe("20000000000000000000000000000");
    expect(rawToXno(REQUIRED_PAYMENT_RAW.toString())).toBe("0.02");
  });

  it("acepta solo bloques send confirmados hacia el receptor con importe exacto", () => {
    expect(validatePaymentBlock(block(), receiver)).toBeNull();
  });

  it("rechaza importes distintos", () => {
    expect(validatePaymentBlock(block({ amount: "100" }), receiver)).toBe(
      PaymentStatus.INVALID_AMOUNT,
    );
  });

  it("acepta importes únicos dentro de la tolerancia del pago base", () => {
    const uniqueAmount = (REQUIRED_PAYMENT_RAW + 999_999n * 10n ** 18n).toString();

    expect(validatePaymentBlock(block({ amount: uniqueAmount }), receiver)).toBeNull();
  });

  it("rechaza importes por encima de la tolerancia", () => {
    const tooHighAmount = (REQUIRED_PAYMENT_RAW + 1_000_001n * 10n ** 18n).toString();

    expect(validatePaymentBlock(block({ amount: tooHighAmount }), receiver)).toBe(
      PaymentStatus.INVALID_AMOUNT,
    );
  });

  it("rechaza destinos distintos", () => {
    expect(validatePaymentBlock(block(), "nano_1111111111111111111111111111111111111111111111111117353trpda")).toBe(
      PaymentStatus.INVALID_DESTINATION,
    );
  });

  it("rechaza bloques sin confirmar", () => {
    expect(validatePaymentBlock(block({ confirmed: "false" }), receiver)).toBe(
      PaymentStatus.UNCONFIRMED,
    );
  });

  it("resuelve un bloque receive hacia el hash send original", () => {
    expect(
      getLinkedSendHash({
        confirmed: "true",
        subtype: "receive",
        contents: { link: sendHash },
      }),
    ).toBe(sendHash);
  });

  it("no trata un link de send como hash de pago original", () => {
    expect(
      getLinkedSendHash({
        confirmed: "true",
        subtype: "send",
        contents: { link: "not-a-hash", link_as_account: receiver },
      }),
    ).toBeNull();
  });

  it("lee el destino desde variantes comunes de block_info", () => {
    expect(getBlockDestination(block({ contents: { link_as_account: receiver } }))).toBe(receiver);
    expect(getBlockDestination(block({ contents: { linked_account: receiver } }))).toBe(receiver);
    expect(getBlockDestination(block({ link_as_account: receiver, contents: { link: "0".repeat(64) } }))).toBe(receiver);
    expect(getBlockDestination(block({ linked_account: receiver, contents: { link: "0".repeat(64) } }))).toBe(receiver);
  });
});
