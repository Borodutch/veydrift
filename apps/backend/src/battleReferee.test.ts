import { describe, expect, test } from "bun:test";
import { keccak256, stringToHex, type Hex } from "viem";

import {
  BattleRefereeWorker,
  BattleReportStore,
  leafHash,
  maxLeavesPerTransaction,
  refereeBattle,
  refereeCatalogHash,
  refereeRulesHash,
  RefereePhase,
  SettlementPhase,
  tailHash,
  type RefereeBattleStatus,
  type RefereeChain,
  type RefereeLeaf,
  type RefereeResult,
  type RefereeRow
} from "./battleReferee";

const binding = keccak256(stringToHex("binding"));
const attacker = "0x00000000000000000000000000000000000000a1" as Hex;
const defender = "0x00000000000000000000000000000000000000d1" as Hex;
const version = { version: 3, rules: refereeRulesHash, catalog: refereeCatalogHash };
const tech = { weapons: 0, shielding: 0, armor: 0 };
// Row order mirrors the contract journal: resident lanes (source 0), then the attacking leader.
const rows: RefereeRow[] = [
  { source: 0n, owner: defender, count: 40, side: 1, unit: 1, ...tech },
  { source: 0n, owner: defender, count: 5, side: 1, unit: 16, ...tech },
  { source: 7n, owner: attacker, count: 6, side: 0, unit: 6, ...tech }
];
const input = { chainId: 8453, game: "0x00000000000000000000000000000000000000ee" as Hex, battleId: 7n, binding, seed: 12345n, version, rows };

describe("battle referee", () => {
  test("leaf and tail hashes match the Solidity vector", () => {
    // packages/contracts/test/VeydriftRefereeSettlement.t.sol testResultLeafHashVector
    const leaf: RefereeLeaf = {
      owner: "0x0000000000000000000000000000000000000def", source: 7n, side: 1, unit: 17,
      enrolledCount: 10, lost: 3, survivors: 7, next: keccak256(stringToHex("next"))
    };
    expect(leafHash(binding, 2n, leaf)).toBe("0x74a7aa472e96d6d0b2e3136d38f739f3e54e9a37dfe45f10089f42265d19f9e6");
    expect(tailHash(binding, 3n)).toBe("0x47956b270bcb3583adb67288e24e983005102d1f85339042bb649e8e4d9b298f");
  });

  test("replay is deterministic, row-ordered and self-consistent", async () => {
    const first = await refereeBattle(input);
    const second = await refereeBattle(input);
    expect(second).toEqual(first);
    expect(first.reportHash).toBe(keccak256(stringToHex(first.report)));
    expect(first.leaves.map((leaf) => [leaf.source, leaf.unit])).toEqual(rows.map((row) => [row.source, row.unit]));
    let next = tailHash(binding, BigInt(rows.length));
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const leaf = first.leaves[index]!;
      expect(leaf.next).toBe(next);
      expect(leaf.lost + leaf.survivors).toBe(leaf.enrolledCount);
      next = leafHash(binding, BigInt(index), leaf);
    }
    expect(first.root).toBe(next);
    const report = JSON.parse(first.report);
    expect(report.rounds.length).toBe(first.rounds);
    expect(first.rounds).toBeGreaterThan(0);
    expect(first.rounds).toBeLessThanOrEqual(6);
    expect(first.totals[0]).toBe(BigInt(first.leaves.filter((l) => l.side === 0).reduce((n, l) => n + l.survivors, 0)));
    expect(first.totals[1]).toBe(BigInt(first.leaves.filter((l) => l.side === 1).reduce((n, l) => n + l.survivors, 0)));
    expect(["attacker", "defender", "draw"]).toContain(report.outcome);
    // Round summaries end on the declared totals and their ship losses add up to the leaf losses.
    expect(first.summary.length).toBe(first.rounds);
    expect(first.summary.at(-1)!.attackerUnits).toBe(first.totals[0]);
    expect(first.summary.at(-1)!.defenderUnits).toBe(first.totals[1]);
    const cruiserLost = BigInt(first.leaves[2]!.lost), fighterLost = BigInt(first.leaves[0]!.lost);
    expect(first.summary.reduce((n, r) => n + r.attackerLossMetal, 0n)).toBe(cruiserLost * 20_000n);
    expect(first.summary.reduce((n, r) => n + r.defenderLossCrystal, 0n)).toBe(fighterLost * 1_000n);
    const changed = await refereeBattle({ ...input, seed: 54321n });
    expect(changed.reportHash).not.toBe(first.reportHash);
  });

  test("a frozen battle with foreign rules or catalog is never refereed", async () => {
    await expect(refereeBattle({ ...input, version: { ...version, rules: binding } })).rejects.toThrow(/unsupported/);
    await expect(refereeBattle({ ...input, version: { ...version, catalog: binding } })).rejects.toThrow(/unsupported/);
  });

  test("one-sided rosters resolve with zero rounds and no losses", async () => {
    const result = await refereeBattle({ ...input, rows: [rows[2]!] });
    expect(result.rounds).toBe(0);
    expect(result.leaves[0]!.lost).toBe(0);
    expect(result.totals).toEqual([6n, 0n]);
  });
});

