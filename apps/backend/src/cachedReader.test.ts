import { describe, expect, test } from "bun:test";
import { CachedChainReader } from "./cachedReader";
import type { Address, AllianceIdentity, ChainReader } from "./evm";
import type { HighscoreEntry } from "./highscores";

const wallet = "0x2222222222222222222222222222222222222222" as Address;

describe("CachedChainReader", () => {
  test("keeps planet and moon attack-protection reads in separate cache entries", async () => {
    const targetPlanetId = 7n;
    const bodyCalls: boolean[] = [];
    const inner = {
      async getAttackProtectionStatus(_wallet: Address, _targetPlanetId: bigint, targetIsMoon = false) {
        bodyCalls.push(targetIsMoon);
        return {
          wallet,
          targetPlanetId: targetPlanetId.toString(),
          allowed: true,
          blockedReason: "none" as const,
          blockedReasonLabel: null,
          relation: "peer" as const,
          defenderHonorStatus: "neutral" as const,
          plunderBps: 5000,
          defenderInactive: false
        };
      }
    } as unknown as ChainReader;
    const cached = new CachedChainReader(inner);

    await cached.getAttackProtectionStatus(wallet, targetPlanetId);
    await cached.getAttackProtectionStatus(wallet, targetPlanetId);
    await cached.getAttackProtectionStatus(wallet, targetPlanetId, true);
    await cached.getAttackProtectionStatus(wallet, targetPlanetId, true);

    expect(bodyCalls).toEqual([false, true]);
  });

  test("preserves optional highscore support from the wrapped reader", async () => {
    let calls = 0;
    const entry: HighscoreEntry = {
      wallet,
      homePlanetId: "7",
      planetCount: 1,
      totalUserScore: "1000",
      score: {
        total: "15",
        economy: "0",
        research: "1",
        researchLevels: "1",
        military: "14",
        fleet: "8",
        fleetCount: "2",
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

  test("preserves optional alliance intel support from the wrapped reader", async () => {
    const otherWallet = "0x3333333333333333333333333333333333333333" as Address;
    const alliance: AllianceIdentity = {
      allianceId: "3",
      name: "Veydrift Union",
      tag: "VDFT"
    };
    let calls = 0;
    const inner = {
      async getAllianceIntelForPlayers(wallets: readonly Address[]) {
        calls += 1;
        expect(wallets).toEqual([wallet, otherWallet]);
        return new Map<Address, AllianceIdentity>([
          [wallet, alliance],
          [otherWallet, alliance]
        ]);
      }
    } as unknown as ChainReader;

    const cached = new CachedChainReader(inner);

    await expect(cached.getAllianceIntelForPlayers([wallet, otherWallet, wallet])).resolves.toEqual(new Map<Address, AllianceIdentity>([
      [wallet, alliance],
      [otherWallet, alliance]
    ]));
    await expect(cached.getAllianceIntelForPlayers([otherWallet, wallet])).resolves.toEqual(new Map<Address, AllianceIdentity>([
      [wallet, alliance],
      [otherWallet, alliance]
    ]));
    expect(calls).toBe(1);
  });
});
