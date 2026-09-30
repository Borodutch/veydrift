import { describe, expect, test } from "bun:test";
import { SettlementIndexer } from "./indexer";
import { attachAttackGroupParticipants, combatStageAdvancedTopic, decodeBattleReportLogs, type RpcLog } from "./evm";
import { decodeStagedBattleEvidence, stagedReportTopics as topics } from "./stagedBattleReport";
const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const owner = "0x" + "a".repeat(40);
const event = (topic: string, id: number, values: number[], tx: number, ownerIndexed = true): RpcLog => ({
  address: "0x" + "1".repeat(40), blockNumber: "0x" + tx.toString(16), transactionHash: "0x" + word(tx), logIndex: "0x0",
  topics: [topic, "0x" + word(77), ...(id < 0 ? [] : ["0x" + word(id)]), ...(ownerIndexed ? ["0x" + owner.slice(2).padStart(64, "0")] : [])],
  data: "0x" + values.map(word).join("")
});
const final = (): RpcLog => ({ ...event("0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b", -1, [1, 2, 123, 999, 0, 0], 20, false), topics: ["0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b", "0x" + word(77), "0x" + owner.slice(2).padStart(64, "0"), "0x" + word(9)] });
const fixture = () => [
  event(topics.snapshot, 77, [0, 1, 10], 1), event(topics.snapshot, 78, [0, 0, 5], 2),
  event(topics.snapshot, 0, [1, 16, 10], 3), event(topics.snapshot, 99, [1, 1, 7], 4),
  event(topics.losses, 77, [0, 1, 2], 5), event(topics.losses, 77, [0, 1, 3], 6),
  event(topics.losses, 99, [1, 1, 7], 7), event(topics.losses, 0, [1, 16, 8], 8),
  event(topics.repair, -1, [16, 5], 9, false), event(topics.loot, 77, [20, 3, 1], 10, false),
  event(topics.loot, 78, [30, 7, 2], 11, false),
  event(topics.complete, -1, [4, 4, 2, 1], 23, false),
  event("0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704", -1, [15000, 5000, 0, 21000, 7000, 0], 21, false),
  event("0xd0fbe8b5c73fec6dcfc5fef85459b695d1c9fedb4f94f9748ecaeff785192f14", -1, [10800, 3600], 22, false),
  event("0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9", 1, [12, 10, 6000, 2000, 21000, 7000], 18, false),
  event("0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9", 2, [10, 2, 9000, 3000, 0, 0], 19, false)
];
describe("staged battle evidence", () => {
  test("sums chunks, keeps wiped defenders, repairs resident defenses, deduplicates delivery", () => {
    const logs = fixture();
    const result = decodeStagedBattleEvidence([...logs, logs[4]!], "77")!;
    expect(result.complete).toBe(true);
    expect(result.members.find(m => m.missionId === "77")?.units[0]).toEqual({ unit: 1, starting: 10, destroyed: 5, restored: 0, remaining: 5 });
    expect(result.members.find(m => m.missionId === "99")?.units[0]?.remaining).toBe(0);
    expect(result.members.find(m => m.missionId === "0")?.units[0]).toEqual({ unit: 16, starting: 10, destroyed: 8, restored: 5, remaining: 7 });
    expect(decodeStagedBattleEvidence([...logs].reverse(), "77")).toEqual(result);
  });
  test("authoritative report ignores return cargo and stale unqualified links", () => {
    const report = decodeBattleReportLogs([...fixture(), final()], "77")!;
    expect(report.loot).toEqual({ metal: "20", crystal: "3", deuterium: "1" });
    expect(report.participants.map(p => p.missionId)).toEqual(["77", "78"]);
    expect(report.participants[0]?.destroyedShips).toEqual({ lightFighter: "5" });
    expect(attachAttackGroupParticipants([report], [
      { missionId: "77", joinedAttackMissionIds: ["666"], ships: { lightFighter: "9999" } },
      { missionId: "666", owner, ships: {}, returnCargo: { metal: "888", crystal: "0", deuterium: "0" } }
    ] as never)[0]?.participants).toEqual(report.participants);
    expect(decodeBattleReportLogs(fixture(), "77")).toBeNull();
  });
  test("indexer materializes cross-transaction resident and wiped allied snapshots", () => {
    const indexer = new SettlementIndexer({
      async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; }
    }, 0n);
    for (const log of [...fixture(), final()]) indexer.applyLog(log);
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    const report = indexer.battleReport("77");
    expect(report?.participants.map(p => p.missionId)).toEqual(["77", "78"]);
    expect(report?.defenderSnapshot).toEqual({ fleet: [], defenses: [{ id: 0, count: 10 }] });
    expect(report?.defenderLossBreakdown?.staticDefenses.units).toEqual([{ id: 0, destroyed: 8, restored: 5, netLost: 3, remaining: 7 }]);
    expect(report?.stationedDefenders?.[0]?.destroyedShips).toEqual({ lightFighter: "7" });
    expect(report?.stationedDefenders?.[0]?.survivingShips).toEqual({});
    expect(report?.defenderLossBreakdown?.stationedFleet.destroyedResources).toEqual({ metal: "21000", crystal: "7000", deuterium: "0" });
    expect(report?.defenderLossBreakdown?.fleetLossesReconciled).toBe(true);
    expect(indexer.battleReport("99")?.missionId).toBe("77");
  });
  test("reorgs invalidate canonical reports and aliases; restored logs can regenerate", () => {
    const indexer = new SettlementIndexer({ async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; } }, 0n);
    const logs = [...fixture(), final()];
    for (const log of logs) indexer.applyLog(log);
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    expect(indexer.battleReport("99")?.missionId).toBe("77");
    indexer.applyLog({ ...logs[9]!, removed: true });
    expect(indexer.battleReport("77")).toBeNull();
    expect(indexer.battleReport("78")).toBeNull();
    expect(indexer.battleReport("99")).toBeNull();
    indexer.applyLog(logs[9]!);
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    expect(indexer.battleReport("77")?.loot.metal).toBe("20");
    indexer.applyLog({ ...final(), removed: true });
    expect(indexer.battleReport("77")).toBeNull();
    expect(indexer.battleReport("99")).toBeNull();
  });
  test("terminal-first ingestion stays unavailable until all committed evidence arrives", () => {
    const indexer = new SettlementIndexer({ async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; } }, 0n);
    indexer.applyLog(final());
    for (const log of fixture().slice(0, 11)) indexer.applyLog(log);
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    expect(indexer.battleReport("77")).toBeNull();
    for (const log of fixture().slice(11)) indexer.applyLog(log);
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    expect(indexer.battleReport("77")?.attackerLosses.metal).toBe("15000");
  });
  test("shared defender lookup selects latest canonical battle regardless of repair order", () => {
    const indexer = new SettlementIndexer({ async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; } }, 0n);
    const first = [...fixture(), final()];
    const second = first.map(log => ({ ...log, blockNumber: "0x" + (BigInt(log.blockNumber) + 100n).toString(16), transactionHash: "0x" + word(BigInt(log.transactionHash) + 100n), topics: log.topics.map((value, i) => i === 1 ? "0x" + word(88) : i === 2 && value === "0x" + word(77) ? "0x" + word(88) : value) }));
    for (const log of [...first, ...second]) indexer.applyLog(log);
    indexer.materializeBattleReportReadModelsForWorker(["77", "88"], "ingest");
    expect(indexer.battleReport("99")?.missionId).toBe("88");
    indexer.materializeBattleReportReadModelsForWorker(["77"], "repair");
    expect(indexer.battleReport("99")?.missionId).toBe("88");
    indexer.applyLog({ ...second.at(-1)!, removed: true });
    expect(indexer.battleReport("99")?.missionId).toBe("77");
    const sameBlockFinal = { ...second.at(-1)!, blockNumber: final().blockNumber, logIndex: "0x1" };
    indexer.applyLog(sameBlockFinal);
    indexer.materializeBattleReportReadModelsForWorker(["88"], "ingest");
    indexer.applyLog({ ...final(), removed: true });
    indexer.applyLog({ ...final(), logIndex: "0x9" });
    indexer.materializeBattleReportReadModelsForWorker(["77"], "ingest");
    expect(indexer.battleReport("99")?.missionId).toBe("77");
  });
  test("round sequence is complete and repeated deliveries do not duplicate rounds", () => {
    const logs = [...fixture(), final()];
    expect(decodeBattleReportLogs([...logs, logs[14]!], "77")?.roundReports).toHaveLength(2);
    expect(decodeBattleReportLogs(logs.filter((_, i) => i !== 14), "77")).toBeNull();
  });
  test("stage-only evidence never interprets carried cargo as new loot", () => {
    const stage = event(combatStageAdvancedTopic, -1, [13, 100, 2], 24, false);
    expect(decodeBattleReportLogs([stage, final()], "77")).toBeNull();
  });
  test("side totals must exactly reconcile to per-member ship casualties", () => {
    const logs = fixture().map(log => log.transactionHash === "0x" + word(21)
      ? { ...log, data: "0x" + [15001, 5000, 0, 21000, 7000, 0].map(word).join("") } : log);
    expect(decodeBattleReportLogs([...logs, final()], "77")).toBeNull();
  });
  test("missing snapshots and impossible casualties fail closed", () => {
    expect(decodeStagedBattleEvidence(fixture().slice(1), "77")?.complete).toBe(false);
    expect(decodeBattleReportLogs([...fixture().slice(1), final()], "77")).toBeNull();
    expect(decodeStagedBattleEvidence([...fixture(), event(topics.losses, 77, [0, 1, 100], 12)], "77")?.complete).toBe(false);
    expect(decodeStagedBattleEvidence(fixture(), "88")).toBeUndefined();
    expect(decodeStagedBattleEvidence(fixture().filter((_, i) => i !== 4), "77")?.complete).toBe(false);
    expect(decodeStagedBattleEvidence(fixture().filter(log => log.topics[2] !== "0x" + word(78)), "77")?.complete).toBe(false);
  });
});
