import { useState } from "preact/hooks";
import type { BuildingKey, ResearchKey, Resources, ShipKey, UnlockRequirement } from "../playableMvp";
import { canAfford, missingUnlockRequirements, shipCatalog, shipyardCatalog, shipCombatStats, shipSpecRows } from "../playableMvp";
import { formatMissingResources } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import { activeProductionQueue } from "../productionQueueFallback";
import type { ChainShipyardState } from "../walletFlow";
import {
  Notice,
  parseProductionQuantity,
  ProductionCatalog,
  formatProductionPrice,
  type ProductionCatalogItem,
  type ProductionDetailSection,
  type ProductionQuantityInput,
  type ProductionRequirementState,
  productionQueueViewModel,
} from "./ProductionCatalog";
import { PageHeader, RefreshButton, refreshButtonState } from "./PageHeader";
import type { RequirementTarget } from "./RequirementFlairs";
import { CatalogSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

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
  now?: number | undefined;
  onBuild: (shipId: number, key: ShipKey, quantity: number) => void;
  onCollect: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onSelectShip?: ((key: ShipKey) => void) | undefined;
  overviewQueue?: ChainShipyardState["queue"] | undefined;
  productionRates?: Resources | undefined;
  selectedShipKey?: ShipKey | undefined;
  shipyardState: ChainShipyardState | null;
  spendableResources?: Resources | undefined;
}

const groupLabels = {
  civil: "Civil and economy",
  combat: "Combat ships",
  special: "Satellites and specials",
} as const;

export function shipyardRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

export function shouldShowShipyardInitialLoader({
  loading,
  shipyardState,
}: {
  loading: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
}): boolean {
  return loading && !shipyardState;
}

