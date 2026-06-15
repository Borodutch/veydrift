import { useMemo, useState } from "preact/hooks";
import type { Coordinates, Planet, PublicStationedDefender } from "../types";
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
const RESOURCE_KEYS = ["metal", "crystal", "deuterium"] as const;

type EnabledGalaxyAction = Extract<GalaxyAction, { enabled: true }>;
type ResourceKey = (typeof RESOURCE_KEYS)[number];

type MissionResourceSnapshot = {
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

type UnitItem = {
  key: string;
  label: string;
  count: number;
  asset?: string | undefined;
};

export type BattleForecastState =
  | {
      kind: "uncertain";
      label: "Uncertain";
      detail: string;
      attackerPower: number;
      defenderPower: number | null;
    }
  | {
      kind: "win" | "defeat" | "draw";
      label: "Probable win" | "Probable defeat" | "Probable draw";
      detail: string;
      attackerPower: number;
      defenderPower: number;
    };

export type TargetResourceIntel = {
  current: MissionResourceSnapshot | null;
  projectedArrival: MissionResourceSnapshot | null;
  currentLootable: MissionResourceSnapshot | null;
  projectedArrivalLootable: MissionResourceSnapshot | null;
  projectionDetail: string;
};

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
  coords,
  defenseHoldContext,
  defenseHoldMode = false,
  driveLevels = {},
  joinAttackMode = false,
  nowMs = Date.now(),
  onBack,
  onConfirm,
  originCoords,
  originLabel,
  resources,
  shipyardState,
  target,
}: {
  // VEY-KANEO-440: render the picker for an ACS Defend ("Group defend") counterplay. Like a normal
  // mission it keeps the ship picker and speed control, but adds a hold-duration / holding-fuel /
  // Alliance Depot preview and pins the launch to the hostile attack's arrival.
  acsDefendContext?: AcsDefendComposeContext | undefined;
  acsDefendMode?: boolean | undefined;
  action: EnabledGalaxyAction;
  actionPending: boolean;
  coords: Coordinates;
  // VEY-KANEO-440: render a proactive DefenseHold compose — adds a player-chosen hold-duration selector
  // and a travel + holding-fuel + Alliance Depot preview, stationing the fleet at the target planet.
  defenseHoldContext?: DefenseHoldComposeContext | undefined;
  defenseHoldMode?: boolean | undefined;
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
  target: Planet | undefined;
}) {
  const [speedPercent, setSpeedPercent] = useState(DEFAULT_MISSION_SPEED_PERCENT);
  const [ships, setShips] = useState<MissionShips>(() => initialMissionShips(action));
  const [cargo, setCargo] = useState<MissionCargoDraft>({});
  const [lootRatioEnabled, setLootRatioEnabled] = useState(false);
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
  const cargoTotal = resourceDraftNumber(cargo.metal) + resourceDraftNumber(cargo.crystal) + resourceDraftNumber(cargo.deuterium);
  const lootRatioSupported = !joinAttackMode && !acsDefendMode && action.mode === "mission" && action.kind === "attack";
  const lootRatioActive = lootRatioSupported && lootRatioEnabled;
  const displayedLootRatio = lootRatioActive ? lootRatio : GREEDY_LOOT_RATIO;
  const lootRatioTotal = displayedLootRatio.metal + displayedLootRatio.crystal + displayedLootRatio.deuterium;
  const timingSummary = missionTimingSummary(travelSeconds, nowMs);
  const stationedDefenders = action.kind === "attack" && action.mode === "mission"
    ? target?.publicState?.stationedDefenders ?? []
    : [];
  const stationedDefenderRows = stationedDefenderAttackWarningRows(stationedDefenders);
  const targetFleetUnits = useMemo(() => compositionUnits(target?.publicState?.fleet, shipCatalog, shipAssetByKey), [target?.publicState?.fleet]);
  const targetDefenseUnits = useMemo(() => compositionUnits(target?.publicState?.defenses, defenseCatalog, defenseAssetByKey), [target?.publicState?.defenses]);
  const battleForecast = useMemo(
    () => publicTargetBattleForecast(ships, target),
    [ships, target],
  );
  const resourceIntel = useMemo(
    () => targetResourceIntel(target, travelSeconds),
    [target, travelSeconds],
  );
  const maxLootForecast = useMemo(
    () => forecastRaidLoot(resourceIntel.projectedArrivalLootable, cargoCapacity, lootRatioActive ? lootRatio : null),
    [cargoCapacity, lootRatio, lootRatioActive, resourceIntel.projectedArrivalLootable],
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
    fuelCost: effectiveFuelCost,
    lootRatioActive,
    lootRatioTotal,
    originCoords,
    quantity,
    resources,
    selectedShipCount,
    totalCargoCapacity,
  });

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
    setLootRatioEnabled(true);
    setLootRatio((current) => rebalanceLootRatio(current, key, value));
  };
  const updateLootAmount = (key: ResourceKey, value: number) => {
    setLootRatioEnabled(true);
    setLootRatio((current) => lootRatioFromUpToAmount(current, key, value, cargoCapacity));
  };

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{joinAttackMode || acsDefendMode || defenseHoldMode ? action.label : `${action.label} Mission`}</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {originLabel ?? "Active planet"} to [{coords.galaxy}:{coords.system}:{coords.position}]
          </p>
        </div>
        <button
          className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <TargetIntelCard coords={coords} target={target} />

          {lootRatioSupported ? (
            <div className="grid gap-3 rounded-md border border-white/10 bg-black/15 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Probable outcome</h3>
                  <p className={`mt-1 text-sm font-semibold ${battleForecast.kind === "win" ? "text-emerald-200" : battleForecast.kind === "defeat" ? "text-red-200" : battleForecast.kind === "draw" ? "text-amber-200" : "text-slate-300"}`}>
                    {battleForecast.label}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Attack {battleForecast.attackerPower.toLocaleString()}</div>
                  <div>Defense {battleForecast.defenderPower == null ? "unknown" : battleForecast.defenderPower.toLocaleString()}</div>
                </div>
              </div>
              <p className="text-xs text-slate-500">{battleForecast.detail}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <ResourceSummary title="Max loot at arrival" resources={maxLootForecast} />
                <ResourceSummary title="Lootable at arrival" resources={resourceIntel.projectedArrivalLootable} />
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-md border border-white/10 bg-black/15 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Destination intel</h3>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Public state</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <UnitSection emptyLabel="No public fleet is stationed here." title="Destination Fleet" units={targetFleetUnits} />
              <UnitSection emptyLabel="No public defenses are deployed here." title="Defenses" units={targetDefenseUnits} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <ResourceSummary title="Resources now" resources={resourceIntel.current} />
              <ResourceSummary title="Projected at arrival" resources={resourceIntel.projectedArrival} />
              <ResourceSummary title="Lootable now" resources={resourceIntel.currentLootable} />
              <ResourceSummary title="Lootable at arrival" resources={resourceIntel.projectedArrivalLootable} />
            </div>
            <p className="text-xs text-slate-500">{resourceIntel.projectionDetail}</p>
          </div>

          {stationedDefenderRows.length > 0 ? (
            <div className="rounded border border-violet-300/25 bg-violet-300/10 px-3 py-2 text-sm text-violet-100">
              <p className="font-semibold">Stationed defenders can join this battle.</p>
              <p className="mt-1 text-xs text-violet-100/80">
                Public planet fleet and defense counts do not include these held fleets. They can defend
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
          ) : (
            <div className="grid gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ships</h3>
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
            </div>
          )}

          {cargoSupported ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cargo</h3>
                <span className="text-xs text-slate-500">Capacity {cargoCapacity.toLocaleString()}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <ResourceField label="Metal" max={maxCargoResources.metal} onChange={(metal) => setCargo((current) => ({ ...current, metal }))} value={cargo.metal ?? ""} />
                <ResourceField label="Crystal" max={maxCargoResources.crystal} onChange={(crystal) => setCargo((current) => ({ ...current, crystal }))} value={cargo.crystal ?? ""} />
                <ResourceField label="Deuterium" max={maxCargoResources.deuterium} onChange={(deuterium) => setCargo((current) => ({ ...current, deuterium }))} value={cargo.deuterium ?? ""} />
              </div>
            </div>
          ) : null}

          {joinAttackMode ? null : (
            <div className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Speed</h3>
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
            </div>
          )}

          {defenseHoldMode ? (
            <div className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Hold duration</h3>
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
            </div>
          ) : null}

          {lootRatioSupported ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Loot ratio</span>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  {lootRatioEnabled ? "Custom split" : "Greedy default"}
                  <input
                    checked={lootRatioEnabled}
                    className="h-4 w-4 accent-signal [color-scheme:dark]"
                    onChange={(event) => setLootRatioEnabled((event.currentTarget as HTMLInputElement).checked)}
                    type="checkbox"
                  />
                </span>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  {RESOURCE_KEYS.map((key) => (
                    <PercentField
                      key={key}
                      label={`${resourceLabel(key)} %`}
                      onChange={(value) => updateLootPercent(key, value)}
                      value={displayedLootRatio[key]}
                    />
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {RESOURCE_KEYS.map((key) => (
                    <ResourceField
                      key={key}
                      label={`${resourceLabel(key)} up to`}
                      max={cargoCapacity}
                      onChange={(value) => updateLootAmount(key, resourceDraftNumber(value))}
                      value={String(Math.floor((cargoCapacity * displayedLootRatio[key]) / 100))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className={lootRatioTotal === LOOT_RATIO_TOTAL_PERCENT ? "text-slate-500" : "text-amber-200"}>
                    Total {lootRatioTotal}% (must equal {LOOT_RATIO_TOTAL_PERCENT}%). Unfilled shares roll over metal, crystal, then deuterium.
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white"
                      onClick={() => {
                        setLootRatioEnabled(false);
                        setLootRatio(DEFAULT_LOOT_RATIO);
                      }}
                      type="button"
                    >
                      Greedy
                    </button>
                    <button
                      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white"
                      onClick={() => {
                        setLootRatioEnabled(true);
                        setLootRatio(DEFAULT_LOOT_RATIO);
                      }}
                      type="button"
                    >
                      Even split
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="grid content-start gap-3 rounded-lg border border-white/10 bg-[#101624] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mission Summary</h3>
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
              subvalue={lootRatioActive ? "Custom split" : "Greedy default"}
              value={formatCompactResources(maxLootForecast)}
            />
          ) : null}
          {timingSummary ? (
            <>
              <SummaryRow label={holdingBreakdown ? "Reach planet" : "Arrival"} subvalue={timingSummary.arrivalClock} value={timingSummary.arrivalDuration} />
              {holdingBreakdown ? null : (
                <SummaryRow label="Return" subvalue={timingSummary.returnClock} value={timingSummary.returnDuration} />
              )}
            </>
          ) : null}
          {blockedReason ? (
            <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              {blockedReason}
            </p>
          ) : null}
          <button
            className="h-10 rounded border border-signal/35 bg-signal/15 px-3 text-sm font-semibold text-signal transition hover:bg-signal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
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
            {joinAttackMode ? "Join Attack" : acsDefendMode ? "Coordinate defense" : defenseHoldMode ? "Station defense" : "Confirm Mission"}
          </button>
        </aside>
      </div>
    </div>
  );
}

export function missionDraftBlocker({
  acsArrivalTooSlow = false,
  action,
  cargoCapacity,
  cargoSupported,
  cargoTotal,
  fleetSlots,
  fuelCost,
  lootRatioActive = false,
  lootRatioTotal = 0,
  originCoords,
  quantity,
  resources,
  selectedShipCount,
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
  fuelCost: number;
  lootRatioActive?: boolean | undefined;
  lootRatioTotal?: number | undefined;
  originCoords: Coordinates | undefined;
  quantity: number;
  resources: MissionResourceSnapshot | undefined;
  selectedShipCount: number;
  totalCargoCapacity: number;
}): string | undefined {
  if (!originCoords) return "Active origin planet is unavailable.";
  // Interplanetary missiles do not occupy fleet slots, so they skip the fleet-slot gate below.
  if (action.mode === "missile") return quantity > 0 ? undefined : "Choose at least one missile.";
  // Every fleet mission (attack/transport/deploy/harvest/colonize) consumes a fleet slot, capped at
  // 1 + Computer Technology level on-chain (FleetSlotLimitReached). Block before submit when the cap is
  // reached and name the lever. Fail open when the backend did not provide slot counts so a valid
  // launch is never blocked; the on-chain revert remains the backstop.
  if (fleetSlots && fleetSlots.limit > 0 && fleetSlots.active >= fleetSlots.limit) {
    return `Fleet slots full (${fleetSlots.active}/${fleetSlots.limit}) — research Computer Technology to raise the limit, or wait for a fleet to return.`;
  }
  if (selectedShipCount <= 0) return "Choose at least one ship.";
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
    projectedArrivalLootable: plunderableResources(projected.resources),
    projectionDetail: projected.detail,
  };
}

export function publicTargetBattleForecast(ships: MissionShips, target: Planet | undefined): BattleForecastState {
  const attackerPower = missionShipsCombatPower(ships);
  if (fleetMissionShipCount(ships) <= 0) {
    return {
      kind: "uncertain",
      label: "Uncertain",
      detail: "Select ships to preview the attack against public destination intel.",
      attackerPower,
      defenderPower: null,
    };
  }
  if (!target?.publicState) {
    return {
      kind: "uncertain",
      label: "Uncertain",
      detail: "The target is not charted in the public indexed state, so exact destination fleet and defenses are unknown.",
      attackerPower,
      defenderPower: null,
    };
  }

  const defenderPower = compositionCombatPower(target.publicState.fleet, "ship")
    + compositionCombatPower(target.publicState.defenses, "defense");
  if (defenderPower <= 0) {
    return {
      kind: "win",
      label: "Probable win",
      detail: "No public stationed fleet or battlefield defenses are visible. Hidden state is not assumed.",
      attackerPower,
      defenderPower,
    };
  }
  if (attackerPower >= defenderPower * 1.15) {
    return {
      kind: "win",
      label: "Probable win",
      detail: "Your selected fleet materially exceeds visible public defender power. Combat randomness and unindexed changes can still alter the result.",
      attackerPower,
      defenderPower,
    };
  }
  if (attackerPower <= defenderPower * 0.85) {
    return {
      kind: "defeat",
      label: "Probable defeat",
      detail: "Visible public defender power materially exceeds your selected fleet. Add ships or reconsider the target.",
      attackerPower,
      defenderPower,
    };
  }
  return {
    kind: "draw",
    label: "Probable draw",
    detail: "Public attacker and defender power are close enough that the battle outcome is uncertain.",
    attackerPower,
    defenderPower,
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
    <div className="grid gap-3 rounded-md border border-white/10 bg-black/15 p-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      {target?.image ? (
        <img
          alt=""
          className="h-20 w-20 rounded-md border border-white/10 object-cover"
          loading="lazy"
          src={target.image}
        />
      ) : (
        <div className="grid h-20 w-20 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-xs text-slate-500">
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

function UnitSection({ emptyLabel, title, units }: { emptyLabel: string; title: string; units: UnitItem[] }) {
  return (
    <section className="grid gap-2 rounded border border-white/10 bg-[#070913]/60 p-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{title}</h4>
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
    <section className="rounded border border-white/10 bg-[#070913]/60 p-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{title}</h4>
      <p className="mt-1 text-sm font-medium text-slate-200">{formatCompactResources(resources)}</p>
    </section>
  );
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
): { resources: MissionResourceSnapshot; detail: string } {
  const buildings = publicBuildingLevels(target);
  if (!buildings || travelSeconds <= 0) {
    return {
      resources: current,
      detail: "Projected arrival resources use the current public snapshot until public production data is available.",
    };
  }

  const energyTechnologyLevel = publicResearchLevel(target, "energy");
  const solarSatelliteCount = target?.publicState?.fleet?.find((row) => row.id === 9)?.count ?? 0;
  const productionProfile = {
    ...(target?.temperature.max != null ? { maxTemperature: target.temperature.max } : {}),
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
  };
  const production = productionPerHour(buildings, productionProfile, energyTechnologyLevel, solarSatelliteCount);
  const caps = storageCaps(buildings);
  const hours = Math.max(0, travelSeconds) / SECONDS_PER_HOUR;
  return {
    resources: {
      metal: Math.min(caps.metal, current.metal + Math.floor(production.metal * hours)),
      crystal: Math.min(caps.crystal, current.crystal + Math.floor(production.crystal * hours)),
      deuterium: Math.min(caps.deuterium, current.deuterium + Math.floor(production.deuterium * hours)),
    },
    detail: "Projected arrival resources use public building/resource preview math and assume no new production, spending, transport, or combat changes before arrival.",
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

function publicResearchLevel(target: Planet | undefined, key: "energy"): number {
  const id = researchCatalog.find((entry) => entry.key === key)?.id;
  if (id == null) return 0;
  return target?.publicState?.research?.find((row) => row.id === id)?.level ?? 0;
}

function plunderableResources(resources: MissionResourceSnapshot): MissionResourceSnapshot {
  return {
    metal: Math.floor((resources.metal * RAID_PLUNDER_BPS) / BPS),
    crystal: Math.floor((resources.crystal * RAID_PLUNDER_BPS) / BPS),
    deuterium: Math.floor((resources.deuterium * RAID_PLUNDER_BPS) / BPS),
  };
}

function missionShipsCombatPower(ships: MissionShips): number {
  return missionShipOptions.reduce((total, option) => {
    const count = Math.max(0, Math.trunc(ships[option.key] ?? 0));
    const ship = shipCatalog.find((entry) => entry.key === option.key);
    return total + count * (ship ? combatStatsPower(shipCombatStats(ship).rows) : 0);
  }, 0);
}

function compositionCombatPower(
  rows: Array<{ id: number; count: number }> | undefined | null,
  kind: "ship" | "defense",
): number {
  return (rows ?? []).reduce((total, row) => {
    const count = Math.max(0, Math.trunc(row.count));
    if (kind === "ship") {
      const ship = shipCatalog.find((entry) => entry.id === row.id);
      return total + count * (ship ? combatStatsPower(shipCombatStats(ship).rows) : 0);
    }
    const defense = defenseCatalog.find((entry) => entry.id === row.id);
    return total + count * (defense ? combatStatsPower(defenseCombatStats(defense).rows) : 0);
  }, 0);
}

function combatStatsPower(rows: Array<{ label: string; value: number | string }>): number {
  return rows.reduce((total, row) => {
    if (typeof row.value !== "number") return total;
    if (row.label === "Attack") return total + row.value;
    if (row.label === "Shield") return total + row.value;
    if (row.label === "Hull") return total + row.value / 10;
    return total;
  }, 0);
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
