import { describe, expect, test } from "bun:test";
import {
  playerActivityLastSeenKey,
  readPlayerActivityLastSeen,
  writePlayerActivityLastSeen,
} from "./playerActivityStorage";

describe("player activity last-seen storage", () => {
  test("scopes timestamps by chain and normalized wallet", () => {
    expect(playerActivityLastSeenKey(8453, " 0xAbC ")).toBe(
      "veydrift:player-activity:last-seen:v1:8453:0xabc"
    );
  });

  test("round-trips a whole-second timestamp and ignores invalid state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    writePlayerActivityLastSeen(storage, 8453, "0xabc", 1234.9);
    expect(readPlayerActivityLastSeen(storage, 8453, "0xABC")).toBe(1234);
    values.set(playerActivityLastSeenKey(8453, "0xabc"), "not-a-timestamp");
    expect(readPlayerActivityLastSeen(storage, 8453, "0xabc")).toBeNull();
  });
});
