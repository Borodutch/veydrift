import { buildingCatalog, buildingContractIds, buildingCostFactor, researchCatalog, isBinaryBuilding, type BuildingKey, type ResearchKey } from "./playableMvp";
import type { SupplyResources } from "./batchSupplyPlanner";
import type { ChainInfrastructureState, ChainMoonState, ChainResearchState } from "./walletFlow";

export type LevelSupplyRequest = { kind: "building" | "research" | "moon"; key: string; label: string; level: number };
export type LevelSupplyPreview = { requirement: SupplyResources; missing: SupplyResources; energyOnly: boolean };
const keys = ["metal", "crystal", "deuterium"] as const;

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
  })) as Record<keyof SupplyResources, bigint>;
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
  const resources = snapshot.resourcesAsOfNow ?? snapshot.resources;
  if (!resources) throw new Error("Live destination resources are unavailable. Refresh before planning Supply.");
  const exact = levelSupplyCost(request);
  if (entry.level + 1 === request.level) {
    if (keys.some(key => exact[key] > 0n) && keys.every(key => entry.cost?.[key] === "0")) throw new Error("Live upgrade cost is unavailable.");
    for (const key of keys) {
      if (!/^\d+$/.test(String(entry.cost?.[key]))) throw new Error("Live upgrade cost is unavailable.");
      exact[key] = BigInt(entry.cost[key]);
    }
  }
  // The existing transport planner uses safe JS integers. Fail closed rather than silently
  // rounding a high-level requirement; upgrading that planner to bigint is separate work.
  const requirement = {} as SupplyResources, missing = {} as SupplyResources;
  for (const key of keys) {
    if (!/^\d+$/.test(String(resources[key]))) throw new Error("Live destination resources are unavailable.");
    if (exact[key] > BigInt(Number.MAX_SAFE_INTEGER) / 3n) throw new Error("This level's cost is too large to prepare a safe Supply shipment.");
    requirement[key] = Number(exact[key]);
    const deficit = exact[key] - BigInt(resources[key]);
    missing[key] = deficit > 0n ? Number(deficit) : 0;
  }
  return { requirement, missing, energyOnly: request.kind === "research" && request.key === "graviton" };
}

/** A confirmed shipment is an exact user-reviewed cargo amount, not a live balance sweep.
 * Passive production must not force an endless refresh/confirm loop. New deficits,
 * changed costs, and a fully funded destination do require another review. */
export function levelSupplyNeedsReview(previous: LevelSupplyPreview | undefined, fresh: LevelSupplyPreview): boolean {
  return !previous || keys.some(key => previous.requirement[key] !== fresh.requirement[key] || fresh.missing[key] > previous.missing[key])
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
