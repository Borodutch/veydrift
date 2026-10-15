import { currentResources, RESOURCES_UNAVAILABLE } from "./currentResources";
import { buildingCatalog, buildingContractIds, buildingCostFactor, researchCatalog, isBinaryBuilding, type BuildingKey, type ResearchKey } from "./playableMvp";
import type { SupplyResources } from "./batchSupplyPlanner";
import type { ChainInfrastructureState, ChainMoonState, ChainResearchState } from "./walletFlow";

export type LevelSupplyRequest = { kind: "building" | "research" | "moon"; key: string; label: string; level: number };
/** `fromLevel` is the first level included in `requirement`; it is below `level` for a cumulative (multi-level) Supply. */
export type LevelSupplyPreview = { requirement: SupplyResources; missing: SupplyResources; energyOnly: boolean; inProgress?: boolean; fromLevel?: number };
const keys = ["metal", "crystal", "deuterium"] as const;
type ExactCost = Record<keyof SupplyResources, bigint>;

/** Integer catalogue arithmetic; never round a formatted table cell back into cargo. */
export function levelSupplyCost(request: LevelSupplyRequest): Record<keyof SupplyResources, bigint> {
  if (!Number.isSafeInteger(request.level) || request.level < 1 || request.level > 255) throw new Error("This level is outside the supported upgrade range.");
  const building = buildingCatalog.find(item => item.key === request.key);
  const research = researchCatalog.find(item => item.key === request.key);
  const base = request.kind === "research" ? research?.baseCost : request.kind === "moon" && request.key === "lunarBase"
    ? { metal: 20000, crystal: 40000, deuterium: 20000 }
    : request.kind === "moon" && request.key === "jumpGate" ? { metal: 2000000, crystal: 4000000, deuterium: 2000000 } : building?.baseCost;
  if (!base) throw new Error("Upgrade cost is unavailable.");
  const binary = request.kind === "moon" ? request.key === "jumpGate" : request.kind === "building" && isBinaryBuilding(request.key as BuildingKey);
  if (binary && request.level !== 1) throw new Error("This structure can only be built once.");
  let numerator = 2n, denominator = 1n;
  if (request.kind === "research" && request.key === "astrophysics") { numerator = 7n; denominator = 4n; }
  if (request.kind === "building") {
    const factor = buildingCostFactor(request.key as BuildingKey);
    numerator = BigInt(factor[0]); denominator = BigInt(factor[1]);
  }
  const exponent = BigInt(binary ? 0 : request.level - 1);
  return Object.fromEntries(keys.map(key => {
    const n = BigInt(base[key]) * numerator ** exponent, d = denominator ** exponent;
    const value = request.kind === "research" && request.key === "graviton" ? 0n
      : request.kind === "research" && request.key === "astrophysics" ? (((n + d / 2n) / d + 50n) / 100n) * 100n : n / d;
    return [key, value];
  })) as ExactCost;
}

/** Sum of the upgrade costs of every level from `fromLevel` through `request.level`, so one shipment
 * funds the whole climb. `live` replaces the catalogue cost of one level with the indexed chain cost. */
export function cumulativeLevelSupplyCost(request: LevelSupplyRequest, fromLevel: number, live?: { level: number; cost: ExactCost }): ExactCost {
  if (!Number.isSafeInteger(fromLevel) || fromLevel < 1 || fromLevel > request.level) throw new Error("This level range is outside the supported upgrade range.");
  const total: ExactCost = { metal: 0n, crystal: 0n, deuterium: 0n };
  for (let level = fromLevel; level <= request.level; level++) {
    const cost = live?.level === level ? live.cost : levelSupplyCost({ ...request, level });
    for (const key of keys) total[key] += cost[key];
  }
  return total;
}

