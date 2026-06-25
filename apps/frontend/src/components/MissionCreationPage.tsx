import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { Coordinates, DebrisField, Planet, PublicStationedDefender } from "../types";
import {
  DEFAULT_MISSION_SPEED_PERCENT,
  MISSION_SPEED_OPTIONS,
  acsDefendHoldingFuel,
  fleetMissionAvailableCargoCapacity,
  fleetMissionCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionShipCount,
  fleetMissionTravelSeconds,
  type AcsDefendFuelBreakdown,
  type FleetDriveLevels,
} from "../fleetMissionRules";
import { defenseAssetByKey, shipAssetByKey } from "../gameAssets";
import { emptyMissionShips, type GalaxyAction, type MissionShipKey, type MissionShips } from "../galaxyActions";
import {
  buildingContractIds,
  defenseCatalog,
  defenseCombatStats,
  productionPerHour,
  researchCatalog,
  shipCatalog,
  shipCombatStats,
  storageCaps,
  type BuildingKey,
  type ShipKey,
} from "../playableMvp";
import { shortAddress, type ChainShipyardState } from "../walletFlow";
import { formatDuration } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { PageHeader } from "./PageHeader";

export type CombatTechLevels = {
  weapons: number;
  shielding: number;
  armor: number;
};

export type MissionCargoDraft = {
  metal?: string | undefined;
  crystal?: string | undefined;
  deuterium?: string | undefined;
};

export type MissionLootRatioDraft = {
  metal: number;
  crystal: number;
  deuterium: number;
};

export type MissionLaunchDraft = {
  speedPercent: number;
  ships: MissionShips;
  cargo?: MissionCargoDraft | undefined;
  lootRatio?: MissionLootRatioDraft | undefined;
  primaryTargetId?: number | undefined;
  quantity?: number | undefined;
  // VEY-KANEO-440: chosen hold window (seconds) for a proactive DefenseHold stationing mission.
  holdSeconds?: number | undefined;
};

export const LOOT_RATIO_TOTAL_PERCENT = 100;
const DEFAULT_LOOT_RATIO: MissionLootRatioDraft = { metal: 34, crystal: 33, deuterium: 33 };
const GREEDY_LOOT_RATIO: MissionLootRatioDraft = { metal: 100, crystal: 0, deuterium: 0 };
const RAID_PLUNDER_BPS = 5_000;
const BPS = 10_000;
const PROBABLE_WIN_POWER_RATIO = 1.35;
const PROBABLE_DEFEAT_POWER_RATIO = 0.85;
const RESOURCE_KEYS = ["metal", "crystal", "deuterium"] as const;
const ZERO_COMBAT_TECH_LEVELS: CombatTechLevels = { weapons: 0, shielding: 0, armor: 0 };

type EnabledGalaxyAction = Extract<GalaxyAction, { enabled: true }>;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export type MissionResourceSnapshot = {
  metal: number;
  crystal: number;
  deuterium: number;
};

type ShipOption = {
  key: MissionShipKey;
  id: number;
  label: string;
  asset: string;
};

type MissionShipInventorySnapshot = {
  ships: Array<{ id: number; count: number }>;
};

export type UnitItem = {
  key: string;
  label: string;
  count: number;
  asset?: string | undefined;
};

export type BattleForecastState =
  | ({
      kind: "uncertain";
      label: "Uncertain";
      detail: string;
      attackerPower: number;
      defenderPower: number | null;
      attackerTechLevels?: CombatTechLevels;
      defenderTechLevels?: CombatTechLevels;
      defenderTechKnown?: boolean;
    })
  | ({
      kind: "win" | "defeat" | "draw";
      label: "Probable win" | "Probable defeat" | "Probable draw";
      detail: string;
      attackerPower: number;
      defenderPower: number;
      attackerTechLevels?: CombatTechLevels;
      defenderTechLevels?: CombatTechLevels;
      defenderTechKnown?: boolean;
    });

export type TargetResourceIntel = {
  current: MissionResourceSnapshot | null;
  projectedArrival: MissionResourceSnapshot | null;
  currentLootable: MissionResourceSnapshot | null;
  projectedArrivalLootable: MissionResourceSnapshot | null;
  projectionDetail: string;
};

export function shouldShowDestinationIntel(action: EnabledGalaxyAction): boolean {
  return action.kind !== "colonize" && action.kind !== "deploy";
}

export function shouldShowReturnTiming(action: EnabledGalaxyAction, hasHoldingBreakdown: boolean): boolean {
  return action.kind !== "colonize" && !hasHoldingBreakdown;
}

// VEY-KANEO-493: the mission ship picker intentionally omits Pathfinder. It is an
// expedition-only vessel and expeditions are not implemented, so it can never be built
// or owned and listing it here would only surface dead, confusing copy. This mirrors the
// shipyard's `shipyardHiddenShipKeys` hiding. The `MissionShips`/`MissionShipKey` model
// keeps `pathfinder` so the on-chain ship enum (index 14) stays aligned.
export const missionShipOptions: ShipOption[] = [
  { key: "smallCargo", id: 0, label: "Small Cargo", asset: shipAssetByKey.smallCargo },
  { key: "lightFighter", id: 1, label: "Light Fighter", asset: shipAssetByKey.lightFighter },
  { key: "recycler", id: 2, label: "Recycler", asset: shipAssetByKey.recycler },
  { key: "colonyShip", id: 3, label: "Colony Ship", asset: shipAssetByKey.colonyShip },
  { key: "largeCargo", id: 4, label: "Large Cargo", asset: shipAssetByKey.largeCargo },
  { key: "heavyFighter", id: 5, label: "Heavy Fighter", asset: shipAssetByKey.heavyFighter },
  { key: "cruiser", id: 6, label: "Cruiser", asset: shipAssetByKey.cruiser },
  { key: "battleship", id: 7, label: "Battleship", asset: shipAssetByKey.battleship },
  { key: "bomber", id: 8, label: "Bomber", asset: shipAssetByKey.bomber },
  { key: "destroyer", id: 10, label: "Destroyer", asset: shipAssetByKey.destroyer },
  { key: "deathstar", id: 11, label: "Dreadstar", asset: shipAssetByKey.deathstar },
  { key: "battlecruiser", id: 12, label: "Battlecruiser", asset: shipAssetByKey.battlecruiser },
  { key: "reaper", id: 13, label: "Reaper", asset: shipAssetByKey.reaper },
];

const cargoShipKeys = new Set<MissionShipKey>(["smallCargo", "largeCargo", "recycler", "colonyShip"]);

export type AcsDefendComposeContext = {
  // Epoch ms when the hostile attack lands. The defending fleet's effective arrival is pinned to this
  // moment on-chain, so the gap between natural arrival and this time is the hold duration.
  hostileArrivalMs: number;
  // Alliance Depot level of the defended planet, which subsidizes holding fuel.
  depotLevel: number;
};

// VEY-KANEO-440: context for a proactive DefenseHold ("Defend Union") compose. Unlike the reactive
// counterplay above, the hold window is chosen by the player rather than pinned to a hostile attack,
// so only the defended planet's Alliance Depot level is needed to preview the holding-fuel subsidy.
export type DefenseHoldComposeContext = {
  depotLevel: number;
};

// VEY-KANEO-440: discrete hold-duration steps offered for a proactive DefenseHold, in hours. Bounded
// by the contract's MIN/MAX_DEFENSE_HOLD_SECONDS (1h–32h).
export const DEFENSE_HOLD_HOUR_OPTIONS = [1, 2, 4, 8, 12, 16, 24, 32] as const;
const DEFAULT_DEFENSE_HOLD_HOURS = 8;
const SECONDS_PER_HOUR = 3_600;

