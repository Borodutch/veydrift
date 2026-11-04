import { currentResources, RESOURCES_UNAVAILABLE } from "../currentResources";
import { playerNotice } from "../playerNotice";
import { isActionBusy } from "../actionNoticeAutoDismiss";
import { useState } from "preact/hooks";
import { supplyResourceShortfall, type SupplyResources } from "../batchSupplyPlanner";
import { formatMissingResources } from "../buildingDetails";
import { resourcesFromChain, technologyLevelsByKey } from "../chainState";
import type { ConstructionProgress } from "../constructionProgress";
import { formatDuration } from "../durationFormat";
import { formatStatValue } from "../numberFormat";
import type { BuildingKey, ResearchKey, Resources, ShipKey, UnlockRequirement } from "../playableMvp";
import { canAfford, missingUnlockRequirements, shipCatalog, shipCombatStats, shipSpecRows, shipyardCatalog } from "../playableMvp";
import { activeProductionQueue } from "../productionQueueFallback";
import { walletRecoveryActionMessage, type ChainInfrastructureState, type ChainShipyardState } from "../walletFlow";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { ShipyardSkeleton } from "./LoadingSkeletons";
import {
  adaptProductionItems,
  formatProductionPrice,
  maxAffordableProductionQuantity,
  Notice,
  productionQueueViewModel,
  ProductionSection,
  scaleProductionCost,
  type ProductionCatalogItem,
  type ProductionDetailSection,
  type ProductionDetailStat,
  type ProductionQuantityInput,
  type ProductionRequirementState,
} from "./ProductionCatalog";
import type { RequirementTarget } from "./RequirementFlairs";

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface ShipyardPageProps {
  buildPlan?: import("./ProductionCatalog").ProductionCatalogProps<ShipKey>["buildPlan"];
  actionState: ShipyardActionState;
  canTransact: boolean;
  // Infrastructure snapshot carrying the backend crawler cap; ignored for another planet.
  crawlerInfrastructure?: Pick<ChainInfrastructureState, "planetId" | "homePlanetId" | "crawlerProduction"> | null | undefined;
  error: string | undefined;
  loading: boolean;
  now?: number | undefined;
  onBuild: (shipId: number, key: ShipKey, quantity: number) => void;
  onCollect: () => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onSelectShip?: ((key: ShipKey) => void) | undefined;
  onSupply?: ((resources: SupplyResources) => void) | undefined;
  overviewQueue?: ChainShipyardState["queue"] | undefined;
  productionRates?: Resources | undefined;
  progressState?: ConstructionProgress | undefined;
  selectedShipKey?: ShipKey | undefined;
  shipyardState: ChainShipyardState | null;
  spendableResources?: Resources | undefined;
  transactionUnavailableReason?: string | undefined;
}

