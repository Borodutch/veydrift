import { describe, expect, test } from "bun:test";
import { indexedSettlementState } from "../src/FirstPlanetSettlementApp";
import { preSettlementMode, type PlanetState, type WalletState } from "../src/settlementScreen";

const connected = {
  account: "0x1111111111111111111111111111111111111111",
  kind: "connected",
} satisfies WalletState;

describe("settlement screen mode", () => {
  test("keeps connected wallets in neutral loading until settlement state is known", () => {
    expect(preSettlementMode(connected, { kind: "idle" })).toBe("resolving");
    expect(preSettlementMode(connected, { kind: "checking" })).toBe("resolving");
  });

  test("shows only the core pre-settlement actions after state is known", () => {
    expect(preSettlementMode({ kind: "disconnected" }, { kind: "idle" })).toBe("connect");
    expect(preSettlementMode(connected, { kind: "not-settled" })).toBe("settle");
  });

  test("preserves minimal network, transaction, and error states", () => {
    const pending = { kind: "pending", txHash: "0xabc" } satisfies PlanetState;

    expect(preSettlementMode({ account: connected.account, chainId: "0x1", kind: "wrong-network" }, { kind: "idle" })).toBe("wrong-network");
    expect(preSettlementMode(connected, pending)).toBe("pending");
    expect(preSettlementMode(connected, { kind: "error", message: "RPC unavailable" })).toBe("error");
  });

  test("maps indexed API settlement state to playable state without wallet eth_call reads", () => {
    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: true,
      homePlanetId: "7",
      planet: {
        planetId: "7",
        owner: connected.account,
        name: "Prime",
        galaxy: 2,
        system: 44,
        position: 9,
        fields: 211,
        temperature: -8,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "1770000000",
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800",
        },
      },
    })).toEqual({
      kind: "settled",
      planet: {
        label: "Prime",
        coordinates: "2:44:9",
        fields: "211",
        rarity: "Genesis settlement",
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800",
        },
        settledAt: "2026-02-02T02:40:00.000Z",
        source: "chain",
        temperature: "-8",
      },
    });

    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: false,
      homePlanetId: null,
      planet: null,
    })).toEqual({ kind: "not-settled" });
  });
});
