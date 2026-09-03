import { useState } from "preact/hooks";
import type { BuildingKey, DefenseKey, ResearchKey, Resources, UnlockRequirement } from "../playableMvp";
import { canAfford, defenseCatalog, defenseCombatStats, missingUnlockRequirements } from "../playableMvp";
import { formatMissingResources } from "../buildingDetails";
import { activeProductionQueue } from "../productionQueueFallback";
import { supplyResourceShortfall, type SupplyResources } from "../batchSupplyPlanner";
import { walletRecoveryActionMessage, type ChainDefenseState } from "../walletFlow";
import {
  adaptProductionItems,
  maxAffordableProductionQuantity,
  Notice,
  ProductionSection,
  type ProductionCatalogItem,
  type ProductionQuantityInput,
  type ProductionRequirementState,
  productionQueueViewModel,
  scaleProductionCost,
} from "./ProductionCatalog";
import { refreshButtonState } from "./PageHeader";
import type { RequirementTarget } from "./RequirementFlairs";
import { ProductionCatalogSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import type { ConstructionProgress } from "../constructionProgress";

type DefenseActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface DefensePageProps {
  actionState: DefenseActionState;
  canTransact: boolean;
  defenseState: ChainDefenseState | null;
  error: string | undefined;
  loading: boolean;
  now?: number | undefined;
  onBuild: (defenseId: number, key: DefenseKey, quantity: number) => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onSelectDefense?: ((key: DefenseKey) => void) | undefined;
  onSupply?: ((resources: SupplyResources) => void) | undefined;
  overviewQueue?: ChainDefenseState["queue"] | undefined;
  productionRates?: Resources | undefined;
  progressState?: ConstructionProgress | undefined;
  selectedDefenseKey?: DefenseKey | undefined;
  spendableResources?: Resources | undefined;
  transactionUnavailableReason?: string | undefined;
}

const groupLabels = {
  kinetic: "Kinetic batteries",
  energy: "Energy weapons",
  shield: "Shield domes",
  missile: "Missiles",
} as const;

export function defenseRefreshButtonState(loading: boolean): { disabled: boolean; label: "Refresh" | "Refreshing" } {
  return refreshButtonState(loading);
}

export function shouldShowDefenseInitialLoader({
  defenseState,
  loading,
}: {
  defenseState?: ChainDefenseState | null | undefined;
  loading: boolean;
}): boolean {
  return loading && !defenseState;
}

export function DefensePage({
  actionState,
  canTransact,
  defenseState,
  error,
  loading,
  now,
  onBuild,
  onOpenRequirement,
  onSelectDefense,
  onSupply,
  overviewQueue,
  productionRates,
  progressState,
  selectedDefenseKey,
  spendableResources,
  transactionUnavailableReason,
}: DefensePageProps) {
  const [localSelectedKey, setLocalSelectedKey] = useState<DefenseKey>("rocketLauncher");
  const selectedKey = selectedDefenseKey ?? localSelectedKey;
  // VEY-KANEO-473: gate on the canonical settled-to-now balance (`resourcesAsOfNow`) the top bar
  // uses, falling back to the raw settled snapshot only when the accrued field is absent — so the
  // defense affordability number can never disagree with the bar.
  const resources = toResources(defenseState?.resourcesAsOfNow ?? defenseState?.resources);
  const queue = activeProductionQueue(defenseState?.queue, overviewQueue, "defense");
  const productionAvailable = defenseState?.productionAvailable !== false;
  const initialLoading = shouldShowDefenseInitialLoader({ defenseState, loading });

  return (
    <div className="grid gap-4">
      <StatusPanel
        actionState={actionState}
        defenseState={defenseState}
        error={error}
        loading={loading}
      />

      {initialLoading ? (
        <ProductionCatalogSkeleton groups={[2, 4, 2, 2]} label="Loading defenses" />
      ) : (
        <ProductionSection
          actionPending={actionState.status === "pending"}
          canTransact={canTransact}
          emptyLabel="Select a defense to review costs, requirements, and production controls."
          items={(quantities) => defenseProductionItems({
            actionPending: actionState.status === "pending",
            canTransact,
            defenseState,
            productionAvailable,
            quantities,
            queue,
            resources: spendableResources ?? resources,
            productionRates,
            transactionUnavailableReason,
          })}
          now={now}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
          onOpenRequirement={onOpenRequirement}
          onSelect={(key) => {
            setLocalSelectedKey(key);
            onSelectDefense?.(key);
          }}
          onSupply={onSupply}
          queue={productionQueueViewModel(queue, defenseCatalog)}
          queueProgress={progressState}
          queueTone="rose"
          selectedKey={selectedKey}
        />
      )}
    </div>
  );
}

export function StatusPanel({
  actionState,
  defenseState,
  error,
  loading,
}: {
  actionState: DefenseActionState;
  defenseState?: ChainDefenseState | null | undefined;
  error: string | undefined;
  loading: boolean;
}) {
  // Only suppress notices during the initial load (no state yet). Keeping the
  // last notice visible across refreshes avoids a blink/layout-jump when state
  // is silently re-fetched.
  if (loading && !defenseState) {
    return null;
  }

  const walletRecoveryMessage = walletRecoveryActionMessage(error ?? defenseState?.unavailableReason);
  if (walletRecoveryMessage) {
    return <Notice tone="danger">{walletRecoveryMessage}</Notice>;
  }

  if (error) {
    if (isGameUnavailableMessage(error)) return <GameUnavailableNotice />;
    if (defenseState) return <Notice tone="neutral">Refreshing defense state: {error}</Notice>;
    return <Notice tone="danger">Defense state could not be loaded. Refresh or try again in a moment.</Notice>;
  }

  // A planet switch can briefly have no cache entry before the canonical store
  // begins its selected-planet read. That is pending state, never evidence that
  // this wallet has no home planet.
  if (!defenseState) return null;

  if (defenseState?.productionAvailable === false) {
    return (
      <Notice tone="neutral">
        {defenseState.unavailableReason ?? "Defense production is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!defenseState.homePlanetId) {
    return (
      <Notice tone="danger">
        No VeydriftGame home planet was found for this wallet. Defense counts and production are not shown from local state.
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

type DefenseRequirementState = ProductionRequirementState;

export function defenseProductionItems({
  actionPending,
  canTransact,
  defenseState,
  productionAvailable,
  quantities,
  queue,
  resources,
  productionRates,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  canTransact: boolean;
  defenseState: ChainDefenseState | null;
  productionAvailable: boolean;
  quantities: Record<string, ProductionQuantityInput>;
  queue?: ChainDefenseState["queue"] | undefined;
  resources: Resources | undefined;
  productionRates?: Resources | undefined;
  transactionUnavailableReason?: string | undefined;
}): ProductionCatalogItem<DefenseKey>[] {
  return adaptProductionItems(defenseCatalog, quantities, (defense, { quantity, quantityValid }) => {
    const chainDefense = defenseState?.defenses.find((item) => item.id === defense.id);
    // The contract lazily settles production.  The API projects whole units that
    // have elapsed from a timed queue, while the canonical defense count remains
    // unchanged until the next state-changing call.  Show that effective count
    // here so a partially completed batch cannot read "19 deployed / 2 of 4
    // complete" at the same time.
    const deployed = productionAvailable && chainDefense
      ? chainDefense.count + completedDefenseCount(defense.id, queue)
      : undefined;
    const baseCost = productionAvailable && chainDefense
      ? resolveDefenseUnitCost(defense.baseCost, chainDefense.cost)
      : undefined;
    const totalCost = baseCost && quantityValid ? scaleProductionCost(baseCost, quantity) : undefined;
    // Backend-sourced per-unit build time scaled by the selected quantity (VEY-KANEO-472).
    const durationSeconds = chainDefense?.durationSeconds === undefined
      ? undefined
      : chainDefense.durationSeconds * quantity;
    const missing = getMissingRequirements(defense, defenseState);
    const requirements = getDefenseRequirementStates(defense, defenseState);
    const limitReason = getDefenseLimitReason(defense.key, quantity, defenseState, queue);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const blockedReason = quantityValid ? getBlockedReason({
      affordable,
      canTransact,
      defenseState,
      hasPlanet: Boolean(defenseState?.homePlanetId),
      limitReason,
      missing,
      resources,
      totalCost,
      productionRates,
      transactionUnavailableReason,
    }) : undefined;
    const disabled = Boolean(blockedReason) || actionPending;
    const queued = queuedDefenseCount(defense.id, queue);
    const combatStats = defenseCombatStats(defense);
    const stats = combatStats.rows.map((row) => `${row.label} ${formatStatValue(row.value)}`).join(" · ");

    return {
      actionLabel: "Build",
      blockedReason,
      cost: totalCost,
      costAffordable: totalCost === undefined ? undefined : affordable,
      unitCost: baseCost,
      maxQuantity: boundedDefenseMaxQuantity(
        maxAffordableProductionQuantity(resources, baseCost),
        defense.key,
        defenseState,
        queue,
      ),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "Deployed",
      countValue: deployed,
      detailNote: stats || (defense.group === "missile" ? "Missile support system" : "Planetary defense"),
      disabled,
      groupLabel: groupLabels[defense.group],
      labelTone: blockedReason ? "muted" : "normal",
      missing,
      notes: [defense.description],
      queued,
      requirements,
      status: queued > 0 ? "queued" : missing.length === 0 ? "ready" : "locked",
      statusLabel: undefined,
      supplyRequest: supplyResourceShortfall(resources, totalCost),
    };
  });
}

function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

export function getMissingDefenseRequirements(
  defense: (typeof defenseCatalog)[number],
  defenseState?: ChainDefenseState | null | undefined,
): string[] {
  return getMissingRequirements(defense, defenseState);
}

function getMissingRequirements(
  defense: (typeof defenseCatalog)[number],
  defenseState?: ChainDefenseState | null | undefined,
): string[] {
  return missingUnlockRequirements(defense.requirements, {
    buildings: {
      shipyard: defenseState?.shipyardLevel ?? 0,
      missileSilo: defenseState?.missileSiloLevel ?? 0,
    },
    research: technologyLevelsByKey(defenseState?.technologyLevels),
  });
}

export function getDefenseRequirementStates(
  defense: (typeof defenseCatalog)[number],
  defenseState?: ChainDefenseState | null | undefined,
): DefenseRequirementState[] {
  const levels = {
    buildings: {
      shipyard: defenseState?.shipyardLevel ?? 0,
      missileSilo: defenseState?.missileSiloLevel ?? 0,
    },
    research: technologyLevelsByKey(defenseState?.technologyLevels),
  };

  return uniqueDefenseRequirements(defense.requirements).map((requirement) => {
    const actual = requirement.kind === "building"
      ? levels.buildings[requirement.key as keyof typeof levels.buildings] ?? 0
      : levels.research[requirement.key as ResearchKey] ?? 0;

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

function uniqueDefenseRequirements(requirements: readonly UnlockRequirement[]): UnlockRequirement[] {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = `${requirement.kind}:${requirement.key ?? requirement.label}:${requirement.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getDefenseLimitReason(
  key: DefenseKey,
  quantity: number,
  defenseState?: ChainDefenseState | null | undefined,
  queue?: ChainDefenseState["queue"] | undefined,
): string | undefined {
  if (!defenseState) return undefined;

  const count = defenseCount(defenseState, key) + queuedDefenseCountByKey(key, queue);
  if ((key === "smallShieldDome" || key === "largeShieldDome") && count + quantity > 1) {
    return "One shield dome of this type per planet";
  }

  const slotsPerUnit = key === "antiBallisticMissile" ? 1 : key === "interplanetaryMissile" ? 2 : 0;
  if (slotsPerUnit === 0) return undefined;

  const usedSlots =
    defenseCount(defenseState, "antiBallisticMissile")
    + queuedDefenseCountByKey("antiBallisticMissile", queue)
    + (defenseCount(defenseState, "interplanetaryMissile") + queuedDefenseCountByKey("interplanetaryMissile", queue)) * 2;
  const capacity = (defenseState.missileSiloLevel ?? 0) * 10;
  return usedSlots + slotsPerUnit * quantity > capacity ? "Missile Silo capacity full" : undefined;
}

function getBlockedReason({
  affordable,
  canTransact,
  defenseState,
  hasPlanet,
  limitReason,
  missing,
  resources,
  totalCost,
  productionRates,
  transactionUnavailableReason,
}: {
  affordable: boolean;
  canTransact: boolean;
  defenseState?: ChainDefenseState | null | undefined;
  hasPlanet: boolean;
  limitReason?: string | undefined;
  missing: string[];
  resources: Resources | undefined;
  totalCost?: Resources | undefined;
  productionRates?: Resources | undefined;
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!canTransact) return transactionUnavailableReason ?? "Wallet or game contract unavailable";
  if (!defenseState) return "Waiting for chain state";
  if (defenseState.productionAvailable === false) return "Defense production unavailable";
  if (!hasPlanet) return "No game planet";
  if (missing.length > 0) return missing[0];
  if (limitReason) return limitReason;
  if (!resources) return "Resources unavailable";
  if (!affordable && totalCost) return formatMissingResources(resources, totalCost, productionRates);
  if (!affordable) return "Insufficient resources";
  return undefined;
}

export function getQueueBlocker(
  defenseId: number,
  queue?: ChainDefenseState["queue"] | undefined,
): string | undefined {
  void defenseId;
  void queue;
  return undefined;
}

function queuedDefenseCount(defenseId: number, queue?: ChainDefenseState["queue"] | undefined): number {
  let quantity = queue?.active && queue.itemId === defenseId ? queue.quantity ?? 0 : 0;
  for (const backlog of queue?.backlog ?? []) {
    // Recovered legacy FIFO entries can omit `active`; an entry is still queued
    // unless it is explicitly inactive, so it belongs in the selector total.
    if (backlog.active !== false && backlog.itemId === defenseId) {
      quantity += backlog.quantity ?? 0;
    }
  }
  return quantity;
}

function completedDefenseCount(defenseId: number, queue?: ChainDefenseState["queue"] | undefined): number {
  const completed = (candidate: NonNullable<ChainDefenseState["queue"]>): number =>
    candidate.itemId === defenseId ? candidate.asOfNow?.completedQuantity ?? 0 : 0;
  let quantity = queue?.active ? completed(queue) : 0;
  for (const backlog of queue?.backlog ?? []) {
    if (backlog.active) quantity += completed(backlog);
  }
  return quantity;
}

function queuedDefenseCountByKey(key: DefenseKey, queue?: ChainDefenseState["queue"] | undefined): number {
  const defense = defenseCatalog.find((item) => item.key === key);
  return defense ? queuedDefenseCount(defense.id, queue) : 0;
}

function defenseCount(defenseState: ChainDefenseState, key: DefenseKey): number {
  const defense = defenseCatalog.find((item) => item.key === key);
  if (!defense) return 0;
  return defenseState.defenses.find((item) => item.id === defense.id)?.count ?? 0;
}

function boundedDefenseMaxQuantity(
  affordableMaximum: number | undefined,
  key: DefenseKey,
  defenseState: ChainDefenseState | null,
  queue: ChainDefenseState["queue"] | undefined,
): number | undefined {
  if (!defenseState) return affordableMaximum;
  const queued = queuedDefenseCountByKey(key, queue);
  let rulesMaximum: number | undefined;

  if (key === "smallShieldDome" || key === "largeShieldDome") {
    rulesMaximum = Math.max(0, 1 - defenseCount(defenseState, key) - queued);
  } else if (key === "antiBallisticMissile" || key === "interplanetaryMissile") {
    const usedSlots =
      defenseCount(defenseState, "antiBallisticMissile")
      + queuedDefenseCountByKey("antiBallisticMissile", queue)
      + (defenseCount(defenseState, "interplanetaryMissile") + queuedDefenseCountByKey("interplanetaryMissile", queue)) * 2;
    const slotsPerUnit = key === "antiBallisticMissile" ? 1 : 2;
    rulesMaximum = Math.max(0, Math.floor(((defenseState.missileSiloLevel ?? 0) * 10 - usedSlots) / slotsPerUnit));
  }

  if (rulesMaximum === undefined) return affordableMaximum;
  return affordableMaximum === undefined ? rulesMaximum : Math.min(affordableMaximum, rulesMaximum);
}

function toResources(resources: ChainDefenseState["resources"] | ChainDefenseState["defenses"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

export function resolveDefenseUnitCost(
  catalogCost: Resources,
  reportedCost: ChainDefenseState["defenses"][number]["cost"] | null | undefined,
): Resources | undefined {
  const parsed = toResources(reportedCost);
  if (!parsed) return undefined;
  if (hasResourceCost(parsed) || !hasResourceCost(catalogCost)) return parsed;
  return catalogCost;
}

function hasResourceCost(resources: Resources): boolean {
  return resources.metal !== 0 || resources.crystal !== 0 || resources.deuterium !== 0;
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
