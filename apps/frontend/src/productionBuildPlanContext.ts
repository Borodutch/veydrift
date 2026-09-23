import { technologyLevelsByKey } from "./chainState";
import { defenseCatalog, missingUnlockRequirements, shipyardCatalog } from "./playableMvp";
import type { ProductionBody, ProductionPlanContext } from "./productionBuildPlan";
import type { ChainDefenseState, ChainInfrastructureState, ChainMoonState, ChainShipyardState, OnChainResources, QueueStateResponse } from "./walletFlow";

function queueForPlan(queue: QueueStateResponse | null | undefined, catalog: readonly { id: number; label: string; asset: string }[]) {
  if (!queue?.active) return undefined;
  const info = (id: number | undefined) => catalog.find(item => item.id === id);
  return {
    label: info(queue.itemId)?.label ?? "Production",
    readyAt: queue.readyAt,
    backlog: queue.backlog?.filter(entry => entry.active !== false).map(entry => ({
      label: info(entry.itemId)?.label ?? "Production", readyAt: entry.readyAt,
    })),
  };
}

function costForDefense(reported: OnChainResources | undefined, fallback: { metal: number; crystal: number; deuterium: number }) {
  return reported && (["metal", "crystal", "deuterium"] as const).some(resource => Number(reported[resource]) > 0)
    ? reported : { metal: String(fallback.metal), crystal: String(fallback.crystal), deuterium: String(fallback.deuterium) };
}

export function productionPlanContext(body: ProductionBody, states: {
  defense: ChainDefenseState | null;
  shipyard: ChainShipyardState | null;
  infrastructure: ChainInfrastructureState | null;
  moon: ChainMoonState | null;
}): ProductionPlanContext {
  const moon = body === "moon" ? states.moon : null;
  const shipyard = body === "planet" ? states.shipyard : null;
  const defense = body === "planet" ? states.defense : null;
  const resources = body === "moon"
    ? moon?.resourcesAsOfNow ?? moon?.resources ?? null
    : states.infrastructure?.resourcesAsOfNow ?? states.infrastructure?.resources ?? null;
  const shipRows = moon?.ships ?? shipyard?.ships ?? [];
  const defenseRows = moon?.defenses ?? defense?.defenses ?? [];
  const shipyardLevel = moon
    ? moon.buildings.find(building => building.key === "shipyard")?.level ?? 0
    : shipyard?.shipyardLevel ?? 0;
  const missileSiloLevel = defense?.missileSiloLevel ?? 0;
  const technology = technologyLevelsByKey(moon?.technologyLevels ?? shipyard?.technologyLevels ?? defense?.technologyLevels);
  const shipQueue = moon?.shipQueue ?? shipyard?.queue;
  const defenseQueue = moon?.defenseQueue ?? defense?.queue;
  const available = Boolean(resources && (body === "moon"
    ? moon?.moon?.exists && moon.moonAvailable !== false
    : shipyard && defense && shipyard.productionAvailable !== false && defense.productionAvailable !== false));

  return {
    body, resources, available, missileSiloLevel,
    ships: shipyardCatalog.filter(ship => body === "planet" || (ship.key !== "solarSatellite" && ship.key !== "crawler")).map(ship => {
      const row = shipRows.find(candidate => candidate.id === ship.id);
      return {
        id: ship.id, label: ship.label, asset: ship.asset,
        unitCostRaw: row?.cost, durationSeconds: row?.durationSeconds,
        status: row && available ? "ready" as const : "unavailable" as const,
        missing: missingUnlockRequirements(ship.requirements, { buildings: { shipyard: shipyardLevel }, research: technology }),
      };
    }),
    defenses: defenseCatalog.filter(item => body === "planet" || item.group !== "missile").map(item => {
      const row = defenseRows.find(candidate => candidate.id === item.id);
      return {
        id: item.id, label: item.label, asset: item.asset,
        unitCostRaw: row ? costForDefense(row.cost, item.baseCost) : undefined,
        durationSeconds: row?.durationSeconds,
        status: row && available ? "ready" as const : "unavailable" as const,
        missing: missingUnlockRequirements(item.requirements, { buildings: { shipyard: shipyardLevel, missileSilo: missileSiloLevel }, research: technology }),
      };
    }),
    shipQueue: queueForPlan(shipQueue, shipyardCatalog),
    shipBacklogLength: shipQueue?.backlog?.length,
    defenseQueue: queueForPlan(defenseQueue, defenseCatalog),
    defenseBacklogLength: defenseQueue?.backlog?.length,
    capacityQueue: moon?.defenseQueue ?? (defense?.unsettledQueue !== undefined ? defense.unsettledQueue : defense?.queue),
    defenseCounts: (moon?.defenses ?? (defense?.unsettledQueue !== undefined ? defense?.defenses : defense?.launchableDefenses ?? defense?.defenses)) ?? [],
  };
}
