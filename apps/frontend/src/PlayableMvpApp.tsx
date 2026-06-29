import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Coordinates, Planet, PlanetType } from "./types";
import {
  GalaxyView,
  rememberGalaxySystemPayload,
  type GalaxyActionState,
} from "./components/GalaxyView";
import { PlanetDetail } from "./components/PlanetDetail";
import { TopBar } from "./components/TopBar";
import { NavBar, type Page } from "./components/NavBar";
import {
  isOverviewResearchReadyToFinish,
  OverviewPage,
  type OverviewMyPlanetActionGroup,
  type PlanetRenameActionState,
} from "./components/OverviewPage";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { DefensePage } from "./components/DefensePage";
import { AlliancePage, allianceInviteAcceptanceState, allianceJoinRequestApprovalState, allianceJoinRequestDismissalState } from "./components/AlliancePage";
import { ResearchPage, type ResearchActionState } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import type { RequirementTarget } from "./components/RequirementFlairs";
import { RiftPage } from "./components/RiftPage";
import { MoonPage } from "./components/MoonPage";
import { PublicMoonDetail } from "./components/PublicMoonDetail";
import { MoonImage, PlanetMoonIndicator } from "./components/PlanetMoonIndicator";
import { MissionDetailPage } from "./components/MissionDetailPage";
import {
  MissionControlPage,
  missionPlanetCoordinateKey,
  missionSystemKeysMissingUniverseArchetypes,
  normalizeMissionNumberSearch,
} from "./components/MissionControlPage";
import { MissionCreationPage, type CombatTechLevels, type MissionCargoDraft, type MissionLaunchDraft } from "./components/MissionCreationPage";
import { BattleReportsPage } from "./components/BattleReportsPage";
import { RankingsPage } from "./components/RankingsPage";
import { RaidTargetFinderPage } from "./components/RaidTargetFinderPage";
import { AllianceInspectPage, PlayerInspectPage } from "./components/InspectPages";
import { AlertTriangle } from "lucide-preact";
import {
  buildInspectPath,
  canonicalEntityPathForLegacyHashLocation,
  hasUsefulPlanetDetailBackRoute,
  parseInspectRouteFromLocation,
  planetDetailBackRouteForCurrentScreen,
  type InspectRoute,
  type PlanetDetailBackRoute,
} from "./inspectRoutes";
import { resetDocumentTitle } from "./pageTitle";
import { ShareDialog } from "./components/ShareDialog";
import {
  buildingKeyForContractId,
  infrastructureActionNoticeFor,
  infrastructureDisplayActionNoticeFor,
  isStartedBuildingQueueSyncingLabel,
  isStartedBuildingQueueSynced,
  recoveredStartedBuildingAction,
  type BuildingActionState,
} from "./buildingActionNotice";
import { buildingUpgradeStatus, formatMissingResources } from "./buildingDetails";
import { serverUnavailableRetryMessage } from "./gameUnavailable";

export { infrastructureActionNoticeFor, infrastructureDisplayActionNoticeFor } from "./buildingActionNotice";
import {
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetImageForType,
  planetsFromSystemResponse,
  planetTypeFromTemperature,
} from "./data/mockUniverse";
import {
  buildingContractIds,
  canAfford,
  progress,
  researchCatalog,
  researchRequirementsFor,
  type BuildingKey,
  type DefenseKey,
  type EnergyBalance,
  type PlanetProductionProfile,
  type PlayableState,
  type ResearchKey,
  type ResearchRequirement,
  type Resources,
  type ShipKey,
} from "./playableMvp";
import { activeProductionQueue } from "./productionQueueFallback";
import { allianceContractAddress, burningChickenConfig, gameContractAddress, moonContractAddress, runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
import {
  activeBuildingQueueResponse,
  buildingQueueItemForDisplay,
  buildingCosts,
  buildingDurations,
  energyBalanceFromChain,
  infrastructurePlayableState,
  isBuildingQueueReadyToFinish,
  resourcesFromChain,
} from "./chainState";
import {
  isWalletPlanetHydrated,
  safeResourceNumber,
  usedFieldsFromBuildings,
  type ChainLoadStatus,
} from "./overviewData";
import {
  hasPlanetSectionData,
  planetSectionAccessForPlanet,
  planetSectionForPlanet,
  setPlanetSectionData,
  setPlanetSectionStatus,
  setPlanetSectionValue,
  type PlanetSectionStore,
} from "./planetSectionStore";
import {
  isTransientGameStateReadFailure,
  mergePendingMissionLaunches,
  missionLaunchMissionsForTransaction,
  pendingMissionLaunch,
  reconcilePendingMissionLaunches,
  removePendingMissionLaunchForTransaction,
  waitForFinishedResearchState,
  waitForStartedResearchState,
  waitForStartedDefenseProductionState,
  waitForStartedShipProductionState,
  waitForStartedBuildingState,
  startedBuildingQueueFromWalletPlanets,
  waitForFinishedBuildingState,
  waitForHydratedWalletPlanet,
  waitForAllianceApplicationCleared,
  waitForAllianceProfileState,
  waitForMissionLaunchState,
  waitForRenamedWalletPlanet,
  type AllianceApplicationExpectation,
  type FinishedResearchExpectation,
  type MissionLaunchSnapshot,
  type StartedBuildingExpectation,
  type StartedDefenseProductionExpectation,
  type StartedShipProductionExpectation,
  type StartedResearchExpectation,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingExpectation,
} from "./postTransactionRefresh";
import {
  emptyMissionShips,
  galaxyActionsForSlot,
  missionTypeId,
  type GalaxyAction,
  type MissionShipKey,
  type MissionShips,
} from "./galaxyActions";
import type { RaidTargetAttackAction } from "./components/RaidTargetFinderPage";
import type { DebrisFinderTarget, RaidTarget } from "./raidTargetFinder";
import {
  type FleetDriveLevels,
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionTravelSeconds,
} from "./fleetMissionRules";
import {
  fetchInfrastructureState,
  fetchMoonState,
  fetchDefenseState,
  fetchShipyardState,
  fetchResearchState,
  fetchRiftState,
  fetchWalletOverviewSnapshot,
  fetchWalletPlanets,
  fetchWatchedPlanets,
  fetchFleetMissionArchive,
  fetchFleetMissionVisibility,
  fetchGlobalActiveMissions,
  fetchGlobalMissionArchive,
  fetchMission,
  fetchBattleReports,
  fetchAllianceState,
  fetchAttackProtectionStatus,
  fetchBurningChickenForOwner,
  fetchPlayerProfile,
  mergePlayerProfile,
  walletRequestErrorMessage,
  spendTransactionErrorMessage,
  confirmTransactionReceipt,
  fetchWalletQueues,
  fetchWalletSettlement,
  parseRiftTokenAmount,
  unwatchPlanet,
  watchPlanet,
  sendApproveResourceTokenTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendAbandonPlanetTransaction,
  sendCreateColonyTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchAttackMissionTransaction,
  sendLaunchBodyFleetMissionTransaction,
  sendLaunchDefenseHoldTransaction,
  sendLaunchFleetMissionTransaction,
  sendJoinAttackMissionTransaction,
  encodeColonizationTargetId,
  sendJumpGateJumpTransaction,
  sendRecallFleetMissionTransaction,
  sendDepositResourceTransaction,
  sendRenamePlanetTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendFinishMoonBuildingUpgradeTransaction,
  sendFinishMoonDefenseProductionTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartMoonBuildingUpgradeTransaction,
  sendStartMoonDefenseProductionTransaction,
  sendStartDefenseProductionTransaction,
  sendAcceptAllianceInviteTransaction,
  sendAllianceBatchKickTransaction,
  sendAllianceBatchRoleTransaction,
  sendAllianceJoinRequestTransaction,
  sendAllianceKickTransaction,
  sendAllianceLeaveTransaction,
  sendAllianceInviteTransaction,
  sendAllianceProfileTransaction,
  sendAllianceRoleTransaction,
  sendAllianceDiplomacyTransaction,
  sendAllianceTransferOwnershipTransaction,
  sendApproveAllianceJoinRequestTransaction,
  sendCancelAllianceJoinRequestTransaction,
  sendDismissAllianceJoinRequestTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  sendCreateAllianceTransaction,
  sendBurningChickenMoonTransaction,
  ensureBaseSepoliaNetwork,
  isOnChainRevertError,
  isUserRejected,
  updatePlayerProfile,
  type ChainDefenseState,
  type ChainAllianceState,
  type ChainInfrastructureState,
  type ChainMoonState,
  type ChainResearchState,
  type ChainRiftState,
  type ChainShipyardState,
  type AttackProtectionStatus,
  type BattleReport,
  type Eip1193Provider,
  type FleetMissionVisibilityResponse,
  type FleetMissionArchiveResponse,
  type FleetMissionPlanetReference,
  type FleetMissionSummary,
  type GlobalMissionArchiveResponse,
  type MissionDetailResponse,
  type OnChainResources,
  type OrbitBodyKind,
  type PendingWithdrawal,
  type ManagedPlanetResponse,
  type PlanetSummary,
  type PlayerProfile,
  type RiftResourceState,
  type PlayerQueuesResponse,
  type QueueStateResponse,
  type WalletPlanetsResponse,
  type WatchedPlanetsResponse,
  type WalletSettlementResponse,
} from "./walletFlow";
import { nextWatchedPlanetsPageAfterToggle } from "./watchedPlanetsView";
import {
  createTransactionActionGate,
  transactionAwaitingWalletLabel,
  transactionConfirmingLabel,
  transactionSyncingLabel,
} from "./transactionActionGate";
import { timestampToMs } from "./timestampFormat";
import {
  scheduleActionNoticeAutoDismiss,
  type ActionStateSetter,
  type AutoDismissableActionState,
} from "./actionNoticeAutoDismiss";

const maxChickenBurnMoonsPerPlayer = 2;

export function researchStartTransactionLabel(
  technologyId: number,
  key: ResearchKey,
  researchState: ChainResearchState | null,
): string {
  const catalogEntry = researchCatalog.find((research) => research.id === technologyId || research.key === key);
  const label = catalogEntry?.label ?? "Research";
  const currentLevel = researchState?.technologies.find((technology) => technology.id === technologyId)?.level
    ?? researchState?.technologyLevels[technologyId.toString()]
    ?? 0;

  return `${label} level ${currentLevel + 1} research`;
}

export function researchStartPlanetIdFor({
  activePlanetId,
  researchState,
}: {
  activePlanetId: string | undefined;
  researchState: Pick<ChainResearchState, "homePlanetId" | "planetId"> | null;
}): string | undefined {
  return researchState?.planetId ?? activePlanetId ?? researchState?.homePlanetId ?? undefined;
}

export function walletSpendableResourcesFor({
  isWalletConnected,
  onChainResources,
}: {
  isWalletConnected: boolean;
  onChainResources: PlayableState["resources"] | undefined;
}): PlayableState["resources"] | undefined {
  return isWalletConnected ? onChainResources : undefined;
}

// VEY-KANEO-453: the mission fuel/cargo gates must read the same canonical spendable
// balance the top bar and every other affordability gate already use. When a wallet is
// connected, the polled on-chain `spendableResources` is authoritative; the backend
// wallet-planet snapshot can lag well behind it and falsely block Confirm with messages
// like "Need 138 deuterium for fuel" while the player actually holds thousands. We only
// fall back to the backend snapshot (string-valued, validated through `safeResourceNumber`)
// when no wallet-connected spendable balance is available.
export function missionOriginResources({
  isWalletConnected,
  spendableResources,
  planetResources,
}: {
  isWalletConnected: boolean;
  spendableResources: PlayableState["resources"] | undefined;
  planetResources: OnChainResources | undefined;
}): PlayableState["resources"] | undefined {
  if (isWalletConnected && spendableResources) {
    return {
      metal: Math.max(0, Math.trunc(spendableResources.metal)),
      crystal: Math.max(0, Math.trunc(spendableResources.crystal)),
      deuterium: Math.max(0, Math.trunc(spendableResources.deuterium)),
    };
  }
  if (!planetResources) return undefined;
  return {
    metal: safeResourceNumber(planetResources.metal) ?? 0,
    crystal: safeResourceNumber(planetResources.crystal) ?? 0,
    deuterium: safeResourceNumber(planetResources.deuterium) ?? 0,
  };
}

function missionMoonResources(moonState: ChainMoonState | null | undefined): PlayableState["resources"] | undefined {
  if (!moonState?.moon?.exists) return undefined;
  const resources = moonState.resources;
  return {
    metal: safeResourceNumber(resources?.metal) ?? 0,
    crystal: safeResourceNumber(resources?.crystal) ?? 0,
    deuterium: safeResourceNumber(resources?.deuterium) ?? 0,
  };
}

function missionMoonShipyardState({
  moonState,
  shipyardState,
}: {
  moonState: ChainMoonState | null | undefined;
  shipyardState: ChainShipyardState | null;
}): ChainShipyardState | null {
  if (!moonState?.moon?.exists) return null;
  const stale = moonState.stale ?? shipyardState?.stale;
  return {
    wallet: moonState.wallet,
    homePlanetId: moonState.homePlanetId,
    planetId: moonState.moon.planetId,
    productionAvailable: true,
    resources: moonState.resources ?? { metal: "0", crystal: "0", deuterium: "0" },
    ...(shipyardState?.fleetSlots ? { fleetSlots: shipyardState.fleetSlots } : {}),
    ...(shipyardState?.fleetLaunchAvailable !== undefined ? { fleetLaunchAvailable: shipyardState.fleetLaunchAvailable } : {}),
    ...(shipyardState?.fleetLaunchUnavailableReason ? { fleetLaunchUnavailableReason: shipyardState.fleetLaunchUnavailableReason } : {}),
    ...(shipyardState?.unavailableReason ? { unavailableReason: shipyardState.unavailableReason } : {}),
    ...(stale !== undefined ? { stale } : {}),
    shipyardLevel: 0,
    naniteLevel: 0,
    technologyLevels: shipyardState?.technologyLevels ?? {},
    ships: moonState.fleet ?? [],
    queue: null,
  };
}

const buildingFinishStateReadFailureLabel =
  "Can't check game state right now. Your upgrade is still ready, but Veydrift could not verify the contract state. Retry in a moment.";
const buildingFinishLiveStateRequiredLabel =
  "Can't verify the current building queue right now. Refresh infrastructure state and retry before finishing.";
const buildingFinishSubmittedSyncLabel =
  "Building completion submitted. Waiting for backend state to clear this completed queue before another finish attempt.";
const buildingFinishFailedSyncLabel =
  "Building completion failed for this ready queue. Refreshing backend state before another finish attempt.";
const buildingFinishRejectedLabel =
  "Building completion was cancelled in the wallet. The ready queue is still available; retry when you are ready to confirm the game-state update.";
const buildingFinishClientClockSafetyMs = 30_000;
export const infrastructureBackendSyncPausedLabel =
  `${serverUnavailableRetryMessage()} Building actions are paused until current game state is available.`;
export const infrastructureMissionResolutionPendingLabel =
  "Mission resolution is pending for this planet. Refresh after the battle keeper or indexer settles the due mission before starting another upgrade.";
const buildingWalletConfirmationLabel = (label: string) =>
  label === "Building completion"
    ? "Building completion: confirm the game-state update in your wallet; token balance changes are not expected."
    : `${label}: unlock your wallet if needed, then confirm in your wallet.`;
const TOP_BAR_RESOURCE_POLL_INTERVAL_MS = 30_000;
export const MISSION_REPORT_PENDING_POLL_INTERVAL_MS = 3_000;
const CHAIN_EVENT_REFRESH_DEBOUNCE_MS = 3_000;
const BUILDING_COMPLETION_AUTO_REFRESH_BUFFER_MS = 1_500;
// VEY-KANEO-433: after an active mission's ETA passes, wait a short beat before the tightened Mission
// Control refresh so the backend indexer has settled the arrival/resolution before we re-read it.
const MISSION_RESOLUTION_REFRESH_BUFFER_MS = 1_500;
// VEY-KANEO-539: production queues need the same tightened post-ETA read so visible construction
// state reconciles at completion time instead of waiting for the next broad poll or a manual reload.
const PRODUCTION_QUEUE_COMPLETION_REFRESH_BUFFER_MS = 1_500;
export const previousMissionIndexingBlockerLabel = "Waiting for previous mission to index.";
export const previousMissionTransactionBlockerLabel = "Waiting for previous mission transaction.";
const CHICKEN_MOON_CONFIRM_TIMEOUT_MS = 120_000;
const CHICKEN_MOON_CONFIRM_POLL_MS = 3_000;

type RefreshFreshnessGate = { current: number };
export type ResourceSnapshotFreshness = {
  planetId: string | null;
  lastSettledAt: string | null;
  resourcesKey?: string | null;
};
type ChainResourceShape = { metal: string; crystal: string; deuterium: string };

export type OnChainRefreshPlan = {
  applyQueues: boolean;
  applyResourceState: boolean;
};

function raidTargetFullResources(target: RaidTarget): { metal: string; crystal: string; deuterium: string } | null {
  return target.currentResources;
}

function combatTechLevelForKey(
  key: "5" | "6" | "7",
  primaryLevels: Record<string, number> | undefined,
  fallbackLevels: Record<string, number> | undefined,
): number {
  return safeResourceNumber(primaryLevels?.[key]) ?? safeResourceNumber(fallbackLevels?.[key]) ?? 0;
}

const ASTROPHYSICS_TECHNOLOGY_ID = "12";

export function colonizationLimitBlocker({
  planetCount,
  researchTechnologyLevels,
  shipyardTechnologyLevels,
}: {
  planetCount: number;
  researchTechnologyLevels?: Record<string, number> | undefined;
  shipyardTechnologyLevels?: Record<string, number> | undefined;
}): string | undefined {
  const astrophysicsLevel =
    safeResourceNumber(researchTechnologyLevels?.[ASTROPHYSICS_TECHNOLOGY_ID])
      ?? safeResourceNumber(shipyardTechnologyLevels?.[ASTROPHYSICS_TECHNOLOGY_ID])
      ?? 0;
  const limit = 1 + Math.max(0, Math.trunc(astrophysicsLevel));
  if (planetCount < limit) return undefined;
  return `Your colony limit is ${planetCount}/${limit}. Research Astrophysics before colonizing another planet.`;
}

export function attackerCombatTechLevelsForMission({
  researchTechnologyLevels,
  shipyardTechnologyLevels,
}: {
  researchTechnologyLevels?: Record<string, number> | undefined;
  shipyardTechnologyLevels?: Record<string, number> | undefined;
}): CombatTechLevels {
  return {
    weapons: combatTechLevelForKey("5", researchTechnologyLevels, shipyardTechnologyLevels),
    shielding: combatTechLevelForKey("6", researchTechnologyLevels, shipyardTechnologyLevels),
    armor: combatTechLevelForKey("7", researchTechnologyLevels, shipyardTechnologyLevels),
  };
}

function raidTargetResearchRowsForMission(target: RaidTarget): Array<{ id: number; level: number }> | null {
  const levels = target.combatTechLevels;
  if (!levels) return null;
  return [
    { id: 5, level: safeResourceNumber(levels.weapons) ?? 0 },
    { id: 6, level: safeResourceNumber(levels.shielding) ?? 0 },
    { id: 7, level: safeResourceNumber(levels.armor) ?? 0 },
  ];
}

export function raidTargetPlanetForMission(target: RaidTarget): Planet {
  const resources = raidTargetFullResources(target);
  const research = raidTargetResearchRowsForMission(target);
  const hasPublicIntel = Boolean(
    resources
      || target.shipUnits.length > 0
      || target.defenseUnits.length > 0
      || target.combatPower > 0
      || target.loot > 0
      || research
  );

  return {
    id: target.planetId,
    name: target.name?.trim() || `Planet ${target.planetId}`,
    type: target.archetype,
    image: planetImageForType(target.archetype),
    position: target.coordinates.position,
    galaxy: target.coordinates.galaxy,
    system: target.coordinates.system,
    owner: target.owner,
    ownerId: target.owner,
    alliance: target.alliance,
    occupiedBy: {
      planetId: target.planetId,
      owner: target.owner,
      ownerDisplayName: target.ownerDisplayName,
      alliance: target.alliance,
    },
    debrisField: null,
    moonChance: null,
    publicState: hasPublicIntel
      ? {
          resources,
          buildings: null,
          fleet: target.shipUnits.map((unit) => ({ id: unit.id, count: unit.count })),
          defenses: target.defenseUnits.map((unit) => ({ id: unit.id, count: unit.count })),
          stationedDefenders: null,
          research,
          productionPerHour: target.productionPerHour,
          storageCaps: target.storageCaps,
          queues: null,
        }
      : null,
    resources: resources
      ? {
          metal: safeResourceNumber(resources.metal) ?? 0,
          crystal: safeResourceNumber(resources.crystal) ?? 0,
          deuterium: safeResourceNumber(resources.deuterium) ?? 0,
          energy: 0,
        }
      : { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
    temperature: { min: 0, max: 0 },
    diameter: 0,
    fields: 0,
    hasMoon: target.hasMoon,
    publicMoonState: target.moonResources
      ? { resources: target.moonResources }
      : null,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
  };
}

export function debrisTargetPlanetForMission(target: DebrisFinderTarget): Planet {
  return {
    id: target.planetId,
    name: target.name?.trim() || `Planet ${target.planetId}`,
    type: target.archetype,
    image: planetImageForType(target.archetype),
    position: target.coordinates.position,
    galaxy: target.coordinates.galaxy,
    system: target.coordinates.system,
    owner: target.owner,
    ownerId: target.owner,
    alliance: null,
    occupiedBy: {
      planetId: target.planetId,
      owner: target.owner,
      ownerDisplayName: null,
      alliance: null,
    },
    debrisField: {
      metal: target.metal,
      crystal: target.crystal,
    },
    moonChance: null,
    publicState: null,
    resources: { metal: 0, crystal: 0, deuterium: 0, energy: 0 },
    temperature: { min: 0, max: 0 },
    diameter: 0,
    fields: 0,
    hasMoon: target.hasMoon,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
  };
}

export function beginRefreshRequest(gate: RefreshFreshnessGate): number {
  gate.current += 1;
  return gate.current;
}

export function markFreshStateWrite(gate: RefreshFreshnessGate): number {
  gate.current += 1;
  return gate.current;
}

export function canApplyRefreshRequest(gate: RefreshFreshnessGate, requestId: number): boolean {
  return requestId === gate.current;
}

export function resourceSnapshotFreshnessForSettlement(
  settlement: WalletSettlementResponse | undefined,
): ResourceSnapshotFreshness {
  const resources = settlement?.planet?.resourcesAsOfNow ?? settlement?.planet?.resources;
  return {
    planetId: settlement?.planet?.planetId ?? settlement?.homePlanetId ?? null,
    lastSettledAt: settlement?.planet?.lastSettledAt ?? null,
    resourcesKey: resourceSnapshotKey(resources),
  };
}

export function resourceSnapshotFreshnessForInfrastructure(
  infrastructure: ChainInfrastructureState | null,
): ResourceSnapshotFreshness {
  const resources = infrastructure?.resourcesAsOfNow ?? infrastructure?.resources;
  return {
    planetId: infrastructure?.planetId ?? infrastructure?.homePlanetId ?? null,
    lastSettledAt: infrastructure?.planetLastSettledAt ?? null,
    resourcesKey: resourceSnapshotKey(resources),
  };
}

export function walletSettlementForManagedPlanet(
  current: WalletSettlementResponse | undefined,
  planet: ManagedPlanetResponse | undefined,
): WalletSettlementResponse | undefined {
  if (!current || !planet) return current;
  return {
    ...current,
    hasFirstPlanet: true,
    homePlanetId: planet.planetId,
    planet,
  };
}

export function walletQueuesForManagedPlanet(
  current: PlayerQueuesResponse | undefined,
  planet: ManagedPlanetResponse | undefined,
): PlayerQueuesResponse | undefined {
  if (!current || !planet) return current;
  return {
    ...current,
    homePlanetId: planet.planetId,
    building: planet.queues.building,
    defense: planet.queues.defense,
    ship: planet.queues.ship,
  };
}

export function selectedPlanetIdFromRoster({
  homePlanetId,
  planets,
  selectedPlanetId,
}: {
  homePlanetId: string | null | undefined;
  planets: readonly Pick<ManagedPlanetResponse, "isHomePlanet" | "planetId">[] | undefined;
  selectedPlanetId: string | undefined;
}): string | undefined {
  if (selectedPlanetId && planets?.some((planet) => planet.planetId === selectedPlanetId)) {
    return selectedPlanetId;
  }

  if (homePlanetId && planets?.some((planet) => planet.planetId === homePlanetId)) {
    return homePlanetId;
  }

  return planets?.find((planet) => planet.isHomePlanet)?.planetId ?? planets?.[0]?.planetId;
}

export function selectedPlanetIdForWalletRead({
  activePlanetId,
  homePlanetId,
  walletPlanets,
}: {
  activePlanetId: string | undefined;
  homePlanetId: string | null | undefined;
  walletPlanets: readonly Pick<ManagedPlanetResponse, "isHomePlanet" | "planetId">[];
}): string | undefined {
  return selectedPlanetIdFromRoster({
    homePlanetId,
    planets: walletPlanets,
    selectedPlanetId: activePlanetId,
  });
}

export function resolvedOrbitBodyKind(
  selectedBodyKind: OrbitBodyKind,
  selectedPlanet: Pick<ManagedPlanetResponse, "moon"> | undefined,
): OrbitBodyKind {
  return selectedBodyKind === "moon" && selectedPlanet?.moon?.exists ? "moon" : "planet";
}

export function gameActionsAvailableForBody(activeBodyKind: OrbitBodyKind, inputsAvailable: boolean): boolean {
  return activeBodyKind === "planet" && inputsAvailable;
}

export function walletCurrentResourcesForActiveBody({
  activeBodyKind,
  infrastructureResources,
  infrastructureResourcesAsOfNow,
  moonResources,
  moonResourcesAsOfNow,
  planetResources,
}: {
  activeBodyKind: OrbitBodyKind;
  infrastructureResources?: OnChainResources | null | undefined;
  infrastructureResourcesAsOfNow?: OnChainResources | null | undefined;
  moonResources?: OnChainResources | null | undefined;
  moonResourcesAsOfNow?: OnChainResources | null | undefined;
  planetResources?: OnChainResources | null | undefined;
}): Resources | undefined {
  if (activeBodyKind === "moon") {
    return walletCurrentResourcesFor({
      settlementResources: moonResourcesAsOfNow ?? moonResources,
    });
  }
  return walletCurrentResourcesFor({
    settlementResources: planetResources,
    infrastructureResourcesAsOfNow,
    infrastructureResources,
  });
}

export function shouldApplyResourceSnapshot(
  current: ResourceSnapshotFreshness,
  next: ResourceSnapshotFreshness,
): boolean {
  if (current.planetId && next.planetId && current.planetId !== next.planetId) {
    return true;
  }

  const currentSettledAt = resourceSnapshotSettledAt(current);
  const nextSettledAt = resourceSnapshotSettledAt(next);
  if (currentSettledAt === undefined || nextSettledAt === undefined) {
    return true;
  }

  if (nextSettledAt > currentSettledAt) return true;
  if (nextSettledAt < currentSettledAt) return false;
  if (next.resourcesKey && current.resourcesKey && next.resourcesKey !== current.resourcesKey) return true;
  return true;
}

export function recordedResourceSnapshotFreshness(
  current: ResourceSnapshotFreshness,
  next: ResourceSnapshotFreshness,
): ResourceSnapshotFreshness {
  if (current.planetId === next.planetId && !next.lastSettledAt) {
    return current;
  }

  return next;
}

export function infrastructureStateForRefreshApplication({
  applyResourceState,
  current,
  next,
}: {
  applyResourceState: boolean;
  current: ChainInfrastructureState | null;
  next: ChainInfrastructureState;
}): ChainInfrastructureState {
  if (applyResourceState || !current) return next;
  return {
    ...next,
    ...(current.planetLastSettledAt === undefined
      ? {}
      : { planetLastSettledAt: current.planetLastSettledAt }),
    resources: current.resources,
    ...(current.resourcesAsOfNow === undefined ? {} : { resourcesAsOfNow: current.resourcesAsOfNow }),
  };
}

export function buildingCompletionAutoRefreshDelayMs(
  queue: QueueStateResponse | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!queue?.active) return undefined;
  const readyAt = timestampToMs(queue.readyAt);
  if (readyAt === undefined) return undefined;
  return Math.max(0, readyAt + BUILDING_COMPLETION_AUTO_REFRESH_BUFFER_MS - now);
}

export function walletCurrentResourcesFor({
  infrastructureResources,
  infrastructureResourcesAsOfNow,
  settlementResources,
}: {
  infrastructureResources?: ChainResourceShape | null | undefined;
  infrastructureResourcesAsOfNow?: ChainResourceShape | null | undefined;
  settlementResources?: ChainResourceShape | null | undefined;
}): Resources | undefined {
  return (
    resourcesFromChain(settlementResources ?? null)
    ?? resourcesFromChain(infrastructureResourcesAsOfNow ?? null)
    ?? resourcesFromChain(infrastructureResources ?? null)
  );
}

// Successful backend reads are authoritative. The request-ordering gate still
// guards against out-of-order responses upstream.
export function planOnChainRefresh(
  current: ResourceSnapshotFreshness,
  next: ResourceSnapshotFreshness,
  options: { force?: boolean } = {},
): OnChainRefreshPlan {
  void current;
  void next;
  void options;
  return {
    applyQueues: true,
    applyResourceState: true,
  };
}

export function shouldRefreshAllianceStateForPage(page: Page): boolean {
  return page === "alliance" || page === "rankings" || page === "raid-target-finder" || page === "alliance-inspect";
}

export function shouldRefreshMissionActionStateForPage(page: Page): boolean {
  return page === "overview" || page === "galaxy" || page === "planet" || page === "mission-control" || page === "raid-target-finder";
}

export function shouldClearCachedShipyardStateForPageRefresh(page: Page): boolean {
  return page === "shipyard" || shouldRefreshMissionActionStateForPage(page);
}

// VEY-KANEO-433: Mission Control auto-polls its own data (active missions, the past-mission archives,
// and battle reports/loot) while the player is viewing it, so a mission resolving at its destination —
// and the resulting status flip, loot, and battle report — appears within a poll cycle instead of only
// after a manual Refresh.
export function shouldAutoPollMissionControlForPage(page: Page): boolean {
  return page === "mission-control";
}

export function shouldPollPendingMissionReport(
  detail: MissionDetailResponse | undefined,
  now = Date.now(),
): boolean {
  if (!detail || detail.battleReport) return false;
  if (!["Attack", "AcsAttack", "Intercept", "MissileAttack"].includes(detail.mission.missionType)) return false;
  if (detail.battleReportMaterialization?.status === "ready") return false;
  if (detail.mission.status === "Recalled") return false;
  if (detail.mission.status === "Returned" && detail.mission.recallCost !== null && detail.mission.returnCargo === null) return false;
  if (detail.mission.status === "Outbound" && Number(detail.mission.arrivalAt) * 1_000 > now) return false;
  return true;
}

// VEY-KANEO-433: the soonest still-pending resolution moment across the player's active missions — an
// Outbound fleet's arrival, or a Returning/Recalled fleet's landing. Used to fire a tightened refresh
// just after that instant so the resolution shows promptly rather than waiting up to a full poll
// interval. Only future events are considered (a moment already in the past is handled by the regular
// poll), so this never busy-loops on a due-but-unresolved mission. Returns undefined when nothing is
// pending.
export function nextMissionResolutionEventMs(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
  now: number,
): number | undefined {
  if (!fleetVisibility) {
    return undefined;
  }
  let soonest: number | undefined;
  const consider = (value: string | undefined) => {
    const ms = value ? timestampToMs(value) : undefined;
    if (ms === undefined || ms <= now) {
      return;
    }
    soonest = soonest === undefined ? ms : Math.min(soonest, ms);
  };
  for (const mission of [...fleetVisibility.incoming, ...fleetVisibility.outgoing, ...fleetVisibility.joinableAttacks]) {
    if (mission.status === "Outbound") {
      consider(mission.arrivalAt);
    }
  }
  for (const mission of fleetVisibility.returning) {
    if (mission.status === "Returning" || mission.status === "Recalled") {
      consider(mission.returnAt);
    }
  }
  return soonest;
}

export function nextProductionQueueCompletionEventMs(
  queues: ReadonlyArray<QueueStateResponse | null | undefined>,
  now: number,
): number | undefined {
  let soonest: number | undefined;
  for (const queue of queues) {
    if (!queue?.active) continue;
    const readyAt = timestampToMs(queue.readyAt);
    if (readyAt === undefined || readyAt <= now) continue;
    soonest = soonest === undefined ? readyAt : Math.min(soonest, readyAt);
  }
  return soonest;
}

export function planetScopedFleetVisibility(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
  planetId: string | undefined,
): FleetMissionVisibilityResponse | undefined {
  if (!fleetVisibility || !planetId) return fleetVisibility;
  return {
    ...fleetVisibility,
    incoming: fleetVisibility.incoming.filter((mission) => mission.targetPlanetId === planetId),
    outgoing: fleetVisibility.outgoing.filter((mission) => mission.originPlanetId === planetId),
    returning: fleetVisibility.returning.filter((mission) => mission.originPlanetId === planetId),
  };
}

export function planetHasIncomingAttack(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
  planetId: string,
): boolean {
  const wallet = fleetVisibility?.wallet.trim().toLowerCase();
  return Boolean(fleetVisibility?.incoming.some((mission) =>
    mission.missionType === "Attack" && mission.targetPlanetId === planetId
    && (!wallet || mission.owner.trim().toLowerCase() !== wallet)
  ));
}

export function shipyardStateForMissionActions({
  account,
  activePlanetId,
  homePlanetId,
  shipyardError,
  shipyardLoading,
  shipyardState,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  homePlanetId: string | null | undefined;
  shipyardError: string | undefined;
  shipyardLoading: boolean;
  shipyardState: ChainShipyardState | null;
}): ChainShipyardState | null {
  if (shipyardState) return shipyardState;
  if (!account || !shipyardError || shipyardLoading) return null;

  return {
    wallet: account,
    homePlanetId: homePlanetId ?? null,
    planetId: activePlanetId ?? homePlanetId ?? null,
    productionAvailable: false,
    unavailableReason: `Shipyard state could not be loaded: ${shipyardError}. Refresh and retry.`,
    resources: null,
    shipyardLevel: 0,
    naniteLevel: 0,
    technologyLevels: {},
    ships: [],
    queue: null,
  };
}

export function missionLaunchSubmitBlocker({
  actionState,
  pendingMissionLaunchCount,
}: {
  actionState: Pick<GalaxyActionState, "status">;
  pendingMissionLaunchCount: number;
}): string | undefined {
  if (pendingMissionLaunchCount > 0) return previousMissionIndexingBlockerLabel;
  if (actionState.status === "pending") return previousMissionTransactionBlockerLabel;
  return undefined;
}

export function shipyardStateWithMissionLaunchBlocker({
  account,
  activePlanetId,
  blocker,
  homePlanetId,
  shipyardState,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  blocker: string | undefined;
  homePlanetId: string | null | undefined;
  shipyardState: ChainShipyardState | null;
}): ChainShipyardState | null {
  if (!blocker) return shipyardState;
  return {
    ...(shipyardState ?? {
      wallet: account ?? "",
      homePlanetId: homePlanetId ?? null,
      planetId: activePlanetId ?? homePlanetId ?? null,
      resources: null,
      shipyardLevel: 0,
      naniteLevel: 0,
      technologyLevels: {},
      ships: [],
      queue: null,
    }),
    fleetLaunchAvailable: false,
    fleetLaunchUnavailableReason: blocker,
  };
}

const missionShipInventoryRows: Array<{ key: MissionShipKey; id: number; label: string }> = [
  { key: "smallCargo", id: 0, label: "Small Cargo" },
  { key: "lightFighter", id: 1, label: "Light Fighter" },
  { key: "recycler", id: 2, label: "Recycler" },
  { key: "colonyShip", id: 3, label: "Colony Ship" },
  { key: "largeCargo", id: 4, label: "Large Cargo" },
  { key: "heavyFighter", id: 5, label: "Heavy Fighter" },
  { key: "cruiser", id: 6, label: "Cruiser" },
  { key: "battleship", id: 7, label: "Battleship" },
  { key: "bomber", id: 8, label: "Bomber" },
  { key: "destroyer", id: 10, label: "Destroyer" },
  { key: "deathstar", id: 11, label: "Dreadstar" },
  { key: "battlecruiser", id: 12, label: "Battlecruiser" },
  { key: "reaper", id: 13, label: "Reaper" },
  { key: "pathfinder", id: 14, label: "Pathfinder" },
];

export function missionShipInventoryBlocker({
  shipyardState,
  ships,
}: {
  shipyardState: Pick<ChainShipyardState, "fleetLaunchAvailable" | "fleetLaunchUnavailableReason" | "fleetSlots" | "ships" | "unavailableReason"> | null | undefined;
  ships: Partial<MissionShips>;
}): string | undefined {
  if (!shipyardState) return "Shipyard state is still loading.";
  if (shipyardState.fleetLaunchAvailable === false) {
    return shipyardState.fleetLaunchUnavailableReason ?? shipyardState.unavailableReason ?? "Fleet slot state is still syncing.";
  }
  if (!shipyardState.fleetSlots || shipyardState.fleetSlots.limit <= 0) {
    return "Fleet slot state is still loading — wait for Computer Technology limits to sync before launching.";
  }
  if (shipyardState.fleetSlots.active >= shipyardState.fleetSlots.limit) {
    return `Fleet slots full (${shipyardState.fleetSlots.active}/${shipyardState.fleetSlots.limit}) — research Computer Technology to raise the limit, or wait for a fleet to return.`;
  }

  const overSelected = missionShipInventoryRows
    .map((ship) => {
      const selected = Math.max(0, Math.trunc(ships[ship.key] ?? 0));
      if (selected <= 0) return null;
      const available = shipyardState.ships.find((item) => item.id === ship.id)?.count ?? 0;
      return selected > available
        ? `Need ${selected.toLocaleString()} ${ship.label}, only ${available.toLocaleString()} available`
        : null;
    })
    .filter((row): row is string => Boolean(row));

  if (overSelected.length <= 0) return undefined;
  return `${overSelected.join(", ")} on the origin planet; refresh fleet state or reduce selected ships before launching.`;
}

function resourceSnapshotSettledAt(snapshot: ResourceSnapshotFreshness): bigint | undefined {
  if (!snapshot.lastSettledAt) return undefined;
  try {
    return BigInt(snapshot.lastSettledAt);
  } catch {
    return undefined;
  }
}

function resourceSnapshotKey(
  resources: ChainResourceShape | null | undefined,
): string | null {
  if (!resources) return null;
  return `${resources.metal}:${resources.crystal}:${resources.deuterium}`;
}

export function galaxyMissionActionErrorLabel(label: string, error: unknown): string {
  const message = errorLabelMessage(error);
  const normalizedMessage = message.toLowerCase();
  const code = errorLabelCode(error);

  if (/wallet is locked|metamask is locked|unlock metamask|unlock your wallet/i.test(message)) {
    return `${label} could not read wallet state. Unlock your wallet, then retry.`;
  }

  if (/timed out reading .* from the wallet/i.test(message)) {
    return `${label} could not read wallet state. Unlock or reconnect your wallet, then retry.`;
  }

  if (/timed out reading .* from the game api/i.test(message)) {
    return serverUnavailableRetryMessage();
  }

  // A genuine on-chain revert is often wrapped in an internal JSON-RPC error
  // (code -32603) whose nested data carries the revert. Classify it as a
  // mission rejection before the RPC-unavailable branch so a real revert is not
  // mislabeled as transient RPC/node unavailability.
  if (isOnChainRevertError(error) || /execution reverted/i.test(message)) {
    return `${label} was rejected by mission preflight. Refresh fleet, cargo, fuel, and target state before retrying.`;
  }

  if (
    code === -32603
    || code === "-32603"
    || normalizedMessage.includes("internal json-rpc error")
    || normalizedMessage.includes("wallet could not read the current game contract state")
  ) {
    return serverUnavailableRetryMessage();
  }

  return message || `${label} failed.`;
}

export function attackProtectionSubmitBlocker(status: Pick<AttackProtectionStatus, "allowed" | "blockedReason" | "blockedReasonLabel"> | null | undefined): string | undefined {
  if (!status || status.allowed || status.blockedReason === "none") return undefined;
  if (status.blockedReasonLabel) return status.blockedReasonLabel;
  if (status.blockedReason === "bashing_limit") return "Attack blocked by bashing limit.";
  if (status.blockedReason === "score_protection") return "Attack blocked: target is protected by newbie or score-ratio protection.";
  if (status.blockedReason === "same_alliance") return "Attack blocked: target belongs to your alliance.";
  return "Attack blocked.";
}

function errorLabelMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}

function errorLabelCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as { code?: unknown }).code;
}

export function buildingFinishActionErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Finish building upgrade transaction failed.";
  }

  const message = error.message.trim();
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("wallet could not read the current game contract state")
    || normalizedMessage.includes("internal json-rpc error")
  ) {
    return buildingFinishStateReadFailureLabel;
  }

  return message || "Finish building upgrade transaction failed.";
}

export function researchCompletionUnavailableReasonFor({
  canTransact,
  now = Date.now(),
  researchState,
}: {
  canTransact: boolean;
  now?: number;
  researchState: ChainResearchState | null;
}): string | undefined {
  if (!canTransact) {
    return "Wallet or game contract is unavailable.";
  }

  const queue = researchState?.queue;
  if (!queue?.active) {
    return "No active research queue is available to complete.";
  }

  const readyAt = timestampToMs(queue.readyAt);
  if (readyAt === undefined) {
    return "Research completion time is unavailable. Refresh research state before completing.";
  }

  if (readyAt > now) {
    return "Research is not ready to complete yet.";
  }

  return undefined;
}

export function overviewResearchCompletionUnavailableReasonFor({
  canTransact,
  now = Date.now(),
  overviewQueue,
  researchState,
}: {
  canTransact: boolean;
  now?: number;
  overviewQueue: PlayerQueuesResponse["research"] | undefined;
  researchState: ChainResearchState | null;
}): string | undefined {
  const unavailableReason = researchCompletionUnavailableReasonFor({
    canTransact,
    now,
    researchState,
  });
  if (!unavailableReason) return undefined;
  return canTransact && isOverviewResearchReadyToFinish(overviewQueue, now)
    ? undefined
    : unavailableReason;
}

export function overviewBuildingReadyToFinishFlag({
  activeBuildingQueue,
  isBuildingReadyToFinish,
  now = Date.now(),
}: {
  activeBuildingQueue: QueueStateResponse | null | undefined;
  isBuildingReadyToFinish: boolean;
  now?: number;
}): boolean | undefined {
  if (!activeBuildingQueue) return undefined;
  if (isBuildingReadyToFinish) return true;
  return isBuildingQueueReadyToFinish(activeBuildingQueue, now);
}

export function completedBuildingFinishSyncReasonFor({
  activeBuildingQueue,
  expectation,
}: {
  activeBuildingQueue: QueueStateResponse | null | undefined;
  expectation?: FinishedBuildingExpectation | undefined;
}): string | undefined {
  if (!expectation || !activeBuildingQueue?.active) return undefined;
  if (expectation.itemId === undefined && expectation.targetLevel === undefined) return undefined;
  if (expectation.itemId !== undefined && activeBuildingQueue.itemId !== expectation.itemId) return undefined;
  if (expectation.targetLevel !== undefined && activeBuildingQueue.targetLevel !== expectation.targetLevel) return undefined;
  return buildingFinishSubmittedSyncLabel;
}

export function failedBuildingFinishSyncReasonFor({
  activeBuildingQueue,
  expectation,
}: {
  activeBuildingQueue: QueueStateResponse | null | undefined;
  expectation?: FinishedBuildingExpectation | undefined;
}): string | undefined {
  if (!expectation || !activeBuildingQueue?.active) return undefined;
  if (expectation.itemId === undefined && expectation.targetLevel === undefined) return undefined;
  if (expectation.itemId !== undefined && activeBuildingQueue.itemId !== expectation.itemId) return undefined;
  if (expectation.targetLevel !== undefined && activeBuildingQueue.targetLevel !== expectation.targetLevel) return undefined;
  return buildingFinishFailedSyncLabel;
}

export function canonicalInfrastructureBuildingCompletionQueue(
  infrastructureState: ChainInfrastructureState | null,
): QueueStateResponse | null {
  if (!infrastructureState || isInfrastructureBackendSyncPaused(infrastructureState)) {
    return null;
  }

  return infrastructureState.queue?.active ? infrastructureState.queue : null;
}

export function buildingCompletionReadyToFinishFlag({
  fallbackBuildingQueue,
  infrastructureState,
  now = Date.now(),
}: {
  fallbackBuildingQueue?: QueueStateResponse | null | undefined;
  infrastructureState: ChainInfrastructureState | null;
  now?: number;
}): boolean {
  if (
    isInfrastructureBackendSyncPaused(infrastructureState)
    && !hasReadyIndexedBuildingCompletionState(infrastructureState, now)
  ) {
    return false;
  }

  return isBuildingQueueSafelyReadyToFinish(
    buildingCompletionQueueForVerification(infrastructureState, fallbackBuildingQueue),
    now,
  );
}

export function buildingCompletionUnavailableReasonFor({
  canTransact,
  fallbackBuildingQueue,
  infrastructureState,
  now = Date.now(),
}: {
  canTransact: boolean;
  fallbackBuildingQueue?: QueueStateResponse | null | undefined;
  infrastructureState: ChainInfrastructureState | null;
  now?: number;
}): string | undefined {
  if (!canTransact) {
    return "Wallet or game contract is unavailable.";
  }

  const syncPausedReason = infrastructureBackendSyncPausedReasonFor({ infrastructureChainState: infrastructureState });
  if (syncPausedReason && !hasReadyIndexedBuildingCompletionState(infrastructureState, now)) {
    return syncPausedReason;
  }

  const queue = buildingCompletionQueueForVerification(infrastructureState, fallbackBuildingQueue);
  if (!queue?.active && !infrastructureState) {
    return buildingFinishLiveStateRequiredLabel;
  }

  if (!queue?.active) {
    const backendPausedReason = infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState: infrastructureState,
    });
    if (backendPausedReason) {
      return backendPausedReason;
    }

    return "No active building upgrade is waiting to be finished. Refresh infrastructure state and retry.";
  }

  const readyAt = timestampToMs(queue.readyAt);
  if (readyAt === undefined) {
    return "Building completion time is unavailable. Refresh infrastructure state before finishing.";
  }

  if (readyAt + buildingFinishClientClockSafetyMs > now) {
    return "Building upgrade is not ready to finish yet.";
  }

  return undefined;
}

function isBuildingQueueSafelyReadyToFinish(
  queue: QueueStateResponse | null | undefined,
  now = Date.now(),
): boolean {
  const readyAt = timestampToMs(queue?.readyAt);
  return Boolean(queue?.active && readyAt !== undefined && readyAt + buildingFinishClientClockSafetyMs <= now);
}

function buildingCompletionQueueForVerification(
  infrastructureState: ChainInfrastructureState | null,
  _fallbackBuildingQueue?: QueueStateResponse | null | undefined,
): QueueStateResponse | null {
  if (!infrastructureState || infrastructureState.degraded === true) return null;
  return infrastructureState.queue?.active ? infrastructureState.queue : null;
}

function hasReadyIndexedBuildingCompletionState(
  infrastructureState: ChainInfrastructureState | null,
  now = Date.now(),
): boolean {
  return Boolean(
    infrastructureState
      && infrastructureState.source === "contract-state-indexer"
      && infrastructureState.degraded !== true
      && infrastructureState.infrastructureAvailable !== false
      && isBuildingQueueSafelyReadyToFinish(infrastructureState.queue, now)
  );
}

export function buildingFinishUnavailableReasonForDisplay({
  activeBuildingQueue,
  backendSyncPausedReason,
  canTransact,
  completedBuildingFinishExpectation,
  infrastructureState,
  isBuildingReadyToFinish,
  isDisplayedBuildingQueueReady,
  now = Date.now(),
}: {
  activeBuildingQueue: QueueStateResponse | null | undefined;
  backendSyncPausedReason?: string | undefined;
  canTransact: boolean;
  completedBuildingFinishExpectation?: FinishedBuildingExpectation | undefined;
  infrastructureState: ChainInfrastructureState | null;
  isBuildingReadyToFinish: boolean;
  isDisplayedBuildingQueueReady: boolean;
  now?: number;
}): string | undefined {
  if (!activeBuildingQueue?.active || !isDisplayedBuildingQueueReady) {
    return undefined;
  }

  if (!canTransact) {
    return "Wallet or game contract is unavailable.";
  }

  const completedQueueSyncReason = completedBuildingFinishSyncReasonFor({
    activeBuildingQueue,
    expectation: completedBuildingFinishExpectation,
  });
  if (completedQueueSyncReason) {
    return completedQueueSyncReason;
  }

  if (backendSyncPausedReason && !hasReadyIndexedBuildingCompletionState(infrastructureState, now)) {
    return backendSyncPausedReason;
  }

  if (!infrastructureState) {
    return buildingCompletionUnavailableReasonFor({
      canTransact,
      fallbackBuildingQueue: activeBuildingQueue,
      infrastructureState,
      now,
    });
  }

  if (
    isBuildingReadyToFinish
    && (
      !isInfrastructureBackendSyncPaused(infrastructureState)
      || hasReadyIndexedBuildingCompletionState(infrastructureState, now)
    )
  ) {
    return undefined;
  }

  return buildingCompletionUnavailableReasonFor({
    canTransact,
    fallbackBuildingQueue: activeBuildingQueue,
    infrastructureState,
    now,
  });
}

export async function infrastructureStateForCompletionRevalidation({
  account,
  activePlanetId,
  apiBaseUrl,
  fallback,
  loadInfrastructureState = fetchInfrastructureState,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainInfrastructureState | null;
  loadInfrastructureState?: typeof fetchInfrastructureState;
}): Promise<ChainInfrastructureState | null> {
  if (!apiBaseUrl || !account) return fallback;
  return loadInfrastructureState(apiBaseUrl, account, activePlanetId);
}

export async function buildingCompletionUnavailableReasonAfterBackendRevalidation({
  account,
  activePlanetId,
  apiBaseUrl,
  fallback,
  knownBuildingQueue,
  loadInfrastructureState = fetchInfrastructureState,
  now = Date.now(),
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainInfrastructureState | null;
  knownBuildingQueue?: QueueStateResponse | null | undefined;
  loadInfrastructureState?: typeof fetchInfrastructureState;
  now?: number;
}): Promise<{
  infrastructureState: ChainInfrastructureState | null;
  unavailableReason: string | undefined;
}> {
  const infrastructureState = await infrastructureStateForCompletionRevalidation({
    account,
    activePlanetId,
    apiBaseUrl,
    fallback,
    loadInfrastructureState,
  });

  return {
    infrastructureState,
    unavailableReason: buildingCompletionUnavailableReasonFor({
      canTransact: true,
      fallbackBuildingQueue: knownBuildingQueue,
      infrastructureState,
      now,
    }),
  };
}

export async function researchStateForCompletionRevalidation({
  account,
  activePlanetId,
  apiBaseUrl,
  fallback,
  loadResearchState = fetchResearchState,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainResearchState | null;
  loadResearchState?: typeof fetchResearchState;
}): Promise<ChainResearchState | null> {
  if (!apiBaseUrl || !account) return fallback;
  return loadResearchState(apiBaseUrl, account, activePlanetId);
}

const researchStartLiveStateRequiredLabel =
  "Can't verify the current research queue right now. Refresh research state and retry before starting research.";
const researchStartActiveQueueLabel =
  "Another research is already active. Finish or refresh the active research before starting a new one.";
const researchBackendSyncPausedLabel =
  "Research state is still syncing. Refresh research state and retry before starting research.";

function activeResearchQueue(
  queue: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined,
): QueueStateResponse | undefined {
  return queue?.active ? queue : undefined;
}

export function researchStateWithPreservedActiveQueue({
  knownResearchQueue,
  next,
}: {
  knownResearchQueue: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
  next: ChainResearchState;
}): ChainResearchState {
  if (next.queue?.active) return next;
  const queue = activeResearchQueue(knownResearchQueue);
  return queue ? { ...next, queue } : next;
}

export function researchStartUnavailableReasonFor({
  canTransact,
  knownResearchQueue,
  selectedResearchKey,
  selectedTechnologyId,
  researchState,
  walletResearchQueue,
}: {
  canTransact: boolean;
  knownResearchQueue?: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
  selectedResearchKey?: ResearchKey | undefined;
  selectedTechnologyId?: number | undefined;
  researchState: ChainResearchState | null;
  walletResearchQueue?: PlayerQueuesResponse["research"] | undefined;
}): string | undefined {
  if (!canTransact) {
    return "Wallet or game contract is unavailable.";
  }

  if (!researchState) {
    return researchStartLiveStateRequiredLabel;
  }

  if (researchState.researchAvailable === false) {
    return researchState.unavailableReason ?? "Research unavailable on this contract.";
  }

  if (isResearchBackendSyncPaused(researchState)) {
    return researchBackendSyncPausedLabel;
  }

  if (!researchState.homePlanetId) {
    return "No VeydriftGame home planet is available for research.";
  }

  if (
    activeResearchQueue(researchState.queue)
    || activeResearchQueue(walletResearchQueue)
    || activeResearchQueue(knownResearchQueue)
  ) {
    return researchStartActiveQueueLabel;
  }

  if (selectedResearchKey !== undefined) {
    return selectedResearchStartBlocker(researchState, selectedResearchKey, selectedTechnologyId);
  }

  return undefined;
}

function isResearchBackendSyncPaused(researchState: ChainResearchState): boolean {
  if (researchState.degraded === true || researchState.stale === true) return true;

  const indexer = researchState.indexer;
  if (!indexer) return false;
  return indexer.safeToServeIndexedState === false
    || indexer.indexedState === "reconciling"
    || indexer.indexedState === "stale";
}

export function selectedResearchStartBlocker(
  researchState: ChainResearchState,
  key: ResearchKey,
  technologyId = researchCatalog.find((research) => research.key === key)?.id,
): string | undefined {
  const missingRequirement = researchStartMissingRequirement(researchState, key);
  if (missingRequirement) {
    return `${formatResearchRequirementLabel(missingRequirement)} is required before starting ${researchLabelForKey(key)}.`;
  }

  if (technologyId === undefined) {
    return "Research technology is unavailable. Refresh research state and retry.";
  }

  const resources = resourcesFromChain(researchState.resourcesAsOfNow ?? researchState.resources);
  if (!resources) {
    return "Resources unavailable. Refresh research state and retry before starting research.";
  }

  const cost = resourcesFromChain(researchState.technologies.find((technology) => technology.id === technologyId)?.cost ?? null);
  if (!cost) {
    return "Research cost unavailable. Refresh research state and retry before starting research.";
  }

  return canAfford(resources, cost) ? undefined : formatMissingResources(resources, cost);
}

function researchStartMissingRequirement(
  researchState: ChainResearchState,
  key: ResearchKey,
): ResearchRequirement | undefined {
  return researchRequirementsFor(key).find((requirement) => {
    if (requirement.type === "building") {
      return requirement.key === "researchLab" && researchState.researchLabLevel < requirement.level;
    }

    if (requirement.type === "research") {
      return researchLevelFor(researchState, requirement.key) < requirement.level;
    }

    return false;
  });
}

function researchLevelFor(researchState: ChainResearchState, key: ResearchKey): number {
  const entry = researchCatalog.find((research) => research.key === key);
  if (!entry) return 0;
  return researchState.technologies.find((technology) => technology.id === entry.id)?.level
    ?? researchState.technologyLevels[entry.id.toString()]
    ?? 0;
}

function formatResearchRequirementLabel(requirement: ResearchRequirement): string {
  if (requirement.type === "building") {
    return `Research Lab ${requirement.level}`;
  }

  if (requirement.type === "research") {
    return `${researchLabelForKey(requirement.key)} ${requirement.level}`;
  }

  return `Energy production ${requirement.produced.toLocaleString()}`;
}

function researchLabelForKey(key: ResearchKey): string {
  return researchCatalog.find((research) => research.key === key)?.label ?? key;
}

export async function researchStartUnavailableReasonAfterLiveRevalidation({
  account,
  activePlanetId,
  apiBaseUrl,
  fallback,
  knownResearchQueue,
  loadResearchState = fetchResearchState,
  loadWalletQueues = fetchWalletQueues,
  selectedResearchKey,
  selectedTechnologyId,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainResearchState | null;
  knownResearchQueue?: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
  loadResearchState?: typeof fetchResearchState;
  loadWalletQueues?: typeof fetchWalletQueues;
  selectedResearchKey?: ResearchKey | undefined;
  selectedTechnologyId?: number | undefined;
}): Promise<{
  researchState: ChainResearchState | null;
  queues: PlayerQueuesResponse | null;
  unavailableReason: string | undefined;
}> {
  if (!apiBaseUrl || !account) {
    return {
      researchState: fallback,
      queues: null,
      unavailableReason: researchStartUnavailableReasonFor({
        canTransact: true,
        knownResearchQueue,
        selectedResearchKey,
        selectedTechnologyId,
        researchState: fallback,
      }),
    };
  }

  const [researchState, queues] = await Promise.all([
    loadResearchState(apiBaseUrl, account, activePlanetId),
    loadWalletQueues(apiBaseUrl, account, activePlanetId),
  ]);

  return {
    researchState,
    queues,
    unavailableReason: researchStartUnavailableReasonFor({
      canTransact: true,
      knownResearchQueue,
      selectedResearchKey,
      selectedTechnologyId,
      researchState,
      walletResearchQueue: queues.research,
    }),
  };
}

interface PlayableMvpAppProps {
  provider?: Eip1193Provider | undefined;
  account?: string | undefined;
  miniAppMode?: boolean | undefined;
  onConnectWallet?: (() => void) | undefined;
  planet?: PlanetSummary | undefined;
}

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string; autoDismiss?: boolean | undefined };

type DefenseActionState = ShipyardActionState;
type AllianceActionState = ShipyardActionState;
type RiftActionState = ShipyardActionState;
export type PlanetActionState = ShipyardActionState;
type PlanetManagementActionState = PlanetActionState;
type MissionActionState = ShipyardActionState;
type MoonActionState = ShipyardActionState;

function rejectedActionAutoDismiss(error: unknown): { autoDismiss?: true } {
  return isUserRejected(error) ? { autoDismiss: true } : {};
}

function useActionNoticeAutoDismiss<State extends AutoDismissableActionState>(
  action: State,
  setAction: ActionStateSetter<State>,
) {
  useEffect(() => scheduleActionNoticeAutoDismiss({ action, setAction }), [action, setAction]);
}

const transactionBusyUnavailableReason =
  "Transaction is syncing indexed state. Wait for it to finish before starting another action.";

export function transactionUnavailableReasonFor({
  activeActionLabel,
  inputsAvailable,
  transactionPending,
  unavailableReason,
}: {
  activeActionLabel?: string | undefined;
  inputsAvailable: boolean;
  transactionPending: boolean;
  unavailableReason: string;
}): string | undefined {
  if (!inputsAvailable) return unavailableReason;
  if (transactionPending) return activeActionLabel ?? transactionBusyUnavailableReason;
  return undefined;
}

export function isWalletContractUnavailableActionLabel(label: string): boolean {
  return (
    /wallet.*game contract.*unavailable/i.test(label)
    || /wallet or game contract (?:is )?unavailable/i.test(label)
    || /game contract unavailable/i.test(label)
    || /wallet.*mission actions unavailable/i.test(label)
    || /alliance contract unavailable/i.test(label)
    || /wallet.*moon contract.*unavailable/i.test(label)
    || /wallet.*game contract.*resource token.*unavailable/i.test(label)
    || /wallet.*game contract.*withdrawal resource.*unavailable/i.test(label)
  );
}

export function clearRecoveredWalletContractUnavailableAction<
  State extends { status: "idle" } | { status: string; label: string },
>(action: State, inputsAvailable: boolean): State {
  if (inputsAvailable && action.status === "error" && "label" in action && isWalletContractUnavailableActionLabel(action.label)) {
    return { status: "idle" } as State;
  }
  return action;
}

function keepGlobalReadStateDuringTransaction(current: ChainLoadStatus): ChainLoadStatus {
  return current === "ready" ? "ready" : current;
}

function globalReadStatusAfterTransactionRefreshFailure(current: ChainLoadStatus): ChainLoadStatus {
  return current === "ready" ? "ready" : "error";
}

function globalReadStatusDuringRefresh(current: ChainLoadStatus, hasUsableState: boolean): ChainLoadStatus {
  if (current === "ready" || hasUsableState) return "ready";
  return "loading";
}

function pendingActionLabel(...actions: Array<{ status: string; label?: string | undefined }>): string | undefined {
  return actions.find((action) => action.status === "pending" && action.label)?.label;
}

export function displayHomeCoordinates(
  homePlanet: Coordinates | undefined,
  homeCoords: Coordinates | undefined,
  fallbackCoordinates: string | undefined
): string | undefined {
  const coordinates = homePlanet ?? homeCoords;
  if (!coordinates) return fallbackCoordinates;

  return `${coordinates.galaxy}:${coordinates.system}:${coordinates.position}`;
}

export function homeGalaxySystemSyncKey(homeCoords: Coordinates | undefined): string | undefined {
  if (!homeCoords) return undefined;
  return `${homeCoords.galaxy}:${homeCoords.system}`;
}

export function homePlanetIdentityRefreshKey({
  apiBaseUrl,
  homeCoords,
  ownerDisplayName,
  settlementPlanet,
}: {
  apiBaseUrl: string | undefined;
  homeCoords: Coordinates | undefined;
  ownerDisplayName: string | null | undefined;
  settlementPlanet: WalletSettlementResponse["planet"] | undefined;
}): string | undefined {
  if (!homeCoords) return undefined;

  return JSON.stringify({
    apiBaseUrl: apiBaseUrl ?? null,
    displayName: ownerDisplayName?.trim() || null,
    fields: settlementPlanet?.fields ?? null,
    galaxy: homeCoords.galaxy,
    name: settlementPlanet?.name?.trim() || null,
    owner: settlementPlanet?.owner ?? null,
    planetId: settlementPlanet?.planetId ?? null,
    position: homeCoords.position,
    system: homeCoords.system,
    temperature: settlementPlanet?.temperature ?? null,
  });
}

export function topBarEnergyFor({
  infrastructureChainState,
  isWalletConnected,
}: {
  infrastructureChainState: ChainInfrastructureState | null;
  isWalletConnected: boolean;
}): EnergyBalance | undefined {
  // VEY-KANEO-465: energy balance is backend-derived (`energyBalance` on
  // /infrastructure, with the full source breakdown, VEY-KANEO-464). The frontend
  // displays it directly and no longer recomputes it from indexed building levels;
  // when the backend has not provided it, show nothing rather than inventing a
  // value.
  if (!isWalletConnected || !infrastructureChainState) {
    return undefined;
  }
  return energyBalanceFromChain(infrastructureChainState.energyBalance) ?? undefined;
}

export function infrastructureUnavailableReasonFor({
  buildingAction,
  gameContract,
  homePlanetId,
  infrastructureChainState,
  infrastructureError,
  infrastructureLoading,
  isWalletConnected,
  onChainResources,
  onChainStatus,
  runtimeConfigStatus,
}: {
  buildingAction: BuildingActionState;
  gameContract?: string | undefined;
  homePlanetId?: string | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  infrastructureError?: string | undefined;
  infrastructureLoading: boolean;
  isWalletConnected: boolean;
  onChainResources?: PlayableState["resources"] | undefined;
  onChainStatus: ChainLoadStatus;
  runtimeConfigStatus: RuntimeConfigState["status"];
}): string | undefined {
  if (!isWalletConnected) return "Connect a wallet to load your infrastructure.";

  const hasLoadedInfrastructureState = Boolean(onChainResources && homePlanetId && infrastructureChainState);
  if (
    (runtimeConfigStatus === "loading" || onChainStatus === "loading" || infrastructureLoading)
    && !hasLoadedInfrastructureState
  ) {
    return "Loading your wallet resources and building levels";
  }
  if (
    (runtimeConfigStatus === "error" || onChainStatus === "error" || infrastructureError || !onChainResources)
    && !hasLoadedInfrastructureState
  ) {
    return "Game state unavailable; upgrades are disabled until your wallet resources and building levels load.";
  }
  if (!gameContract) return "Game contract unavailable; upgrades are disabled.";
  if (!homePlanetId) return "No home planet found for this wallet.";
  const actionBlockerReason = infrastructureActionBlockerReasonFor(infrastructureChainState);
  if (actionBlockerReason) return actionBlockerReason;
  if (infrastructureChainState?.infrastructureAvailable === false) {
    return infrastructureChainState.unavailableReason ?? "Infrastructure is unavailable on this deployment.";
  }
  if (!infrastructureChainState) return "Infrastructure state unavailable.";
  const syncPausedReason = infrastructureBackendSyncPausedReasonFor({
    infrastructureChainState,
    infrastructureError,
  });
  if (syncPausedReason) return syncPausedReason;
  return undefined;
}

export function infrastructureBackendSyncPausedReasonFor({
  infrastructureChainState,
  infrastructureError,
}: {
  infrastructureChainState: ChainInfrastructureState | null;
  infrastructureError?: string | undefined;
}): string | undefined {
  if (infrastructureError || isInfrastructureBackendSyncPaused(infrastructureChainState)) {
    return infrastructureBackendSyncPausedLabel;
  }
  return undefined;
}

function infrastructureActionBlockerReasonFor(
  infrastructureChainState: ChainInfrastructureState | null,
): string | undefined {
  if (infrastructureChainState?.actionBlocker?.kind === "mission_resolution_pending") {
    return infrastructureMissionResolutionPendingLabel;
  }
  return undefined;
}

function isInfrastructureBackendSyncPaused(
  infrastructureChainState: ChainInfrastructureState | null,
): boolean {
  if (!infrastructureChainState) return false;
  if (infrastructureChainState.degraded === true || infrastructureChainState.stale === true) return true;

  const indexer = infrastructureChainState.indexer;
  if (!indexer) return false;
  return indexer.safeToServeIndexedState === false
    || indexer.indexedState === "reconciling"
    || indexer.indexedState === "stale";
}

export function buildingUpgradeActionErrorLabel(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /Infrastructure API/i.test(message)
    || /reading infrastructure from the game API/i.test(message)
    || /backend connection recovers/i.test(message)
  ) {
    return infrastructureBackendSyncPausedLabel;
  }

  return walletRequestErrorMessage(error);
}

export function infrastructureLoadErrorFor({
  infrastructureError,
  isWalletConnected,
}: {
  activeBuildingQueue?: QueueStateResponse | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  infrastructureError?: string | undefined;
  isWalletConnected: boolean;
}): string | undefined {
  if (!isWalletConnected || !infrastructureError) return undefined;
  return infrastructureError;
}

export function hasInfrastructureDisplayState({
  activeBuildingQueue,
  homePlanetId,
  infrastructureChainState,
  onChainResources,
}: {
  activeBuildingQueue?: QueueStateResponse | null | undefined;
  homePlanetId?: string | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  onChainResources?: PlayableState["resources"] | undefined;
}): boolean {
  return Boolean(onChainResources && homePlanetId && (infrastructureChainState || activeBuildingQueue?.active));
}

export function refreshedInfrastructureUnavailableReasonFor({
  gameContract,
  homePlanetId,
  infrastructureChainState,
  isWalletConnected,
  onChainResources,
  runtimeConfigStatus,
}: {
  gameContract?: string | undefined;
  homePlanetId?: string | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  isWalletConnected: boolean;
  onChainResources?: PlayableState["resources"] | undefined;
  runtimeConfigStatus: RuntimeConfigState["status"];
}): string | undefined {
  return infrastructureUnavailableReasonFor({
    buildingAction: { status: "idle" },
    gameContract,
    homePlanetId,
    infrastructureChainState,
    infrastructureLoading: false,
    isWalletConnected,
    onChainResources: resourcesFromChain(infrastructureChainState?.resources ?? null) ?? onChainResources,
    onChainStatus: "ready",
    runtimeConfigStatus,
  });
}

export function refreshedInfrastructureUpgradeUnavailableReasonFor({
  buildingKey,
  gameContract,
  homePlanetId,
  infrastructureChainState,
  isWalletConnected,
  onChainResources,
  runtimeConfigStatus,
  starterPlanet = false,
}: {
  buildingKey: BuildingKey;
  gameContract?: string | undefined;
  homePlanetId?: string | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  isWalletConnected: boolean;
  onChainResources?: PlayableState["resources"] | undefined;
  runtimeConfigStatus: RuntimeConfigState["status"];
  starterPlanet?: boolean | undefined;
}): string | undefined {
  const unavailableReason = refreshedInfrastructureUnavailableReasonFor({
    gameContract,
    homePlanetId,
    infrastructureChainState,
    isWalletConnected,
    onChainResources,
    runtimeConfigStatus,
  });
  if (unavailableReason) return unavailableReason;
  if (!infrastructureChainState) return "Infrastructure state unavailable.";

  const refreshedState = infrastructurePlayableState(infrastructureChainState);
  const refreshedResources = walletCurrentResourcesFor({
    infrastructureResourcesAsOfNow: infrastructureChainState.resourcesAsOfNow,
    infrastructureResources: infrastructureChainState.resources,
  }) ?? onChainResources;
  const status = buildingUpgradeStatus(
    {
      ...refreshedState,
      resources: refreshedResources ?? onChainResources ?? refreshedState.resources,
    },
    buildingKey,
    {
      chainCost: buildingCosts(infrastructureChainState)[buildingKey],
      starterPlanet,
    },
  );

  return status.disabled ? status.reason : undefined;
}

