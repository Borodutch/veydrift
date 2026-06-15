import { useState } from "preact/hooks";
import type { BuildingKey, DefenseKey, ResearchKey, Resources, UnlockRequirement } from "../playableMvp";
import { canAfford, defenseCatalog, defenseCombatStats, missingUnlockRequirements } from "../playableMvp";
import { formatMissingResources } from "../buildingDetails";
import { activeProductionQueue } from "../productionQueueFallback";
import type { ChainDefenseState } from "../walletFlow";
import {
  Notice,
  parseProductionQuantity,
  ProductionCatalog,
  type ProductionCatalogItem,
  type ProductionQuantityInput,
  type ProductionRequirementState,
  productionQueueViewModel,
} from "./ProductionCatalog";
import { PageHeader, RefreshButton, refreshButtonState } from "./PageHeader";
import type { RequirementTarget } from "./RequirementFlairs";
import { CatalogSkeleton } from "./LoadingSkeletons";

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
  overviewQueue?: ChainDefenseState["queue"] | undefined;
  productionRates?: Resources | undefined;
  selectedDefenseKey?: DefenseKey | undefined;
  spendableResources?: Resources | undefined;
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
  onRefresh,
  onSelectDefense,
  overviewQueue,
  productionRates,
  selectedDefenseKey,
  spendableResources,
}: DefensePageProps) {
  const [quantities, setQuantities] = useState<Record<string, ProductionQuantityInput>>({});
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
      <PageHeader
        actions={<RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh defense state" />}
        title="Defenses"
      />

      <StatusPanel
        actionState={actionState}
        defenseState={defenseState}
        error={error}
        loading={loading}
      />

      {initialLoading ? (
        <CatalogSkeleton label="Loading defenses" />
      ) : (
        <ProductionCatalog
          actionPending={actionState.status === "pending"}
          canTransact={canTransact}
          emptyLabel="Select a defense to review costs, requirements, and production controls."
          items={defenseProductionItems({
            actionPending: actionState.status === "pending",
            canTransact,
            defenseState,
            productionAvailable,
            quantities,
            queue,
            resources: spendableResources ?? resources,
            productionRates,
          })}
          now={now}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
          onOpenRequirement={onOpenRequirement}
          onQuantity={(key, quantity) => setQuantities((prev) => ({ ...prev, [key]: quantity }))}
          onSelect={(key) => {
            setLocalSelectedKey(key);
            onSelectDefense?.(key);
          }}
          queue={productionQueueViewModel(queue, defenseCatalog)}
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

  if (error) {
    if (defenseState) return <Notice tone="neutral">Refreshing defense state: {error}</Notice>;
    return <Notice tone="danger">Defense state could not be loaded from the backend. Refresh or try again after deployment sync.</Notice>;
  }

  if (defenseState?.productionAvailable === false) {
    return (
      <Notice tone="neutral">
        {defenseState.unavailableReason ?? "Defense production is not available for the currently configured contract."}
      </Notice>
    );
  }

  if (!defenseState?.homePlanetId) {
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
}: {
  actionPending: boolean;
  canTransact: boolean;
  defenseState: ChainDefenseState | null;
  productionAvailable: boolean;
  quantities: Record<string, ProductionQuantityInput>;
  queue?: ChainDefenseState["queue"] | undefined;
  resources: Resources | undefined;
  productionRates?: Resources | undefined;
}): ProductionCatalogItem<DefenseKey>[] {
  return defenseCatalog.map((defense) => {
    const chainDefense = defenseState?.defenses.find((item) => item.id === defense.id);
    const deployed = productionAvailable ? chainDefense?.count : undefined;
    const baseCost = productionAvailable ? toResources(chainDefense?.cost) : undefined;
    const quantityInput = quantities[defense.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
    // Backend-sourced per-unit build time scaled by the selected quantity (VEY-KANEO-472).
    const durationSeconds = chainDefense?.durationSeconds === undefined
      ? undefined
      : chainDefense.durationSeconds * quantity;
    const missing = getMissingRequirements(defense, defenseState);
    const requirements = getDefenseRequirementStates(defense, defenseState);
    const limitReason = getDefenseLimitReason(defense.key, quantity, defenseState, queue);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const blockedReason = getBlockedReason({
      affordable,
      canTransact,
      defenseState,
      hasPlanet: Boolean(defenseState?.homePlanetId),
      limitReason,
      missing,
      resources,
      totalCost,
      productionRates,
    });
    const disabled = Boolean(blockedReason) || actionPending;
    const queued = queuedDefenseCount(defense.id, queue);
    const combatStats = defenseCombatStats(defense);
    const stats = combatStats.rows.map((row) => `${row.label} ${formatStatValue(row.value)}`).join(" · ");

    return {
      actionLabel: queued > 0 ? "Add" : "Build",
      asset: defense.asset,
      blockedReason,
      cost: totalCost,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "Deployed",
      countValue: deployed,
      detailNote: stats || (defense.group === "missile" ? "Missile support system" : "Planetary defense"),
      disabled,
      group: defense.group,
      groupLabel: groupLabels[defense.group],
      id: defense.id,
      key: defense.key,
      label: defense.label,
      missing,
      quantity,
      quantityInput,
      quantityValid: parsedQuantity !== undefined,
      queued,
      requirements,
      status: queued > 0 ? "queued" : missing.length === 0 ? "ready" : "locked",
      statusLabel: queued > 0 ? "Queued" : missing.length === 0 ? "Ready" : "Locked",
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
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
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
    if (backlog.active && backlog.itemId === defenseId) {
      quantity += backlog.quantity ?? 0;
    }
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

function toResources(resources: ChainDefenseState["resources"] | ChainDefenseState["defenses"][number]["cost"] | null | undefined): Resources | undefined {
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