const groupLabels = {
  civil: "Civil and economy",
  combat: "Combat ships",
  special: "Satellites and specials",
} as const;


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
  buildPlan,
  canTransact,
  crawlerInfrastructure,
  error,
  loading,
  now,
  onBuild,
  onCollect,
  onOpenRequirement,
  onSelectShip,
  onSupply,
  overviewQueue,
  productionRates,
  progressState,
  selectedShipKey,
  shipyardState,
  spendableResources,
  transactionUnavailableReason,
}: ShipyardPageProps) {
  const [localSelectedKey, setLocalSelectedKey] = useState<ShipKey>("smallCargo");
  const selectedKey = selectedShipKey ?? localSelectedKey;
  const shipyardLevel = shipyardState?.shipyardLevel ?? 0;
  // VEY-KANEO-473: gate on the canonical settled-to-now balance (`resourcesAsOfNow`) the top bar
  // uses, falling back to the raw settled snapshot only when the accrued field is absent — so the
  // shipyard affordability number can never disagree with the bar.
  const resources = resourcesFromChain(currentResources(shipyardState));
  // Inventory and remaining queue must come from the same response. Overview is only a loading fallback.
  const queue = activeProductionQueue(shipyardState?.queue, shipyardState ? undefined : overviewQueue, "ship");
  const productionAvailable = shipyardState?.productionAvailable !== false;
  const initialLoading = shouldShowShipyardInitialLoader({ loading, shipyardState });

  return (
    <div className="grid gap-4">
      <StatusPanel
        actionState={actionState}
        error={error}
        loading={loading}
        shipyardState={shipyardState}
      />

      {initialLoading ? (
        <ShipyardSkeleton />
      ) : (
        <ProductionSection
          actionPending={isActionBusy(actionState)}
          buildPlan={buildPlan}
          productionKind="ship"
          canTransact={canTransact}
          emptyLabel="Select a ship to review costs, requirements, and production controls."
          items={(quantities) => shipProductionItems({
            actionPending: isActionBusy(actionState),
            canTransact,
            crawlerCap: shipyardCrawlerCap(shipyardState, crawlerInfrastructure),
            productionAvailable,
            quantities,
            queue,
            resources: currentResources(shipyardState) === null ? undefined : spendableResources ?? resources,
            shipyardLevel,
            shipyardState,
            productionRates,
            transactionUnavailableReason,
          })}
          now={now}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
          onOpenRequirement={onOpenRequirement}
          onRefreshQueue={onCollect}
          onSelect={(key) => {
            setLocalSelectedKey(key);
            onSelectShip?.(key);
          }}
          onSupply={onSupply}
          queue={productionQueueViewModel(queue, shipCatalog)}
          queueProgress={progressState}
          queueTone="sky"
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

  const walletRecoveryMessage = walletRecoveryActionMessage(error ?? playerNotice(shipyardState?.unavailableReason));
  if (walletRecoveryMessage) {
    return <Notice tone="danger">{walletRecoveryMessage}</Notice>;
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
        {playerNotice(shipyardState.unavailableReason) ?? "Ship production is currently unavailable."}
      </Notice>
    );
  }

  if (!shipyardState?.homePlanetId) {
    return (
      <Notice tone="danger">
        No home planet was found for this wallet.
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
  crawlerCap,
  productionAvailable,
  quantities,
  queue,
  resources,
  shipyardLevel,
  shipyardState,
  productionRates,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  canTransact: boolean;
  crawlerCap?: number | undefined;
  productionAvailable: boolean;
  quantities: Record<string, ProductionQuantityInput>;
  queue?: ChainShipyardState["queue"] | undefined;
  resources: Resources | undefined;
  shipyardLevel: number;
  shipyardState: ChainShipyardState | null;
  productionRates?: Resources | undefined;
  transactionUnavailableReason?: string | undefined;
}): ProductionCatalogItem<ShipKey>[] {
  // Build only from the buildable subset so expedition-only ships (Pathfinder) are
  // hidden from the shipyard. `shipCatalog` is still used elsewhere for queue label
  // resolution so a pre-existing on-chain queue entry keeps its name.
  return adaptProductionItems(shipyardCatalog, quantities, (ship, { quantity, quantityValid }) => {
    const chainShip = shipyardState?.ships.find((item) => item.id === ship.id);
    const shipUnavailable = Boolean(shipyardState) && productionAvailable && !chainShip;
    const owned = productionAvailable && chainShip ? chainShip.count : undefined;
    const baseCost = productionAvailable && chainShip ? resourcesFromChain(chainShip.cost) : undefined;
    const totalCost = baseCost && quantityValid ? scaleProductionCost(baseCost, quantity) : undefined;
    // Backend-sourced per-unit build time scaled by the selected quantity (VEY-KANEO-472).
    const durationSeconds = chainShip?.durationSeconds === undefined
      ? undefined
      : chainShip.durationSeconds * quantity;
    const energyPerUnit = ship.key === "solarSatellite"
      ? formatSolarSatelliteEnergyPerUnit(chainShip?.energyPerUnit)
      : undefined;
    const missing = shipUnavailable ? ["Currently unavailable"] : getMissingRequirements(ship, shipyardState);
    const requirements = getShipRequirementStates(ship, shipyardState);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const queued = queuedShipCount(ship.id, queue);
    const blockedReason = quantityValid ? getBlockedReason({
      affordable,
      canTransact,
      hasPlanet: Boolean(shipyardState?.homePlanetId),
      missing,
      resources,
      shipUnavailable,
      shipyardState,
      totalCost,
      productionRates,
      transactionUnavailableReason,
    }) : undefined;
    const disabled = Boolean(blockedReason) || actionPending;
    const combatStats = shipCombatStats(ship);
    const stats = combatStats.rows.map((row) => formatShipSummaryStat(row.label, row.value)).join(" · ");
    const crawlerCapView = ship.key === "crawler" && owned !== undefined && crawlerCap !== undefined
      ? crawlerCapItemFields(crawlerCapSummary({ cap: crawlerCap, atPlanet: owned, queued, quantity: quantityValid ? quantity : 0 }))
      : undefined;

    return {
      actionLabel: "Build",
      blockedReason,
      cost: totalCost,
      costAffordable: totalCost === undefined ? undefined : affordable,
      unitCost: baseCost,
      unitCostRaw: chainShip?.cost,
      maxQuantity: maxAffordableProductionQuantity(resources, baseCost),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "At planet",
      countValue: owned,
      ...(crawlerCapView?.countDetail ? { countDetail: crawlerCapView.countDetail } : {}),
      ...(crawlerCapView?.quantityWarning ? { quantityWarning: crawlerCapView.quantityWarning } : {}),
      ...(crawlerCapView?.quantityPreset ? { quantityPreset: crawlerCapView.quantityPreset } : {}),
      detailLayout: "inline",
      detailSections: shipDetailSections({
        affordable,
        capStats: crawlerCapView?.stats,
        totalCost,
        unitCost: baseCost,
        durationSeconds,
        energyPerUnit,
        owned,
        ship,
      }),
      detailNote: stats || "Production unit",
      disabled,
      groupLabel: groupLabels[ship.group],
      labelTone: blockedReason ? "muted" : "normal",
      missing,
      notes: shipNotes(ship),
      queued,
      requirements,
      status: queued > 0 ? "queued" : shipUnavailable ? "unavailable" : missing.length === 0 ? "ready" : "locked",
      statusLabel: undefined,
      supplyRequest: supplyResourceShortfall(resources, totalCost),
    };
  });
}

// Crawler rule (mirrors the backend read model): 8 crawlers per combined mine level count,
// up to the +50% boost (+0.02% each = 2,500 crawlers). Only the copy depends on these here;
// the cap itself always comes from the backend's crawlerProduction.maxEffective.
export const CRAWLERS_PER_MINE_LEVEL = 8;
export const CRAWLER_BOOST_MAX_EFFECTIVE = 2_500;

export type CrawlerCapSummary = {
  cap: number;
  /** Crawlers at the planet plus queued ones. */
  planned: number;
  /** Planned crawlers that will count toward the boost. */
  effective: number;
  /** Planned crawlers above the cap. */
  idle: number;
  /** Selected quantity that would sit idle if built. */
  selectedIdle: number;
  /** Quantity that fills the cap exactly (0 when it is already full). */
  fillQuantity: number;
  /** The cap is the +50% boost limit, so more mine levels will not raise it. */
  boostMaxed: boolean;
};

export function crawlerCapSummary({
  atPlanet,
  cap,
  quantity,
  queued,
}: {
  atPlanet: number;
  cap: number;
  quantity: number;
  queued: number;
}): CrawlerCapSummary {
  const safeCap = Math.max(0, Math.floor(cap));
  const planned = Math.max(0, atPlanet) + Math.max(0, queued);
  const selected = Math.max(0, quantity);
  return {
    cap: safeCap,
    planned,
    effective: Math.min(planned, safeCap),
    idle: Math.max(0, planned - safeCap),
    selectedIdle: Math.min(selected, Math.max(0, planned + selected - safeCap)),
    fillQuantity: Math.max(0, safeCap - planned),
    boostMaxed: safeCap >= CRAWLER_BOOST_MAX_EFFECTIVE,
  };
}

export function crawlerCapItemFields(summary: CrawlerCapSummary): {
  countDetail: NonNullable<ProductionCatalogItem["countDetail"]>;
  quantityPreset: NonNullable<ProductionCatalogItem["quantityPreset"]>;
  quantityWarning: string | undefined;
  stats: ProductionDetailStat[];
} {
  const count = (value: number) => value.toLocaleString("en-US");
  const capHint = summary.boostMaxed
    ? `Counts crawlers at the planet and in the queue. The cap is the +50% boost limit (${count(CRAWLER_BOOST_MAX_EFFECTIVE)} crawlers).`
    : `Counts crawlers at the planet and in the queue. The cap is ${CRAWLERS_PER_MINE_LEVEL} per combined mine level (Metal Mine + Crystal Mine + Deuterium Synthesizer), up to ${count(CRAWLER_BOOST_MAX_EFFECTIVE)}.`;
  const effectiveText = `${count(summary.effective)} / cap ${count(summary.cap)}`;
  const idleReason = summary.boostMaxed
    ? `because the crawler boost tops out at +50% (${count(CRAWLER_BOOST_MAX_EFFECTIVE)} crawlers)`
    : `until mine levels increase (+${CRAWLERS_PER_MINE_LEVEL} per mine level)`;

  return {
    countDetail: {
      text: `Effective ${effectiveText}${summary.idle > 0 ? ` · ${count(summary.idle)} idle` : ""}`,
      tone: summary.idle > 0 ? "warning" : "normal",
    },
    quantityPreset: {
      label: "Fill to cap",
      quantity: summary.fillQuantity,
      title: summary.fillQuantity > 0
        ? `Set the amount to ${count(summary.fillQuantity)}, filling the effective crawler cap`
        : "The effective crawler cap is already filled",
    },
    quantityWarning: summary.selectedIdle > 0
      ? `${count(summary.selectedIdle)} of these will be idle ${idleReason}.`
      : undefined,
    stats: [
      { label: "Effective", value: effectiveText, hint: capHint },
      ...(summary.idle > 0
        ? [{ label: "Idle", value: count(summary.idle), hint: "Crawlers at the planet and in the queue above the effective cap.", tone: "danger" as const }]
        : []),
    ],
  };
}

/**
 * The backend crawler cap for the shipyard's planet, or undefined when the infrastructure
 * snapshot is missing or belongs to another planet (never show one planet's cap on another).
 */
export function shipyardCrawlerCap(
  shipyardState: Pick<ChainShipyardState, "planetId" | "homePlanetId"> | null | undefined,
  infrastructureState: Pick<ChainInfrastructureState, "planetId" | "homePlanetId" | "crawlerProduction"> | null | undefined,
): number | undefined {
  const cap = infrastructureState?.crawlerProduction?.maxEffective;
  if (cap === undefined || !Number.isFinite(cap) || cap < 0) return undefined;
  const shipyardPlanet = shipyardState?.planetId ?? shipyardState?.homePlanetId;
  const infrastructurePlanet = infrastructureState?.planetId ?? infrastructureState?.homePlanetId;
  if (!shipyardPlanet || !infrastructurePlanet || String(shipyardPlanet) !== String(infrastructurePlanet)) return undefined;
  return cap;
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
      "Special: each crawler adds +0.02% to this planet's metal, crystal, and deuterium mine production, counting up to 8 crawlers per combined mine level (Metal Mine + Crystal Mine + Deuterium Synthesizer) and capped at a +50% total bonus.",
    ];
  }

  return [ship.description];
}

function shipDetailSections({
  affordable,
  capStats,
  durationSeconds,
  energyPerUnit,
  owned,
  ship,
  totalCost,
  unitCost,
}: {
  affordable: boolean;
  capStats?: ProductionDetailStat[] | undefined;
  durationSeconds: number | undefined;
  energyPerUnit: string | undefined;
  owned: number | undefined;
  ship: (typeof shipCatalog)[number];
  totalCost: Resources | undefined;
  unitCost: Resources | undefined;
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
        ...(capStats ?? []),
        ...(energyPerUnit === undefined
          ? []
          : [{ label: "Energy output", value: energyPerUnit, wide: true } as const]),
        {
          label: "Total cost",
          value: totalCost ? formatProductionPrice(totalCost) : "-",
          tone: totalCost && !affordable ? "danger" : "normal",
          wide: true,
        },
        { label: "Per unit", value: unitCost ? formatProductionPrice(unitCost) : "-", wide: true },
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
      : levels.research[requirement.key as keyof typeof levels.research] ?? 0;

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
  transactionUnavailableReason,
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
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!canTransact) return transactionUnavailableReason ?? "Wallet or game connection unavailable";
  if (!shipyardState) return "Waiting for chain state";
  if (shipyardState.productionAvailable === false) return "Ship production unavailable";
  if (shipUnavailable) return "Ship currently unavailable";
  if (!hasPlanet) return "No game planet";
  if (missing.length > 0) return missing[0];
  if (!resources) return RESOURCES_UNAVAILABLE;
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