export function MissionCreationPage({
  acsDefendContext,
  acsDefendMode = false,
  action,
  actionPending,
  actionPendingLabel,
  coords,
  defenseHoldContext,
  defenseHoldMode = false,
  attackerCombatTechLevels = ZERO_COMBAT_TECH_LEVELS,
  driveLevels = {},
  joinAttackMode = false,
  nowMs = Date.now(),
  onBack,
  onConfirm,
  originCoords,
  originLabel,
  resources,
  shipyardState,
  submitBlocker,
  target,
}: {
  // VEY-KANEO-440: render the picker for an ACS Defend ("Group defend") counterplay. Like a normal
  // mission it keeps the ship picker and speed control, but adds a hold-duration / holding-fuel /
  // Alliance Depot preview and pins the launch to the hostile attack's arrival.
  acsDefendContext?: AcsDefendComposeContext | undefined;
  acsDefendMode?: boolean | undefined;
  action: EnabledGalaxyAction;
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  coords: Coordinates;
  // VEY-KANEO-440: render a proactive DefenseHold compose — adds a player-chosen hold-duration selector
  // and a travel + holding-fuel + Alliance Depot preview, stationing the fleet at the target planet.
  defenseHoldContext?: DefenseHoldComposeContext | undefined;
  defenseHoldMode?: boolean | undefined;
  attackerCombatTechLevels?: CombatTechLevels | undefined;
  driveLevels?: FleetDriveLevels | undefined;
  // VEY-KANEO-431: render the picker for a join-attack — ship selection only,
  // with no loot ratio or speed controls (the join inherits the lead attack's
  // loot split and coordinated arrival).
  joinAttackMode?: boolean | undefined;
  // Injectable clock so hold-duration math is deterministic in tests.
  nowMs?: number | undefined;
  onBack: () => void;
  onConfirm: (draft: MissionLaunchDraft) => void;
  originCoords: Coordinates | undefined;
  originLabel?: string | undefined;
  resources?: MissionResourceSnapshot | undefined;
  shipyardState: ChainShipyardState | null;
  submitBlocker?: string | undefined;
  target: Planet | undefined;
}) {
  const [speedPercent, setSpeedPercent] = useState(DEFAULT_MISSION_SPEED_PERCENT);
  const [ships, setShips] = useState<MissionShips>(() => initialMissionShips(action));
  const [cargo, setCargo] = useState<MissionCargoDraft>({});
  const [greedyLootEnabled, setGreedyLootEnabled] = useState(false);
  const [lootRatio, setLootRatio] = useState<MissionLootRatioDraft>(DEFAULT_LOOT_RATIO);
  const [primaryTargetId, setPrimaryTargetId] = useState(action.mode === "missile" ? action.primaryTargetId : 0);
  const [quantity, setQuantity] = useState(action.mode === "missile" ? action.quantity : 1);
  const [holdHours, setHoldHours] = useState<number>(DEFAULT_DEFENSE_HOLD_HOURS);

  const distance = originCoords ? fleetMissionDistance(originCoords, coords) : 0;
  const travelSeconds = action.mode === "missile" ? 0 : fleetMissionTravelSeconds(distance, ships, driveLevels, speedPercent);
  const fuelCost = action.mode === "missile" ? 0 : fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  const totalCargoCapacity = action.mode === "missile" ? 0 : fleetMissionCargoCapacity(ships);
  const cargoCapacity = action.mode === "missile" ? 0 : fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  const selectedShipCount = action.mode === "missile" ? 0 : fleetMissionShipCount(ships);
  const availableShips = useMemo(() => missionShipOptionsForAction(action, shipyardState), [action, shipyardState]);
  const cargoSupported = action.mode === "mission" && (action.kind === "transport" || action.kind === "deploy");
  const destinationIntelVisible = shouldShowDestinationIntel(action);
  const cargoTotal = resourceDraftNumber(cargo.metal) + resourceDraftNumber(cargo.crystal) + resourceDraftNumber(cargo.deuterium);
  const lootRatioSupported = !joinAttackMode && !acsDefendMode && action.mode === "mission" && action.kind === "attack";
  const lootRatioActive = lootRatioSupported && !greedyLootEnabled;
  const displayedLootRatio = lootRatioActive ? lootRatio : GREEDY_LOOT_RATIO;
  const lootRatioTotal = displayedLootRatio.metal + displayedLootRatio.crystal + displayedLootRatio.deuterium;
  const timingSummary = missionTimingSummary(travelSeconds, nowMs);
  const stationedDefenders = action.kind === "attack" && action.mode === "mission"
    ? target?.publicState?.stationedDefenders ?? []
    : [];
  const stationedDefenderRows = stationedDefenderAttackWarningRows(stationedDefenders);
  const targetFleetUnits = useMemo(() => compositionUnits(target?.publicState?.fleet, shipCatalog, shipAssetByKey), [target?.publicState?.fleet]);
  const targetDefenseUnits = useMemo(() => compositionUnits(target?.publicState?.defenses, defenseCatalog, defenseAssetByKey), [target?.publicState?.defenses]);
  const stationedDefenderUnits = useMemo(
    () => stationedDefenderCompositionUnits(stationedDefenders),
    [stationedDefenders],
  );
  const battleForecast = useMemo(
    () => publicTargetBattleForecast(ships, target, attackerCombatTechLevels),
    [attackerCombatTechLevels, ships, target],
  );
  const resourceIntel = useMemo(
    () => targetResourceIntel(target, travelSeconds),
    [target, travelSeconds],
  );
  const staleShipQuantityBlocker = useMemo(
    () => staleSelectedShipQuantityBlocker(action, ships, shipyardState),
    [action, ships, shipyardState],
  );
  const maxLootForecast = useMemo(
    () => forecastRaidLoot(resourceIntel.projectedArrivalLootable, cargoCapacity, greedyLootEnabled ? null : lootRatio),
    [cargoCapacity, greedyLootEnabled, lootRatio, resourceIntel.projectedArrivalLootable],
  );

  // VEY-KANEO-440: ACS Defend holding-fuel preview. The fleet arrives naturally after `travelSeconds`,
  // then holds until the hostile attack lands; holding fuel scales with that gap and the Alliance Depot
  // on the defended planet subsidizes part of it. A fleet that cannot arrive before the attack is
  // rejected on-chain, so flag it here too.
  const acsActive = acsDefendMode && action.mode === "mission" && Boolean(acsDefendContext);
  const naturalArrivalMs = nowMs + Math.ceil(travelSeconds) * 1_000;
  const rawHoldSeconds = acsActive && acsDefendContext
    ? Math.floor((acsDefendContext.hostileArrivalMs - naturalArrivalMs) / 1_000)
    : 0;
  const acsArrivalTooSlow = acsActive && selectedShipCount > 0 && rawHoldSeconds < 0;
  // Hold duration depends on the selected fleet's speed, so the preview only makes sense once at least
  // one ship is chosen.
  const acsBreakdown: AcsDefendFuelBreakdown | null = acsActive && acsDefendContext && selectedShipCount > 0
    ? acsDefendHoldingFuel(ships, Math.max(0, rawHoldSeconds), acsDefendContext.depotLevel)
    : null;

  // VEY-KANEO-440: proactive DefenseHold — the hold window is the player's choice (1h–32h), not derived
  // from a hostile arrival. Holding fuel scales with the chosen duration and is subsidized by the target
  // planet's Alliance Depot, exactly as on-chain.
  const defenseHoldActive = defenseHoldMode && action.mode === "mission" && Boolean(defenseHoldContext);
  const defenseHoldSeconds = holdHours * SECONDS_PER_HOUR;
  const defenseHoldBreakdown: AcsDefendFuelBreakdown | null = defenseHoldActive && selectedShipCount > 0
    ? acsDefendHoldingFuel(ships, defenseHoldSeconds, defenseHoldContext?.depotLevel ?? 0)
    : null;

  // Both flows share the same holding-fuel summary; whichever is active drives the preview.
  const holdingBreakdown = acsBreakdown ?? defenseHoldBreakdown;
  const holdDepotLevel = acsDefendContext?.depotLevel ?? defenseHoldContext?.depotLevel ?? 0;
  // Net holding fuel rides in the defending fleet's own deuterium spend on-chain, so it counts toward
  // both the deuterium balance and cargo-capacity gates.
  const effectiveFuelCost = holdingBreakdown ? fuelCost + holdingBreakdown.netHoldingFuel : fuelCost;

  const blockedReason = missionDraftBlocker({
    acsArrivalTooSlow,
    action,
    cargoCapacity,
    cargoSupported,
    cargoTotal,
    fleetSlots: shipyardState?.fleetSlots,
    fleetSlotsUnavailableReason: shipyardState?.fleetLaunchAvailable === false
      ? shipyardState.fleetLaunchUnavailableReason ?? shipyardState.unavailableReason ?? "Fleet slot state is still syncing."
      : undefined,
    fuelCost: effectiveFuelCost,
    lootRatioActive,
    lootRatioTotal,
    originCoords,
    quantity,
    resources,
    selectedShipCount,
    staleShipQuantityBlocker,
    submitBlocker,
    totalCargoCapacity,
  });
  const visibleBlockedReason = actionPending ? undefined : blockedReason;

  const maxCargoResources = {
    metal: Math.max(0, Math.trunc(resources?.metal ?? 0)),
    crystal: Math.max(0, Math.trunc(resources?.crystal ?? 0)),
    deuterium: Math.max(0, Math.trunc((resources?.deuterium ?? 0) - fuelCost)),
  };
  const setShipQuantity = (key: MissionShipKey, value: number, owned: number) => setShips((current) => ({
    ...current,
    [key]: clampInteger(value, 0, owned),
  }));
  const updateLootPercent = (key: ResourceKey, value: number) => {
    setGreedyLootEnabled(false);
    setLootRatio((current) => rebalanceLootRatio(current, key, value));
  };
  const updateLootAmount = (key: ResourceKey, value: number) => {
    setGreedyLootEnabled(false);
    setLootRatio((current) => lootRatioFromUpToAmount(current, key, value, cargoCapacity));
  };

  return (
    <section className="grid gap-4 p-4 sm:p-5 lg:p-6">
      <PageHeader
        actions={(
          <button
            className="rounded-md border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
            onClick={onBack}
            type="button"
          >
            Back
          </button>
        )}
        beforeTitle={(
          <p className="mb-1 text-xs text-slate-400">
            {originLabel ?? "Active planet"} to [{coords.galaxy}:{coords.system}:{coords.position}]
          </p>
        )}
        title={joinAttackMode || acsDefendMode || defenseHoldMode ? action.label : `${action.label} Mission`}
        titleSize="xl"
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <section className="grid gap-3">
          {lootRatioSupported ? (
            <AttackIntelPanel
              battleForecast={battleForecast}
              coords={coords}
              lootableAtArrival={resourceIntel.projectedArrivalLootable}
              maxLootForecast={maxLootForecast}
              resourceIntel={resourceIntel}
              stationedDefenderUnits={stationedDefenderUnits}
              target={target}
              targetDefenseUnits={targetDefenseUnits}
              targetFleetUnits={targetFleetUnits}
            />
          ) : (
            <NonAttackMissionIntelPanel
              action={action}
              cargoCapacity={cargoCapacity}
              cargoSupported={cargoSupported}
              coords={coords}
              destinationIntelVisible={destinationIntelVisible}
              holdDepotLevel={holdDepotLevel}
              holdingBreakdown={holdingBreakdown}
              resourceIntel={resourceIntel}
              stationedDefenderUnits={stationedDefenderUnits}
              target={target}
              targetDefenseUnits={targetDefenseUnits}
              targetFleetUnits={targetFleetUnits}
            />
          )}

          {stationedDefenderRows.length > 0 ? (
            <div className="rounded border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-sm text-violet-100">
              <p className="font-semibold">Stationed defenders can join this battle.</p>
              <p className="mt-1 text-xs text-violet-100/80">
                Planet fleet and defense counts do not include these held fleets. They can defend
                attacks that land before their hold expires.
              </p>
              <ul className="mt-2 grid gap-1 text-xs text-violet-100/90">
                {stationedDefenderRows.map((row) => (
                  <li className="flex min-w-0 justify-between gap-3" key={row.missionId}>
                    <span className="truncate">{row.label}</span>
                    <span className="shrink-0 tabular-nums">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {action.mode === "missile" ? (
            <MissionFormSection title="Payload" eyebrow="Ordnance">
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label="Missiles"
                  min={1}
                  onChange={setQuantity}
                  value={quantity}
                />
                <NumberField
                  label="Primary target"
                  min={0}
                  onChange={setPrimaryTargetId}
                  value={primaryTargetId}
                />
              </div>
            </MissionFormSection>
          ) : (
            <MissionFormSection title="Fleet" eyebrow="Ships">
              {availableShips.length > 0 ? (
                <div className="grid gap-2">
                  {availableShips.map((ship) => {
                    const owned = shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0;
                    return (
                      <ShipQuantityRow
                        key={ship.key}
                        onChange={(value) => setShipQuantity(ship.key, value, owned)}
                        owned={owned}
                        ship={ship}
                        value={ships[ship.key] ?? 0}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  No eligible ships are available on the active planet.
                </p>
              )}
            </MissionFormSection>
          )}

          {cargoSupported ? (
            <MissionFormSection title="Cargo" eyebrow="Resources">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">Load resources after reserving mission fuel.</p>
                <span className="text-xs text-slate-500">Capacity {cargoCapacity.toLocaleString()}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <ResourceField label="Metal" max={maxCargoResources.metal} onChange={(metal) => setCargo((current) => ({ ...current, metal }))} value={cargo.metal ?? ""} />
                <ResourceField label="Crystal" max={maxCargoResources.crystal} onChange={(crystal) => setCargo((current) => ({ ...current, crystal }))} value={cargo.crystal ?? ""} />
                <ResourceField label="Deuterium" max={maxCargoResources.deuterium} onChange={(deuterium) => setCargo((current) => ({ ...current, deuterium }))} value={cargo.deuterium ?? ""} />
              </div>
            </MissionFormSection>
          ) : null}

          {joinAttackMode ? null : (
            <MissionFormSection title="Speed" eyebrow="Flight plan">
              <div className="flex flex-wrap gap-1.5">
                {MISSION_SPEED_OPTIONS.map((speed) => (
                  <button
                    aria-pressed={speedPercent === speed}
                    className={`h-8 rounded border px-2 text-xs font-semibold transition ${
                      speedPercent === speed
                        ? "border-signal/45 bg-signal/15 text-signal"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                    key={speed}
                    onClick={() => setSpeedPercent(speed)}
                    type="button"
                  >
                    {speed}%
                  </button>
                ))}
              </div>
              {timingSummary ? (
                <div className="grid gap-1 rounded border border-white/10 bg-black/15 p-2">
                  <CompactFactRow label={holdingBreakdown ? "Reach" : "Arrival"} value={`${timingSummary.arrivalDuration} / ${timingSummary.arrivalClock}`} />
                  {shouldShowReturnTiming(action, Boolean(holdingBreakdown)) ? (
                    <CompactFactRow label="Return" value={`${timingSummary.returnDuration} / ${timingSummary.returnClock}`} />
                  ) : null}
                </div>
              ) : null}
            </MissionFormSection>
          )}

          {defenseHoldMode ? (
            <MissionFormSection title="Hold" eyebrow="Stationing">
              <div className="flex flex-wrap gap-1.5">
                {DEFENSE_HOLD_HOUR_OPTIONS.map((hours) => (
                  <button
                    aria-pressed={holdHours === hours}
                    className={`h-8 rounded border px-2 text-xs font-semibold transition ${
                      holdHours === hours
                        ? "border-violet-300/45 bg-violet-300/15 text-violet-200"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                    key={hours}
                    onClick={() => setHoldHours(hours)}
                    type="button"
                  >
                    {hours}h
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                The fleet holds at the target planet for this long, defending any attack that lands while
                stationed, then flies home. Longer holds cost more deuterium.
              </p>
            </MissionFormSection>
          ) : null}

          {lootRatioSupported ? (
            <MissionFormSection title="Loot" eyebrow="Plunder">
              <LootRatioControls
                cargoCapacity={cargoCapacity}
                greedyLootEnabled={greedyLootEnabled}
                lootRatio={displayedLootRatio}
                lootRatioTotal={lootRatioTotal}
                onAmountChange={updateLootAmount}
                onGreedyChange={setGreedyLootEnabled}
                onPercentChange={updateLootPercent}
                onResetEven={() => {
                  setGreedyLootEnabled(false);
                  setLootRatio(DEFAULT_LOOT_RATIO);
                }}
              />
            </MissionFormSection>
          ) : null}
        </section>

        <aside className="grid content-start gap-2 rounded-lg border border-signal/20 bg-[#101624] p-3 shadow-lg shadow-black/20 lg:sticky lg:top-4">
          <h3 className="text-sm font-semibold text-white">Launch</h3>
          <SummaryRow label="Distance" value={distance.toLocaleString()} />
          <SummaryRow label="Ships" value={action.mode === "missile" ? "Missile launch" : selectedShipCount.toLocaleString()} />
          <SummaryRow
            label={holdingBreakdown ? "Travel fuel" : "Fuel"}
            value={`${fuelCost.toLocaleString()} / ${totalCargoCapacity.toLocaleString()} deuterium`}
          />
          {holdingBreakdown ? (
            <>
              <SummaryRow label="Hold duration" value={holdingBreakdown.holdSeconds > 0 ? formatDuration(holdingBreakdown.holdSeconds) : "None"} />
              <SummaryRow label="Holding fuel" value={`${holdingBreakdown.holdingFuel.toLocaleString()} deuterium`} />
              <SummaryRow
                label="Alliance Depot"
                subvalue={`Depot lvl ${holdDepotLevel.toLocaleString()}`}
                value={holdingBreakdown.depotSupport > 0 ? `−${holdingBreakdown.depotSupport.toLocaleString()} deuterium` : "No support"}
              />
              <SummaryRow label="Net holding fuel" value={`${holdingBreakdown.netHoldingFuel.toLocaleString()} deuterium`} />
              <SummaryRow label="Total fuel" value={`${effectiveFuelCost.toLocaleString()} deuterium`} />
            </>
          ) : null}
          <SummaryRow label="Cargo" value={cargoSupported ? `${cargoTotal.toLocaleString()} / ${cargoCapacity.toLocaleString()}` : "None"} />
          {lootRatioSupported ? (
            <SummaryRow
              label="Max loot"
              subvalue={greedyLootEnabled ? "Greedy" : "Manual split"}
              value={formatCompactResources(maxLootForecast)}
            />
          ) : null}
          {timingSummary ? (
            <>
              <SummaryRow label={holdingBreakdown ? "Reach planet" : "Arrival"} subvalue={timingSummary.arrivalClock} value={timingSummary.arrivalDuration} />
              {shouldShowReturnTiming(action, Boolean(holdingBreakdown)) ? (
                <SummaryRow label="Return" subvalue={timingSummary.returnClock} value={timingSummary.returnDuration} />
              ) : null}
            </>
          ) : null}
          {visibleBlockedReason ? (
            <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              {visibleBlockedReason}
            </p>
          ) : null}
          <button
            className="mt-1 min-h-10 rounded border border-signal/35 bg-signal/15 px-3 py-2 text-sm font-semibold leading-snug text-signal transition hover:bg-signal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
            disabled={Boolean(blockedReason) || actionPending}
            onClick={() => onConfirm({
              speedPercent,
              ships,
              cargo: cargoSupported ? normalizeCargoDraft(cargo) : undefined,
              lootRatio: lootRatioActive ? { ...lootRatio } : undefined,
              primaryTargetId,
              quantity,
              holdSeconds: defenseHoldActive ? defenseHoldSeconds : undefined,
            })}
            type="button"
          >
            {missionConfirmButtonLabel({
              acsDefendMode,
              actionPendingLabel,
              defenseHoldMode,
              joinAttackMode,
            })}
          </button>
        </aside>
      </div>
    </section>
  );
}

export function missionConfirmButtonLabel({
  acsDefendMode = false,
  actionPendingLabel,
  defenseHoldMode = false,
  joinAttackMode = false,
}: {
  acsDefendMode?: boolean | undefined;
  actionPendingLabel?: string | undefined;
  defenseHoldMode?: boolean | undefined;
  joinAttackMode?: boolean | undefined;
}): string {
  if (actionPendingLabel) return actionPendingLabel;
  if (joinAttackMode) return "Join Attack";
  if (acsDefendMode) return "Coordinate defense";
  if (defenseHoldMode) return "Station defense";
  return "Confirm Mission";
}

function MissionFormSection({
  children,
  title,
}: {
  children: ComponentChildren;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-3 shadow-sm shadow-black/10">
      <h3 className="text-xs font-semibold uppercase text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function missionDraftBlocker({
  acsArrivalTooSlow = false,
  action,
  cargoCapacity,
  cargoSupported,
  cargoTotal,
  fleetSlots,
  fleetSlotsUnavailableReason,
  fuelCost,
  lootRatioActive = false,
  lootRatioTotal = 0,
  originCoords,
  quantity,
  resources,
  selectedShipCount,
  staleShipQuantityBlocker,
  submitBlocker,
  totalCargoCapacity,
}: {
  // VEY-KANEO-440: true when an ACS Defend fleet is too slow to reach the defended planet before the
  // hostile attack lands (the on-chain FleetAlreadyArrived backstop, surfaced before submit).
  acsArrivalTooSlow?: boolean | undefined;
  action: EnabledGalaxyAction;
  cargoCapacity: number;
  cargoSupported: boolean;
  cargoTotal: number;
  fleetSlots?: { active: number; limit: number } | undefined;
  fleetSlotsUnavailableReason?: string | undefined;
  fuelCost: number;
  lootRatioActive?: boolean | undefined;
  lootRatioTotal?: number | undefined;
  originCoords: Coordinates | undefined;
  quantity: number;
  resources: MissionResourceSnapshot | undefined;
  selectedShipCount: number;
  staleShipQuantityBlocker?: string | undefined;
  submitBlocker?: string | undefined;
  totalCargoCapacity: number;
}): string | undefined {
  if (submitBlocker) return submitBlocker;
  if (!originCoords) return "Active origin planet is unavailable.";
  // Interplanetary missiles do not occupy fleet slots, so they skip the fleet-slot gate below.
  if (action.mode === "missile") return quantity > 0 ? undefined : "Choose at least one missile.";
  // Every fleet mission (attack/transport/deploy/harvest/colonize) consumes a fleet slot, capped by the
  // contract's Computer Technology-derived limit (FleetSlotLimitReached). Block before submit when the
  // cap is reached, and also block while slot state is missing so stale UI cannot open a reverting
  // wallet transaction.
  if (fleetSlotsUnavailableReason) return fleetSlotsUnavailableReason;
  if (!fleetSlots || fleetSlots.limit <= 0) {
    return "Fleet slot state is still loading — wait for Computer Technology limits to sync before launching.";
  }
  if (fleetSlots.active >= fleetSlots.limit) {
    return `Fleet slots full (${fleetSlots.active}/${fleetSlots.limit}) — research Computer Technology to raise the limit, or wait for a fleet to return.`;
  }
  if (selectedShipCount <= 0) return "Choose at least one ship.";
  if (staleShipQuantityBlocker) return staleShipQuantityBlocker;
  if (acsArrivalTooSlow) {
    return "Fleet cannot reach the planet before the attack — pick a faster speed or faster ships.";
  }
  if ((resources?.deuterium ?? 0) < fuelCost) return `Need ${fuelCost.toLocaleString()} deuterium for fuel.`;
  if (fuelCost > totalCargoCapacity) {
    return `Selected ships have ${totalCargoCapacity.toLocaleString()} cargo capacity, but this mission needs ${fuelCost.toLocaleString()} for fuel.`;
  }
  if (cargoSupported && cargoTotal > cargoCapacity) return "Cargo exceeds available capacity.";
  if (cargoSupported && cargoTotal < 0) return "Cargo cannot be negative.";
  if (lootRatioActive && lootRatioTotal !== LOOT_RATIO_TOTAL_PERCENT) {
    return `Loot ratio must total ${LOOT_RATIO_TOTAL_PERCENT}%.`;
  }
  return undefined;
}

export function staleSelectedShipQuantityBlocker(
  action: EnabledGalaxyAction,
  ships: MissionShips,
  shipyardState: MissionShipInventorySnapshot | null,
): string | undefined {
  if (action.mode === "missile" || !shipyardState) return undefined;

  const allowed = allowedShipKeysForAction(action);
  const overSelected = missionShipOptions
    .filter((ship) => allowed.has(ship.key))
    .map((ship) => {
      const selected = Math.max(0, Math.trunc(ships[ship.key] ?? 0));
      const owned = shipyardState.ships.find((item) => item.id === ship.id)?.count ?? 0;
      return selected > owned ? `${ship.label} ${selected.toLocaleString()} selected / ${owned.toLocaleString()} available` : null;
    })
    .filter((row): row is string => Boolean(row));

  if (overSelected.length <= 0) return undefined;
  return `Selected ship quantities are stale: ${overSelected.join(", ")}. Refresh mission state or reduce the quantities before launching.`;
}

export function missionTimingSummary(travelSeconds: number, nowMs: number = Date.now()): {
  arrivalClock: string;
  arrivalDuration: string;
  returnClock: string;
  returnDuration: string;
} | null {
  if (!Number.isFinite(travelSeconds) || travelSeconds <= 0) return null;
  const arrivalSeconds = Math.ceil(travelSeconds);
  const returnSeconds = arrivalSeconds * 2;
  const arrivalAt = nowMs + arrivalSeconds * 1_000;
  const returnAt = nowMs + returnSeconds * 1_000;
  return {
    arrivalClock: formatUserTimestamp(arrivalAt),
    arrivalDuration: formatDuration(arrivalSeconds),
    returnClock: formatUserTimestamp(returnAt),
    returnDuration: formatDuration(returnSeconds),
  };
}

export function initialMissionShips(action: EnabledGalaxyAction): MissionShips {
  if (action.mode === "missile" || action.kind === "attack") return emptyMissionShips();
  return { ...emptyMissionShips(), ...action.ships };
}

function missionShipOptionsForAction(action: EnabledGalaxyAction, shipyardState: ChainShipyardState | null): ShipOption[] {
  if (action.mode === "missile") return [];
  const allowed = allowedShipKeysForAction(action);
  return missionShipOptions.filter((ship) => allowed.has(ship.key) && (shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0) > 0);
}

export function stationedDefenderAttackWarningRows(
  defenders: PublicStationedDefender[] | null | undefined
): Array<{ missionId: string; label: string; value: string }> {
  return (defenders ?? [])
    .filter((defender) => stationedDefenderShipCount(defender.ships) > 0)
    .map((defender) => ({
      missionId: defender.missionId,
      label: defender.defenderDisplayName ?? shortAddress(defender.defender),
      value: `${stationedDefenderShipCount(defender.ships).toLocaleString()} ships until ${formatUserTimestamp(timestampToMs(defender.holdUntil))}`,
    }));
}

function stationedDefenderShipCount(ships: Record<string, string>): number {
  return Object.values(ships).reduce((total, count) => {
    const parsed = Number(count);
    return total + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, 0);
}

function allowedShipKeysForAction(action: EnabledGalaxyAction): Set<MissionShipKey> {
  if (action.kind === "colonize") return new Set(["colonyShip"]);
  if (action.kind === "harvest") return new Set(["recycler"]);
  if (action.kind === "transport" || action.kind === "deploy") return cargoShipKeys;
  return new Set(missionShipOptions.map((ship) => ship.key).filter((key) => key !== "colonyShip"));
}

function normalizeCargoDraft(cargo: MissionCargoDraft): MissionCargoDraft | undefined {
  const normalized = {
    metal: String(resourceDraftNumber(cargo.metal)),
    crystal: String(resourceDraftNumber(cargo.crystal)),
    deuterium: String(resourceDraftNumber(cargo.deuterium)),
  };
  return normalized.metal === "0" && normalized.crystal === "0" && normalized.deuterium === "0"
    ? undefined
    : normalized;
}

export function rebalanceLootRatio(
  current: MissionLootRatioDraft,
  changedKey: ResourceKey,
  rawValue: number,
): MissionLootRatioDraft {
  const value = clampInteger(rawValue, 0, LOOT_RATIO_TOTAL_PERCENT);
  const remaining = LOOT_RATIO_TOTAL_PERCENT - value;
  const otherKeys = RESOURCE_KEYS.filter((key) => key !== changedKey);
  const [firstOther, secondOther] = otherKeys as [ResourceKey, ResourceKey];
  const otherTotal = otherKeys.reduce((total, key) => total + Math.max(0, current[key]), 0);
  const next = { ...current, [changedKey]: value };

  if (otherTotal <= 0) {
    const first = Math.floor(remaining / 2);
    next[firstOther] = first;
    next[secondOther] = remaining - first;
    return next;
  }

  const first = Math.floor((remaining * current[firstOther]) / otherTotal);
  next[firstOther] = first;
  next[secondOther] = remaining - first;
  return next;
}

export function lootRatioFromUpToAmount(
  current: MissionLootRatioDraft,
  changedKey: ResourceKey,
  rawValue: number,
  cargoCapacity: number,
): MissionLootRatioDraft {
  if (cargoCapacity <= 0) return rebalanceLootRatio(current, changedKey, 0);
  const percent = Math.round((clampInteger(rawValue, 0, cargoCapacity) * LOOT_RATIO_TOTAL_PERCENT) / cargoCapacity);
  return rebalanceLootRatio(current, changedKey, percent);
}

export function forecastRaidLoot(
  lootable: MissionResourceSnapshot | null,
  capacity: number,
  lootRatio: MissionLootRatioDraft | null,
): MissionResourceSnapshot {
  const remainingLootable = {
    metal: Math.max(0, Math.trunc(lootable?.metal ?? 0)),
    crystal: Math.max(0, Math.trunc(lootable?.crystal ?? 0)),
    deuterium: Math.max(0, Math.trunc(lootable?.deuterium ?? 0)),
  };
  const result: MissionResourceSnapshot = { metal: 0, crystal: 0, deuterium: 0 };
  let remainingCapacity = Math.max(0, Math.trunc(capacity));

  if (lootRatio && lootRatio.metal + lootRatio.crystal + lootRatio.deuterium > 0) {
    const metalTarget = Math.floor((remainingCapacity * lootRatio.metal) / LOOT_RATIO_TOTAL_PERCENT);
    const crystalTarget = Math.floor((remainingCapacity * lootRatio.crystal) / LOOT_RATIO_TOTAL_PERCENT);
    result.metal = Math.min(metalTarget, remainingLootable.metal);
    result.crystal = Math.min(crystalTarget, remainingLootable.crystal);
    result.deuterium = Math.min(remainingCapacity - metalTarget - crystalTarget, remainingLootable.deuterium);
    remainingCapacity -= result.metal + result.crystal + result.deuterium;
  }

  for (const key of RESOURCE_KEYS) {
    if (remainingCapacity <= 0) break;
    const give = Math.min(remainingCapacity, remainingLootable[key] - result[key]);
    result[key] += give;
    remainingCapacity -= give;
  }

  return result;
}

export function targetResourceIntel(target: Planet | undefined, travelSeconds: number): TargetResourceIntel {
  const current = publicResourceSnapshot(target);
  if (!current) {
    return {
      current: null,
      projectedArrival: null,
      currentLootable: null,
      projectedArrivalLootable: null,
      projectionDetail: "Destination resources are not present in the public indexed state yet.",
    };
  }

  const projected = projectedResourceSnapshot(target, current, travelSeconds);
  return {
    current,
    projectedArrival: projected.resources,
    currentLootable: plunderableResources(current),
    projectedArrivalLootable: projected.resources ? plunderableResources(projected.resources) : null,
    projectionDetail: projected.detail,
  };
}

export function publicTargetBattleForecast(
  ships: MissionShips,
  target: Planet | undefined,
  attackerTechLevels: CombatTechLevels = ZERO_COMBAT_TECH_LEVELS,
): BattleForecastState {
  const normalizedAttackerTechLevels = normalizeCombatTechLevels(attackerTechLevels);
  const defenderTechLevels = targetCombatTechLevels(target);
  const defenderTechKnown = Boolean(target?.publicState?.research);
  const forecastTech = {
    attackerTechLevels: normalizedAttackerTechLevels,
    defenderTechLevels,
    defenderTechKnown,
  };
  const attackerPower = missionShipsCombatPower(ships, normalizedAttackerTechLevels);
  if (fleetMissionShipCount(ships) <= 0) {
    return {
      kind: "uncertain",
      label: "Uncertain",
      detail: "Select ships to preview the attack against public destination intel.",
      attackerPower,
      defenderPower: null,
      ...forecastTech,
    };
  }
  if (!target?.publicState) {
    return {
      kind: "uncertain",
      label: "Uncertain",
      detail: "Destination fleet and defense data is unavailable, so exact defender strength is unknown.",
      attackerPower,
      defenderPower: null,
      ...forecastTech,
    };
  }

  const stationedPower = stationedDefendersCombatPower(target.publicState.stationedDefenders, defenderTechLevels);
  const defenderPower = compositionCombatPower(target.publicState.fleet, "ship", defenderTechLevels)
    + compositionCombatPower(target.publicState.defenses, "defense", defenderTechLevels)
    + stationedPower;
  if (defenderPower <= 0) {
    return {
      kind: "win",
      label: "Probable win",
      detail: "No public stationed fleet or battlefield defenses are visible. Hidden state is not assumed.",
      attackerPower,
      defenderPower,
      ...forecastTech,
    };
  }
  if (attackerPower >= defenderPower * PROBABLE_WIN_POWER_RATIO) {
    return {
      kind: "win",
      label: "Probable win",
      detail: stationedPower > 0
        ? "Your selected fleet materially exceeds visible public defender power, including stationed defenders. Combat randomness and unindexed changes can still alter the result."
        : "Your selected fleet materially exceeds visible public defender power. Combat randomness and unindexed changes can still alter the result.",
      attackerPower,
      defenderPower,
      ...forecastTech,
    };
  }
  if (attackerPower <= defenderPower * PROBABLE_DEFEAT_POWER_RATIO) {
    return {
      kind: "defeat",
      label: "Probable defeat",
      detail: stationedPower > 0
        ? "Visible public defender power, including stationed defenders, materially exceeds your selected fleet. Add ships or reconsider the target."
        : "Visible public defender power materially exceeds your selected fleet. Add ships or reconsider the target.",
      attackerPower,
      defenderPower,
      ...forecastTech,
    };
  }
  return {
    kind: "draw",
    label: "Probable draw",
    detail: stationedPower > 0
      ? "Public attacker and defender power, including stationed defenders, are close enough that the battle outcome is uncertain."
      : "Public attacker and defender power are close enough that the battle outcome is uncertain.",
    attackerPower,
    defenderPower,
    ...forecastTech,
  };
}

export function ShipQuantityRow({
  onChange,
  owned,
  ship,
  value,
}: {
  onChange: (value: number) => void;
  owned: number;
  ship: ShipOption;
  value: number;
}) {
  return (
    <label className="grid gap-2 rounded border border-white/10 bg-black/15 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
      <span className="flex min-w-0 items-center gap-2">
        <img alt="" className="h-9 w-9 shrink-0 rounded border border-white/10 object-contain" loading="lazy" src={ship.asset} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-200">{ship.label}</span>
          <span className="block text-xs text-slate-500">Fleet unit</span>
        </span>
      </span>
      <span className="grid grid-cols-[2rem_minmax(0,1fr)_auto_2rem] items-center gap-1">
        <button
          aria-label={`Decrease ${ship.label}`}
          className="h-9 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          -
        </button>
        <input
          aria-label={`${ship.label} quantity`}
          className="h-9 min-w-0 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
          inputMode="numeric"
          max={owned}
          min={0}
          onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
          type="number"
          value={value}
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">/ {owned.toLocaleString()}</span>
        <button
          aria-label={`Increase ${ship.label}`}
          className="h-9 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
          disabled={value >= owned}
          onClick={() => onChange(value + 1)}
          type="button"
        >
          +
        </button>
      </span>
    </label>
  );
}

export function TargetIntelCard({ coords, target }: { coords: Coordinates; target: Planet | undefined }) {
  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.04] p-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
      <TargetIdentityContent coords={coords} target={target} />
    </div>
  );
}

function TargetIdentityContent({
  compact = false,
  coords,
  target,
}: {
  compact?: boolean | undefined;
  coords: Coordinates;
  target: Planet | undefined;
}) {
  const imageClassName = compact
    ? "h-16 w-16 rounded-md border border-white/10 object-cover"
    : "h-16 w-16 rounded-md border border-white/10 object-cover sm:h-20 sm:w-20";
  const placeholderClassName = compact
    ? "grid h-16 w-16 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-xs text-slate-500"
    : "grid h-16 w-16 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-xs text-slate-500 sm:h-20 sm:w-20";

  return (
    <>
      {target?.image ? (
        <img
          alt=""
          className={imageClassName}
          loading="lazy"
          src={target.image}
        />
      ) : (
        <div className={placeholderClassName}>
          No image
        </div>
      )}
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target</h3>
        <div className="mt-1 text-sm font-medium text-white">
          {target?.name ?? `Coordinate ${coords.galaxy}:${coords.system}:${coords.position}`}
        </div>
        <div className="mt-1 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
          <TargetFact label="Coords" value={`[${coords.galaxy}:${coords.system}:${coords.position}]`} />
          <TargetFact label="Commander" value={commanderLabel(target)} />
          <TargetFact label="Alliance" value={allianceLabel(target)} />
          <TargetFact label="Planet ID" value={target?.id ? `#${target.id}` : "Uncharted"} />
        </div>
      </div>
    </>
  );
}

export function AttackIntelPanel({
  battleForecast,
  coords,
  lootableAtArrival,
  maxLootForecast,
  resourceIntel,
  stationedDefenderUnits,
  target,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  battleForecast: BattleForecastState;
  coords: Coordinates;
  lootableAtArrival: MissionResourceSnapshot | null;
  maxLootForecast: MissionResourceSnapshot;
  resourceIntel: TargetResourceIntel;
  stationedDefenderUnits: UnitItem[];
  target: Planet | undefined;
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] shadow-sm shadow-black/10">
      <div className="grid divide-y divide-white/10 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:divide-x xl:divide-y-0">
        <TargetDecisionTable coords={coords} target={target} />
        <AttackOutcomeContent
          battleForecast={battleForecast}
          compact
          lootableAtArrival={lootableAtArrival}
          maxLootForecast={maxLootForecast}
        />
      </div>
      <div className="grid divide-y divide-white/10 border-t border-white/10 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:divide-x xl:divide-y-0">
        <ResourceIntelTable
          maxLootForecast={maxLootForecast}
          resourceIntel={resourceIntel}
        />
        <ForceIntelTable
          stationedDefenderUnits={stationedDefenderUnits}
          targetDefenseUnits={targetDefenseUnits}
          targetFleetUnits={targetFleetUnits}
        />
      </div>
    </section>
  );
}

export function NonAttackMissionIntelPanel({
  action,
  cargoCapacity,
  cargoSupported,
  coords,
  destinationIntelVisible,
  holdDepotLevel,
  holdingBreakdown,
  resourceIntel,
  stationedDefenderUnits,
  target,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  action: EnabledGalaxyAction;
  cargoCapacity: number;
  cargoSupported: boolean;
  coords: Coordinates;
  destinationIntelVisible: boolean;
  holdDepotLevel: number;
  holdingBreakdown: AcsDefendFuelBreakdown | null;
  resourceIntel: TargetResourceIntel;
  stationedDefenderUnits: UnitItem[];
  target: Planet | undefined;
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] shadow-sm shadow-black/10">
      <div className="grid divide-y divide-white/10 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:divide-x xl:divide-y-0">
        <TargetDecisionTable coords={coords} target={target} />
        <MissionPlanContent
          action={action}
          cargoCapacity={cargoCapacity}
          cargoSupported={cargoSupported}
          holdDepotLevel={holdDepotLevel}
          holdingBreakdown={holdingBreakdown}
          targetDebrisField={target?.debrisField ?? null}
        />
      </div>
      {destinationIntelVisible ? (
        <div className="grid divide-y divide-white/10 border-t border-white/10 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:divide-x xl:divide-y-0">
          <ResourceIntelTable resourceIntel={resourceIntel} />
          <ForceIntelTable
            stationedDefenderUnits={stationedDefenderUnits}
            targetDefenseUnits={targetDefenseUnits}
            targetFleetUnits={targetFleetUnits}
          />
        </div>
      ) : null}
    </section>
  );
}

function MissionPlanContent({
  action,
  cargoCapacity,
  cargoSupported,
  holdDepotLevel,
  holdingBreakdown,
  targetDebrisField,
}: {
  action: EnabledGalaxyAction;
  cargoCapacity: number;
  cargoSupported: boolean;
  holdDepotLevel: number;
  holdingBreakdown: AcsDefendFuelBreakdown | null;
  targetDebrisField: DebrisField | null;
}) {
  const harvestDebris = action.kind === "harvest" ? targetDebrisSnapshot(targetDebrisField) : null;
  return (
    <div className="grid content-start gap-2 bg-signal/[0.04] p-3">
      <div className="min-w-0">
        <span className="text-[11px] font-semibold uppercase text-slate-500">Mission</span>
        <p className="truncate text-base font-semibold text-white">{missionPlanTitle(action)}</p>
      </div>
      <p className="text-xs text-slate-500">{missionPlanDetail(action)}</p>
      <div className="grid gap-1 rounded border border-white/10 bg-black/15 p-2">
        <CompactFactRow label="Target rule" value={missionTargetRule(action)} />
        <CompactFactRow label="Cargo" value={missionCargoRule(action, cargoSupported, cargoCapacity)} />
        {harvestDebris ? (
          <>
            <CompactFactRow label="Debris" value={formatHarvestDebris(harvestDebris)} />
            <CompactFactRow label="Coverage" value={harvestCoverageLabel(harvestDebris, cargoCapacity)} />
          </>
        ) : null}
        <CompactFactRow label="Timing" value={missionTimingRule(action, Boolean(holdingBreakdown))} />
        {holdingBreakdown ? (
          <>
            <CompactFactRow label="Hold fuel" value={`${holdingBreakdown.netHoldingFuel.toLocaleString()} D net`} />
            <CompactFactRow label="Depot" value={holdDepotLevel > 0 ? `Level ${holdDepotLevel.toLocaleString()} support` : "No support"} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function missionPlanTitle(action: EnabledGalaxyAction): string {
  if (action.kind === "transport") return "Transport run";
  if (action.kind === "harvest") return "Debris sweep";
  if (action.kind === "defenseHold" || action.kind === "acsDefend") return "Station defense";
  if (action.kind === "deploy") return "Deploy fleet";
  if (action.kind === "colonize") return "Colonize slot";
  if (action.kind === "missileAttack") return "Missile strike";
  return `${action.label} mission`;
}

function missionPlanDetail(action: EnabledGalaxyAction): string {
  if (action.kind === "transport") return "Send cargo to an owned or allied planet while the fleet returns home.";
  if (action.kind === "harvest") return "Send recyclers to collect the debris field, reserving cargo room for fuel first.";
  if (action.kind === "defenseHold" || action.kind === "acsDefend") return "Station a fleet at the target planet for a defensive hold, then bring it home.";
  if (action.kind === "deploy") return "Move ships and loaded resources to another owned planet.";
  if (action.kind === "colonize") return "Send a colony ship to claim an empty coordinate.";
  if (action.kind === "missileAttack") return "Launch interplanetary missiles at the selected defense target.";
  return "Configure fleet, timing, validation, and launch from the same mission flow.";
}

function missionTargetRule(action: EnabledGalaxyAction): string {
  if (action.kind === "transport") return "Own or alliance planet";
  if (action.kind === "harvest") return "Debris field target";
  if (action.kind === "defenseHold" || action.kind === "acsDefend") return "Own or alliance planet";
  if (action.kind === "deploy") return "Own planets only";
  if (action.kind === "colonize") return "Empty coordinate";
  if (action.kind === "missileAttack") return "Occupied planet";
  return "Valid target required";
}

function missionCargoRule(action: EnabledGalaxyAction, cargoSupported: boolean, cargoCapacity: number): string {
  if (cargoSupported) return `Manual load / ${cargoCapacity.toLocaleString()} capacity`;
  if (action.kind === "harvest") return `${cargoCapacity.toLocaleString()} recycler capacity`;
  if (action.kind === "defenseHold" || action.kind === "acsDefend") return "Fuel and hold reserve";
  if (action.kind === "colonize") return "Colony ship only";
  if (action.kind === "missileAttack") return "No fleet cargo";
  return "No cargo input";
}

function targetDebrisSnapshot(field: DebrisField | null): MissionResourceSnapshot {
  return {
    metal: safeResourceNumber(field?.metal),
    crystal: safeResourceNumber(field?.crystal),
    deuterium: 0,
  };
}

function harvestDebrisTotal(resources: MissionResourceSnapshot): number {
  return resources.metal + resources.crystal;
}

function formatHarvestDebris(resources: MissionResourceSnapshot): string {
  const total = harvestDebrisTotal(resources);
  if (total <= 0) return "No indexed debris";
  return `${formatResourceAmount(resources.metal)} M / ${formatResourceAmount(resources.crystal)} C (${formatResourceAmount(total)} total)`;
}

function harvestCoverageLabel(resources: MissionResourceSnapshot, cargoCapacity: number): string {
  const total = harvestDebrisTotal(resources);
  const capacity = Math.max(0, Math.trunc(cargoCapacity));
  if (total <= 0) return "Nothing to collect";
  if (capacity <= 0) return "Select recyclers to estimate";
  if (capacity >= total) return `Can clear field (${formatResourceAmount(capacity)} capacity)`;
  return `${formatResourceAmount(capacity)} / ${formatResourceAmount(total)} debris capacity`;
}

function missionTimingRule(action: EnabledGalaxyAction, hasHoldingBreakdown: boolean): string {
  if (hasHoldingBreakdown) return "Arrive, hold, return";
  if (action.kind === "deploy") return "One-way arrival";
  if (action.kind === "colonize") return "Arrival settlement";
  if (action.kind === "missileAttack") return "Instant launch";
  return "Round trip";
}

export function AttackOutcomePanel({
  battleForecast,
  lootableAtArrival,
  maxLootForecast,
}: {
  battleForecast: BattleForecastState;
  lootableAtArrival: MissionResourceSnapshot | null;
  maxLootForecast: MissionResourceSnapshot;
}) {
  return (
    <section className="grid gap-2 rounded-md border border-white/10 bg-black/15 p-3">
      <AttackOutcomeContent
        battleForecast={battleForecast}
        lootableAtArrival={lootableAtArrival}
        maxLootForecast={maxLootForecast}
      />
    </section>
  );
}

function AttackOutcomeContent({
  battleForecast,
  compact = false,
  lootableAtArrival,
  maxLootForecast,
}: {
  battleForecast: BattleForecastState;
  compact?: boolean | undefined;
  lootableAtArrival: MissionResourceSnapshot | null;
  maxLootForecast: MissionResourceSnapshot;
}) {
  if (compact) {
    return (
      <div className="grid content-start gap-2 bg-signal/[0.04] p-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Outcome</span>
            <p className={`truncate text-base font-semibold ${battleForecast.kind === "win" ? "text-emerald-200" : battleForecast.kind === "defeat" ? "text-red-200" : battleForecast.kind === "draw" ? "text-amber-200" : "text-slate-300"}`}>
              {battleForecast.label}
            </p>
          </div>
          <div className="grid shrink-0 gap-1 text-right text-[11px] text-slate-500">
            <span>ATK <span className="font-semibold tabular-nums text-slate-200">{battleForecast.attackerPower.toLocaleString()}</span></span>
            <span>DEF <span className="font-semibold tabular-nums text-slate-200">{battleForecast.defenderPower == null ? "unknown" : battleForecast.defenderPower.toLocaleString()}</span></span>
          </div>
        </div>
        <div className="grid gap-1 rounded border border-white/10 bg-black/15 p-2">
          <CompactFactRow label="Max loot" value={formatCompactResources(maxLootForecast)} />
          <CompactFactRow label="Lootable" value={formatCompactResources(lootableAtArrival)} />
          <CompactFactRow
            label="Tech"
            value={`${formatTechLevels(battleForecast.attackerTechLevels ?? ZERO_COMBAT_TECH_LEVELS)} / ${battleForecast.defenderTechKnown ? formatTechLevels(battleForecast.defenderTechLevels ?? ZERO_COMBAT_TECH_LEVELS) : "DEF unknown"}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Probable outcome</h3>
          <p className={`mt-0.5 text-base font-semibold ${battleForecast.kind === "win" ? "text-emerald-200" : battleForecast.kind === "defeat" ? "text-red-200" : battleForecast.kind === "draw" ? "text-amber-200" : "text-slate-300"}`}>
            {battleForecast.label}
          </p>
        </div>
        <div className="grid min-w-[8.5rem] grid-cols-2 gap-x-3 gap-y-0.5 text-right text-[11px] text-slate-500">
          <span>Attack</span>
          <span className="font-medium tabular-nums text-slate-300">{battleForecast.attackerPower.toLocaleString()}</span>
          <span>Defense</span>
          <span className="font-medium tabular-nums text-slate-300">{battleForecast.defenderPower == null ? "unknown" : battleForecast.defenderPower.toLocaleString()}</span>
        </div>
      </div>
      <p className="text-xs text-slate-500">{battleForecast.detail}</p>
      <CombatTechSummary
        attackerLevels={battleForecast.attackerTechLevels ?? ZERO_COMBAT_TECH_LEVELS}
        defenderKnown={battleForecast.defenderTechKnown ?? false}
        defenderLevels={battleForecast.defenderTechLevels ?? ZERO_COMBAT_TECH_LEVELS}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <ResourceSummary title="Max loot at arrival" resources={maxLootForecast} />
        <ResourceSummary title="Lootable at arrival" resources={lootableAtArrival} />
      </div>
    </div>
  );
}

function TargetDecisionTable({ coords, target }: { coords: Coordinates; target: Planet | undefined }) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-[3.75rem_minmax(0,1fr)]">
      {target?.image ? (
        <img
          alt=""
          className="h-16 w-16 rounded-md border border-white/10 object-cover sm:h-14 sm:w-14"
          loading="lazy"
          src={target.image}
        />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-[11px] text-slate-500 sm:h-14 sm:w-14">
          No image
        </div>
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[11px] font-semibold uppercase text-slate-500">Target</span>
            <p className="truncate text-base font-semibold text-white" title={target?.name ?? undefined}>
              {target?.name ?? `Coordinate ${coords.galaxy}:${coords.system}:${coords.position}`}
            </p>
          </div>
          <span className="shrink-0 rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-400">
            {target?.id ? `#${target.id}` : "Uncharted"}
          </span>
        </div>
        <div className="mt-2 grid gap-1">
          <CompactFactRow label="Coords" value={`[${coords.galaxy}:${coords.system}:${coords.position}]`} />
          <CompactFactRow label="Commander" value={commanderLabel(target)} />
          <CompactFactRow label="Alliance" value={allianceLabel(target)} />
        </div>
      </div>
    </div>
  );
}

function ResourceIntelTable({
  maxLootForecast,
  resourceIntel,
}: {
  maxLootForecast?: MissionResourceSnapshot | undefined;
  resourceIntel: TargetResourceIntel;
}) {
  return (
    <div className="grid content-start gap-2 p-3">
      <span className="text-[11px] font-semibold uppercase text-slate-500">Resources</span>
      <div className="grid gap-1 rounded border border-white/10 bg-black/15 p-2">
        <ResourceTableRow label="Now" resources={resourceIntel.current} />
        <ResourceTableRow label="Arrival" resources={resourceIntel.projectedArrival} />
        <ResourceTableRow label="Loot now" resources={resourceIntel.currentLootable} />
        <ResourceTableRow label="Loot arr." resources={resourceIntel.projectedArrivalLootable} />
        {maxLootForecast ? <ResourceTableRow label="Max carry" resources={maxLootForecast} tone="signal" /> : null}
      </div>
    </div>
  );
}

function ResourceTableRow({
  label,
  resources,
  tone = "default",
}: {
  label: string;
  resources: MissionResourceSnapshot | null;
  tone?: "default" | "signal" | undefined;
}) {
  const valueClass = tone === "signal" ? "text-signal" : "text-slate-200";
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-2 text-[11px] sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <span className="truncate text-slate-500">{label}</span>
      {resources ? (
        <span className="flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-0.5 text-right">
          <span className={`whitespace-nowrap tabular-nums ${valueClass}`} title={`${resources.metal.toLocaleString()} metal`}>{formatResourceAmount(resources.metal)} M</span>
          <span className={`whitespace-nowrap tabular-nums ${valueClass}`} title={`${resources.crystal.toLocaleString()} crystal`}>{formatResourceAmount(resources.crystal)} C</span>
          <span className={`whitespace-nowrap tabular-nums ${valueClass}`} title={`${resources.deuterium.toLocaleString()} deuterium`}>{formatResourceAmount(resources.deuterium)} D</span>
        </span>
      ) : (
        <span className="text-right text-slate-500">Unknown</span>
      )}
    </div>
  );
}

function ForceIntelTable({
  stationedDefenderUnits,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  stationedDefenderUnits: UnitItem[];
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <div className="grid content-start gap-2 p-3">
      <span className="text-[11px] font-semibold uppercase text-slate-500">Forces</span>
      <div className="grid gap-1">
        <UnitSection emptyLabel="None" title="Fleet" units={targetFleetUnits} />
        <UnitSection emptyLabel="None" title="Defense" units={targetDefenseUnits} />
        {stationedDefenderUnits.length > 0 ? (
          <UnitSection emptyLabel="None" title="Held" units={stationedDefenderUnits} />
        ) : null}
      </div>
    </div>
  );
}

function CombatTechSummary({
  attackerLevels,
  defenderKnown,
  defenderLevels,
}: {
  attackerLevels: CombatTechLevels;
  defenderKnown: boolean;
  defenderLevels: CombatTechLevels;
}) {
  return (
    <div className="grid gap-1 rounded border border-white/10 bg-black/15 px-2 py-1.5 text-[11px] text-slate-400 sm:grid-cols-2">
      <CombatTechLine label="Attacker tech" levels={attackerLevels} />
      <CombatTechLine
        label={defenderKnown ? "Defender tech" : "Defender tech unknown"}
        levels={defenderLevels}
        suffix={defenderKnown ? undefined : "base shown"}
      />
    </div>
  );
}

function CombatTechLine({
  label,
  levels,
  suffix,
}: {
  label: string;
  levels: CombatTechLevels;
  suffix?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="font-medium text-slate-300">{label}</span>
      <span className="tabular-nums">W {levels.weapons}</span>
      <span className="tabular-nums">S {levels.shielding}</span>
      <span className="tabular-nums">A {levels.armor}</span>
      {suffix ? <span className="text-slate-500">{suffix}</span> : null}
    </div>
  );
}

export function DestinationIntelPanel({
  resourceIntel,
  stationedDefenderUnits,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  resourceIntel: TargetResourceIntel;
  stationedDefenderUnits: UnitItem[];
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <section className="grid gap-2 rounded-md border border-white/10 bg-black/15 p-3">
      <DestinationIntelContent
        resourceIntel={resourceIntel}
        stationedDefenderUnits={stationedDefenderUnits}
        targetDefenseUnits={targetDefenseUnits}
        targetFleetUnits={targetFleetUnits}
      />
    </section>
  );
}

function DestinationIntelContent({
  resourceIntel,
  stationedDefenderUnits,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  resourceIntel: TargetResourceIntel;
  stationedDefenderUnits: UnitItem[];
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <div className="grid gap-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Target readout</p>
        <h3 className="mt-1 text-sm font-semibold text-white">Destination intel</h3>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <UnitSection emptyLabel="No fleet is stationed here." title="Destination Fleet" units={targetFleetUnits} />
        <UnitSection emptyLabel="No defenses are deployed here." title="Defenses" units={targetDefenseUnits} />
        {stationedDefenderUnits.length > 0 ? (
          <UnitSection emptyLabel="No held defenders are stationed here." title="Stationed Defenders" units={stationedDefenderUnits} />
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <ResourceSummary title="Resources now" resources={resourceIntel.current} />
        <ResourceSummary title="Projected at arrival" resources={resourceIntel.projectedArrival} />
        <ResourceSummary title="Lootable now" resources={resourceIntel.currentLootable} />
        <ResourceSummary title="Lootable at arrival" resources={resourceIntel.projectedArrivalLootable} />
      </div>
    </div>
  );
}

export function LootRatioControls({
  cargoCapacity,
  greedyLootEnabled,
  lootRatio,
  lootRatioTotal,
  onAmountChange,
  onGreedyChange,
  onPercentChange,
  onResetEven,
}: {
  cargoCapacity: number;
  greedyLootEnabled: boolean;
  lootRatio: MissionLootRatioDraft;
  lootRatioTotal: number;
  onAmountChange: (key: ResourceKey, value: number) => void;
  onGreedyChange: (enabled: boolean) => void;
  onPercentChange: (key: ResourceKey, value: number) => void;
  onResetEven: () => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Loot ratio</span>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          Greedy
          <input
            checked={greedyLootEnabled}
            className="h-4 w-4 accent-signal [color-scheme:dark]"
            onChange={(event) => onGreedyChange((event.currentTarget as HTMLInputElement).checked)}
            type="checkbox"
          />
        </span>
      </div>
      {greedyLootEnabled ? (
        <p className="rounded border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-400">
          Greedy fills cargo from available loot automatically: metal first, then crystal, then deuterium.
        </p>
      ) : (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {RESOURCE_KEYS.map((key) => (
              <PercentField
                key={key}
                label={`${resourceLabel(key)} %`}
                onChange={(value) => onPercentChange(key, value)}
                value={lootRatio[key]}
              />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {RESOURCE_KEYS.map((key) => (
              <ResourceField
                key={key}
                label={`${resourceLabel(key)} up to`}
                max={cargoCapacity}
                onChange={(value) => onAmountChange(key, resourceDraftNumber(value))}
                value={String(Math.floor((cargoCapacity * lootRatio[key]) / 100))}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className={lootRatioTotal === LOOT_RATIO_TOTAL_PERCENT ? "text-slate-500" : "text-amber-200"}>
              Total {lootRatioTotal}% (must equal {LOOT_RATIO_TOTAL_PERCENT}%). Unfilled shares roll over metal, crystal, then deuterium.
            </span>
            <button
              className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white"
              onClick={onResetEven}
              type="button"
            >
              Even split
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TargetFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-slate-600">{label}</span>{" "}
      <span className="break-words text-slate-300">{value}</span>
    </div>
  );
}

function CompactFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2 text-[11px]">
      <span className="truncate text-slate-500">{label}</span>
      <span className="truncate text-right tabular-nums text-slate-200" title={value}>{value}</span>
    </div>
  );
}

function UnitSection({ emptyLabel, title, units }: { emptyLabel: string; title: string; units: UnitItem[] }) {
  return (
    <section className="grid gap-1.5 rounded border border-white/10 bg-[#070913]/60 p-2">
      <h4 className="text-[11px] font-semibold uppercase text-slate-500">{title}</h4>
      <UnitIcons emptyLabel={emptyLabel} units={units} />
    </section>
  );
}

function UnitIcons({ emptyLabel, units }: { emptyLabel: string; units: UnitItem[] }) {
  if (units.length === 0) return <p className="text-xs text-slate-500">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {units.map((unit) => (
        <span
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1.5 py-1"
          key={unit.key}
          title={`${unit.label} x${unit.count.toLocaleString()}`}
        >
          {unit.asset ? <img alt="" className="h-6 w-6 rounded object-contain" loading="lazy" src={unit.asset} /> : null}
          <span className="text-[11px] text-slate-300">{unit.label}</span>
          <span className="text-[11px] font-semibold tabular-nums text-slate-100">x{unit.count.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

function ResourceSummary({ resources, title }: { resources: MissionResourceSnapshot | null; title: string }) {
  return (
    <section className="rounded border border-white/10 bg-[#070913]/60 p-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{title}</h4>
      <p className="mt-1 text-sm font-medium text-slate-200">{formatCompactResources(resources)}</p>
    </section>
  );
}

function formatTechLevels(levels: CombatTechLevels): string {
  return `W${levels.weapons} S${levels.shielding} A${levels.armor}`;
}

function compositionUnits(
  rows: Array<{ id: number; count: number }> | undefined | null,
  catalog: readonly { id: number; key: string; label: string }[],
  assetByKey: Partial<Record<string, string>>,
): UnitItem[] {
  return (rows ?? [])
    .filter((row) => row.count > 0)
    .map((row, index) => {
      const item = catalog.find((entry, catalogIndex) => (entry.id ?? catalogIndex) === row.id);
      return {
        key: item?.key ?? `id-${row.id}-${index}`,
        label: item?.label ?? `ID ${row.id}`,
        count: Math.trunc(row.count),
        asset: item ? assetByKey[item.key] : undefined,
      };
    });
}

export function stationedDefenderCompositionUnits(
  defenders: PublicStationedDefender[] | null | undefined,
): UnitItem[] {
  const counts = new Map<string, number>();
  for (const defender of defenders ?? []) {
    for (const [key, rawCount] of Object.entries(defender.ships)) {
      const count = safeResourceNumber(rawCount);
      if (count <= 0) continue;
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }
  return shipCatalog
    .map((ship) => ({
      key: ship.key,
      label: ship.label,
      count: counts.get(ship.key) ?? 0,
      asset: shipAssetByKey[ship.key],
    }))
    .filter((unit) => unit.count > 0);
}

function publicResourceSnapshot(target: Planet | undefined): MissionResourceSnapshot | null {
  const publicResources = target?.publicState?.resources;
  if (publicResources) {
    return {
      metal: safeResourceNumber(publicResources.metal),
      crystal: safeResourceNumber(publicResources.crystal),
      deuterium: safeResourceNumber(publicResources.deuterium),
    };
  }
  if (!target?.resources) return null;
  return {
    metal: Math.max(0, Math.trunc(target.resources.metal)),
    crystal: Math.max(0, Math.trunc(target.resources.crystal)),
    deuterium: Math.max(0, Math.trunc(target.resources.deuterium)),
  };
}

function projectedResourceSnapshot(
  target: Planet | undefined,
  current: MissionResourceSnapshot,
  travelSeconds: number,
): { resources: MissionResourceSnapshot | null; detail: string } {
  if (travelSeconds <= 0) {
    return {
      resources: null,
      detail: "Select ships to calculate travel time and projected arrival resources.",
    };
  }

  const publicProduction = publicProductionProjection(target, current, travelSeconds);
  if (publicProduction) return publicProduction;

  const buildings = publicBuildingLevels(target);
  if (!buildings) {
    return {
      resources: current,
      detail: "Arrival projection falls back to current resources until public production data is available.",
    };
  }

  const energyTechnologyLevel = publicResearchLevel(target, "energy");
  const solarSatelliteCount = target?.publicState?.fleet?.find((row) => row.id === 9)?.count ?? 0;
  const productionProfile = {
    ...(target ? { maxTemperature: canonicalPlanetTemperature(target.temperature) } : {}),
    metalMultiplierBps: target?.metalMultiplierBps ?? 10_000,
    crystalMultiplierBps: target?.crystalMultiplierBps ?? 10_000,
    deuteriumMultiplierBps: target?.deuteriumMultiplierBps ?? 10_000,
  };
  const production = productionPerHour(buildings, productionProfile, energyTechnologyLevel, solarSatelliteCount);
  const caps = storageCaps(buildings);
  const projected = projectResourcesForTravel(current, production, caps, travelSeconds);
  return {
    resources: projected,
    detail: "Arrival projection uses public building/resource preview math and assumes no spending, transport, or combat changes before arrival.",
  };
}

function canonicalPlanetTemperature(temperature: Planet["temperature"]): number {
  return Math.floor((temperature.min + temperature.max) / 2);
}

function publicProductionProjection(
  target: Planet | undefined,
  current: MissionResourceSnapshot,
  travelSeconds: number,
): { resources: MissionResourceSnapshot; detail: string } | null {
  const production = resourceSnapshotFromPublicState(target?.publicState?.productionPerHour);
  const caps = resourceSnapshotFromPublicState(target?.publicState?.storageCaps);
  if (!production || !caps) return null;

  return {
    resources: projectResourcesForTravel(current, production, caps, travelSeconds),
    detail: "Arrival projection uses public production rate and storage caps, assuming no spending, transport, or combat changes before arrival.",
  };
}

function projectResourcesForTravel(
  current: MissionResourceSnapshot,
  production: MissionResourceSnapshot,
  caps: MissionResourceSnapshot,
  travelSeconds: number,
): MissionResourceSnapshot {
  const hours = Math.max(0, travelSeconds) / SECONDS_PER_HOUR;
  return {
    metal: Math.min(caps.metal, current.metal + Math.floor(production.metal * hours)),
    crystal: Math.min(caps.crystal, current.crystal + Math.floor(production.crystal * hours)),
    deuterium: Math.min(caps.deuterium, current.deuterium + Math.floor(production.deuterium * hours)),
  };
}

function resourceSnapshotFromPublicState(
  resources: { metal: string; crystal: string; deuterium: string } | null | undefined,
): MissionResourceSnapshot | null {
  if (!resources) return null;
  return {
    metal: safeResourceNumber(resources.metal),
    crystal: safeResourceNumber(resources.crystal),
    deuterium: safeResourceNumber(resources.deuterium),
  };
}

function publicBuildingLevels(target: Planet | undefined): Record<BuildingKey, number> | null {
  const rows = target?.publicState?.buildings;
  if (!rows) return null;
  const buildings = Object.fromEntries(
    Object.keys(buildingContractIds).map((key) => [key, 0]),
  ) as Record<BuildingKey, number>;
  for (const row of rows) {
    const key = (Object.entries(buildingContractIds) as Array<[BuildingKey, number]>)
      .find(([, id]) => id === row.id)?.[0];
    if (key) buildings[key] = Math.max(0, Math.trunc(row.level));
  }
  return buildings;
}

function publicResearchLevel(target: Planet | undefined, key: "energy" | keyof CombatTechLevels): number {
  const id = researchCatalog.find((entry) => entry.key === key)?.id;
  if (id == null) return 0;
  return target?.publicState?.research?.find((row) => row.id === id)?.level ?? 0;
}

function targetCombatTechLevels(target: Planet | undefined): CombatTechLevels {
  return {
    weapons: publicResearchLevel(target, "weapons"),
    shielding: publicResearchLevel(target, "shielding"),
    armor: publicResearchLevel(target, "armor"),
  };
}

function normalizeCombatTechLevels(levels: CombatTechLevels | undefined): CombatTechLevels {
  return {
    weapons: normalizeCombatTechLevel(levels?.weapons),
    shielding: normalizeCombatTechLevel(levels?.shielding),
    armor: normalizeCombatTechLevel(levels?.armor),
  };
}

function normalizeCombatTechLevel(level: number | undefined): number {
  return Number.isFinite(level) ? Math.max(0, Math.trunc(level ?? 0)) : 0;
}

function plunderableResources(resources: MissionResourceSnapshot): MissionResourceSnapshot {
  return {
    metal: Math.floor((resources.metal * RAID_PLUNDER_BPS) / BPS),
    crystal: Math.floor((resources.crystal * RAID_PLUNDER_BPS) / BPS),
    deuterium: Math.floor((resources.deuterium * RAID_PLUNDER_BPS) / BPS),
  };
}

function missionShipsCombatPower(ships: MissionShips, techLevels: CombatTechLevels): number {
  return missionShipOptions.reduce((total, option) => {
    const count = Math.max(0, Math.trunc(ships[option.key] ?? 0));
    const ship = shipCatalog.find((entry) => entry.key === option.key);
    return total + count * (ship ? combatStatsPower(shipCombatStats(ship).rows, techLevels) : 0);
  }, 0);
}

function compositionCombatPower(
  rows: Array<{ id: number; count: number }> | undefined | null,
  kind: "ship" | "defense",
  techLevels: CombatTechLevels,
): number {
  return (rows ?? []).reduce((total, row) => {
    const count = Math.max(0, Math.trunc(row.count));
    if (kind === "ship") {
      const ship = shipCatalog.find((entry) => entry.id === row.id);
      return total + count * (ship ? combatStatsPower(shipCombatStats(ship).rows, techLevels) : 0);
    }
    const defense = defenseCatalog.find((entry) => entry.id === row.id);
    return total + count * (defense ? combatStatsPower(defenseCombatStats(defense).rows, techLevels) : 0);
  }, 0);
}

function stationedDefendersCombatPower(
  defenders: PublicStationedDefender[] | null | undefined,
  techLevels: CombatTechLevels,
): number {
  return (defenders ?? []).reduce((total, defender) => {
    return total + shipCatalog.reduce((shipTotal, ship) => {
      const count = safeResourceNumber(defender.ships[ship.key]);
      return shipTotal + count * combatStatsPower(shipCombatStats(ship).rows, techLevels);
    }, 0);
  }, 0);
}

function combatStatsPower(rows: Array<{ label: string; value: number | string }>, techLevels: CombatTechLevels): number {
  return rows.reduce((total, row) => {
    if (typeof row.value !== "number") return total;
    if (row.label === "Attack") return total + combatScaled(row.value, techLevels.weapons);
    if (row.label === "Shield") return total + combatScaled(row.value, techLevels.shielding);
    if (row.label === "Hull") return total + combatScaled(row.value, techLevels.armor) / 10;
    return total;
  }, 0);
}

function combatScaled(value: number, technologyLevel: number): number {
  return Math.floor((value * (BPS + normalizeCombatTechLevel(technologyLevel) * 1_000)) / BPS);
}

function commanderLabel(target: Planet | undefined): string {
  return target?.occupiedBy?.ownerDisplayName
    ?? target?.occupiedBy?.owner
    ?? target?.owner
    ?? "Open coordinate";
}

function allianceLabel(target: Planet | undefined): string {
  const alliance = target?.occupiedBy?.alliance ?? target?.alliance;
  if (!alliance) return "None";
  return alliance.tag ? `${alliance.name} [${alliance.tag}]` : alliance.name;
}

function resourceLabel(key: ResourceKey): string {
  return key === "metal" ? "Metal" : key === "crystal" ? "Crystal" : "Deuterium";
}

function formatCompactResources(resources: MissionResourceSnapshot | null): string {
  if (!resources) return "Unknown";
  return `${formatResourceAmount(resources.metal)} M / ${formatResourceAmount(resources.crystal)} C / ${formatResourceAmount(resources.deuterium)} D`;
}

function formatResourceAmount(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

function safeResourceNumber(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function ResourceField({
  label,
  max,
  onChange,
  value,
}: {
  label: string;
  max: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        max={max}
        min={0}
        onInput={(event) => onChange(String(clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, max)))}
        placeholder="0"
        type="number"
        value={value}
      />
    </label>
  );
}

function PercentField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        max={LOOT_RATIO_TOTAL_PERCENT}
        min={0}
        onInput={(event) => onChange(clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, LOOT_RATIO_TOTAL_PERCENT))}
        type="number"
        value={value}
      />
    </label>
  );
}

function NumberField({
  label,
  min,
  onChange,
  value,
}: {
  label: string;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        min={min}
        onInput={(event) => onChange(Math.max(min, Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || min)))}
        type="number"
        value={value}
      />
    </label>
  );
}

function SummaryRow({ label, subvalue, value }: { label: string; subvalue?: string | undefined; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-2 text-sm last:border-b-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right">
        <span className="block font-medium text-slate-200">{value}</span>
        {subvalue ? <span className="block text-xs text-slate-500">{subvalue}</span> : null}
      </span>
    </div>
  );
}

function resourceDraftNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
