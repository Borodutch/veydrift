import { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, http, parseAbi } from "viem";
import { loadBackendConfig } from "./config";
import { SettlementIndexer, type AbsoluteUnitCountProjection } from "./indexer";
import type { RpcLog } from "./evm";

type Anchor = Record<string, string>;
type Candidate = AbsoluteUnitCountProjection & { block: string; logIndex: string; before: Array<number | null> };
export type UnitInventoryAudit = { anchor: Anchor; candidates: Candidate[]; scanned: number };
const anchorKeys = ["latestIndexedBlock", "indexedRevision", "resourceProjectionBlock", "resourceProjectionHash", "resourceProjectionRevision"];
const repairMarker = "unitInventoryOrderingRepairV1";

function anchor(db: Database): Anchor {
  return Object.fromEntries(anchorKeys.map(key => {
    const row = db.query("SELECT value FROM indexer_metadata WHERE key = ?").get(key) as { value: string } | null;
    if (!row) throw new Error(`Missing repair anchor: ${key}`);
    return [key, row.value];
  }));
}

function tables(unit: AbsoluteUnitCountProjection): string[] {
  if (!["planet", "moon"].includes(unit.body) || !["ship", "defense"].includes(unit.kind)) throw new Error("Invalid unit kind");
  return unit.body === "moon" ? [`contract_moon_${unit.kind}_counts`] : [`indexed_${unit.kind}_counts`, `contract_${unit.kind}_counts`];
}

function counts(db: Database, unit: AbsoluteUnitCountProjection): Array<number | null> {
  return tables(unit).map(table => (db.query(`SELECT count FROM ${table} WHERE planet_id = ? AND ${unit.kind}_id = ?`)
    .get(unit.planetId, unit.itemId) as { count: number } | null)?.count ?? null);
}

// No network calls or writes: compare one consistent database snapshot with the
// latest retained absolute event across all event types for each body/unit.
export function auditUnitInventory(db: Database): UnitInventoryAudit {
  return db.transaction(() => {
    const at = anchor(db);
    if (at.indexedRevision !== at.resourceProjectionRevision || BigInt(at.latestIndexedBlock!) > BigInt(at.resourceProjectionBlock!)) {
      throw new Error("Index is not at a complete projection checkpoint");
    }
    const latest = new Map<string, Candidate>();
    const rows = db.query("SELECT event_json FROM indexed_unit_count_event_logs").all() as { event_json: string }[];
    for (const row of rows) {
      const log = JSON.parse(row.event_json) as RpcLog;
      if (log.removed) continue;
      const unit = SettlementIndexer.absoluteUnitCountProjection(log);
      if (!unit) continue;
      const block = BigInt(log.blockNumber), position = BigInt(log.logIndex ?? "0x0");
      if (block > BigInt(at.resourceProjectionBlock!)) throw new Error("Unit event exceeds projection checkpoint");
      const key = `${unit.body}:${unit.kind}:${unit.planetId}:${unit.itemId}`;
      const previous = latest.get(key);
      if (!previous || block > BigInt(previous.block) || (block === BigInt(previous.block) && position > BigInt(previous.logIndex))) {
        latest.set(key, { ...unit, block: block.toString(), logIndex: position.toString(), before: [] });
      }
    }
    const candidates: Candidate[] = [];
    for (const unit of latest.values()) {
      unit.before = counts(db, unit);
      if (unit.before.some(count => (count ?? 0) !== unit.total)) candidates.push(unit);
    }
    return { anchor: at, candidates, scanned: rows.length };
  })();
}