type Snapshot = ChainInfrastructureState | ChainMoonState | ChainResearchState;
export function levelSupplyPreview(request: LevelSupplyRequest, snapshot: Snapshot, planetId: string): LevelSupplyPreview {
  if (snapshot.stale || ("degraded" in snapshot && snapshot.degraded) || ("indexedNotReady" in snapshot && snapshot.indexedNotReady)) throw new Error("Destination state is updating. Refresh before planning Supply.");
  if (request.kind === "moon" && (!("moon" in snapshot) || !snapshot.moon?.exists)) throw new Error("The destination moon is unavailable.");
  const actualId = request.kind === "moon" && "moon" in snapshot ? snapshot.moon?.planetId : "planetId" in snapshot ? snapshot.planetId ?? snapshot.homePlanetId : snapshot.homePlanetId;
  if (actualId !== planetId) throw new Error("Destination state does not match the selected body.");
  const entry = request.kind === "research"
    ? ("technologies" in snapshot ? snapshot.technologies.find(item => item.id === researchCatalog.find(item => item.key === request.key as ResearchKey)?.id) : undefined)
    : ("buildings" in snapshot ? snapshot.buildings.find(item => request.kind === "moon" ? "key" in item && item.key === request.key : item.id === buildingContractIds[request.key as BuildingKey]) : undefined);
  if (!entry || !Number.isSafeInteger(entry.level) || entry.level < 0 || entry.level >= request.level) throw new Error("This level is already completed or its current state is unavailable.");
  // Queued upgrades have already paid, so Supply starts after the queued level. Other queues do not block preparation.
  const queue = snapshot.queue;
  const queuedLevel = queue?.active && queue.itemId === entry.id && queue.action !== "demolish"
    && Number.isSafeInteger(queue.targetLevel) && queue.targetLevel! > entry.level ? queue.targetLevel! : entry.level;
  const inProgress = request.level <= queuedLevel;
  const fromLevel = inProgress ? request.level : queuedLevel + 1;
  const resources = currentResources(snapshot);
  if (!resources) throw new Error(RESOURCES_UNAVAILABLE);
  let live: { level: number; cost: ExactCost } | undefined;
  if (fromLevel === entry.level + 1) {
    const catalogue = levelSupplyCost({ ...request, level: fromLevel });
    if (keys.some(key => catalogue[key] > 0n) && keys.every(key => entry.cost?.[key] === "0")) throw new Error("Live upgrade cost is unavailable.");
    if (keys.some(key => !/^\d+$/.test(String(entry.cost?.[key])))) throw new Error("Live upgrade cost is unavailable.");
    live = { level: fromLevel, cost: Object.fromEntries(keys.map(key => [key, BigInt(entry.cost[key])])) as ExactCost };
  }
  const exact = cumulativeLevelSupplyCost(request, fromLevel, live);
  // The existing transport planner uses safe JS integers. Fail closed rather than silently
  // rounding a high-level requirement; upgrading that planner to bigint is separate work.
  const requirement = {} as SupplyResources, missing = {} as SupplyResources;
  for (const key of keys) {
    if (!/^\d+$/.test(String(resources[key]))) throw new Error("Live destination resources are unavailable.");
    if (exact[key] > BigInt(Number.MAX_SAFE_INTEGER) / 3n) throw new Error("The cost up to this level is too large to prepare a safe Supply shipment.");
    requirement[key] = Number(exact[key]);
    const deficit = exact[key] - BigInt(resources[key]);
    missing[key] = !inProgress && deficit > 0n ? Number(deficit) : 0;
  }
  return { requirement, missing, inProgress, fromLevel, energyOnly: request.kind === "research" && request.key === "graviton" };
}

/** A confirmed shipment is an exact user-reviewed cargo amount, not a live balance sweep.
 * Passive production must not force an endless refresh/confirm loop. New deficits,
 * changed costs, and a fully funded destination do require another review. */
export function levelSupplyNeedsReview(previous: LevelSupplyPreview | undefined, fresh: LevelSupplyPreview): boolean {
  return !previous || Boolean(previous.inProgress) !== Boolean(fresh.inProgress) || keys.some(key => previous.requirement[key] !== fresh.requirement[key] || fresh.missing[key] > previous.missing[key])
    || (keys.every(key => fresh.missing[key] === 0) && keys.some(key => previous.missing[key] > 0));
}

export async function readLevelSupplyPreview(
  queries: Pick<import("./backendDataStore").BackendDataStore["queries"], "moon" | "research" | "infrastructure">,
  wallet: string, planetId: string, request: LevelSupplyRequest,
): Promise<LevelSupplyPreview> {
  const query = request.kind === "moon" ? queries.moon : request.kind === "research" ? queries.research : queries.infrastructure;
  const snapshot = await query(wallet, planetId, { fresh: true }).read();
  if (snapshot.wallet.toLowerCase() !== wallet.toLowerCase()) throw new Error("The destination wallet changed. Reopen Supply.");
  return levelSupplyPreview(request, snapshot, planetId);
}
