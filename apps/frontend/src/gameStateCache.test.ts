import { describe, expect, test } from "bun:test";
import {
  buildGameStateSnapshot,
  clearGameStateSnapshot,
  GAME_STATE_SNAPSHOT_VERSION,
  GAME_STATE_STORAGE_KEY,
  hydrateGameStateForAccount,
  readGameStateSnapshot,
  writeGameStateSnapshot,
  type GameStateSnapshot,
} from "./gameStateCache";
import type { WalletSettlementResponse } from "./walletFlow";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

const settlement = {
  homePlanetId: "planet-1",
  planet: { planetId: "planet-1", galaxy: 1, system: 2, position: 3 },
} as unknown as WalletSettlementResponse;

describe("buildGameStateSnapshot", () => {
  test("returns null without an account", () => {
    expect(
      buildGameStateSnapshot({ account: undefined, savedAtMs: 1, state: { onChainSettlement: settlement } }),
    ).toBeNull();
  });

  test("returns null without a settlement (nothing worth persisting)", () => {
    expect(buildGameStateSnapshot({ account: "0xABC", savedAtMs: 1, state: {} })).toBeNull();
  });

  test("normalizes the account and stamps version + savedAt", () => {
    const snapshot = buildGameStateSnapshot({
      account: "0xAbCdEf",
      savedAtMs: 123,
      state: { onChainSettlement: settlement, selectedPlanetId: "planet-1" },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.account).toBe("0xabcdef");
    expect(snapshot?.version).toBe(GAME_STATE_SNAPSHOT_VERSION);
    expect(snapshot?.savedAtMs).toBe(123);
    expect(snapshot?.selectedPlanetId).toBe("planet-1");
  });

  test("omits undefined slices but keeps explicit null page state", () => {
    const snapshot = buildGameStateSnapshot({
      account: "0xabc",
      savedAtMs: 1,
      state: { onChainSettlement: settlement, researchState: null },
    });
    expect(snapshot).not.toBeNull();
    expect("playerProfile" in (snapshot as GameStateSnapshot)).toBe(false);
    expect(snapshot?.researchState).toBeNull();
  });
});

describe("hydrateGameStateForAccount", () => {
  const snapshot: GameStateSnapshot = {
    version: GAME_STATE_SNAPSHOT_VERSION,
    account: "0xabc",
    savedAtMs: 1,
    onChainSettlement: settlement,
    selectedPlanetId: "planet-1",
  };

  test("returns undefined for a missing snapshot", () => {
    expect(hydrateGameStateForAccount(undefined, "0xabc")).toBeUndefined();
  });

  test("returns undefined on a version mismatch", () => {
    expect(
      hydrateGameStateForAccount({ ...snapshot, version: GAME_STATE_SNAPSHOT_VERSION + 1 }, "0xabc"),
    ).toBeUndefined();
  });

  test("hydrates when the account matches (case-insensitive)", () => {
    const hydrated = hydrateGameStateForAccount(snapshot, "0xABC");
    expect(hydrated?.onChainSettlement).toBe(settlement);
    expect(hydrated?.selectedPlanetId).toBe("planet-1");
  });

  test("refuses to hydrate another wallet's snapshot", () => {
    expect(hydrateGameStateForAccount(snapshot, "0xdifferent")).toBeUndefined();
  });

  test("optimistically hydrates when the account is unknown at mount", () => {
    const hydrated = hydrateGameStateForAccount(snapshot, undefined);
    expect(hydrated?.onChainSettlement).toBe(settlement);
  });
});

describe("storage round-trip", () => {
  test("write then read returns the same snapshot", () => {
    const storage = fakeStorage();
    const snapshot = buildGameStateSnapshot({
      account: "0xabc",
      savedAtMs: 7,
      state: { onChainSettlement: settlement },
    });
    expect(snapshot).not.toBeNull();
    writeGameStateSnapshot(snapshot as GameStateSnapshot, storage);
    const read = readGameStateSnapshot(storage);
    expect(read?.account).toBe("0xabc");
    expect(read?.savedAtMs).toBe(7);
    expect(read?.onChainSettlement).toEqual(settlement);
  });

  test("read returns undefined for a stale stored version", () => {
    const storage = fakeStorage({
      [GAME_STATE_STORAGE_KEY]: JSON.stringify({ version: 0, account: "0xabc", savedAtMs: 1 }),
    });
    expect(readGameStateSnapshot(storage)).toBeUndefined();
  });

  test("read returns undefined for corrupt JSON", () => {
    const storage = fakeStorage({ [GAME_STATE_STORAGE_KEY]: "{not json" });
    expect(readGameStateSnapshot(storage)).toBeUndefined();
  });

  test("read returns undefined when no storage is available", () => {
    expect(readGameStateSnapshot(undefined)).toBeUndefined();
  });

  test("clear removes the stored snapshot", () => {
    const storage = fakeStorage({
      [GAME_STATE_STORAGE_KEY]: JSON.stringify({
        version: GAME_STATE_SNAPSHOT_VERSION,
        account: "0xabc",
        savedAtMs: 1,
        onChainSettlement: settlement,
      }),
    });
    clearGameStateSnapshot(storage);
    expect(storage.map.has(GAME_STATE_STORAGE_KEY)).toBe(false);
  });

  test("write is a no-op without storage (does not throw)", () => {
    const snapshot = buildGameStateSnapshot({
      account: "0xabc",
      savedAtMs: 1,
      state: { onChainSettlement: settlement },
    });
    expect(() => writeGameStateSnapshot(snapshot as GameStateSnapshot, undefined)).not.toThrow();
  });
});
