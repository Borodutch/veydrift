import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditUnitInventory, applyUnitInventoryRepair, openUnitInventoryDatabase } from "./repairUnitInventory";
import { latestLogPositionSql, SettlementIndexer } from "./indexer";
import { shipCompletedTopic } from "./evm";

const shipTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const defenseTopic = "0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3";
const moonTopic = "0xbd55c2b529f64f3a888d38432d6c54b03515f3de3f0114255cb36620f5df1257";
const word = (n: number) => n.toString(16).padStart(64, "0");
const log = (logIndex: string, total: number, topic = shipTopic) => ({
  blockNumber: "0x90", logIndex, transactionHash: "0xcombat",
  topics: [topic, "0x" + word(173), "0x" + word(0)], data: "0x" + word(total),
});
const reader = { async listDebrisFieldEvents() { return []; }, async listMoonChanceReportEvents() { return []; }, async listSettledPlanetEvents() { return []; } };

test("operator opens an existing file explicitly read/write only for apply and never creates a missing database", () => {
  const directory = mkdtempSync(join(tmpdir(), "unit-inventory-open-"));
  try {
    const path = join(directory, "inventory.sqlite");
    const created = new Database(path);
    created.exec("CREATE TABLE inventory(count INTEGER)");
    created.close();
    const writer = openUnitInventoryDatabase(path, true);
    try { writer.exec("INSERT INTO inventory VALUES (0)"); } finally { writer.close(); }
    const reader = openUnitInventoryDatabase(path, false);
    try {
      expect(reader.query("SELECT count FROM inventory").get()).toEqual({ count: 0 });
      expect(() => reader.exec("UPDATE inventory SET count=79")).toThrow();
    } finally { reader.close(); }
    for (const apply of [true, false]) expect(() => openUnitInventoryDatabase(join(directory, "missing.sqlite"), apply)).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function database() {
  const db = new Database(":memory:");
  new SettlementIndexer(reader, 0n, { database: db });
  for (const [key, value] of Object.entries({ latestIndexedBlock: "144", indexedRevision: "1", resourceProjectionBlock: "144",
    resourceProjectionHash: "0x" + "a".repeat(64), resourceProjectionRevision: "1" })) {
    db.query("INSERT OR REPLACE INTO indexer_metadata (key,value) VALUES (?,?)").run(key, value);
  }
  return db;
}

test("duplicates cannot resurrect combat losses, completion totals or another body's units", () => {
  const db = database();
  try {
    const indexer = new SettlementIndexer(reader, 0n, { database: db, assumeSchemaReady: true });
    const completed = { ...log("0x9c", 94, shipCompletedTopic), data: "0x" + word(1) + word(94) };
    const rounds = [["0x9d", 79], ["0xa0", 62], ["0xa3", 42], ["0xa6", 5], ["0xa9", 0]] as const;
    const logs = [completed, ...rounds.map(([position, total]) => log(position, total)), log("0xff", 3, defenseTopic),
      { ...log("0x100", 8, defenseTopic), transactionHash: "0xpost-combat-repair" }, log("0x101", 6, moonTopic)];
    for (const event of logs) indexer.applyLog(event);
    const read = (table: string, kind = "ship") => db.query(`SELECT count FROM ${table} WHERE planet_id='173' AND ${kind}_id=0`).get();
    for (const sequence of [logs, [...logs].reverse(), [completed, logs[1]!, logs.at(-1)!, logs[2]!]]) {
      for (const event of sequence) expect(indexer.applyLog(event).applied).toBe(false);
      expect(read("contract_ship_counts")).toEqual({ count: 0 });
      expect(read("indexed_ship_counts")).toEqual({ count: 0 });
      expect(read("contract_defense_counts", "defense")).toEqual({ count: 8 });
      expect(read("contract_moon_ship_counts")).toEqual({ count: 6 });
    }
    // A canonical heal may be newer than every retained event. Duplicates must not undo it.
    db.query("UPDATE contract_ship_counts SET count=12 WHERE planet_id='173'").run();
    indexer.applyLog(completed);
    expect(read("contract_ship_counts")).toEqual({ count: 12 });
  } finally { db.close(); }
});

test("repair audits all event families numerically, applies both mirrors atomically and is idempotent", () => {
  const db = database();
  try {
    const indexer = new SettlementIndexer(reader, 0n, { database: db, assumeSchemaReady: true });
    indexer.applyLog({ ...log("0x9c", 94, shipCompletedTopic), data: "0x" + word(1) + word(94) });
    indexer.applyLog(log("0x9d", 79));
    indexer.applyLog(log("0xa9", 0));
    for (const table of ["indexed_ship_counts", "contract_ship_counts"]) db.query(`UPDATE ${table} SET count=79 WHERE planet_id='173'`).run();
    db.query("UPDATE indexer_metadata SET value=(SELECT value FROM indexer_metadata WHERE key='indexedRevision') WHERE key='resourceProjectionRevision'").run();
    const audit = auditUnitInventory(db);
    const apiReader = new SettlementIndexer(reader, 0n, { database: db, readOnly: true });
    expect(apiReader.shipRows("173").find(ship => ship.id === 0)?.count).toBe(79);
    expect(audit.candidates).toHaveLength(1);
    expect(audit.candidates[0]).toMatchObject({ body: "planet", total: 0, before: [79, 79] });
    db.exec("CREATE TRIGGER simulate_interruption BEFORE UPDATE ON contract_ship_counts BEGIN SELECT RAISE(ABORT, 'interrupted'); END;");
    expect(() => applyUnitInventoryRepair(db, audit)).toThrow("interrupted");
    expect(auditUnitInventory(db)).toEqual(audit);
    expect(db.query("SELECT value FROM indexer_metadata WHERE key='unitInventoryOrderingRepairV1'").get()).toBeNull();
    db.exec("DROP TRIGGER simulate_interruption");
    expect(applyUnitInventoryRepair(db, audit)).toBe(1);
    expect(apiReader.shipRows("173").find(ship => ship.id === 0)?.count).toBe(0);
    expect(auditUnitInventory(db).candidates).toEqual([]);
    expect(applyUnitInventoryRepair(db, audit)).toBe(0);
    indexer.applyLog(log("0x9d", 79));
    expect(auditUnitInventory(db).candidates).toEqual([]);
    const restarted = new SettlementIndexer(reader, 0n, { database: db, assumeSchemaReady: true });
    restarted.applyLog(log("0x9d", 79));
    expect(auditUnitInventory(db).candidates).toEqual([]);
  } finally { db.close(); }
});

test("repair refuses changed checkpoints without modifying state", () => {
  const db = database();
  try {
    const audit = auditUnitInventory(db);
    db.query("UPDATE indexer_metadata SET value='2' WHERE key='indexedRevision'").run();
    expect(() => applyUnitInventoryRepair(db, audit)).toThrow("Database advanced");
    expect(db.query("SELECT value FROM indexer_metadata WHERE key='unitInventoryOrderingRepairV1'").get()).toBeNull();
  } finally { db.close(); }
});

test("SQL latest ordering handles hexadecimal width, padding and case using the matching index", () => {
  const db = database();
  try {
    db.exec("CREATE TABLE ordering_test(block_number TEXT, log_index TEXT)");
    for (const value of ["0xff", "0x9d", "0xa9", "0x0100", "0xFE"]) db.query("INSERT INTO ordering_test VALUES ('144',?)").run(value);
    expect(db.query(`SELECT log_index FROM ordering_test ORDER BY ${latestLogPositionSql}`).all())
      .toEqual(["0x0100", "0xff", "0xFE", "0xa9", "0x9d"].map(log_index => ({ log_index })));
    const plan = db.query(`EXPLAIN QUERY PLAN SELECT event_json FROM indexed_event_logs WHERE removed=0
      AND lower(json_extract(event_json, '$.topics[0]'))=? AND lower(json_extract(event_json, '$.topics[1]'))=?
      AND lower(json_extract(event_json, '$.topics[2]'))=? ORDER BY ${latestLogPositionSql}`).all("a", "b", "c");
    expect(JSON.stringify(plan)).toContain("indexed_event_logs_queue_topics_v2_idx");
    expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
  } finally { db.close(); }
});
