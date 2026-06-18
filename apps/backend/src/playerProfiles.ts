import { getAddress, verifyMessage, type Address as ViemAddress } from "viem";
import type { Address } from "./evm";

export const playerDisplayNameMaxLength = 32;
export const playerDescriptionMaxLength = 500;

export type PlayerProfile = {
  wallet: Address;
  displayName: string | null;
  description: string | null;
  fallbackName: string;
  updatedAt: string | null;
};

export type PlayerDisplayNameValidation =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export type PlayerDescriptionValidation =
  | { ok: true; description: string | null }
  | { ok: false; error: string };

export function playerDisplayNameMessage(wallet: Address, displayName: string): string {
  return [
    "Veydrift player display name",
    `Wallet: ${wallet.toLowerCase()}`,
    `Display name: ${displayName}`,
    "Only sign this message if you want this public name shown in Veydrift."
  ].join("\n");
}

export function playerProfileMessage(wallet: Address, displayName: string, description: string | null): string {
  return [
    "Veydrift player profile",
    `Wallet: ${wallet.toLowerCase()}`,
    `Display name: ${displayName}`,
    `Description: ${description ?? ""}`,
    "Only sign this message if you want this public profile shown in Veydrift."
  ].join("\n");
}

export type WatchedPlanetAction = "watch" | "unwatch";

export function watchedPlanetMessage(wallet: Address, action: WatchedPlanetAction, planetId: string): string {
  return [
    "Veydrift watched planet",
    `Wallet: ${wallet.toLowerCase()}`,
    `Action: ${action}`,
    `Planet ID: ${planetId}`,
    "Only sign this message if you want to update your Veydrift watched planets."
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

export function validatePlayerDescription(value: unknown): PlayerDescriptionValidation {
  if (value === undefined || value === null) {
    return { ok: true, description: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a valid description." };
  }

  const description = value.replace(/\r\n?/g, "\n").trim();
  if (!description) {
    return { ok: true, description: null };
  }

  if (Array.from(description).length > playerDescriptionMaxLength) {
    return { ok: false, error: `Descriptions can be at most ${playerDescriptionMaxLength} characters.` };
  }

  if (/[\p{Cc}\p{Cf}]/u.test(description.replace(/\n/g, ""))) {
    return { ok: false, error: "Descriptions cannot include control or formatting characters." };
  }

  return { ok: true, description };
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

export async function verifyPlayerProfileSignature({
  description,
  displayName,
  signature,
  wallet
}: {
  description: string | null;
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
      message: playerProfileMessage(wallet, displayName, description),
      signature: signature as `0x${string}`
    });
  } catch {
    return false;
  }
}

export async function verifyWatchedPlanetSignature({
  action,
  planetId,
  signature,
  wallet
}: {
  action: WatchedPlanetAction;
  planetId: string;
  signature: unknown;
  wallet: Address;
}): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return false;
  }

  try {
    return await verifyMessage({
      address: getAddress(wallet) as ViemAddress,
      message: watchedPlanetMessage(wallet, action, planetId),
      signature: signature as `0x${string}`
    });
  } catch {
    return false;
  }
}

export function playerFallbackName(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}
