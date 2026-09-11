import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { CachedChainReader } from "./cachedReader";
import type { Address, AttackProtectionStatus, ChainReader } from "./evm";
afterEach(() => setSystemTime());

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


  test("an expired failed request cannot evict its replacement", async () => {
    setSystemTime(new Date(1000));
    let reject!: (error: Error) => void;
    let calls = 0;
    const result = { allowed: true } as AttackProtectionStatus;
    const cached = new CachedChainReader({
      getAttackProtectionStatus: () => ++calls === 1
        ? new Promise<AttackProtectionStatus>((_resolve, fail) => { reject = fail; })
        : Promise.resolve(result),
    });
    const first = cached.getAttackProtectionStatus(wallet, 7n);
    const caught = first.catch(() => {});
    await Promise.resolve();
    setSystemTime(new Date(4000));
    const replacement = cached.getAttackProtectionStatus(wallet, 7n);
    reject(new Error("Old request failed"));
    await caught;
    expect(await replacement).toBe(result);
    expect(await cached.getAttackProtectionStatus(wallet, 7n)).toBe(result);
    expect(calls).toBe(2);
  });

  test("bounds retained targets and expires old entries", async () => {
    setSystemTime(new Date(1000));
    let calls = 0;
    const cached = new CachedChainReader({
      getAttackProtectionStatus: async () => { calls++; return { allowed: true } as AttackProtectionStatus; },
    });
    for (let target = 0; target < 513; target++) await cached.getAttackProtectionStatus(wallet, BigInt(target));
    await cached.getAttackProtectionStatus(wallet, 0n);
    expect(calls).toBe(514);
    setSystemTime(new Date(4000));
    await cached.getAttackProtectionStatus(wallet, 0n);
    expect(calls).toBe(515);
    expect(cached).not.toHaveProperty("getWalletSettlement");
  });
});
