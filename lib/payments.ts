import { PaymentStatus, type Prisma } from "@prisma/client";
import { REQUIRED_PAYMENT_RAW, requiredReceiverAddress } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  getBlockDestination,
  getBlockInfo,
  getBlockKind,
  getBlockLink,
  isNanoHash,
  type NanoBlockInfo,
} from "@/lib/nano/rpc";

export type ProcessPaymentResult =
  | { status: "processed"; requestId?: string }
  | { status: "ignored"; reason: PaymentStatus | "DUPLICATE" };

export async function processPaymentHash(blockHash: string): Promise<ProcessPaymentResult> {
  const normalizedHash = blockHash.trim().toUpperCase();
  const candidate = await resolveSendBlock(normalizedHash);
  const existing = await prisma.payment.findUnique({ where: { blockHash: candidate.hash } });

  if (existing) {
    return { status: "ignored", reason: "DUPLICATE" };
  }

  return processConfirmedBlock(candidate.hash, candidate.block);
}

export async function processConfirmedBlock(blockHash: string, block: NanoBlockInfo) {
  const receiverAddress = requiredReceiverAddress();
  const sourceAddress = block.block_account;
  const destinationAddress = getBlockDestination(block);
  const amountRaw = block.amount;
  const now = new Date();
  const confirmedAt = block.local_timestamp
    ? new Date(Number(block.local_timestamp) * 1000)
    : now;

  if (!sourceAddress || !destinationAddress || !amountRaw) {
    return saveUnassociated(blockHash, {
      sourceAddress: sourceAddress ?? "unknown",
      destinationAddress: destinationAddress ?? "unknown",
      amountRaw: amountRaw ?? "0",
      status: PaymentStatus.UNASSOCIATED,
      confirmedAt,
      notes: "Bloque incompleto",
    });
  }

  const issue = validatePaymentBlock(block, receiverAddress);

  if (issue === PaymentStatus.UNCONFIRMED) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt: null,
    });
  }

  if (issue === PaymentStatus.UNASSOCIATED) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
      notes: "El bloque confirmado no es de envío",
    });
  }

  if (issue === PaymentStatus.INVALID_DESTINATION) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
    });
  }

  if (issue === PaymentStatus.INVALID_AMOUNT) {
    return saveUnassociated(blockHash, {
      sourceAddress,
      destinationAddress,
      amountRaw,
      status: issue,
      confirmedAt,
    });
  }

  return saveUnassociated(blockHash, {
    sourceAddress,
    destinationAddress,
    amountRaw,
    confirmedAt,
    status: PaymentStatus.UNASSOCIATED,
    notes: "Pago confirmado pendiente de reclamar por una solicitud",
  });
}

export function validatePaymentBlock(block: NanoBlockInfo, receiverAddress: string) {
  if (block.confirmed !== "true") {
    return PaymentStatus.UNCONFIRMED;
  }

  if (getBlockKind(block) !== "send") {
    return PaymentStatus.UNASSOCIATED;
  }

  if (getBlockDestination(block) !== receiverAddress) {
    return PaymentStatus.INVALID_DESTINATION;
  }

  if (block.amount !== REQUIRED_PAYMENT_RAW) {
    return PaymentStatus.INVALID_AMOUNT;
  }

  return null;
}

export async function resolveSendBlock(blockHash: string) {
  const normalizedHash = blockHash.trim().toUpperCase();
  const block = await getBlockInfo(normalizedHash);
  const blockKind = getBlockKind(block);

  if (blockKind === "send") {
    return { hash: normalizedHash, block };
  }

  const linkedSendHash = getLinkedSendHash(block);

  if (linkedSendHash) {
    return { hash: linkedSendHash, block: await getBlockInfo(linkedSendHash) };
  }

  return { hash: normalizedHash, block };
}

export function getLinkedSendHash(block: NanoBlockInfo) {
  const blockKind = getBlockKind(block);
  const link = getBlockLink(block)?.trim().toUpperCase();

  if ((blockKind === "receive" || blockKind === "open") && link && isNanoHash(link)) {
    return link;
  }

  return null;
}

async function saveUnassociated(
  blockHash: string,
  data: Pick<
    Prisma.PaymentCreateInput,
    "sourceAddress" | "destinationAddress" | "amountRaw" | "status" | "confirmedAt" | "notes"
  >,
) {
  try {
    await prisma.payment.create({
      data: {
        blockHash,
        ...data,
      },
    });
  } catch {
    return { status: "ignored" as const, reason: "DUPLICATE" as const };
  }

  return { status: "ignored" as const, reason: data.status ?? PaymentStatus.UNASSOCIATED };
}
