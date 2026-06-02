import { getAddress, verifyMessage, type Address as ViemAddress } from "viem";
import type { Address } from "./evm";

export const playerDisplayNameMaxLength = 32;

export type PlayerProfile = {
  wallet: Address;
  displayName: string | null;
  fallbackName: string;
  updatedAt: string | null;
};

export type PlayerDisplayNameValidation =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export function playerDisplayNameMessage(wallet: Address, displayName: string): string {
  return [
    "Veydrift player display name",
    `Wallet: ${wallet.toLowerCase()}`,
    `Display name: ${displayName}`,
    "Only sign this message if you want this public name shown in Veydrift."
  ].join("\n");
}

export function validatePlayerDisplayName(value: unknown): PlayerDisplayNameValidation {
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a display name." };
  }

  const displayName = value.trim().replace(/ {2,}/g, " ");
  if (!displayName) {
    return { ok: false, error: "Enter a display name." };
  }

  if (Array.from(displayName).length > playerDisplayNameMaxLength) {
    return { ok: false, error: `Display names can be at most ${playerDisplayNameMaxLength} characters.` };
  }

  if (/[\p{Cc}\p{Cf}]/u.test(displayName)) {
    return { ok: false, error: "Display names cannot include control or formatting characters." };
  }

  return { ok: true, displayName };
}

export async function verifyPlayerDisplayNameSignature({
  displayName,
  signature,
  wallet
}: {
  displayName: string;
  signature: unknown;
  wallet: Address;
}): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return false;
  }

  try {
    return await verifyMessage({
      address: getAddress(wallet) as ViemAddress,
      message: playerDisplayNameMessage(wallet, displayName),
      signature: signature as `0x${string}`
    });
  } catch {
    return false;
  }
}

export function playerFallbackName(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}
