import { Database } from "bun:sqlite";
import { mkdirSync, realpathSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initializeStatsStore, refreshPublicStats } from "../../backend/src/stats.ts";

const indexDbPath = process.env.VEYDRIFT_INDEX_DB_PATH ?? "/app/apps/backend/.data/contract-state.sqlite";

function contractDescriptors() {
  const candidates = [
    [process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS ?? process.env.VEYDRIFT_CONTRACT_ADDRESS, "Game"],
    [process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS, "Settlement"],
    [process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS, "Randomness"],
    [process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS, "Alliances"],
    [process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS, "Moons"],
    [process.env.VEYDRIFT_MIGRATION_CONTRACT_ADDRESS, "Migration"],
    [process.env.VEYDRIFT_REFERRAL_SYSTEM_ADDRESS, "Referrals"],
    [process.env.VEYDRIFT_METAL_TOKEN_ADDRESS, "vMETAL"],
    [process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS, "vCRYSTAL"],
    [process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS, "vDEUTERIUM"]
  ];
  const labels = new Map();
  for (const [address, label] of candidates) {
    if (!address) continue;
    const normalized = address.toLowerCase();
    labels.set(normalized, labels.has(normalized) ? `${labels.get(normalized)} / ${label}` : label);
  }
  return [...labels].map(([address, label]) => ({ address, label }));
}

const storePath = resolve(process.env.VEYDRIFT_STATS_DB_PATH ?? ".data/stats.sqlite");
const sourcePath = realpathSync(indexDbPath);
const sourceStat = statSync(sourcePath);
if (storePath === sourcePath || (existsSync(storePath) && (
  realpathSync(storePath) === sourcePath
  || (statSync(storePath).ino === sourceStat.ino && statSync(storePath).dev === sourceStat.dev)
))) throw new Error("Stats persistence must not use the backend database");
mkdirSync(dirname(storePath), { recursive: true });
const db = new Database(sourcePath, { readonly: true });
const store = new Database(storePath, { create: true, readwrite: true });
try {
  // Connection-local limits only: never add an index or trigger to the shared database.
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000; PRAGMA cache_size = -8192;");
  initializeStatsStore(store);
  const result = refreshPublicStats(db, store, contractDescriptors(), {
    sourceId: `${sourcePath}:${sourceStat.dev}:${sourceStat.ino}`,
    batchSize: Number(process.env.VEYDRIFT_STATS_BATCH_SIZE ?? 5000)
  });
  process.stdout.write(JSON.stringify(result));
} finally {
  store.close();
  db.close();
}
