import { defenseCatalog, shipyardCatalog } from "./playableMvp";
import type { ProductionCatalogItem, ProductionQueue } from "./components/ProductionCatalog";
import type { OnChainResources, QueueStateResponse } from "./walletFlow";
import { timestampToMs } from "./timestampFormat";
import type { WriteTransactionPhase } from "./transactionActionGate";

export type ProductionOrder = { kind: "ship" | "defense"; id: number; quantity: number };
export type ProductionBody = "planet" | "moon";
type PlanItem = Pick<ProductionCatalogItem, "id" | "label" | "asset" | "unitCostRaw" | "durationSeconds" | "missing" | "status" | "thumbnailStyle">;
export const MAX_PRODUCTION_ORDERS = 4; // Must match the on-chain bound; verify measured gas before release.
const MAX_QUANTITY = 0xffffffff;
type Budget = { metal: bigint; crystal: bigint; deuterium: bigint };
const zero = (): Budget => ({ metal: 0n, crystal: 0n, deuterium: 0n });
const fields = ["metal", "crystal", "deuterium"] as const;

function budget(value: OnChainResources | { metal: number; crystal: number; deuterium: number } | null | undefined): Budget | undefined {
  if (!value) return undefined;
  try {
    const result = {} as Budget;
    for (const field of fields) {
      const raw = value[field];
      if (!/^(0|[1-9]\d*)$/.test(String(raw)) || (typeof raw === "number" && !Number.isSafeInteger(raw))) return undefined;
      result[field] = BigInt(raw);
    }
    return result;
  } catch { return undefined; }
}

export function productionDraftKey(account: string | undefined, chainId: string, planetId: string | undefined, body: ProductionBody): string | undefined {
  return account && planetId ? `${chainId.toLowerCase()}:${account.toLowerCase()}:${planetId}:${body}` : undefined;
}

export type ProductionPlanContext = {
  body: ProductionBody;
  resources: OnChainResources | null | undefined;
  ships: readonly PlanItem[];
  defenses: readonly PlanItem[];
  shipQueue?: ProductionQueue | undefined;
  shipBacklogLength?: number | undefined;
  defenseQueue?: ProductionQueue | undefined;
  defenseBacklogLength?: number | undefined;
  capacityQueue?: QueueStateResponse | null | undefined;
  defenseCounts: readonly { id: number; count: number }[];
  shipyardLevel: number;
  naniteLevel: number;
  defenseShipyardLevel?: number;
  defenseNaniteLevel?: number;
  missileSiloLevel?: number | undefined;
  available: boolean;
};

// VeydriftFormulas.unitDuration: ceil the whole order, then clamp to one second.
function batchDuration(context: ProductionPlanContext, unit: Budget, quantity: number, kind: ProductionOrder["kind"]): number | undefined {
  const shipyardLevel = kind === "defense" ? context.defenseShipyardLevel ?? context.shipyardLevel : context.shipyardLevel;
  const naniteLevel = kind === "defense" ? context.defenseNaniteLevel ?? context.naniteLevel : context.naniteLevel;
  if (!Number.isSafeInteger(shipyardLevel) || shipyardLevel < 0 || !Number.isSafeInteger(naniteLevel) || naniteLevel < 0 || naniteLevel > 255) return undefined;
  const denominator = 2500n * BigInt(shipyardLevel + 1) * (2n ** BigInt(naniteLevel));
  const numerator = (unit.metal + unit.crystal) * BigInt(quantity) * 3600n;
  return Number((numerator + denominator - 1n) / denominator || 1n);
}

function queuedCount(queue: QueueStateResponse | null | undefined, id: number): number {
  const entries = [queue, ...(queue?.backlog ?? [])];
  return entries.reduce((sum, entry) => sum + (entry?.active !== false && entry?.itemId === id ? entry.quantity ?? 0 : 0), 0);
}

function capacityBlocker(context: ProductionPlanContext, rows: readonly ProductionOrder[]): string | undefined {
  const quantity = (key: string) => {
    const id = defenseCatalog.find(item => item.key === key)?.id;
    return id === undefined ? 0 : (context.defenseCounts.find(item => item.id === id)?.count ?? 0)
      + queuedCount(context.capacityQueue, id)
      + rows.filter(row => row.kind === "defense" && row.id === id).reduce((sum, row) => sum + row.quantity, 0);
  };
  if (quantity("smallShieldDome") > 1 || quantity("largeShieldDome") > 1) return "One shield dome of each type per body";
  if (context.body === "moon") return rows.some(row => row.kind === "defense" && defenseCatalog.find(item => item.id === row.id)?.group === "missile")
    ? "Missiles cannot be built on a moon" : undefined;
  if (quantity("antiBallisticMissile") + 2 * quantity("interplanetaryMissile") > (context.missileSiloLevel ?? 0) * 10) return "Missile Silo capacity full";
  return undefined;
}

