import { Database } from "bun:sqlite";
import { buildPublicStatsSnapshot } from "../../backend/src/stats.ts";

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

const db = new Database(indexDbPath, { readonly: true });
try {
  process.stdout.write(JSON.stringify(buildPublicStatsSnapshot(db, contractDescriptors(), undefined, 0)));
} finally {
  db.close();
}