export function ShipyardPage({
  actionState,
  canTransact,
  error,
  loading,
  now,
  onBuild,
  onCollect,
  onOpenRequirement,
  onRefresh,
  onSelectShip,
  overviewQueue,
  productionRates,
  selectedShipKey,
  shipyardState,
  spendableResources,
}: ShipyardPageProps) {
  const [quantities, setQuantities] = useState<Record<string, ProductionQuantityInput>>({});
  const [localSelectedKey, setLocalSelectedKey] = useState<ShipKey>("smallCargo");
  const selectedKey = selectedShipKey ?? localSelectedKey;
  const shipyardLevel = shipyardState?.shipyardLevel ?? 0;
  // VEY-KANEO-473: gate on the canonical settled-to-now balance (`resourcesAsOfNow`) the top bar
  // uses, falling back to the raw settled snapshot only when the accrued field is absent — so the
  // shipyard affordability number can never disagree with the bar.
  const resources = toResources(shipyardState?.resourcesAsOfNow ?? shipyardState?.resources);
  const queue = activeProductionQueue(shipyardState?.queue, overviewQueue, "ship");
  const productionAvailable = shipyardState?.productionAvailable !== false;
  const initialLoading = shouldShowShipyardInitialLoader({ loading, shipyardState });

  return (
    <div className="grid gap-4">
      <PageHeader
        actions={<RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh shipyard state" />}
        title="Shipyard"
      />

      <StatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        shipyardState={shipyardState}
      />

      {initialLoading ? (
        <CatalogSkeleton label="Loading shipyard" />
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
            resources: spendableResources ?? resources,
            shipyardLevel,
            shipyardState,
            productionRates,
          })}
          now={now}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
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

export function StatusPanel({
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
  // Only suppress notices during the initial load (no state yet). Keeping the
  // last notice visible across refreshes avoids a blink/layout-jump when state
  // is silently re-fetched.
  if (loading && !shipyardState) {
    return null;
  }

  const refreshError = shipyardRefreshErrorLabel({ error, shipyardState });
  if (refreshError) {
    return isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="neutral">{refreshError}</Notice>;
  }

  if (error) {
    return isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <Notice tone="danger">{error}</Notice>;
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

  // Only surface failures. Success/pending action banners are intentionally not
  // rendered so the page does not flash transient status banners on every action.
  if (actionState.status === "error") {
    return <Notice tone="danger">{actionState.label}</Notice>;
  }

  return null;
}

export function shipyardRefreshErrorLabel({
  error,
  shipyardState,
}: {
  error: string | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
}): string | undefined {
  if (!error || !shipyardState) return undefined;
  return `Refreshing shipyard state: ${error}`;
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
  productionRates,
}: {
  actionPending: boolean;
  canTransact: boolean;
  productionAvailable: boolean;
  quantities: Record<string, ProductionQuantityInput>;
  queue?: ChainShipyardState["queue"] | undefined;
  resources: Resources | undefined;
  shipyardLevel: number;
  shipyardState: ChainShipyardState | null;
  productionRates?: Resources | undefined;
}): ProductionCatalogItem<ShipKey>[] {
  // Build only from the buildable subset so expedition-only ships (Pathfinder) are
  // hidden from the shipyard. `shipCatalog` is still used elsewhere for queue label
  // resolution so a pre-existing on-chain queue entry keeps its name.
  return shipyardCatalog.map((ship) => {
    const chainShip = shipyardState?.ships.find((item) => item.id === ship.id);
    const shipUnavailable = Boolean(shipyardState) && productionAvailable && !chainShip;
    const owned = productionAvailable && chainShip ? chainShip.count : undefined;
    const baseCost = productionAvailable && chainShip ? toResources(chainShip.cost) : undefined;
    const quantityInput = quantities[ship.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
    // Backend-sourced per-unit build time scaled by the selected quantity (VEY-KANEO-472).
    const durationSeconds = chainShip?.durationSeconds === undefined
      ? undefined
      : chainShip.durationSeconds * quantity;
    const energyPerUnit = ship.key === "solarSatellite"
      ? formatSolarSatelliteEnergyPerUnit(chainShip?.energyPerUnit)
      : undefined;
    const missing = shipUnavailable ? ["Unavailable on current deployment"] : getMissingRequirements(ship, shipyardState);
    const requirements = getShipRequirementStates(ship, shipyardState);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const queued = queuedShipCount(ship.id, queue);
    const blockedReason = getBlockedReason({
      affordable,
      canTransact,
      hasPlanet: Boolean(shipyardState?.homePlanetId),
      missing,
      resources,
      shipUnavailable,
      shipyardState,
      totalCost,
      productionRates,
    });
    const disabled = Boolean(blockedReason) || actionPending;
    const combatStats = shipCombatStats(ship);
    const stats = combatStats.rows.map((row) => formatShipSummaryStat(row.label, row.value)).join(" · ");

    return {
      actionLabel: "Build",
      asset: ship.asset,
      blockedReason,
      cost: totalCost,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "At planet",
      countValue: owned,
      detailSections: shipDetailSections({
        cost: totalCost,
        durationSeconds,
        energyPerUnit,
        owned,
        ship,
      }),
      detailNote: stats || "Production unit",
      disabled,
      group: ship.group,
      groupLabel: groupLabels[ship.group],
      id: ship.id,
      key: ship.key,
      label: ship.label,
      missing,
      notes: shipNotes(ship),
      quantity,
      quantityInput,
      quantityValid: parsedQuantity !== undefined,
      queued,
      requirements,
      status: queued > 0 ? "queued" : shipUnavailable ? "unavailable" : missing.length === 0 ? "ready" : "locked",
      statusLabel: queued > 0 ? "Queued" : shipUnavailable ? "Unavailable" : missing.length === 0 ? "Ready" : "Locked",
    };
  });
}

function shipNotes(ship: (typeof shipCatalog)[number]): string[] {
  if (ship.key === "solarSatellite") {
    return [
      ship.description,
      "Special: generates energy in orbit and cannot move, haul cargo, or spend fuel.",
    ];
  }

  if (ship.key === "crawler") {
    return [
      ship.description,
      "Special: each crawler adds +0.02% to this planet's metal, crystal, and deuterium mine production, counting up to 8 crawlers per combined mine level (Metal Mine + Crystal Mine + Deuterium Synthesizer) and capped at a +50% total bonus. The on-chain bonus activates once the crawler production upgrade is live.",
    ];
  }

  return [ship.description];
}

function shipDetailSections({
  cost,
  durationSeconds,
  energyPerUnit,
  owned,
  ship,
}: {
  cost: Resources | undefined;
  durationSeconds: number | undefined;
  energyPerUnit: string | undefined;
  owned: number | undefined;
  ship: (typeof shipCatalog)[number];
}): ProductionDetailSection[] {
  const specs = shipSpecRows(ship);
  const stat = (label: string) => specs.find((row) => row.label === label)?.value ?? "-";

  return [
    {
      title: "Logistics",
      stats: [
        { label: "Base speed", value: formatShipSpecValue(ship, "Base speed", stat("Base speed")) },
        { label: "Fuel use", value: formatShipSpecValue(ship, "Fuel use", stat("Fuel use")) },
      ],
    },
    {
      title: "Build",
      stats: [
        {
          label: "At planet",
          value: owned === undefined ? "unavailable" : owned.toLocaleString("en-US"),
        },
        ...(energyPerUnit === undefined
          ? []
          : [{ label: "Energy output", value: energyPerUnit, wide: true } as const]),
        { label: "Price", value: cost ? formatProductionPrice(cost) : "-", wide: true },
        ...(durationSeconds === undefined
          ? []
          : [{ label: "Build time", value: formatDuration(durationSeconds), wide: true } as const]),
      ],
    },
  ];
}

function formatSolarSatelliteEnergyPerUnit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const energy = Number(value);
  if (!Number.isFinite(energy)) return undefined;
  return `+${Math.floor(energy).toLocaleString("en-US")} energy/unit`;
}

function formatShipSummaryStat(label: string, value: number | string): string {
  if (label === "Cargo" && value === 0) return "No cargo";
  return `${label} ${formatStatValue(value)}`;
}

function formatShipSpecValue(ship: (typeof shipCatalog)[number], label: string, value: string): string {
  if (label === "Fuel use" && value === "None") return "No fuel";
  if (label === "Base speed" && value === "Stationary") return ship.key === "solarSatellite" ? "Stationary energy platform" : "Stationary";
  return value;
}

function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
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
  resources,
  shipUnavailable,
  shipyardState,
  totalCost,
  productionRates,
}: {
  affordable: boolean;
  canTransact: boolean;
  hasPlanet: boolean;
  missing: string[];
  resources: Resources | undefined;
  shipUnavailable: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
  totalCost?: Resources | undefined;
  productionRates?: Resources | undefined;
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
  if (!shipyardState) return "Waiting for chain state";
  if (shipyardState.productionAvailable === false) return "Ship production unavailable";
  if (shipUnavailable) return "Ship unavailable on current deployment";
  if (!hasPlanet) return "No game planet";
  if (missing.length > 0) return missing[0];
  if (!resources) return "Resources unavailable";
  if (!affordable && totalCost) return formatMissingResources(resources, totalCost, productionRates);
  if (!affordable) return "Insufficient resources";
  return undefined;
}

function queuedShipCount(shipId: number, queue?: ChainShipyardState["queue"] | undefined): number {
  let quantity = queue?.active && queue.itemId === shipId ? queue.quantity ?? 0 : 0;
  for (const backlog of queue?.backlog ?? []) {
    if (backlog.active && backlog.itemId === shipId) {
      quantity += backlog.quantity ?? 0;
    }
  }
  return quantity;
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
