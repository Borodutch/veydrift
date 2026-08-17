import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Coordinates, DebrisField, Planet, PublicStationedDefender } from "../types";
import { ActionReasonNote } from "./ActionReasonNote";
import {
  DEFAULT_MISSION_SPEED_PERCENT,
  acsDefendHoldingFuel,
  fleetMissionAvailableCargoCapacity,
  fleetMissionCargoCapacity,
  fleetMissionDistance,
  fleetMissionDistanceForMission,
  fleetMissionFuelCost,
  interplanetaryMissileRange,
  interplanetaryMissileSystemDistance,
  fleetMissionShipCount,
  fleetMissionTravelSeconds,
  type AcsDefendFuelBreakdown,
  type FleetDriveLevels,
} from "../fleetMissionRules";
import { planetArtTypeFromArchetypeOrCoords } from "../data/mockUniverse";
import { defenseAssetByKey, shipAssetByKey } from "../gameAssets";
import { emptyMissionShips, type GalaxyAction, type MissionShipKey, type MissionShips } from "../galaxyActions";
import {
  buildingContractIds,
  defenseCatalog,
  productionPerHour,
  researchCatalog,
  shipCatalog,
  storageCaps,
  type BuildingKey,
  type ShipKey,
} from "../playableMvp";
import { shortAddress, type ChainShipyardState } from "../walletFlow";
import { formatDuration } from "../durationFormat";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { PlanetMoonIndicator } from "./PlanetMoonIndicator";
import { MissionRouteCell, type MissionEndpoint } from "./missionRoute";
import {
  contractCombatPower,
  forecastContractBattle,
  summarizeContractBattleForecast,
  type BattleOutcome,
  type CombatResources,
  type ContractBattleForecastSummary,
  type ContractBattleInput,
  type ContractBattleReportSeed,
  type ContractBattleResult,
} from "../battlePreview";
import {
  battlePreviewInputKey,
} from "../battlePreviewScheduler";

export type CombatTechLevels = {
  weapons: number;
  shielding: number;
  armor: number;
};

export type MissionCargoDraft = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export function emptyMissionCargoDraft(): MissionCargoDraft {
  return { metal: "0", crystal: "0", deuterium: "0" };
}

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
  originIsMoon?: boolean | undefined;
  targetIsMoon?: boolean | undefined;
  // VEY-KANEO-440: chosen hold window (seconds) for a proactive DefenseHold stationing mission.
  holdSeconds?: number | undefined;
};

export type MissionSpecificLoadout = {
  shipsTitle: string;
  cargoTitle: string;
};

export const LOOT_RATIO_TOTAL_PERCENT = 100;
const DEFAULT_LOOT_RATIO: MissionLootRatioDraft = { metal: 34, crystal: 33, deuterium: 33 };
const GREEDY_LOOT_RATIO: MissionLootRatioDraft = { metal: 100, crystal: 0, deuterium: 0 };
const RAID_PLUNDER_BPS = 5_000;
const BPS = 10_000;
const RESOURCE_KEYS = ["metal", "crystal", "deuterium"] as const;
const ZERO_COMBAT_TECH_LEVELS: CombatTechLevels = { weapons: 0, shielding: 0, armor: 0 };

type EnabledGalaxyAction = Extract<GalaxyAction, { enabled: true }>;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export type MissionAttackLootMode = "none" | "joined" | "custom";

export function missionAttackLootMode({
  action,
  joinAttackMode,
  originIsMoon,
  targetIsMoon,
}: {
  action: EnabledGalaxyAction;
  joinAttackMode: boolean;
  originIsMoon: boolean;
  targetIsMoon: boolean;
}): MissionAttackLootMode {
  if (action.mode !== "mission" || action.kind !== "attack") return "none";
  if (joinAttackMode) return "joined";
  return "custom";
}

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

export type MissionBodySelection = {
  defaultOriginIsMoon?: boolean | undefined;
  defaultTargetIsMoon?: boolean | undefined;
  originMoonAvailable: boolean;
  targetMoonAvailable: boolean;
  originMoonResources?: MissionResourceSnapshot | undefined;
  originMoonShipyardState?: ChainShipyardState | null | undefined;
  targetSelectionLocked?: boolean | undefined;
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
      attackerLosses?: BattleForecastLossRange;
      randomness?: BattleForecastRandomness | null;
      attackerTechLevels?: CombatTechLevels;
      defenderTechLevels?: CombatTechLevels;
      defenderTechKnown?: boolean;
      loading?: boolean;
      reportInput?: ContractBattleInput;
      reportSeed?: ContractBattleReportSeed;
      sampleReport?: ContractBattleResult | null;
    })
  | ({
      kind: "win" | "defeat" | "draw";
      label: "Probable win" | "Probable defeat" | "Probable draw";
      detail: string;
      attackerPower: number;
      defenderPower: number;
      attackerLosses: BattleForecastLossRange;
      randomness: BattleForecastRandomness | null;
      attackerTechLevels?: CombatTechLevels;
      defenderTechLevels?: CombatTechLevels;
      defenderTechKnown?: boolean;
      loading?: boolean;
      reportInput?: ContractBattleInput;
      reportSeed?: ContractBattleReportSeed;
      sampleReport?: ContractBattleResult;
    });

export type BattleForecastLossRange = {
  average: MissionResourceSnapshot;
  best: MissionResourceSnapshot;
  worst: MissionResourceSnapshot;
};

export type BattleForecastRandomness = {
  outcomeRange: Array<"win" | "defeat" | "draw">;
  sampleCount: number;
  outcomeCounts: Record<"win" | "defeat" | "draw", number>;
  attackerSurvivorRange: {
    min: number;
    max: number;
  };
};

export type JoinAttackForecastParticipant = {
  missionId: string;
  label: string;
  owner: string;
  laneGroup: number | null;
  ships?: Record<string, string>;
  combatTechnology?: CombatTechLevels;
};

export type JoinAttackForecastContext = {
  participants: readonly JoinAttackForecastParticipant[];
  stationedDefenders?: readonly PublicStationedDefender[];
  selectedAttackerLaneGroup: number | null;
  unavailableReason?: string;
};

export type BattleForecastTiming = {
  projectedAttackArrivalAt: number | null;
};

export type PreparedPublicTargetBattleForecast =
  | {
      status: "complete";
      forecast: BattleForecastState;
    }
  | {
      status: "simulate";
      input: ContractBattleInput;
      pending: BattleForecastState;
      context: {
        attackerPower: number;
        defenderPower: number;
        stationedDefendersPresent: boolean;
        targetIsMoon: boolean;
        attackerTechLevels: CombatTechLevels;
        defenderTechLevels: CombatTechLevels;
        defenderTechKnown: boolean;
      };
    };

export type StationedDefenderQualification = {
  defenders: readonly PublicStationedDefender[];
  unavailableReason?: string;
};

export type TargetResourceIntel = {
  current: MissionResourceSnapshot | null;
  projectedArrival: MissionResourceSnapshot | null;
  currentLootable: MissionResourceSnapshot | null;
  projectedArrivalLootable: MissionResourceSnapshot | null;
  projectionDetail: string;
};

export function shouldShowDestinationIntel(action: EnabledGalaxyAction): boolean {
  return action.kind !== "colonize"
    && action.kind !== "deploy"
    && action.kind !== "transport"
    && action.kind !== "defenseHold"
    && action.kind !== "acsDefend";
}

export function shouldShowReturnTiming(action: EnabledGalaxyAction, hasHoldingBreakdown: boolean): boolean {
  return action.kind !== "colonize" && !hasHoldingBreakdown;
}

export const MISSION_TIMING_RESERVED_HEIGHT_PX = 42;
export const MISSION_TIMING_PLACEHOLDER = "Select ships to calculate";

export type MissionTimingSummary = {
  arrivalClock: string;
  arrivalDuration: string;
  returnClock: string;
  returnDuration: string;
};

export type MissionTimingRow = {
  align: "left" | "right";
  kind: "arrival" | "return";
  placeholder: boolean;
  time: string;
  value: string;
};

