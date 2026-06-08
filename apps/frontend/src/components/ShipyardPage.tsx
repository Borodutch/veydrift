import { useState } from "preact/hooks";
import type { BuildingKey, ResearchKey, Resources, ShipKey, UnlockRequirement } from "../playableMvp";
import { canAfford, missingUnlockRequirements, shipCatalog, shipCombatStats, shipDurationEstimate, shipSpecRows } from "../playableMvp";
import { formatMissingResources } from "../buildingDetails";
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
import { VeydriftLoader } from "./VeydriftLoader";

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
  onFinish: () => void;
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
  onFinish,
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
  const resources = toResources(shipyardState?.resources);
  const queue = activeProductionQueue(shipyardState?.queue, overviewQueue, "ship");
  const productionAvailable = shipyardState?.productionAvailable !== false;
  const initialLoading = shouldShowShipyardInitialLoader({ loading, shipyardState });

  return (
    <div className="grid gap-4">
      <PageHeader
        actions={<RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh shipyard state" />}
        subtitle={shipyardState?.homePlanetId
          ? `Planet #${shipyardState.planetId ?? shipyardState.homePlanetId} · Shipyard Level ${shipyardLevel}`
          : productionAvailable
            ? "On-chain VeydriftGame planet required for ship production"
            : "Ship production contract unavailable on this deployment"}
        title="Shipyard"
      />

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
            productionRates,
            quantities,
            queue,
            resources: spendableResources ?? resources,
            shipyardLevel,
            shipyardState,
          })}
          now={now}
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
    return <Notice tone="neutral">{refreshError}</Notice>;
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
  productionRates,
  quantities,
  queue,
  resources,
  shipyardLevel,
  shipyardState,
}: {
  actionPending: boolean;
  canTransact: boolean;
  productionAvailable: boolean;
  productionRates?: Resources | undefined;
  quantities: Record<string, ProductionQuantityInput>;
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
    const quantityInput = quantities[ship.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
    const durationSeconds = baseCost
      ? shipDurationEstimate(shipyardLevel, shipyardState?.naniteLevel ?? 0, baseCost, quantity)
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
      productionRates,
      resources,
      shipUnavailable,
      shipyardState,
      totalCost,
    });
    const disabled = Boolean(blockedReason) || actionPending;
    const combatStats = shipCombatStats(ship);
    const stats = combatStats.rows.map((row) => formatShipSummaryStat(row.label, row.value)).join(" · ");

    return {
      actionLabel: "Build",
      asset: ship.asset,
      blockedReason,
      cost: totalCost,
      countLabel: "Owned",
      countValue: owned,
      detailSections: shipDetailSections({
        cost: totalCost,
        durationSeconds,
        missing,
        owned,
        requirements,
        ship,
        statusLabel: queued > 0 ? "Queued" : shipUnavailable ? "Unavailable" : missing.length === 0 ? "Ready" : "Locked",
      }),
      detailNote: stats || "Production unit",
      disabled,
      durationSeconds,
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

  return [ship.description];
}

function shipDetailSections({
  cost,
  durationSeconds,
  missing,
  owned,
  requirements,
  ship,
  statusLabel,
}: {
  cost: Resources | undefined;
  durationSeconds: number | undefined;
  missing: string[];
  owned: number | undefined;
  requirements: ProductionRequirementState[];
  ship: (typeof shipCatalog)[number];
  statusLabel: string;
}): ProductionDetailSection[] {
  const specs = shipSpecRows(ship);
  const stat = (label: string) => specs.find((row) => row.label === label)?.value ?? "-";
  const metCount = requirements.filter((requirement) => requirement.met).length;

  return [
    {
      title: "Combat",
      stats: [
        { label: "Structure", value: stat("Structure") },
        { label: "Shield", value: stat("Shield") },
        { label: "Attack", value: stat("Attack") },
      ],
    },
    {
      title: "Logistics",
      stats: [
        { label: "Cargo", value: formatShipSpecValue(ship, "Cargo", stat("Cargo")) },
        { label: "Base speed", value: formatShipSpecValue(ship, "Base speed", stat("Base speed")) },
        { label: "Fuel use", value: formatShipSpecValue(ship, "Fuel use", stat("Fuel use")) },
      ],
    },
    {
      title: "Build",
      stats: [
        { label: "Owned", value: owned === undefined ? "unavailable" : owned.toLocaleString("en-US") },
        { label: "Build time", value: durationSeconds === undefined ? "-" : formatShipyardDuration(durationSeconds) },
        { label: "Price", value: cost ? formatProductionPrice(cost) : "-", wide: true },
      ],
    },
    {
      title: "Requirements",
      stats: [
        { label: "Status", value: statusLabel },
        { label: "Unlocks", value: requirements.length > 0 ? `${metCount}/${requirements.length} met` : "No unlocks" },
        { label: "Missing", value: missing.length > 0 ? missing.join(", ") : "None", wide: true },
      ],
    },
  ];
}

function formatShipSummaryStat(label: string, value: number | string): string {
  if (label === "Cargo" && value === 0) return "No cargo";
  return `${label} ${formatStatValue(value)}`;
}

function formatShipSpecValue(ship: (typeof shipCatalog)[number], label: string, value: string): string {
  if (label === "Cargo" && value === "0") return "No cargo";
  if (label === "Fuel use" && value === "None") return "No fuel";
  if (label === "Base speed" && value === "Stationary") return ship.key === "solarSatellite" ? "Stationary energy platform" : "Stationary";
  return value;
}

function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function formatShipyardDuration(seconds: number): string {
  if (seconds < 3_600) {
    return `${Math.ceil(seconds / 60)}m`;
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h ${Math.ceil((seconds % 3_600) / 60)}m`;
  }

  return `${Math.floor(seconds / 86_400)}d ${Math.ceil((seconds % 86_400) / 3_600)}h`;
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
  productionRates,
  resources,
  shipUnavailable,
  shipyardState,
  totalCost,
}: {
  affordable: boolean;
  canTransact: boolean;
  hasPlanet: boolean;
  missing: string[];
  productionRates?: Resources | undefined;
  resources: Resources | undefined;
  shipUnavailable: boolean;
  shipyardState?: ChainShipyardState | null | undefined;
  totalCost?: Resources | undefined;
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
