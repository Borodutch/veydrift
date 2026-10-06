import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { encodeAbiParameters, parseAbiParameters, toHex } from "viem";
import { SettlementIndexer, type IndexedRpcLog } from "./indexer";
import { decodeProofBattleAccepted, proofBattleAcceptedTopic } from "./proofAcceptanceEvent";
import { decodeBattleReportLogs, eventNameForTopic, isBattleReportLog } from "./evm";
const hash = (n: bigint) => toHex(n, { size: 32 });
const game = toHex(100n, { size: 20 });
const log: IndexedRpcLog = { address: game, blockNumber: "0x10", blockHash: hash(10n), transactionHash: hash(20n), logIndex: "0x0",
  topics: [proofBattleAcceptedTopic, hash(42n), hash(1n), hash(2n)],
  data: encodeAbiParameters(parseAbiParameters("bytes32,uint256,uint8,uint256,uint256,uint8,uint32"), [hash(3n), 9007199254740993n, 4, 9007199254740993n, 0n, 1, 3]) };
const reader = { async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; } };
test("acceptance archives all fields without reports; duplicate, removed, restart and restored replay are exact", () => {
  const database = new Database(":memory:");
  try {
    let indexer = new SettlementIndexer(reader, 0n, { database });
    expect(indexer.applyLog(log).applied).toBe(true);
    expect(indexer.applyLog(log).duplicate).toBe(true);
    expect(indexer.proofBattleAcceptances(game, "42")).toEqual([decodeProofBattleAccepted(log)]);
    expect(indexer.proofBattleAcceptances(game, "42")[0]?.memberCount).toBe("9007199254740993");
    expect(eventNameForTopic(proofBattleAcceptedTopic)).toBe("ProofBattleAccepted");
    expect(isBattleReportLog(log)).toBe(false);
    expect(decodeBattleReportLogs([log], "42")).toBeNull();
    expect(database.query("SELECT count(*) AS n FROM indexed_mission_event_logs").get()).toEqual({ n: 0 });
    expect(database.query("SELECT count(*) AS n FROM indexed_battle_report_read_models").get()).toEqual({ n: 0 });
    indexer = new SettlementIndexer(reader, 0n, { database });
    expect(indexer.proofBattleAcceptances(game, "42")).toHaveLength(1);
    indexer.applyLog({ ...log, removed: true });
    expect(indexer.proofBattleAcceptances(game, "42")).toEqual([]);
    indexer = new SettlementIndexer(reader, 0n, { database });
    expect(indexer.proofBattleAcceptances(game, "42")).toEqual([]);
    expect(indexer.applyLog(log).applied).toBe(true);
    expect(indexer.proofBattleAcceptances(game, "42")).toEqual([decodeProofBattleAccepted(log)]);
    const offlineRemoved = indexer.missingCanonicalGameLogs(game, [], 16n, 16n);
    expect(offlineRemoved).toHaveLength(1);
    for (const removed of offlineRemoved) indexer.applyLog(removed);
    expect(indexer.proofBattleAcceptances(game, "42")).toEqual([]);
    const replacement = { ...log, blockHash: hash(11n) };
    indexer.applyLog(replacement);
    expect(indexer.proofBattleAcceptances(game, "42")[0]?.blockHash).toBe(hash(11n));
    expect(indexer.proofBattleAcceptances(toHex(101n, { size: 20 }), "42")).toEqual([]);
    expect(() => indexer.applyLog({ ...log, transactionHash: hash(99n), data: "0x" })).toThrow("malformed");
    expect(indexer.proofBattleAcceptances(game, "42")).toHaveLength(1);
  } finally { database.close(); }
});
