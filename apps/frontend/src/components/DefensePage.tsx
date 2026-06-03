import { useState } from "preact/hooks";
import type { BuildingKey, DefenseKey, ResearchKey, Resources, UnlockRequirement } from "../playableMvp";
import { canAfford, defenseCatalog, defenseCombatStats, missingUnlockRequirements } from "../playableMvp";
import { formatMissingResources } from "../buildingDetails";
import { activeProductionQueue } from "../productionQueueFallback";
import type { ChainDefenseState } from "../walletFlow";
import {
  Notice,
  ProductionCatalog,
  type ProductionCatalogItem,
  type ProductionRequirementState,
  productionQueueViewModel,
} from "./ProductionCatalog";
import type { RequirementTarget } from "./RequirementFlairs";
import { InlineSyncIndicator, VeydriftLoader } from "./VeydriftLoader";

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
  onBuild: (defenseId: number, key: DefenseKey, quantity: number) => void;
  onFinish: () => void;
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

const missileThumbnailFrames: Partial<Record<DefenseKey, { transform: string }>> = {
  antiBallisticMissile: {
    transform: "translate(-6%, -5%) scale(1.25)",
  },
  interplanetaryMissile: {
    transform: "translate(4%, 5%) scale(0.98)",
  },
};

export function DefensePage({
  actionState,
  canTransact,
  defenseState,
  error,
  loading,
  onBuild,
  onFinish,
  onOpenRequirement,
  onRefresh,
  onSelectDefense,
  overviewQueue,
  productionRates,
  selectedDefenseKey,
  spendableResources,
}: DefensePageProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [localSelectedKey, setLocalSelectedKey] = useState<DefenseKey>("rocketLauncher");
  const selectedKey = selectedDefenseKey ?? localSelectedKey;
  const shipyardLevel = defenseState?.shipyardLevel ?? 0;
  const resources = toResources(defenseState?.resources);
  const queue = activeProductionQueue(defenseState?.queue, overviewQueue, "defense");
  const productionAvailable = defenseState?.productionAvailable !== false;
  const initialLoading = loading && !defenseState;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Defenses</h2>
          <p className="mt-1 text-xs text-slate-400">
            {defenseState?.homePlanetId
              ? `Planet #${defenseState.homePlanetId} · Shipyard Level ${shipyardLevel}`
              : productionAvailable
                ? "On-chain VeydriftGame planet required for defense production"
                : "Defense production contract unavailable on this deployment"}
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
        defenseState={defenseState}
        error={error}
        loading={loading}
      />

      {initialLoading ? (
        <VeydriftLoader label="Reading defenses" />
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
            productionRates,
            quantities,
            queue,
            resources: spendableResources ?? resources,
          })}
          onBuild={(item) => onBuild(item.id, item.key, item.quantity)}
          onFinishQueue={onFinish}
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