function resourceAmountIsZero(value: string): boolean {
  try {
    return BigInt(value) === 0n;
  } catch {
    return value === "0";
  }
}

export function abandonPlanetUnavailableLabel(
  planet: ManagedPlanetResponse,
  canTransact: boolean,
  action: PlanetActionState
): string | undefined {
  if (action.status === "pending") return undefined;
  if (!canTransact) return undefined;
  if (planet.isHomePlanet) return "Home planets cannot be abandoned.";
  if (planet.queues.building?.active || planet.queues.defense?.active || planet.queues.ship?.active) {
    return "Finish active queues before abandoning this colony.";
  }
  // Gate on the live settled-to-now balance (VEY-KANEO-488): a colony is "empty" only
  // when its current resources are zero, not merely its last settled snapshot.
  const planetResources = planet.resourcesAsOfNow ?? planet.resources;
  if (
    !resourceAmountIsZero(planetResources.metal)
    || !resourceAmountIsZero(planetResources.crystal)
    || !resourceAmountIsZero(planetResources.deuterium)
  ) {
    return "Empty colony resources before abandoning.";
  }

  return undefined;
}

export function shouldShowAbandonPlanetButton(
  planet: ManagedPlanetResponse,
  canTransact: boolean,
  action: PlanetActionState
): boolean {
  return canTransact && action.status !== "pending" && abandonPlanetUnavailableLabel(planet, canTransact, action) === undefined;
}

type EnabledGalaxyAction = Extract<GalaxyAction, { enabled: true }>;

type PendingGalaxyMission = {
  action: EnabledGalaxyAction;
  target: Planet | undefined;
  coords: Coordinates;
  originPlanet: ManagedPlanetResponse | undefined;
};

export function overviewMyPlanetActionsFor({
  account,
  activePlanetId,
  defenseState,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  defenseState: ChainDefenseState | null;
  homePlanetId: string | null | undefined;
  planet: ManagedPlanetResponse;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  const rowPlanet = planetFromSettlementPlanet(planet);
  const actionsByKind = new Map(
    galaxyActionsForSlot({
      account,
      defenseState,
      homePlanetId,
      isOrigin: false,
      planet: rowPlanet,
      shipyardState,
    }).map((action) => [action.kind, action])
  );
  if (activePlanetId === planet.planetId) {
    return planet.moon?.exists
      ? [overviewMoonTransportAction(actionsByKind.get("transport"))]
      : [];
  }

  const samePlanetReason = "Select another owned planet before launching this mission.";
  return [
    overviewOwnedPlanetMissionAction(actionsByKind.get("transport"), "transport", "Transport", samePlanetReason),
    overviewOwnedPlanetMissionAction(actionsByKind.get("deploy"), "deploy", "Deploy", samePlanetReason),
    overviewOwnedPlanetMissionAction(actionsByKind.get("defenseHold"), "defenseHold", "Defend", "Defend is unavailable for this planet."),
  ];
}

function overviewOwnedPlanetMissionAction(
  action: GalaxyAction | undefined,
  kind: "transport" | "deploy" | "defenseHold",
  label: string,
  fallbackReason: string,
): GalaxyAction {
  if (!action) return disabledOwnedPlanetMissionAction(kind, label, fallbackReason);
  if (action.enabled) return action;
  return {
    ...action,
    reason: overviewOwnedPlanetActionReason(action.reason),
  };
}

function overviewMoonTransportAction(action: GalaxyAction | undefined): GalaxyAction {
  if (!action) return disabledOwnedPlanetMissionAction("transport", "Moon transport", "Transport to this moon is unavailable.");
  if (!action.enabled) {
    return {
      ...action,
      label: "Moon transport",
      reason: overviewOwnedPlanetActionReason(action.reason),
    };
  }
  if (action.mode !== "mission" || action.kind !== "transport") {
    return disabledOwnedPlanetMissionAction("transport", "Moon transport", "Transport to this moon is unavailable.");
  }
  return {
    ...action,
    label: "Moon transport",
    defaultTargetIsMoon: true,
  };
}

function overviewOwnedPlanetActionReason(reason: string): string {
  if (reason === "Shipyard state is still loading.") {
    return "Selected planet fleet inventory is still syncing.";
  }
  return reason.replace(/\bhome planet\b/g, "selected planet");
}

function disabledOwnedPlanetMissionAction(
  kind: "transport" | "deploy" | "defenseHold",
  label: string,
  reason: string,
): GalaxyAction {
  return {
    enabled: false,
    kind,
    label,
    mode: "mission",
    mission: kind,
    reason,
  };
}

function transportCargoForSelectedPlanet(
  planet: ManagedPlanetResponse | undefined,
  ships: MissionShips,
  target: Coordinates,
  driveLevels: FleetDriveLevels = {},
  speedPercent = 100,
): Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined {
  if (!planet?.resources) return undefined;
  // Transport defaults to the live settled-to-now balance, not the settled snapshot (VEY-KANEO-488).
  const planetResources = planet.resourcesAsOfNow ?? planet.resources;

  const distance = fleetMissionDistance(planet, target);
  const fuelCost = fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  let remaining = fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  if (remaining <= 0) return undefined;

  const metal = Math.min(safeResourceNumber(planetResources.metal) ?? 0, remaining);
  remaining -= metal;
  const crystal = Math.min(safeResourceNumber(planetResources.crystal) ?? 0, remaining);
  remaining -= crystal;

  const deuteriumAvailable = Math.max(0, (safeResourceNumber(planetResources.deuterium) ?? 0) - fuelCost);
  const deuterium = Math.min(deuteriumAvailable, remaining);

  if (metal === 0 && crystal === 0 && deuterium === 0) return undefined;
  return {
    metal: String(metal),
    crystal: String(crystal),
    deuterium: String(deuterium),
  };
}

function missionCargoFromDraft(cargo: MissionCargoDraft | undefined): Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined {
  if (!cargo) return undefined;
  const normalized = {
    metal: String(Math.max(0, Math.trunc(Number(cargo.metal ?? 0) || 0))),
    crystal: String(Math.max(0, Math.trunc(Number(cargo.crystal ?? 0) || 0))),
    deuterium: String(Math.max(0, Math.trunc(Number(cargo.deuterium ?? 0) || 0))),
  };
  return normalized.metal === "0" && normalized.crystal === "0" && normalized.deuterium === "0"
    ? undefined
    : normalized;
}

function driveLevelsFromTechnologyLevels(levels: Record<string, number> | undefined): FleetDriveLevels {
  return {
    combustionDrive: levels?.["3"] ?? 0,
    impulseDrive: levels?.["9"] ?? 0,
    hyperspaceDrive: levels?.["10"] ?? 0,
  };
}

// VEY-KANEO-440: best-effort Alliance Depot level of a target planet for the DefenseHold holding-fuel
// subsidy preview, read from the planet's public building state (Alliance Depot = building id 13).
// The contract recomputes the real subsidy on launch, so an unknown level (no public state) previews
// as 0 rather than blocking.
const ALLIANCE_DEPOT_BUILDING_ID = 13;
const INITIAL_OVERVIEW_SNAPSHOT_TIMEOUT_MS = 2_500;
const INITIAL_FLEET_VISIBILITY_TIMEOUT_MS = 1_200;

function allianceDepotLevelFromPlanet(planet: Planet | undefined): number {
  const buildings = planet?.publicState?.buildings;
  if (!buildings) return 0;
  const depot = buildings.find((building) => building.id === ALLIANCE_DEPOT_BUILDING_ID);
  return Math.max(0, Math.trunc(depot?.level ?? 0));
}

export async function loadWalletPlanetSyncSnapshot(
  apiBaseUrl: string,
  account: string,
  activePlanetId: string | undefined,
  options: { forceHomePlanet?: boolean; forceWalletPlanets?: boolean } = {},
  loaders: {
    fetchWalletOverviewSnapshot?: typeof fetchWalletOverviewSnapshot;
    fetchWalletPlanets?: typeof fetchWalletPlanets;
    fetchWalletQueues?: typeof fetchWalletQueues;
    fetchFleetMissionVisibility?: typeof fetchFleetMissionVisibility;
    fetchWalletSettlement?: typeof fetchWalletSettlement;
  } = {},
): Promise<WalletPlanetSyncSnapshot> {
  const loadOverviewSnapshot = loaders.fetchWalletOverviewSnapshot ?? fetchWalletOverviewSnapshot;
  const loadWalletPlanets = loaders.fetchWalletPlanets ?? fetchWalletPlanets;
  const loadWalletQueues = loaders.fetchWalletQueues ?? fetchWalletQueues;
  const loadFleetMissionVisibility = loaders.fetchFleetMissionVisibility ?? fetchFleetMissionVisibility;
  const loadWalletSettlement = loaders.fetchWalletSettlement ?? fetchWalletSettlement;
  const readPlanetId = options.forceHomePlanet || options.forceWalletPlanets ? undefined : activePlanetId;
  const overviewPlanetId = options.forceHomePlanet ? undefined : activePlanetId;
  if (!options.forceWalletPlanets) {
    try {
      return await loadOverviewSnapshot(apiBaseUrl, account, overviewPlanetId, {
        timeoutMs: INITIAL_OVERVIEW_SNAPSHOT_TIMEOUT_MS,
      });
    } catch (error) {
      if (!isRecoverableOverviewSnapshotError(error)) {
        throw error;
      }
      // The overview snapshot is a fast-path optimization. Older backends may not expose it, and
      // mission visibility inside it can be briefly slow; hydrate critical planet state below instead
      // of leaving first paint blocked on noncritical mission data.
    }
  }

  const planetsResult = await settlePromise(loadWalletPlanets(apiBaseUrl, account));
  const indexedSettlement = settlementFromIndexedPlanets(
    account,
    planetsResult.status === "fulfilled" ? planetsResult.value : undefined,
  );
  if (indexedSettlement) {
    const indexedQueues = playerQueuesFromIndexedPlanet(
      account,
      indexedSettlement.homePlanetId,
      readPlanetId,
      planetsResult.status === "fulfilled" ? planetsResult.value : undefined,
    );
    const queuesResultPromise = indexedPlanetsExposeResearchQueue(planetsResult)
      ? Promise.resolve({ status: "fulfilled", value: indexedQueues } satisfies PromiseSettledResult<PlayerQueuesResponse>)
      : settlePromise(loadWalletQueues(apiBaseUrl, account, readPlanetId));
    const visibilityResultPromise = settlePromise(loadFleetMissionVisibility(apiBaseUrl, account, {
      includeArchive: false,
      timeoutMs: INITIAL_FLEET_VISIBILITY_TIMEOUT_MS,
    }));
    const [queuesResult, visibilityResult] = await Promise.all([queuesResultPromise, visibilityResultPromise]);
    return walletPlanetSyncSnapshotFromResults(
      account,
      indexedSettlement,
      planetsResult,
      queuesResult.status === "fulfilled"
        ? { status: "fulfilled", value: mergeIndexedPlayerQueues(indexedQueues, queuesResult.value) }
        : { status: "fulfilled", value: indexedQueues },
      visibilityResult,
    );
  }

  const [settlementResult, queuesResult, visibilityResult] = await Promise.allSettled([
    loadWalletSettlement(apiBaseUrl, account),
    loadWalletQueues(apiBaseUrl, account, readPlanetId),
    loadFleetMissionVisibility(apiBaseUrl, account, {
      includeArchive: false,
      timeoutMs: INITIAL_FLEET_VISIBILITY_TIMEOUT_MS,
    }),
  ]);

  const settlement = settlementResult.status === "fulfilled"
    ? settlementResult.value
    : undefined;
  if (!settlement) {
    throw settlementResult.status === "rejected"
      ? settlementResult.reason
      : new Error("Settlement state could not be loaded.");
  }

  return walletPlanetSyncSnapshotFromResults(account, settlement, planetsResult, queuesResult, visibilityResult);
}

function walletPlanetSyncSnapshotFromResults(
  account: string,
  settlement: WalletSettlementResponse,
  planetsResult: PromiseSettledResult<Awaited<ReturnType<typeof fetchWalletPlanets>>>,
  queuesResult: PromiseSettledResult<PlayerQueuesResponse>,
  visibilityResult: PromiseSettledResult<FleetMissionVisibilityResponse>,
): WalletPlanetSyncSnapshot {
  const planetsResponse = planetsResult.status === "fulfilled"
    ? planetsResult.value
    : {
        wallet: account,
        homePlanetId: settlement.homePlanetId,
        planets: [],
      };
  const queues = queuesResult.status === "fulfilled"
    ? queuesResult.value
    : emptyPlayerQueues(account, settlement.homePlanetId);
  const fleetVisibility = visibilityResult.status === "fulfilled"
    ? visibilityResult.value
    : emptyFleetVisibility(account, settlement.homePlanetId);

  return {
    fleetVisibility,
    planetsResponse,
    queues,
    settlement,
  };
}

function settlePromise<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
}

function isRecoverableOverviewSnapshotError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Overview snapshot API failed: 404\b/.test(error.message)
    || /Timed out reading overview snapshot from the game API/i.test(error.message)
    || /Game servers are unavailable while loading overview snapshot/i.test(error.message);
}

function settlementFromIndexedPlanets(
  account: string,
  planetsResponse: Awaited<ReturnType<typeof fetchWalletPlanets>> | undefined,
): WalletSettlementResponse | undefined {
  const selectedPlanet = planetsResponse?.planets.find((planet) => planet.planetId === planetsResponse.homePlanetId || planet.isHomePlanet)
    ?? planetsResponse?.planets[0];
  if (!selectedPlanet) return undefined;

  return {
    wallet: planetsResponse?.wallet ?? account,
    hasFirstPlanet: true,
    homePlanetId: planetsResponse?.homePlanetId ?? selectedPlanet.planetId,
    planet: selectedPlanet,
  };
}

export function walletSnapshotHydrationKey(apiBaseUrl: string | undefined, account: string | undefined): string | undefined {
  return apiBaseUrl && account ? `${apiBaseUrl}\n${account.toLowerCase()}` : undefined;
}

export function canLoadIndexedPageState({
  account,
  apiBaseUrl,
  hydratedWalletSnapshotKey,
}: {
  account: string | undefined;
  apiBaseUrl: string | undefined;
  hydratedWalletSnapshotKey: string | undefined;
}): boolean {
  const expectedKey = walletSnapshotHydrationKey(apiBaseUrl, account);
  return expectedKey === undefined || hydratedWalletSnapshotKey === expectedKey;
}

function missionArchetypeLookupMissions({
  allActiveMissions,
  fleetVisibility,
  globalMissionArchive,
  missionArchive,
}: {
  allActiveMissions: FleetMissionSummary[] | undefined;
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  globalMissionArchive: GlobalMissionArchiveResponse | undefined;
  missionArchive: FleetMissionArchiveResponse | undefined;
}): FleetMissionSummary[] {
  return [
    ...(fleetVisibility?.incoming ?? []),
    ...(fleetVisibility?.outgoing ?? []),
    ...(fleetVisibility?.returning ?? []),
    ...(fleetVisibility?.joinableAttacks ?? []),
    ...(fleetVisibility?.completedMissions ?? []),
    ...(allActiveMissions ?? []),
    ...missionRowsFromArchive(missionArchive),
    ...missionRowsFromArchive(globalMissionArchive),
  ];
}

function missionRowsFromArchive(
  archive: FleetMissionArchiveResponse | GlobalMissionArchiveResponse | undefined,
): FleetMissionSummary[] {
  return archive?.rows.flatMap((row) => (row.kind === "mission" ? [row.mission] : [])) ?? [];
}

export function mergeActiveMissionList(
  current: readonly FleetMissionSummary[],
  additions: readonly FleetMissionSummary[],
): FleetMissionSummary[] {
  const seen = new Set<string>();
  return [...additions, ...current].filter((mission) => {
    if (seen.has(mission.missionId)) return false;
    seen.add(mission.missionId);
    return true;
  });
}

export function mergePendingFleetVisibility(
  current: FleetMissionVisibilityResponse | undefined,
  pending: readonly FleetMissionSummary[],
  account: string | undefined,
  homePlanetId: string | null | undefined,
): FleetMissionVisibilityResponse | undefined {
  if (!current && pending.length === 0) return undefined;
  const base = current ?? emptyFleetVisibility(account ?? "", homePlanetId ?? null);
  return {
    ...base,
    outgoing: mergePendingMissionLaunches(base.outgoing, pending),
  };
}

type PendingMissionLaunchContext = {
  account: string;
  originPlanet: ManagedPlanetResponse | undefined;
  originPlanetId: string;
  targetPlanet?: Planet | undefined;
  targetPlanetId: string;
  targetCoords: Coordinates;
  missionType: string;
  draft: MissionLaunchDraft;
  cargo?: Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined;
  fuelCost?: number | undefined;
  driveLevels: FleetDriveLevels;
  originIsMoon?: boolean | undefined;
  targetIsMoon?: boolean | undefined;
};

function pendingMissionLaunchForDraft(
  txHash: string,
  context: PendingMissionLaunchContext,
): FleetMissionSummary {
  const originCoords = managedPlanetCoordinates(context.originPlanet);
  const distance = originCoords ? fleetMissionDistance(originCoords, context.targetCoords) : 0;
  const travelSeconds = fleetMissionTravelSeconds(distance, context.draft.ships, context.driveLevels, context.draft.speedPercent);
  const fuelCost = context.fuelCost
    ?? fleetMissionFuelCost(context.draft.ships, distance, context.driveLevels, context.draft.speedPercent);

  return pendingMissionLaunch({
    txHash,
    owner: context.account,
    originPlanetId: context.originPlanetId,
    targetPlanetId: context.targetPlanetId,
    originIsMoon: context.originIsMoon,
    targetIsMoon: context.targetIsMoon,
    missionType: context.missionType,
    ships: context.draft.ships,
    cargo: context.cargo,
    fuelCost,
    originPlanet: missionReferenceFromManagedPlanet(context.originPlanet),
    targetPlanet: missionReferenceFromGalaxyPlanet(context.targetPlanet, context.targetPlanetId),
    travelSeconds,
  });
}

function managedPlanetCoordinates(planet: ManagedPlanetResponse | undefined): Coordinates | undefined {
  return planet ? { galaxy: planet.galaxy, system: planet.system, position: planet.position } : undefined;
}

async function waitForConfirmedChickenMoonState(
  apiBaseUrl: string,
  account: string,
  planetId: string,
): Promise<ChainMoonState> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CHICKEN_MOON_CONFIRM_TIMEOUT_MS) {
    const nextMoonState = await fetchMoonState(apiBaseUrl, account, planetId);
    if (nextMoonState.moon?.exists) {
      return nextMoonState;
    }
    await delay(CHICKEN_MOON_CONFIRM_POLL_MS);
  }

  throw new Error("Chicken burn confirmed, but the granted moon was not indexed yet. Refresh moon state before retrying.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function missionReferenceFromManagedPlanet(planet: ManagedPlanetResponse | undefined): FleetMissionPlanetReference | null {
  if (!planet) return null;
  return {
    planetId: planet.planetId,
    owner: planet.owner,
    ownerDisplayName: null,
    name: planet.name,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
    coordinates: planet.coordinates,
    archetype: planetTypeFromTemperature(planet.temperature),
    allianceDepotLevel: null,
  };
}

function missionReferenceFromGalaxyPlanet(planet: Planet | undefined, planetId: string): FleetMissionPlanetReference | null {
  if (!planet?.occupiedBy) return null;
  return {
    planetId,
    owner: planet.occupiedBy.owner,
    ownerDisplayName: planet.occupiedBy.ownerDisplayName ?? null,
    name: planet.name,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.position,
    coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
    archetype: planet.type,
    allianceDepotLevel: allianceDepotLevelFromPlanet(planet),
  };
}

function sameMissionIds(left: readonly FleetMissionSummary[], right: readonly FleetMissionSummary[]): boolean {
  return left.length === right.length && left.every((mission, index) => mission.missionId === right[index]?.missionId);
}

function backendMissionTypeLabel(kind: string): string {
  if (kind === "acsDefend") return "AcsDefend";
  if (kind === "defenseHold") return "DefenseHold";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function defenseCompletionPlanetIdFor({
  activePlanetId,
  defenseState,
  walletQueues,
}: {
  activePlanetId: string | undefined;
  defenseState: ChainDefenseState | null;
  walletQueues: PlayerQueuesResponse | undefined;
}): string | undefined {
  return activePlanetId ?? defenseState?.homePlanetId ?? walletQueues?.homePlanetId ?? undefined;
}

export function shipCompletionPlanetIdFor({
  activePlanetId,
  shipyardState,
  walletQueues,
}: {
  activePlanetId: string | undefined;
  shipyardState: ChainShipyardState | null;
  walletQueues: PlayerQueuesResponse | undefined;
}): string | undefined {
  return activePlanetId ?? shipyardState?.planetId ?? shipyardState?.homePlanetId ?? walletQueues?.homePlanetId ?? undefined;
}

function emptyPlayerQueues(wallet: string, homePlanetId: string | null): PlayerQueuesResponse {
  return {
    wallet,
    homePlanetId,
    building: null,
    defense: null,
    ship: null,
    research: null,
  };
}

function indexedPlanetsExposeResearchQueue(
  planetsResult: PromiseSettledResult<WalletPlanetsResponse>,
): boolean {
  return planetsResult.status === "fulfilled"
    && planetsResult.value.queues !== undefined
    && "research" in planetsResult.value.queues;
}

function mergeIndexedPlayerQueues(
  indexedQueues: PlayerQueuesResponse,
  fetchedQueues: PlayerQueuesResponse,
): PlayerQueuesResponse {
  return {
    ...indexedQueues,
    ...fetchedQueues,
    building: fetchedQueues.building ?? indexedQueues.building,
    defense: fetchedQueues.defense ?? indexedQueues.defense,
    ship: fetchedQueues.ship ?? indexedQueues.ship,
    research: fetchedQueues.research ?? indexedQueues.research,
  };
}

function isActiveResearchQueue(queue: QueueStateResponse | null | undefined): queue is QueueStateResponse {
  return Boolean(queue?.active && queue.kind === "research");
}

export function preserveActiveResearchQueue(
  currentQueues: PlayerQueuesResponse | undefined,
  nextQueues: PlayerQueuesResponse,
  options: { now?: number } = {},
): PlayerQueuesResponse {
  if (isActiveResearchQueue(nextQueues.research) || !isActiveResearchQueue(currentQueues?.research)) {
    return nextQueues;
  }

  const readyAt = timestampToMs(currentQueues.research.readyAt);
  if (options.now !== undefined && readyAt !== undefined && readyAt <= options.now) {
    return nextQueues;
  }

  return {
    ...nextQueues,
    research: currentQueues.research,
  };
}

export function preserveActiveResearchState(
  currentResearchState: ChainResearchState | null,
  nextResearchState: ChainResearchState,
): ChainResearchState {
  if (isActiveResearchQueue(nextResearchState.queue) || !isActiveResearchQueue(currentResearchState?.queue)) {
    return nextResearchState;
  }

  if (researchQueueCompletedInState(currentResearchState.queue, nextResearchState)) {
    return nextResearchState;
  }

  return {
    ...nextResearchState,
    queue: currentResearchState.queue,
  };
}

export function researchStateWithFallbackQueue(
  researchState: ChainResearchState | null,
  fallbackQueue: QueueStateResponse | null | undefined,
): ChainResearchState | null {
  if (!researchState || isActiveResearchQueue(researchState.queue) || !isActiveResearchQueue(fallbackQueue)) {
    return researchState;
  }

  if (researchQueueCompletedInState(fallbackQueue, researchState)) {
    return researchState;
  }

  return {
    ...researchState,
    queue: fallbackQueue,
  };
}

function researchQueueCompletedInState(
  queue: QueueStateResponse,
  researchState: ChainResearchState,
): boolean {
  if (queue.itemId === undefined || queue.targetLevel === undefined) return false;
  const currentLevel = researchState.technologies.find((technology) => technology.id === queue.itemId)?.level
    ?? researchState.technologyLevels[queue.itemId.toString()]
    ?? 0;
  return currentLevel >= queue.targetLevel;
}

function playerQueuesFromIndexedPlanet(
  wallet: string,
  homePlanetId: string | null,
  activePlanetId: string | undefined,
  planetsResponse: WalletPlanetsResponse | undefined,
): PlayerQueuesResponse {
  const planets = planetsResponse?.planets;
  const queuePlanetId = activePlanetId ?? homePlanetId;
  const selectedPlanet = planets?.find((planet) => planet.planetId === queuePlanetId)
    ?? planets?.find((planet) => planet.planetId === homePlanetId || planet.isHomePlanet)
    ?? planets?.[0];
  return {
    ...emptyPlayerQueues(wallet, selectedPlanet?.planetId ?? queuePlanetId ?? homePlanetId),
    building: selectedPlanet?.queues.building ?? null,
    defense: selectedPlanet?.queues.defense ?? null,
    ship: selectedPlanet?.queues.ship ?? null,
    research: planetsResponse?.queues?.research ?? null,
  };
}

function emptyFleetVisibility(wallet: string, homePlanetId: string | null): FleetMissionVisibilityResponse {
  return {
    wallet,
    homePlanetId,
    incoming: [],
    outgoing: [],
    returning: [],
    joinableAttacks: [],
    completedMissions: [],
    battleReports: [],
  };
}

function chainEventWalletPlanetsChanged(event: MessageEvent | undefined): boolean {
  if (!event) return false;
  try {
    const payload = JSON.parse(event.data) as { walletPlanetsChanged?: boolean };
    return payload.walletPlanetsChanged === true;
  } catch {
    return false;
  }
}

function initialInspectPageState(): {
  page: Page;
  playerWallet: string | null;
  allianceId: string | null;
  missionDetailId: string | null;
  missionReportId: string | null;
} {
  if (typeof window === "undefined") {
    return { page: "overview", playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: null };
  }
  replaceLegacyHashEntityRoute();
  const route = parseInspectRouteFromLocation(window.location);
  if (route.kind === "player") {
    return { page: "player-inspect", playerWallet: route.wallet, allianceId: null, missionDetailId: null, missionReportId: null };
  }
  if (route.kind === "alliance") {
    return { page: "alliance-inspect", playerWallet: null, allianceId: route.allianceId, missionDetailId: null, missionReportId: null };
  }
  if (route.kind === "mission") {
    return { page: "mission-control", playerWallet: null, allianceId: null, missionDetailId: route.missionId, missionReportId: null };
  }
  if (route.kind === "mission-report") {
    return { page: "mission-control", playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: route.missionId };
  }
  if (route.kind === "planet") {
    return { page: "planet", playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: null };
  }
  if (route.kind === "moon") {
    return { page: "moon-inspect", playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: null };
  }
  return { page: route.page, playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: null };
}

function initialSelectedCoords(): Coordinates | undefined {
  if (typeof window === "undefined") return undefined;
  replaceLegacyHashEntityRoute();
  const route = parseInspectRouteFromLocation(window.location);
  return route.kind === "planet" || route.kind === "moon" ? route.coords : undefined;
}

function replaceLegacyHashEntityRoute(): boolean {
  if (typeof window === "undefined") return false;
  const canonicalPath = canonicalEntityPathForLegacyHashLocation(window.location);
  if (!canonicalPath) return false;
  window.history.replaceState(null, "", canonicalPath);
  resetDocumentTitle();
  return true;
}

function writeInspectRoute(route: InspectRoute): void {
  if (typeof window === "undefined") return;
  const path = buildInspectPath(route);
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentPath !== path) {
    window.history.pushState(null, "", path);
  }
  resetDocumentTitle();
}

