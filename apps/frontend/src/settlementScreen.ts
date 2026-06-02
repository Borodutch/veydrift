import type { PlanetSummary } from "./walletFlow";

export type WalletState =
  | { kind: "loading" }
  | { kind: "no-wallet" }
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "wrong-network"; account: string; chainId: string }
  | { kind: "connected"; account: string };

export type PlanetState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "contract-unconfigured" }
  | { kind: "not-settled" }
  | { kind: "legacy-settled"; planet: PlanetSummary }
  | { kind: "pending"; label?: string; txHash?: string }
  | { kind: "success"; planet: PlanetSummary }
  | { kind: "already-settled"; planet: PlanetSummary }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

export type PreSettlementMode =
  | "resolving"
  | "no-wallet"
  | "connect"
  | "wrong-network"
  | "contract-unconfigured"
  | "settle"
  | "pending"
  | "error"
  | "settled";

export function isWalletSettlementResolving(wallet: WalletState, planet: PlanetState): boolean {
  return wallet.kind === "loading" || (wallet.kind === "connected" && (planet.kind === "idle" || planet.kind === "checking"));
}

export function preSettlementMode(wallet: WalletState, planet: PlanetState): PreSettlementMode {
  if (isWalletSettlementResolving(wallet, planet)) {
    return "resolving";
  }

  if (wallet.kind === "no-wallet") {
    return "no-wallet";
  }

  if (planet.kind === "rejected" || planet.kind === "error") {
    return "error";
  }

  if (wallet.kind === "disconnected" || wallet.kind === "connecting") {
    return "connect";
  }

  if (wallet.kind === "wrong-network") {
    return "wrong-network";
  }

  switch (planet.kind) {
    case "contract-unconfigured":
      return "contract-unconfigured";
    case "not-settled":
    case "legacy-settled":
      return "settle";
    case "pending":
      return "pending";
    case "success":
    case "already-settled":
      return "settled";
    default:
      return "resolving";
  }
}