class FakeChain implements RefereeChain {
  readonly chainId = 8453;
  readonly game = input.game;
  head = 100n;
  sealed = new Map<bigint, bigint>(); // battle -> block
  statuses = new Map<bigint, RefereeBattleStatus>();
  revealed = false;
  settlement = { phase: SettlementPhase.Unaccepted as number, nextIndex: 0 };
  root: Hex = "0x";
  calls: string[] = [];
  battleRows: RefereeRow[] = rows;

  async latestBlock() { return this.head; }
  async sealedBattles(from: bigint, to: bigint) {
    this.calls.push(`logs:${from}-${to}`);
    return [...this.sealed].filter(([, block]) => block >= from && block <= to).map(([id]) => id);
  }
  async status(id: bigint) { return this.statuses.get(id)!; }
  async rows() { return this.battleRows; }
  async randomnessRevealed() { return this.revealed; }
  async binding() { return binding; }
  async progress() { return { ...this.settlement }; }
  async acceptedRoot() { return this.root; }
  async advance(id: bigint) {
    this.calls.push(`advance:${id}`);
    this.statuses.get(id)!.phase = RefereePhase.AwaitingResult;
    return "0x1" as Hex;
  }
  async submit(id: bigint, result: RefereeResult) {
    this.calls.push(`submit:${id}`);
    this.root = result.root;
    this.settlement = { phase: SettlementPhase.Applying, nextIndex: 0 };
    return "0x2" as Hex;
  }
  async apply(id: bigint, nextIndex: number, leaves: RefereeLeaf[]) {
    this.calls.push(`apply:${id}:${nextIndex}:${leaves.length}`);
    this.settlement.nextIndex = nextIndex + leaves.length;
    if (this.settlement.nextIndex === this.battleRows.length) this.settlement = { phase: SettlementPhase.Economics, nextIndex: this.battleRows.length };
    return "0x3" as Hex;
  }
}

function status(phase: number): RefereeBattleStatus {
  return { version, phase, seed: 999n, rowCount: rows.length, engine: "0x00000000000000000000000000000000000000aa", requestId: 5n };
}

describe("battle referee worker", () => {
  test("drives one battle from sealed roster to economics exactly once", async () => {
    const chain = new FakeChain();
    const store = new BattleReportStore(":memory:");
    const worker = new BattleRefereeWorker(chain, store, { fromBlock: 90n, logChunkSpan: 4n });
    chain.sealed.set(7n, 95n);
    chain.statuses.set(7n, status(RefereePhase.AwaitingRandomness));

    await worker.tick();
    expect(chain.calls).toEqual(["logs:90-93", "logs:94-97", "logs:98-100"]);
    expect(store.pending()).toEqual([7n]);

    chain.calls = [];
    chain.revealed = true;
    await worker.tick();
    await worker.tick();
    await worker.tick();
    expect(chain.calls).toEqual(["advance:7", "submit:7", "apply:7:0:3"]);
    const saved = store.reportForBattle("7");
    expect(saved).not.toBeNull();
    expect(store.report(saved!.reportHash)).toBe(saved!.report);

    chain.calls = [];
    await worker.tick();
    expect(store.pending()).toEqual([]);
    await worker.tick();
    expect(chain.calls).toEqual([]);
    expect(worker.failures.size).toBe(0);
  });

  test("applies large rosters in bounded batches from the onchain cursor", async () => {
    const chain = new FakeChain();
    chain.battleRows = Array.from({ length: 70 }, (_, index) => ({
      source: BigInt(index + 1), owner: attacker, count: 1, side: index === 0 ? 1 : 0, unit: 1, ...tech
    }));
    chain.statuses.set(8n, { ...status(RefereePhase.AwaitingResult), rowCount: 70 });
    const store = new BattleReportStore(":memory:");
    const worker = new BattleRefereeWorker(chain, store, { fromBlock: 101n });
    store.saveDiscovery(100n, [8n]);
    for (let i = 0; i < 6; i += 1) await worker.tick();
    expect(chain.calls).toEqual(["submit:8", "apply:8:0:32", "apply:8:32:32", "apply:8:64:6"]);
    expect(maxLeavesPerTransaction).toBe(32);
    expect(store.pending()).toEqual([]);
  });

  test("an onchain root that differs from the local replay halts that battle", async () => {
    const chain = new FakeChain();
    chain.statuses.set(9n, status(RefereePhase.AwaitingResult));
    chain.settlement = { phase: SettlementPhase.Applying, nextIndex: 0 };
    chain.root = binding;
    const store = new BattleReportStore(":memory:");
    const worker = new BattleRefereeWorker(chain, store, { fromBlock: 101n });
    store.saveDiscovery(100n, [9n]);
    await worker.tick();
    expect(chain.calls).toEqual([]);
    expect(worker.failures.get("9")).toMatch(/differs from local replay/);
    expect(store.pending()).toEqual([9n]);
  });

  test("bypassed and legacy battles leave the queue without transactions", async () => {
    const chain = new FakeChain();
    chain.statuses.set(10n, status(RefereePhase.Bypassed));
    chain.statuses.set(11n, status(RefereePhase.Legacy));
    const store = new BattleReportStore(":memory:");
    store.saveDiscovery(100n, [10n, 11n]);
    await new BattleRefereeWorker(chain, store).tick();
    expect(store.pending()).toEqual([]);
    expect(chain.calls).toEqual([]);
  });
});