export function PlayableMvpApp({ provider, account, miniAppMode = false, onConnectWallet, planet }: PlayableMvpAppProps = {}) {
  const isWalletConnected = Boolean(provider && account);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [page, setPage] = useState<Page>(() => initialInspectPageState().page);
  const [inspectedPlayerWallet, setInspectedPlayerWallet] = useState<string | null>(() => initialInspectPageState().playerWallet);
  const [inspectedAllianceId, setInspectedAllianceId] = useState<string | null>(() => initialInspectPageState().allianceId);
  const [missionDetailId, setMissionDetailId] = useState<string | null>(() => initialInspectPageState().missionDetailId);
  const [missionReportId, setMissionReportId] = useState<string | null>(() => initialInspectPageState().missionReportId);
  const [planetBackRoute, setPlanetBackRoute] = useState<PlanetDetailBackRoute | null>(null);
  const [selectedBuildingKey, setSelectedBuildingKey] = useState<BuildingKey>("metalMine");
  const [selectedResearchKey, setSelectedResearchKey] = useState<ResearchKey>("energy");
  const [selectedDefenseKey, setSelectedDefenseKey] = useState<DefenseKey>("rocketLauncher");
  const [selectedShipKey, setSelectedShipKey] = useState<ShipKey>("smallCargo");
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | undefined>(() => initialSelectedCoords());
  const [onChainSettlementState, setOnChainSettlementState] = useState<WalletSettlementResponse | undefined>();
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | undefined>();
  const [walletPlanets, setWalletPlanets] = useState<ManagedPlanetResponse[]>([]);
  const [watchedPlanets, setWatchedPlanets] = useState<WatchedPlanetsResponse | undefined>();
  const [watchedPlanetsLoading, setWatchedPlanetsLoading] = useState(false);
  const [watchedPlanetsError, setWatchedPlanetsError] = useState<string | undefined>();
  const [watchedPlanetsPage, setWatchedPlanetsPage] = useState(1);
  const [watchBusyPlanetId, setWatchBusyPlanetId] = useState<string | undefined>();
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | undefined>();
  const [selectedBodyKind, setSelectedBodyKind] = useState<OrbitBodyKind>("planet");
  const resolvedSelectedPlanetId = useMemo(() => selectedPlanetIdFromRoster({
    homePlanetId: onChainSettlementState?.homePlanetId,
    planets: walletPlanets,
    selectedPlanetId,
  }), [onChainSettlementState?.homePlanetId, selectedPlanetId, walletPlanets]);
  const selectedManagedPlanet = useMemo(
    () => walletPlanets.find((item) => item.planetId === resolvedSelectedPlanetId)
      ?? walletPlanets[0],
    [resolvedSelectedPlanetId, walletPlanets]
  );
  const activePlanetId = selectedManagedPlanet?.planetId ?? onChainSettlementState?.homePlanetId ?? undefined;
  const selectedMoonBody = selectedManagedPlanet?.moon?.exists ? selectedManagedPlanet.moon : null;
  const activeBodyKind = resolvedOrbitBodyKind(selectedBodyKind, selectedManagedPlanet);
  const walletMoonCount = useMemo(
    () => walletPlanets.filter((item) => item.moon?.exists).length,
    [walletPlanets],
  );
  const [planetSectionStore, setPlanetSectionStore] = useState<PlanetSectionStore>({});
  const activePlanetSection = useMemo(
    () => planetSectionForPlanet(planetSectionStore, activePlanetId),
    [activePlanetId, planetSectionStore]
  );
  const setActivePlanetSectionStatus = useCallback((
    key: Parameters<typeof setPlanetSectionStatus>[2],
    status: Parameters<typeof setPlanetSectionStatus>[3],
  ) => {
    setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, key, status));
  }, [activePlanetId]);
  const [onChainQueuesState, setOnChainQueuesState] = useState<PlayerQueuesResponse | undefined>();
  const onChainQueues = activePlanetSection.queuesState ?? onChainQueuesState;
  const setOnChainQueues = useCallback((
    value: PlayerQueuesResponse | undefined | ((current: PlayerQueuesResponse | undefined) => PlayerQueuesResponse | undefined),
  ) => {
    const next = typeof value === "function"
      ? value(activePlanetSection.queuesState ?? onChainQueuesState)
      : value;
    setOnChainQueuesState(next);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "queuesState", next, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: Date.now(),
    }));
  }, [activePlanetId, activePlanetSection.queuesState, onChainQueuesState]);
  const [fleetVisibilityState, setFleetVisibilityState] = useState<FleetMissionVisibilityResponse | undefined>();
  const fleetVisibility = activePlanetSection.fleetVisibilityState ?? fleetVisibilityState;
  const setFleetVisibility = useCallback((value: FleetMissionVisibilityResponse | undefined) => {
    setFleetVisibilityState(value);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "fleetVisibilityState", value, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: Date.now(),
    }));
  }, [activePlanetId]);
  const [missionArchiveState, setMissionArchiveState] = useState<FleetMissionArchiveResponse | undefined>();
  const missionArchive = activePlanetSection.missionArchiveState ?? missionArchiveState;
  const setMissionArchive = useCallback((value: FleetMissionArchiveResponse | undefined) => {
    setMissionArchiveState(value);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "missionArchiveState", value, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: value ? Date.now() : undefined,
    }));
  }, [activePlanetId]);
  const [missionArchivePage, setMissionArchivePage] = useState(1);
  const [missionArchiveLoading, setMissionArchiveLoading] = useState(false);
  const [missionArchiveError, setMissionArchiveError] = useState<string | undefined>();
  const [missionNumberSearch, setMissionNumberSearch] = useState("");
  const missionNumberArchiveQuery = normalizeMissionNumberSearch(missionNumberSearch);
  const [incomingAttackArchive, setIncomingAttackArchive] = useState<FleetMissionArchiveResponse | undefined>();
  const [incomingAttackArchivePage, setIncomingAttackArchivePage] = useState(1);
  const [incomingAttackArchiveLoading, setIncomingAttackArchiveLoading] = useState(false);
  const [incomingAttackArchiveError, setIncomingAttackArchiveError] = useState<string | undefined>();
  const [allActiveMissionsState, setAllActiveMissionsState] = useState<FleetMissionSummary[] | undefined>();
  const allActiveMissions = activePlanetSection.allActiveMissionsState ?? allActiveMissionsState;
  const setAllActiveMissions = useCallback((value: FleetMissionSummary[] | undefined) => {
    setAllActiveMissionsState(value);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "allActiveMissionsState", value, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: value ? Date.now() : undefined,
    }));
  }, [activePlanetId]);
  const [pendingMissionLaunches, setPendingMissionLaunches] = useState<FleetMissionSummary[]>([]);
  const [globalMissionArchiveState, setGlobalMissionArchiveState] = useState<GlobalMissionArchiveResponse | undefined>();
  const globalMissionArchive = activePlanetSection.globalMissionArchiveState ?? globalMissionArchiveState;
  const setGlobalMissionArchive = useCallback((value: GlobalMissionArchiveResponse | undefined) => {
    setGlobalMissionArchiveState(value);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "globalMissionArchiveState", value, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: value ? Date.now() : undefined,
    }));
  }, [activePlanetId]);
  const [globalMissionArchivePage, setGlobalMissionArchivePage] = useState(1);
  const [globalMissionArchiveLoading, setGlobalMissionArchiveLoading] = useState(false);
  const [globalMissionArchiveError, setGlobalMissionArchiveError] = useState<string | undefined>();
  const [missionPlanetArchetypesByCoordinateState, setMissionPlanetArchetypesByCoordinateState] = useState<Map<string, PlanetType>>(
    () => new Map()
  );
  const missionPlanetArchetypesByCoordinate = activePlanetSection.missionArchetypesByCoordinate ?? missionPlanetArchetypesByCoordinateState;
  const setMissionPlanetArchetypesByCoordinate = useCallback((value: Map<string, PlanetType> | ((current: Map<string, PlanetType>) => Map<string, PlanetType>)) => {
    const currentValue = activePlanetSection.missionArchetypesByCoordinate ?? missionPlanetArchetypesByCoordinateState;
    const next = typeof value === "function" ? value(currentValue) : value;
    setMissionPlanetArchetypesByCoordinateState(next);
    setPlanetSectionStore((current) => setPlanetSectionData(current, activePlanetId, "missionArchetypesByCoordinate", next, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: next.size > 0 ? Date.now() : undefined,
    }));
  }, [activePlanetId, activePlanetSection.missionArchetypesByCoordinate, missionPlanetArchetypesByCoordinateState]);
  const [publicBattleReports, setPublicBattleReports] = useState<BattleReport[]>([]);
  const [publicBattleReportsLoading, setPublicBattleReportsLoading] = useState(false);
  const [publicBattleReportsError, setPublicBattleReportsError] = useState<string | undefined>();
  const [missionDetail, setMissionDetail] = useState<MissionDetailResponse | undefined>();
  const [missionDetailLoading, setMissionDetailLoading] = useState(false);
  const [missionDetailError, setMissionDetailError] = useState<string | undefined>();
  const [onChainStatus, setOnChainStatus] = useState<ChainLoadStatus>("local");
  const [onChainError, setOnChainError] = useState<string | undefined>();
  const [hydratedWalletSnapshotKey, setHydratedWalletSnapshotKey] = useState<string | undefined>();
  const [chainSyncHealthy, setChainSyncHealthy] = useState(false);
  const onChainSettlement = activePlanetSection.settlementState ?? onChainSettlementState;
  const applyOnChainSettlementSnapshot = useCallback((settlement: WalletSettlementResponse | undefined) => {
    const planetId = settlement?.planet?.planetId ?? settlement?.homePlanetId ?? activePlanetId;
    setOnChainSettlementState(settlement);
    setPlanetSectionStore((current) => setPlanetSectionData(current, planetId, "settlementState", settlement, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: settlement ? Date.now() : undefined,
    }));
  }, [activePlanetId]);
  const updateOnChainSettlementSnapshot = useCallback((
    updater: (current: WalletSettlementResponse | undefined) => WalletSettlementResponse | undefined,
  ) => {
    setPlanetSectionStore((current) => {
      const sectionSettlement = planetSectionForPlanet(current, activePlanetId).settlementState;
      const nextSettlement = updater(sectionSettlement ?? onChainSettlementState);
      const planetId = nextSettlement?.planet?.planetId ?? nextSettlement?.homePlanetId ?? activePlanetId;
      return setPlanetSectionData(current, planetId, "settlementState", nextSettlement, {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: nextSettlement ? Date.now() : undefined,
      });
    });
    setOnChainSettlementState((current) => updater(current));
  }, [activePlanetId, onChainSettlementState]);
  const infrastructureChainState = activePlanetSection.infrastructureChainState;
  const setInfrastructureChainState = useCallback((
    value: ChainInfrastructureState | null | ((current: ChainInfrastructureState | null) => ChainInfrastructureState | null),
  ) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "infrastructureChainState", value));
  }, [activePlanetId]);
  // Client-side ledger of submitted-but-not-yet-settled resource spends. Keeps
  // the displayed/gated balance from over-reporting during the window between a
  // spend mining and the backend infrastructure read reflecting it (VEY-392).
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState<string | undefined>();
  const moonState = activePlanetSection.moonState;
  const setMoonState = useCallback((value: ChainMoonState | null) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "moonState", value));
  }, [activePlanetId]);
  const [moonLoading, setMoonLoading] = useState(false);
  const [moonError, setMoonError] = useState<string | undefined>();
  const defenseState = activePlanetSection.defenseState;
  const setDefenseState = useCallback((value: ChainDefenseState | null) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "defenseState", value));
  }, [activePlanetId]);
  const [defenseLoading, setDefenseLoading] = useState(false);
  const [defenseError, setDefenseError] = useState<string | undefined>();
  const [defenseAction, setDefenseAction] = useState<DefenseActionState>({ status: "idle" });
  const [allianceState, setAllianceState] = useState<ChainAllianceState | null>(null);
  const [allianceLoading, setAllianceLoading] = useState(false);
  const [allianceError, setAllianceError] = useState<string | undefined>();
  const [allianceAction, setAllianceAction] = useState<AllianceActionState>({ status: "idle" });
  const [selectedAllianceId, setSelectedAllianceId] = useState<string | null>(null);
  const shipyardState = activePlanetSection.shipyardState;
  const setShipyardState = useCallback((value: ChainShipyardState | null) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "shipyardState", value));
  }, [activePlanetId]);
  const [shipyardLoading, setShipyardLoading] = useState(false);
  const [shipyardError, setShipyardError] = useState<string | undefined>();
  const [shipyardAction, setShipyardAction] = useState<ShipyardActionState>({ status: "idle" });
  const [galaxyAction, setGalaxyAction] = useState<GalaxyActionState>({ status: "idle" });
  const [pendingGalaxyMission, setPendingGalaxyMission] = useState<PendingGalaxyMission | null>(null);
  // VEY-KANEO-431: a join-attack awaiting fleet selection. When set, the same
  // fleet picker the Attack action uses is shown so the player chooses which
  // ships to commit, instead of immediately sending a default fleet.
  const [pendingJoinAttack, setPendingJoinAttack] = useState<{
    attackMissionId: string;
    targetPlanetId: string;
    coords: Coordinates;
  } | null>(null);
  // VEY-KANEO-440: an ACS Defend ("Group defend") counterplay awaiting fleet selection. When set, the
  // mission compose picker opens with a hold-duration / holding-fuel / Alliance Depot preview so the
  // player chooses the fleet and speed, instead of immediately sending a default counterplay fleet.
  const [pendingAcsDefend, setPendingAcsDefend] = useState<{
    hostileMissionId: string;
    coords: Coordinates;
    hostileArrivalMs: number;
    depotLevel: number;
  } | null>(null);
  const researchState = activePlanetSection.researchState;
  const setResearchState = useCallback((
    value: ChainResearchState | null | ((current: ChainResearchState | null) => ChainResearchState | null),
  ) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "researchState", value));
  }, [activePlanetId]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | undefined>();
  const [researchAction, setResearchAction] = useState<ResearchActionState>({ status: "idle" });
  const riftState = activePlanetSection.riftState;
  const setRiftState = useCallback((value: ChainRiftState | null) => {
    setPlanetSectionStore((current) => setPlanetSectionValue(current, activePlanetId, "riftState", value));
  }, [activePlanetId]);
  const [riftLoading, setRiftLoading] = useState(false);
  const [riftError, setRiftError] = useState<string | undefined>();
  const [riftAction, setRiftAction] = useState<RiftActionState>({ status: "idle" });
  const [buildingAction, setBuildingAction] = useState<BuildingActionState>({ status: "idle" });
  const [failedStartedBuildingExpectation, setFailedStartedBuildingExpectation] =
    useState<StartedBuildingExpectation | undefined>();
  const [completedBuildingFinishExpectation, setCompletedBuildingFinishExpectation] =
    useState<FinishedBuildingExpectation | undefined>();
  const [failedBuildingFinishExpectation, setFailedBuildingFinishExpectation] =
    useState<FinishedBuildingExpectation | undefined>();
  const [planetManagementAction, setPlanetManagementAction] = useState<PlanetManagementActionState>({ status: "idle" });
  const [planetRenameAction, setPlanetRenameAction] = useState<PlanetRenameActionState>({ status: "idle" });
  const [playerProfileAction, setPlayerProfileAction] = useState<PlanetRenameActionState>({ status: "idle" });
  const [missionAction, setMissionAction] = useState<MissionActionState>({ status: "idle" });
  const [transactionActionPending, setTransactionActionPending] = useState(false);
  // The shareable battle-report URL currently shown in the share dialog; null when it is closed.
  const [shareDialogUrl, setShareDialogUrl] = useState<string | null>(null);
  const [moonAction, setMoonAction] = useState<MoonActionState>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;
  const onChainRefreshGate = useRef(0);
  const infrastructureRefreshGate = useRef(0);
  const defenseRefreshGate = useRef(0);
  const shipyardRefreshGate = useRef(0);
  const researchRefreshGate = useRef(0);
  const riftRefreshGate = useRef(0);
  const planetSwitchGate = useRef(0);
  const latestOnChainResourceSnapshot = useRef<ResourceSnapshotFreshness>({ planetId: null, lastSettledAt: null });
  const latestInfrastructureResourceSnapshot = useRef<ResourceSnapshotFreshness>({ planetId: null, lastSettledAt: null });
  const [homePlanetIdentity, setHomePlanetIdentity] = useState<Planet | undefined>();

  const runGatedTransaction = useCallback(async (key: string, action: () => Promise<void>) => {
    await transactionActionGate.run(key, async () => {
      setTransactionActionPending(true);
      try {
        await action();
      } finally {
        setTransactionActionPending(false);
      }
    });
  }, [transactionActionGate]);

  useActionNoticeAutoDismiss(defenseAction, setDefenseAction);
  useActionNoticeAutoDismiss(allianceAction, setAllianceAction);
  useActionNoticeAutoDismiss(shipyardAction, setShipyardAction);
  useActionNoticeAutoDismiss(galaxyAction, setGalaxyAction);
  useActionNoticeAutoDismiss(researchAction, setResearchAction);
  useActionNoticeAutoDismiss(riftAction, setRiftAction);
  useActionNoticeAutoDismiss(buildingAction, setBuildingAction);
  useActionNoticeAutoDismiss(planetManagementAction, setPlanetManagementAction);
  useActionNoticeAutoDismiss(planetRenameAction, setPlanetRenameAction);
  useActionNoticeAutoDismiss(playerProfileAction, setPlayerProfileAction);
  useActionNoticeAutoDismiss(missionAction, setMissionAction);
  useActionNoticeAutoDismiss(moonAction, setMoonAction);
  const [galaxyNav, setGalaxyNav] = useState<{ galaxy: number; system: number }>(() => {
    const routeCoords = initialSelectedCoords();
    if (routeCoords) {
      return { galaxy: routeCoords.galaxy, system: routeCoords.system };
    }
    if (planet?.coordinates) {
      const [g, s] = planet.coordinates.split(":").map(Number);
      return { galaxy: g || 1, system: s || 1 };
    }
    return { galaxy: 1, system: 1 };
  });

  const fallbackHomeCoords = useMemo<Coordinates | undefined>(() => {
    if (!planet?.coordinates) return undefined;
    const parts = planet.coordinates.split(":").map(Number);
    return {
      galaxy: parts[0] || 1,
      system: parts[1] || 1,
      position: parts[2] || 1,
    };
  }, [planet?.coordinates]);

  const homeCoords = useMemo<Coordinates | undefined>(() => {
    if (onChainSettlement?.planet) {
      return {
        galaxy: onChainSettlement.planet.galaxy,
        system: onChainSettlement.planet.system,
        position: onChainSettlement.planet.position,
      };
    }

    return fallbackHomeCoords;
  }, [fallbackHomeCoords, onChainSettlement?.planet]);
  const missionLaunchStateBlocker = missionLaunchSubmitBlocker({
    actionState: galaxyAction,
    pendingMissionLaunchCount: pendingMissionLaunches.length,
  });
  const missionActionShipyardState = useMemo(() => shipyardStateWithMissionLaunchBlocker({
    account,
    activePlanetId,
    blocker: missionLaunchStateBlocker,
    homePlanetId: onChainSettlement?.homePlanetId,
    shipyardState: shipyardStateForMissionActions({
      account,
      activePlanetId,
      homePlanetId: onChainSettlement?.homePlanetId,
      shipyardError,
      shipyardLoading,
      shipyardState,
    }),
  }), [
    account,
    activePlanetId,
    missionLaunchStateBlocker,
    onChainSettlement?.homePlanetId,
    shipyardError,
    shipyardLoading,
    shipyardState,
  ]);
  const activeShipyardProductionQueue = activeProductionQueue(shipyardState?.queue, onChainQueues?.ship, "ship");
  const activeDefenseProductionQueue = activeProductionQueue(defenseState?.queue, onChainQueues?.defense, "defense");
  const displayFleetVisibility = useMemo(
    () => mergePendingFleetVisibility(fleetVisibility, pendingMissionLaunches, account, onChainSettlement?.homePlanetId),
    [account, fleetVisibility, onChainSettlement?.homePlanetId, pendingMissionLaunches]
  );
  const displayAllActiveMissions = useMemo(
    () => mergePendingMissionLaunches(allActiveMissions, pendingMissionLaunches),
    [allActiveMissions, pendingMissionLaunches]
  );
  useEffect(() => {
    if (pendingMissionLaunches.length === 0 || !fleetVisibility) return;
    const next = reconcilePendingMissionLaunches(pendingMissionLaunches, {
      allActiveMissions: allActiveMissions ?? [],
      fleetVisibility,
    });
    if (!sameMissionIds(next, pendingMissionLaunches)) {
      setPendingMissionLaunches(next);
    }
  }, [allActiveMissions, fleetVisibility, pendingMissionLaunches]);
  const overviewFleetVisibility = useMemo(
    () => planetScopedFleetVisibility(displayFleetVisibility, activePlanetId),
    [activePlanetId, displayFleetVisibility]
  );
  const activePlanetCoords = selectedManagedPlanet
    ? {
        galaxy: selectedManagedPlanet.galaxy,
        system: selectedManagedPlanet.system,
        position: selectedManagedPlanet.position,
      }
    : homeCoords;
  const homeCoordinateLabel = useMemo(
    () => displayHomeCoordinates(homePlanetIdentity, homeCoords, planet?.coordinates),
    [
      homeCoords?.galaxy,
      homeCoords?.position,
      homeCoords?.system,
      homePlanetIdentity?.galaxy,
      homePlanetIdentity?.position,
      homePlanetIdentity?.system,
      planet?.coordinates,
    ]
  );
  const apiBaseUrl = useMemo(() => {
    return runtimeConfig.status === "ready" ? runtimeConfig.config.apiUrl : undefined;
  }, [runtimeConfig]);
  const missionUniverseLookupMissions = useMemo(() => missionArchetypeLookupMissions({
    allActiveMissions: displayAllActiveMissions,
    fleetVisibility: displayFleetVisibility,
    globalMissionArchive,
    missionArchive,
  }), [
    displayAllActiveMissions,
    displayFleetVisibility,
    globalMissionArchive,
    missionArchive,
  ]);
  const missionUniverseSystemKeys = useMemo(() =>
    missionSystemKeysMissingUniverseArchetypes(missionUniverseLookupMissions, missionPlanetArchetypesByCoordinate),
  [
    missionPlanetArchetypesByCoordinate,
    missionUniverseLookupMissions,
  ]);
  const missionUniverseSystemKey = missionUniverseSystemKeys.join("|");
  const pageStateHydrationReady = canLoadIndexedPageState({
    account,
    apiBaseUrl,
    hydratedWalletSnapshotKey,
  });
  const settlementPlanet = onChainSettlement?.planet;
  const homeGalaxyNavSyncKey = homeGalaxySystemSyncKey(homeCoords);
  const homePlanetIdentitySyncKey = homePlanetIdentityRefreshKey({
    apiBaseUrl,
    homeCoords,
    ownerDisplayName: playerProfile?.displayName,
    settlementPlanet,
  });

  const refreshMissionUniverseSystems = useCallback(async (signal?: AbortSignal) => {
    if (!apiBaseUrl || missionUniverseSystemKeys.length === 0) return;
    const apiRoot = apiBaseUrl.replace(/\/+$/, "");
    setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "galaxySystemDataByKey", {
      loading: true,
      error: undefined,
    }));
    try {
      const systems = await Promise.all(missionUniverseSystemKeys.map(async (systemKey) => {
        const [galaxy, system] = systemKey.split(":").map((part) => Number(part));
        if (!Number.isInteger(galaxy) || !Number.isInteger(system)) {
          return {
            systemKey,
            payload: undefined,
            archetypes: [] as Array<readonly [string, PlanetType]>,
          };
        }
        const response = await fetch(`${apiRoot}/universe/galaxies/${galaxy}/systems/${system}`, {
          headers: { accept: "application/json" },
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        const payload = await response.json();
        return {
          systemKey,
          payload,
          archetypes: planetsFromSystemResponse(payload).map((planet) => [
            missionPlanetCoordinateKey(planet),
            planet.type,
          ] as const),
        };
      }));
      if (signal?.aborted) return;
      setMissionPlanetArchetypesByCoordinate((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [coordinateKey, archetype] of systems.flatMap((system) => system.archetypes)) {
          if (next.get(coordinateKey) === archetype) continue;
          next.set(coordinateKey, archetype);
          changed = true;
        }
        return changed ? next : current;
      });
      setPlanetSectionStore((current) => {
        const existing = planetSectionForPlanet(current, activePlanetId).galaxySystemDataByKey ?? {};
        const nextSystems = { ...existing };
        for (const system of systems) {
          if (system.payload === undefined) continue;
          nextSystems[system.systemKey] = system.payload;
        }
        return setPlanetSectionData(current, activePlanetId, "galaxySystemDataByKey", nextSystems, {
          loading: false,
          error: undefined,
          lastSuccessfulRefreshAt: Date.now(),
        });
      });
    } catch (error) {
      if (signal?.aborted) return;
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "galaxySystemDataByKey", {
        loading: false,
        error: error instanceof Error ? error.message : "Universe system data could not be loaded.",
      }));
      throw error;
    }
  }, [activePlanetId, apiBaseUrl, missionUniverseSystemKey]);

  useEffect(() => {
    if (!apiBaseUrl || missionUniverseSystemKeys.length === 0) return;

    const abortController = new AbortController();
    refreshMissionUniverseSystems(abortController.signal).catch((error) => {
      if (!abortController.signal.aborted) console.error(error);
    });
    return () => abortController.abort();
  }, [apiBaseUrl, missionUniverseSystemKeys.length, refreshMissionUniverseSystems]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRouteChange = () => {
      replaceLegacyHashEntityRoute();
      resetDocumentTitle();
      applyInspectRoute(parseInspectRouteFromLocation(window.location));
    };
    handleRouteChange();
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);
    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("popstate", handleRouteChange);
    };

    function applyInspectRoute(route: InspectRoute) {
      setPlanetBackRoute(null);
      if (route.kind === "player") {
        setInspectedPlayerWallet(route.wallet);
        setInspectedAllianceId(null);
        setMissionDetailId(null);
        setMissionReportId(null);
        setSelectedCoords(undefined);
        setPage("player-inspect");
        return;
      }
      if (route.kind === "alliance") {
        setInspectedAllianceId(route.allianceId);
        setSelectedAllianceId(route.allianceId);
        setInspectedPlayerWallet(null);
        setMissionDetailId(null);
        setMissionReportId(null);
        setSelectedCoords(undefined);
        setPage("alliance-inspect");
        return;
      }
      if (route.kind === "mission") {
        setMissionDetailId(route.missionId);
        setInspectedPlayerWallet(null);
        setInspectedAllianceId(null);
        setMissionReportId(null);
        setSelectedCoords(undefined);
        setPage("mission-control");
        return;
      }
      if (route.kind === "mission-report") {
        setInspectedPlayerWallet(null);
        setInspectedAllianceId(null);
        setMissionDetailId(null);
        setMissionReportId(route.missionId);
        setSelectedCoords(undefined);
        setPage("mission-control");
        return;
      }
      if (route.kind === "planet") {
        setInspectedPlayerWallet(null);
        setInspectedAllianceId(null);
        setMissionDetailId(null);
        setMissionReportId(null);
        setGalaxyNav({ galaxy: route.coords.galaxy, system: route.coords.system });
        setSelectedCoords(route.coords);
        setPage("planet");
        return;
      }
      if (route.kind === "moon") {
        setInspectedPlayerWallet(null);
        setInspectedAllianceId(null);
        setMissionDetailId(null);
        setMissionReportId(null);
        setGalaxyNav({ galaxy: route.coords.galaxy, system: route.coords.system });
        setSelectedCoords(route.coords);
        setPage("moon-inspect");
        return;
      }
      setInspectedPlayerWallet(null);
      setInspectedAllianceId(null);
      setMissionDetailId(null);
      setMissionReportId(null);
      setPage(route.page);
      if (route.page !== "planet") setSelectedCoords(undefined);
    }
  }, []);

  useEffect(() => {
    setPlayerProfile(undefined);
    setPlanetSectionStore({});
    setSelectedPlanetId(undefined);
    setSelectedBodyKind("planet");
    setWalletPlanets([]);
    setOnChainQueues(undefined);
    setFleetVisibility(undefined);
    setHydratedWalletSnapshotKey(undefined);
    latestOnChainResourceSnapshot.current = { planetId: null, lastSettledAt: null };
    latestInfrastructureResourceSnapshot.current = { planetId: null, lastSettledAt: null };
    setPlayerProfileAction({ status: "idle" });
  }, [account]);

  const loadPublicBattleReports = useCallback(() => {
    if (!apiBaseUrl) {
      setPublicBattleReports([]);
      setPublicBattleReportsError("Game API is unavailable.");
      setPublicBattleReportsLoading(false);
      return;
    }

    setPublicBattleReportsLoading(true);
    setPublicBattleReportsError(undefined);
    fetchBattleReports(apiBaseUrl)
      .then((reports) => {
        setPublicBattleReports(reports);
        setPublicBattleReportsError(undefined);
      })
      .catch((error) => {
        setPublicBattleReports([]);
        setPublicBattleReportsError(error instanceof Error ? error.message : "Battle reports could not be loaded.");
      })
      .finally(() => setPublicBattleReportsLoading(false));
  }, [apiBaseUrl]);

  useEffect(() => {
    if (page !== "battle-reports") return;
    let cancelled = false;

    if (!apiBaseUrl) {
      setPublicBattleReports([]);
      setPublicBattleReportsError("Game API is unavailable.");
      setPublicBattleReportsLoading(false);
      return;
    }

    setPublicBattleReportsLoading(true);
    setPublicBattleReportsError(undefined);
    fetchBattleReports(apiBaseUrl)
      .then((reports) => {
        if (cancelled) return;
        setPublicBattleReports(reports);
        setPublicBattleReportsError(undefined);
      })
      .catch((error) => {
        if (cancelled) return;
        setPublicBattleReports([]);
        setPublicBattleReportsError(error instanceof Error ? error.message : "Battle reports could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setPublicBattleReportsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, page]);

  const loadMissionDetail = useCallback(() => {
    if (!apiBaseUrl || !missionDetailId) {
      setMissionDetail(undefined);
      setMissionDetailError(apiBaseUrl ? undefined : "Game API is unavailable.");
      setMissionDetailLoading(false);
      return;
    }

    setMissionDetailLoading(true);
    setMissionDetailError(undefined);
    fetchMission(apiBaseUrl, missionDetailId)
      .then((detail) => {
        setMissionDetail(detail);
        setMissionDetailError(undefined);
      })
      .catch((error) => {
        setMissionDetail(undefined);
        setMissionDetailError(error instanceof Error ? error.message : "Mission could not be loaded.");
      })
      .finally(() => setMissionDetailLoading(false));
  }, [apiBaseUrl, missionDetailId]);

  // VEY-KANEO-433: background refresh for the *open* mission detail. The auto-poll/ETA one-shot keep
  // the Mission Control lists live, but a viewer sitting on a battle report (`#/mission/<id>` or the
  // legacy `#/battle-report/<id>`) when the mission resolves would still see stale loot / "no battle
  // report yet" until a manual Refresh — exactly the gap this ticket targets. Unlike `loadMissionDetail`
  // (the manual Refresh button), this never toggles the loading spinner and never clobbers the rendered
  // detail or surfaces an error on a transient poll failure, so the page updates silently in place.
  const refreshOpenMissionDetailSilently = useCallback(async () => {
    if (!apiBaseUrl || !missionDetailId) return;
    try {
      const detail = await fetchMission(apiBaseUrl, missionDetailId);
      setMissionDetail(detail);
      setMissionDetailError(undefined);
    } catch {
      // Keep the last-rendered detail on a transient background failure; the next tick retries.
    }
  }, [apiBaseUrl, missionDetailId]);

  useEffect(() => {
    if (!missionDetailId) return;
    let cancelled = false;

    if (!apiBaseUrl) {
      setMissionDetail(undefined);
      setMissionDetailError("Game API is unavailable.");
      setMissionDetailLoading(false);
      return;
    }

    setMissionDetailLoading(true);
    setMissionDetailError(undefined);
    fetchMission(apiBaseUrl, missionDetailId)
      .then((detail) => {
        if (cancelled) return;
        setMissionDetail(detail);
        setMissionDetailError(undefined);
      })
      .catch((error) => {
        if (cancelled) return;
        setMissionDetail(undefined);
        setMissionDetailError(error instanceof Error ? error.message : "Mission could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setMissionDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, missionDetailId]);

  useEffect(() => {
    if (!apiBaseUrl || !missionDetailId || !shouldPollPendingMissionReport(missionDetail)) {
      return;
    }

    let refreshInFlight = false;
    const pollPendingReport = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (refreshInFlight || !shouldPollPendingMissionReport(missionDetail)) {
        return;
      }
      refreshInFlight = true;
      fetchMission(apiBaseUrl, missionDetailId)
        .then((detail) => {
          setMissionDetail(detail);
          setMissionDetailError(undefined);
        })
        .catch(() => {
          // Keep the visible mission detail while the generator is still catching up.
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };

    const interval = window.setInterval(pollPendingReport, MISSION_REPORT_PENDING_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [apiBaseUrl, missionDetail, missionDetailId]);

  // Close the battle-report share dialog whenever the viewer moves to a different mission so a stale
  // link is never left open.
  useEffect(() => {
    setShareDialogUrl(null);
  }, [missionDetailId]);

  const refreshPlayerProfile = useCallback(async () => {
    if (!apiBaseUrl || !account) {
      setPlayerProfile(undefined);
      return;
    }

    try {
      const profile = await fetchPlayerProfile(apiBaseUrl, account);
      setPlayerProfile((current) => mergePlayerProfile(current, profile));
    } catch (error) {
      console.error(error);
    }
  }, [account, apiBaseUrl]);

  useEffect(() => {
    void refreshPlayerProfile();
  }, [refreshPlayerProfile]);

  useEffect(() => {
    setWatchedPlanetsPage(1);
  }, [account]);

  const refreshWatchedPlanets = useCallback(async (page = watchedPlanetsPage) => {
    if (!apiBaseUrl || !account) {
      setWatchedPlanets(undefined);
      setWatchedPlanetsError(undefined);
      setWatchedPlanetsLoading(false);
      return;
    }

    setWatchedPlanetsLoading(true);
    setWatchedPlanetsError(undefined);
    try {
      const response = await fetchWatchedPlanets(apiBaseUrl, account, { page, pageSize: 25 });
      setWatchedPlanets(response);
    } catch (error) {
      console.error(error);
      setWatchedPlanetsError(walletRequestErrorMessage(error));
    } finally {
      setWatchedPlanetsLoading(false);
    }
  }, [account, apiBaseUrl, watchedPlanetsPage]);

  useEffect(() => {
    void refreshWatchedPlanets(watchedPlanetsPage);
  }, [refreshWatchedPlanets, watchedPlanetsPage]);

  const handleToggleWatchPlanet = useCallback(async (planetId: string, watched: boolean) => {
    if (!apiBaseUrl || !account || !provider) return;
    setWatchBusyPlanetId(planetId);
    setWatchedPlanetsError(undefined);
    try {
      const result = watched
        ? await unwatchPlanet(apiBaseUrl, provider, account, planetId)
        : await watchPlanet(apiBaseUrl, provider, account, planetId);
      setWatchedPlanets((current) => current
        ? { ...current, watchedPlanetIds: result.watchedPlanetIds }
        : current
      );
      const nextPage = nextWatchedPlanetsPageAfterToggle({
        currentPage: watchedPlanetsPage,
        currentPagePlanetCount: watchedPlanets?.planets.length ?? 0,
        wasWatched: watched,
      });
      if (nextPage !== watchedPlanetsPage) {
        setWatchedPlanetsPage(nextPage);
      } else {
        await refreshWatchedPlanets(nextPage);
      }
    } catch (error) {
      console.error(error);
      setWatchedPlanetsError(walletRequestErrorMessage(error));
    } finally {
      setWatchBusyPlanetId(undefined);
    }
  }, [account, apiBaseUrl, provider, refreshWatchedPlanets, watchedPlanets?.planets.length, watchedPlanetsPage]);

  const onChainResources = useMemo(() => {
    if (!onChainSettlement?.planet) return undefined;
    const settlementResources = onChainSettlement.planet.resourcesAsOfNow ?? onChainSettlement.planet.resources;
    const metal = safeResourceNumber(settlementResources.metal);
    const crystal = safeResourceNumber(settlementResources.crystal);
    const deuterium = safeResourceNumber(settlementResources.deuterium);
    if (metal === undefined || crystal === undefined || deuterium === undefined) return undefined;

    return {
      metal,
      crystal,
      deuterium,
    };
  }, [onChainSettlement]);
  const walletPlanetHydrated = isWalletPlanetHydrated({
    homeCoords,
    isWalletConnected,
    resources: onChainResources,
    settlement: onChainSettlement,
    status: onChainStatus,
  });

  const gameContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? gameContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const allianceContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? allianceContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const moonContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? moonContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const chickenBurnConfig = useMemo(() => {
    return runtimeConfig.status === "ready" ? burningChickenConfig(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const gameActionInputsAvailable = gameActionsAvailableForBody(activeBodyKind, Boolean(provider && account && gameContract && (activePlanetId ?? onChainSettlement?.homePlanetId)));
  const allianceActionInputsAvailable = Boolean(provider && account && allianceContract);
  const moonActionInputsAvailable = Boolean(provider && account && moonContract && (activePlanetId ?? onChainSettlement?.homePlanetId));

  useEffect(() => {
    if (!gameActionInputsAvailable) return;
    setBuildingAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setDefenseAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setShipyardAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setGalaxyAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setResearchAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setRiftAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setMissionAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setPlanetManagementAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setPlanetRenameAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [gameActionInputsAvailable, transactionActionPending]);

  useEffect(() => {
    if (!allianceActionInputsAvailable) return;
    setAllianceAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [allianceActionInputsAvailable, transactionActionPending]);

  useEffect(() => {
    if (!moonActionInputsAvailable) return;
    setMoonAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [moonActionInputsAvailable, transactionActionPending]);

  const confirmSubmittedTransaction = useCallback(async (txHash: string) => {
    if (!provider) {
      throw new Error("Wallet provider is unavailable while confirming the transaction.");
    }
    await confirmTransactionReceipt(provider, txHash);
  }, [provider]);

  const refreshInfrastructureState = useCallback(async () => {
    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    if (!apiBaseUrl || !account) {
      latestInfrastructureResourceSnapshot.current = { planetId: null, lastSettledAt: null };
      setInfrastructureChainState(null);
      setMoonState(null);
      setInfrastructureLoading(false);
      setMoonLoading(false);
      setPlanetSectionStore((current) => {
        let next = setPlanetSectionStatus(current, activePlanetId, "infrastructureChainState", { loading: false, error: undefined });
        next = setPlanetSectionStatus(next, activePlanetId, "moonState", { loading: false, error: undefined });
        return next;
      });
      return;
    }

    const shouldShowInfrastructureLoading = !infrastructureChainState;
    const shouldShowMoonLoading = !moonState;
    setInfrastructureLoading(shouldShowInfrastructureLoading);
    setMoonLoading(shouldShowMoonLoading);
    setInfrastructureError(undefined);
    setMoonError(undefined);
    setPlanetSectionStore((current) => {
      let next = setPlanetSectionStatus(current, activePlanetId, "infrastructureChainState", { loading: shouldShowInfrastructureLoading, error: undefined });
      next = setPlanetSectionStatus(next, activePlanetId, "moonState", { loading: shouldShowMoonLoading, error: undefined });
      return next;
    });
    try {
      const [infrastructureResult, moonResult] = await Promise.all([
        settlePromise(fetchInfrastructureState(apiBaseUrl, account, activePlanetId)),
        settlePromise(fetchMoonState(apiBaseUrl, account, activePlanetId)),
      ]);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return;
      if (infrastructureResult.status === "fulfilled") {
        const nextInfrastructure = infrastructureResult.value;
        const nextFreshness = resourceSnapshotFreshnessForInfrastructure(nextInfrastructure);
        latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
          latestInfrastructureResourceSnapshot.current,
          nextFreshness,
        );
        setInfrastructureChainState((current) => infrastructureStateForRefreshApplication({
          applyResourceState: true,
          current,
          next: nextInfrastructure,
        }));
        setActivePlanetSectionStatus("infrastructureChainState", {
          loading: false,
          error: undefined,
          lastSuccessfulRefreshAt: Date.now(),
        });
      } else {
        console.error(infrastructureResult.reason);
        const message = infrastructureResult.reason instanceof Error ? infrastructureResult.reason.message : "Infrastructure state could not be loaded.";
        setInfrastructureError(message);
        setActivePlanetSectionStatus("infrastructureChainState", { loading: false, error: message });
      }
      if (moonResult.status === "fulfilled") {
        setMoonState(moonResult.value);
        setActivePlanetSectionStatus("moonState", {
          loading: false,
          error: undefined,
          lastSuccessfulRefreshAt: Date.now(),
        });
      } else {
        console.error(moonResult.reason);
        const message = moonResult.reason instanceof Error ? moonResult.reason.message : "Moon state could not be loaded.";
        setMoonError(message);
        setActivePlanetSectionStatus("moonState", { loading: false, error: message });
      }
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
        setMoonLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, infrastructureChainState, moonState]);

  const refreshLiveInfrastructureState = useCallback(async () => {
    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    if (!apiBaseUrl || !account) {
      latestInfrastructureResourceSnapshot.current = { planetId: null, lastSettledAt: null };
      setInfrastructureChainState(null);
      setActivePlanetSectionStatus("infrastructureChainState", { loading: false, error: undefined });
      return null;
    }

    const shouldShowInfrastructureLoading = !infrastructureChainState;
    setInfrastructureLoading(shouldShowInfrastructureLoading);
    setInfrastructureError(undefined);
    setActivePlanetSectionStatus("infrastructureChainState", { loading: shouldShowInfrastructureLoading, error: undefined });
    try {
      const nextInfrastructure = await fetchInfrastructureState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return nextInfrastructure;
      const nextFreshness = resourceSnapshotFreshnessForInfrastructure(nextInfrastructure);
      latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestInfrastructureResourceSnapshot.current,
        nextFreshness,
      );
      setInfrastructureChainState((current) => infrastructureStateForRefreshApplication({
        applyResourceState: true,
        current,
        next: nextInfrastructure,
      }));
      setActivePlanetSectionStatus("infrastructureChainState", {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: Date.now(),
      });
      return nextInfrastructure;
    } catch (error) {
      console.error(error);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) throw error;
      const message = error instanceof Error ? error.message : "Infrastructure state could not be loaded.";
      setInfrastructureError(message);
      setActivePlanetSectionStatus("infrastructureChainState", { loading: false, error: message });
      throw error;
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, infrastructureChainState]);

  const refreshDefenseState = useCallback(async () => {
    const requestId = beginRefreshRequest(defenseRefreshGate);
    if (!apiBaseUrl || !account) {
      setDefenseState(null);
      setDefenseLoading(false);
      setActivePlanetSectionStatus("defenseState", { loading: false, error: undefined });
      return null;
    }

    setDefenseLoading(true);
    setDefenseError(undefined);
    setActivePlanetSectionStatus("defenseState", { loading: true, error: undefined });
    try {
      const next = await fetchDefenseState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(defenseRefreshGate, requestId)) return next;
      setDefenseState(next);
      setActivePlanetSectionStatus("defenseState", {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: Date.now(),
      });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(defenseRefreshGate, requestId)) {
        const message = error instanceof Error ? error.message : "Defense state could not be loaded.";
        setDefenseError(message);
        setActivePlanetSectionStatus("defenseState", { loading: false, error: message });
      }
      return null;
    } finally {
      if (canApplyRefreshRequest(defenseRefreshGate, requestId)) {
        setDefenseLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshAllianceState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setAllianceState(null);
      return Promise.resolve(null);
    }

    setAllianceLoading(true);
    setAllianceError(undefined);
    return fetchAllianceState(apiBaseUrl, account)
      .then((next) => {
        setAllianceState(next);
        return next;
      })
      .catch((error) => {
        console.error(error);
        setAllianceError(error instanceof Error ? error.message : "Alliance state could not be loaded.");
        return null;
      })
      .finally(() => {
        setAllianceLoading(false);
      });
  }, [account, apiBaseUrl]);

  const refreshShipyardState = useCallback(async (options: { clearCachedState?: boolean } = {}) => {
    const requestId = beginRefreshRequest(shipyardRefreshGate);
    if (!apiBaseUrl || !account) {
      setShipyardState(null);
      setShipyardLoading(false);
      setActivePlanetSectionStatus("shipyardState", { loading: false, error: undefined });
      return null;
    }

    setShipyardLoading(true);
    setShipyardError(undefined);
    setActivePlanetSectionStatus("shipyardState", { loading: true, error: undefined });
    if (options.clearCachedState) {
      setShipyardState(null);
    }
    try {
      const next = await fetchShipyardState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(shipyardRefreshGate, requestId)) return next;
      setShipyardState(next);
      setActivePlanetSectionStatus("shipyardState", {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: Date.now(),
      });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(shipyardRefreshGate, requestId)) {
        const message = error instanceof Error ? error.message : "Shipyard state could not be loaded.";
        setShipyardError(message);
        setActivePlanetSectionStatus("shipyardState", { loading: false, error: message });
      }
      return null;
    } finally {
      if (canApplyRefreshRequest(shipyardRefreshGate, requestId)) {
        setShipyardLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshResearchState = useCallback(async () => {
    const requestId = beginRefreshRequest(researchRefreshGate);
    if (!apiBaseUrl || !account) {
      setResearchState(null);
      setResearchLoading(false);
      setActivePlanetSectionStatus("researchState", { loading: false, error: undefined });
      return null;
    }

    const shouldShowBlockingLoading = !researchState;
    setResearchLoading(shouldShowBlockingLoading);
    setResearchError(undefined);
    setActivePlanetSectionStatus("researchState", { loading: shouldShowBlockingLoading, error: undefined });
    try {
      const next = await fetchResearchState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(researchRefreshGate, requestId)) return next;
      setResearchState(next);
      setActivePlanetSectionStatus("researchState", {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: Date.now(),
      });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(researchRefreshGate, requestId)) {
        const message = error instanceof Error ? error.message : "Research state could not be loaded.";
        setResearchError(message);
        setActivePlanetSectionStatus("researchState", { loading: false, error: message });
      }
      return null;
    } finally {
      if (canApplyRefreshRequest(researchRefreshGate, requestId)) {
        setResearchLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, researchState]);

  const refreshRiftState = useCallback(async () => {
    const requestId = beginRefreshRequest(riftRefreshGate);
    if (!apiBaseUrl || !account) {
      setRiftState(null);
      setRiftLoading(false);
      setActivePlanetSectionStatus("riftState", { loading: false, error: undefined });
      return null;
    }

    setRiftLoading(true);
    setRiftError(undefined);
    setActivePlanetSectionStatus("riftState", { loading: true, error: undefined });
    try {
      const next = await fetchRiftState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(riftRefreshGate, requestId)) return next;
      setRiftState(next);
      setActivePlanetSectionStatus("riftState", {
        loading: false,
        error: undefined,
        lastSuccessfulRefreshAt: Date.now(),
      });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(riftRefreshGate, requestId)) {
        const message = error instanceof Error ? error.message : "Rift state could not be loaded.";
        setRiftError(message);
        setActivePlanetSectionStatus("riftState", { loading: false, error: message });
      }
      return null;
    } finally {
      if (canApplyRefreshRequest(riftRefreshGate, requestId)) {
        setRiftLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, onChainQueues?.research]);

  const refreshOnChainState = useCallback(async (
    renameExpectation?: { planetId: string; name: string },
    options: { force?: boolean; forceHomePlanet?: boolean; forceWalletPlanets?: boolean } = {},
  ) => {
    const requestId = beginRefreshRequest(onChainRefreshGate);
    if (!apiBaseUrl || !account) {
      latestOnChainResourceSnapshot.current = { planetId: null, lastSettledAt: null };
      applyOnChainSettlementSnapshot(undefined);
      setWalletPlanets([]);
      setOnChainQueues(undefined);
      setFleetVisibility(undefined);
      setOnChainError(undefined);
      setOnChainStatus(isWalletConnected ? "loading" : "local");
      setHydratedWalletSnapshotKey(undefined);
      return;
    }

    const hasUsableOnChainState = Boolean(onChainSettlementState || walletPlanets.length > 0 || onChainQueues);
    setOnChainStatus((current) => globalReadStatusDuringRefresh(current, hasUsableOnChainState));
    setPlanetSectionStore((current) => {
      let next = setPlanetSectionStatus(current, activePlanetId, "settlementState", { loading: true, error: undefined });
      next = setPlanetSectionStatus(next, activePlanetId, "queuesState", { loading: true, error: undefined });
      return setPlanetSectionStatus(next, activePlanetId, "fleetVisibilityState", { loading: true, error: undefined });
    });
    try {
      const canUseCachedWalletPlanets =
        hydratedWalletSnapshotKey === walletSnapshotHydrationKey(apiBaseUrl, account);
      const walletPlanetsForRead = canUseCachedWalletPlanets ? walletPlanets : [];
      const homePlanetIdForRead = canUseCachedWalletPlanets ? onChainSettlementState?.homePlanetId : undefined;
      const readPlanetId = selectedPlanetIdForWalletRead({
        activePlanetId: options.forceHomePlanet || options.forceWalletPlanets || !canUseCachedWalletPlanets ? undefined : activePlanetId,
        homePlanetId: homePlanetIdForRead,
        walletPlanets: walletPlanetsForRead,
      });
      const loadSnapshot = () => loadWalletPlanetSyncSnapshot(
        apiBaseUrl,
        account,
        readPlanetId,
        {
          ...(options.forceHomePlanet === undefined ? {} : { forceHomePlanet: options.forceHomePlanet }),
          ...(options.forceWalletPlanets === undefined ? {} : { forceWalletPlanets: options.forceWalletPlanets }),
        },
      );
      const snapshot = renameExpectation
        ? await waitForRenamedWalletPlanet(loadSnapshot, renameExpectation)
        : await waitForHydratedWalletPlanet(loadSnapshot, readPlanetId);
      const { planetsResponse, queues, settlement, selectedPlanet, fleetVisibility } = snapshot;
      const planets = planetsResponse.planets;
      const nextSettlement = selectedPlanet
        ? {
            ...settlement,
            homePlanetId: selectedPlanet.planetId,
            planet: selectedPlanet,
          }
        : settlement;
      if (!canApplyRefreshRequest(onChainRefreshGate, requestId)) {
        return;
      }
      const nextFreshness = resourceSnapshotFreshnessForSettlement(nextSettlement);
      const plan = planOnChainRefresh(latestOnChainResourceSnapshot.current, nextFreshness, options);
      // Successful wallet sync reads are authoritative for queues and fleet visibility.
      if (plan.applyQueues) {
        setOnChainQueues(queues);
        setFleetVisibility(fleetVisibility);
        setOnChainError(undefined);
        setOnChainStatus("ready");
      }
      if (!plan.applyResourceState) {
        return;
      }
      latestOnChainResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestOnChainResourceSnapshot.current,
        nextFreshness,
      );
      setWalletPlanets(planets);
      const nextSelectedPlanetId = selectedPlanetIdFromRoster({
        homePlanetId: nextSettlement.homePlanetId,
        planets,
        selectedPlanetId: options.forceHomePlanet ? undefined : selectedPlanetId,
      });
      if (nextSelectedPlanetId !== selectedPlanetId) {
        setSelectedPlanetId(nextSelectedPlanetId);
      }
      applyOnChainSettlementSnapshot(nextSettlement);
      setPlayerProfile((current) => mergePlayerProfile(current, nextSettlement.player ?? planetsResponse.player));
      setHydratedWalletSnapshotKey(walletSnapshotHydrationKey(apiBaseUrl, account));
    } catch (error) {
      if (!canApplyRefreshRequest(onChainRefreshGate, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to load live game state";
      setOnChainError(message);
      setOnChainStatus((current) => hasUsableOnChainState && current !== "local" ? current : "error");
      setPlanetSectionStore((current) => {
        let next = setPlanetSectionStatus(current, activePlanetId, "settlementState", { loading: false, error: message });
        next = setPlanetSectionStatus(next, activePlanetId, "queuesState", { loading: false, error: message });
        return setPlanetSectionStatus(next, activePlanetId, "fleetVisibilityState", { loading: false, error: message });
      });
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, hydratedWalletSnapshotKey, isWalletConnected, onChainQueues, onChainSettlementState, onChainSettlementState?.homePlanetId, selectedPlanetId, walletPlanets]);

  const loadMissionArchive = useCallback(async (page: number) => {
    if (!apiBaseUrl || !account) {
      setMissionArchive(undefined);
      setMissionArchiveError(undefined);
      setMissionArchiveLoading(false);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "missionArchiveState", {
        loading: false,
        error: undefined,
      }));
      return;
    }

    setMissionArchiveLoading(true);
    setMissionArchiveError(undefined);
    setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "missionArchiveState", {
      loading: true,
      error: undefined,
    }));
    try {
      const nextArchive = await fetchFleetMissionArchive(apiBaseUrl, account, { missionNumber: missionNumberArchiveQuery, page, pageSize: 25 });
      setMissionArchive(nextArchive);
      setMissionArchivePage(nextArchive.pagination.page);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Mission archive could not be loaded.";
      setMissionArchiveError(message);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "missionArchiveState", {
        loading: false,
        error: message,
      }));
    } finally {
      setMissionArchiveLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, missionNumberArchiveQuery, setMissionArchive]);

  const loadIncomingAttackArchive = useCallback(async (page: number) => {
    if (!apiBaseUrl || !account) {
      setIncomingAttackArchive(undefined);
      setIncomingAttackArchiveError(undefined);
      setIncomingAttackArchiveLoading(false);
      return;
    }

    setIncomingAttackArchiveLoading(true);
    setIncomingAttackArchiveError(undefined);
    try {
      const nextArchive = await fetchFleetMissionArchive(apiBaseUrl, account, { filter: "incomingAttacks", missionNumber: missionNumberArchiveQuery, page, pageSize: 25 });
      setIncomingAttackArchive(nextArchive);
      setIncomingAttackArchivePage(nextArchive.pagination.page);
    } catch (error) {
      console.error(error);
      setIncomingAttackArchiveError(error instanceof Error ? error.message : "Incoming attack archive could not be loaded.");
    } finally {
      setIncomingAttackArchiveLoading(false);
    }
  }, [account, apiBaseUrl, missionNumberArchiveQuery]);

  const loadAllActiveMissions = useCallback(async () => {
    if (!apiBaseUrl) {
      setAllActiveMissions(undefined);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "allActiveMissionsState", {
        loading: false,
        error: undefined,
      }));
      return;
    }
    setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "allActiveMissionsState", {
      loading: true,
      error: undefined,
    }));
    try {
      const response = await fetchGlobalActiveMissions(apiBaseUrl);
      setAllActiveMissions(response.missions);
    } catch (error) {
      console.error(error);
      // The "All" active tab is supplementary; failing to load it must not break My missions/Alliance.
      setAllActiveMissions([]);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "allActiveMissionsState", {
        loading: false,
        error: error instanceof Error ? error.message : "Active missions could not be loaded.",
      }));
    }
  }, [activePlanetId, apiBaseUrl, setAllActiveMissions]);

  const loadMissionLaunchSnapshot = useCallback(async (): Promise<MissionLaunchSnapshot> => {
    if (!apiBaseUrl || !account) {
      throw new Error("Wallet or game API is unavailable while syncing the launched mission.");
    }
    const [fleetVisibility, allActiveMissionsResult] = await Promise.all([
      fetchFleetMissionVisibility(apiBaseUrl, account, { includeArchive: false }),
      settlePromise(fetchGlobalActiveMissions(apiBaseUrl)),
    ]);
    return {
      allActiveMissions: allActiveMissionsResult.status === "fulfilled" ? allActiveMissionsResult.value.missions : [],
      fleetVisibility,
    };
  }, [account, apiBaseUrl]);

  const loadGlobalMissionArchive = useCallback(async (page: number) => {
    if (!apiBaseUrl) {
      setGlobalMissionArchive(undefined);
      setGlobalMissionArchiveError(undefined);
      setGlobalMissionArchiveLoading(false);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "globalMissionArchiveState", {
        loading: false,
        error: undefined,
      }));
      return;
    }

    setGlobalMissionArchiveLoading(true);
    setGlobalMissionArchiveError(undefined);
    setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "globalMissionArchiveState", {
      loading: true,
      error: undefined,
    }));
    try {
      const nextArchive = await fetchGlobalMissionArchive(apiBaseUrl, { missionNumber: missionNumberArchiveQuery, page, pageSize: 25 });
      setGlobalMissionArchive(nextArchive);
      setGlobalMissionArchivePage(nextArchive.pagination.page);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Universe mission archive could not be loaded.";
      setGlobalMissionArchiveError(message);
      setPlanetSectionStore((current) => setPlanetSectionStatus(current, activePlanetId, "globalMissionArchiveState", {
        loading: false,
        error: message,
      }));
    } finally {
      setGlobalMissionArchiveLoading(false);
    }
  }, [activePlanetId, apiBaseUrl, missionNumberArchiveQuery, setGlobalMissionArchive]);

  useEffect(() => {
    if (page === "mission-control") {
      void loadMissionArchive(1);
      void loadIncomingAttackArchive(1);
      void loadAllActiveMissions();
      void loadGlobalMissionArchive(1);
    }
  }, [account, apiBaseUrl, loadAllActiveMissions, loadGlobalMissionArchive, loadIncomingAttackArchive, loadMissionArchive, page]);

  // VEY-KANEO-445: the Rankings page shows each planet's active inbound/outbound fleet missions as
  // subtext. Load the universe-wide active feed when Rankings opens and poll it on the shared cadence
  // so the subtext (and its live ETAs) stays current without a manual refresh. Full transparency
  // (decision #9978) — the feed is unfiltered by viewer, so this runs even without a connected wallet.
  // The 1s `now` ticker animates the countdowns between polls; polling refreshes which missions exist.
  // VEY-KANEO-448: the Raid Target Finder shows the same per-planet subtext, so it shares this feed/poll.
  useEffect(() => {
    if (!apiBaseUrl || (page !== "rankings" && page !== "raid-target-finder")) {
      return;
    }
    void loadAllActiveMissions();
    let refreshInFlight = false;
    const pollActiveMissions = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      loadAllActiveMissions().finally(() => {
        refreshInFlight = false;
      });
    };
    const interval = window.setInterval(pollActiveMissions, TOP_BAR_RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [apiBaseUrl, loadAllActiveMissions, page]);

  // VEY-KANEO-433: refreshes the full Mission Control data set — fleet visibility (active missions +
  // battle reports) plus the wallet/global past-mission archives and the universe-wide active feed.
  // Returns a promise so the auto-poll can guard against overlapping refreshes; the manual Refresh
  // button passes it as a void `onRefresh` and ignores the result (behavior unchanged).
  const refreshMissionControl = useCallback(async () => {
    await Promise.allSettled([
      refreshOnChainState(),
      loadMissionArchive(missionArchivePage),
      loadIncomingAttackArchive(incomingAttackArchivePage),
      loadAllActiveMissions(),
      loadGlobalMissionArchive(globalMissionArchivePage),
    ]);
  }, [globalMissionArchivePage, incomingAttackArchivePage, loadAllActiveMissions, loadGlobalMissionArchive, loadIncomingAttackArchive, loadMissionArchive, missionArchivePage, refreshOnChainState]);

  const refreshFinishedBuildingState = useCallback(async (expectation: FinishedBuildingExpectation): Promise<boolean> => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await refreshOnChainState();
      await refreshInfrastructureState();
      return true;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setInfrastructureLoading(true);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForFinishedBuildingState(
        async () => {
          const [settlement, queues, infrastructure] = await Promise.all([
            fetchWalletSettlement(apiBaseUrl, account),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
            fetchInfrastructureState(apiBaseUrl, account, activePlanetId),
          ]);

          return { settlement, queues, infrastructure };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
      markFreshStateWrite(onChainRefreshGate);
      markFreshStateWrite(infrastructureRefreshGate);
      latestOnChainResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestOnChainResourceSnapshot.current,
        resourceSnapshotFreshnessForSettlement(snapshot.settlement),
      );
      latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestInfrastructureResourceSnapshot.current,
        resourceSnapshotFreshnessForInfrastructure(snapshot.infrastructure),
      );
      applyOnChainSettlementSnapshot(snapshot.settlement);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
      setInfrastructureChainState(snapshot.infrastructure);
      setInfrastructureError(undefined);
      setWalletPlanets((current) => current.map((planet) => {
        if (planet.planetId !== (activePlanetId ?? snapshot.infrastructure.homePlanetId)) return planet;

        return {
          ...planet,
          fieldsUsed: usedFieldsFromBuildings(infrastructurePlayableState(snapshot.infrastructure).buildings),
          fieldsCapacity: snapshot.settlement.planet?.planetId === planet.planetId
            ? snapshot.settlement.planet.fields
            : planet.fieldsCapacity,
        };
      }));
      return true;
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
      const message = error instanceof Error ? error.message : "Failed to load completed building state.";
      if (isTransientGameStateReadFailure(error) && infrastructureChainState) {
        setOnChainError(undefined);
        setOnChainStatus("ready");
        setInfrastructureError(message);
        return false;
      }

      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setInfrastructureError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
        setInfrastructureLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, infrastructureChainState, refreshInfrastructureState, refreshOnChainState]);

  const refreshStartedDefenseProductionState = useCallback(async (expectation: StartedDefenseProductionExpectation) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshDefenseState(),
        refreshOnChainState(),
      ]);
      return;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setDefenseLoading(true);
    setDefenseError(undefined);

    try {
      const snapshot = await waitForStartedDefenseProductionState(
        async () => {
          const [defense, queues] = await Promise.all([
            fetchDefenseState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
          ]);

          return { defense, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      setDefenseState(snapshot.defense);
      setDefenseError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const message = error instanceof Error ? error.message : "Failed to load started defense production state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setDefenseError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
        setDefenseLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshDefenseState, refreshOnChainState]);

  const refreshStartedShipProductionState = useCallback(async (expectation: StartedShipProductionExpectation) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshShipyardState(),
        refreshOnChainState(),
      ]);
      return;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setShipyardLoading(true);
    setShipyardError(undefined);

    try {
      const snapshot = await waitForStartedShipProductionState(
        async () => {
          const [shipyard, queues] = await Promise.all([
            fetchShipyardState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
          ]);

          return { shipyard, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      setShipyardState(snapshot.shipyard);
      setShipyardError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const message = error instanceof Error ? error.message : "Failed to load started ship production state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setShipyardError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
        setShipyardLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshOnChainState, refreshShipyardState]);

  const refreshStartedResearchState = useCallback(async (expectation: StartedResearchExpectation) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshResearchState(),
        refreshOnChainState(),
      ]);
      return;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setResearchLoading(false);
    setResearchError(undefined);

    try {
      const snapshot = await waitForStartedResearchState(
        async () => {
          const [research, queues] = await Promise.all([
            fetchResearchState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
          ]);

          return { research, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      setResearchState(snapshot.research);
      setResearchError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const message = error instanceof Error ? error.message : "Failed to load started research state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setResearchError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
        setResearchLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshOnChainState, refreshResearchState]);

  const refreshStartedBuildingState = useCallback(async (expectation: StartedBuildingExpectation) => {
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshOnChainState(),
        refreshInfrastructureState(),
      ]);
      return;
    }

    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setInfrastructureLoading(true);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForStartedBuildingState(
        async () => {
          const [infrastructure, queues, planetsResponse] = await Promise.all([
            fetchInfrastructureState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
            fetchWalletPlanets(apiBaseUrl, account).catch(() => undefined),
          ]);

          return { infrastructure, planetsResponse, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return;
      latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestInfrastructureResourceSnapshot.current,
        resourceSnapshotFreshnessForInfrastructure(snapshot.infrastructure),
      );
      const walletPlanetQueue = startedBuildingQueueFromWalletPlanets(snapshot.planetsResponse, expectation);
      const visibleBuildingQueue = snapshot.infrastructure.queue?.active
        ? snapshot.infrastructure.queue
        : walletPlanetQueue ?? snapshot.queues.building;
      setInfrastructureChainState(snapshot.infrastructure);
      if (snapshot.planetsResponse) {
        setWalletPlanets(snapshot.planetsResponse.planets);
      }
      setOnChainQueues(visibleBuildingQueue === snapshot.queues.building
        ? snapshot.queues
        : { ...snapshot.queues, building: visibleBuildingQueue ?? null });
      setOnChainError(undefined);
      setOnChainStatus("ready");
      // Reconcile the settlement snapshot so the top-bar resources reflect the
      // amount just spent on the upgrade. The queue poll above confirms the
      // indexer has caught up; awaiting this keeps the global transaction gate
      // closed until the forced post-spend read finishes.
      await refreshOnChainState(undefined, { force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load started building state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setInfrastructureError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshInfrastructureState, refreshOnChainState]);

  const refreshFinishedResearchState = useCallback(async (expectation: FinishedResearchExpectation) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshResearchState(),
        refreshOnChainState(),
      ]);
      return;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setResearchLoading(false);
    setResearchError(undefined);

    try {
      const snapshot = await waitForFinishedResearchState(
        async () => {
          const [research, queues] = await Promise.all([
            fetchResearchState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
          ]);

          return { research, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      setResearchState(snapshot.research);
      setResearchError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const message = error instanceof Error ? error.message : "Failed to load finished research state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setResearchError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
        setResearchLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshOnChainState, refreshResearchState]);

  useEffect(() => {
    if (homeCoords) {
      setGalaxyNav({ galaxy: homeCoords.galaxy, system: homeCoords.system });
    }
  }, [homeGalaxyNavSyncKey]);

  useEffect(() => {
    if (!homeCoords) {
      setHomePlanetIdentity(undefined);
      return;
    }

    if (!apiBaseUrl) {
      setHomePlanetIdentity(namedSettlementPlanet(
        settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined,
        settlementPlanet?.name,
        playerProfile?.displayName,
      ));
      return;
    }

    const abortController = new AbortController();
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${homeCoords.galaxy}/systems/${homeCoords.system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe system failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const systemPlanet = rememberGalaxySystemPayload(apiBaseUrl, homeCoords.galaxy, homeCoords.system, payload)
          .find((item) => item.position === homeCoords.position);
        const basePlanet = systemPlanet ?? (settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined);
        const mergedPlanet = basePlanet && settlementPlanet
          ? mergePlanetWithSettlement(basePlanet, settlementPlanet)
          : basePlanet;
        setHomePlanetIdentity(namedSettlementPlanet(mergedPlanet, settlementPlanet?.name, playerProfile?.displayName));
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setHomePlanetIdentity(namedSettlementPlanet(
            settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined,
            settlementPlanet?.name,
            playerProfile?.displayName,
          ));
        }
      });

    return () => abortController.abort();
  }, [homePlanetIdentitySyncKey]);

  const initialPageRefreshRef = useRef({
    refreshInfrastructureState,
    refreshOnChainState,
  });
  initialPageRefreshRef.current = {
    refreshInfrastructureState,
    refreshOnChainState,
  };

  useEffect(() => {
    void initialPageRefreshRef.current.refreshOnChainState();
  }, [account, activePlanetId, apiBaseUrl]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    void initialPageRefreshRef.current.refreshInfrastructureState();
  }, [account, activePlanetId, apiBaseUrl, pageStateHydrationReady]);

  const chainEventRefreshRef = useRef({
    page,
    refreshAllianceState,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
  });
  chainEventRefreshRef.current = {
    page,
    refreshAllianceState,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
  };

  useEffect(() => {
    if (!apiBaseUrl || !account || typeof window.EventSource === "undefined") {
      setChainSyncHealthy(false);
      return;
    }

    const events = new window.EventSource(`${apiBaseUrl.replace(/\/+$/, "")}/chain/events`);
    let refreshTimer: number | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    let forceWalletPlanetsRefreshQueued = false;

    const runChainEventRefresh = () => {
      const {
        page: currentPage,
        refreshAllianceState: refreshAllianceStateFromEvent,
        refreshDefenseState: refreshDefenseStateFromEvent,
        refreshInfrastructureState: refreshInfrastructureStateFromEvent,
        refreshOnChainState: refreshOnChainStateFromEvent,
        refreshResearchState: refreshResearchStateFromEvent,
        refreshRiftState: refreshRiftStateFromEvent,
        refreshShipyardState: refreshShipyardStateFromEvent,
      } = chainEventRefreshRef.current;
      const forceWalletPlanetsRefresh = forceWalletPlanetsRefreshQueued;
      refreshInFlight = true;
      refreshQueued = false;
      forceWalletPlanetsRefreshQueued = false;
      const refreshes: Array<Promise<unknown>> = [
        refreshOnChainStateFromEvent(undefined, forceWalletPlanetsRefresh
          ? { force: true, forceWalletPlanets: true }
          : undefined),
        refreshInfrastructureStateFromEvent(),
      ];
      if (currentPage === "shipyard" || shouldRefreshMissionActionStateForPage(currentPage)) refreshes.push(refreshShipyardStateFromEvent());
      if (currentPage === "defenses" || shouldRefreshMissionActionStateForPage(currentPage)) refreshes.push(refreshDefenseStateFromEvent());
      if (shouldRefreshAllianceStateForPage(currentPage)) refreshes.push(Promise.resolve(refreshAllianceStateFromEvent()));
      if (currentPage === "research") refreshes.push(refreshResearchStateFromEvent());
      if (currentPage === "rift") refreshes.push(refreshRiftStateFromEvent());
      if (currentPage === "moon") refreshes.push(refreshInfrastructureStateFromEvent());

      void Promise.allSettled(refreshes).finally(() => {
        refreshInFlight = false;
        if (refreshQueued) scheduleChainEventRefresh();
      });
    };

    const scheduleChainEventRefresh = (event?: MessageEvent) => {
      forceWalletPlanetsRefreshQueued ||= chainEventWalletPlanetsChanged(event);
      refreshQueued = true;
      if (refreshTimer !== undefined || refreshInFlight) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        runChainEventRefresh();
      }, CHAIN_EVENT_REFRESH_DEBOUNCE_MS);
    };
    const updateSyncStatus = (event: MessageEvent) => {
      try {
        const snapshot = JSON.parse(event.data) as {
          connected?: boolean;
          subscribedToHeads?: boolean;
          subscribedToLogs?: boolean;
        };
        setChainSyncHealthy(Boolean(snapshot.connected && snapshot.subscribedToHeads && snapshot.subscribedToLogs));
      } catch {
        setChainSyncHealthy(false);
      }
    };

    events.addEventListener("chain-event", scheduleChainEventRefresh);
    events.addEventListener("sync-status", updateSyncStatus);
    events.onerror = () => setChainSyncHealthy(false);

    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      events.close();
    };
  }, [
    account,
    apiBaseUrl,
  ]);

  useEffect(() => {
    if (chainSyncHealthy) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshOnChainState();
      refreshInfrastructureState();
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [chainSyncHealthy, refreshInfrastructureState, refreshOnChainState]);

  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady || !onChainSettlement?.planet) {
      return;
    }

    let refreshInFlight = false;
    const refreshTopBarResources = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      Promise.allSettled([
        refreshOnChainState(),
        refreshInfrastructureState(),
      ]).finally(() => {
        refreshInFlight = false;
      });
    };

    const interval = window.setInterval(refreshTopBarResources, TOP_BAR_RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    account,
    apiBaseUrl,
    onChainSettlement?.planet?.planetId,
    pageStateHydrationReady,
    refreshInfrastructureState,
    refreshOnChainState,
  ]);

  // VEY-KANEO-433: while Mission Control is open, poll its full data set on the same cadence as the
  // top bar so resolutions, loot, and battle reports surface without a manual Refresh. This is the
  // same work the Refresh button does (fleet visibility + the past-mission archives + the universe
  // active feed), guarded against overlapping refreshes and paused while the tab is hidden.
  useEffect(() => {
    if (!apiBaseUrl || !account || !shouldAutoPollMissionControlForPage(page)) {
      return;
    }

    let refreshInFlight = false;
    const pollMissionControl = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      // Refresh the lists and, when a battle report is open, that detail too, so loot/report on the
      // open report surface live alongside the list status (VEY-KANEO-433).
      Promise.allSettled([refreshMissionControl(), refreshOpenMissionDetailSilently()]).finally(() => {
        refreshInFlight = false;
      });
    };

    const interval = window.setInterval(pollMissionControl, TOP_BAR_RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [account, apiBaseUrl, page, refreshMissionControl, refreshOpenMissionDetailSilently]);

  // VEY-KANEO-433: tighten the poll around resolution — schedule a one-shot refresh just after the
  // soonest active mission is due to arrive (or a returning fleet to land) so the new status, loot,
  // and battle report appear promptly instead of waiting for the next full poll tick. Re-derived
  // whenever fleet visibility changes; only active while Mission Control is open.
  useEffect(() => {
    if (!apiBaseUrl || !account || !shouldAutoPollMissionControlForPage(page)) {
      return;
    }
    const nextEventMs = nextMissionResolutionEventMs(fleetVisibility, Date.now());
    if (nextEventMs === undefined) {
      return;
    }
    const delay = Math.max(0, nextEventMs - Date.now()) + MISSION_RESOLUTION_REFRESH_BUFFER_MS;
    const timer = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshMissionControl();
      // Also pull the open report so a viewer watching it sees the resolution land at arrival time.
      void refreshOpenMissionDetailSilently();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [account, apiBaseUrl, fleetVisibility, page, refreshMissionControl, refreshOpenMissionDetailSilently]);

  const state = useMemo<PlayableState>(() => infrastructurePlayableState(infrastructureChainState, now), [infrastructureChainState, now]);
  const settledState = state;
  const planetProductionProfile = useMemo<PlanetProductionProfile | undefined>(() => {
    const planetState = onChainSettlement?.planet;
    if (!planetState) return undefined;

    return {
      maxTemperature: planetState.temperature,
      metalMultiplierBps: planetState.metalMultiplierBps,
      crystalMultiplierBps: planetState.crystalMultiplierBps,
      deuteriumMultiplierBps: planetState.deuteriumMultiplierBps,
    };
  }, [
    onChainSettlement?.planet?.crystalMultiplierBps,
    onChainSettlement?.planet?.deuteriumMultiplierBps,
    onChainSettlement?.planet?.metalMultiplierBps,
    onChainSettlement?.planet?.temperature,
  ]);
  // VEY-KANEO-465: production rate is backend-derived (`productionPerHour` on
  // /infrastructure, VEY-KANEO-464) — no client recomputation. Zeros until the
  // backend value has loaded; skeleton loaders cover the initial load and React
  // Query keeps the last value during a background refresh.
  const rates = useMemo(() => {
    if (activeBodyKind === "moon") {
      return { metal: 0, crystal: 0, deuterium: 0 };
    }
    const production = infrastructureChainState?.productionPerHour;
    return {
      metal: production ? Number(production.metal) : 0,
      crystal: production ? Number(production.crystal) : 0,
      deuterium: production ? Number(production.deuterium) : 0,
    };
  }, [activeBodyKind, infrastructureChainState?.productionPerHour]);
  // VEY-KANEO-481: production rate that feeds the "affordable in …" ETA on disabled
  // build/research/defense/shipyard actions. Only defined once the backend production
  // rate has loaded so the ETA never renders the stalled copy during the initial load.
  const productionRatesForEta = infrastructureChainState?.productionPerHour ? rates : undefined;
  // VEY-KANEO-465: storage caps are backend-derived (`storageCaps` on
  // /infrastructure) — no client recomputation.
  const caps = useMemo(() => {
    if (activeBodyKind === "moon") {
      return { metal: 0, crystal: 0, deuterium: 0 };
    }
    const nextCaps = infrastructureChainState?.storageCaps;
    return {
      metal: nextCaps ? Number(nextCaps.metal) : 0,
      crystal: nextCaps ? Number(nextCaps.crystal) : 0,
      deuterium: nextCaps ? Number(nextCaps.deuterium) : 0,
    };
  }, [activeBodyKind, infrastructureChainState?.storageCaps]);
  // VEY-KANEO-465: display backend-derived resource state only — the frontend no
  // longer projects/accrues resources against its own clock, takes an
  // element-wise minimum of two snapshots, or freezes a free-running projection.
  // The backend returns `resourcesAsOfNow` (VEY-KANEO-464): the canonical settled
  // balance accrued forward at the production rate and capped at storage, computed
  // server-side at request time. This is the contract-authoritative "spendable
  // now" value — `_spend` settles to exactly this (`previewResources`) before
  // checking affordability — so the top bar and every affordability gate read it
  // directly. Because nothing is projected client-side the value holds steady
  // between polls and React Query keeps the last successful response during a
  // transient backend error, so it cannot drift toward the storage cap (the
  // VEY-392 over-report can no longer happen on the client). When the backend has
  // not populated `resourcesAsOfNow` (older deploy / planet still warming) fall
  // back to the raw settled `resources` snapshot — still a backend value and never
  // an over-report — so affordability stays safe.
  const backendSpendableResources = useMemo(() => {
    return walletCurrentResourcesForActiveBody({
      activeBodyKind,
      moonResourcesAsOfNow: moonState?.resourcesAsOfNow ?? selectedMoonBody?.resourcesAsOfNow,
      moonResources: moonState?.resources ?? selectedMoonBody?.resources,
      planetResources: onChainSettlement?.planet?.resourcesAsOfNow ?? onChainSettlement?.planet?.resources,
      infrastructureResourcesAsOfNow: infrastructureChainState?.resourcesAsOfNow,
      infrastructureResources: infrastructureChainState?.resources,
    });
  }, [
    activeBodyKind,
    moonState?.resourcesAsOfNow,
    moonState?.resources,
    selectedMoonBody?.resourcesAsOfNow,
    selectedMoonBody?.resources,
    onChainSettlement?.planet?.resourcesAsOfNow,
    onChainSettlement?.planet?.resources,
    infrastructureChainState?.resourcesAsOfNow,
    infrastructureChainState?.resources,
  ]);
  const liveOnChainResources = backendSpendableResources;
  const spendableResources = useMemo(() => {
    return walletSpendableResourcesFor({ isWalletConnected, onChainResources: backendSpendableResources });
  }, [isWalletConnected, backendSpendableResources]);
  // VEY-KANEO-453: the mission fuel/cargo gate reads the canonical spendable balance for
  // the active (origin) planet — the same value the top bar shows and a transaction spends
  // against — falling back to the backend wallet-planet snapshot only when no wallet-connected
  // spendable balance is available.
  const missionResourcesForOrigin = useCallback((originPlanet: ManagedPlanetResponse | undefined) => missionOriginResources({
    isWalletConnected,
    spendableResources: activeBodyKind === "planet" && originPlanet?.planetId === activePlanetId ? spendableResources : undefined,
    // Prefer the live settled-to-now balance over the settled snapshot (VEY-KANEO-488).
    planetResources: originPlanet?.resourcesAsOfNow ?? originPlanet?.resources,
  }), [activeBodyKind, activePlanetId, isWalletConnected, spendableResources]);
  const originMissionResources = useMemo(
    () => missionResourcesForOrigin(selectedManagedPlanet),
    [missionResourcesForOrigin, selectedManagedPlanet]
  );
  const activeBuildingQueue = useMemo(
    () => activeBuildingQueueResponse(onChainQueues, infrastructureChainState),
    [infrastructureChainState, onChainQueues],
  );
  useEffect(() => {
    const delayMs = buildingCompletionAutoRefreshDelayMs(activeBuildingQueue);
    if (delayMs === undefined) return;

    const expectation: FinishedBuildingExpectation = {
      itemId: activeBuildingQueue?.itemId,
      targetLevel: activeBuildingQueue?.targetLevel,
    };
    const timeout = window.setTimeout(() => {
      void refreshFinishedBuildingState(expectation).catch((error) => {
        console.error(error);
      });
    }, delayMs);

    return () => window.clearTimeout(timeout);
  }, [
    activeBuildingQueue?.active,
    activeBuildingQueue?.itemId,
    activeBuildingQueue?.readyAt,
    activeBuildingQueue?.targetLevel,
    refreshFinishedBuildingState,
  ]);
  const overviewOnChainQueues = useMemo<PlayerQueuesResponse | undefined>(() => {
    if (!onChainQueues) return undefined;
    return onChainQueues.building === activeBuildingQueue
      ? onChainQueues
      : { ...onChainQueues, building: activeBuildingQueue };
  }, [activeBuildingQueue, onChainQueues]);
  const isDisplayedBuildingQueueReady = useMemo(() => {
    return isBuildingQueueReadyToFinish(activeBuildingQueue, now);
  }, [activeBuildingQueue, now]);
  const isBuildingReadyToFinish = useMemo(() => {
    return buildingCompletionReadyToFinishFlag({
      fallbackBuildingQueue: activeBuildingQueue,
      infrastructureState: infrastructureChainState,
      now,
    });
  }, [activeBuildingQueue, infrastructureChainState, now]);
  const infrastructureBackendSyncPausedReason = useMemo(() => {
    return infrastructureBackendSyncPausedReasonFor({
      infrastructureChainState,
      infrastructureError,
    });
  }, [infrastructureChainState, infrastructureError]);
  const buildingFinishUnavailableReason = useMemo(() => {
    return buildingFinishUnavailableReasonForDisplay({
      activeBuildingQueue,
      backendSyncPausedReason: infrastructureBackendSyncPausedReason,
      canTransact: Boolean(provider && account && gameContract),
      completedBuildingFinishExpectation,
      infrastructureState: infrastructureChainState,
      isBuildingReadyToFinish,
      isDisplayedBuildingQueueReady,
      now,
    });
  }, [
    account,
    activeBuildingQueue,
    completedBuildingFinishExpectation,
    gameContract,
    infrastructureBackendSyncPausedReason,
    infrastructureChainState,
    isBuildingReadyToFinish,
    isDisplayedBuildingQueueReady,
    now,
    provider,
  ]);
  const buildingQueue = useMemo(() => {
    if (activeBuildingQueue?.active) {
      return buildingQueueItemForDisplay(activeBuildingQueue, now);
    }

    return settledState.queue?.kind === "building" ? settledState.queue : undefined;
  }, [activeBuildingQueue, now, settledState.queue]);
  const effectiveResearchState = researchState;

  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady) {
      return;
    }

    const nextEventMs = nextProductionQueueCompletionEventMs([
      activeBuildingQueue,
      activeDefenseProductionQueue,
      activeShipyardProductionQueue,
      effectiveResearchState?.queue,
    ], Date.now());
    if (nextEventMs === undefined) {
      return;
    }

    const delay = Math.max(0, nextEventMs - Date.now()) + PRODUCTION_QUEUE_COMPLETION_REFRESH_BUFFER_MS;
    const timer = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const refreshes: Array<Promise<unknown> | unknown> = [
        refreshOnChainState(undefined, { force: true }),
        refreshInfrastructureState(),
      ];
      if (activeDefenseProductionQueue?.active) refreshes.push(refreshDefenseState());
      if (activeShipyardProductionQueue?.active) refreshes.push(refreshShipyardState());
      if (effectiveResearchState?.queue?.active) refreshes.push(refreshResearchState());
      void Promise.allSettled(refreshes);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    account,
    activeBuildingQueue,
    activeDefenseProductionQueue,
    activeShipyardProductionQueue,
    apiBaseUrl,
    effectiveResearchState?.queue,
    pageStateHydrationReady,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshShipyardState,
  ]);

  const attackerCombatTechLevels = useMemo(
    () => attackerCombatTechLevelsForMission({
      researchTechnologyLevels: effectiveResearchState?.technologyLevels,
      shipyardTechnologyLevels: shipyardState?.technologyLevels,
    }),
    [effectiveResearchState?.technologyLevels, shipyardState?.technologyLevels],
  );
  const shipQueue = settledState.queue?.kind === "ship" ? settledState.queue : undefined;
  const queueProgress = progress(buildingQueue, now);
  const researchProgress = progress(settledState.researchQueue, now);
  const shipProgress = progress(shipQueue, now);
  const infrastructureState = useMemo<PlayableState>(() => {
    if (!isWalletConnected || !liveOnChainResources) {
      return settledState;
    }

    return {
      ...settledState,
      queue: buildingQueue,
      resources: liveOnChainResources,
    };
  }, [buildingQueue, isWalletConnected, liveOnChainResources, settledState]);

  useEffect(() => {
    if (!isStartedBuildingQueueSynced(activeBuildingQueue, failedStartedBuildingExpectation)) return;
    setFailedStartedBuildingExpectation(undefined);
    setBuildingAction((current) => recoveredStartedBuildingAction({
      action: current,
      activeBuildingQueue,
      expectation: failedStartedBuildingExpectation,
    }));
  }, [activeBuildingQueue, failedStartedBuildingExpectation]);

  useEffect(() => {
    if (!completedBuildingFinishExpectation) return;
    if (completedBuildingFinishSyncReasonFor({
      activeBuildingQueue,
      expectation: completedBuildingFinishExpectation,
    })) {
      return;
    }
    setCompletedBuildingFinishExpectation(undefined);
  }, [activeBuildingQueue, completedBuildingFinishExpectation]);

  useEffect(() => {
    if (!failedBuildingFinishExpectation) return;
    if (failedBuildingFinishSyncReasonFor({
      activeBuildingQueue,
      expectation: failedBuildingFinishExpectation,
    })) {
      return;
    }
    setFailedBuildingFinishExpectation(undefined);
  }, [activeBuildingQueue, failedBuildingFinishExpectation]);

  const chainBuildingCosts = useMemo(() => buildingCosts(infrastructureChainState), [infrastructureChainState]);
  const chainBuildingDurations = useMemo(() => buildingDurations(infrastructureChainState), [infrastructureChainState]);
  const infrastructureUnavailableReason = useMemo(() => {
    if (transactionActionPending && buildingAction.status !== "pending") {
      return "Another transaction is syncing indexed state.";
    }
    return infrastructureUnavailableReasonFor({
      buildingAction,
      gameContract,
      homePlanetId: onChainSettlement?.homePlanetId,
      infrastructureChainState,
      infrastructureError,
      infrastructureLoading,
      isWalletConnected,
      onChainResources,
      onChainStatus,
      runtimeConfigStatus: runtimeConfig.status,
    });
  }, [
    buildingAction,
    gameContract,
    infrastructureChainState,
    infrastructureError,
    infrastructureLoading,
    isWalletConnected,
    onChainResources,
    onChainSettlement?.homePlanetId,
    onChainStatus,
    runtimeConfig.status,
    transactionActionPending,
  ]);
  const infrastructureActionNotice = infrastructureDisplayActionNoticeFor({
    action: buildingAction,
    finishUnavailableReason: buildingFinishUnavailableReason,
  });
  const infrastructureActionPendingLabel = buildingAction.status === "pending" ? buildingAction.label : undefined;
  const topBarEnergy = useMemo(() => {
    return topBarEnergyFor({
      infrastructureChainState,
      isWalletConnected,
    });
  }, [
    infrastructureChainState,
    isWalletConnected,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (shouldClearCachedShipyardStateForPageRefresh(page)) {
      refreshShipyardState({ clearCachedState: true });
    } else if (shouldRefreshMissionActionStateForPage(page)) {
      refreshShipyardState();
    }
  }, [page, pageStateHydrationReady, refreshShipyardState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (page === "defenses" || shouldRefreshMissionActionStateForPage(page)) {
      refreshDefenseState();
    }
  }, [page, pageStateHydrationReady, refreshDefenseState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (shouldRefreshAllianceStateForPage(page)) {
      refreshAllianceState();
    }
  }, [page, pageStateHydrationReady, refreshAllianceState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (page === "research") {
      refreshResearchState();
    }
  }, [page, pageStateHydrationReady, refreshResearchState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (page === "rift") {
      refreshRiftState();
    }
  }, [page, pageStateHydrationReady, refreshRiftState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    if (page === "moon") {
      refreshInfrastructureState();
    }
  }, [page, pageStateHydrationReady, refreshInfrastructureState]);

  useEffect(() => {
    const abortController = new AbortController();
    fetch(runtimeConfigUrl(), {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
        return response.json();
      })
      .then((config) => setRuntimeConfig({ config, status: "ready" }))
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setRuntimeConfig({ status: "error" });
        }
      });
    return () => abortController.abort();
  }, []);

  const runBuildingTransaction = useCallback(async (key: BuildingKey) => {
    await runGatedTransaction(`building:start:${key}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      const planetId = activePlanetId ?? onChainSettlement?.homePlanetId;
      if (!provider || !account || !gameContract || !planetId || !apiBaseUrl) {
        setBuildingAction({
          status: "error",
          buildingKey: key,
          label: infrastructureUnavailableReason ?? "Wallet, game contract, active planet, or game API is unavailable.",
        });
        return;
      }

      const building = buildingContractIds[key];
      const label = "Building upgrade";
      let backendStateReady = false;
      let startedExpectation: StartedBuildingExpectation | undefined;
      setBuildingAction({ status: "pending", buildingKey: key, label: "Refreshing infrastructure state" });
      setFailedStartedBuildingExpectation(undefined);

      try {
        const liveInfrastructure = await refreshLiveInfrastructureState();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        const unavailableReason = refreshedInfrastructureUpgradeUnavailableReasonFor({
          buildingKey: key,
          gameContract,
          homePlanetId: planetId,
          infrastructureChainState: liveInfrastructure,
          isWalletConnected,
          onChainResources,
          runtimeConfigStatus: runtimeConfig.status,
          starterPlanet: selectedManagedPlanet?.isHomePlanet ?? planetId === onChainSettlement?.homePlanetId,
        });
        if (unavailableReason) {
          setBuildingAction({ status: "error", buildingKey: key, label: unavailableReason });
          return;
        }

        backendStateReady = true;
        const buildingRow = liveInfrastructure?.buildings.find((row) => row.id === building);
        const currentLevel = buildingRow?.level ?? 0;
        startedExpectation = {
          itemId: building,
          planetId,
          targetLevel: currentLevel + 1,
        };
        setBuildingAction({ status: "pending", buildingKey: key, label: buildingWalletConfirmationLabel(label) });
        const txHash = await sendStartBuildingUpgradeTransaction(
          provider,
          account,
          gameContract,
          planetId,
          building,
        );
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setBuildingAction({
          status: "pending",
          buildingKey: key,
          label: transactionConfirmingLabel(label, txHash),
        });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setBuildingAction({ status: "pending", buildingKey: key, label: transactionSyncingLabel(label) });
        await refreshStartedBuildingState(startedExpectation);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setFailedStartedBuildingExpectation(undefined);
        setBuildingAction({ status: "success", buildingKey: key, label: "Building upgrade started." });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        const actionLabel = backendStateReady ? spendTransactionErrorMessage(error) : buildingUpgradeActionErrorLabel(error);
        if (startedExpectation && isStartedBuildingQueueSyncingLabel(actionLabel)) {
          setFailedStartedBuildingExpectation(startedExpectation);
        }
        setBuildingAction({
          status: "error",
          buildingKey: key,
          label: actionLabel,
          ...rejectedActionAutoDismiss(error),
        });
      }
    });
  }, [
    account,
    activePlanetId,
    apiBaseUrl,
    confirmSubmittedTransaction,
    gameContract,
    infrastructureUnavailableReason,
    isWalletConnected,
    onChainResources,
    onChainSettlement?.homePlanetId,
    provider,
    refreshLiveInfrastructureState,
    refreshStartedBuildingState,
    runtimeConfig.status,
    selectedManagedPlanet?.isHomePlanet,
    runGatedTransaction,
  ]);

  const handleUpgrade = useCallback((key: BuildingKey) => {
    void runBuildingTransaction(key);
  }, [runBuildingTransaction]);

  const runShipyardTransaction = useCallback(async (
    label: string,
    actionKey: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<boolean | void>) | undefined,
  ) => {
    await runGatedTransaction(actionKey, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setShipyardAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setShipyardAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setShipyardAction({ status: "pending", label: transactionSyncingLabel(label) });
        let synced = true;
        if (afterReceipt) {
          const result = await afterReceipt();
          synced = result !== false;
        } else {
          await Promise.allSettled([
            refreshShipyardState(),
            // Force the post-action settlement read so the just-spent resources show without a
            // page reload even if the backend briefly returns an equal lastSettledAt (VEY-KANEO-484).
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setShipyardAction(synced
          ? { status: "success", label: `${label} confirmed.` }
          : { status: "pending", label: serverUnavailableRetryMessage() });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        const message = spendTransactionErrorMessage(error);
        setShipyardAction({
          status: "error",
          label: `${label} failed: ${message}`,
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshShipyardState, runGatedTransaction]);

  const runDefenseTransaction = useCallback(async (
    label: string,
    actionKey: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<void>) | undefined,
  ) => {
    await runGatedTransaction(actionKey, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setDefenseAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setDefenseAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setDefenseAction({ status: "pending", label: transactionSyncingLabel(label) });
        if (afterReceipt) {
          await afterReceipt();
        } else {
          await Promise.allSettled([
            refreshDefenseState(),
            // Force the post-action settlement read (see VEY-KANEO-484).
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setDefenseAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setDefenseAction({
          status: "error",
          label: spendTransactionErrorMessage(error),
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, runGatedTransaction]);

  const waitForAllianceApplicationState = useCallback((
    expectation: AllianceApplicationExpectation,
  ) => {
    if (!apiBaseUrl || !account) {
      throw new Error("Alliance contract unavailable.");
    }

    return waitForAllianceApplicationCleared(
      async () => fetchAllianceState(apiBaseUrl, account),
      expectation,
    );
  }, [account, apiBaseUrl]);

  const runAllianceTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<ChainAllianceState | null | undefined>) | undefined,
  ) => {
    await runGatedTransaction(`alliance:${label}`, async () => {
      setAllianceAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });
      setAllianceLoading(true);

      try {
        const txHash = await send();
        setAllianceAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setAllianceAction({ status: "pending", label: transactionSyncingLabel(label) });
        const next = await (afterReceipt ? afterReceipt() : refreshAllianceState());
        if (next) {
          setAllianceState(next);
        }
        setAllianceAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        void refreshAllianceState();
        setAllianceAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} failed.`,
        });
      } finally {
        setAllianceLoading(false);
      }
    });
  }, [confirmSubmittedTransaction, refreshAllianceState, runGatedTransaction]);

  const runResearchTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<void>) | undefined,
  ) => {
    await runGatedTransaction(`research:${label}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setResearchAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setResearchAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setResearchAction({ status: "pending", label: transactionSyncingLabel(label) });
        if (afterReceipt) {
          await afterReceipt();
        } else {
          await Promise.allSettled([
            refreshResearchState(),
            // Force the post-action settlement read (see VEY-KANEO-484).
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setResearchAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setResearchAction({
          status: "error",
          label: spendTransactionErrorMessage(error),
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshResearchState, runGatedTransaction]);

  const runRiftTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    await runGatedTransaction(`rift:${label}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setRiftAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setRiftAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setRiftAction({ status: "pending", label: transactionSyncingLabel(label) });
        await Promise.allSettled([
          refreshRiftState(),
          // Force the post-action settlement read (see VEY-KANEO-484).
          refreshOnChainState(undefined, { force: true }),
          refreshInfrastructureState(),
        ]);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setRiftAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setRiftAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} failed.`,
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshRiftState, runGatedTransaction]);

  const runGalaxyTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    options: {
      validateAttackProtection?: { targetPlanetId: string } | undefined;
      pendingMissionLaunch?: ((txHash: string) => FleetMissionSummary);
      syncMissionLaunch?: boolean;
      validateShipInventory?: { originPlanetId: string; ships: MissionShips } | undefined;
    } = {},
  ): Promise<boolean> => {
    let completed = false;
    await runGatedTransaction(`galaxy:${label}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setGalaxyAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });
      let txHash: string | undefined;

      try {
        if (options.validateShipInventory) {
          setGalaxyAction({ status: "pending", label: `${label}: refreshing fleet inventory.` });
          if (!apiBaseUrl || !account) {
            throw new Error("Wallet or game API is unavailable while refreshing fleet inventory.");
          }
          const freshShipyardState = await fetchShipyardState(apiBaseUrl, account, options.validateShipInventory.originPlanetId);
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
          setShipyardState(freshShipyardState);
          const shipBlocker = missionShipInventoryBlocker({
            shipyardState: freshShipyardState,
            ships: options.validateShipInventory.ships,
          });
          if (shipBlocker) {
            throw new Error(shipBlocker);
          }
        }
        if (options.validateAttackProtection) {
          setGalaxyAction({ status: "pending", label: `${label}: refreshing target protection.` });
          if (!apiBaseUrl || !account) {
            throw new Error("Wallet or game API is unavailable while refreshing target protection.");
          }
          const status = await fetchAttackProtectionStatus(apiBaseUrl, account, options.validateAttackProtection.targetPlanetId);
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
          const protectionBlocker = attackProtectionSubmitBlocker(status);
          if (protectionBlocker) {
            throw new Error(protectionBlocker);
          }
        }
        txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setGalaxyAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        const pendingMission = options.pendingMissionLaunch?.(txHash);
        if (pendingMission) {
          setPendingMissionLaunches((current) => mergePendingMissionLaunches(current, [pendingMission]));
        }
        const confirmedTxHash = txHash;
        setGalaxyAction({ status: "pending", label: transactionSyncingLabel(label) });
        await Promise.allSettled([
          refreshShipyardState(),
          refreshDefenseState(),
          // Force the post-action settlement read (see VEY-KANEO-484).
          refreshOnChainState(undefined, { force: true }),
          refreshInfrastructureState(),
        ]);
        if (options.syncMissionLaunch) {
          const missionSnapshot = await waitForMissionLaunchState(loadMissionLaunchSnapshot, txHash, {
            expectedMission: pendingMission,
          });
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
          markFreshStateWrite(onChainRefreshGate);
          const launchedMissions = missionLaunchMissionsForTransaction(missionSnapshot, txHash, pendingMission);
          setFleetVisibility(missionSnapshot.fleetVisibility);
          setAllActiveMissions(mergeActiveMissionList(missionSnapshot.allActiveMissions, launchedMissions));
          setPendingMissionLaunches((current) => removePendingMissionLaunchForTransaction(current, confirmedTxHash));
          if (options.validateShipInventory && apiBaseUrl && account) {
            try {
              const nextShipyardState = await fetchShipyardState(apiBaseUrl, account, options.validateShipInventory.originPlanetId);
              if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
              setShipyardState(nextShipyardState);
            } catch (error) {
              console.error(error);
            }
          }
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setGalaxyAction({ status: "success", label: `${label} confirmed.` });
        completed = true;
      } catch (error) {
        console.error(error);
        if (txHash) {
          const failedTxHash = txHash;
          setPendingMissionLaunches((current) => removePendingMissionLaunchForTransaction(current, failedTxHash));
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setGalaxyAction({
          status: "error",
          label: galaxyMissionActionErrorLabel(label, error),
        });
      }
    });
    return completed;
  }, [account, apiBaseUrl, confirmSubmittedTransaction, loadMissionLaunchSnapshot, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, refreshShipyardState, runGatedTransaction]);

  const runMoonTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    await runGatedTransaction(`moon:${label}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;
      setMoonAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "pending", label: transactionSyncingLabel(label) });
        await Promise.allSettled([
          refreshInfrastructureState(),
          // Force the post-action settlement read (see VEY-KANEO-484).
          refreshOnChainState(undefined, { force: true }),
        ]);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} failed.`,
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, runGatedTransaction]);

  const handleBurnChickenForMoon = useCallback((tokenId: string) => {
    if (!provider || !account || !chickenBurnConfig || !activePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, Burning Chicken config, or selected planet is unavailable." });
      return;
    }
    if (walletMoonCount >= maxChickenBurnMoonsPerPlayer) {
      setMoonAction({ status: "error", label: "This wallet has reached the two-moon limit." });
      return;
    }

    const targetLabel = activePlanetCoords
      ? `${activePlanetCoords.galaxy}:${activePlanetCoords.system}:${activePlanetCoords.position}`
      : `planet #${activePlanetId}`;
    const label = `Burn Chicken #${tokenId} for ${targetLabel}`;
    void runGatedTransaction(`moon:chicken-burn:${tokenId}`, async () => {
      const planetSwitchRequestId = planetSwitchGate.current;

      try {
        setMoonAction({ status: "pending", label: `Checking Chicken #${tokenId} ownership...` });
        await fetchBurningChickenForOwner(account, tokenId, chickenBurnConfig);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });
        const txHash = await sendBurningChickenMoonTransaction(
          provider,
          account,
          chickenBurnConfig,
          tokenId,
          activePlanetId,
        );
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        await ensureBaseSepoliaNetwork(provider);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "pending", label: "Chicken burned. Waiting for Veydrift indexed moon state..." });
        if (!apiBaseUrl || !activePlanetId) {
          throw new Error("Chicken burn confirmed, but Veydrift API state is unavailable for moon confirmation.");
        }
        const confirmedMoonState = await waitForConfirmedChickenMoonState(apiBaseUrl, account, activePlanetId);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonState(confirmedMoonState);
        setActivePlanetSectionStatus("moonState", {
          loading: false,
          error: undefined,
          lastSuccessfulRefreshAt: Date.now(),
        });
        await Promise.allSettled([
          refreshOnChainState(undefined, { force: true }),
        ]);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        try {
          await ensureBaseSepoliaNetwork(provider);
        } catch (switchError) {
          console.error(switchError);
        }
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setMoonAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} failed.`,
        });
      }
    });
  }, [
    account,
    activePlanetId,
    activePlanetCoords,
    apiBaseUrl,
    chickenBurnConfig,
    confirmSubmittedTransaction,
    provider,
    refreshOnChainState,
    runGatedTransaction,
    setActivePlanetSectionStatus,
    setMoonState,
    walletMoonCount,
  ]);

  const handleBuildShip = useCallback((shipId: number, _key: ShipKey, quantity: number) => {
    const planetId = shipyardState?.planetId ?? shipyardState?.homePlanetId;
    if (!provider || !account || !gameContract || !planetId) {
      setShipyardAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const currentQueuedQuantity =
      activeShipyardProductionQueue?.itemId === shipId
        ? activeShipyardProductionQueue.quantity ?? 0
        : 0;
    const expectedQuantity = currentQueuedQuantity + quantity;

    void runShipyardTransaction("Ship production", `shipyard:start:${shipId}`, () => sendStartShipProductionTransaction(
      provider,
      account,
      gameContract,
      planetId,
      shipId,
      quantity,
    ), () => refreshStartedShipProductionState({
      itemId: shipId,
      planetId,
      quantity: expectedQuantity,
    }));
  }, [
    account,
    activeShipyardProductionQueue,
    gameContract,
    provider,
    refreshStartedShipProductionState,
    runShipyardTransaction,
    shipyardState?.homePlanetId,
    shipyardState?.planetId,
  ]);

  const handleBuildDefense = useCallback((defenseId: number, _key: DefenseKey, quantity: number) => {
    if (!provider || !account || !gameContract || !defenseState?.homePlanetId) {
      setDefenseAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const planetId = defenseState.homePlanetId;
    const currentQueuedQuantity =
      activeDefenseProductionQueue?.itemId === defenseId
        ? activeDefenseProductionQueue.quantity ?? 0
        : 0;
    const expectedQuantity = currentQueuedQuantity + quantity;

    void runDefenseTransaction("Defense production", `defense:start:${defenseId}`, () => sendStartDefenseProductionTransaction(
      provider,
      account,
      gameContract,
      planetId,
      defenseId,
      quantity,
    ), () => refreshStartedDefenseProductionState({
      itemId: defenseId,
      planetId,
      quantity: expectedQuantity,
    }));
  }, [
    account,
    activeDefenseProductionQueue,
    defenseState?.homePlanetId,
    gameContract,
    provider,
    refreshStartedDefenseProductionState,
    runDefenseTransaction,
  ]);

  const handleCreateAlliance = useCallback((tag: string, name: string, description: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance creation", () => sendCreateAllianceTransaction(
      provider,
      account,
      allianceContract,
      tag,
      name,
      description,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleInviteAllianceMember = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance invite", () => sendAllianceInviteTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleUpdateAllianceProfile = useCallback((tag: string, name: string, description: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const allianceId = allianceState.membership.allianceId;
    void runAllianceTransaction("Alliance profile update", () => sendAllianceProfileTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
      tag,
      name,
      description,
    ), () => waitForAllianceProfileState(
      async () => fetchAllianceState(apiBaseUrl, account),
      { allianceId, tag, name, description },
    ));
  }, [account, apiBaseUrl, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleAcceptAllianceInvite = useCallback((allianceId: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    setAllianceAction({ status: "pending", label: "Refreshing alliance invitation..." });
    setAllianceLoading(true);
    void fetchAllianceState(apiBaseUrl, account)
      .then((next) => {
        setAllianceState(next);
        const invite = next.pendingInvites.find((entry) => entry.allianceId === allianceId);
        if (!invite) {
          setAllianceAction({ status: "error", label: "This invitation is no longer pending." });
          return;
        }

        const acceptance = allianceInviteAcceptanceState(next, invite);
        if (!acceptance.canAccept) {
          setAllianceAction({ status: "error", label: acceptance.reason ?? "This invitation cannot be accepted." });
          return;
        }

        return runAllianceTransaction("Alliance invite acceptance", () => sendAcceptAllianceInviteTransaction(
          provider,
          account,
          allianceContract,
          invite.allianceId,
        ));
      })
      .catch((error) => {
        console.error(error);
        setAllianceAction({
          status: "error",
          label: error instanceof Error ? error.message : "Alliance invitation could not be refreshed.",
        });
      })
      .finally(() => {
        setAllianceLoading(false);
      });
  }, [account, apiBaseUrl, allianceContract, provider, runAllianceTransaction]);

  const handleRequestAllianceJoin = useCallback((allianceId: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance join request", () => sendAllianceJoinRequestTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleCancelAllianceJoinRequest = useCallback((allianceId: string) => {
    if (!provider || !account || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance join request cancellation", () => sendCancelAllianceJoinRequestTransaction(
      provider,
      account,
      allianceContract,
      allianceId,
    ));
  }, [account, allianceContract, provider, runAllianceTransaction]);

  const handleApproveAllianceJoinRequest = useCallback((playerAddress: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const currentAllianceId = allianceState.membership.allianceId;
    setAllianceAction({ status: "pending", label: "Refreshing alliance application..." });
    setAllianceLoading(true);
    void fetchAllianceState(apiBaseUrl, account)
      .then((next) => {
        setAllianceState(next);
        const request = next.allianceJoinRequests.find((entry) =>
          entry.allianceId === currentAllianceId
            && entry.requester.toLowerCase() === playerAddress.toLowerCase()
        );
        if (!request) {
          setAllianceAction({ status: "error", label: "This application is no longer pending." });
          return;
        }

        const approval = allianceJoinRequestApprovalState(next, request);
        if (!approval.canApprove) {
          setAllianceAction({ status: "error", label: approval.reason ?? "This application cannot be approved." });
          return;
        }

        return runAllianceTransaction("Alliance join approval", () => sendApproveAllianceJoinRequestTransaction(
          provider,
          account,
          allianceContract,
          next.membership.allianceId,
          playerAddress,
        ), () => waitForAllianceApplicationState({
          allianceId: next.membership.allianceId,
          requester: playerAddress,
        }));
      })
      .catch((error) => {
        console.error(error);
        setAllianceAction({
          status: "error",
          label: error instanceof Error ? error.message : "Alliance application could not be refreshed.",
        });
      })
      .finally(() => {
        setAllianceLoading(false);
      });
  }, [account, apiBaseUrl, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction, waitForAllianceApplicationState]);

  const handleDismissAllianceJoinRequest = useCallback((playerAddress: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const currentAllianceId = allianceState.membership.allianceId;
    setAllianceAction({ status: "pending", label: "Refreshing alliance application..." });
    setAllianceLoading(true);
    void fetchAllianceState(apiBaseUrl, account)
      .then((next) => {
        setAllianceState(next);
        const request = next.allianceJoinRequests.find((entry) =>
          entry.allianceId === currentAllianceId
            && entry.requester.toLowerCase() === playerAddress.toLowerCase()
        );
        if (!request) {
          setAllianceAction({ status: "error", label: "This application is no longer pending." });
          return;
        }

        const dismissal = allianceJoinRequestDismissalState(next, request);
        if (!dismissal.canDismiss) {
          setAllianceAction({ status: "error", label: dismissal.reason ?? "This application cannot be dismissed." });
          return;
        }

        return runAllianceTransaction("Alliance application dismissal", () => sendDismissAllianceJoinRequestTransaction(
          provider,
          account,
          allianceContract,
          next.membership.allianceId,
          playerAddress,
        ), () => waitForAllianceApplicationState({
          allianceId: next.membership.allianceId,
          requester: playerAddress,
        }));
      })
      .catch((error) => {
        console.error(error);
        setAllianceAction({
          status: "error",
          label: error instanceof Error ? error.message : "Alliance application could not be refreshed.",
        });
      })
      .finally(() => {
        setAllianceLoading(false);
      });
  }, [account, apiBaseUrl, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction, waitForAllianceApplicationState]);

  const handleKickAllianceMember = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance roster removal", () => sendAllianceKickTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleBatchKickAllianceMembers = useCallback((playerAddresses: string[]) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }
    if (playerAddresses.length === 0) {
      setAllianceAction({ status: "error", label: "Select at least one alliance member." });
      return;
    }

    void runAllianceTransaction("Alliance batch roster removal", () => sendAllianceBatchKickTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddresses,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleLeaveAlliance = useCallback(() => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const label = allianceState.membership.role === "owner" ? "Alliance deletion" : "Alliance leave";
    void runAllianceTransaction(label, () => sendAllianceLeaveTransaction(
      provider,
      account,
      allianceContract,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, allianceState?.membership.role, provider, runAllianceTransaction]);

  const handleSetAllianceRole = useCallback((playerAddress: string, role: "member" | "officer") => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance role update", () => sendAllianceRoleTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
      role,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleBatchSetAllianceRole = useCallback((playerAddresses: string[], role: "member" | "officer") => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }
    if (playerAddresses.length === 0) {
      setAllianceAction({ status: "error", label: "Select at least one alliance member." });
      return;
    }

    const label = role === "officer" ? "Alliance batch officer promotion" : "Alliance batch member demotion";
    void runAllianceTransaction(label, () => sendAllianceBatchRoleTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddresses,
      role,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleSetAllianceDiplomacy = useCallback((otherAllianceId: string, status: "none" | "ally" | "non_aggression_pact" | "war") => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const label = status === "war" ? "Alliance war declaration" : "Alliance diplomacy update";
    void runAllianceTransaction(label, () => sendAllianceDiplomacyTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      otherAllianceId,
      status,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleTransferAllianceOwnership = useCallback((playerAddress: string) => {
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance ownership transfer", () => sendAllianceTransferOwnershipTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      playerAddress,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleResearch = useCallback((technologyId: number, key: ResearchKey) => {
    if (!provider || !account || !gameContract || !effectiveResearchState?.homePlanetId) {
      setResearchAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    setResearchAction({ status: "pending", label: "Refreshing research queue..." });
    const planetSwitchRequestId = planetSwitchGate.current;
    const knownResearchQueue = activeResearchQueue(effectiveResearchState.queue)
      ?? activeResearchQueue(researchState?.queue)
      ?? activeResearchQueue(onChainQueues?.research);

    void researchStartUnavailableReasonAfterLiveRevalidation({
      account,
      activePlanetId,
      apiBaseUrl,
      fallback: effectiveResearchState,
      knownResearchQueue,
      selectedResearchKey: key,
      selectedTechnologyId: technologyId,
    })
      .then(({ queues, researchState: latestResearchState, unavailableReason }) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (queues) {
          setOnChainQueues(knownResearchQueue && !activeResearchQueue(queues.research)
            ? { ...queues, research: knownResearchQueue }
            : queues);
        }
        if (latestResearchState) {
          setResearchState(
            researchStateWithFallbackQueue(
              latestResearchState,
              activeResearchQueue(queues?.research) ?? knownResearchQueue,
            ) ?? latestResearchState,
          );
          setResearchError(undefined);
        }

        if (unavailableReason) {
          setResearchAction({ status: "error", label: unavailableReason });
          return;
        }

        const stateForTransaction = researchStateWithFallbackQueue(
          latestResearchState ?? effectiveResearchState,
          activeResearchQueue(queues?.research),
        ) ?? latestResearchState ?? effectiveResearchState;
        const transactionPlanetId = researchStartPlanetIdFor({
          activePlanetId,
          researchState: stateForTransaction,
        });
        if (!transactionPlanetId) {
          setResearchAction({ status: "error", label: "No VeydriftGame planet is available for research." });
          return;
        }

        const currentLevel = stateForTransaction.technologies.find((technology) => technology.id === technologyId)?.level
          ?? stateForTransaction.technologyLevels[technologyId.toString()]
          ?? 0;

        void runResearchTransaction(researchStartTransactionLabel(technologyId, key, stateForTransaction), () => sendStartResearchTransaction(
          provider,
          account,
          gameContract,
          transactionPlanetId,
          technologyId,
        ), () => refreshStartedResearchState({
          itemId: technologyId,
          targetLevel: currentLevel + 1,
        }));
      })
      .catch((error) => {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setResearchAction({
          status: "error",
          label: error instanceof Error ? error.message : researchStartLiveStateRequiredLabel,
        });
      });
  }, [
    account,
    activePlanetId,
    apiBaseUrl,
    gameContract,
    effectiveResearchState,
    onChainQueues?.research,
    provider,
    refreshStartedResearchState,
    researchState,
    runResearchTransaction,
  ]);

  const handleApproveRiftResource = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !resource.tokenAddress) {
      setRiftAction({ status: "error", label: "Wallet, game contract, or resource token is unavailable." });
      return;
    }

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid approval amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} approval`, () => sendApproveResourceTokenTransaction(
      provider,
      account,
      resource.tokenAddress ?? "",
      gameContract,
      parsed,
    ));
  }, [account, gameContract, provider, runRiftTransaction]);

  const handleDepositRiftResource = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !riftState?.riftAvailable || !riftState.homePlanetId) {
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift Stabilizer is unavailable." });
      return;
    }
    const homePlanetId = riftState.homePlanetId;

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid deposit amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} deposit`, () => sendDepositResourceTransaction(
      provider,
      account,
      gameContract,
      homePlanetId,
      resource.resourceId,
      parsed,
    ));
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.riftAvailable, riftState?.unavailableReason, runRiftTransaction]);

  const handleRequestRiftWithdrawal = useCallback((resource: RiftResourceState, amount: string) => {
    if (!provider || !account || !gameContract || !riftState?.riftAvailable || !riftState.homePlanetId) {
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift Stabilizer is unavailable." });
      return;
    }
    const homePlanetId = riftState.homePlanetId;

    let parsed: bigint;
    try {
      parsed = parseRiftTokenAmount(amount);
    } catch (error) {
      setRiftAction({ status: "error", label: error instanceof Error ? error.message : "Invalid withdrawal amount." });
      return;
    }

    void runRiftTransaction(`${resource.label} withdrawal request`, () => sendRequestResourceWithdrawalTransaction(
      provider,
      account,
      gameContract,
      homePlanetId,
      resource.resourceId,
      parsed,
    ));
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.riftAvailable, riftState?.unavailableReason, runRiftTransaction]);

  const handleFinishRiftWithdrawal = useCallback((withdrawal: PendingWithdrawal) => {
    const resource = riftState?.resources.find((item) => item.key === withdrawal.resource);
    if (!provider || !account || !gameContract || !resource) {
      setRiftAction({ status: "error", label: "Wallet, game contract, or withdrawal resource is unavailable." });
      return;
    }

    void runRiftTransaction(`${resource.label} withdrawal finish`, () => sendFinishResourceWithdrawalTransaction(
      provider,
      account,
      gameContract,
      resource.resourceId,
    ));
  }, [account, gameContract, provider, riftState?.resources, runRiftTransaction]);

  const handleSelectManagedPlanet = useCallback((planetId: string, bodyKind: OrbitBodyKind = "planet") => {
    const nextPlanet = walletPlanets.find((planet) => planet.planetId === planetId);
    const nextBodyKind: OrbitBodyKind = bodyKind === "moon" && nextPlanet?.moon?.exists ? "moon" : "planet";
    if (planetId === activePlanetId && nextBodyKind === activeBodyKind) return;
    markFreshStateWrite(planetSwitchGate);
    markFreshStateWrite(onChainRefreshGate);
    markFreshStateWrite(infrastructureRefreshGate);
    markFreshStateWrite(defenseRefreshGate);
    markFreshStateWrite(shipyardRefreshGate);
    markFreshStateWrite(researchRefreshGate);
    markFreshStateWrite(riftRefreshGate);
    latestOnChainResourceSnapshot.current = { planetId, lastSettledAt: null };
    latestInfrastructureResourceSnapshot.current = { planetId, lastSettledAt: null };
    setSelectedPlanetId(planetId);
    setSelectedBodyKind(nextBodyKind);
    if (nextBodyKind === "moon") {
      setPage("moon");
    }
    applyOnChainSettlementSnapshot(walletSettlementForManagedPlanet(onChainSettlement, nextPlanet));
    const nextQueues = walletQueuesForManagedPlanet(onChainQueues, nextPlanet);
    setOnChainQueuesState(nextQueues);
    setPlanetSectionStore((current) => setPlanetSectionData(current, planetId, "queuesState", nextQueues, {
      loading: false,
      error: undefined,
      lastSuccessfulRefreshAt: nextQueues ? Date.now() : undefined,
    }));
    setOnChainError(undefined);
    setOnChainStatus(nextPlanet ? "ready" : "loading");
    const nextSection = planetSectionForPlanet(planetSectionStore, planetId);
    setInfrastructureError(undefined);
    setInfrastructureLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "infrastructureChainState")));
    setMoonError(undefined);
    setMoonLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "moonState")));
    setDefenseError(undefined);
    setDefenseLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "defenseState")));
    setShipyardError(undefined);
    setShipyardLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "shipyardState")));
    setResearchError(undefined);
    setResearchLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "researchState")));
    setRiftError(undefined);
    setRiftLoading(Boolean(apiBaseUrl && account && !hasPlanetSectionData(nextSection, "riftState")));
    setBuildingAction({ status: "idle" });
    setDefenseAction({ status: "idle" });
    setShipyardAction({ status: "idle" });
    setResearchAction({ status: "idle" });
    setRiftAction({ status: "idle" });
    setMoonAction({ status: "idle" });
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setCompletedBuildingFinishExpectation(undefined);
    setFailedBuildingFinishExpectation(undefined);
    setPlanetManagementAction({ status: "idle" });
    setPlanetRenameAction({ status: "idle" });
    if (nextPlanet) {
      setHomePlanetIdentity(namedSettlementPlanet(
        planetFromSettlementPlanet(nextPlanet),
        nextPlanet.name,
        playerProfile?.displayName,
      ));
    } else {
      setHomePlanetIdentity(undefined);
    }
  }, [
    account,
    activeBodyKind,
    activePlanetId,
    apiBaseUrl,
    applyOnChainSettlementSnapshot,
    onChainQueues,
    onChainSettlement,
    playerProfile?.displayName,
    walletPlanets,
  ]);

  const handleRenamePlanet = useCallback((name: string) => {
    if (!provider || !account || !gameContract || !activePlanetId) {
      setPlanetRenameAction({ status: "error", label: "Wallet, game contract, or planet is unavailable." });
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) return;

    void runGatedTransaction("planet:rename", async () => {
      setPlanetRenameAction({ status: "pending", label: transactionAwaitingWalletLabel("Planet rename") });
      const planetSwitchRequestId = planetSwitchGate.current;
      try {
        const txHash = await sendRenamePlanetTransaction(provider, account, gameContract, activePlanetId, trimmedName);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetRenameAction({ status: "pending", label: transactionConfirmingLabel("Planet rename", txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetRenameAction({ status: "pending", label: transactionSyncingLabel("Planet rename") });
        await refreshOnChainState({ planetId: activePlanetId, name: trimmedName });
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetRenameAction({ status: "success", label: "Planet renamed." });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetRenameAction({
          status: "error",
          label: error instanceof Error ? error.message : "Rename transaction failed.",
        });
      }
    });
  }, [account, activePlanetId, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState, runGatedTransaction]);

  const handleUpdatePlayerProfile = useCallback((displayName: string, description: string | null) => {
    if (!provider || !account || !apiBaseUrl) {
      setPlayerProfileAction({ status: "error", label: "Wallet or game API is unavailable." });
      return;
    }

    void runGatedTransaction("player-profile:update", async () => {
      setPlayerProfileAction({ status: "pending", label: "Waiting for wallet signature" });
      try {
        const profile = await updatePlayerProfile(apiBaseUrl, provider, account, displayName, description);
        setPlayerProfile((current) => mergePlayerProfile(current, profile));
        markFreshStateWrite(onChainRefreshGate);
        updateOnChainSettlementSnapshot((current) => current ? { ...current, player: profile } : current);
        try {
          const refreshedProfile = await fetchPlayerProfile(apiBaseUrl, account);
          setPlayerProfile((current) => mergePlayerProfile(current, refreshedProfile));
          markFreshStateWrite(onChainRefreshGate);
          updateOnChainSettlementSnapshot((current) => current ? { ...current, player: refreshedProfile } : current);
        } catch (error) {
          console.error(error);
        }
        setPlayerProfileAction({ status: "success", label: "Profile saved." });
        if (shouldRefreshAllianceStateForPage(page)) await refreshAllianceState();
      } catch (error) {
        console.error(error);
        setPlayerProfileAction({
          status: "error",
          label: error instanceof Error ? error.message : "Profile update failed.",
        });
      }
    });
  }, [account, apiBaseUrl, page, provider, refreshAllianceState, runGatedTransaction, updateOnChainSettlementSnapshot]);

  const handleAbandonPlanet = useCallback(() => {
    if (!provider || !account || !gameContract || !activePlanetId || selectedManagedPlanet?.isHomePlanet) {
      setPlanetManagementAction({ status: "error", label: "Only non-home colonies can be abandoned." });
      return;
    }
    const label = selectedManagedPlanet?.name ?? `Planet ${selectedManagedPlanet?.coordinates ?? activePlanetId}`;
    if (!window.confirm(`Abandon ${label}? This requires an empty colony with no active queues or fleet missions.`)) return;

    void runGatedTransaction("planet:abandon", async () => {
      setPlanetManagementAction({ status: "pending", label: transactionAwaitingWalletLabel("Colony abandon") });
      const planetSwitchRequestId = planetSwitchGate.current;
      try {
        const txHash = await sendAbandonPlanetTransaction(provider, account, gameContract, activePlanetId);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetManagementAction({ status: "pending", label: transactionConfirmingLabel("Colony abandon", txHash) });
        await confirmSubmittedTransaction(txHash);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetManagementAction({ status: "pending", label: transactionSyncingLabel("Colony abandon") });
        setSelectedPlanetId(undefined);
        await refreshOnChainState(undefined, { force: true, forceHomePlanet: true });
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetManagementAction({ status: "success", label: "Colony abandoned." });
      } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setPlanetManagementAction({
          status: "error",
          label: error instanceof Error ? error.message : "Abandon transaction failed.",
        });
      }
    });
  }, [account, activePlanetId, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState, runGatedTransaction, selectedManagedPlanet]);

  const handleGalaxyAction = useCallback((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({ action, target, coords, originPlanet: selectedManagedPlanet });
  }, [selectedManagedPlanet]);

  const overviewMyPlanetActionGroups = useMemo<OverviewMyPlanetActionGroup[]>(() =>
    walletPlanets.map((managedPlanet) => ({
      planet: managedPlanet,
      actions: overviewMyPlanetActionsFor({
        account,
        activePlanetId,
        defenseState,
        homePlanetId: onChainSettlement?.homePlanetId,
        planet: managedPlanet,
        shipyardState,
      }),
    })),
    [account, activePlanetId, defenseState, onChainSettlement?.homePlanetId, shipyardState, walletPlanets]
  );

  const handleOverviewMyPlanetAction = useCallback((action: GalaxyAction, managedPlanet: ManagedPlanetResponse) => {
    const targetPlanet = planetFromSettlementPlanet(managedPlanet);
    handleGalaxyAction(action, targetPlanet, {
      galaxy: managedPlanet.galaxy,
      system: managedPlanet.system,
      position: managedPlanet.position,
    });
  }, [handleGalaxyAction]);

  const raidFinderAttackAction = useCallback((target: RaidTarget): GalaxyAction => {
    const planet = raidTargetPlanetForMission(target);
    return galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: target.protection.blockedReason === "none",
        blockedReason: target.protection.blockedReason,
        blockedReasonLabel: target.protection.blockedReasonLabel,
      },
      defenseState,
      homePlanetId: onChainSettlement?.homePlanetId,
      isOrigin: activePlanetId === target.planetId,
      planet,
      shipyardState,
    }).find((action) => action.kind === "attack") ?? {
      enabled: false,
      kind: "attack",
      label: "Attack",
      mode: "mission",
      mission: "attack",
      reason: "Attack is unavailable for this target.",
    };
  }, [account, activePlanetId, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const raidFinderAttackActionState = useCallback((target: RaidTarget): RaidTargetAttackAction => {
    const action = raidFinderAttackAction(target);
    return action.enabled
      ? { label: action.label }
      : { label: action.label, disabledReason: action.reason };
  }, [raidFinderAttackAction]);

  const handleRaidFinderAttack = useCallback((target: RaidTarget) => {
    handleGalaxyAction(raidFinderAttackAction(target), raidTargetPlanetForMission(target), target.coordinates);
  }, [handleGalaxyAction, raidFinderAttackAction]);

  const raidFinderHarvestAction = useCallback((target: DebrisFinderTarget): GalaxyAction => {
    const planet = debrisTargetPlanetForMission(target);
    return galaxyActionsForSlot({
      account,
      defenseState,
      homePlanetId: onChainSettlement?.homePlanetId,
      isOrigin: activePlanetId === target.planetId,
      planet,
      shipyardState,
    }).find((action) => action.kind === "harvest") ?? {
      enabled: false,
      kind: "harvest",
      label: "Harvest",
      mode: "mission",
      mission: "harvest",
      reason: "Harvest is unavailable for this debris field.",
    };
  }, [account, activePlanetId, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const raidFinderHarvestActionState = useCallback((target: DebrisFinderTarget): RaidTargetAttackAction => {
    if (target.harvestDisabledReason) return { label: "Harvest", disabledReason: target.harvestDisabledReason };
    const action = raidFinderHarvestAction(target);
    return action.enabled
      ? { label: action.label }
      : { label: action.label, disabledReason: action.reason };
  }, [raidFinderHarvestAction]);

  const handleRaidFinderHarvest = useCallback((target: DebrisFinderTarget) => {
    handleGalaxyAction(raidFinderHarvestAction(target), debrisTargetPlanetForMission(target), target.coordinates);
  }, [handleGalaxyAction, raidFinderHarvestAction]);

  const handleConfirmGalaxyMission = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingGalaxyMission;
    if (!pending) return;
    const { action, target, coords } = pending;
    const missionOriginPlanet = pending.originPlanet ?? selectedManagedPlanet;
    const originPlanetId = missionOriginPlanet?.planetId ?? activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }
    const driveLevels = driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels);
    const pendingLaunchOptions = ({
      cargo,
      missionType,
      targetPlanet,
      targetPlanetId,
      targetCoords,
      originIsMoon,
      targetIsMoon,
      validateAttackProtection,
      validateShipInventory,
    }: {
      cargo?: Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined;
      missionType: string;
      targetPlanet?: Planet | undefined;
      targetPlanetId: string;
      targetCoords: Coordinates;
      originIsMoon?: boolean | undefined;
      targetIsMoon?: boolean | undefined;
      validateAttackProtection?: { targetPlanetId: string } | undefined;
      validateShipInventory?: { originPlanetId: string; ships: MissionShips } | undefined;
    }) => ({
      validateAttackProtection,
      pendingMissionLaunch: (txHash: string) => pendingMissionLaunchForDraft(txHash, {
        account,
        originPlanet: missionOriginPlanet,
        originPlanetId,
        targetPlanet,
        targetPlanetId,
        targetCoords,
        missionType,
        draft,
        cargo,
        driveLevels,
        originIsMoon,
        targetIsMoon,
      }),
      syncMissionLaunch: true,
      validateShipInventory,
    });

    const closeMissionCreation = () => {
      setPendingGalaxyMission(null);
      setPendingJoinAttack(null);
      setPendingAcsDefend(null);
    };
    const closeMissionCreationWhenComplete = (transaction: Promise<boolean>) => {
      void (async () => {
        if (await transaction) closeMissionCreation();
      })();
    };

    if (action.mode === "colonize") {
      if (!target) {
        setGalaxyAction({ status: "error", label: "Colonization target is not a generated planet slot." });
        return;
      }
      const colonyLimitBlocker = colonizationLimitBlocker({
        planetCount: walletPlanets.length,
        researchTechnologyLevels: effectiveResearchState?.technologyLevels,
        shipyardTechnologyLevels: shipyardState?.technologyLevels,
      });
      if (colonyLimitBlocker) {
        setGalaxyAction({ status: "error", label: colonyLimitBlocker });
        return;
      }

      closeMissionCreationWhenComplete(runGalaxyTransaction("Colony mission", () => sendCreateColonyTransaction(
        provider,
        account,
        gameContract,
        originPlanetId,
        coords.galaxy,
        coords.system,
        coords.position,
        draft.speedPercent,
      ), pendingLaunchOptions({
        missionType: "Colonize",
        targetPlanetId: encodeColonizationTargetId(coords.galaxy, coords.system, coords.position),
        targetCoords: coords,
        validateShipInventory: { originPlanetId, ships: draft.ships },
      })));
      return;
    }

    const targetPlanetId = target?.occupiedBy?.planetId;
    if (!targetPlanetId) {
      setGalaxyAction({ status: "error", label: "Target planet has no public settlement record yet." });
      return;
    }

    if (action.mode === "missile") {
      closeMissionCreationWhenComplete(runGalaxyTransaction("Missile attack", () => sendLaunchInterplanetaryMissileAttackTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId,
          targetPlanetId,
          primaryTargetId: draft.primaryTargetId ?? action.primaryTargetId,
          quantity: draft.quantity ?? action.quantity,
        },
      )));
      return;
    }

    if (action.kind === "defenseHold") {
      // VEY-KANEO-440: proactive ACS Defend — station the fleet at the target own/ally planet for the
      // chosen hold window via launchDefenseHold (pre-flighted so ineligible / out-of-window /
      // under-fuelled reverts surface as a clear message before the wallet prompt).
      closeMissionCreationWhenComplete(runGalaxyTransaction("Stationed defense", () => sendLaunchDefenseHoldTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId,
          targetPlanetId,
          ships: draft.ships,
          speedPercent: draft.speedPercent,
          holdSeconds: draft.holdSeconds ?? 0,
        },
      ), pendingLaunchOptions({
        missionType: "DefenseHold",
        targetPlanet: target,
        targetPlanetId,
        targetCoords: coords,
        validateShipInventory: { originPlanetId, ships: draft.ships },
      })));
      return;
    }
    const supportsCargoMission = action.kind === "transport" || action.kind === "deploy";
    const supportsBodyMission = supportsCargoMission || action.kind === "attack";
    const originIsMoon = supportsBodyMission && draft.originIsMoon === true;
    const targetIsMoon = supportsBodyMission && draft.targetIsMoon === true;

    if (action.kind === "attack" && draft.lootRatio && !originIsMoon && !targetIsMoon) {
      const { metal, crystal, deuterium } = draft.lootRatio;
      closeMissionCreationWhenComplete(runGalaxyTransaction(`${action.label} mission`, () => sendLaunchAttackMissionTransaction(
          provider,
          account,
          gameContract,
          {
            originPlanetId,
            targetPlanetId,
            ships: draft.ships,
            speedPercent: draft.speedPercent,
            lootRatio: {
              metalBps: metal * 100,
              crystalBps: crystal * 100,
              deuteriumBps: deuterium * 100,
            },
          },
        ), pendingLaunchOptions({
          missionType: "Attack",
          targetPlanet: target,
          targetPlanetId,
          targetCoords: coords,
          validateAttackProtection: { targetPlanetId },
          validateShipInventory: { originPlanetId, ships: draft.ships },
        })));
      return;
    }
    const cargo = supportsCargoMission
      ? missionCargoFromDraft(draft.cargo) ?? transportCargoForSelectedPlanet(
          missionOriginPlanet,
          draft.ships,
          coords,
          driveLevels,
          draft.speedPercent,
        )
      : undefined;
    const launchParams = {
      originPlanetId,
      targetPlanetId,
      missionType: missionTypeId(action.mission),
      ships: draft.ships,
      speedPercent: draft.speedPercent,
      cargo,
    };
    const runMission = () => runGalaxyTransaction(`${action.label} mission`, () => (
      originIsMoon || targetIsMoon
        ? sendLaunchBodyFleetMissionTransaction(provider, account, gameContract, {
            ...launchParams,
            originIsMoon,
            targetIsMoon,
          })
        : sendLaunchFleetMissionTransaction(provider, account, gameContract, launchParams)
    ), pendingLaunchOptions({
      cargo,
      missionType: backendMissionTypeLabel(action.mission),
      targetPlanet: target,
      targetPlanetId,
      targetCoords: coords,
      originIsMoon,
      targetIsMoon,
      validateAttackProtection: action.kind === "attack" ? { targetPlanetId } : undefined,
      validateShipInventory: originIsMoon ? undefined : { originPlanetId, ships: draft.ships },
    }));
    closeMissionCreationWhenComplete(runMission());
  }, [
    account,
    activePlanetId,
    effectiveResearchState?.technologyLevels,
    gameContract,
    onChainSettlement?.homePlanetId,
    pendingGalaxyMission,
    provider,
    runGalaxyTransaction,
    selectedManagedPlanet,
    shipyardState?.technologyLevels,
    walletPlanets.length,
  ]);

  const handleStartMoonBuilding = useCallback((buildingId: number, label: string) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Start ${label}`, () => sendStartMoonBuildingUpgradeTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      buildingId,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleFinishMoonBuilding = useCallback((label: string) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Complete ${label}`, () => sendFinishMoonBuildingUpgradeTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleStartMoonDefense = useCallback((defenseId: number, label: string, quantity: number) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Build ${label}`, () => sendStartMoonDefenseProductionTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      defenseId,
      quantity,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleFinishMoonDefense = useCallback((label: string) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    void runMoonTransaction(`Complete ${label}`, () => sendFinishMoonDefenseProductionTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const handleJumpGate = useCallback((destinationPlanetId: string, ships?: Partial<MissionShips>) => {
    if (!provider || !account || !moonContract || !moonState?.homePlanetId) {
      setMoonAction({ status: "error", label: "Wallet, moon contract, or home planet is unavailable." });
      return;
    }

    const manifest = ships ? {
      ...emptyMissionShips(),
      ...ships,
    } : undefined;
    const transferShips = manifest && Object.values(manifest).some((quantity) => quantity > 0)
      ? manifest
      : undefined;
    void runMoonTransaction("Jump Gate transfer", () => sendJumpGateJumpTransaction(
      provider,
      account,
      moonContract,
      moonState.homePlanetId ?? "",
      destinationPlanetId,
      transferShips,
    ));
  }, [account, moonContract, moonState?.homePlanetId, provider, runMoonTransaction]);

  const runMissionTransaction = useCallback((label: string, request: () => Promise<string>) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    void runGatedTransaction(`mission:${label}`, async () => {
      setMissionAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });
      try {
        const txHash = await request();
        setMissionAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setMissionAction({ status: "pending", label: transactionSyncingLabel(label) });
        await refreshOnChainState(undefined, { force: true });
        setMissionAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        setMissionAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} transaction failed.`,
        });
      }
    });
  }, [account, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState, runGatedTransaction]);

  const handleRecallMission = useCallback((missionId: string) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    runMissionTransaction(`Recall mission #${missionId}`, () =>
      sendRecallFleetMissionTransaction(provider, account, gameContract, missionId)
    );
  }, [account, gameContract, provider, runMissionTransaction]);

  // VEY-KANEO-440: ACS Defend ("Group defend") opens the full compose picker (fleet + speed +
  // hold/holding-fuel + Alliance Depot preview) instead of firing a default fleet. Intercept was
  // removed from the frontend (VEY-KANEO-439), so this is the only remaining counterplay path.
  const handleMissionCounterplay = useCallback((mission: FleetMissionSummary, _mode: "acsDefend") => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setMissionAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const defended = mission.targetPlanet;
    const coords: Coordinates = defended
      ? { galaxy: defended.galaxy, system: defended.system, position: defended.position }
      : { galaxy: 0, system: 0, position: 0 };
    setMissionAction({ status: "idle" });
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend({
      hostileMissionId: mission.missionId,
      coords,
      hostileArrivalMs: Number(mission.arrivalAt) * 1_000,
      depotLevel: defended?.allianceDepotLevel ?? 0,
    });
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider]);

  const handleConfirmAcsDefend = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingAcsDefend;
    if (!pending) return;
    const originPlanetId = activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }

    const closeAcsDefendWhenComplete = (transaction: Promise<boolean>) => {
      void (async () => {
        if (await transaction) setPendingAcsDefend(null);
      })();
    };
    const driveLevels = driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels);
    // The hostile mission id is passed as targetPlanetId; the contract resolves the defended planet and
    // pins the defending fleet's arrival to the attack. The chosen speed controls the natural arrival
    // (and therefore the hold duration), so it must reach the chain.
    closeAcsDefendWhenComplete(runGalaxyTransaction("Group defense", () => sendLaunchFleetMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId,
        targetPlanetId: pending.hostileMissionId,
        missionType: missionTypeId("acsDefend"),
        ships: draft.ships,
        speedPercent: draft.speedPercent,
      },
    ), {
      pendingMissionLaunch: (txHash) => pendingMissionLaunchForDraft(txHash, {
        account,
        originPlanet: selectedManagedPlanet,
        originPlanetId,
        targetPlanetId: pending.hostileMissionId,
        targetCoords: pending.coords,
        missionType: "AcsDefend",
        draft,
        driveLevels,
      }),
      syncMissionLaunch: true,
      validateShipInventory: { originPlanetId, ships: draft.ships },
    }));
  }, [account, activePlanetId, gameContract, onChainSettlement?.homePlanetId, pendingAcsDefend, provider, runGalaxyTransaction, selectedManagedPlanet, shipyardState?.technologyLevels]);

  const handleShareMissionReport = useCallback((url: string) => {
    // Open the in-app share dialog (link + copy + social targets). It is a modal overlay, so the
    // viewer always gets a visible dialog and is never navigated away from the report (VEY-KANEO-339).
    if (!url) return;
    setShareDialogUrl(url);
  }, []);

  const handleJoinAttack = useCallback((attackMissionId: string, targetPlanetId: string, targetCoords: Coordinates | null) => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    // VEY-KANEO-431: open the Attack fleet picker so the player chooses the
    // fleet to commit, rather than sending a default counterplay fleet on click.
    setGalaxyAction({ status: "idle" });
    setPendingJoinAttack({
      attackMissionId,
      targetPlanetId,
      coords: targetCoords ?? { galaxy: 0, system: 0, position: 0 },
    });
  }, [account, gameContract, onChainSettlement?.homePlanetId, provider]);

  const handleConfirmJoinAttack = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingJoinAttack;
    if (!pending) return;
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    const closeJoinAttack = () => {
      setPendingJoinAttack(null);
      setPendingAcsDefend(null);
    };
    const driveLevels = driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels);
    void (async () => {
      const completed = await runGalaxyTransaction("Group attack join", () => sendJoinAttackMissionTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId: onChainSettlement.homePlanetId ?? "0",
          attackMissionId: pending.attackMissionId,
          targetPlanetId: pending.targetPlanetId,
          ships: draft.ships,
        },
      ), {
        pendingMissionLaunch: (txHash) => pendingMissionLaunchForDraft(txHash, {
          account,
          originPlanet: selectedManagedPlanet,
          originPlanetId: onChainSettlement.homePlanetId ?? "0",
          targetPlanetId: pending.targetPlanetId,
          targetCoords: pending.coords,
          missionType: "AcsAttack",
          draft,
          driveLevels,
        }),
        syncMissionLaunch: true,
        validateShipInventory: { originPlanetId: onChainSettlement.homePlanetId ?? "0", ships: draft.ships },
      });
      if (completed) closeJoinAttack();
    })();
  }, [account, gameContract, onChainSettlement?.homePlanetId, pendingJoinAttack, provider, runGalaxyTransaction, selectedManagedPlanet, shipyardState?.technologyLevels]);

  const handleNavigate = useCallback((target: Page) => {
    setPlanetBackRoute(null);
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    if (target !== "moon") {
      setSelectedBodyKind("planet");
    }
    setPage(target);
    setSelectedCoords(undefined);
    writeInspectRoute({ kind: "page", page: target });
  }, []);

  const handleOpenMissionReport = useCallback((missionId: string) => {
    setPlanetBackRoute(null);
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(missionId);
    setMissionReportId(null);
    setSelectedCoords(undefined);
    setPage("mission-control");
    writeInspectRoute({ kind: "mission", missionId });
  }, []);

  const handleOpenMissionReportList = useCallback(() => {
    setPlanetBackRoute(null);
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setPage("mission-control");
    setSelectedCoords(undefined);
    writeInspectRoute({ kind: "page", page: "mission-control" });
  }, []);

  const missionReportUrlForMission = useCallback((missionId: string) => {
    const path = buildInspectPath({ kind: "mission", missionId });
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  }, []);

  const handleSelectPlanet = useCallback((coords: Coordinates) => {
    setPlanetBackRoute(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId,
      inspectedPlayerWallet,
      missionDetailId,
      missionReportId,
      page,
    }));
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setGalaxyNav({ galaxy: coords.galaxy, system: coords.system });
    setSelectedCoords(coords);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setPage("planet");
    writeInspectRoute({ kind: "planet", coords });
  }, [inspectedAllianceId, inspectedPlayerWallet, missionDetailId, missionReportId, page]);

  const handleSelectMoon = useCallback((coords: Coordinates) => {
    setPlanetBackRoute(planetDetailBackRouteForCurrentScreen({
      inspectedAllianceId,
      inspectedPlayerWallet,
      missionDetailId,
      missionReportId,
      page,
    }));
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setGalaxyNav({ galaxy: coords.galaxy, system: coords.system });
    setSelectedCoords(coords);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setPage("moon-inspect");
    writeInspectRoute({ kind: "moon", coords });
  }, [inspectedAllianceId, inspectedPlayerWallet, missionDetailId, missionReportId, page]);

  const handlePlanetDetailBack = useCallback(() => {
    if (hasUsefulPlanetDetailBackRoute(planetBackRoute) && typeof window !== "undefined" && window.history.length > 1) {
      setPlanetBackRoute(null);
      window.history.back();
      return;
    }

    setPlanetBackRoute(null);
    handleNavigate("galaxy");
  }, [handleNavigate, planetBackRoute]);

  // VEY-KANEO-440: the "Defend a planet" CTA (Mission Control + Defenses "Stationed defenses" panel)
  // opens the player's own home planet detail rather than the bare Galaxy grid. Every wallet has a home
  // planet, and its detail always renders a Defend control — enabled-and-explained where eligible, or
  // disabled-and-explained on the launch planet itself (galaxyActions surfaces it for `isOrigin`). That
  // guarantees the CTA lands on a screen that visibly shows Defend + the eligibility reason, instead of
  // dropping the player into Galaxy where a single-colony / no-alliance wallet sees only foreign planets
  // (Attack/Harvest/Missile) and reads the feature as missing — the repeated QA "no Defend button
  // anywhere" bounce. From there the player can navigate to another colony or an ally planet to launch.
  const handleDefendPlanet = useCallback(() => {
    if (homeCoords) {
      handleSelectPlanet(homeCoords);
      return;
    }
    setPage("galaxy");
  }, [handleSelectPlanet, homeCoords]);

  const handleSelectAlliance = useCallback((allianceId: string) => {
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setSelectedAllianceId(allianceId);
    setInspectedAllianceId(allianceId);
    setInspectedPlayerWallet(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setSelectedCoords(undefined);
    setPage("alliance-inspect");
    writeInspectRoute({ kind: "alliance", allianceId });
  }, []);

  const handleSelectPlayer = useCallback((wallet: string) => {
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setInspectedPlayerWallet(wallet);
    setInspectedAllianceId(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setSelectedCoords(undefined);
    setPage("player-inspect");
    writeInspectRoute({ kind: "player", wallet });
  }, []);

  const handleOpenRequirement = useCallback((target: RequirementTarget) => {
    setSelectedCoords(undefined);

    if (target.kind === "building") {
      setSelectedBuildingKey(target.key);
      setPage("infrastructure");
      return;
    }

    if (target.kind === "research") {
      setSelectedResearchKey(target.key);
      setPage("research");
      return;
    }

    setSelectedShipKey(target.key);
    setPage("shipyard");
  }, []);

  const topBar = (
    <TopBar
      caps={caps}
      crawlerProduction={infrastructureChainState?.crawlerProduction}
      energy={topBarEnergy}
      isWalletConnected={isWalletConnected}
      queue={isWalletConnected ? undefined : settledState.queue}
      rates={rates}
      resourceStatus={isWalletConnected && !walletPlanetHydrated && onChainStatus !== "error" ? "loading" : isWalletConnected ? onChainStatus : "local"}
      researchQueue={isWalletConnected ? undefined : settledState.researchQueue}
      resources={isWalletConnected ? spendableResources : settledState.resources}
    />
  );

  const mobilePlanetPicker = walletPlanets.length > 0 ? (
    <PlanetSelector
      fleetVisibility={displayFleetVisibility}
      layout="mobile"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
      selectedBodyKind={activeBodyKind}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  // Below `md` the picker lives inside the hamburger menu; between `md` and `lg`
  // (no right sidebar, no hamburger) it stays as a compact row above content.
  const compactPlanetSelector = mobilePlanetPicker ? (
    <div className="mb-3 hidden md:block lg:hidden">
      {mobilePlanetPicker}
    </div>
  ) : null;

  const planetSidebar = walletPlanets.length > 0 ? (
    <PlanetSelector
      fleetVisibility={displayFleetVisibility}
      layout="sidebar"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
      selectedBodyKind={activeBodyKind}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  const missionDetailShareUrl = typeof window === "undefined" || !missionDetailId
    ? ""
    : `${window.location.origin}/mission/${encodeURIComponent(missionDetailId)}`;
  const battleReportsShareUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}${buildInspectPath({ kind: "page", page: "battle-reports" })}`;
  const gameTransactionInputsAvailable = gameActionsAvailableForBody(activeBodyKind, Boolean(provider && account && gameContract));
  const allianceTransactionInputsAvailable = Boolean(provider && account && allianceContract);
  const moonTransactionInputsAvailable = Boolean(provider && account && moonContract);
  const chickenBurnTransactionInputsAvailable = Boolean(provider && account && chickenBurnConfig);
  const gameTransactionUnavailableReason = transactionUnavailableReasonFor({
    activeActionLabel: pendingActionLabel(
      buildingAction,
      defenseAction,
      shipyardAction,
      galaxyAction,
      researchAction,
      riftAction,
      planetManagementAction,
      planetRenameAction,
      missionAction,
    ),
    inputsAvailable: gameTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: "Wallet or game contract unavailable",
  });
  const allianceTransactionUnavailableReason = transactionUnavailableReasonFor({
    activeActionLabel: pendingActionLabel(allianceAction),
    inputsAvailable: allianceTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: "Alliance contract unavailable.",
  });
  const moonTransactionUnavailableReason = transactionUnavailableReasonFor({
    activeActionLabel: pendingActionLabel(moonAction),
    inputsAvailable: moonTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: "Wallet or moon contract unavailable.",
  });
  const canSubmitGameTransaction = gameTransactionInputsAvailable && !transactionActionPending;
  const canSubmitAllianceTransaction = allianceTransactionInputsAvailable && !transactionActionPending;
  const canSubmitMoonTransaction = moonTransactionInputsAvailable && !transactionActionPending;
  const canSubmitChickenBurnTransaction = chickenBurnTransactionInputsAvailable && !transactionActionPending;
  const canSubmitProfileMutation = Boolean(provider && account && apiBaseUrl) && !transactionActionPending;
  const missionLaunchBlocker = gameTransactionUnavailableReason ?? missionLaunchStateBlocker;
  const activePlanetSections = planetSectionAccessForPlanet(planetSectionStore, activePlanetId, {
    settlementState: () => refreshOnChainState(),
    queuesState: () => refreshOnChainState(),
    fleetVisibilityState: refreshMissionControl,
    infrastructureChainState: refreshInfrastructureState,
    moonState: refreshInfrastructureState,
    defenseState: refreshDefenseState,
    shipyardState: refreshShipyardState,
    researchState: refreshResearchState,
    riftState: refreshRiftState,
    missionArchiveState: () => loadMissionArchive(missionArchivePage),
    allActiveMissionsState: loadAllActiveMissions,
    globalMissionArchiveState: () => loadGlobalMissionArchive(globalMissionArchivePage),
    missionArchetypesByCoordinate: refreshMissionUniverseSystems,
    galaxySystemDataByKey: refreshMissionUniverseSystems,
  });
  const infrastructureSection = activePlanetSections.read("infrastructureChainState");
  const moonSection = activePlanetSections.read("moonState");
  const defenseSection = activePlanetSections.read("defenseState");
  const shipyardSection = activePlanetSections.read("shipyardState");
  const researchSection = activePlanetSections.read("researchState");
  const riftSection = activePlanetSections.read("riftState");
  const missionArchiveSection = activePlanetSections.read("missionArchiveState");
  const globalMissionArchiveSection = activePlanetSections.read("globalMissionArchiveState");

  const content = (() => {
    if (page === "battle-reports") {
      return (
        <BattleReportsPage
          error={publicBattleReportsError}
          loading={publicBattleReportsLoading}
          onBack={() => handleNavigate("mission-control")}
          onOpenBattleReport={handleOpenMissionReport}
          onRetry={loadPublicBattleReports}
          reports={publicBattleReports}
          shareUrl={battleReportsShareUrl}
        />
      );
    }

    if (missionDetailId) {
      return (
        <MissionDetailPage
          actionState={missionAction}
          canTransact={canSubmitGameTransaction}
          detail={missionDetail}
          error={missionDetailError}
          fleetVisibility={displayFleetVisibility}
          loading={missionDetailLoading}
          missionId={missionDetailId}
          now={now}
          onBack={() => handleNavigate("mission-control")}
          onShareReport={() => handleShareMissionReport(missionDetailShareUrl)}
          onCounterplay={handleMissionCounterplay}
          onRecall={handleRecallMission}
          onRetry={loadMissionDetail}
          onSelectCoordinates={handleSelectPlanet}
          onSelectPlayer={handleSelectPlayer}
        />
      );
    }

    if (!walletPlanetHydrated) {
      return (
        <HydratingPlanetState
          error={onChainError}
          onRetry={() => void refreshOnChainState()}
          status={onChainStatus}
          txHash={planet?.txHash}
        />
      );
    }

    if (pendingGalaxyMission) {
      const pendingMissionOriginPlanet = pendingGalaxyMission.originPlanet ?? selectedManagedPlanet;
      const pendingMissionOriginCoords = managedPlanetCoordinates(pendingMissionOriginPlanet) ?? activePlanetCoords;
      const pendingMissionOriginLabel = pendingMissionOriginPlanet?.name
        ?? pendingMissionOriginPlanet?.coordinates
        ?? homePlanetIdentity?.name;
      const pendingMissionOriginResources = missionResourcesForOrigin(pendingMissionOriginPlanet);
      const pendingMissionOriginMoonLoaded = Boolean(
        pendingMissionOriginPlanet?.moon?.exists
          && moonState?.moon?.exists
          && moonState.moon.planetId === pendingMissionOriginPlanet.planetId
      );
      const pendingMissionBodySelection = pendingGalaxyMission.action.mode === "mission"
        && (
          pendingGalaxyMission.action.kind === "attack"
            || pendingGalaxyMission.action.kind === "transport"
            || pendingGalaxyMission.action.kind === "deploy"
        )
        ? {
            originMoonAvailable: pendingMissionOriginMoonLoaded,
            targetMoonAvailable: Boolean(pendingGalaxyMission.target?.hasMoon),
            originMoonResources: pendingMissionOriginMoonLoaded ? missionMoonResources(moonState) : undefined,
            originMoonShipyardState: pendingMissionOriginMoonLoaded
              ? missionMoonShipyardState({ moonState, shipyardState })
              : null,
          }
        : undefined;
      return (
        <MissionCreationPage
          action={pendingGalaxyMission.action}
          actionPending={galaxyAction.status === "pending"}
          actionPendingLabel={galaxyAction.status === "pending" ? galaxyAction.label : undefined}
          attackerCombatTechLevels={attackerCombatTechLevels}
          bodySelection={pendingMissionBodySelection}
          coords={pendingGalaxyMission.coords}
          defenseHoldContext={pendingGalaxyMission.action.kind === "defenseHold"
            ? { depotLevel: allianceDepotLevelFromPlanet(pendingGalaxyMission.target) }
            : undefined}
          defenseHoldMode={pendingGalaxyMission.action.kind === "defenseHold"}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          onBack={() => setPendingGalaxyMission(null)}
          onConfirm={handleConfirmGalaxyMission}
          originCoords={pendingMissionOriginCoords}
          originLabel={pendingMissionOriginLabel}
          resources={pendingMissionOriginResources}
          shipyardState={shipyardState}
          submitBlocker={missionLaunchBlocker}
          target={pendingGalaxyMission.target}
        />
      );
    }

    if (pendingJoinAttack) {
      return (
        <MissionCreationPage
          action={{ enabled: true, kind: "attack", label: "Join attack", mode: "mission", mission: "attack", ships: emptyMissionShips() }}
          actionPending={galaxyAction.status === "pending"}
          actionPendingLabel={galaxyAction.status === "pending" ? galaxyAction.label : undefined}
          attackerCombatTechLevels={attackerCombatTechLevels}
          coords={pendingJoinAttack.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          joinAttackMode
          onBack={() => setPendingJoinAttack(null)}
          onConfirm={handleConfirmJoinAttack}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
          submitBlocker={missionLaunchBlocker}
          target={undefined}
        />
      );
    }

    if (pendingAcsDefend) {
      return (
        <MissionCreationPage
          acsDefendContext={{ hostileArrivalMs: pendingAcsDefend.hostileArrivalMs, depotLevel: pendingAcsDefend.depotLevel }}
          acsDefendMode
          action={{ enabled: true, kind: "acsDefend", label: "Group defend", mode: "mission", mission: "acsDefend", ships: emptyMissionShips() }}
          actionPending={galaxyAction.status === "pending"}
          actionPendingLabel={galaxyAction.status === "pending" ? galaxyAction.label : undefined}
          attackerCombatTechLevels={attackerCombatTechLevels}
          coords={pendingAcsDefend.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          onBack={() => setPendingAcsDefend(null)}
          onConfirm={handleConfirmAcsDefend}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
          submitBlocker={missionLaunchBlocker}
          target={undefined}
        />
      );
    }

    if (page === "galaxy") {
      return (
        <GalaxyView
          account={account}
          actionState={galaxyAction}
          apiBaseUrl={apiBaseUrl}
          galaxy={galaxyNav.galaxy}
          homeCoords={activePlanetCoords}
          homePlanetId={activePlanetId ?? onChainSettlement?.homePlanetId}
          homePlanet={homePlanetIdentity}
          defenseState={defenseState}
          shipyardState={missionActionShipyardState}
          onAction={handleGalaxyAction}
          onSelectAlliance={handleSelectAlliance}
          onSelectPlayer={handleSelectPlayer}
          onToggleWatchPlanet={handleToggleWatchPlanet}
          onNavigate={(g, s) => setGalaxyNav({ galaxy: g, system: s })}
          onSelectMoon={handleSelectMoon}
          onSelectPlanet={handleSelectPlanet}
          system={galaxyNav.system}
          transactionUnavailableReason={gameTransactionUnavailableReason}
          watchedPlanetIds={watchedPlanets?.watchedPlanetIds ?? []}
          watchBusyPlanetId={watchBusyPlanetId}
        />
      );
    }

    if (page === "planet" && selectedCoords) {
      return (
        <PlanetDetail
          account={account}
          actionState={galaxyAction}
          apiBaseUrl={apiBaseUrl}
          coords={selectedCoords}
          defenseState={defenseState}
          homeCoords={activePlanetCoords}
          homePlanetId={activePlanetId ?? onChainSettlement?.homePlanetId}
          homePlanet={homePlanetIdentity}
          onAction={handleGalaxyAction}
          onBack={handlePlanetDetailBack}
          shipyardState={missionActionShipyardState}
          transactionUnavailableReason={gameTransactionUnavailableReason}
        />
      );
    }

    if (page === "moon-inspect" && selectedCoords) {
      return (
        <PublicMoonDetail
          apiBaseUrl={apiBaseUrl}
          coords={selectedCoords}
          onBack={handlePlanetDetailBack}
        />
      );
    }

    if (page === "infrastructure") {
      return (
        <InfrastructurePage
          actionNotice={infrastructureActionNotice}
          actionPendingLabel={infrastructureActionPendingLabel}
          actionUnavailableReason={infrastructureUnavailableReason}
          chainCosts={chainBuildingCosts}
          chainDurations={chainBuildingDurations}
          hasLoadedInfrastructureState={hasInfrastructureDisplayState({
            activeBuildingQueue,
            homePlanetId: onChainSettlement?.homePlanetId,
            infrastructureChainState,
            onChainResources,
          })}
          loading={infrastructureLoading || infrastructureSection.status.loading}
          loadError={infrastructureLoadErrorFor({
            activeBuildingQueue,
            infrastructureChainState,
            infrastructureError: infrastructureSection.status.error ?? infrastructureError,
            isWalletConnected,
          })}
          now={now}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={infrastructureSection.refresh ?? refreshInfrastructureState}
          onSelectBuilding={setSelectedBuildingKey}
          onUpgrade={handleUpgrade}
          planetProductionProfile={planetProductionProfile}
          productionRates={productionRatesForEta}
          selectedBuildingKey={selectedBuildingKey}
          spendableResources={spendableResources}
          starterPlanet={selectedManagedPlanet?.isHomePlanet ?? activePlanetId === onChainSettlement?.homePlanetId}
          settledState={infrastructureState}
          state={state}
          transactionUnavailableReason={gameTransactionUnavailableReason}
        />
      );
    }

    if (page === "moon") {
      return (
        <MoonPage
          action={moonAction}
          burningChicken={{
            configured: Boolean(chickenBurnConfig),
            maxMoonsPerPlayer: maxChickenBurnMoonsPerPlayer,
            moonCount: walletMoonCount,
          }}
          canBurnChicken={canSubmitChickenBurnTransaction}
          canTransact={canSubmitMoonTransaction}
          error={moonSection.status.error ?? moonError}
          loading={moonLoading || moonSection.status.loading}
          moonState={moonState}
          onBurnChicken={handleBurnChickenForMoon}
          onFinishBuilding={handleFinishMoonBuilding}
          onFinishDefense={handleFinishMoonDefense}
          onJumpGate={handleJumpGate}
          onRefresh={moonSection.refresh ?? refreshInfrastructureState}
          onStartBuilding={handleStartMoonBuilding}
          onStartDefense={handleStartMoonDefense}
          parentPlanetLabel={selectedManagedPlanet?.name ?? selectedManagedPlanet?.coordinates}
          parentPlanetType={selectedManagedPlanet ? planetTypeFromTemperature(selectedManagedPlanet.temperature) : undefined}
          transactionUnavailableReason={moonTransactionUnavailableReason}
        />
      );
    }

    if (page === "mission-control") {
      return (
        <MissionControlPage
          actionState={missionAction}
          allActiveMissions={displayAllActiveMissions}
          canTransact={canSubmitGameTransaction}
          fleetVisibility={displayFleetVisibility}
          globalMissionArchive={globalMissionArchive}
          globalMissionArchiveError={globalMissionArchiveSection.status.error ?? globalMissionArchiveError}
          globalMissionArchiveLoading={globalMissionArchiveLoading || globalMissionArchiveSection.status.loading}
          incomingAttackArchive={incomingAttackArchive}
          incomingAttackArchiveError={incomingAttackArchiveError}
          incomingAttackArchiveLoading={incomingAttackArchiveLoading}
          loading={isWalletConnected && onChainStatus === "loading"}
          missionArchive={missionArchive}
          missionArchiveError={missionArchiveSection.status.error ?? missionArchiveError}
          missionArchiveLoading={missionArchiveLoading || missionArchiveSection.status.loading}
          missionNumberSearch={missionNumberSearch}
          now={now}
          onCounterplay={handleMissionCounterplay}
          onDefendPlanet={handleDefendPlanet}
          onJoinAttack={handleJoinAttack}
          onOpenReport={handleOpenMissionReport}
          onOpenReportList={handleOpenMissionReportList}
          onRecall={handleRecallMission}
          onGlobalMissionArchivePageChange={(page) => void loadGlobalMissionArchive(page)}
          onIncomingAttackArchivePageChange={(page) => void loadIncomingAttackArchive(page)}
          onMissionArchivePageChange={(page) => void loadMissionArchive(page)}
          onMissionNumberSearchChange={setMissionNumberSearch}
          onRefresh={() => void activePlanetSections.refresh("fleetVisibilityState")}
          planetArchetypesByCoordinate={missionPlanetArchetypesByCoordinate}
          reportMissionId={missionReportId ?? undefined}
          reportUrlForMission={missionReportUrlForMission}
          transactionUnavailableReason={gameTransactionUnavailableReason}
          walletPlanets={walletPlanets}
        />
      );
    }

    if (page === "research") {
      return (
        <ResearchPage
          actionState={researchAction}
          canTransact={canSubmitGameTransaction}
          error={researchSection.status.error ?? researchError}
          loading={researchLoading || researchSection.status.loading}
          now={now}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={researchSection.refresh ?? refreshResearchState}
          onResearch={handleResearch}
          onSelectResearch={setSelectedResearchKey}
          productionRates={productionRatesForEta}
          researchState={effectiveResearchState}
          selectedResearchKey={selectedResearchKey}
          spendableResources={spendableResources}
          settledState={settledState}
          state={state}
          transactionUnavailableReason={gameTransactionUnavailableReason}
          useLocalStateFallback={!isWalletConnected}
        />
      );
    }

    if (page === "defenses") {
      return (
        <DefensePage
          actionState={defenseAction}
          canTransact={canSubmitGameTransaction}
          defenseState={defenseState}
          error={defenseSection.status.error ?? defenseError}
          loading={defenseLoading || defenseSection.status.loading}
          now={now}
          onBuild={handleBuildDefense}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={defenseSection.refresh ?? refreshDefenseState}
          onSelectDefense={setSelectedDefenseKey}
          overviewQueue={onChainQueues?.defense}
          productionRates={productionRatesForEta}
          selectedDefenseKey={selectedDefenseKey}
          spendableResources={spendableResources}
          transactionUnavailableReason={gameTransactionUnavailableReason}
        />
      );
    }

    if (page === "alliance") {
      return (
        <AlliancePage
          actionState={allianceAction}
          allianceState={allianceState}
          apiBaseUrl={apiBaseUrl}
          canTransact={canSubmitAllianceTransaction}
          error={allianceError}
          loading={allianceLoading}
          selectedAllianceId={selectedAllianceId}
          transactionUnavailableReason={allianceTransactionUnavailableReason}
          onAcceptInvite={handleAcceptAllianceInvite}
          onApproveJoinRequest={handleApproveAllianceJoinRequest}
          onBatchKick={handleBatchKickAllianceMembers}
          onBatchSetRole={handleBatchSetAllianceRole}
          onCancelJoinRequest={handleCancelAllianceJoinRequest}
          onCreate={handleCreateAlliance}
          onDismissJoinRequest={handleDismissAllianceJoinRequest}
          onJoinRequest={handleRequestAllianceJoin}
          onKick={handleKickAllianceMember}
          onInvite={handleInviteAllianceMember}
          onLeaveAlliance={handleLeaveAlliance}
          onOpenAlliance={handleSelectAlliance}
          onOpenPlayer={handleSelectPlayer}
          onRefresh={refreshAllianceState}
          onSetDiplomacy={handleSetAllianceDiplomacy}
          onSetRole={handleSetAllianceRole}
          onTransferOwnership={handleTransferAllianceOwnership}
          onUpdateProfile={handleUpdateAllianceProfile}
        />
      );
    }

    if (page === "alliance-inspect" && inspectedAllianceId) {
      return (
        <AllianceInspectPage
          actionBusy={allianceAction.status === "pending"}
          allianceId={inspectedAllianceId}
          allianceState={allianceState}
          canTransact={canSubmitAllianceTransaction}
          disabled={allianceLoading}
          transactionUnavailableReason={allianceTransactionUnavailableReason}
          onApproveJoinRequest={handleApproveAllianceJoinRequest}
          onBack={() => handleNavigate("alliance")}
          onBatchKick={handleBatchKickAllianceMembers}
          onBatchSetRole={handleBatchSetAllianceRole}
          onDismissJoinRequest={handleDismissAllianceJoinRequest}
          onInvite={handleInviteAllianceMember}
          onKick={handleKickAllianceMember}
          onLeaveAlliance={handleLeaveAlliance}
          onOpenPlayer={handleSelectPlayer}
          onRefresh={refreshAllianceState}
          onSetRole={handleSetAllianceRole}
          onTransferOwnership={handleTransferAllianceOwnership}
        />
      );
    }

    if (page === "player-inspect" && inspectedPlayerWallet) {
      return (
        <PlayerInspectPage
          apiBaseUrl={apiBaseUrl}
          currentWallet={account}
          onBack={() => handleNavigate("rankings")}
          onOpenAlliance={handleSelectAlliance}
          onSelectPlanet={handleSelectPlanet}
          originCoords={activePlanetCoords}
          wallet={inspectedPlayerWallet}
        />
      );
    }

    if (page === "shipyard") {
      return (
        <ShipyardPage
          actionState={shipyardAction}
          canTransact={canSubmitGameTransaction}
          error={shipyardSection.status.error ?? shipyardError}
          loading={shipyardLoading || shipyardSection.status.loading}
          now={now}
          onBuild={handleBuildShip}
          onCollect={shipyardSection.refresh ?? refreshShipyardState}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={shipyardSection.refresh ?? refreshShipyardState}
          onSelectShip={setSelectedShipKey}
          overviewQueue={onChainQueues?.ship}
          productionRates={productionRatesForEta}
          selectedShipKey={selectedShipKey}
          shipyardState={shipyardState}
          spendableResources={spendableResources}
          transactionUnavailableReason={gameTransactionUnavailableReason}
        />
      );
    }

    if (page === "rift") {
      return (
        <RiftPage
          actionState={riftAction}
          canTransact={canSubmitGameTransaction}
          error={riftSection.status.error ?? riftError}
          loading={riftLoading || riftSection.status.loading}
          now={now}
          onApprove={handleApproveRiftResource}
          onDeposit={handleDepositRiftResource}
          onFinishWithdrawal={handleFinishRiftWithdrawal}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={riftSection.refresh ?? refreshRiftState}
          onRequestWithdrawal={handleRequestRiftWithdrawal}
          riftState={riftState}
          transactionUnavailableReason={gameTransactionUnavailableReason}
        />
      );
    }

    if (page === "rankings") {
      return (
        <RankingsPage
          activeMissions={displayAllActiveMissions}
          apiBaseUrl={apiBaseUrl}
          currentAllianceId={allianceState?.membership.allianceId}
          currentWallet={account}
          now={now}
          onSelectAlliance={handleSelectAlliance}
          onSelectMoon={handleSelectMoon}
          onSelectPlayer={handleSelectPlayer}
          onSelectPlanet={handleSelectPlanet}
          originCoordinates={activePlanetCoords}
        />
      );
    }

    if (page === "raid-target-finder") {
      return (
        <RaidTargetFinderPage
          activeMissions={displayAllActiveMissions}
          apiBaseUrl={apiBaseUrl}
          attackActionForTarget={raidFinderAttackActionState}
          currentAllianceId={allianceState?.membership.allianceId}
          currentWallet={account}
          fleetVisibility={displayFleetVisibility}
          harvestActionForDebrisTarget={raidFinderHarvestActionState}
          now={now}
          onAttackTarget={handleRaidFinderAttack}
          onHarvestDebrisTarget={handleRaidFinderHarvest}
          onSelectAlliance={handleSelectAlliance}
          onSelectMoon={handleSelectMoon}
          onSelectPlanet={handleSelectPlanet}
          onSelectPlayer={handleSelectPlayer}
          originCoordinates={activePlanetCoords}
          shipyardState={shipyardState}
        />
      );
    }

    return (
      <OverviewPage
        caps={caps}
        isWalletConnected={isWalletConnected}
        now={now}
        onChainError={onChainError}
        fleetVisibility={overviewFleetVisibility}
        onChainQueues={overviewOnChainQueues}
        onChainSettlement={onChainSettlement}
        onChainStatus={isWalletConnected ? onChainStatus : "local"}
        buildingActionNotice={infrastructureActionNotice}
        buildingActionPendingLabel={infrastructureActionPendingLabel}
        onNavigate={(target) => handleNavigate(target)}
        onRenamePlanet={handleRenamePlanet}
        homePlanet={homePlanetIdentity}
        buildingQueue={buildingQueue}
        planet={planet}
        queueProgress={queueProgress}
        rates={rates}
        researchAction={researchAction}
        researchProgress={researchProgress}
        settledState={settledState}
        shipProgress={shipProgress}
        state={state}
        canRenamePlanet={Boolean(canSubmitGameTransaction && activePlanetId)}
        planetRenameAction={planetRenameAction}
        canAbandonPlanet={selectedManagedPlanet
          ? shouldShowAbandonPlanetButton(selectedManagedPlanet, canSubmitGameTransaction, planetManagementAction)
          : false}
        onAbandonPlanet={handleAbandonPlanet}
        onSelectAlliance={handleSelectAlliance}
        onSelectPlanet={handleSelectPlanet}
        onSelectPlayer={handleSelectPlayer}
        onToggleWatchPlanet={handleToggleWatchPlanet}
        planetManagementAction={planetManagementAction}
        usedFields={selectedManagedPlanet?.fieldsUsed}
        watchedPlanets={watchedPlanets}
        watchedPlanetsError={watchedPlanetsError}
        watchedPlanetsLoading={watchedPlanetsLoading}
        watchedPlanetsPage={watchedPlanetsPage}
        onWatchedPlanetsPageChange={setWatchedPlanetsPage}
        onRefreshWatchedPlanets={() => void refreshWatchedPlanets(watchedPlanetsPage)}
        watchBusyPlanetId={watchBusyPlanetId}
        myPlanets={overviewMyPlanetActionGroups}
        currentCommanderLabel={playerProfile?.displayName ?? "You"}
        selectedPlanetId={activePlanetId}
        onMyPlanetAction={handleOverviewMyPlanetAction}
      />
    );
  })();

  return (
    <div className="playable-starfield relative isolate min-h-dvh overflow-hidden bg-[#05070f] text-slate-100">
      {topBar}

      <div className="relative z-10 mx-auto flex max-w-[96rem] flex-col md:h-[calc(100dvh-2.75rem)] md:flex-row md:overflow-hidden">
        <NavBar
          account={account}
          active={page}
          canEditPlayerProfile={canSubmitProfileMutation}
          coordinates={homeCoordinateLabel}
          onConnectWallet={onConnectWallet}
          onNavigate={handleNavigate}
          onUpdatePlayerProfile={handleUpdatePlayerProfile}
          planetPicker={mobilePlanetPicker}
          playerProfile={playerProfile}
          playerProfileAction={playerProfileAction}
        />

        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          {compactPlanetSelector}
          {content}
        </main>

        {planetSidebar}
      </div>

      {shareDialogUrl ? (
        <ShareDialog onClose={() => setShareDialogUrl(null)} url={shareDialogUrl} />
      ) : null}
    </div>
  );
}

function PlanetSelector({
  fleetVisibility,
  layout,
  onSelect,
  planets,
  selectedBodyKind,
  selectedPlanetId,
}: {
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  layout: "mobile" | "sidebar";
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planets: ManagedPlanetResponse[];
  selectedBodyKind: OrbitBodyKind;
  selectedPlanetId: string | undefined;
}) {
  const selectedPlanet = planets.find((planet) => planet.planetId === selectedPlanetId) ?? planets[0];
  if (!selectedPlanet) return null;

  if (layout === "mobile") {
    return (
      <section aria-label="Select planet" className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <div className="flex w-max min-w-full gap-2 pb-1">
          {planets.map((planet) => (
            <PlanetSelectorItem
              fleetVisibility={fleetVisibility}
              key={planet.planetId}
              onSelect={onSelect}
              planet={planet}
              selectedBodyKind={selectedBodyKind}
              selectedPlanet={selectedPlanet}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <aside aria-label="Select planet" className="hidden w-28 shrink-0 border-l border-white/10 bg-[#07111d]/92 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {planets.map((planet) => (
          <PlanetSelectorItem
            fleetVisibility={fleetVisibility}
            key={planet.planetId}
            onSelect={onSelect}
            planet={planet}
            selectedBodyKind={selectedBodyKind}
            selectedPlanet={selectedPlanet}
          />
        ))}
      </div>
    </aside>
  );
}

function PlanetSelectorItem({
  fleetVisibility,
  onSelect,
  planet,
  selectedBodyKind,
  selectedPlanet,
}: {
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planet: ManagedPlanetResponse;
  selectedBodyKind: OrbitBodyKind;
  selectedPlanet: ManagedPlanetResponse;
}) {
  const selectedPlanetBody = planet.planetId === selectedPlanet.planetId && selectedBodyKind === "planet";
  const selectedMoonBody = planet.planetId === selectedPlanet.planetId && selectedBodyKind === "moon";
  const hasDedicatedMoonSelector = Boolean(planet.moon?.exists);
  return (
    <div
      className="grid w-20 shrink-0 gap-1"
      data-planet-selector-item={planet.planetId}
    >
      <PlanetSelectorButton
        bodyKind="planet"
        hasIncomingAttack={planetHasIncomingAttack(fleetVisibility, planet.planetId)}
        onSelect={onSelect}
        planet={planet}
        selected={selectedPlanetBody}
        showMoonIndicator={planet.moon?.exists === true && !hasDedicatedMoonSelector}
      />
      {planet.moon?.exists ? (
        <PlanetSelectorMoonButton
          onSelect={onSelect}
          planet={planet}
          selected={selectedMoonBody}
        />
      ) : null}
    </div>
  );
}

function PlanetSelectorButton({
  bodyKind,
  hasIncomingAttack,
  onSelect,
  planet,
  selected,
  showMoonIndicator,
}: {
  bodyKind: OrbitBodyKind;
  hasIncomingAttack: boolean;
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planet: ManagedPlanetResponse;
  selected: boolean;
  showMoonIndicator: boolean;
}) {
  const bodyLabel = bodyKind === "moon" ? "moon" : "planet";
  const label = `${hasIncomingAttack ? "Incoming attack warning. " : ""}Select ${planetDisplayName(planet)} ${bodyLabel} at ${planet.coordinates}`;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      className={`veydrift-planet-selector-button group relative grid w-20 shrink-0 justify-items-center gap-1 rounded border p-1.5 text-center transition focus:outline-none ${
        hasIncomingAttack
          ? "border-red-400/70 bg-red-500/15 shadow-lg shadow-red-950/25"
          : selected
          ? "border-cyan-300/35 bg-cyan-300/[0.07] shadow-[inset_0_0_0_1px_rgba(128,241,255,0.10)]"
          : "border-white/10 bg-white/[0.045] hover:border-cyan-200/40 hover:bg-white/[0.075]"
      }`}
      onClick={() => onSelect(planet.planetId, bodyKind)}
      type="button"
    >
      {hasIncomingAttack ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 inline-grid h-5 w-5 place-items-center rounded-full border border-red-300/60 bg-red-500/85 text-white shadow shadow-red-950/40"
          title="Incoming attack"
        >
          <AlertTriangle size={12} strokeWidth={2.4} />
        </span>
      ) : null}
      <span className="relative h-14 w-14 overflow-hidden rounded-full bg-black/30">
        <img
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          src={planetImage(planet)}
        />
        {showMoonIndicator ? <PlanetMoonIndicator compact planetType={planetTypeFromTemperature(planet.temperature)} /> : null}
      </span>
      <span className="block max-w-full truncate text-[0.68rem] font-medium leading-4 text-slate-200">
        {planetDisplayName(planet)}
      </span>
      <span className="block max-w-full truncate font-mono text-[0.6rem] leading-3 text-slate-400">
        {planet.coordinates}
      </span>
    </button>
  );
}

function PlanetSelectorMoonButton({
  onSelect,
  planet,
  selected,
}: {
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planet: ManagedPlanetResponse;
  selected: boolean;
}) {
  const label = `Select ${planetDisplayName(planet)} moon at ${planet.coordinates}`;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 rounded border px-1.5 py-1 text-left transition focus:outline-none ${
        selected
          ? "border-cyan-200/45 bg-cyan-200/[0.10] text-cyan-100"
          : "border-cyan-200/15 bg-cyan-200/[0.055] text-slate-300 hover:border-cyan-200/35 hover:bg-cyan-200/[0.09]"
      }`}
      data-planet-selector-moon="true"
      onClick={() => onSelect(planet.planetId, "moon")}
      title={label}
      type="button"
    >
      <span className="h-5 w-5 overflow-hidden rounded-full border border-cyan-100/30 bg-black/40">
        <MoonImage className="h-full w-full object-cover" planetType={planetTypeFromTemperature(planet.temperature)} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.62rem] font-semibold leading-3">Moon</span>
        <span className="block truncate font-mono text-[0.55rem] leading-3 text-slate-500">{planet.coordinates}</span>
      </span>
    </button>
  );
}