// Caller must stop all index writers and verify these totals against raw contract
// storage at anchor.resourceProjectionBlock. Never pass effective/queued counts.
export function applyUnitInventoryRepair(db: Database, audit: UnitInventoryAudit): number {
  return db.transaction(() => {
    const previous = db.query("SELECT value FROM indexer_metadata WHERE key = ?").get(repairMarker) as { value: string } | null;
    if (previous?.value === JSON.stringify(audit)) return 0;
    if (JSON.stringify(anchor(db)) !== JSON.stringify(audit.anchor)) throw new Error("Database advanced since the audit; re-audit before repair");
    const current = auditUnitInventory(db);
    if (JSON.stringify(current) !== JSON.stringify(audit)) throw new Error("Inventory or journal changed since the audit");
    for (const unit of audit.candidates) {
      if (!Number.isSafeInteger(unit.total) || unit.total < 0 || unit.total > 0xffffffff) throw new Error("Invalid absolute unit total");
      for (const table of tables(unit)) {
        db.query(`INSERT INTO ${table} (planet_id, ${unit.kind}_id, count) VALUES (?, ?, ?)
          ON CONFLICT(planet_id, ${unit.kind}_id) DO UPDATE SET count = excluded.count`).run(unit.planetId, unit.itemId, unit.total);
      }
    }
    if (audit.candidates.length > 0) {
      // Advance durable cache versions together. The verified block did not change,
      // only its materialized counts, so keep the projection revision in step.
      for (const key of ["indexedRevision", "resourceProjectionRevision", "indexedStateVersion", "battleReportReadModelVersion"]) {
        db.query(`INSERT INTO indexer_metadata (key, value) VALUES (?, '1')
          ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).run(key);
      }
    }
    db.query("INSERT OR REPLACE INTO indexer_metadata (key, value) VALUES (?, ?)").run(repairMarker, JSON.stringify(audit));
    return audit.candidates.length;
  }).immediate();
}

async function main() {
  const { values } = parseArgs({ options: {
    out: { type: "string" }, manifest: { type: "string" }, backup: { type: "string" },
    apply: { type: "boolean", default: false }, "writer-stopped": { type: "boolean", default: false },
  } });
  const { config } = loadBackendConfig();
  if (!config.rpcUrl || !config.gameContractAddress) throw new Error("Repair needs configured RPC and game contract");
  if (values.apply && (!values["writer-stopped"] || !values.manifest || !values.backup)) throw new Error("Apply requires --writer-stopped --manifest and a consistent --backup");
  if (!values.apply && !values.out) throw new Error("Audit requires --out for its reviewed manifest");
  const db = new Database(config.indexDbPath, { readonly: !values.apply, create: false });
  try {
    const audit: UnitInventoryAudit = values.apply ? await Bun.file(values.manifest!).json() : auditUnitInventory(db);
    if (values.apply) {
      if (!existsSync(values.backup!) || realpathSync(values.backup!) === realpathSync(config.indexDbPath)) throw new Error("A separate database backup is required");
      const backup = new Database(values.backup!, { readonly: true });
      try { if (JSON.stringify(anchor(backup)) !== JSON.stringify(audit.anchor)) throw new Error("Backup does not match the audited checkpoint"); }
      finally { backup.close(); }
    }
    const client = createPublicClient({ transport: http(config.rpcUrl, { retryCount: 0, timeout: 15000 }) });
    if (await client.getChainId() !== config.chainId) throw new Error("RPC chain mismatch");
    const blockNumber = BigInt(audit.anchor.resourceProjectionBlock!);
    const verifyBlock = async () => {
      const block = await client.getBlock({ blockNumber });
      if (block.hash?.toLowerCase() !== audit.anchor.resourceProjectionHash?.toLowerCase()) throw new Error("Audited block is no longer canonical");
    };
    await verifyBlock();
    for (let offset = 0; offset < audit.candidates.length; offset += 4) {
      await Promise.all(audit.candidates.slice(offset, offset + 4).map(async unit => {
        const functionName = unit.body === "moon" ? (unit.kind === "ship" ? "moonShipCount" : "moonDefenseCount") : (unit.kind === "ship" ? "shipCount" : "defenseCount");
        const address = unit.body === "moon" ? config.moonContractAddress : config.gameContractAddress;
        if (!address) throw new Error("Missing body contract");
        const total = await client.readContract({ address, abi: parseAbi([`function ${functionName}(uint256 planetId, uint8 unit) view returns (uint32)`]),
          functionName, args: [BigInt(unit.planetId), unit.itemId], blockNumber });
        if (Number(total) !== unit.total) throw new Error(`Canonical disagreement for ${unit.body}:${unit.kind}:${unit.planetId}:${unit.itemId}; requires separate history/lifecycle review`);
      }));
    }
    await verifyBlock();
    if (values.apply) console.log(JSON.stringify({ repaired: applyUnitInventoryRepair(db, audit), block: String(blockNumber) }));
    else {
      await Bun.write(values.out!, JSON.stringify(audit, null, 2));
      console.log(JSON.stringify({ verifiedCandidates: audit.candidates.length, scanned: audit.scanned, block: String(blockNumber), manifest: values.out }));
    }
  } finally { db.close(); }
}

if (import.meta.main) main().catch(error => {
  // viem errors can contain the credential-bearing RPC URL; expose only our own
  // actionable validation messages, never transport error objects.
  const message = error instanceof Error && /^(Canonical disagreement|Audited block|Database advanced|Inventory or journal|Backup does not|RPC chain|Index is not|Missing repair anchor)/.test(error.message)
    ? error.message : "Check config, checkpoint, manifest and canonical inventory agreement.";
  console.error(`Unit inventory repair aborted. ${message}`);
  process.exitCode = 1;
});