function StatusPanel({
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
  if (loading && defenseState) {
    return <InlineSyncIndicator label="Refreshing defenses" />;
  }

  if (loading) {
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

  if (actionState.status !== "idle") {
    const tone = actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "neutral";
    return <Notice tone={tone}>{actionState.label}</Notice>;
  }

  return null;
}

type DefenseRequirementState = ProductionRequirementState;

export function defenseProductionItems({
  actionPending,
  canTransact,
  defenseState,
  productionAvailable,
  productionRates,
  quantities,
  queue,
  resources,
}: {
  actionPending: boolean;
  canTransact: boolean;
  defenseState: ChainDefenseState | null;
  productionAvailable: boolean;
  productionRates?: Resources | undefined;
  quantities: Record<string, number>;
  queue?: ChainDefenseState["queue"] | undefined;
  resources: Resources | undefined;
}): ProductionCatalogItem<DefenseKey>[] {
  return defenseCatalog.map((defense) => {
    const chainDefense = defenseState?.defenses.find((item) => item.id === defense.id);
    const deployed = productionAvailable ? chainDefense?.count : undefined;
    const baseCost = productionAvailable ? toResources(chainDefense?.cost) : undefined;
    const quantity = quantities[defense.key] ?? 1;
    const totalCost = baseCost ? multiply(baseCost, quantity) : undefined;
    const missing = getMissingRequirements(defense, defenseState);
    const requirements = getDefenseRequirementStates(defense, defenseState);
    const limitReason = getDefenseLimitReason(defense.key, quantity, defenseState, queue);
    const affordable = resources && totalCost ? canAfford(resources, totalCost) : false;
    const queueBlocker = getQueueBlocker(defense.id, queue);
    const blockedReason = getBlockedReason({
      affordable,
      canTransact,
      defenseState,
      hasPlanet: Boolean(defenseState?.homePlanetId),
      limitReason,
      missing,
      productionRates,
      queueBlocker,
      resources,
      totalCost,
    });
    const disabled = Boolean(blockedReason) || actionPending;
    const queued = queuedDefenseCount(defense.id, queue);
    const combatStats = defenseCombatStats(defense);
    const stats = combatStats.rows.map((row) => `${row.label} ${row.value}`).join(" · ");

    return {
      actionLabel: queued > 0 ? "Add" : "Build",
      asset: defense.asset,
      blockedReason,
      cost: totalCost,
      countLabel: "Deployed",
      countValue: deployed,
      description: defenseDescriptions[defense.key],
      detailNote: stats || (defense.group === "missile" ? "Missile support system" : "Planetary defense"),
      detailStats: combatStats.rows.map((row) => ({
        hint: row.hint,
        label: row.label,
        value: formatStatValue(row.value),
      })),
      disabled,
      group: defense.group,
      groupLabel: groupLabels[defense.group],
      id: defense.id,
      key: defense.key,
      label: defense.label,
      missing,
      quantity,
      queued,
      requirements,
      notes: combatStats.notes,
      status: queued > 0 ? "queued" : missing.length === 0 ? "ready" : "locked",
      statusLabel: queued > 0 ? "Queued" : missing.length === 0 ? "Ready" : "Locked",
      thumbnailStyle: missileThumbnailFrames[defense.key],
    };
  });
}

function formatStatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

const defenseDescriptions: Record<DefenseKey, string> = {
  rocketLauncher: "Baseline kinetic defense that is cheap to deploy and useful as early battle mass.",
  lightLaser: "Energy defense with efficient early attack once Energy and Laser research are online.",
  heavyLaser: "Heavier beam emplacement with stronger attack and hull than Light Laser batteries.",
  smallShieldDome: "Planetary shield dome that adds a one-per-planet defensive barrier.",
  gaussCannon: "Magnetic accelerator defense with high armor-piercing attack power.",
  ionCannon: "Ionized-particle defense with strong shield profile and specialized energy output.",
  plasmaTurret: "Top-tier static weapon with heavy attack against advanced fleets.",
  largeShieldDome: "Upgraded shield dome for late-game planetary defense; limited to one per planet.",
  antiBallisticMissile: "Silo interceptor that automatically counters incoming interplanetary missiles.",
  interplanetaryMissile: "Long-range missile ordnance used to attack enemy planetary defenses.",
};

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
  productionRates,
  queueBlocker,
  resources,
  totalCost,
}: {
  affordable: boolean;
  canTransact: boolean;
  defenseState?: ChainDefenseState | null | undefined;
  hasPlanet: boolean;
  limitReason?: string | undefined;
  missing: string[];
  productionRates?: Resources | undefined;
  queueBlocker?: string | undefined;
  resources: Resources | undefined;
  totalCost?: Resources | undefined;
}): string | undefined {
  if (!canTransact) return "Wallet or game contract unavailable";
  if (!defenseState) return "Waiting for chain state";
  if (defenseState.productionAvailable === false) return "Defense production unavailable";
  if (!hasPlanet) return "No game planet";
  if (queueBlocker) return queueBlocker;
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
  if (!queue?.active || queue.itemId === defenseId) return undefined;
  const activeDefense = defenseCatalog.find((item) => item.id === queue.itemId);
  return `Active queue: ${activeDefense?.label ?? "another defense"}`;
}

function queuedDefenseCount(defenseId: number, queue?: ChainDefenseState["queue"] | undefined): number {
  return queue?.active && queue.itemId === defenseId ? queue.quantity ?? 0 : 0;
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