function planetDisplayName(planet: ManagedPlanetResponse): string {
  return planet.name?.trim() || `Planet ${planet.coordinates}`;
}

function planetImage(planet: ManagedPlanetResponse): string {
  return planetImageForType(planetTypeFromTemperature(planet.temperature));
}

function namedSettlementPlanet(
  planet: Planet | undefined,
  name: string | null | undefined,
  ownerDisplayName?: string | null | undefined
): Planet | undefined {
  const trimmedName = name?.trim();
  const trimmedOwnerDisplayName = ownerDisplayName?.trim();
  if (!planet) return undefined;

  const named = trimmedName ? { ...planet, name: trimmedName } : planet;
  if (!trimmedOwnerDisplayName || !named.occupiedBy) return named;

  return {
    ...named,
    occupiedBy: {
      ...named.occupiedBy,
      ownerDisplayName: trimmedOwnerDisplayName,
    },
  };
}

function HydratingPlanetState({
  error,
  onRetry,
  status,
  txHash,
}: {
  error: string | undefined;
  onRetry: () => void;
  status: ChainLoadStatus;
  txHash: string | undefined;
}) {
  const failed = status === "error";

  return (
    <div className="grid min-h-[52vh] place-items-center">
      <div className="max-w-md rounded-lg border border-white/10 bg-[#101624] p-5 text-center shadow-2xl shadow-black/20">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-cyan-200/20 bg-cyan-200/10" />
        <h1 className="text-base font-semibold text-white">
          {failed ? "Planet sync delayed" : "Syncing planetfall"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {failed
            ? "The settlement transaction is confirmed, but the game API has not returned complete planet resources yet."
            : "Reading the new home planet coordinates and starter resources before opening the overview."}
        </p>
        {failed && txHash ? <p className="mt-2 truncate text-xs text-slate-500">Tx: {txHash}</p> : null}
        {error ? <p className="mt-2 truncate text-xs text-amber-200/80">{error}</p> : null}
        {failed ? (
          <button
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-4 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
