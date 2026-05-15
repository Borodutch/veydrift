import { describe, expect, test } from "bun:test";
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
});