// Keep the timing cells present before travel math is valid. The route card owns a fixed-height
// two-line timing strip, while missions without a return leg simply leave the opposite column empty.
// `hasHoldingPeriod` describes the mission mode, not a selected-fleet calculation, so adding/removing
// ships cannot make the return cell itself appear or disappear.
export function missionTimingRows(
  action: EnabledGalaxyAction,
  hasHoldingPeriod: boolean,
  summary: MissionTimingSummary | null,
): MissionTimingRow[] {
  const placeholder = summary === null;
  const rows: MissionTimingRow[] = [];
  if (shouldShowReturnTiming(action, hasHoldingPeriod)) {
    rows.push({
      align: "left",
      kind: "return",
      placeholder,
      time: summary?.returnClock ?? MISSION_TIMING_PLACEHOLDER,
      value: summary?.returnDuration ?? "—",
    });
  }
  rows.push({
    align: "right",
    kind: "arrival",
    placeholder,
    time: summary?.arrivalClock ?? MISSION_TIMING_PLACEHOLDER,
    value: summary?.arrivalDuration ?? "—",
  });
  return rows;
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
const deployShipKeys = new Set<MissionShipKey>(missionShipOptions.map((ship) => ship.key));

export function missionSpecificLoadout(action: EnabledGalaxyAction): MissionSpecificLoadout | null {
  if (action.mode !== "mission") return null;
  if (action.kind === "transport") {
    return {
      shipsTitle: "Ships to transport",
      cargoTitle: "Cargo to transport",
    };
  }
  if (action.kind === "deploy") {
    return {
      shipsTitle: "Ships to deploy",
      cargoTitle: "Supplies to deploy",
    };
  }
  return null;
}

export function missionComposerRouteEndpoints({
  originCoords,
  originIsMoon,
  originLabel,
  target,
  targetCoords,
  targetIsMoon,
}: {
  originCoords: Coordinates | undefined;
  originIsMoon: boolean;
  originLabel?: string | undefined;
  target: Planet | undefined;
  targetCoords: Coordinates;
  targetIsMoon: boolean;
}): { origin: MissionEndpoint; target: MissionEndpoint } {
  const originCoordinates = originCoords ? coordinateString(originCoords) : null;
  const targetCoordinates = coordinateString(targetCoords);
  const originPlanetName = originLabel?.trim() || originCoordinates || "Active planet";
  const targetPlanetName = target?.name?.trim() || targetCoordinates;

  return {
    origin: {
      archetype: planetArtTypeFromArchetypeOrCoords(null, originCoords ?? null),
      bodyKind: originIsMoon ? "moon" : "planet",
      commanderName: null,
      commanderWallet: null,
      coordinates: originCoordinates,
      coords: originCoords ?? null,
      hasMoon: originIsMoon,
      name: originIsMoon ? `Moon of ${originPlanetName}` : originPlanetName,
    },
    target: {
      archetype: planetArtTypeFromArchetypeOrCoords(target?.type, targetCoords),
      bodyKind: targetIsMoon ? "moon" : "planet",
      commanderName: null,
      commanderWallet: null,
      coordinates: targetCoordinates,
      coords: targetCoords,
      hasMoon: targetIsMoon || Boolean(target?.hasMoon),
      name: targetIsMoon ? `Moon of ${targetPlanetName}` : targetPlanetName,
    },
  };
}

function coordinateString(coords: Coordinates): string {
  return `${coords.galaxy}:${coords.system}:${coords.position}`;
}

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
  bodySelection,
  coords,
  defenseHoldContext,
  defenseHoldMode = false,
  attackerCombatTechLevels = ZERO_COMBAT_TECH_LEVELS,
  driveLevels = {},
  joinAttackContext,
  joinAttackMode = false,
  moonAttackParityEnabled = false,
  nowMs = Date.now(),
  onBack,
  onConfirm,
  originCoords,
  originLabel,
  resources,
  missileInventory,
  shipyardState,
  submitBlocker,
  target,
}: {
  // VEY-KANEO-440: render the picker for an ACS Defend ("Defend planet") counterplay. Like a normal
  // mission it keeps the ship picker and speed control, but adds a hold-duration / holding-fuel /
  // Alliance Depot preview and pins the launch to the hostile attack's arrival.
  acsDefendContext?: AcsDefendComposeContext | undefined;
  acsDefendMode?: boolean | undefined;
  action: EnabledGalaxyAction;
  actionPending: boolean;
  actionPendingLabel?: string | undefined;
  bodySelection?: MissionBodySelection | undefined;
  coords: Coordinates;
  // VEY-KANEO-440: render a proactive DefenseHold compose — adds a player-chosen hold-duration selector
  // and a travel + holding-fuel + Alliance Depot preview, stationing the fleet at the target planet.
  defenseHoldContext?: DefenseHoldComposeContext | undefined;
  defenseHoldMode?: boolean | undefined;
  attackerCombatTechLevels?: CombatTechLevels | undefined;
  driveLevels?: FleetDriveLevels | undefined;
  joinAttackContext?: JoinAttackForecastContext | undefined;
  // VEY-KANEO-431: render the picker for a join-attack — ship selection only,
  // with no loot ratio or speed controls (the join inherits the lead attack's
  // loot split and coordinated arrival).
  joinAttackMode?: boolean | undefined;
  /** Runtime capability enabled only after the compatible game implementation is live. */
  moonAttackParityEnabled?: boolean | undefined;
  // Injectable clock so hold-duration math is deterministic in tests.
  nowMs?: number | undefined;
  onBack: () => void;
  onConfirm: (draft: MissionLaunchDraft) => void;
  originCoords: Coordinates | undefined;
  originLabel?: string | undefined;
  resources?: MissionResourceSnapshot | undefined;
  /** Current origin-planet Interplanetary Missile count (defense id 9). */
  missileInventory?: number | undefined;
  shipyardState: ChainShipyardState | null;
  submitBlocker?: string | undefined;
  target: Planet | undefined;
}) {
  const defaultOriginIsMoon = Boolean(bodySelection?.defaultOriginIsMoon)
    || (action.mode === "mission" && action.defaultOriginIsMoon === true);
  const initialOriginShipyardState = defaultOriginIsMoon && bodySelection?.originMoonAvailable
    ? bodySelection.originMoonShipyardState ?? null
    : undefined;
  const [speedPercent, setSpeedPercent] = useState(DEFAULT_MISSION_SPEED_PERCENT);
  const [ships, setShips] = useState<MissionShips>(() => initialMissionShips(action, initialOriginShipyardState));
  const [cargo, setCargo] = useState<MissionCargoDraft>(emptyMissionCargoDraft);
  const [greedyLootEnabled, setGreedyLootEnabled] = useState(false);
  const [lootRatio, setLootRatio] = useState<MissionLootRatioDraft>(DEFAULT_LOOT_RATIO);
  const [primaryTargetId, setPrimaryTargetId] = useState(action.mode === "missile" ? action.primaryTargetId : 0);
  const [quantity, setQuantity] = useState(action.mode === "missile" ? action.quantity : 1);
  const [holdHours, setHoldHours] = useState<number>(DEFAULT_DEFENSE_HOLD_HOURS);
  const [originIsMoon, setOriginIsMoon] = useState(() => defaultOriginIsMoon);
  const [targetIsMoon, setTargetIsMoon] = useState(
    () => Boolean(bodySelection?.defaultTargetIsMoon) || (action.mode === "mission" && action.defaultTargetIsMoon === true)
  );

  const cargoSupported = action.mode === "mission" && (action.kind === "transport" || action.kind === "deploy");
  const specificLoadout = missionSpecificLoadout(action);
  const bodyMissionSupported = action.mode === "mission" && (action.kind === "attack" || cargoSupported);
  const bodySelectionVisibility = missionBodySelectionVisibility({
    bodyMissionSupported: bodyMissionSupported && Boolean(bodySelection),
    // Keep an explicitly selected moon visible when refreshed state says it disappeared. The
    // submit blocker below must fail closed instead of silently changing the launch origin.
    originMoonAvailable: Boolean(bodySelection?.originMoonAvailable) || originIsMoon,
    targetMoonAvailable: Boolean(bodySelection?.targetMoonAvailable) || targetIsMoon,
    targetSelectionLocked: Boolean(bodySelection?.targetSelectionLocked),
  });
  const effectiveOriginIsMoon = Boolean(bodySelectionVisibility.originVisible && originIsMoon);
  // Preserve an explicitly selected moon even if refreshed intel says it disappeared. Switching this
  // to the parent planet would change the transaction target without the player's consent; the draft
  // blocker below instead keeps the Moon selection visible and fails closed.
  const effectiveTargetIsMoon = targetIsMoon;
  const distance = originCoords
    ? action.mode === "mission"
      ? fleetMissionDistanceForMission(originCoords, coords, action.mission, {
          originIsMoon: effectiveOriginIsMoon,
          targetIsMoon: effectiveTargetIsMoon,
        })
      : fleetMissionDistance(originCoords, coords, {
          originIsMoon: effectiveOriginIsMoon,
          targetIsMoon: effectiveTargetIsMoon,
        })
    : 0;
  const travelSeconds = action.mode === "missile" ? 0 : fleetMissionTravelSeconds(distance, ships, driveLevels, speedPercent);
  const fuelCost = action.mode === "missile" ? 0 : fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  const totalCargoCapacity = action.mode === "missile" ? 0 : fleetMissionCargoCapacity(ships);
  const cargoCapacity = action.mode === "missile" ? 0 : fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  const selectedShipCount = action.mode === "missile" ? 0 : fleetMissionShipCount(ships);
  const availableMissiles = Math.max(0, Math.trunc(missileInventory ?? 0));
  const missileRange = interplanetaryMissileRange(driveLevels.impulseDrive);
  const missileSystemDistance = originCoords ? interplanetaryMissileSystemDistance(originCoords, coords) : null;
  const missileRangeBlocker = action.mode !== "missile" ? undefined
    : missileSystemDistance === null
      ? "Interplanetary missiles cannot cross galaxies."
      : missileSystemDistance > missileRange
        ? `Target is ${missileSystemDistance} systems away; Impulse Drive ${Math.max(0, Math.trunc(driveLevels.impulseDrive ?? 0))} reaches ${missileRange}.`
        : undefined;
  const missileTargetOptions = defenseCatalog.filter((defense) => defense.id >= 0 && defense.id <= 7);
  const selectedMissileTarget = missileTargetOptions.find((defense) => defense.id === primaryTargetId) ?? missileTargetOptions[0];
  const selectedMissileTargetCount = target?.publicState?.defenses?.find((defense) => defense.id === primaryTargetId)?.count ?? 0;
  const effectiveResources = effectiveOriginIsMoon ? bodySelection?.originMoonResources : resources;
  const effectiveShipyardState = effectiveOriginIsMoon ? bodySelection?.originMoonShipyardState ?? null : shipyardState;
  const availableShips = useMemo(() => missionShipOptionsForAction(action, effectiveShipyardState), [action, effectiveShipyardState]);
  const destinationIntelVisible = shouldShowDestinationIntel(action);
  const cargoTotal = resourceDraftNumber(cargo.metal) + resourceDraftNumber(cargo.crystal) + resourceDraftNumber(cargo.deuterium);
  const normalizedCargo = cargoSupported ? normalizeMissionCargoDraft(cargo) : undefined;
  const moonAttackNeedsUpgrade = action.kind === "attack"
    && (effectiveOriginIsMoon || effectiveTargetIsMoon)
    && !moonAttackParityEnabled;
  const attackLootMode = moonAttackNeedsUpgrade
    ? "none"
    : missionAttackLootMode({
        action,
        joinAttackMode,
        originIsMoon: effectiveOriginIsMoon,
        targetIsMoon: effectiveTargetIsMoon,
      });
  const attackIntelVisible = attackLootMode !== "none";
  const lootPreviewVisible = attackLootMode === "custom";
  const lootRatioSupported = attackLootMode === "custom" && !acsDefendMode;
  const lootRatioActive = lootRatioSupported && !greedyLootEnabled;
  const displayedLootRatio = lootRatioActive ? lootRatio : GREEDY_LOOT_RATIO;
  const lootRatioTotal = displayedLootRatio.metal + displayedLootRatio.crystal + displayedLootRatio.deuterium;
  const timingSummary = missionTimingSummary(travelSeconds, nowMs);
  const projectedAttackArrivalAt = action.kind === "attack" && action.mode === "mission" && !joinAttackMode
    ? projectedMissionArrivalAtSeconds(travelSeconds, nowMs)
    : null;
  const soloStationedDefenderQualification = action.kind === "attack"
    && action.mode === "mission"
    && !joinAttackMode
    && !effectiveTargetIsMoon
    ? stationedDefendersAtAttackArrival(
        target?.publicState?.stationedDefenderForecastTimeline ?? [],
        projectedAttackArrivalAt,
        target?.publicState?.stationedDefenderTimelineComplete === true,
      )
    : { defenders: [] };
  const stationedDefenders = joinAttackMode
    ? joinAttackContext?.stationedDefenders ?? []
    : soloStationedDefenderQualification.defenders;
  const stationedDefenderRows = stationedDefenderAttackWarningRows(stationedDefenders);
  const targetComposition = useMemo(
    () => missionTargetCompositionUnits(target, effectiveTargetIsMoon),
    [
      effectiveTargetIsMoon,
      target?.publicMoonState?.defenses,
      target?.publicMoonState?.fleet,
      target?.publicState?.defenses,
      target?.publicState?.fleet,
    ],
  );
  const targetFleetUnits = targetComposition.fleet;
  const targetDefenseUnits = targetComposition.defenses;
  const stationedDefenderUnits = useMemo(
    () => stationedDefenderCompositionUnits(stationedDefenders),
    [stationedDefenders],
  );
  const preparedBattleForecast = useMemo(
    () => preparePublicTargetBattleForecast(
      ships,
      target,
      attackerCombatTechLevels,
      effectiveTargetIsMoon,
      joinAttackMode
        ? joinAttackContext ?? {
            participants: [],
            stationedDefenders: [],
            selectedAttackerLaneGroup: null,
            unavailableReason: "Lead and joined attacker participant intel is unavailable for this group attack.",
          }
        : undefined,
      joinAttackMode ? undefined : { projectedAttackArrivalAt },
    ),
    [
      attackerCombatTechLevels,
      effectiveTargetIsMoon,
      joinAttackContext,
      joinAttackMode,
      projectedAttackArrivalAt,
      ships,
      target,
    ],
  );
  const battleForecast = useDeferredPublicTargetBattleForecast(preparedBattleForecast);
  const resourceIntel = useMemo(
    () => targetResourceIntel(target, travelSeconds, effectiveTargetIsMoon),
    [effectiveTargetIsMoon, target, travelSeconds],
  );
  const staleShipQuantityBlocker = useMemo(
    () => staleSelectedShipQuantityBlocker(action, ships, effectiveShipyardState),
    [action, effectiveShipyardState, ships],
  );
  const maxLootForecast = useMemo(
    () => forecastRaidLoot(
      resourceIntel.projectedArrivalLootable,
      cargoCapacity,
      lootRatioSupported && !greedyLootEnabled ? lootRatio : null,
    ),
    [cargoCapacity, greedyLootEnabled, lootRatio, lootRatioSupported, resourceIntel.projectedArrivalLootable],
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
  const timingRows = action.mode === "missile" || joinAttackMode
    ? []
    : missionTimingRows(action, acsActive || defenseHoldActive, timingSummary);
  // Net holding fuel rides in the defending fleet's own deuterium spend on-chain, so it counts toward
  // both the deuterium balance and cargo-capacity gates.
  const effectiveFuelCost = holdingBreakdown ? fuelCost + holdingBreakdown.netHoldingFuel : fuelCost;
  const hasInsufficientFuel = effectiveResources !== undefined
    && (effectiveResources.deuterium ?? 0) < effectiveFuelCost;

  const blockedReason = missionDraftBlocker({
    acsArrivalTooSlow,
    action,
    cargo: normalizedCargo,
    cargoCapacity,
    cargoSupported,
    cargoTotal,
    fleetSlots: effectiveShipyardState?.fleetSlots,
    fleetSlotsUnavailableReason: effectiveShipyardState?.fleetLaunchAvailable === false
      ? effectiveShipyardState.fleetLaunchUnavailableReason ?? effectiveShipyardState.unavailableReason ?? "Fleet slot state is still syncing."
      : undefined,
    fuelCost: effectiveFuelCost,
    lootRatioActive,
    lootRatioTotal,
    originCoords,
    missileInventory: availableMissiles,
    missileRangeBlocker,
    quantity,
    resources: effectiveResources,
    selectedShipCount,
    staleShipQuantityBlocker,
    submitBlocker: moonAttackNeedsUpgrade
      ? "Moon attack parity is still activating. Refresh shortly before launching."
      : effectiveOriginIsMoon && !bodySelection?.originMoonShipyardState
      ? "Moon fleet state is still loading."
      : missionTargetMoonUnavailableReason(effectiveTargetIsMoon, bodySelection?.targetMoonAvailable)
        ?? submitBlocker,
    totalCargoCapacity,
  });
  const visibleBlockedReason = actionPending ? undefined : blockedReason;

  const maxCargoResources = {
    metal: Math.max(0, Math.trunc(effectiveResources?.metal ?? 0)),
    crystal: Math.max(0, Math.trunc(effectiveResources?.crystal ?? 0)),
    deuterium: Math.max(0, Math.trunc((effectiveResources?.deuterium ?? 0) - fuelCost)),
  };
  const setShipQuantity = (key: MissionShipKey, value: number, owned: number) => {
    setShips((current) => ({
      ...current,
      [key]: clampInteger(value, 0, owned),
    }));
    // A fleet change can reduce capacity, but must not silently rewrite cargo. Keep the exact
    // rendered values and let missionDraftBlocker require an explicit user correction if needed.
    setCargo(reconcileMissionCargoAfterFleetChange);
  };
  const changeOriginBody = (value: boolean) => {
    setCargo((current) => missionCargoAfterBodyChange(current, effectiveOriginIsMoon, value));
    setOriginIsMoon(value);
  };
  const changeTargetBody = (value: boolean) => {
    setCargo((current) => missionCargoAfterBodyChange(current, effectiveTargetIsMoon, value));
    setTargetIsMoon(value);
  };
  const updateLootPercent = (key: ResourceKey, value: number) => {
    setGreedyLootEnabled(false);
    setLootRatio((current) => rebalanceLootRatio(current, key, value));
  };
  const updateLootAmount = (key: ResourceKey, value: number) => {
    setGreedyLootEnabled(false);
    setLootRatio((current) => lootRatioFromUpToAmount(current, key, value, cargoCapacity));
  };
  const routeEndpoints = missionComposerRouteEndpoints({
    originCoords,
    originIsMoon: effectiveOriginIsMoon,
    originLabel,
    target,
    targetCoords: coords,
    targetIsMoon: effectiveTargetIsMoon,
  });
  const confirmMission = () => onConfirm(buildMissionLaunchDraft({
    action,
    cargo,
    defenseHoldSeconds,
    defenseHoldActive,
    effectiveOriginIsMoon,
    effectiveTargetIsMoon,
    lootRatio,
    lootRatioActive,
    primaryTargetId,
    quantity,
    speedPercent,
    ships,
  }));
  const confirmLabel = action.mode === "missile"
    ? actionPendingLabel ?? "Launch missile strike"
    : missionConfirmButtonLabel({
      acsDefendMode,
      actionPendingLabel,
      defenseHoldMode,
      joinAttackMode,
    });

  return (
    <section
      aria-label="Mission creation"
      className="mx-auto grid w-full min-w-0 max-w-4xl gap-3 overflow-x-clip"
      data-mission-composer
    >
      <section
        aria-label="Mission route"
        className="rounded-lg border border-white/10 bg-[#101624] px-3 py-2.5 shadow-sm shadow-black/10"
      >
        <MissionRouteCell
          arrowLabel={`Planned route from ${routeEndpoints.origin.name} to ${routeEndpoints.target.name}`}
          compact
          direction="outbound"
          origin={routeEndpoints.origin}
          progressPercent={100}
          subdued
          target={routeEndpoints.target}
        />
        {timingRows.length > 0 ? <MissionTimingGrid rows={timingRows} /> : null}
      </section>

      <div className="grid gap-3">
        <section className="grid gap-3">
          {bodySelectionVisibility.sectionVisible ? (
            <MissionFormSection title="Bodies" eyebrow="Route">
              {bodySelectionVisibility.originVisible ? (
                <BodySelectionRow
                  moonAvailable
                  moonLabel="Origin moon"
                  onChange={changeOriginBody}
                  planetLabel="Origin planet"
                  value={effectiveOriginIsMoon}
                />
              ) : null}
              {bodySelectionVisibility.targetVisible ? (
                <BodySelectionRow
                  moonAvailable
                  moonLabel="Destination moon"
                  onChange={changeTargetBody}
                  planetLabel="Destination planet"
                  value={effectiveTargetIsMoon}
                />
              ) : null}
            </MissionFormSection>
          ) : null}

          {attackIntelVisible ? (
            <AttackIntelPanel
              battleForecast={battleForecast}
              stationedDefenderUnits={stationedDefenderUnits}
              targetDefenseUnits={targetDefenseUnits}
              targetFleetUnits={targetFleetUnits}
            />
          ) : specificLoadout || (!destinationIntelVisible && action.kind !== "harvest") ? null : (
            <NonAttackMissionIntelPanel
              action={action}
              cargoCapacity={cargoCapacity}
              destinationIntelVisible={destinationIntelVisible}
              resourceIntel={resourceIntel}
              stationedDefenderUnits={stationedDefenderUnits}
              targetDefenseUnits={targetDefenseUnits}
              targetFleetUnits={targetFleetUnits}
              targetDebrisField={target?.debrisField ?? null}
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
            <MissionFormSection summary={`${availableMissiles.toLocaleString()} ready`} title="Missile strike" eyebrow="Ordnance">
              <p className="mb-3 text-sm text-slate-300">
                Instant strike — no ships, fuel, fleet slot, or return flight.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label="Interplanetary missiles"
                  max={availableMissiles}
                  min={1}
                  onChange={setQuantity}
                  value={quantity}
                />
                <label className="grid gap-1">
                  <span className="text-xs text-slate-500">Primary defense target</span>
                  <select
                    aria-label="Primary defense target"
                    className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-sm text-white outline-none focus:border-signal/50"
                    onChange={(event) => setPrimaryTargetId(Number((event.currentTarget as HTMLSelectElement).value))}
                    value={primaryTargetId}
                  >
                    {missileTargetOptions.map((defense) => {
                      const count = target?.publicState?.defenses?.find((item) => item.id === defense.id)?.count ?? 0;
                      return <option key={defense.id} value={defense.id}>{defense.label} — {count.toLocaleString()}</option>;
                    })}
                  </select>
                </label>
              </div>
              <div className="mt-3 grid gap-2 rounded border border-sky-300/20 bg-sky-300/5 px-3 py-2 text-xs text-sky-100/90 sm:grid-cols-2">
                <p>Range: Impulse Drive {Math.max(0, Math.trunc(driveLevels.impulseDrive ?? 0))} → {missileRange.toLocaleString()} systems (5 × drive − 1).</p>
                <p>Route: {missileSystemDistance === null ? "different galaxy — unavailable" : `${missileSystemDistance.toLocaleString()} / ${missileRange.toLocaleString()} systems`}</p>
                <p className="sm:col-span-2">Target anti-ballistic missiles intercept one-for-one first. Remaining hits destroy up to {selectedMissileTargetCount.toLocaleString()} {selectedMissileTarget?.label ?? "selected defenses"}.</p>
              </div>
            </MissionFormSection>
          ) : specificLoadout ? (
            <>
              <MissionFormSection
                summary={`${selectedShipCount.toLocaleString()} selected`}
                title={specificLoadout.shipsTitle}
                eyebrow="Loadout"
              >
                <MissionShipPicker
                  availableShips={availableShips}
                  onShipQuantityChange={setShipQuantity}
                  shipyardState={effectiveShipyardState}
                  ships={ships}
                />
              </MissionFormSection>
              <MissionFormSection
                summary={`Capacity left ${cargoTotal.toLocaleString()} / ${cargoCapacity.toLocaleString()}`}
                title={specificLoadout.cargoTitle}
                eyebrow="Cargo"
              >
                <MissionCargoPicker
                  cargo={cargo}
                  cargoCapacity={cargoCapacity}
                  maxCargoResources={maxCargoResources}
                  onCargoChange={setCargo}
                />
              </MissionFormSection>
            </>
          ) : (
            <MissionFormSection
              summary={`${selectedShipCount.toLocaleString()} selected`}
              title="Fleet"
              eyebrow="Ships"
            >
              <MissionShipPicker
                availableShips={availableShips}
                onShipQuantityChange={setShipQuantity}
                shipyardState={effectiveShipyardState}
                ships={ships}
              />
            </MissionFormSection>
          )}

          {joinAttackMode || action.mode === "missile" ? null : (
            <MissionFormSection
              summary={(
                <MissionFuelCost
                  fuelCost={effectiveFuelCost}
                  insufficient={hasInsufficientFuel}
                />
              )}
              title="Speed"
              eyebrow="Flight plan"
            >
              <div className="flex items-center gap-3">
                <input
                  aria-label="Mission speed"
                  className="h-10 min-w-0 flex-1 cursor-pointer accent-cyan-300"
                  id="mission-speed"
                  max={100}
                  min={10}
                  onInput={(event) => setSpeedPercent(Number(event.currentTarget.value))}
                  step={10}
                  type="range"
                  value={speedPercent}
                />
                <output
                  className="min-w-12 rounded border border-signal/30 bg-signal/10 px-2 py-1 text-center text-sm font-semibold tabular-nums text-signal"
                  htmlFor="mission-speed"
                >
                  {speedPercent}%
                </output>
              </div>
            </MissionFormSection>
          )}

          {defenseHoldMode ? (
            <MissionFormSection
              summary={holdingBreakdown ? `${holdingBreakdown.netHoldingFuel.toLocaleString()} deuterium holding fuel` : undefined}
              title="Hold"
              eyebrow="Stationing"
            >
              <div className="flex flex-wrap gap-1.5">
                {DEFENSE_HOLD_HOUR_OPTIONS.map((hours) => (
                  <button
                    aria-pressed={holdHours === hours}
                    className={`h-10 rounded border px-2 text-xs font-semibold transition sm:h-8 ${
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
            </MissionFormSection>
          ) : null}

          {acsActive && holdingBreakdown ? (
            <MissionFormSection
              summary={`${holdingBreakdown.netHoldingFuel.toLocaleString()} deuterium holding fuel`}
              title="Hold"
              eyebrow="Stationing"
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <CompactFactRow label="Duration" value={formatDuration(holdingBreakdown.holdSeconds)} />
                <CompactFactRow label="Depot" value={acsDefendContext?.depotLevel ? `Level ${acsDefendContext.depotLevel}` : "No support"} />
                <CompactFactRow label="Total fuel" value={`${effectiveFuelCost.toLocaleString()} D`} />
              </div>
            </MissionFormSection>
          ) : null}

          {lootPreviewVisible ? (
            <MissionLootSection
              availableCargo={cargoCapacity}
              availabilityDetail={resourceIntel.projectionDetail}
              greedyLootEnabled={greedyLootEnabled}
              lootIntelAvailable={resourceIntel.projectedArrivalLootable !== null}
              lootRatio={displayedLootRatio}
              lootRatioTotal={lootRatioTotal}
              onAmountChange={updateLootAmount}
              onGreedyChange={setGreedyLootEnabled}
              onPercentChange={updateLootPercent}
              onResetEven={() => {
                setGreedyLootEnabled(false);
                setLootRatio(DEFAULT_LOOT_RATIO);
              }}
              predictedLoot={maxLootForecast}
            />
          ) : null}
        </section>

      </div>
      <div className="grid gap-2 border-t border-white/10 pt-3" data-mission-actions>
        {visibleBlockedReason ? (
          <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            {visibleBlockedReason}
          </p>
        ) : null}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
          <MissionCancelButton onCancel={onBack} />
          <MissionConfirmButton
            actionPending={actionPending}
            blockedReason={blockedReason}
            label={confirmLabel}
            onConfirm={confirmMission}
          />
        </div>
      </div>
    </section>
  );
}

const OUTCOME_PREVIEW_SAMPLE_COUNT = 16;
const OUTCOME_PREVIEW_CACHE_LIMIT = 64;
const outcomePreviewCache = new Map<string, ContractBattleForecastSummary>();

function useDeferredPublicTargetBattleForecast(
  prepared: PreparedPublicTargetBattleForecast,
): BattleForecastState {
  if (prepared.status === "complete") return prepared.forecast;
  const previewKey = battlePreviewInputKey(prepared.input);
  try {
    let simulation = outcomePreviewCache.get(previewKey);
    if (!simulation) {
      simulation = summarizeContractBattleForecast(
        forecastContractBattle(prepared.input, OUTCOME_PREVIEW_SAMPLE_COUNT, false),
      );
      outcomePreviewCache.set(previewKey, simulation);
      if (outcomePreviewCache.size > OUTCOME_PREVIEW_CACHE_LIMIT) {
        const oldestKey = outcomePreviewCache.keys().next().value;
        if (oldestKey !== undefined) outcomePreviewCache.delete(oldestKey);
      }
    }
    return resolvePreparedPublicTargetBattleForecast(prepared, simulation);
  } catch (error) {
    return {
      ...prepared.pending,
      detail: `Outcome preview unavailable: ${
        error instanceof Error ? error.message : "Battle simulation failed."
      }`,
      loading: false,
    };
  }
}

function BodySelectionRow({
  moonAvailable,
  moonLabel,
  onChange,
  planetLabel,
  value,
}: {
  moonAvailable: boolean;
  moonLabel: string;
  onChange: (value: boolean) => void;
  planetLabel: string;
  value: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        aria-pressed={!value}
        className={`h-11 rounded border px-3 text-xs font-semibold transition sm:h-9 ${
          !value
            ? "border-signal/45 bg-signal/15 text-signal"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
        }`}
        onClick={() => onChange(false)}
        type="button"
      >
        {planetLabel}
      </button>
      <button
        aria-pressed={value}
        className={`h-11 rounded border px-3 text-xs font-semibold transition sm:h-9 ${
          value
            ? "border-signal/45 bg-signal/15 text-signal"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
        }`}
        disabled={!moonAvailable}
        onClick={() => onChange(true)}
        title={moonAvailable ? moonLabel : `${moonLabel} unavailable for this route.`}
        type="button"
      >
        {moonLabel}
      </button>
      {!moonAvailable ? (
        <div className="sm:col-span-2">
          <ActionReasonNote reason={`${moonLabel} unavailable for this route.`} />
        </div>
      ) : null}
    </div>
  );
}

export function missionBodySelectionVisibility({
  bodyMissionSupported,
  originMoonAvailable,
  targetMoonAvailable,
  targetSelectionLocked = false,
}: {
  bodyMissionSupported: boolean;
  originMoonAvailable: boolean;
  targetMoonAvailable: boolean;
  targetSelectionLocked?: boolean | undefined;
}): { sectionVisible: boolean; originVisible: boolean; targetVisible: boolean } {
  const originVisible = bodyMissionSupported && originMoonAvailable;
  const targetVisible = bodyMissionSupported && targetMoonAvailable && !targetSelectionLocked;
  return {
    originVisible,
    sectionVisible: originVisible || targetVisible,
    targetVisible,
  };
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

export function buildMissionLaunchDraft({
  action,
  cargo,
  defenseHoldActive,
  defenseHoldSeconds,
  effectiveOriginIsMoon,
  effectiveTargetIsMoon,
  lootRatio,
  lootRatioActive,
  primaryTargetId,
  quantity,
  ships,
  speedPercent,
}: {
  action: EnabledGalaxyAction;
  cargo: MissionCargoDraft;
  defenseHoldActive: boolean;
  defenseHoldSeconds: number;
  effectiveOriginIsMoon: boolean;
  effectiveTargetIsMoon: boolean;
  lootRatio: MissionLootRatioDraft;
  lootRatioActive: boolean;
  primaryTargetId: number;
  quantity: number;
  ships: MissionShips;
  speedPercent: number;
}): MissionLaunchDraft {
  const cargoSupported = action.mode === "mission" && (action.kind === "transport" || action.kind === "deploy");
  return {
    speedPercent,
    ships,
    cargo: cargoSupported ? normalizeMissionCargoDraft(cargo) : undefined,
    lootRatio: lootRatioActive ? { ...lootRatio } : undefined,
    primaryTargetId,
    quantity,
    originIsMoon: effectiveOriginIsMoon,
    targetIsMoon: effectiveTargetIsMoon,
    holdSeconds: defenseHoldActive ? defenseHoldSeconds : undefined,
  };
}

function MissionShipPicker({
  availableShips,
  onShipQuantityChange,
  ships,
  shipyardState,
}: {
  availableShips: ShipOption[];
  onShipQuantityChange: (key: MissionShipKey, value: number, owned: number) => void;
  ships: MissionShips;
  shipyardState: ChainShipyardState | null;
}) {
  if (availableShips.length <= 0) {
    return (
      <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
        No eligible ships are available on the active planet.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {availableShips.map((ship) => {
        const owned = shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0;
        return (
          <ShipQuantityRow
            key={ship.key}
            onChange={(value) => onShipQuantityChange(ship.key, value, owned)}
            owned={owned}
            ship={ship}
            value={ships[ship.key] ?? 0}
          />
        );
      })}
    </div>
  );
}

export function missionCargoMaxForResource(
  cargo: MissionCargoDraft,
  cargoCapacity: number,
  maxCargoResources: MissionResourceSnapshot,
  resource: ResourceKey,
): number {
  const otherCargoTotal = RESOURCE_KEYS
    .filter((key) => key !== resource)
    .reduce((total, key) => total + resourceDraftNumber(cargo[key]), 0);
  const remainingCapacity = Math.max(0, Math.trunc(cargoCapacity) - otherCargoTotal);
  const availableResource = Math.max(0, Math.trunc(maxCargoResources[resource]));
  return Math.min(availableResource, remainingCapacity);
}

export function MissionCargoPicker({
  cargo,
  cargoCapacity,
  maxCargoResources,
  onCargoChange,
}: {
  cargo: MissionCargoDraft;
  cargoCapacity: number;
  maxCargoResources: MissionResourceSnapshot;
  onCargoChange: (updater: (current: MissionCargoDraft) => MissionCargoDraft) => void;
}) {
  const fields: Array<{ key: ResourceKey; label: string }> = [
    { key: "metal", label: "Metal" },
    { key: "crystal", label: "Crystal" },
    { key: "deuterium", label: "Deuterium" },
  ];

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        {fields.map(({ key, label }) => {
          const maxValue = missionCargoMaxForResource(cargo, cargoCapacity, maxCargoResources, key);
          return (
            <ResourceField
              key={key}
              label={label}
              max={maxCargoResources[key]}
              maxAction={{
                value: maxValue,
                onSelect: () => onCargoChange((current) => ({
                  ...current,
                  [key]: String(missionCargoMaxForResource(current, cargoCapacity, maxCargoResources, key)),
                })),
              }}
              onChange={(value) => onCargoChange((current) => ({ ...current, [key]: value }))}
              value={cargo[key] ?? ""}
            />
          );
        })}
      </div>
    </>
  );
}

function MissionFormSection({
  children,
  summary,
  title,
}: {
  children: ComponentChildren;
  eyebrow: string;
  summary?: ComponentChildren | undefined;
  title: string;
}) {
  return (
    <section className="grid min-w-0 max-w-full gap-2 rounded-lg border border-white/10 bg-[#101624] p-3 shadow-sm shadow-black/10">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="shrink-0 text-xs font-semibold uppercase text-slate-400">{title}</h3>
        {typeof summary === "string"
          ? <span className="min-w-0 truncate text-right text-xs tabular-nums text-slate-500">{summary}</span>
          : summary}
      </header>
      {children}
    </section>
  );
}

export function MissionFuelCost({
  fuelCost,
  insufficient,
}: {
  fuelCost: number;
  insufficient: boolean;
}) {
  const formattedFuelCost = Math.max(0, Math.trunc(fuelCost)).toLocaleString();

  return (
    <output
      aria-atomic="true"
      aria-label={`Mission fuel cost: ${formattedFuelCost} deuterium${insufficient ? ". Insufficient deuterium." : ""}`}
      aria-live="polite"
      className={`flex min-w-0 max-w-full items-center justify-end gap-1.5 overflow-hidden rounded border px-2 py-1 text-right text-[11px] font-medium tabular-nums ${
        insufficient
          ? "border-amber-200/40 bg-amber-300/10 text-amber-100"
          : "border-white/10 bg-white/[0.04] text-white"
      }`}
      htmlFor="mission-speed"
      title="Mission fuel cost"
    >
      <span className="whitespace-nowrap text-white">{formattedFuelCost} deuterium</span>
      {insufficient ? <span className="truncate font-semibold">· Insufficient</span> : null}
    </output>
  );
}

export function MissionTimingGrid({ rows }: { rows: readonly MissionTimingRow[] }) {
  return (
    <div
      aria-label="Planned mission timing"
      className="mt-2 grid grid-cols-2 gap-3 overflow-hidden border-t border-white/10 pt-2 text-xs"
      data-mission-timing
      style={{ minHeight: `${MISSION_TIMING_RESERVED_HEIGHT_PX}px` }}
    >
      {rows.map((row) => (
        <RouteTiming
          align={row.align}
          key={row.kind}
          kind={row.kind}
          placeholder={row.placeholder}
          time={row.time}
          value={row.value}
        />
      ))}
    </div>
  );
}

function RouteTiming({
  align,
  kind,
  placeholder,
  time,
  value,
}: {
  align: "left" | "right";
  kind: "arrival" | "return";
  placeholder: boolean;
  time: string;
  value: string;
}) {
  const label = kind === "arrival" ? "Arrival" : "Return";
  return (
    <div
      aria-atomic="true"
      aria-label={placeholder ? `${label} timing: ${time}` : `${label} timing: ${value}, ${time}`}
      aria-live="polite"
      className={`grid min-w-0 gap-0.5 ${align === "right" ? "col-start-2 justify-items-end text-right" : "justify-items-start text-left"}`}
      data-mission-timing-kind={kind}
      data-mission-timing-state={placeholder ? "placeholder" : "calculated"}
      title={placeholder ? time : undefined}
    >
      <span className={`font-medium tabular-nums ${placeholder ? "text-slate-500" : "text-slate-200"}`}>{value}</span>
      <span className="max-w-full truncate whitespace-nowrap text-[10px] tabular-nums text-slate-500">{time}</span>
    </div>
  );
}

function MissionCancelButton({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      className="min-h-11 rounded border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
      onClick={onCancel}
      type="button"
    >
      Cancel
    </button>
  );
}

function MissionConfirmButton({
  actionPending,
  blockedReason,
  label,
  onConfirm,
}: {
  actionPending: boolean;
  blockedReason: string | undefined;
  label: string;
  onConfirm: () => void;
}) {
  return (
    <button
      className="min-h-11 w-full rounded border border-signal/35 bg-signal/15 px-4 py-2 text-sm font-semibold leading-snug text-signal transition hover:bg-signal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
      disabled={Boolean(blockedReason) || actionPending}
      onClick={onConfirm}
      type="button"
    >
      {label}
    </button>
  );
}

export function missionDraftBlocker({
  acsArrivalTooSlow = false,
  action,
  cargo,
  cargoCapacity,
  cargoSupported,
  cargoTotal,
  fleetSlots,
  fleetSlotsUnavailableReason,
  fuelCost,
  lootRatioActive = false,
  lootRatioTotal = 0,
  originCoords,
  missileInventory,
  missileRangeBlocker,
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
  cargo?: MissionCargoDraft | undefined;
  cargoCapacity: number;
  cargoSupported: boolean;
  cargoTotal: number;
  fleetSlots?: { active: number; limit: number } | undefined;
  fleetSlotsUnavailableReason?: string | undefined;
  fuelCost: number;
  lootRatioActive?: boolean | undefined;
  lootRatioTotal?: number | undefined;
  originCoords: Coordinates | undefined;
  missileInventory?: number | undefined;
  missileRangeBlocker?: string | undefined;
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
  if (action.mode === "missile") {
    if (quantity <= 0) return "Choose at least one missile.";
    if (missileInventory !== undefined && quantity > Math.max(0, Math.trunc(missileInventory))) return `Only ${Math.max(0, Math.trunc(missileInventory)).toLocaleString()} interplanetary missiles are ready.`;
    return missileRangeBlocker;
  }
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
  const cargoOverdraft = cargoSupported ? cargoResourceOverdraft(cargo, resources, fuelCost) : undefined;
  if (cargoOverdraft) return cargoOverdraft;
  if (lootRatioActive && lootRatioTotal !== LOOT_RATIO_TOTAL_PERCENT) {
    return `Loot ratio must total ${LOOT_RATIO_TOTAL_PERCENT}%.`;
  }
  return undefined;
}

export function missionTargetMoonUnavailableReason(
  targetIsMoon: boolean,
  targetMoonAvailable: boolean | undefined,
): string | undefined {
  return targetIsMoon && targetMoonAvailable !== true
    ? "The target moon no longer exists. Select Planet or refresh the target before launching."
    : undefined;
}

function cargoResourceOverdraft(
  cargo: MissionCargoDraft | undefined,
  resources: MissionResourceSnapshot | undefined,
  fuelCost: number,
): string | undefined {
  if (!cargo || !resources) return undefined;
  const missing = RESOURCE_KEYS
    .map((key) => {
      const cargoAmount = resourceDraftNumber(cargo[key]);
      const requested = cargoAmount + (key === "deuterium" ? Math.max(0, Math.trunc(fuelCost)) : 0);
      const available = Math.max(0, Math.trunc(resources[key] ?? 0));
      if (requested <= available) return null;
      const detail = key === "deuterium" && fuelCost > 0
        ? `${requested.toLocaleString()} required (${Math.max(0, Math.trunc(fuelCost)).toLocaleString()} fuel + ${cargoAmount.toLocaleString()} cargo)`
        : `${requested.toLocaleString()} selected`;
      return `${resourceLabel(key)} ${detail} / ${available.toLocaleString()} available`;
    })
    .filter((row): row is string => Boolean(row));

  if (missing.length <= 0) return undefined;
  return `Cargo exceeds available resources: ${missing.join(", ")}.`;
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
  return `Selected ships are not available on the selected origin body: ${overSelected.join(", ")}. Switch the origin body or reduce the quantity before launching.`;
}

export function missionTimingSummary(travelSeconds: number, nowMs: number = Date.now()): MissionTimingSummary | null {
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

export function projectedMissionArrivalAtSeconds(
  travelSeconds: number,
  nowMs: number = Date.now(),
): number | null {
  if (!Number.isFinite(travelSeconds) || travelSeconds <= 0 || !Number.isFinite(nowMs) || nowMs < 0) {
    return null;
  }
  const departureAt = Math.floor(nowMs / 1_000);
  const arrivalAt = departureAt + Math.ceil(travelSeconds);
  return Number.isSafeInteger(arrivalAt) ? arrivalAt : null;
}

export function stationedDefendersAtAttackArrival(
  defenders: readonly PublicStationedDefender[],
  projectedAttackArrivalAt: number | null,
  timelineComplete: boolean,
): StationedDefenderQualification {
  if (!timelineComplete) {
    return {
      defenders: [],
      unavailableReason: "The indexed stationed-defender timeline is incomplete, so the battle-time defender roster is unknown.",
    };
  }
  if (defenders.length === 0) return { defenders: [] };
  if (
    projectedAttackArrivalAt == null
    || !Number.isSafeInteger(projectedAttackArrivalAt)
    || projectedAttackArrivalAt < 0
  ) {
    return {
      defenders: [],
      unavailableReason: "The projected attack arrival is unavailable, so stationed defenders cannot be qualified at battle time.",
    };
  }

  const qualified: PublicStationedDefender[] = [];
  for (const defender of defenders) {
    const arrivalAt = Number(defender.arrivalAt);
    const holdUntil = Number(defender.holdUntil);
    if (
      !Number.isSafeInteger(arrivalAt)
      || arrivalAt < 0
      || !Number.isSafeInteger(holdUntil)
      || holdUntil < 0
    ) {
      return {
        defenders: [],
        unavailableReason: `Stationed fleet #${defender.missionId} is missing an exact arrival or hold timestamp for battle-time qualification.`,
      };
    }

    // For scheduled/legacy DefenseHolds the backend can expose `returnAt` only as a conservative upper
    // bound. Outside that bound the fleet is definitely absent; inside it the contract hold window is
    // unknown, so do not fabricate a participant.
    if (defender.battleWindowComplete !== true) {
      if (arrivalAt > projectedAttackArrivalAt || holdUntil < projectedAttackArrivalAt) continue;
      return {
        defenders: [],
        unavailableReason: `Stationed fleet #${defender.missionId} has no exact indexed hold window at the projected battle arrival.`,
      };
    }
    if (arrivalAt <= projectedAttackArrivalAt && holdUntil >= projectedAttackArrivalAt) {
      qualified.push(defender);
    }
  }
  return { defenders: qualified };
}

export function initialMissionShips(
  _action: EnabledGalaxyAction,
  _originShipyardState?: MissionShipInventorySnapshot | null,
): MissionShips {
  // Action descriptors and live inventory determine eligibility and picker availability, not player
  // intent. Keeping every mount/reset empty also prevents later inventory hydration from becoming an
  // implicit selection path for required-ship missions.
  return emptyMissionShips();
}

function missionShipOptionsForAction(action: EnabledGalaxyAction, shipyardState: ChainShipyardState | null): ShipOption[] {
  if (action.mode === "missile") return [];
  const allowed = allowedShipKeysForAction(action);
  return missionShipOptions.filter((ship) => allowed.has(ship.key) && (shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0) > 0);
}

export function stationedDefenderAttackWarningRows(
  defenders: readonly PublicStationedDefender[] | null | undefined
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
  if (action.kind === "transport") return cargoShipKeys;
  if (action.kind === "deploy") return deployShipKeys;
  return new Set(missionShipOptions.map((ship) => ship.key).filter((key) => key !== "colonyShip"));
}

export function normalizeMissionCargoDraft(
  cargo: Partial<MissionCargoDraft> | undefined,
): MissionCargoDraft {
  return {
    metal: String(resourceDraftNumber(cargo?.metal)),
    crystal: String(resourceDraftNumber(cargo?.crystal)),
    deuterium: String(resourceDraftNumber(cargo?.deuterium)),
  };
}

export function reconcileMissionCargoAfterFleetChange(cargo: MissionCargoDraft): MissionCargoDraft {
  return normalizeMissionCargoDraft(cargo);
}

export function missionCargoAfterBodyChange(
  cargo: MissionCargoDraft,
  currentIsMoon: boolean,
  nextIsMoon: boolean,
): MissionCargoDraft {
  return currentIsMoon === nextIsMoon
    ? normalizeMissionCargoDraft(cargo)
    : emptyMissionCargoDraft();
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

export function targetResourceIntel(target: Planet | undefined, travelSeconds: number, targetIsMoon = false): TargetResourceIntel {
  if (targetIsMoon) {
    const current = publicMoonResourceSnapshot(target);
    if (current) {
      return {
        current,
        projectedArrival: travelSeconds > 0 ? current : null,
        currentLootable: plunderableResources(current),
        projectedArrivalLootable: travelSeconds > 0 ? plunderableResources(current) : null,
        projectionDetail: travelSeconds > 0
          ? "Moon arrival projection uses the current public moon resource snapshot until moon production data is available."
          : "Select ships to calculate travel time; current public moon resources are shown now.",
      };
    }
    return {
      current: null,
      projectedArrival: null,
      currentLootable: null,
      projectedArrivalLootable: null,
      projectionDetail: "Moon resource intel is unavailable, so parent planet loot is not shown for this target.",
    };
  }
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

export function preparePublicTargetBattleForecast(
  ships: MissionShips,
  target: Planet | undefined,
  attackerTechLevels: CombatTechLevels = ZERO_COMBAT_TECH_LEVELS,
  targetIsMoon = false,
  joinAttackContext?: JoinAttackForecastContext,
  timing?: BattleForecastTiming,
): PreparedPublicTargetBattleForecast {
  const complete = (forecast: BattleForecastState): PreparedPublicTargetBattleForecast => ({
    status: "complete",
    forecast,
  });
  const normalizedAttackerTechLevels = normalizeCombatTechLevels(attackerTechLevels);
  const defenderTechLevels = targetCombatTechLevels(target);
  const defenderTechKnown = Boolean(target?.publicState?.research);
  const forecastTech = {
    attackerTechLevels: normalizedAttackerTechLevels,
    defenderTechLevels,
    defenderTechKnown,
  };
  const joinedAttackerPower = (joinAttackContext?.participants ?? []).reduce((total, participant) => {
    if (!participant.ships || !participant.combatTechnology) return total;
    return total + shipRecordCombatPower(participant.ships, participant.combatTechnology);
  }, 0);
  const attackerPower = missionShipsCombatPower(ships, normalizedAttackerTechLevels) + joinedAttackerPower;
  const pendingCombatIntel = (detail: string): PreparedPublicTargetBattleForecast => complete({
    kind: "uncertain",
    label: "Uncertain",
    detail,
    loading: true,
    attackerPower,
    defenderPower: null,
    ...forecastTech,
  });
  if (joinAttackContext?.unavailableReason) {
    return complete({
      kind: "uncertain",
      label: "Uncertain",
      detail: joinAttackContext.unavailableReason,
      attackerPower,
      defenderPower: null,
      ...forecastTech,
    });
  }
  if (joinAttackContext) {
    for (const participant of joinAttackContext.participants) {
      if (!participant.ships) {
        return complete({
          kind: "uncertain",
          label: "Uncertain",
          detail: `${participant.label} composition is missing from public intel, so the combined attack is not simulated as only the selected joining fleet.`,
          attackerPower,
          defenderPower: null,
          ...forecastTech,
        });
      }
      if (!participant.combatTechnology) {
        return complete({
          kind: "uncertain",
          label: "Uncertain",
          detail: `${participant.label} combat technology is missing from public intel, so owner-specific contract scaling cannot be simulated safely.`,
          attackerPower,
          defenderPower: null,
          ...forecastTech,
        });
      }
      if (participant.laneGroup == null || !Number.isFinite(participant.laneGroup)) {
        return complete({
          kind: "uncertain",
          label: "Uncertain",
          detail: `${participant.label} contract random-stream lane identity is missing from public intel.`,
          attackerPower,
          defenderPower: null,
          ...forecastTech,
        });
      }
    }
    if (joinAttackContext.selectedAttackerLaneGroup == null || !Number.isFinite(joinAttackContext.selectedAttackerLaneGroup)) {
      return complete({
        kind: "uncertain",
        label: "Uncertain",
        detail: "The selected joining fleet's exact contract random-stream lane is missing from public intel.",
        attackerPower,
        defenderPower: null,
        ...forecastTech,
      });
    }
  }
  if (!target) {
    return pendingCombatIntel("Destination fleet and defense data is unavailable, so exact defender strength is unknown.");
  }
  const bodyState = targetIsMoon ? target.publicMoonState : target.publicState;
  if (!bodyState) {
    return pendingCombatIntel(
      targetIsMoon
        ? "Moon fleet and defense intel is unavailable. Parent-planet forces are never substituted for a moon battle."
        : "Destination fleet and defense data is unavailable, so exact defender strength is unknown.",
    );
  }
  if (!Array.isArray(bodyState.fleet) || !Array.isArray(bodyState.defenses)) {
    return pendingCombatIntel(
      targetIsMoon
        ? "Moon fleet or defense intel is incomplete. Parent-planet forces are never substituted for a moon battle."
        : "Destination fleet or defense intel is incomplete, so absent fields are not treated as empty forces.",
    );
  }
  if (!defenderTechKnown) {
    return pendingCombatIntel("The destination owner's combat technology is missing from public intel, so the preview will not assume zero levels.");
  }
  const forecastStationedDefenders = targetIsMoon
    ? []
    : joinAttackContext?.stationedDefenders ?? target.publicState?.stationedDefenderForecastTimeline;
  if (!targetIsMoon && !Array.isArray(forecastStationedDefenders)) {
    return pendingCombatIntel(
      joinAttackContext
        ? "Attack-specific stationed/counterplay defender intel is unavailable, so defending fleets are not silently omitted."
        : "Stationed-defender intel is unavailable, so allied defending fleets are not silently omitted.",
    );
  }

  let stationedDefenders = forecastStationedDefenders ?? [];
  if (!targetIsMoon && !joinAttackContext) {
    const qualification = stationedDefendersAtAttackArrival(
      stationedDefenders,
      timing?.projectedAttackArrivalAt ?? null,
      target.publicState?.stationedDefenderTimelineComplete === true,
    );
    if (qualification.unavailableReason) {
      return pendingCombatIntel(qualification.unavailableReason);
    }
    stationedDefenders = qualification.defenders;
  }
  const missingStationedTechnology = stationedDefenders.find((defender) => !defender.combatTechnology);
  if (missingStationedTechnology) {
    return complete({
      kind: "uncertain",
      label: "Uncertain",
      detail: `${missingStationedTechnology.defenderDisplayName ?? missingStationedTechnology.defender}'s stationed fleet combat technology is not indexed, so its owner-specific contract scaling cannot be simulated safely.`,
      attackerPower,
      defenderPower: null,
      ...forecastTech,
    });
  }
  const missingStationedLane = stationedDefenders.find(
    (defender) => defender.laneGroup == null || !Number.isFinite(defender.laneGroup),
  );
  if (missingStationedLane) {
    return complete({
      kind: "uncertain",
      label: "Uncertain",
      detail: `Stationed fleet #${missingStationedLane.missionId} is missing its exact contract random-stream lane identity.`,
      attackerPower,
      defenderPower: null,
      ...forecastTech,
    });
  }

  const stationedPower = stationedDefendersCombatPower(stationedDefenders);
  const defenderPower = compositionCombatPower(bodyState.fleet, "ship", defenderTechLevels)
    + compositionCombatPower(bodyState.defenses, "defense", defenderTechLevels)
    + stationedPower;
  const input: ContractBattleInput = {
    attackers: [
      ...(joinAttackContext?.participants ?? []).map((participant) => ({
        id: participant.missionId,
        label: participant.label,
        owner: participant.owner,
        laneGroup: participant.laneGroup ?? 0,
        ships: combatShipRecordCounts(participant.ships ?? {}),
        technology: normalizeCombatTechLevels(participant.combatTechnology),
      })),
      {
        id: "selected-attacker",
        label: joinAttackContext ? "Selected joining fleet" : "Selected attacking fleet",
        owner: "Connected commander",
        laneGroup: joinAttackContext?.selectedAttackerLaneGroup ?? 0,
        ships: missionShipCounts(ships),
        technology: normalizedAttackerTechLevels,
      },
    ],
    defender: {
      id: targetIsMoon ? `moon-${target.id}` : `planet-${target.id}`,
      label: targetIsMoon ? `${target.moonName ?? target.name} moon` : target.name,
      owner: target.owner ?? target.occupiedBy?.owner ?? "Unknown owner",
      ships: combatCompositionCounts(bodyState.fleet, 16),
      defenses: combatCompositionCounts(bodyState.defenses, 8),
      technology: defenderTechLevels,
      counterplay: stationedDefenders.map((defender) => ({
        id: `stationed-${defender.missionId}`,
        label: defender.defenderDisplayName
          ? `${defender.defenderDisplayName}'s stationed fleet`
          : `Stationed fleet #${defender.missionId}`,
        owner: defender.defender,
        laneGroup: defender.laneGroup ?? 0,
        ships: combatShipRecordCounts(defender.ships),
        technology: normalizeCombatTechLevels(defender.combatTechnology),
      })),
    },
  };
  const prepared: Extract<PreparedPublicTargetBattleForecast, { status: "simulate" }> = {
    status: "simulate",
    input,
    pending: {
      kind: "uncertain",
      label: "Uncertain",
      detail: "Calculating the latest outcome preview…",
      loading: true,
      attackerPower,
      defenderPower,
      ...forecastTech,
    },
    context: {
      attackerPower,
      defenderPower,
      stationedDefendersPresent: stationedPower > 0,
      targetIsMoon,
      ...forecastTech,
    },
  };
  // There is nothing stochastic to defer when no attacking unit exists. Apart
  // from making the empty picker feel instant, resolving this inline prevents
  // an unnecessary worker request during the brief zero-selection state while
  // the user is composing a fleet.
  if (input.attackers.every((attacker) => attacker.ships.every((count) => count <= 0))) {
    return complete(resolvePreparedPublicTargetBattleForecast(
      prepared,
      summarizeContractBattleForecast(forecastContractBattle(input, 1, false)),
    ));
  }
  return prepared;
}

export function resolvePreparedPublicTargetBattleForecast(
  prepared: Extract<PreparedPublicTargetBattleForecast, { status: "simulate" }>,
  simulation: ContractBattleForecastSummary,
): BattleForecastState {
  const kind = simulation.probableOutcome;
  const label = kind === "win" ? "Probable win" : kind === "defeat" ? "Probable defeat" : "Probable draw";
  return {
    kind,
    label,
    detail: battleForecastDetail(
      kind,
      simulation,
      prepared.context.stationedDefendersPresent,
      prepared.context.targetIsMoon,
    ),
    attackerPower: prepared.context.attackerPower,
    defenderPower: prepared.context.defenderPower,
    attackerLosses: simulation.attackerLosses,
    randomness: {
      outcomeRange: (["win", "draw", "defeat"] as const).filter((outcome) => simulation.outcomeCounts[outcome] > 0),
      sampleCount: simulation.sampleCount,
      outcomeCounts: simulation.outcomeCounts,
      attackerSurvivorRange: simulation.attackerSurvivorRange,
    },
    reportInput: prepared.input,
    reportSeed: simulation.sampleReport,
    attackerTechLevels: prepared.context.attackerTechLevels,
    defenderTechLevels: prepared.context.defenderTechLevels,
    defenderTechKnown: prepared.context.defenderTechKnown,
  };
}

export function publicTargetBattleForecast(
  ships: MissionShips,
  target: Planet | undefined,
  attackerTechLevels: CombatTechLevels = ZERO_COMBAT_TECH_LEVELS,
  targetIsMoon = false,
  joinAttackContext?: JoinAttackForecastContext,
  timing?: BattleForecastTiming,
): BattleForecastState {
  const prepared = preparePublicTargetBattleForecast(
    ships,
    target,
    attackerTechLevels,
    targetIsMoon,
    joinAttackContext,
    timing,
  );
  if (prepared.status === "complete") return prepared.forecast;
  const simulation = forecastContractBattle(prepared.input);
  return {
    ...resolvePreparedPublicTargetBattleForecast(
      prepared,
      summarizeContractBattleForecast(simulation),
    ),
    sampleReport: simulation.sampleReport,
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
  const quantityDigits = Math.max(1, String(value).length);

  return (
    <label className="grid gap-2 rounded border border-white/10 bg-black/15 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <span className="flex min-w-0 items-center gap-2">
        <img alt="" className="h-9 w-9 shrink-0 rounded border border-white/10 object-contain" loading="lazy" src={ship.asset} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-200">{ship.label}</span>
          <span className="block text-xs text-slate-500">Fleet unit</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center justify-end gap-1">
        <button
          aria-label={`Decrease ${ship.label}`}
          className="h-11 w-11 shrink-0 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9 sm:w-9"
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          -
        </button>
        <input
          aria-label={`${ship.label} quantity`}
          className="h-9 min-w-16 rounded border border-white/10 bg-[#070913] px-2 text-center font-mono text-sm text-white outline-none [appearance:textfield] [color-scheme:dark] focus:border-signal/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          inputMode="numeric"
          max={owned}
          min={0}
          onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
          style={{ width: `calc(${quantityDigits}ch + 3rem)` }}
          type="number"
          value={value}
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">/ {owned.toLocaleString()}</span>
        <button
          aria-label={`Increase ${ship.label}`}
          className="h-11 w-11 shrink-0 rounded border border-white/10 bg-white/[0.03] text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 sm:h-9 sm:w-9"
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
        <span className={`relative block overflow-hidden ${imageClassName}`}>
          <img
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            src={target.image}
          />
          {target.hasMoon ? <PlanetMoonIndicator compact planetType={target.type} /> : null}
        </span>
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
  stationedDefenderUnits,
  targetDefenseUnits,
  targetFleetUnits,
}: {
  battleForecast: BattleForecastState;
  coords?: Coordinates | undefined;
  lootableAtArrival?: MissionResourceSnapshot | null | undefined;
  maxLootForecast?: MissionResourceSnapshot | undefined;
  resourceIntel?: TargetResourceIntel | undefined;
  showLoot?: boolean | undefined;
  stationedDefenderUnits: UnitItem[];
  target?: Planet | undefined;
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] shadow-sm shadow-black/10">
      <div className="grid divide-y divide-white/10">
        <AttackOutcomeContent
          battleForecast={battleForecast}
          compact
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
  destinationIntelVisible,
  resourceIntel,
  stationedDefenderUnits,
  target,
  targetDefenseUnits,
  targetFleetUnits,
  targetDebrisField,
}: {
  action: EnabledGalaxyAction;
  cargoCapacity: number;
  cargoSupported?: boolean | undefined;
  coords?: Coordinates | undefined;
  destinationIntelVisible: boolean;
  holdDepotLevel?: number | undefined;
  holdingBreakdown?: AcsDefendFuelBreakdown | null | undefined;
  resourceIntel: TargetResourceIntel;
  stationedDefenderUnits: UnitItem[];
  target?: Planet | undefined;
  targetDefenseUnits: UnitItem[];
  targetFleetUnits: UnitItem[];
  targetDebrisField?: DebrisField | null | undefined;
}) {
  const harvestDebris = action.kind === "harvest"
    ? targetDebrisSnapshot(targetDebrisField ?? target?.debrisField ?? null)
    : null;
  if (!harvestDebris && !destinationIntelVisible) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] shadow-sm shadow-black/10">
      <div className={`grid divide-y divide-white/10 lg:divide-x lg:divide-y-0 ${
        harvestDebris && destinationIntelVisible ? "lg:grid-cols-3" : destinationIntelVisible ? "lg:grid-cols-2" : ""
      }`}>
        {harvestDebris ? (
          <HarvestIntelTable cargoCapacity={cargoCapacity} resources={harvestDebris} />
        ) : null}
        {destinationIntelVisible ? (
          <>
          <ResourceIntelTable resourceIntel={resourceIntel} />
          <ForceIntelTable
            stationedDefenderUnits={stationedDefenderUnits}
            targetDefenseUnits={targetDefenseUnits}
            targetFleetUnits={targetFleetUnits}
          />
          </>
        ) : null}
      </div>
    </section>
  );
}

function HarvestIntelTable({
  cargoCapacity,
  resources,
}: {
  cargoCapacity: number;
  resources: MissionResourceSnapshot;
}) {
  return (
    <div className="grid content-start gap-2 p-3">
      <span className="text-[11px] font-semibold uppercase text-slate-500">Debris</span>
      <div className="grid gap-1 rounded border border-white/10 bg-black/15 p-2">
        <CompactFactRow label="Field" value={formatHarvestDebris(resources)} />
        <CompactFactRow label="Coverage" value={harvestCoverageLabel(resources, cargoCapacity)} />
      </div>
    </div>
  );
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


export function AttackOutcomePanel({
  battleForecast,
}: {
  battleForecast: BattleForecastState;
  lootableAtArrival: MissionResourceSnapshot | null;
  maxLootForecast: MissionResourceSnapshot;
}) {
  return (
    <section className="grid gap-2 rounded-md border border-white/10 bg-black/15 p-3">
      <AttackOutcomeContent
        battleForecast={battleForecast}
      />
    </section>
  );
}

function AttackOutcomeContent({
  battleForecast,
  compact = false,
}: {
  battleForecast: BattleForecastState;
  compact?: boolean | undefined;
  lootableAtArrival?: MissionResourceSnapshot | null | undefined;
  maxLootForecast?: MissionResourceSnapshot | undefined;
  showLoot?: boolean | undefined;
}) {
  if (battleForecast.loading) {
    return <AttackOutcomeSkeleton battleForecast={battleForecast} compact={compact} />;
  }

  if (compact) {
    return (
      <div className="grid content-start gap-2 bg-signal/[0.04] p-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-semibold uppercase text-slate-500">Outcome</span>
              <SimulatedBattleReportControl battleForecast={battleForecast} />
            </div>
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
          <CompactFactRow label="Estimated losses" value={formatLossRangeLong(battleForecast.attackerLosses)} />
          {battleForecast.randomness ? (
            <>
              <CompactFactRow label="Simulated outcomes" value={formatSimulationOutcomes(battleForecast.randomness)} />
              <CompactFactRow label="Attacker survivors" value={`${formatAttackerSurvivors(battleForecast.randomness)} ships`} />
            </>
          ) : null}
          <CompactFactRow
            label="Your technology"
            value={formatTechLevelsLong(battleForecast.attackerTechLevels ?? ZERO_COMBAT_TECH_LEVELS)}
          />
          <CompactFactRow
            label="Defender technology"
            value={battleForecast.defenderTechKnown
              ? formatTechLevelsLong(battleForecast.defenderTechLevels ?? ZERO_COMBAT_TECH_LEVELS)
              : "Still loading"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Outcome</h3>
            <SimulatedBattleReportControl battleForecast={battleForecast} />
          </div>
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
      <div className="grid gap-2 sm:grid-cols-2">
        <ResourceSummary title="Probable attacker losses" resources={battleForecast.attackerLosses?.average ?? null} />
        {battleForecast.randomness ? (
          <ResourceSummary title="Attacker loss range" resources={lossRangeSpread(battleForecast.attackerLosses)} />
        ) : null}
      </div>
      {battleForecast.randomness ? (
        <p className="text-xs text-amber-200">
          {formatSimulationOutcomes(battleForecast.randomness)}
          {" · "}
          {formatAttackerSurvivors(battleForecast.randomness)} attacker survivors
        </p>
      ) : null}
      <CombatTechSummary
        attackerLevels={battleForecast.attackerTechLevels ?? ZERO_COMBAT_TECH_LEVELS}
        defenderKnown={battleForecast.defenderTechKnown ?? false}
        defenderLevels={battleForecast.defenderTechLevels ?? ZERO_COMBAT_TECH_LEVELS}
      />
    </div>
  );
}

function AttackOutcomeSkeleton({
  battleForecast,
  compact,
}: {
  battleForecast: BattleForecastState;
  compact: boolean;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Calculating battle outcome"
      className={`grid animate-pulse content-start gap-2 ${compact ? "bg-signal/[0.04] p-3" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-2">
          <span className="text-[11px] font-semibold uppercase text-slate-500">Outcome</span>
          <span className="h-5 w-28 rounded bg-white/10" />
        </div>
        <div className="grid shrink-0 gap-1 text-right text-[11px] text-slate-500">
          <span>ATK <span className="font-semibold tabular-nums text-slate-300">{battleForecast.attackerPower.toLocaleString()}</span></span>
          <span>DEF <span className="font-semibold tabular-nums text-slate-300">{battleForecast.defenderPower == null ? "—" : battleForecast.defenderPower.toLocaleString()}</span></span>
        </div>
      </div>
      <span className="h-3 w-full rounded bg-white/[0.07]" />
      <span className="h-3 w-2/3 rounded bg-white/[0.07]" />
    </div>
  );
}

type LazyBattleReportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: ContractBattleResult }
  | { status: "error"; message: string };

function SimulatedBattleReportControl({ battleForecast }: { battleForecast: BattleForecastState }) {
  const eagerReport = battleForecast.sampleReport ?? null;
  const reportInput = battleForecast.reportInput;
  const reportSeed = battleForecast.reportSeed;
  if (eagerReport) {
    return (
      <SimulatedBattleReportDetails
        generateReport={() => undefined}
        report={eagerReport}
        sourceKey="eager-report"
        state={{ status: "ready", report: eagerReport }}
      />
    );
  }
  if (!reportInput || !reportSeed) {
    return (
      <button
        aria-label="Open simulated battle report"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-[11px] font-semibold normal-case text-slate-300 transition hover:border-signal/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        disabled
        title="A report is available when required public combat intel is known"
        type="button"
      >
        i
      </button>
    );
  }

  const sourceKey = `${battlePreviewInputKey(reportInput)}:${reportSeed.sampleId}:${reportSeed.randomWord}`;
  return (
    <LazySimulatedBattleReportControl
      key={sourceKey}
      reportInput={reportInput}
      reportSeed={reportSeed}
      sourceKey={sourceKey}
    />
  );
}

function LazySimulatedBattleReportControl({
  reportInput,
  reportSeed,
  sourceKey,
}: {
  reportInput: ContractBattleInput;
  reportSeed: ContractBattleReportSeed;
  sourceKey: string;
}) {
  const [state, setState] = useState<LazyBattleReportState>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ status: "idle" });
    return () => {
      requestIdRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [sourceKey]);

  const generateReport = useCallback(() => {
    if (state.status === "loading" || state.status === "ready") return;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../battleReport.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setState({ status: "loading" });
    worker.onmessage = (event: MessageEvent<
      | { report: ContractBattleResult; requestId: number }
      | { error: string; requestId: number }
    >) => {
      if (event.data.requestId !== requestId || requestIdRef.current !== requestId) return;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if ("report" in event.data) setState({ status: "ready", report: event.data.report });
      else setState({ status: "error", message: event.data.error });
    };
    worker.onerror = () => {
      if (requestIdRef.current !== requestId) return;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setState({ status: "error", message: "The battle report worker failed." });
    };
    worker.postMessage({
      input: reportInput,
      randomWord: reportSeed.randomWord,
      requestId,
      sampleId: reportSeed.sampleId,
    });
  }, [reportInput, reportSeed, state.status]);

  return (
    <SimulatedBattleReportDetails
      generateReport={generateReport}
      report={state.status === "ready" ? state.report : null}
      sourceKey={sourceKey}
      state={state}
    />
  );
}

function SimulatedBattleReportDetails({
  generateReport,
  report,
  sourceKey,
  state,
}: {
  generateReport: () => void;
  report: ContractBattleResult | null;
  sourceKey: string;
  state: LazyBattleReportState;
}) {
  return (
    <details
      className="group/report"
      key={sourceKey}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.open = false;
      }}
      onToggle={(event) => {
        if (event.currentTarget.open) generateReport();
      }}
    >
      <summary
        aria-label="Open simulated battle report"
        className="grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full border border-white/15 bg-white/[0.04] text-[11px] font-semibold normal-case text-slate-300 transition hover:border-signal/50 hover:text-white [&::-webkit-details-marker]:hidden"
        role="button"
        title="Open simulated battle report"
      >
        i
      </summary>
      <div className="hidden group-open/report:block">
        <div
          aria-label="Simulated battle report"
          aria-modal="true"
          className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
        >
          <div
            className="mx-auto grid max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl gap-4 overflow-y-auto rounded-lg border border-white/15 bg-[#0b101c] p-4 shadow-2xl shadow-black/60 sm:max-h-[calc(100dvh-3rem)] sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Possible battle</h2>
                <p className="mt-1 text-xs text-slate-400">
                  One possible outcome from the battle preview. The future on-chain result may differ.
                </p>
              </div>
              <button
                aria-label="Close simulated battle report"
                className="inline-grid h-9 w-9 shrink-0 place-items-center rounded border border-white/15 text-slate-300 transition hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
                onClick={(event) => {
                  const details = event.currentTarget.closest("details");
                  if (details) details.open = false;
                }}
                title="Close"
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
                </svg>
              </button>
            </div>

            {report ? (
              <>
                <div className="grid gap-1 rounded border border-white/10 bg-black/20 p-3 text-xs">
                  <CompactFactRow label="Final outcome" value={battleOutcomeLabel(report.outcome)} />
                  <CompactFactRow label="Attacker losses" value={formatCompactResources(report.attackerLosses)} />
                  <CompactFactRow label="Defender losses" value={formatCompactResources(report.defenderLosses)} />
                </div>

                <section className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Inputs and technology owners</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {report.attackers.map((participant) => (
                      <BattleParticipantCard key={participant.id} participant={participant} />
                    ))}
                    <BattleParticipantCard participant={report.defender} showDefenses />
                    {report.defender.counterplay.map((participant) => (
                      <BattleParticipantCard key={participant.id} participant={participant} />
                    ))}
                  </div>
                </section>

                <section className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Combat rounds</h3>
                  {report.rounds.length === 0 ? (
                    <p className="rounded border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
                      Combat ended before round 1 because one side had no battlefield units.
                    </p>
                  ) : report.rounds.map((round) => (
                    <article className="grid gap-2 rounded border border-white/10 bg-white/[0.03] p-3" key={round.round}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white">Round {round.round}</h4>
                        <span className="text-xs tabular-nums text-slate-400">
                          {round.attackerStartingUnits.toLocaleString()} attackers / {round.defenderStartingUnits.toLocaleString()} defenders at start
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Rapidfire extra shots: {round.attackerRapidfireExtraShots.toLocaleString()} attacker / {round.defenderRapidfireExtraShots.toLocaleString()} defender
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <RoundSideReport title="Attackers" participants={round.attackers} />
                        <RoundSideReport
                          defenses={round.defender}
                          participants={[round.defender, ...round.defender.counterplay]}
                          title="Defenders"
                        />
                      </div>
                    </article>
                  ))}
                </section>
              </>
            ) : state.status === "error" ? (
              <div className="grid gap-3 rounded border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
                <p>{state.message}</p>
                <button
                  className="w-fit rounded border border-white/15 px-3 py-2 text-sm font-medium text-slate-100"
                  onClick={generateReport}
                  type="button"
                >
                  Retry
                </button>
              </div>
            ) : (
              <BattleReportSkeleton />
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function BattleParticipantCard({
  participant,
  showDefenses = false,
}: {
  participant: ContractBattleResult["attackers"][number] | ContractBattleResult["defender"];
  showDefenses?: boolean | undefined;
}) {
  const defenses = "startingDefenses" in participant ? participant.startingDefenses : [];
  return (
    <article className="rounded border border-white/10 bg-white/[0.03] p-2 text-xs">
      <p className="font-medium text-slate-200">{participant.label}</p>
      {participant.owner !== "Connected commander" ? (
        <p className="mt-0.5 break-all text-[11px] text-slate-500">{participant.owner}</p>
      ) : null}
      <p className="mt-1 text-slate-400">{formatTechLevels(participant.technology)}</p>
      <p className="mt-1 text-slate-300">
        <span className="font-medium text-slate-400">Fleet: </span>
        {formatBattleComposition(participant.startingShips)}
      </p>
      {showDefenses ? (
        <p className="mt-1 text-slate-300">
          <span className="font-medium text-slate-400">Defenses: </span>
          {formatBattleComposition(defenses)}
        </p>
      ) : null}
    </article>
  );
}

function BattleReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Generating simulated battle report" className="grid animate-pulse gap-4">
      <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
        <span className="h-3 w-24 rounded bg-white/10" />
        <span className="h-3 w-full rounded bg-white/[0.07]" />
        <span className="h-3 w-2/3 rounded bg-white/[0.07]" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <span className="h-24 rounded border border-white/10 bg-white/[0.04]" />
        <span className="h-24 rounded border border-white/10 bg-white/[0.04]" />
      </div>
      <span className="h-36 rounded border border-white/10 bg-white/[0.04]" />
    </div>
  );
}

function RoundSideReport({
  defenses,
  participants,
  title,
}: {
  defenses?: ContractBattleResult["defender"] | undefined;
  participants: ContractBattleResult["attackers"];
  title: string;
}) {
  const shipLosses = participants.flatMap((participant) =>
    participant.lostShips.map((row) => ({ ...row, label: `${participant.label}: ${row.label}` })),
  );
  return (
    <div className="rounded border border-white/10 bg-black/15 p-2 text-xs">
      <p className="font-medium text-slate-300">{title}</p>
      <p className="mt-1 text-slate-500">Losses</p>
      <p className="text-slate-300">
        {formatBattleComposition([
          ...shipLosses,
          ...(defenses?.lostDefenses.map((row) => ({ ...row, label: `Defense: ${row.label}` })) ?? []),
        ])}
      </p>
      <p className="mt-1 text-slate-500">Survivors</p>
      <p className="text-slate-300">
        {formatBattleComposition([
          ...participants.flatMap((participant) =>
            participant.survivingShips.map((row) => ({ ...row, label: `${participant.label}: ${row.label}` })),
          ),
          ...(defenses?.survivingDefenses.map((row) => ({ ...row, label: `Defense: ${row.label}` })) ?? []),
        ])}
      </p>
    </div>
  );
}

function formatBattleComposition(rows: Array<{ label: string; count: number }>): string {
  return rows.length > 0
    ? rows.map((row) => `${row.count.toLocaleString()} ${row.label}`).join(", ")
    : "None";
}

function battleOutcomeLabel(outcome: BattleOutcome): string {
  return outcome === "win" ? "Attacker win" : outcome === "defeat" ? "Defender win" : "Draw";
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
        <ResourceTableRow label="Loot at arrival" resources={resourceIntel.projectedArrivalLootable} />
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
      <span className="text-[11px] font-semibold uppercase text-slate-500">Defending forces</span>
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
        <ResourceSummary title="Lootable at arrival" resources={resourceIntel.projectedArrivalLootable} />
      </div>
    </div>
  );
}

export function MissionLootSection({
  availableCargo,
  availabilityDetail,
  greedyLootEnabled,
  lootIntelAvailable,
  lootRatio,
  lootRatioTotal,
  onAmountChange,
  onGreedyChange,
  onPercentChange,
  onResetEven,
  predictedLoot,
}: {
  availableCargo: number;
  availabilityDetail: string;
  greedyLootEnabled: boolean;
  lootIntelAvailable: boolean;
  lootRatio: MissionLootRatioDraft;
  lootRatioTotal: number;
  onAmountChange: (key: ResourceKey, value: number) => void;
  onGreedyChange: (enabled: boolean) => void;
  onPercentChange: (key: ResourceKey, value: number) => void;
  onResetEven: () => void;
  predictedLoot: MissionResourceSnapshot;
}) {
  return (
    <MissionFormSection title="Loot" eyebrow="Plunder">
      <AttackLootProjection
        availableCargo={availableCargo}
        predictedLoot={predictedLoot}
        unavailableDetail={lootIntelAvailable ? undefined : availabilityDetail}
      />
      <LootRatioControls
        cargoCapacity={availableCargo}
        greedyLootEnabled={greedyLootEnabled}
        lootRatio={lootRatio}
        lootRatioTotal={lootRatioTotal}
        onAmountChange={onAmountChange}
        onGreedyChange={onGreedyChange}
        onPercentChange={onPercentChange}
        onResetEven={onResetEven}
      />
    </MissionFormSection>
  );
}

export function AttackLootProjection({
  availableCargo,
  predictedLoot,
  unavailableDetail,
}: {
  availableCargo: number;
  predictedLoot: MissionResourceSnapshot;
  unavailableDetail?: string | undefined;
}) {
  return (
    <div className="grid min-w-0 max-w-full gap-2">
      <LootProjectionCard
        availableCargo={availableCargo}
        predictedLoot={predictedLoot}
        title="Loot at arrival"
      />
      {unavailableDetail ? (
        <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
          {unavailableDetail}
        </p>
      ) : null}
    </div>
  );
}

function LootProjectionCard({
  availableCargo,
  predictedLoot,
  title,
}: {
  availableCargo: number;
  predictedLoot: MissionResourceSnapshot;
  title: string;
}) {
  const predictedResources = [
    { key: "crystal", label: "Crystal", suffix: "C" },
    { key: "metal", label: "Metal", suffix: "M" },
    { key: "deuterium", label: "Deuterium", suffix: "D" },
  ] as const;
  return (
    <section className="grid min-w-0 max-w-full gap-2 rounded border border-white/10 bg-black/15 p-2">
      <h4 className="text-[11px] font-semibold uppercase text-slate-500">{title}</h4>
      <div className="grid min-w-0 gap-1 sm:grid-cols-3">
        {predictedResources.map(({ key, label, suffix }) => (
          <div
            className="flex min-w-0 items-baseline justify-between gap-2 rounded border border-white/[0.07] bg-black/15 px-2 py-1.5 sm:grid sm:gap-0"
            key={key}
          >
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
            <span
              className="min-w-0 break-all text-right text-sm font-semibold tabular-nums text-slate-200"
              title={`${formatResourceAmount(predictedLoot[key])} ${label.toLowerCase()} predicted at arrival`}
            >
              {formatResourceAmount(predictedLoot[key])} {suffix}
            </span>
          </div>
        ))}
      </div>
      <CompactFactRow
        label="Available cargo"
        value={`${formatResourceAmount(availableCargo)} after fuel`}
      />
    </section>
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
    <div className="grid min-w-0 max-w-full gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Loot ratio</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-slate-400 sm:min-h-0">
          Greedy
          <input
            checked={greedyLootEnabled}
            className="h-5 w-5 accent-signal [color-scheme:dark]"
            onChange={(event) => onGreedyChange((event.currentTarget as HTMLInputElement).checked)}
            type="checkbox"
          />
        </label>
      </div>
      {greedyLootEnabled ? (
        <p className="rounded border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-400">
          Greedy fills cargo from available loot automatically: metal first, then crystal, then deuterium.
        </p>
      ) : (
        <div className="grid gap-2">
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            {RESOURCE_KEYS.map((key) => (
              <PercentField
                key={key}
                label={`${resourceLabel(key)} %`}
                onChange={(value) => onPercentChange(key, value)}
                value={lootRatio[key]}
              />
            ))}
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
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
              className="min-h-11 rounded border border-white/10 bg-white/[0.03] px-3 py-2 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white sm:min-h-0 sm:px-2 sm:py-1"
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
    <div className="grid min-w-0 gap-0.5 text-[11px] min-[360px]:grid-cols-[8rem_minmax(0,1fr)] min-[360px]:items-baseline min-[360px]:gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-right tabular-nums text-slate-200">{value}</span>
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

export function missionTargetCompositionUnits(
  target: Planet | undefined,
  targetIsMoon = false,
): { fleet: UnitItem[]; defenses: UnitItem[] } {
  const bodyState = targetIsMoon ? target?.publicMoonState : target?.publicState;
  return {
    fleet: compositionUnits(bodyState?.fleet, shipCatalog, shipAssetByKey),
    defenses: compositionUnits(bodyState?.defenses, defenseCatalog, defenseAssetByKey),
  };
}

export function stationedDefenderCompositionUnits(
  defenders: readonly PublicStationedDefender[] | null | undefined,
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

function publicMoonResourceSnapshot(target: Planet | undefined): MissionResourceSnapshot | null {
  const moonResources = target?.publicMoonState?.resources;
  if (!moonResources) return null;
  return {
    metal: safeResourceNumber(moonResources.metal),
    crystal: safeResourceNumber(moonResources.crystal),
    deuterium: safeResourceNumber(moonResources.deuterium),
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
    return total + count * contractCombatPower("ship", option.id, techLevels);
  }, 0);
}

function shipRecordCombatPower(ships: Record<string, string>, techLevels: CombatTechLevels): number {
  const normalizedTechnology = normalizeCombatTechLevels(techLevels);
  return shipCatalog.reduce((total, ship) => {
    if (ship.id === 9 || ship.id === 15) return total;
    const count = safeResourceNumber(ships[ship.key]);
    return total + count * contractCombatPower("ship", ship.id, normalizedTechnology);
  }, 0);
}

function compositionCombatPower(
  rows: Array<{ id: number; count: number }> | undefined | null,
  kind: "ship" | "defense",
  techLevels: CombatTechLevels,
): number {
  return (rows ?? []).reduce((total, row) => {
    const count = Math.max(0, Math.trunc(row.count));
    // Planet-bound Solar Satellites and Crawlers are non-firing, but they are
    // still contract combat targets and must contribute to the attack preview
    // defender shape.
    if (kind === "ship" && (row.id < 0 || row.id >= 16)) return total;
    if (kind === "defense" && (row.id < 0 || row.id >= 8)) return total;
    return total + count * contractCombatPower(kind, row.id, techLevels);
  }, 0);
}

function stationedDefendersCombatPower(
  defenders: readonly PublicStationedDefender[] | null | undefined,
): number {
  return (defenders ?? []).reduce((total, defender) => {
    const techLevels = normalizeCombatTechLevels(defender.combatTechnology);
    return total + shipCatalog.reduce((shipTotal, ship) => {
      if (ship.id === 9 || ship.id === 15) return shipTotal;
      const count = safeResourceNumber(defender.ships[ship.key]);
      return shipTotal + count * contractCombatPower("ship", ship.id, techLevels);
    }, 0);
  }, 0);
}

function missionShipCounts(ships: MissionShips): number[] {
  const counts = Array.from({ length: 16 }, () => 0);
  for (const ship of shipCatalog) {
    counts[ship.id] = safeResourceNumber(ships[ship.key as MissionShipKey]);
  }
  return counts;
}

function combatCompositionCounts(
  rows: Array<{ id: number; count: number }> | null | undefined,
  length: number,
): number[] {
  const counts = Array.from({ length }, () => 0);
  for (const row of rows ?? []) {
    if (row.id < 0 || row.id >= length) continue;
    counts[row.id] = (counts[row.id] ?? 0) + safeResourceNumber(row.count);
  }
  return counts;
}

function combatShipRecordCounts(ships: Record<string, string>): number[] {
  const counts = Array.from({ length: 16 }, () => 0);
  for (const ship of shipCatalog) {
    counts[ship.id] = safeResourceNumber(ships[ship.key]);
  }
  return counts;
}

function battleForecastDetail(
  kind: BattleOutcome,
  simulation: ContractBattleForecastSummary,
  hasStationedDefenders: boolean,
  targetIsMoon: boolean,
): string {
  const outcomeKinds = (["win", "draw", "defeat"] as const).filter((outcome) => simulation.outcomeCounts[outcome] > 0);
  const varies = outcomeKinds.length > 1
    || !resourceSnapshotsEqual(simulation.attackerLosses.best, simulation.attackerLosses.worst);
  const targetLabel = targetIsMoon ? "moon" : "destination";
  const defenders = hasStationedDefenders ? " and visible owner-specific stationed fleets" : "";
  if (varies) {
    return `Estimated from current public ${targetLabel} intel${defenders}. Contract-equivalent 256-bit samples produce different outcomes or losses; the future oracle word is not known yet.`;
  }
  const result = kind === "win" ? "win" : kind === "defeat" ? "loss" : "draw";
  return `Estimated from current public ${targetLabel} intel${defenders}. All ${simulation.sampleCount} contract-equivalent samples produced the same ${result}, but this is not a guarantee because the future oracle word is unknown.`;
}

function resourceSnapshotsEqual(left: CombatResources, right: CombatResources): boolean {
  return left.metal === right.metal && left.crystal === right.crystal && left.deuterium === right.deuterium;
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

function formatLossRange(losses: BattleForecastLossRange | undefined): string {
  if (!losses) return "Unknown";
  if (resourceSnapshotsEqual(losses.best, losses.worst)) return formatCompactResources(losses.average);
  return `${formatCompactResources(losses.average)} avg`;
}

function formatLossRangeLong(losses: BattleForecastLossRange | undefined): string {
  if (!losses) return "Unknown";
  const average = `Metal ${formatResourceAmount(losses.average.metal)} · Crystal ${formatResourceAmount(losses.average.crystal)} · Deuterium ${formatResourceAmount(losses.average.deuterium)}`;
  return resourceSnapshotsEqual(losses.best, losses.worst) ? average : `${average} average`;
}

function lossRangeSpread(losses: BattleForecastLossRange | undefined): MissionResourceSnapshot | null {
  if (!losses) return null;
  return {
    metal: losses.worst.metal - losses.best.metal,
    crystal: losses.worst.crystal - losses.best.crystal,
    deuterium: losses.worst.deuterium - losses.best.deuterium,
  };
}

function formatSimulationOutcomes(randomness: BattleForecastRandomness): string {
  const outcomes = [
    ["win", "win", "wins"],
    ["draw", "draw", "draws"],
    ["defeat", "defeat", "defeats"],
  ] as const;
  const present = outcomes.filter(([kind]) => randomness.outcomeCounts[kind] > 0);
  if (present.length === 1) {
    const [, singular] = present[0]!;
    const outcome = `${singular[0]?.toUpperCase() ?? ""}${singular.slice(1)}`;
    return randomness.sampleCount === 1
      ? `${outcome} in 1 simulation`
      : `${outcome} in all ${randomness.sampleCount.toLocaleString()} simulations`;
  }
  return `${randomness.outcomeCounts.win.toLocaleString()} wins · ${randomness.outcomeCounts.draw.toLocaleString()} draws · ${randomness.outcomeCounts.defeat.toLocaleString()} defeats (${randomness.sampleCount.toLocaleString()} runs)`;
}

function formatAttackerSurvivors(randomness: BattleForecastRandomness): string {
  return randomness.attackerSurvivorRange.min === randomness.attackerSurvivorRange.max
    ? randomness.attackerSurvivorRange.min.toLocaleString()
    : `${randomness.attackerSurvivorRange.min.toLocaleString()}–${randomness.attackerSurvivorRange.max.toLocaleString()}`;
}

function formatTechLevelsLong(levels: CombatTechLevels): string {
  return `Weapons ${levels.weapons} · Shields ${levels.shielding} · Armor ${levels.armor}`;
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
  maxAction,
  onChange,
  value,
}: {
  label: string;
  max: number;
  maxAction?: {
    onSelect: () => void;
    value: number;
  } | undefined;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = `resource-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label className="text-xs text-slate-500" htmlFor={inputId}>{label}</label>
        {maxAction ? (
          <button
            aria-label={`Set ${label.toLowerCase()} cargo to maximum (${maxAction.value.toLocaleString()})`}
            className="rounded border border-signal/30 bg-signal/10 px-2 py-0.5 text-[11px] font-semibold text-signal transition hover:border-signal/50 hover:bg-signal/15 disabled:cursor-default disabled:opacity-45"
            disabled={resourceDraftNumber(value) === maxAction.value}
            onClick={maxAction.onSelect}
            type="button"
          >
            Max
          </button>
        ) : null}
      </div>
      <input
        className="h-11 min-w-0 w-full rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50 sm:h-9"
        id={inputId}
        inputMode="numeric"
        max={max}
        min={0}
        onInput={(event) => onChange(String(clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, max)))}
        placeholder="0"
        type="number"
        value={value}
      />
    </div>
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
    <label className="grid min-w-0 gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-11 min-w-0 w-full rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50 sm:h-9"
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
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max?: number | undefined;
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
        max={max}
        min={min}
        onInput={(event) => onChange(clampInteger(Number((event.currentTarget as HTMLInputElement).value), min, max ?? Number.MAX_SAFE_INTEGER))}
        type="number"
        value={value}
      />
    </label>
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
