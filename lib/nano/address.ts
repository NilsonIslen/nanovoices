import { blake2b } from "blakejs";

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const ADDRESS_PATTERN = /^(nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

export function normalizeNanoAddress(address: string) {
  return address.trim().replace(/^xrb_/, "nano_");
}

export function isValidNanoAddress(address: string) {
  const normalized = normalizeNanoAddress(address);

  if (!ADDRESS_PATTERN.test(normalized)) {
    return false;
  }

  try {
    const payload = normalized.slice("nano_".length);
    const publicKeyPart = payload.slice(0, 52);
    const checksumPart = payload.slice(52);
    const publicKey = decodeNanoBase32(publicKeyPart, 32);
    const checksum = decodeNanoBase32(checksumPart, 5);
    const digest = blake2b(publicKey, undefined, 5).reverse();

    return Buffer.from(checksum).equals(Buffer.from(digest));
  } catch {
    return false;
  }
}

function decodeNanoBase32(value: string, expectedBytes: number) {
  let bits = "";

  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Caracter Nano inválido");
    }
    bits += index.toString(2).padStart(5, "0");
  }

  const padding = bits.length - expectedBytes * 8;
  const usable = bits.slice(padding);
  const bytes = [];

  for (let index = 0; index < usable.length; index += 8) {
    bytes.push(Number.parseInt(usable.slice(index, index + 8), 2));
  }

  return Uint8Array.from(bytes);
}
