import { describe, expect, test } from "bun:test";
import { CachedChainReader } from "./cachedReader";
import type { Address, ChainReader } from "./evm";
import type { HighscoreEntry } from "./highscores";

const wallet = "0x2222222222222222222222222222222222222222" as Address;

describe("CachedChainReader", () => {
  test("preserves optional highscore support from the wrapped reader", async () => {
    let calls = 0;
    const entry: HighscoreEntry = {
      wallet,
      homePlanetId: "7",
      planetCount: 1,
      score: {
        total: "15",
        economy: "0",
        research: "1",
        fleet: "8",
        defense: "6"
      }
    };
    const inner = {
      async getHighscoreForWallet() {
        calls += 1;
        return entry;
      }
    } as unknown as ChainReader;

    const cached = new CachedChainReader(inner);

    await expect(cached.getHighscoreForWallet(wallet, ["7"])).resolves.toEqual(entry);
    await expect(cached.getHighscoreForWallet(wallet, ["7"])).resolves.toEqual(entry);
    expect(calls).toBe(1);
  });
});
