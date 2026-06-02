import { useState } from "preact/hooks";
import type { BuildingKey, ResearchKey, Resources, ShipKey, UnlockRequirement } from "../playableMvp";
import { canAfford, missingUnlockRequirements, shipCatalog, shipCombatStats, shipDurationEstimate, shipSpecRows } from "../playableMvp";
import { activeProductionQueue } from "../productionQueueFallback";
import type { ChainShipyardState } from "../walletFlow";
import {
  Notice,
  ProductionCatalog,
  type ProductionCatalogItem,
  type ProductionRequirementState,
  productionQueueViewModel,
} from "./ProductionCatalog";
import type { RequirementTarget } from "./RequirementFlairs";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface ShipyardPageProps {
  actionState: ShipyardActionState;
  canTransact: boolean;
  error: string | undefined;
  loading: boolean;
  onBuild: (shipId: number, key: ShipKey, quantity: number) => void;
  onCollect: () => void;
  onFinish: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onSelectShip?: ((key: ShipKey) => void) | undefined;
  overviewQueue?: ChainShipyardState["queue"] | undefined;
  selectedShipKey?: ShipKey | undefined;
  shipyardState: ChainShipyardState | null;
}

const groupLabels = {
  civil: "Civil and economy",
  combat: "Combat ships",
  special: "Satellites and specials",
} as const;

export function ShipyardPage({
  actionState,
  canTransact,
  error,
  loading,
  onBuild,
  onCollect,
  onFinish,
  onOpenRequirement,
  onRefresh,
  onSelectShip,
  overviewQueue,
  selectedShipKey,
  shipyardState,
}: ShipyardPageProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [localSelectedKey, setLocalSelectedKey] = useState<ShipKey>("smallCargo");
  const selectedKey = selectedShipKey ?? localSelectedKey;
  const shipyardLevel = shipyardState?.shipyardLevel ?? 0;
  const resources = toResources(shipyardState?.resources);
  const queue = activeProductionQueue(shipyardState?.queue, overviewQueue, "ship");
  const productionAvailable = shipyardState?.productionAvailable !== false;
  const initialLoading = loading && !shipyardState;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Shipyard</h2>
          <p className="mt-1 text-xs text-slate-400">
            {shipyardState?.homePlanetId
              ? `Planet #${shipyardState.planetId ?? shipyardState.homePlanetId} · Shipyard Level ${shipyardLevel}`
              : productionAvailable
                ? "On-chain VeydriftGame planet required for ship production"
                : "Ship production contract unavailable on this deployment"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="h-9 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      <StatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        shipyardState={shipyardState}
      />

      {initialLoading ? (
        <VeydriftLoader label="Syncing shipyard" />
      ) : (
        <ProductionCatalog
          actionPending={actionState.status === "pending"}
          canTransact={canTransact}
          emptyLabel="Select a ship to review costs, requirements, and production controls."
          items={shipProductionItems({
            actionPending: actionState.status === "pending",
            canTransact,
            productionAvailable,
            quantities,
            queue,
            resources,
            shipyardLevel,
            shipyardState,
          })}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
          onFinishQueue={onFinish}
          onOpenRequirement={onOpenRequirement}
          onQuantity={(key, quantity) => setQuantities((prev) => ({ ...prev, [key]: quantity }))}
          onRefreshQueue={onCollect}
          onSelect={(key) => {
            setLocalSelectedKey(key);
            onSelectShip?.(key);
          }}
          queue={productionQueueViewModel(queue, shipCatalog)}
          selectedKey={selectedKey}
        />
      )}
    </div>
  );
}