export function evaluateProductionPlan(rows: readonly ProductionOrder[], context: ProductionPlanContext, now = Date.now()): {
  cost: Budget;
  reason?: string | undefined;
  durationSeconds: number;
  lines: Array<{ index: number; order: ProductionOrder; item: PlanItem; durationSeconds: number }>;
} {
  const cost = zero();
  let reason: string | undefined;
  const lines: Array<{ index: number; order: ProductionOrder; item: PlanItem; durationSeconds: number }> = [];
  if (!context.available) reason = "Production is unavailable";
  if (rows.length > MAX_PRODUCTION_ORDERS) reason ??= `Maximum ${MAX_PRODUCTION_ORDERS} orders per batch`;
  for (const [index, row] of rows.entries()) {
    if (!Number.isSafeInteger(row.id) || row.id < 0 || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > MAX_QUANTITY || (row.kind !== "ship" && row.kind !== "defense")) {
      reason ??= "Invalid production order";
      continue;
    }
    const item = (row.kind === "ship" ? context.ships : context.defenses).find(candidate => candidate.id === row.id);
    const validCatalog = (row.kind === "ship" ? shipyardCatalog : defenseCatalog).some(candidate => candidate.id === row.id && (context.body === "planet" || row.kind !== "ship" || (candidate.key !== "solarSatellite" && candidate.key !== "crawler")));
    const unit = budget(item?.unitCostRaw);
    if (!item || !validCatalog || !unit || item.status === "unavailable") {
      reason ??= "Production item is unavailable";
      continue;
    }
    if (item.missing.length) reason ??= item.missing[0];
    const durationSeconds = Number.isFinite(item.durationSeconds) && (item.durationSeconds ?? 0) > 0
      ? batchDuration(context, unit, row.quantity, row.kind) : undefined;
    if (durationSeconds === undefined) reason ??= "Production timing is unavailable";
    for (const field of fields) cost[field] += unit[field] * BigInt(row.quantity);
    lines.push({ index, order: row, item, durationSeconds: durationSeconds ?? 0 });
  }
  reason ??= capacityBlocker(context, rows);
  for (const kind of ["ship", "defense"] as const) {
    const length = kind === "ship" ? context.shipBacklogLength : context.defenseBacklogLength;
    if ((length ?? 0) + rows.filter(row => row.kind === kind).length > 16) reason ??= "Production backlog is full";
  }
  const available = budget(context.resources);
  if (!available) reason ??= "Resources are unavailable";
  else if (fields.some(field => cost[field] > available[field])) reason ??= "Insufficient resources for build plan";
  const durationSeconds = Math.max(0, ...(["ship", "defense"] as const).map(kind => {
    const drafted = lines.filter(line => line.order.kind === kind);
    if (!drafted.length) return 0;
    const queue = kind === "ship" ? context.shipQueue : context.defenseQueue;
    const tail = queue?.backlog?.at(-1)?.readyAt ?? queue?.readyAt;
    const waiting = tail ? Math.max(0, ((timestampToMs(tail) ?? now) - now) / 1000) : 0;
    return (Number.isFinite(waiting) ? waiting : 0) + drafted.reduce((sum, line) => sum + line.durationSeconds, 0);
  }));
  return { cost, reason, lines, durationSeconds };
}

export function maxAddableProduction(context: ProductionPlanContext, rows: readonly ProductionOrder[], kind: ProductionOrder["kind"], id: number): number {
  if (rows.length >= MAX_PRODUCTION_ORDERS) return 0;
  const length = kind === "ship" ? context.shipBacklogLength : context.defenseBacklogLength;
  if ((length ?? 0) + rows.filter(row => row.kind === kind).length >= 16) return 0;
  const item = (kind === "ship" ? context.ships : context.defenses).find(candidate => candidate.id === id);
  const unit = budget(item?.unitCostRaw);
  const balance = budget(context.resources);
  if (!item || !unit || !balance || !context.available || item.missing.length || item.status === "unavailable"
    || !Number.isFinite(item.durationSeconds) || (item.durationSeconds ?? 0) <= 0 || batchDuration(context, unit, 1, kind) === undefined) return 0;
  const used = evaluateProductionPlan(rows, context).cost;
  let limit = MAX_QUANTITY;
  for (const field of fields) if (unit[field] > 0n) {
    const remaining = balance[field] - used[field];
    limit = Math.min(limit, remaining < 0n ? 0 : Number((remaining / unit[field]) > BigInt(MAX_QUANTITY) ? BigInt(MAX_QUANTITY) : remaining / unit[field]));
  }
  if (kind === "defense") {
    let low = 0; let high = limit;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (capacityBlocker(context, [...rows, { kind, id, quantity: mid }])) high = mid - 1;
      else low = mid;
    }
    limit = low;
  }
  return limit;
}

export function removeSubmittedSnapshot(current: readonly ProductionOrder[], submitted: readonly ProductionOrder[]): ProductionOrder[] {
  const remaining = [...current];
  for (const row of submitted) {
    const index = remaining.findIndex(candidate => candidate === row);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

export function productionDraftAfterReceipt(current: readonly ProductionOrder[], submitted: readonly ProductionOrder[], phase: WriteTransactionPhase): ProductionOrder[] {
  return phase === "confirmed" || phase === "applied" || phase === "success"
    ? removeSubmittedSnapshot(current, submitted) : [...current];
}