function StatusPanel({
  actionState,
  error,
  loading,
  shipyardState,
}: {
  actionState: ShipyardActionState;
  error: string | undefined;
  loading: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
}) {
  if (loading && shipyardState) {
    return <InlineSyncIndicator label="Refreshing shipyard" />;
  }

  if (loading) {
    return null;
  }

  if (error) {
    return <Notice tone="danger">{error}</Notice>;
  }

  if (shipyardState?.productionAvailable === false) {
    return (
      <Notice tone="neutral">
        {shipyardState.unavailableReason ?? "Ship production is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!shipyardState?.homePlanetId) {
    return (
      <Notice tone="danger">
        No VeydriftGame home planet was found for this wallet. Ship counts and production are not shown from local state.
      </Notice>
    );
  }

  if (actionState.status !== "idle") {
    const tone = actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "neutral";
    return <Notice tone={tone}>{actionState.label}</Notice>;
  }

  return null;
}

export function shipProductionItems({
  actionPending,
  canTransact,
  productionAvailable,
  quantities,
  queue,
  resources,
  shipyardLevel,
  shipyardState,
}: {
  actionPending: boolean;
  canTransact: boolean;
  productionAvailable: boolean;
  quantities: Record<string, number>;
  queue?: ChainShipyardState["queue"] | undefined;
  resources: Resources | undefined;
  shipyardLevel: number;
  shipyardState: ChainShipyardState | null;
}): ProductionCatalogItem<ShipKey>[] {
  return shipCatalog.map((ship) => {
    const chainShip = shipyardState?.ships.find((item) => item.id === ship.id);
    const shipUnavailable = Boolean(shipyardState) && productionAvailable && !chainShip;
    const owned = productionAvailable && chainShip ? chainShip.count : undefined;
    const baseCost = productionAvailable && chainShip ? toResources(chainShip.cost) : undefined;
    const quantity = quantities[ship.key] ?? 1;
    const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
    const durationSeconds = baseCost
      ? shipDurationEstimate(shipyardLevel, shipyardState?.naniteLevel ?? 0, baseCost, quantity)
      : undefined;
    const missing = shipUnavailable ? ["Unavailable on current deployment"] : getMissingRequirements(ship, shipyardState);
    const requirements = getShipRequirementStates(ship, shipyardState);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const queued = queue?.active && queue.itemId === ship.id ? queue.quantity ?? 0 : 0;
    const blockedReason = getBlockedReason({
      affordable,
      canTransact,
      hasPlanet: Boolean(shipyardState?.homePlanetId),
      missing,
      queueActive: Boolean(queue),
      resources,
      shipUnavailable,
      shipyardState,
    });
    const disabled = Boolean(blockedReason) || actionPending;
    const stats = shipCombatStats(ship).rows.slice(0, 3).map((row) => `${row.label} ${row.value}`).join(" · ");

    return {
      actionLabel: "Build",
      asset: ship.asset,
      blockedReason,
      cost: totalCost,
      countLabel: "Owned",
      countValue: owned,
      detailNote: stats || "Production unit",
      description: ship.description,
      detailStats: shipSpecRows(ship),
      disabled,
      durationSeconds,
      group: ship.group,
      groupLabel: groupLabels[ship.group],
      id: ship.id,
      key: ship.key,
      label: ship.label,
      missing,
      quantity,
      queued,
      requirements,
      status: queued > 0 ? "queued" : shipUnavailable ? "unavailable" : missing.length === 0 ? "ready" : "locked",
      statusLabel: queued > 0 ? "Queued" : shipUnavailable ? "Unavailable" : missing.length === 0 ? "Ready" : "Locked",
    };
  });
}

export function getMissingRequirements(
  ship: (typeof shipCatalog)[number],
  shipyardState?: ChainShipyardState | null | undefined,
): string[] {
  return missingUnlockRequirements(ship.requirements, {
    buildings: { shipyard: shipyardState?.shipyardLevel ?? 0 },
    research: technologyLevelsByKey(shipyardState?.technologyLevels),
  });
}

export function getShipRequirementStates(
  ship: (typeof shipCatalog)[number],
  shipyardState?: ChainShipyardState | null | undefined,
): ProductionRequirementState[] {
  const levels = {
    buildings: { shipyard: shipyardState?.shipyardLevel ?? 0 },
    research: technologyLevelsByKey(shipyardState?.technologyLevels),
  };

  return uniqueRequirements(ship.requirements).map((requirement) => {
    const actual = requirement.kind === "building"
      ? levels.buildings[requirement.key as keyof typeof levels.buildings] ?? 0
      : levels.research[requirement.key as string] ?? 0;

    return {
      label: `${requirement.label} ${requirement.level}`,
      met: actual >= requirement.level,
      target: requirement.key
        ? requirement.kind === "building"
          ? { kind: "building" as const, key: requirement.key as BuildingKey }
          : { kind: "research" as const, key: requirement.key as ResearchKey }
        : undefined,
    };
  });
}

function uniqueRequirements(requirements: readonly UnlockRequirement[]): UnlockRequirement[] {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = `${requirement.kind}:${requirement.key ?? requirement.label}:${requirement.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getBlockedReason({
  affordable,
  canTransact,
  hasPlanet,
  missing,
  queueActive,
  resources,
  shipUnavailable,
  shipyardState,
}: {
  affordable: boolean;
  canTransact: boolean;
  hasPlanet: boolean;
  missing: string[];
  queueActive: boolean;
  resources: Resources | undefined;
  shipUnavailable: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
  if (!shipyardState) return "Waiting for chain state";
  if (shipyardState.productionAvailable === false) return "Ship production unavailable";
  if (shipUnavailable) return "Ship unavailable on current deployment";
  if (!hasPlanet) return "No game planet";
  if (queueActive) return "Queue active";
  if (missing.length > 0) return missing[0];
  if (!resources) return "Resources unavailable";
  if (!affordable) return "Insufficient resources";
  return undefined;
}

function toResources(resources: ChainShipyardState["resources"] | ChainShipyardState["ships"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

function multiply(resources: Resources, quantity: number): Resources {
  return {
    metal: resources.metal * quantity,
    crystal: resources.crystal * quantity,
    deuterium: resources.deuterium * quantity,
  };
}

const technologyIdByKey: Partial<Record<string, number>> = {
  energy: 0,
  laser: 1,
  ion: 2,
  combustionDrive: 3,
  computer: 4,
  weapons: 5,
  shielding: 6,
  armor: 7,
  hyperspace: 8,
  impulseDrive: 9,
  hyperspaceDrive: 10,
  plasma: 11,
  astrophysics: 12,
  intergalacticResearchNetwork: 13,
  graviton: 14,
};

function technologyLevelsByKey(levels: Record<string, number> | undefined) {
  return Object.fromEntries(
    Object.entries(technologyIdByKey).map(([key, id]) => [
      key,
      id === undefined ? 0 : levels?.[id.toString()] ?? 0,
    ]),
  );
}
