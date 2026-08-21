import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import type { Coordinates, Planet, PlanetType, PublicStationedDefender } from "./types";
import { haptic } from "./haptics";
import { playSfx } from "./sfx";
import {
  confirmedFleetVisibility,
} from "./missionVisibilityRefresh";
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
import { BatchSupplyModal } from "./components/BatchSupplyModal";
import {
  hasUsableSupplyCargoFleet,
  type BatchSupplyOrder,
  type BatchSupplySource,
} from "./batchSupplyPlanner";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { DefensePage } from "./components/DefensePage";
import { AllianceInvitesPage, AlliancePage, allianceInviteAcceptanceState, allianceJoinRequestApprovalState, allianceJoinRequestDismissalState, hasAllianceMembership } from "./components/AlliancePage";
import { ResearchPage, type ResearchActionState } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import type { RequirementTarget } from "./components/RequirementFlairs";
import { RiftPage } from "./components/RiftPage";
import { MoonPage } from "./components/MoonPage";
import { PublicMoonDetail } from "./components/PublicMoonDetail";
import { PlanetMoonIndicator } from "./components/PlanetMoonIndicator";
import { MissionDetailPage } from "./components/MissionDetailPage";
import {
  EMPTY_MISSION_CONTROL_FILTERS,
  MissionControlPage,
  missionPlanetCoordinateKey,
  missionSystemKeysMissingUniverseArchetypes,
  normalizeMissionControlFilters,
  resolveMissionControlView,
  type ManualMissionResolutionKind,
  type MissionControlFilters,
} from "./components/MissionControlPage";
import {
  MissionCreationPage,
  emptyMissionCargoDraft,
  normalizeMissionCargoDraft,
  type CombatTechLevels,
  type JoinAttackForecastContext,
  type MissionCargoDraft,
  type MissionLaunchDraft,
} from "./components/MissionCreationPage";
import { BattleReportsPage } from "./components/BattleReportsPage";
import { RankingsPage } from "./components/RankingsPage";
import { RaidTargetFinderPage } from "./components/RaidTargetFinderPage";
import { AllianceInspectPage, PlayerInspectPage } from "./components/InspectPages";
import { AlertTriangle } from "lucide-preact";
import { AnimatedProgressBar } from "./components/AnimatedProgressBar";
import {
  buildInspectPath,
  canonicalPathForLegacyHashLocation,
  hasUsefulPlanetDetailBackRoute,
  inspectRouteForManagedPlanetSelection,
  managedPlanetSelectionForInspectRoute,
  parseInspectRouteFromLocation,
  planetDetailBackRouteForCurrentScreen,
  type InspectRoute,
  type PlanetDetailBackRoute,
} from "./inspectRoutes";
import { resetDocumentTitle } from "./pageTitle";
import { hasPlanetSelectorChoice, isPlanetSelectorParentSelected } from "./planetSelectorChoice";
import {
  browserPlanetPickerOrderStorage,
  createPlanetPickerInteractionController,
  installPlanetPickerTouchMoveGuard,
  PLANET_PICKER_LONG_PRESS_MS,
  planetPickerDropPosition,
  planetPickerWalletKey,
  readPlanetPickerOrder,
  reconcilePlanetPickerOrder,
  writePlanetPickerOrder,
} from "./planetPickerOrder";
import {
  derivePlanetPickerAttackHighlights,
  planetPickerHasIncomingAttack,
  type PlanetPickerAttackHighlights,
} from "./planetPickerAttackHighlights";
import { ShareDialog } from "./components/ShareDialog";
import { PlayerActivityCenter } from "./components/PlayerActivityDialog";
import { rankingsAttackProtectionForEntry } from "./rankingsAttackProtection";
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
import {
  detectFarcasterMiniApp,
  FARCASTER_WALLET_CAPABILITY,
  farcasterMiniAppWalletSupport,
  hasMiniAppUrlHint,
  signalFarcasterReadyOnce,
  type FarcasterMiniAppWalletSupport,
} from "./farcasterReady";

export { infrastructureActionNoticeFor, infrastructureDisplayActionNoticeFor } from "./buildingActionNotice";
import {
  mergePlanetWithSettlement,
  planetFromSettlementPlanet,
  planetImageForType,
  planetsFromSystemResponse,
  planetTypeFromTemperature,
  type ApiSystemResponse,
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
import {
  constructionProgressKey,
  projectConstructionProgress,
  reconcileConstructionQueues,
  selectActiveConstructionQueue,
  type ConstructionProgress,
  type ConstructionProgressState,
  type ConstructionQueueObservation,
} from "./constructionProgress";
import { activeProductionQueue } from "./productionQueueFallback";
import { allianceContractAddress, apiBaseUrlForRuntimeConfig, burningChickenConfig, gameContractAddress, moonContractAddress, runtimeConfigUrl, type RuntimeConfig, type RuntimeConfigState } from "./runtimeConfig";
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
  buildingQueuePreview,
  defenseQueuePreview,
  isWalletPlanetHydrated,
  safeResourceNumber,
  shipQueuePreview,
  usedFieldsFromBuildings,
  type ChainLoadStatus,
} from "./overviewData";
import { formatDurationUntil } from "./durationFormat";
import {
  defenseSnapshotPlanetId,
  hasPlanetSectionData,
  indexedDefensePlanetId,
  indexedInfrastructurePlanetId,
  infrastructureSnapshotPlanetId,
  planetSectionAccessForPlanet,
  planetSectionForPlanet,
  setPlanetSectionData,
  setPlanetSectionStatus,
  setPlanetSectionValue,
  type PlanetSectionStore,
} from "./planetSectionStore";
import {
  backendResourceSnapshot,
  canonicalPlanetResourceSnapshotFor,
  promoteCanonicalPlanetResources,
  resourceStateWithCanonicalPlanetResources,
  riftStateWithCanonicalPlanetResources,
  walletPlanetsWithCanonicalPlanetResources,
  walletSettlementWithCanonicalPlanetResources,
  type BackendResourceState,
  type CanonicalPlanetResourceSnapshot,
  type CanonicalPlanetResourceStore,
} from "./planetResourceStore";
import {
  hydratedWalletPlanetSnapshot,
  isTransientGameStateReadFailure,
  expectedMissionLaunch,
  missionLaunchMissionsForTransaction,
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
  waitForAllianceCreationState,
  waitForMissionLaunchState,
  waitForFleetVisibilityIndexedThrough,
  waitForIndexedResourceState,
  waitForRenamedWalletPlanet,
  resourceIndexingExpectationForTransaction,
  type AllianceApplicationExpectation,
  type FinishedResearchExpectation,
  type MissionLaunchSnapshot,
  type ResourceIndexingExpectation,
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
  fleetMissionDistance,
  fleetMissionDistanceForMission,
  fleetMissionFuelCost,
  fleetMissionTravelSeconds,
} from "./fleetMissionRules";
import {
  mergePlayerProfile,
  walletRequestErrorMessage,
  walletRecoveryActionMessage,
  spendTransactionErrorMessage,
  confirmTransactionReceiptForProviderSource,
  getAvailableWalletProviderDetails,
  parseRiftTokenAmount,
  requestAccounts,
  unwatchPlanet,
  watchPlanet,
  sendApproveResourceTokenTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendFinalizeRiftExtractionTransaction,
  sendAbandonPlanetTransaction,
  sendCreateColonyTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchAttackMissionTransaction,
  sendLaunchBodyAttackMissionTransaction,
  sendLaunchBodyFleetMissionTransaction,
  sendLaunchDefenseHoldTransaction,
  sendLaunchFleetMissionTransaction,
  sendLaunchTransportBatchTransaction,
  sendJoinAttackMissionTransaction,
  sendJoinBodyAttackMissionTransaction,
  encodeColonizationTargetId,
  sendJumpGateJumpTransaction,
  sendCompleteFleetMissionReturnTransaction,
  sendRecallFleetMissionTransaction,
  sendResolveFleetMissionTransaction,
  sendDepositResourceTransaction,
  sendRenamePlanetTransaction,
  sendStartRiftExtractionTransaction,
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
  sendBuyPaidAllianceInviteTransaction,
  sendWithdrawPaidAllianceBonusTransaction,
  paidAllianceInviteCommitment,
  paidAllianceInviteLink,
  recoverPaidAllianceInvites,
  storePaidAllianceInvite,
  PAID_ALLIANCE_INVITE_PRICE_WEI,
  sendBurningChickenMoonTransaction,
  defaultVeydriftChainForLocation,
  ensureVeydriftNetwork,
  farcasterChainFor,
  isOnChainRevertError,
  isUserRejected,
  switchVeydriftNetwork,
  updatePlayerProfile,
  veydriftChainForChainId,
  GAME_MAINTENANCE_MESSAGE,
  WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
  type VeydriftWalletChain,
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
  type MissileAttackArchiveResponse,
  type FleetMissionPlanetReference,
  type FleetMissionSummary,
  type GlobalActiveMissionsResponse,
  type GlobalMissionArchiveResponse,
  type HighscoreEntry,
  type HighscorePlanet,
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
  type WalletProviderSource,
  type WatchedPlanetsResponse,
  type WalletSettlementResponse,
  type PaidAllianceBonusAmount,
  type ResourceSnapshotMetadata,
  type TransactionReceipt,
} from "./walletFlow";
import { BackendDataStore, backendDataStoreFor } from "./backendDataStore";
import { useBackendDataSnapshot } from "./useBackendDataSnapshot";
import { nextWatchedPlanetsPageAfterToggle } from "./watchedPlanetsView";

type FetchInfrastructureState = typeof import("./walletFlow").fetchInfrastructureState;
type FetchResearchState = typeof import("./walletFlow").fetchResearchState;
type FetchWalletQueues = typeof import("./walletFlow").fetchWalletQueues;
type FetchWalletOverviewSnapshot = typeof import("./walletFlow").fetchWalletOverviewSnapshot;
type FetchWalletPlanets = typeof import("./walletFlow").fetchWalletPlanets;
type FetchFleetMissionVisibility = typeof import("./walletFlow").fetchFleetMissionVisibility;
type FetchWalletSettlement = typeof import("./walletFlow").fetchWalletSettlement;
import {
  createTransactionActionGate,
  runWriteTransaction,
  transactionAwaitingWalletLabel,
  transactionSyncingLabel,
  type WriteTransactionState,
} from "./transactionActionGate";
import { timestampToMs } from "./timestampFormat";
import {
  scheduleActionNoticeAutoDismiss,
  type ActionStateSetter,
  type AutoDismissableActionState,
} from "./actionNoticeAutoDismiss";


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

export function missionMoonShipyardState({
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
    ships: moonState.launchableShips ?? moonState.ships ?? moonState.fleet ?? [],
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
const TOP_BAR_RESOURCE_POLL_INTERVAL_MS = 10_000;
export const MISSION_REPORT_PENDING_POLL_INTERVAL_MS = 3_000;
const CHAIN_EVENT_REFRESH_DEBOUNCE_MS = 3_000;
const MISSION_CONTROL_CHAIN_EVENT_REFRESH_DEBOUNCE_MS = 250;
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
type ChainResourceShape = { metal: string; crystal: string; deuterium: string };
export type BackendConfirmedResourceState = {
  homePlanetId: string | null;
  planetId?: string | null;
  planetLastSettledAt?: string | null;
  resources?: OnChainResources | null;
  resourcesAsOfNow?: OnChainResources | null;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
};

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

function combatTechResearchRowsForMission(
  levels: { weapons: number; shielding: number; armor: number } | null | undefined,
): Array<{ id: number; level: number }> | null {
  if (!levels) return null;
  return [
    { id: 5, level: safeResourceNumber(levels.weapons) ?? 0 },
    { id: 6, level: safeResourceNumber(levels.shielding) ?? 0 },
    { id: 7, level: safeResourceNumber(levels.armor) ?? 0 },
  ];
}

type TacticalMissionTarget = {
  alliance: Planet["alliance"];
  archetype: Planet["type"];
  combatTechLevels?: { weapons: number; shielding: number; armor: number } | null | undefined;
  coordinates: Coordinates;
  defenseUnits: Array<{ id: number; count: number }>;
  fleetUnits: Array<{ id: number; count: number }>;
  hasAggregateIntel: boolean;
  hasMoon: boolean;
  id: string;
  moonResources?: OnChainResources | null | undefined;
  name: string | null;
  owner: string;
  ownerDisplayName: string | null;
  productionPerHour?: OnChainResources | null | undefined;
  resources?: OnChainResources | null | undefined;
  stationedDefenderForecastTimeline?: PublicStationedDefender[] | null | undefined;
  stationedDefenderTimelineComplete?: boolean | undefined;
  storageCaps?: OnChainResources | null | undefined;
};

function tacticalPlanetForMission(target: TacticalMissionTarget): Planet {
  const resources = target.resources ?? null;
  const research = combatTechResearchRowsForMission(target.combatTechLevels);
  const hasPublicIntel = Boolean(
    resources
      || target.fleetUnits.length > 0
      || target.defenseUnits.length > 0
      || target.hasAggregateIntel
      || research
  );

  return {
    id: target.id,
    name: target.name?.trim() || `Planet ${target.id}`,
    type: target.archetype,
    image: planetImageForType(target.archetype),
    position: target.coordinates.position,
    galaxy: target.coordinates.galaxy,
    system: target.coordinates.system,
    owner: target.owner,
    ownerId: target.owner,
    alliance: target.alliance,
    occupiedBy: {
      planetId: target.id,
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
          fleet: target.fleetUnits.map((unit) => ({ id: unit.id, count: unit.count })),
          defenses: target.defenseUnits.map((unit) => ({ id: unit.id, count: unit.count })),
          stationedDefenders: null,
          stationedDefenderForecastTimeline: target.stationedDefenderForecastTimeline ?? null,
          stationedDefenderTimelineComplete: target.stationedDefenderTimelineComplete === true,
          research,
          productionPerHour: target.productionPerHour ?? null,
          storageCaps: target.storageCaps ?? null,
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
    moonName: "Moon",
    publicMoonState: target.moonResources
      ? { resources: target.moonResources }
      : null,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
  };
}

export function raidTargetPlanetForMission(target: RaidTarget): Planet {
  return tacticalPlanetForMission({
    alliance: target.alliance,
    archetype: target.archetype,
    combatTechLevels: target.combatTechLevels,
    coordinates: target.coordinates,
    defenseUnits: target.defenseUnits,
    fleetUnits: target.shipUnits,
    hasAggregateIntel: target.combatPower > 0 || target.loot > 0,
    hasMoon: target.hasMoon,
    id: target.planetId,
    moonResources: target.moonResources,
    name: target.name,
    owner: target.owner,
    ownerDisplayName: target.ownerDisplayName,
    productionPerHour: target.productionPerHour,
    resources: target.currentResources,
    stationedDefenderForecastTimeline: target.stationedDefenderForecastTimeline,
    stationedDefenderTimelineComplete: target.stationedDefenderTimelineComplete,
    storageCaps: target.storageCaps,
  });
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

export function shouldRefreshAllianceStateForPage(page: Page): boolean {
  return page === "alliance"
    || page === "mission-control"
    || page === "rankings"
    || page === "raid-target-finder"
    || page === "alliance-inspect";
}

export function shouldRefreshMissionActionStateForPage(page: Page): boolean {
  return page === "overview" || page === "galaxy" || page === "planet" || page === "rankings" || page === "raid-target-finder";
}

export function shouldRefreshShipyardStateForPage(page: Page): boolean {
  return page === "shipyard" || shouldRefreshMissionActionStateForPage(page);
}

export function shouldClearCachedShipyardStateForPageRefresh(page: Page): boolean {
  // A live refresh always follows navigation, but clearing the last confirmed inventory before
  // that read completes turns a slow or transiently failed request into a false "no eligible ships"
  // / "fleet slots still loading" composer. Keep the last known state until the fresh response wins;
  // planet-scoped storage prevents a different origin planet leaking into this view.
  void page;
  return false;
}

export function shouldEagerlyRefreshPlanetSwitchForPage(page: Page): boolean {
  // Every planet-scoped action must be based on the newly selected colony,
  // including a Mission Control origin. Keeping a cached origin there can
  // produce a valid-looking composer whose transaction reverts against the
  // selected planet's actual ships, resources, or queue.
  void page;
  return true;
}

export function currentPlanetTransactionInputsAvailable(
  contractInputsAvailable: boolean,
  activePlanetStateFresh: boolean,
): boolean {
  return contractInputsAvailable && activePlanetStateFresh;
}

export function shouldRefreshPlanetStateForIdentityChange(
  page: Page,
  previous: { account: string | undefined; activePlanetId: string | undefined; apiBaseUrl: string | undefined },
  current: { account: string | undefined; activePlanetId: string | undefined; apiBaseUrl: string | undefined },
): boolean {
  const switchingBetweenHydratedPlanets = Boolean(
    previous.account === current.account
    && previous.apiBaseUrl === current.apiBaseUrl
    && previous.activePlanetId
    && current.activePlanetId
    && previous.activePlanetId !== current.activePlanetId
  );
  return !switchingBetweenHydratedPlanets || shouldEagerlyRefreshPlanetSwitchForPage(page);
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
  if (detail.mission.status === "Recalled" || detail.mission.recallProvenance === "FleetMissionRecalled") return false;
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
  for (const mission of [
    ...fleetVisibility.incoming,
    ...fleetVisibility.outgoing,
    ...fleetVisibility.joinableAttacks,
    ...(fleetVisibility.joinableDefenses ?? []),
  ]) {
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

export function joinAttackTargetFromSystemPayload(
  payload: unknown,
  targetPlanetId: string,
  coords: Coordinates,
): Planet | undefined {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { planets?: unknown }).planets)) {
    return undefined;
  }
  return planetsFromSystemResponse(payload as ApiSystemResponse).find((planet) =>
    planet.id === targetPlanetId
      || (
        planet.galaxy === coords.galaxy
        && planet.system === coords.system
        && planet.position === coords.position
      )
  );
}

export function joinAttackForecastContextForMission(
  mission: FleetMissionSummary,
): JoinAttackForecastContext | undefined {
  const preview = mission.attackPreview;
  if (!preview) return undefined;
  return {
    participants: preview.participants,
    stationedDefenders: preview.stationedDefenders.map((defender) => ({
      ...defender,
      defenderDisplayName: defender.defenderDisplayName ?? null,
    })),
    selectedAttackerLaneGroup: preview.selectedAttackerLaneGroup,
    ...(preview.unavailableReason ? { unavailableReason: preview.unavailableReason } : {}),
  };
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

export function productionQueueCompletionCandidates({
  building,
  defense,
  moonBuilding,
  moonDefense,
  research,
  shipyard,
}: {
  building?: QueueStateResponse | null | undefined;
  defense?: QueueStateResponse | null | undefined;
  moonBuilding?: QueueStateResponse | null | undefined;
  moonDefense?: QueueStateResponse | null | undefined;
  research?: QueueStateResponse | null | undefined;
  shipyard?: QueueStateResponse | null | undefined;
}): ReadonlyArray<QueueStateResponse | null | undefined> {
  return [building, defense, shipyard, research, moonBuilding, moonDefense];
}

export function planetScopedFleetVisibility(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
  planetId: string | undefined,
  ownedPlanetIds?: readonly string[],
): FleetMissionVisibilityResponse | undefined {
  if (!fleetVisibility || !planetId) return fleetVisibility;
  if (ownedPlanetIds && !ownedPlanetIds.includes(planetId)) return undefined;

  const incoming: FleetMissionSummary[] = [];
  const outgoing: FleetMissionSummary[] = [];
  const returning: FleetMissionSummary[] = [];
  const seen = new Set<string>();
  const missions = [
    ...fleetVisibility.incoming,
    ...fleetVisibility.outgoing,
    ...fleetVisibility.returning,
  ];

  for (const mission of missions) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    if (!["Outbound", "Returning", "Recalled"].includes(mission.status)) continue;

    const isReturning = mission.status === "Returning" || mission.status === "Recalled";
    if (mission.targetPlanetId === planetId) {
      // Retain the target owner's view through the active return leg. This avoids the row vanishing
      // between arrival and the terminal Returned/Resolved state, and lets Overview label it as
      // departing rather than incorrectly claiming it is still inbound.
      incoming.push(mission);
    } else if (isReturning && mission.originPlanetId === planetId) {
      returning.push(mission);
    } else if (!isReturning && mission.originPlanetId === planetId) {
      outgoing.push(mission);
    }
  }

  return {
    ...fleetVisibility,
    incoming,
    outgoing,
    returning,
  };
}

export function planetHasIncomingAttack(
  fleetVisibility: FleetMissionVisibilityResponse | undefined,
  planetId: string,
  bodyKind: OrbitBodyKind = "planet",
): boolean {
  return planetPickerHasIncomingAttack(derivePlanetPickerAttackHighlights({
    account: fleetVisibility?.wallet,
    fleetVisibility,
    hydrated: Boolean(fleetVisibility),
    planetIds: [planetId],
  }), planetId, bodyKind);
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
  if (shipyardState) {
    return shipyardState.launchableShips
      ? { ...shipyardState, ships: shipyardState.launchableShips }
      : shipyardState;
  }
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
}: {
  actionState: Pick<GalaxyActionState, "status">;
}): string | undefined {
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
  originBody = "planet",
  shipyardState,
  ships,
}: {
  originBody?: "moon" | "planet" | undefined;
  shipyardState: Pick<ChainShipyardState, "fleetLaunchAvailable" | "fleetLaunchUnavailableReason" | "fleetSlots" | "ships" | "unavailableReason"> | null | undefined;
  ships: Partial<MissionShips>;
}): string | undefined {
  if (!shipyardState) return originBody === "moon" ? "Moon fleet state is still loading." : "Shipyard state is still loading.";
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
  return `${overSelected.join(", ")} on the origin ${originBody}; refresh fleet state or reduce selected ships before launching.`;
}

export function missionCooperativeActionAvailable(
  shipyardState: Pick<ChainShipyardState, "fleetLaunchAvailable" | "fleetSlots" | "ships"> | null | undefined,
): boolean | undefined {
  if (!shipyardState) return undefined;
  if (shipyardState.fleetLaunchAvailable === false) return false;
  if (!shipyardState.fleetSlots || shipyardState.fleetSlots.limit <= 0) return false;
  if (shipyardState.fleetSlots.active >= shipyardState.fleetSlots.limit) return false;
  return shipyardState.ships.some((ship) => ship.count > 0);
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
  if (status.blockedReason === "score_protection") return "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.";
  if (status.blockedReason === "same_alliance") return "Attack blocked: target belongs to your alliance.";
  return "Attack blocked.";
}

export async function revalidateAttackProtectionBeforeSubmit<T extends Pick<AttackProtectionStatus, "allowed" | "blockedReason" | "blockedReasonLabel">>(
  loadStatus: () => Promise<T>,
): Promise<T> {
  const status = await loadStatus();
  const blocker = attackProtectionSubmitBlocker(status);
  if (blocker) throw new Error(blocker);
  return status;
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
  loadInfrastructureState = (apiUrl, wallet, planetId, options) =>
    backendDataStoreFor(apiUrl).infrastructure(wallet, planetId, options),
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainInfrastructureState | null;
  loadInfrastructureState?: FetchInfrastructureState;
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
  loadInfrastructureState = (apiUrl, wallet, planetId, options) =>
    backendDataStoreFor(apiUrl).infrastructure(wallet, planetId, options),
  now = Date.now(),
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainInfrastructureState | null;
  knownBuildingQueue?: QueueStateResponse | null | undefined;
  loadInfrastructureState?: FetchInfrastructureState;
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
  loadResearchState = (apiUrl, wallet, planetId, options) =>
    backendDataStoreFor(apiUrl).research(wallet, planetId, options),
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainResearchState | null;
  loadResearchState?: FetchResearchState;
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
  loadResearchState = (apiUrl, wallet, planetId, options) =>
    backendDataStoreFor(apiUrl).research(wallet, planetId, options),
  loadWalletQueues = (apiUrl, wallet, planetId, options) =>
    backendDataStoreFor(apiUrl).queues(wallet, planetId, options),
  selectedResearchKey,
  selectedTechnologyId,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainResearchState | null;
  knownResearchQueue?: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
  loadResearchState?: FetchResearchState;
  loadWalletQueues?: FetchWalletQueues;
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
  walletProviderSource?: WalletProviderSource | undefined;
  account?: string | undefined;
  miniAppMode?: boolean | undefined;
  onConnectWallet?: (() => void) | undefined;
  planet?: PlanetSummary | undefined;
  referralProgramPanel?: ComponentChildren | undefined;
}

const farcasterWalletReportInstruction = "Please send this exact message to Veydrift support.";

function playableFarcasterMiniAppWalletError(
  code: string,
  message: string,
  details: {
    support?: FarcasterMiniAppWalletSupport | undefined;
    error?: unknown;
  } = {},
): string {
  const detailParts = [
    details.support ? playableFarcasterSupportDiagnostics(details.support) : undefined,
    ...playableFarcasterRawErrorDiagnostics(details.error),
  ].filter((part): part is string => Boolean(part));
  const detailText = detailParts.length > 0 ? ` Details: ${detailParts.join("; ")}.` : "";
  return `Wallet setup failed (${code}). ${message}${detailText} ${farcasterWalletReportInstruction}`;
}

function playableFarcasterSupportDiagnostics(support: FarcasterMiniAppWalletSupport): string {
  const capabilities = support.capabilities.length > 0 ? support.capabilities.join(",") : "none";
  const chains = support.chains.length > 0 ? support.chains.join(",") : "none";
  return `support=${support.status}/${support.status === "supported" ? "ok" : support.code}; capabilities=${capabilities}; chains=${chains}`;
}

function playableFarcasterRawErrorDiagnostics(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }
  const providerError = error as { code?: unknown; message?: unknown };
  return [
    providerError.code !== undefined ? `errorCode=${String(providerError.code)}` : undefined,
    typeof providerError.message === "string" && providerError.message.trim()
      ? `errorMessage=${providerError.message.replace(/\s+/g, " ").slice(0, 240)}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
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
  const previousStatus = useRef<unknown>();
  useEffect(() => {
    const status = (action as { status?: unknown } | null | undefined)?.status;
    if (status !== undefined && status !== previousStatus.current) {
      if (status === "success") {
        playSfx("notice-success");
        haptic("success");
      } else if (status === "error") {
        playSfx("notice-error");
        haptic("error");
      }
    }
    previousStatus.current = status;
  }, [action]);
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
  bodySelectionDefaults?: {
    originIsMoon?: boolean | undefined;
    targetIsMoon?: boolean | undefined;
  } | undefined;
  target: Planet | undefined;
  coords: Coordinates;
  originPlanet: ManagedPlanetResponse | undefined;
};

type PendingAttackProtection = {
  targetPlanetId: string;
  status: "checking" | "ready" | "error";
  protection?: AttackProtectionStatus | undefined;
};

export function missionComposerIdentity({
  account,
  activePlanetId,
  pending,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  pending: PendingGalaxyMission;
}): string {
  const targetPlanetId = pending.target?.occupiedBy?.planetId ?? pending.target?.id ?? "empty";
  return [
    account?.toLowerCase() ?? "disconnected",
    pending.action.mode,
    pending.action.kind,
    pending.action.mode === "mission" ? pending.action.mission : "",
    pending.originPlanet?.planetId ?? activePlanetId ?? "unknown-origin",
    pending.bodySelectionDefaults?.originIsMoon === true ? "origin-moon" : "origin-planet",
    targetPlanetId,
    `${pending.coords.galaxy}:${pending.coords.system}:${pending.coords.position}`,
    pending.bodySelectionDefaults?.targetIsMoon === true ? "target-moon" : "target-planet",
  ].join("|");
}

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
  if (activePlanetId === planet.planetId) return [];

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

export function overviewMyPlanetMoonActionsFor({
  account,
  defenseState,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  defenseState: ChainDefenseState | null;
  homePlanetId: string | null | undefined;
  planet: ManagedPlanetResponse;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  if (!planet.moon?.exists) return [];

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

  return [
    overviewMoonMissionAction(actionsByKind.get("transport"), "transport", "Transport"),
    overviewMoonMissionAction(actionsByKind.get("deploy"), "deploy", "Deploy"),
    overviewMoonMissionAction(actionsByKind.get("defenseHold"), "defenseHold", "Defend"),
  ];
}

function overviewMoonMissionAction(
  action: GalaxyAction | undefined,
  kind: "transport" | "deploy" | "defenseHold",
  label: string,
): GalaxyAction {
  if (kind === "defenseHold") {
    return disabledOwnedPlanetMissionAction(
      kind,
      label,
      "Stationed defense can only target planets in the current mission contract.",
    );
  }
  if (!action) return disabledOwnedPlanetMissionAction(kind, label, `${label} is unavailable.`);
  if (!action.enabled) {
    return {
      ...action,
      label,
      reason: overviewOwnedPlanetActionReason(action.reason),
    };
  }
  if (action.mode !== "mission" || action.kind !== kind) {
    return disabledOwnedPlanetMissionAction(kind, label, `${label} is unavailable.`);
  }
  return {
    ...action,
    label,
    defaultTargetIsMoon: true,
  };
}

function moonTargetMissionAction(
  action: GalaxyAction | undefined,
  kind: "attack" | "transport" | "deploy" | "defenseHold",
  label: string,
): GalaxyAction {
  if (kind === "defenseHold") {
    return disabledMoonTargetMissionAction(
      kind,
      label,
      "Stationed defense can only target planets in the current mission contract.",
    );
  }
  if (!action) return disabledMoonTargetMissionAction(kind, label, `${label} is unavailable.`);
  if (!action.enabled) return { ...action, label };
  if (action.mode !== "mission" || action.kind !== kind) {
    return disabledMoonTargetMissionAction(kind, label, `${label} is unavailable.`);
  }
  return {
    ...action,
    label,
    defaultTargetIsMoon: true,
  };
}

function disabledMoonTargetMissionAction(
  kind: "attack" | "transport" | "deploy" | "defenseHold",
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

export function highscorePlanetForMission(planet: HighscorePlanet, entry: HighscoreEntry): Planet {
  const tactical = planet.tactical;
  return tacticalPlanetForMission({
    alliance: entry.alliance ?? null,
    archetype: planet.archetype,
    combatTechLevels: tactical?.combatTechLevels,
    coordinates: planet.coordinates,
    defenseUnits: tactical?.defenses.units ?? [],
    fleetUnits: tactical?.ships.units ?? [],
    hasAggregateIntel: Boolean(tactical?.combatPower || tactical?.ships.power || tactical?.defenses.power),
    hasMoon: Boolean(planet.hasMoon || planet.moon?.exists),
    id: planet.planetId,
    moonResources: planet.moon?.resourcesAsOfNow ?? planet.moon?.resources ?? null,
    name: planet.name?.trim() || `Planet ${planet.coordinates.galaxy}:${planet.coordinates.system}:${planet.coordinates.position}`,
    owner: entry.wallet,
    ownerDisplayName: entry.displayName ?? null,
    productionPerHour: tactical?.productionPerHour,
    resources: tactical?.currentResources,
    stationedDefenderForecastTimeline: planet.stationedDefenderForecastTimeline,
    stationedDefenderTimelineComplete: planet.stationedDefenderTimelineComplete,
    storageCaps: tactical?.storageCaps,
  });
}

export function overviewWatchedPlanetMoonActionsFor({
  account,
  defenseState,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  defenseState: ChainDefenseState | null;
  homePlanetId: string | null | undefined;
  planet: Planet;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  if (!planet.hasMoon) return [];

  const actionsByKind = new Map(
    galaxyActionsForSlot({
      account,
      defenseState,
      homePlanetId,
      isOrigin: false,
      planet,
      shipyardState,
    }).map((action) => [action.kind, action])
  );
  const isOwnTarget = Boolean(account && (planet.occupiedBy?.owner ?? planet.ownerId)?.toLowerCase() === account.toLowerCase());

  if (isOwnTarget) {
    return [
      moonTargetMissionAction(actionsByKind.get("transport"), "transport", "Transport"),
      moonTargetMissionAction(actionsByKind.get("deploy"), "deploy", "Deploy"),
      moonTargetMissionAction(actionsByKind.get("defenseHold"), "defenseHold", "Defend"),
    ];
  }

  const defendAction = actionsByKind.get("defenseHold");
  return defendAction
    ? [moonTargetMissionAction(defendAction, "defenseHold", "Defend")]
    : [moonTargetMissionAction(actionsByKind.get("attack"), "attack", "Attack")];
}

export function overviewWatchedPlanetActionsFor({
  account,
  defenseState,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  defenseState: ChainDefenseState | null;
  homePlanetId: string | null | undefined;
  planet: Planet;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  return galaxyActionsForSlot({
    account,
    defenseState,
    homePlanetId,
    isOrigin: false,
    planet,
    shipyardState,
  }).filter((action) => action.enabled);
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

function moonOverviewMissionAction(
  action: GalaxyAction | undefined,
  kind: "transport" | "deploy",
  label: string,
): GalaxyAction {
  const fallbackReason = `${label} is unavailable for this moon.`;
  if (!action) return disabledOwnedPlanetMissionAction(kind, label, fallbackReason);
  if (action.enabled) return action;
  return {
    ...action,
    reason: overviewOwnedPlanetActionReason(action.reason),
  };
}

export function cargoForCargoMissionLaunch({
  cargo,
}: {
  cargo: MissionCargoDraft | undefined;
}): Pick<OnChainResources, "metal" | "crystal" | "deuterium"> {
  // Confirmation-time invariant: calldata is derived only from the rendered draft. Inventory
  // hydration and prior missions have no fallback path into this payload.
  return normalizeMissionCargoDraft(cargo ?? emptyMissionCargoDraft());
}

function driveLevelsFromTechnologyLevels(levels: Record<string, number> | undefined): FleetDriveLevels {
  return {
    combustionDrive: levels?.["3"] ?? 0,
    impulseDrive: levels?.["9"] ?? 0,
    hyperspaceDrive: levels?.["10"] ?? 0,
  };
}

export function batchSupplySourceForPlanet(
  planet: ManagedPlanetResponse,
  shipyard: ChainShipyardState | undefined,
): BatchSupplySource {
  const resources = planet.resourcesAsOfNow ?? planet.resources;
  const ships = emptyMissionShips();
  for (const row of missionShipInventoryRows) {
    ships[row.key] = Math.max(0, Math.trunc((shipyard?.launchableShips ?? shipyard?.ships ?? [])
      .find((item) => item.id === row.id)?.count ?? 0));
  }
  const fleetUnavailable = shipyard?.fleetLaunchAvailable === false
    ? shipyard.fleetLaunchUnavailableReason ?? shipyard.unavailableReason ?? "Fleet slots are unavailable."
    : shipyard && !hasUsableSupplyCargoFleet(ships)
      ? "No usable cargo ships are available on this planet."
      : undefined;
  return {
    planetId: planet.planetId,
    label: planet.name?.trim() || planet.coordinates,
    coordinates: { galaxy: planet.galaxy, system: planet.system, position: planet.position },
    resources: {
      metal: safeResourceNumber(resources?.metal) ?? 0,
      crystal: safeResourceNumber(resources?.crystal) ?? 0,
      deuterium: safeResourceNumber(resources?.deuterium) ?? 0,
    },
    ships,
    driveLevels: driveLevelsFromTechnologyLevels(shipyard?.technologyLevels),
    ...(fleetUnavailable ? { unavailableReason: fleetUnavailable } : {}),
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
  options: { forceHomePlanet?: boolean; forceWalletPlanets?: boolean; fresh?: boolean } = {},
  loaders: {
    fetchWalletOverviewSnapshot?: FetchWalletOverviewSnapshot;
    fetchWalletPlanets?: FetchWalletPlanets;
    fetchWalletQueues?: FetchWalletQueues;
    fetchFleetMissionVisibility?: FetchFleetMissionVisibility;
    fetchWalletSettlement?: FetchWalletSettlement;
  } = {},
  sharedStore?: BackendDataStore,
): Promise<WalletPlanetSyncSnapshot> {
  const store = sharedStore ?? backendDataStoreFor(apiBaseUrl);
  const loadOverviewSnapshot: FetchWalletOverviewSnapshot = loaders.fetchWalletOverviewSnapshot
    ?? ((_apiUrl, wallet, planetId, readOptions) => store.overview(wallet, planetId, readOptions));
  const loadWalletPlanets: FetchWalletPlanets = loaders.fetchWalletPlanets
    ?? ((_apiUrl, wallet, readOptions) => store.planets(wallet, readOptions));
  const loadWalletQueues: FetchWalletQueues = loaders.fetchWalletQueues
    ?? ((_apiUrl, wallet, planetId, readOptions) => store.queues(wallet, planetId, readOptions));
  const loadFleetMissionVisibility: FetchFleetMissionVisibility = loaders.fetchFleetMissionVisibility
    ?? ((_apiUrl, wallet, readOptions) => store.fleetVisibility(wallet, readOptions));
  const loadWalletSettlement: FetchWalletSettlement = loaders.fetchWalletSettlement
    ?? ((_apiUrl, wallet, readOptions) => store.settlement(wallet, readOptions));
  const readPlanetId = options.forceHomePlanet || options.forceWalletPlanets ? undefined : activePlanetId;
  const overviewPlanetId = options.forceHomePlanet ? undefined : activePlanetId;
  const freshReadOptions = options.fresh === undefined ? {} : { fresh: options.fresh };
  if (!options.forceWalletPlanets) {
    try {
      const overviewSnapshot = await loadOverviewSnapshot(apiBaseUrl, account, overviewPlanetId, {
        ...freshReadOptions,
        timeoutMs: INITIAL_OVERVIEW_SNAPSHOT_TIMEOUT_MS,
      });
      if (hydratedWalletPlanetSnapshot(overviewSnapshot, overviewPlanetId)) {
        return overviewSnapshot;
      }
      // A successful HTTP response can still be an incomplete indexing snapshot. Repeating that
      // fast path leaves established accounts on the planetfall loader even when their indexed
      // planet roster or settlement endpoint is already complete. Fall through to those critical
      // reads just as we do when the overview optimization times out.
    } catch (error) {
      if (!isRecoverableOverviewSnapshotError(error)) {
        throw error;
      }
      // The overview snapshot is a fast-path optimization. Older backends may not expose it, and
      // mission visibility inside it can be briefly slow; hydrate critical planet state below instead
      // of leaving first paint blocked on noncritical mission data.
    }
  }

  const planetsResult = await settlePromise(loadWalletPlanets(apiBaseUrl, account, freshReadOptions));
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
      : settlePromise(loadWalletQueues(apiBaseUrl, account, readPlanetId, freshReadOptions));
    const visibilityResultPromise = settlePromise(loadFleetMissionVisibility(apiBaseUrl, account, {
      includeArchive: false,
      ...freshReadOptions,
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
    loadWalletSettlement(apiBaseUrl, account, freshReadOptions),
    loadWalletQueues(apiBaseUrl, account, readPlanetId, freshReadOptions),
    loadFleetMissionVisibility(apiBaseUrl, account, {
      includeArchive: false,
      ...freshReadOptions,
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
  planetsResult: PromiseSettledResult<Awaited<ReturnType<FetchWalletPlanets>>>,
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
  // Never turn a temporary mission-feed timeout into an empty authoritative response. Doing that
  // made real outbound/returning missions disappear for one refresh cycle, then pop back on the
  // next successful poll. The caller preserves the last confirmed list until this read succeeds.
  const fleetVisibility = confirmedFleetVisibility(visibilityResult);

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
  planetsResponse: Awaited<ReturnType<FetchWalletPlanets>> | undefined,
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
    ...(fleetVisibility?.joinableDefenses ?? []),
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

export function newestFleetVisibility(
  current: FleetMissionVisibilityResponse | undefined,
  next: FleetMissionVisibilityResponse,
): FleetMissionVisibilityResponse {
  if (!current) return next;
  const revisionOrder = compareIndexedRevision(next.indexedRevision, current.indexedRevision);
  if (revisionOrder !== undefined && revisionOrder !== 0) return revisionOrder > 0 ? next : current;

  const nextBlock = parseIndexedOrderValue(next.indexedBlock);
  const currentBlock = parseIndexedOrderValue(current.indexedBlock);
  if (nextBlock !== undefined && currentBlock !== undefined && nextBlock !== currentBlock) {
    return nextBlock > currentBlock ? next : current;
  }

  const nextGeneratedAt = parseGeneratedAt(next.generatedAt);
  const currentGeneratedAt = parseGeneratedAt(current.generatedAt);
  if (nextGeneratedAt !== undefined && currentGeneratedAt !== undefined && nextGeneratedAt < currentGeneratedAt) {
    return current;
  }
  return next;
}

function compareIndexedRevision(left: string | undefined, right: string | undefined): number | undefined {
  if (!left || !right) return undefined;
  const leftParts = left.split(":").map(parseIndexedOrderValue);
  const rightParts = right.split(":").map(parseIndexedOrderValue);
  if (leftParts.some((value) => value === undefined) || rightParts.some((value) => value === undefined)) {
    return undefined;
  }
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0n;
    const rightValue = rightParts[index] ?? 0n;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

function parseIndexedOrderValue(value: string | null | undefined): bigint | undefined {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parseGeneratedAt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

type ExpectedMissionLaunchContext = {
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

function expectedMissionLaunchForDraft(
  txHash: string,
  context: ExpectedMissionLaunchContext,
): FleetMissionSummary {
  const originCoords = managedPlanetCoordinates(context.originPlanet);
  const distance = originCoords
    ? context.missionType === "Harvest"
      ? fleetMissionDistanceForMission(originCoords, context.targetCoords, "Harvest", {
          originIsMoon: context.originIsMoon,
          targetIsMoon: context.targetIsMoon,
        })
      : fleetMissionDistance(originCoords, context.targetCoords, {
          originIsMoon: context.originIsMoon,
          targetIsMoon: context.targetIsMoon,
        })
    : 0;
  const travelSeconds = fleetMissionTravelSeconds(distance, context.draft.ships, context.driveLevels, context.draft.speedPercent);
  const fuelCost = context.fuelCost
    ?? fleetMissionFuelCost(context.draft.ships, distance, context.driveLevels, context.draft.speedPercent);

  return expectedMissionLaunch({
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
  backendData: BackendDataStore,
  account: string,
  planetId: string,
): Promise<ChainMoonState> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CHICKEN_MOON_CONFIRM_TIMEOUT_MS) {
    const nextMoonState = await backendData.moon(account, planetId);
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

function backendMissionTypeLabel(kind: string): string {
  if (kind === "acsDefend") return "AcsDefend";
  if (kind === "defenseHold") return "DefenseHold";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function acsDefendCoordinationBlocker(
  mission: FleetMissionSummary,
  account: string,
  allianceState: ChainAllianceState | null,
  backendQualifiedAllianceDefense = false,
): string | undefined {
  // The fleet-visibility projection classified this hostile attack against the viewer's alliance in
  // the same indexed revision. Do not re-authorize it against a separately timed roster response.
  if (backendQualifiedAllianceDefense) return undefined;
  const defendedOwner = mission.targetPlanet?.owner;
  if (!defendedOwner) return "Defended planet state is still syncing.";
  if (defendedOwner.toLowerCase() === account.toLowerCase()) return undefined;

  const allianceId = allianceState?.membership.allianceId;
  if (!allianceId || allianceId === "0") {
    return "Group defense is only available for your own planets or same-alliance planets.";
  }

  const defendedOwnerLower = defendedOwner.toLowerCase();
  return allianceState.members.some((member) => member.address.toLowerCase() === defendedOwnerLower)
    ? undefined
    : "Group defense is only available for your own planets or same-alliance planets.";
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

function chainEventWalletPlanetsChanged(event: MessageEvent | undefined): boolean {
  if (!event) return false;
  try {
    const payload = JSON.parse(event.data) as { walletPlanetsChanged?: boolean };
    return payload.walletPlanetsChanged === true;
  } catch {
    return false;
  }
}

type ChainResourceChange = {
  bodyKind: OrbitBodyKind;
  blockNumber: string;
  planetId: string;
  transactionHash: string;
};

function chainEventResourceChanges(event: MessageEvent | undefined): ChainResourceChange[] {
  if (!event) return [];
  try {
    const payload = JSON.parse(event.data) as { resourceChanges?: unknown };
    if (!Array.isArray(payload.resourceChanges)) return [];
    return payload.resourceChanges.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const change = value as Partial<ChainResourceChange>;
      if (
        (change.bodyKind !== "moon" && change.bodyKind !== "planet")
        || typeof change.blockNumber !== "string"
        || typeof change.planetId !== "string"
        || typeof change.transactionHash !== "string"
      ) return [];
      return [{
        bodyKind: change.bodyKind,
        blockNumber: change.blockNumber,
        planetId: change.planetId,
        transactionHash: change.transactionHash,
      }];
    });
  } catch {
    return [];
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
  replaceLegacyHashRoute();
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
  replaceLegacyHashRoute();
  const route = parseInspectRouteFromLocation(window.location);
  return route.kind === "planet" || route.kind === "moon" ? route.coords : undefined;
}

function replaceLegacyHashRoute(): boolean {
  if (typeof window === "undefined") return false;
  const canonicalPath = canonicalPathForLegacyHashLocation(window.location);
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

export function PlayableMvpApp({
  provider: providedProvider,
  walletProviderSource: providedWalletProviderSource,
  account: providedAccount,
  miniAppMode: providedMiniAppMode = false,
  onConnectWallet,
  planet,
  referralProgramPanel,
}: PlayableMvpAppProps = {}) {
  const [miniAppProvider, setMiniAppProvider] = useState<Eip1193Provider>();
  const [miniAppAccount, setMiniAppAccount] = useState<string | undefined>();
  const [miniAppWalletError, setMiniAppWalletError] = useState<string | undefined>();
  const [detectedMiniAppMode, setDetectedMiniAppMode] = useState(() => (
    providedMiniAppMode
      || (typeof window !== "undefined" && hasMiniAppUrlHint(window.location))
  ));
  const miniAppWalletConnectAttempted = useRef(false);
  const provider = providedProvider ?? miniAppProvider;
  const walletProviderSource = providedWalletProviderSource
    ?? (providedProvider ? "injected" : miniAppProvider ? "farcaster" : undefined);
  const account = providedAccount ?? miniAppAccount;
  const miniAppMode = providedMiniAppMode || detectedMiniAppMode;
  const isWalletConnected = Boolean(provider && account);
  const showMiniAppWalletError = useCallback((message: string) => {
    setMiniAppProvider(undefined);
    setMiniAppAccount(undefined);
    setMiniAppWalletError(message);
    setOnChainError(message);
    setOnChainStatus("error");
  }, []);

  const connectMiniAppWallet = useCallback(async () => {
    if (providedProvider && providedAccount) {
      return;
    }

    setDetectedMiniAppMode(true);
    setMiniAppWalletError(undefined);
    setOnChainError(undefined);

    let support: FarcasterMiniAppWalletSupport | undefined;
    const walletChain = defaultVeydriftChainForLocation();
    const requiredChain = farcasterChainFor(walletChain);
    try {
      await signalFarcasterReadyOnce();
      support = await farcasterMiniAppWalletSupport(undefined, { requiredChain });
      if (support.status === "unsupported") {
        showMiniAppWalletError(playableFarcasterMiniAppWalletError(
          support.code,
          `${support.message} Required capability: ${FARCASTER_WALLET_CAPABILITY}. Required chain: ${requiredChain}.`,
          { support },
        ));
        return;
      }

      const walletProvider = await getAvailableWalletProviderDetails(
        window as typeof window & { ethereum?: Eip1193Provider },
        undefined,
        { preferFarcasterProvider: true },
      );
      if (!walletProvider?.provider || walletProvider.source !== "farcaster") {
        showMiniAppWalletError(playableFarcasterMiniAppWalletError(
          "FARCASTER_WALLET_PROVIDER_UNAVAILABLE",
          "The Farcaster Mini App SDK did not provide an Ethereum wallet provider after the app became ready.",
          { support },
        ));
        return;
      }

      let accounts: string[];
      try {
        accounts = await requestAccounts(walletProvider.provider);
      } catch (error) {
        showMiniAppWalletError(playableFarcasterMiniAppWalletError(
          isUserRejected(error) ? "FARCASTER_WALLET_REJECTED" : "FARCASTER_WALLET_ACCOUNT_FAILED",
          isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error),
          { support, error },
        ));
        return;
      }
      if (!accounts[0]) {
        showMiniAppWalletError(playableFarcasterMiniAppWalletError(
          "FARCASTER_WALLET_ACCOUNT_UNAVAILABLE",
          "Wallet authorization completed without returning an account.",
          { support },
        ));
        return;
      }

      try {
        await switchVeydriftNetwork(walletProvider.provider, walletChain);
      } catch (error) {
        showMiniAppWalletError(playableFarcasterMiniAppWalletError(
          walletChain.chainId === 8453 ? "FARCASTER_BASE_MAINNET_SWITCH_FAILED" : "FARCASTER_BASE_SEPOLIA_SWITCH_FAILED",
          walletRequestErrorMessage(error),
          { support, error },
        ));
        return;
      }
      setMiniAppProvider(walletProvider.provider);
      setMiniAppAccount(accounts[0]);
      setMiniAppWalletError(undefined);
      setOnChainError(undefined);
    } catch (error) {
      showMiniAppWalletError(playableFarcasterMiniAppWalletError(
        isUserRejected(error) ? "FARCASTER_WALLET_REJECTED" : "FARCASTER_WALLET_BOOTSTRAP_FAILED",
        isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error),
        { support, error },
      ));
    }
  }, [providedAccount, providedProvider, showMiniAppWalletError]);

  useEffect(() => {
    if (providedMiniAppMode || detectedMiniAppMode) {
      return;
    }

    let disposed = false;
    void detectFarcasterMiniApp().then((detected) => {
      if (!disposed && detected) {
        setDetectedMiniAppMode(true);
      }
    });

    return () => {
      disposed = true;
    };
  }, [detectedMiniAppMode, providedMiniAppMode]);

  useEffect(() => {
    if (
      providedProvider
      || providedAccount
      || !miniAppMode
      || miniAppWalletConnectAttempted.current
    ) {
      return;
    }

    miniAppWalletConnectAttempted.current = true;
    void connectMiniAppWallet().catch((error) => {
      console.error("Mini App wallet connection failed", error);
    });
  }, [connectMiniAppWallet, miniAppMode, providedAccount, providedProvider]);
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const apiBaseUrl = useMemo(() => {
    return runtimeConfig.status === "ready" ? apiBaseUrlForRuntimeConfig(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const backendData = useMemo(
    () => apiBaseUrl ? backendDataStoreFor(apiBaseUrl) : undefined,
    [apiBaseUrl],
  );
  const [page, setPage] = useState<Page>(() => initialInspectPageState().page);
  // Mission Control used to fetch and mount every All/Incoming archive before the default My
  // missions view could become interactive. Keep the persisted deep-link selection working while
  // letting the visible scope determine which expensive archive reads are needed initially.
  const missionControlInitialView = page === "mission-control" ? resolveMissionControlView() : undefined;
  // The tab widgets persist their selection directly to the URL/session state. This lightweight
  // revision asks the app layer to load that newly-selected scope without reintroducing eager
  // fetches for every hidden tab.
  const [missionControlTabRevision, setMissionControlTabRevision] = useState(0);
  const requestMissionControlTabLoad = useCallback(() => {
    setMissionControlTabRevision((current) => current + 1);
  }, []);
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
  const settlementSnapshot = useBackendDataSnapshot<WalletSettlementResponse>(
    backendData,
    backendData && account ? backendData.key("settlement", account) : undefined,
  );
  const onChainSettlementState = settlementSnapshot?.data;
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | undefined>();
  const canonicalPlanetResourcesSnapshot = useBackendDataSnapshot<CanonicalPlanetResourceStore>(
    backendData,
    backendData && account ? backendData.key("canonical-planet-resources", account) : undefined,
  );
  const canonicalPlanetResources = canonicalPlanetResourcesSnapshot?.data ?? {};
  const walletPlanetsSnapshot = useBackendDataSnapshot<WalletPlanetsResponse>(
    backendData,
    backendData && account ? backendData.key("planets", account) : undefined,
  );
  const walletPlanetsState = walletPlanetsSnapshot?.data?.planets ?? [];
  const walletPlanets = useMemo(
    () => walletPlanetsWithCanonicalPlanetResources(walletPlanetsState, canonicalPlanetResources, account),
    [account, canonicalPlanetResources, walletPlanetsState],
  );
  const setWalletPlanets = useCallback((
    value: ManagedPlanetResponse[] | ((current: ManagedPlanetResponse[]) => ManagedPlanetResponse[]),
  ) => {
    if (!backendData || !account) return;
    const currentResponse = backendData.value<WalletPlanetsResponse>("planets", account);
    const current = currentResponse?.planets ?? [];
    const planets = typeof value === "function" ? value(current) : value;
    backendData.publish("planets", {
      ...currentResponse,
      homePlanetId: currentResponse?.homePlanetId ?? onChainSettlementState?.homePlanetId ?? null,
      planets,
      wallet: currentResponse?.wallet ?? account,
    }, [account], { wallet: account });
  }, [account, backendData, onChainSettlementState?.homePlanetId]);
  const promoteBackendResourceState = useCallback((
    state: BackendResourceState | null | undefined,
    options: {
      bodyKind?: OrbitBodyKind;
      confirmedTransaction?: boolean;
      planetId?: string | null | undefined;
      wallet?: string | null | undefined;
    } = {},
  ): CanonicalPlanetResourceSnapshot | undefined => {
    const candidate = backendResourceSnapshot(state, {
      ...(options.bodyKind === undefined ? {} : { bodyKind: options.bodyKind }),
      ...(options.planetId === undefined ? {} : { planetId: options.planetId }),
      ...(options.wallet ?? account ? { wallet: options.wallet ?? account } : {}),
    });
    if (!backendData || !account) return candidate;
    const current = backendData.value<CanonicalPlanetResourceStore>("canonical-planet-resources", account) ?? {};
    const next = promoteCanonicalPlanetResources(current, candidate, {
      ...(options.confirmedTransaction === undefined ? {} : { confirmedTransaction: options.confirmedTransaction }),
    });
    if (next !== current) {
      backendData.publish("canonical-planet-resources", next, [account], { wallet: account });
    }
    return candidate;
  }, [account, backendData]);
  const promoteWalletPlanetResourceStates = useCallback((planets: readonly ManagedPlanetResponse[]) => {
    if (!backendData || !account) return {};
    const current = backendData.value<CanonicalPlanetResourceStore>("canonical-planet-resources", account) ?? {};
    let next = current;
    for (const planetState of planets) {
      next = promoteCanonicalPlanetResources(next, backendResourceSnapshot(planetState, {
        planetId: planetState.planetId,
        wallet: account,
      }));
      if (planetState.moon?.exists) {
        next = promoteCanonicalPlanetResources(next, backendResourceSnapshot(planetState.moon, {
          bodyKind: "moon",
          planetId: planetState.planetId,
          wallet: account,
        }));
      }
    }
    if (next !== current) {
      backendData.publish("canonical-planet-resources", next, [account], { wallet: account });
    }
    return next;
  }, [account, backendData]);
  const planetPickerWallet = planetPickerWalletKey(account);
  const [planetPickerOrderState, setPlanetPickerOrderState] = useState<{
    planetIds: string[] | undefined;
    walletKey: string;
  }>({ planetIds: undefined, walletKey: "" });
  useEffect(() => {
    setPlanetPickerOrderState({
      planetIds: readPlanetPickerOrder(browserPlanetPickerOrderStorage(), planetPickerWallet),
      walletKey: planetPickerWallet,
    });
  }, [planetPickerWallet]);
  const orderedWalletPlanets = useMemo(() => {
    const savedPlanetIds = planetPickerOrderState.walletKey === planetPickerWallet
      ? planetPickerOrderState.planetIds
      : undefined;
    const reconciledIds = reconcilePlanetPickerOrder(
      walletPlanets.map((planet) => planet.planetId),
      savedPlanetIds,
    );
    const planetsById = new Map(walletPlanets.map((planet) => [planet.planetId, planet]));
    return reconciledIds.flatMap((planetId) => {
      const planet = planetsById.get(planetId);
      return planet ? [planet] : [];
    });
  }, [planetPickerOrderState, planetPickerWallet, walletPlanets]);
  useEffect(() => {
    if (
      planetPickerOrderState.walletKey !== planetPickerWallet
      || !planetPickerOrderState.planetIds
      || walletPlanets.length === 0
    ) {
      return;
    }

    const reconciledIds = reconcilePlanetPickerOrder(
      walletPlanets.map((planet) => planet.planetId),
      planetPickerOrderState.planetIds,
    );
    if (
      reconciledIds.length === planetPickerOrderState.planetIds.length
      && reconciledIds.every((planetId, index) => planetId === planetPickerOrderState.planetIds?.[index])
    ) {
      return;
    }

    setPlanetPickerOrderState({ planetIds: reconciledIds, walletKey: planetPickerWallet });
    writePlanetPickerOrder(browserPlanetPickerOrderStorage(), planetPickerWallet, reconciledIds);
  }, [planetPickerOrderState, planetPickerWallet, walletPlanets]);
  const handlePlanetPickerOrderChange = useCallback((nextPlanetIds: string[]) => {
    if (!planetPickerWallet) return;
    const reconciledIds = reconcilePlanetPickerOrder(
      orderedWalletPlanets.map((planet) => planet.planetId),
      nextPlanetIds,
    );
    setPlanetPickerOrderState({ planetIds: reconciledIds, walletKey: planetPickerWallet });
    writePlanetPickerOrder(browserPlanetPickerOrderStorage(), planetPickerWallet, reconciledIds);
  }, [orderedWalletPlanets, planetPickerWallet]);
  const [watchedPlanetsPage, setWatchedPlanetsPage] = useState(1);
  const watchedPlanetsOptions = useMemo(() => ({ page: watchedPlanetsPage, pageSize: 25 }), [watchedPlanetsPage]);
  const watchedPlanetsSnapshot = useBackendDataSnapshot<WatchedPlanetsResponse>(
    backendData,
    backendData && account
      ? backendData.key("watched-planets", account, watchedPlanetsOptions)
      : undefined,
  );
  const watchedPlanets = watchedPlanetsSnapshot?.data;
  const watchedPlanetsLoading = watchedPlanetsSnapshot?.freshness === "refreshing";
  const watchedPlanetsError = watchedPlanetsSnapshot?.error;
  const setWatchedPlanets = useCallback((
    value: WatchedPlanetsResponse | undefined
      | ((current: WatchedPlanetsResponse | undefined) => WatchedPlanetsResponse | undefined),
  ) => {
    if (!backendData || !account) return;
    const current = backendData.value<WatchedPlanetsResponse>("watched-planets", account, watchedPlanetsOptions);
    const next = typeof value === "function" ? value(current) : value;
    if (next) backendData.publish("watched-planets", next, [account, watchedPlanetsOptions], { wallet: account });
  }, [account, backendData, watchedPlanetsOptions]);
  const setWatchedPlanetsError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("watched-planets", error, [account, watchedPlanetsOptions]);
  }, [account, backendData, watchedPlanetsOptions]);
  const [watchBusyPlanetId, setWatchBusyPlanetId] = useState<string | undefined>();
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | undefined>();
  const [selectedBodyKind, setSelectedBodyKind] = useState<OrbitBodyKind>("planet");
  const planetSectionStoreSnapshot = useBackendDataSnapshot<PlanetSectionStore>(
    backendData,
    backendData && account ? backendData.key("planet-sections", account) : undefined,
  );
  const planetSectionStore = planetSectionStoreSnapshot?.data ?? {};
  const setPlanetSectionStore = useCallback((
    value: PlanetSectionStore | ((current: PlanetSectionStore) => PlanetSectionStore),
  ) => {
    if (!backendData || !account) return;
    const current = backendData.value<PlanetSectionStore>("planet-sections", account) ?? {};
    const next = typeof value === "function" ? value(current) : value;
    backendData.publish("planet-sections", next, [account], { wallet: account });
  }, [account, backendData]);
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
  const activePlanetId = selectedManagedPlanet?.planetId
    ?? onChainSettlementState?.homePlanetId
    ?? indexedInfrastructurePlanetId(planetSectionStore, account)
    ?? indexedDefensePlanetId(planetSectionStore, account);
  const activePlanetReadinessSnapshot = useBackendDataSnapshot<boolean>(
    backendData,
    backendData && account && activePlanetId
      ? backendData.key("planet-readiness", account, activePlanetId)
      : undefined,
  );
  const activePlanetStateFresh = activePlanetReadinessSnapshot?.data ?? true;
  const setPlanetStateFresh = useCallback((planetId: string | undefined, fresh: boolean) => {
    if (!backendData || !account || !planetId) return;
    backendData.publish("planet-readiness", fresh, [account, planetId], { planetId, wallet: account });
  }, [account, backendData]);
  useEffect(() => {
    backendData?.setContext(account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const selectedMoonBody = selectedManagedPlanet?.moon?.exists ? selectedManagedPlanet.moon : null;
  const activeBodyKind = resolvedOrbitBodyKind(selectedBodyKind, selectedManagedPlanet);
  const activePlanetSection = useMemo(
    () => planetSectionForPlanet(planetSectionStore, activePlanetId),
    [activePlanetId, planetSectionStore]
  );
  const setActivePlanetSectionStatus = useCallback((
    key: Parameters<typeof setPlanetSectionStatus>[2],
    status: Parameters<typeof setPlanetSectionStatus>[3],
  ) => {
    if (!backendData || !account || key === "galaxySystemDataByKey" || key === "settlementState" || key === "queuesState") return;
    const canonicalKind = {
      infrastructureChainState: "infrastructure",
      moonState: "moon",
      defenseState: "defenses",
      shipyardState: "shipyard",
      researchState: "research",
      riftState: "rift",
    }[key];
    if (canonicalKind) backendData.fail(canonicalKind, status.error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const queuesSnapshot = useBackendDataSnapshot<PlayerQueuesResponse>(
    backendData,
    backendData && account ? backendData.key("queues", account, activePlanetId) : undefined,
  );
  const onChainQueuesState = queuesSnapshot?.data;
  const onChainQueues = onChainQueuesState;
  const setOnChainQueues = useCallback((
    value: PlayerQueuesResponse | undefined | ((current: PlayerQueuesResponse | undefined) => PlayerQueuesResponse | undefined),
  ) => {
    const next = typeof value === "function"
      ? value(onChainQueuesState)
      : value;
    if (backendData && account && next) {
      backendData.publish("queues", next, [account, activePlanetId], { planetId: activePlanetId, wallet: account });
    }
  }, [account, activePlanetId, backendData, onChainQueuesState]);
  // Mission Control is a commander-level surface. Keep its canonical mission feeds outside the
  // selected-planet section cache so changing launch origin cannot replace active or past rows with
  // a snapshot captured while another planet happened to be selected (VEY-KANEO-836).
  const fleetVisibilitySnapshot = useBackendDataSnapshot<FleetMissionVisibilityResponse>(
    backendData,
    backendData && account ? backendData.key("fleet-visibility", account, false) : undefined,
  );
  const fleetVisibility = fleetVisibilitySnapshot?.data;
  const setFleetVisibility = useCallback((
    value: FleetMissionVisibilityResponse | undefined
      | ((current: FleetMissionVisibilityResponse | undefined) => FleetMissionVisibilityResponse | undefined),
  ) => {
    if (!backendData || !account) return;
    const current = backendData.value<FleetMissionVisibilityResponse>("fleet-visibility", account, false);
    const next = typeof value === "function" ? value(current) : value;
    if (next) backendData.publish("fleet-visibility", next, [account, false], { wallet: account });
  }, [account, backendData]);
  const [missionArchivePage, setMissionArchivePage] = useState(1);
  const [missionFilters, setMissionFilters] = useState<MissionControlFilters>({ ...EMPTY_MISSION_CONTROL_FILTERS });
  const normalizedMissionFilters = normalizeMissionControlFilters(missionFilters);
  const [incomingAttackArchivePage, setIncomingAttackArchivePage] = useState(1);
  const [globalMissionArchivePage, setGlobalMissionArchivePage] = useState(1);
  const missionArchiveOptions = useMemo(() => ({
    missionNumber: normalizedMissionFilters.missionNumber,
    missionType: normalizedMissionFilters.missionType,
    page: missionArchivePage,
    pageSize: 25,
    planetId: normalizedMissionFilters.planetId,
  }), [missionArchivePage, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);
  const missionArchiveSnapshot = useBackendDataSnapshot<FleetMissionArchiveResponse>(
    backendData,
    backendData && account ? backendData.key("fleet-archive", account, missionArchiveOptions) : undefined,
  );
  const missionArchive = missionArchiveSnapshot?.data;
  const missionArchiveLoading = missionArchiveSnapshot?.freshness === "refreshing";
  const missionArchiveError = missionArchiveSnapshot?.error;
  const missileAttackArchiveOptions = useMemo(() => ({ page: 1, pageSize: 25 }), []);
  const missileAttackArchiveSnapshot = useBackendDataSnapshot<MissileAttackArchiveResponse>(
    backendData,
    backendData && account ? backendData.key("missile-archive", account, missileAttackArchiveOptions) : undefined,
  );
  const missileAttackArchive = missileAttackArchiveSnapshot?.data;
  const missileAttackArchiveLoading = missileAttackArchiveSnapshot?.freshness === "refreshing";
  const missileAttackArchiveError = missileAttackArchiveSnapshot?.error;
  const incomingAttackArchiveOptions = useMemo(() => ({
    filter: "incomingAttacks" as const,
    missionNumber: normalizedMissionFilters.missionNumber,
    missionType: normalizedMissionFilters.missionType,
    page: incomingAttackArchivePage,
    pageSize: 25,
    planetId: normalizedMissionFilters.planetId,
  }), [incomingAttackArchivePage, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);
  const incomingAttackArchiveSnapshot = useBackendDataSnapshot<FleetMissionArchiveResponse>(
    backendData,
    backendData && account ? backendData.key("fleet-archive", account, incomingAttackArchiveOptions) : undefined,
  );
  const incomingAttackArchive = incomingAttackArchiveSnapshot?.data;
  const incomingAttackArchiveLoading = incomingAttackArchiveSnapshot?.freshness === "refreshing";
  const incomingAttackArchiveError = incomingAttackArchiveSnapshot?.error;
  const allActiveMissionsSnapshot = useBackendDataSnapshot<GlobalActiveMissionsResponse>(
    backendData,
    backendData?.key("global-active-missions"),
  );
  const allActiveMissions = allActiveMissionsSnapshot?.data?.missions;
  const setAllActiveMissions = useCallback((
    value: FleetMissionSummary[] | undefined
      | ((current: FleetMissionSummary[] | undefined) => FleetMissionSummary[] | undefined),
  ) => {
    if (!backendData) return;
    const currentResponse = backendData.value<GlobalActiveMissionsResponse>("global-active-missions");
    const missions = typeof value === "function" ? value(currentResponse?.missions) : value;
    if (missions) {
      backendData.publish("global-active-missions", { ...currentResponse, missions } as GlobalActiveMissionsResponse);
    }
  }, [backendData]);
  const globalMissionArchiveOptions = useMemo(() => ({
    missionNumber: normalizedMissionFilters.missionNumber,
    missionType: normalizedMissionFilters.missionType,
    page: globalMissionArchivePage,
    pageSize: 25,
    planetId: normalizedMissionFilters.planetId,
  }), [globalMissionArchivePage, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);
  const globalMissionArchiveSnapshot = useBackendDataSnapshot<GlobalMissionArchiveResponse>(
    backendData,
    backendData?.key("global-mission-archive", globalMissionArchiveOptions),
  );
  const globalMissionArchive = globalMissionArchiveSnapshot?.data;
  const globalMissionArchiveLoading = globalMissionArchiveSnapshot?.freshness === "refreshing";
  const globalMissionArchiveError = globalMissionArchiveSnapshot?.error;
  const [globalMissionArchiveTotalEntries, setGlobalMissionArchiveTotalEntries] = useState<number | undefined>();
  const [missionPlanetArchetypesByCoordinate, setMissionPlanetArchetypesByCoordinate] = useState<Map<string, PlanetType>>(
    () => new Map()
  );
  const publicBattleReportsSnapshot = useBackendDataSnapshot<BattleReport[]>(
    backendData,
    backendData?.key("battle-reports"),
  );
  const publicBattleReports = publicBattleReportsSnapshot?.data ?? [];
  const publicBattleReportsLoading = publicBattleReportsSnapshot?.freshness === "refreshing";
  const publicBattleReportsError = publicBattleReportsSnapshot?.error;
  const missionDetailSnapshot = useBackendDataSnapshot<MissionDetailResponse>(
    backendData,
    backendData && missionDetailId ? backendData.key("mission", missionDetailId) : undefined,
  );
  const missionDetail = missionDetailSnapshot?.data;
  const missionDetailLoading = missionDetailSnapshot?.freshness === "refreshing";
  const missionDetailError = missionDetailSnapshot?.error;
  const setPublicBattleReports = useCallback((
    value: BattleReport[] | ((current: BattleReport[]) => BattleReport[]),
  ) => {
    if (!backendData) return;
    const current = backendData.value<BattleReport[]>("battle-reports") ?? [];
    backendData.publish("battle-reports", typeof value === "function" ? value(current) : value);
  }, [backendData]);
  const setMissionDetail = useCallback((
    value: MissionDetailResponse | undefined
      | ((current: MissionDetailResponse | undefined) => MissionDetailResponse | undefined),
  ) => {
    if (!backendData || !missionDetailId) return;
    const current = backendData.value<MissionDetailResponse>("mission", missionDetailId);
    const next = typeof value === "function" ? value(current) : value;
    if (next) backendData.publish("mission", next, [missionDetailId]);
  }, [backendData, missionDetailId]);
  const onChainStatusSnapshot = useBackendDataSnapshot<ChainLoadStatus>(
    backendData,
    backendData ? backendData.key("wallet-read-status", account ?? "disconnected") : undefined,
  );
  const onChainErrorSnapshot = useBackendDataSnapshot<string>(
    backendData,
    backendData ? backendData.key("wallet-read-error", account ?? "disconnected") : undefined,
  );
  const selectedPlanetOverviewSnapshot = useBackendDataSnapshot<WalletOverviewSnapshotResponse>(
    backendData,
    backendData && account ? backendData.key("overview", account, activePlanetId) : undefined,
  );
  const onChainStatus = isWalletConnected
    ? selectedPlanetOverviewSnapshot?.freshness === "refreshing"
      ? "loading"
      : selectedPlanetOverviewSnapshot?.freshness === "failed"
        ? "error"
        : onChainStatusSnapshot?.data
          ?? (settlementSnapshot?.data || walletPlanetsSnapshot?.data ? "ready" : "loading")
    : "local";
  const onChainError = selectedPlanetOverviewSnapshot?.error ?? onChainErrorSnapshot?.data;
  const setOnChainStatus = useCallback((
    value: ChainLoadStatus | ((current: ChainLoadStatus) => ChainLoadStatus),
  ) => {
    if (!backendData) return;
    const keyWallet = account ?? "disconnected";
    const current = backendData.value<ChainLoadStatus>("wallet-read-status", keyWallet) ?? "local";
    const next = typeof value === "function" ? value(current) : value;
    backendData.publish("wallet-read-status", next, [keyWallet], account ? { wallet: account } : {});
  }, [account, backendData]);
  const setOnChainError = useCallback((error: string | undefined) => {
    if (!backendData) return;
    const keyWallet = account ?? "disconnected";
    if (error === undefined) backendData.clear("wallet-read-error", keyWallet);
    else backendData.publish("wallet-read-error", error, [keyWallet], account ? { wallet: account } : {});
  }, [account, backendData]);
  const [hydratedWalletSnapshotKey, setHydratedWalletSnapshotKey] = useState<string | undefined>();
  const [chainSyncHealthy, setChainSyncHealthy] = useState(false);
  const activePlanetResourceSnapshot = canonicalPlanetResourceSnapshotFor(
    canonicalPlanetResources,
    account,
    activePlanetId,
  );
  const activeMoonResourceSnapshot = canonicalPlanetResourceSnapshotFor(
    canonicalPlanetResources,
    account,
    activePlanetId,
    "moon",
  );
  const onChainSettlement = useMemo(() => walletSettlementWithCanonicalPlanetResources(
    onChainSettlementState,
    canonicalPlanetResources,
    account,
  ), [account, canonicalPlanetResources, onChainSettlementState]);
  const applyOnChainSettlementSnapshot = useCallback((settlement: WalletSettlementResponse | undefined) => {
    const planetId = settlement?.planet?.planetId ?? settlement?.homePlanetId ?? activePlanetId;
    if (backendData && account && settlement) {
      backendData.publish("settlement", settlement, [account], { planetId, wallet: account });
    }
  }, [account, activePlanetId, backendData]);
  const updateOnChainSettlementSnapshot = useCallback((
    updater: (current: WalletSettlementResponse | undefined) => WalletSettlementResponse | undefined,
  ) => {
    const nextSettlement = updater(onChainSettlementState);
    if (backendData && account && nextSettlement) {
      backendData.publish("settlement", nextSettlement, [account], {
        planetId: nextSettlement.planet?.planetId ?? nextSettlement.homePlanetId ?? activePlanetId,
        wallet: account,
      });
    }
  }, [account, activePlanetId, backendData, onChainSettlementState]);
  const infrastructureSnapshot = useBackendDataSnapshot<ChainInfrastructureState>(
    backendData,
    backendData && account ? backendData.key("infrastructure", account, activePlanetId) : undefined,
  );
  const infrastructureChainState = resourceStateWithCanonicalPlanetResources(
    infrastructureSnapshot?.data ?? null,
    activePlanetResourceSnapshot,
  );
  const setInfrastructureChainState = useCallback((
    value: ChainInfrastructureState | null | ((current: ChainInfrastructureState | null) => ChainInfrastructureState | null),
  ) => {
    if (!backendData || !account) return;
    const currentValue = backendData.value<ChainInfrastructureState>("infrastructure", account, activePlanetId) ?? null;
    const nextValue = typeof value === "function" ? value(currentValue) : value;
    if (nextValue) {
      backendData.publish("infrastructure", nextValue, [account, activePlanetId], {
        planetId: infrastructureSnapshotPlanetId(nextValue, activePlanetId),
        wallet: account,
      });
    } else backendData.clear("infrastructure", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const infrastructureLoading = infrastructureSnapshot?.freshness === "refreshing";
  const infrastructureError = infrastructureSnapshot?.error;
  const setInfrastructureError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("infrastructure", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const moonSnapshot = useBackendDataSnapshot<ChainMoonState>(
    backendData,
    backendData && account ? backendData.key("moon", account, activePlanetId) : undefined,
  );
  const moonState = resourceStateWithCanonicalPlanetResources(
    moonSnapshot?.data ?? null,
    activeMoonResourceSnapshot,
  );
  const setMoonState = useCallback((value: ChainMoonState | null) => {
    if (!backendData || !account) return;
    if (value) backendData.publish("moon", value, [account, activePlanetId], { planetId: activePlanetId, wallet: account });
    else backendData.clear("moon", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const moonLoading = moonSnapshot?.freshness === "refreshing";
  const moonError = moonSnapshot?.error;
  const setMoonError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("moon", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const defenseSnapshot = useBackendDataSnapshot<ChainDefenseState>(
    backendData,
    backendData && account ? backendData.key("defenses", account, activePlanetId) : undefined,
  );
  const defenseState = resourceStateWithCanonicalPlanetResources(
    defenseSnapshot?.data ?? null,
    activePlanetResourceSnapshot,
  );
  const setDefenseState = useCallback((value: ChainDefenseState | null) => {
    if (!backendData || !account) return;
    if (value) backendData.publish("defenses", value, [account, activePlanetId], {
      planetId: defenseSnapshotPlanetId(value, activePlanetId),
      wallet: account,
    });
    else backendData.clear("defenses", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const defenseLoading = defenseSnapshot?.freshness === "refreshing";
  const defenseError = defenseSnapshot?.error;
  const setDefenseError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("defenses", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const [defenseAction, setDefenseAction] = useState<DefenseActionState>({ status: "idle" });
  const allianceSnapshot = useBackendDataSnapshot<ChainAllianceState>(
    backendData,
    backendData && account ? backendData.key("alliance", account) : undefined,
  );
  const allianceState = allianceSnapshot?.data ?? null;
  const allianceLoading = allianceSnapshot?.freshness === "refreshing";
  const allianceError = allianceSnapshot?.error;
  const setAllianceState = useCallback((
    value: ChainAllianceState | null | ((current: ChainAllianceState | null) => ChainAllianceState | null),
  ) => {
    if (!backendData || !account) return;
    const current = backendData.value<ChainAllianceState>("alliance", account) ?? null;
    const next = typeof value === "function" ? value(current) : value;
    if (next) backendData.publish("alliance", next, [account], { wallet: account });
    else backendData.clear("alliance", account);
  }, [account, backendData]);
  const [allianceAction, setAllianceAction] = useState<AllianceActionState>({ status: "idle" });
  const [selectedAllianceId, setSelectedAllianceId] = useState<string | null>(null);
  const shipyardSnapshot = useBackendDataSnapshot<ChainShipyardState>(
    backendData,
    backendData && account ? backendData.key("shipyard", account, activePlanetId) : undefined,
  );
  const shipyardState = resourceStateWithCanonicalPlanetResources(
    shipyardSnapshot?.data ?? null,
    activePlanetResourceSnapshot,
  );
  const setShipyardState = useCallback((value: ChainShipyardState | null) => {
    if (!backendData || !account) return;
    if (value) backendData.publish("shipyard", value, [account, activePlanetId], { planetId: activePlanetId, wallet: account });
    else backendData.clear("shipyard", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const shipyardLoading = shipyardSnapshot?.freshness === "refreshing";
  const shipyardError = shipyardSnapshot?.error;
  const setShipyardError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("shipyard", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const [shipyardAction, setShipyardAction] = useState<ShipyardActionState>({ status: "idle" });
  const [galaxyAction, setGalaxyAction] = useState<GalaxyActionState>({ status: "idle" });
  const [batchSupplyTarget, setBatchSupplyTarget] = useState<ManagedPlanetResponse | null>(null);
  const [batchSupplySources, setBatchSupplySources] = useState<BatchSupplySource[]>([]);
  const [batchSupplyMaxSources, setBatchSupplyMaxSources] = useState(0);
  const [batchSupplyLoading, setBatchSupplyLoading] = useState(false);
  const [batchSupplyError, setBatchSupplyError] = useState<string | undefined>();
  const [pendingGalaxyMission, setPendingGalaxyMission] = useState<PendingGalaxyMission | null>(null);
  const [pendingAttackProtection, setPendingAttackProtection] = useState<PendingAttackProtection | null>(null);
  const missionComposerRefreshKeyRef = useRef<string | null>(null);
  // VEY-KANEO-431: a join-attack awaiting fleet selection. When set, the same
  // fleet picker the Attack action uses is shown so the player chooses which
  // ships to commit, instead of immediately sending a default fleet.
  const [pendingJoinAttack, setPendingJoinAttack] = useState<{
    attackMissionId: string;
    targetPlanetId: string;
    coords: Coordinates;
    mission: FleetMissionSummary;
    target: Planet | undefined;
  } | null>(null);
  // VEY-KANEO-440: an ACS Defend ("Defend planet") counterplay awaiting fleet selection. When set, the
  // mission compose picker opens with a hold-duration / holding-fuel / Alliance Depot preview so the
  // player chooses the fleet and speed, instead of immediately sending a default counterplay fleet.
  const [pendingAcsDefend, setPendingAcsDefend] = useState<{
    hostileMissionId: string;
    coords: Coordinates;
    hostileArrivalMs: number;
    depotLevel: number;
    coordinationBlocker?: string | undefined;
  } | null>(null);
  const researchSnapshot = useBackendDataSnapshot<ChainResearchState>(
    backendData,
    backendData && account ? backendData.key("research", account, activePlanetId) : undefined,
  );
  const researchState = resourceStateWithCanonicalPlanetResources(
    researchSnapshot?.data ?? null,
    activePlanetResourceSnapshot,
  );
  const setResearchState = useCallback((
    value: ChainResearchState | null | ((current: ChainResearchState | null) => ChainResearchState | null),
  ) => {
    if (!backendData || !account) return;
    const current = backendData.value<ChainResearchState>("research", account, activePlanetId) ?? null;
    const next = typeof value === "function" ? value(current) : value;
    if (next) backendData.publish("research", next, [account, activePlanetId], { planetId: activePlanetId, wallet: account });
    else backendData.clear("research", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const researchLoading = researchSnapshot?.freshness === "refreshing";
  const researchError = researchSnapshot?.error;
  const setResearchError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("research", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
  const [researchAction, setResearchAction] = useState<ResearchActionState>({ status: "idle" });
  const riftSnapshot = useBackendDataSnapshot<ChainRiftState>(
    backendData,
    backendData && account ? backendData.key("rift", account, activePlanetId) : undefined,
  );
  const riftState = riftStateWithCanonicalPlanetResources(
    riftSnapshot?.data ?? null,
    activePlanetResourceSnapshot,
  );
  const setRiftState = useCallback((value: ChainRiftState | null) => {
    if (!backendData || !account) return;
    if (value) backendData.publish("rift", value, [account, activePlanetId], { planetId: activePlanetId, wallet: account });
    else backendData.clear("rift", account, activePlanetId);
  }, [account, activePlanetId, backendData]);
  const riftLoading = riftSnapshot?.freshness === "refreshing";
  const riftError = riftSnapshot?.error;
  const setRiftError = useCallback((error: string | undefined) => {
    if (backendData && account) backendData.fail("rift", error, [account, activePlanetId]);
  }, [account, activePlanetId, backendData]);
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
  const [writeTransactionState, setWriteTransactionState] = useState<WriteTransactionState>({ phase: "idle" });
  // The shareable battle-report URL currently shown in the share dialog; null when it is closed.
  const [shareDialogUrl, setShareDialogUrl] = useState<string | null>(null);
  const [playerActivityOpen, setPlayerActivityOpen] = useState(false);
  const [moonAction, setMoonAction] = useState<MoonActionState>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;
  const onChainRefreshGate = useRef(0);
  const infrastructureRefreshGate = useRef(0);
  const defenseRefreshGate = useRef(0);
  const shipyardRefreshGate = useRef(0);
  const researchRefreshGate = useRef(0);
  const riftRefreshGate = useRef(0);
  const missionArchiveRefreshGate = useRef(0);
  const missileAttackArchiveRefreshGate = useRef(0);
  const incomingAttackArchiveRefreshGate = useRef(0);
  const allActiveMissionsRefreshGate = useRef(0);
  const globalMissionArchiveRefreshGate = useRef(0);
  const globalMissionArchiveSummaryRefreshGate = useRef(0);
  const planetSwitchGate = useRef(0);
  const pendingPlanetStateRefreshRef = useRef<string | undefined>();
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
  const activeShipyardProductionQueue = shipyardState
    ? activeProductionQueue(shipyardState.queue, undefined, "ship")
    : activeProductionQueue(undefined, onChainQueues?.ship, "ship");
  const activeDefenseProductionQueue = defenseState
    ? activeProductionQueue(defenseState.queue, undefined, "defense")
    : activeProductionQueue(undefined, onChainQueues?.defense, "defense");
  const displayFleetVisibility = fleetVisibility;
  const displayAllActiveMissions = allActiveMissions ?? [];
  const overviewFleetVisibility = useMemo(
    () => planetScopedFleetVisibility(
      displayFleetVisibility,
      activePlanetId,
      walletPlanets?.map((planet) => planet.planetId),
    ),
    [activePlanetId, displayFleetVisibility, walletPlanets]
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
  const expectedWalletSnapshotKey = walletSnapshotHydrationKey(apiBaseUrl, account);
  const planetPickerAttackHighlights = useMemo(() => derivePlanetPickerAttackHighlights({
    account,
    fleetVisibility: displayFleetVisibility,
    hydrated: Boolean(expectedWalletSnapshotKey && hydratedWalletSnapshotKey === expectedWalletSnapshotKey),
    planetIds: walletPlanets.map((planet) => planet.planetId),
  }), [account, displayFleetVisibility, expectedWalletSnapshotKey, hydratedWalletSnapshotKey, walletPlanets]);
  const gameWalletChain = useMemo<VeydriftWalletChain>(() => {
    return runtimeConfig.status === "ready"
      ? veydriftChainForChainId(runtimeConfig.config.chainId)
      : defaultVeydriftChainForLocation();
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
        const payload = await backendData!.system<ApiSystemResponse>(galaxy!, system!);
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
      replaceLegacyHashRoute();
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
    pendingPlanetStateRefreshRef.current = undefined;
    setPlanetStateFresh(activePlanetId, true);
    setSelectedBodyKind("planet");
    setWalletPlanets([]);
    setOnChainQueues(undefined);
    setFleetVisibility(undefined);
    setHydratedWalletSnapshotKey(undefined);
    setPlayerProfileAction({ status: "idle" });
  }, [account]);

  const loadPublicBattleReports = useCallback(() => {
    if (!apiBaseUrl) {
      return;
    }
    void backendData!.battleReports({ requestScope: "battle-reports-navigation" }).catch(() => {});
  }, [apiBaseUrl, backendData]);

  useEffect(() => {
    if (page !== "battle-reports") return;
    if (!apiBaseUrl || !backendData) return;
    backendData.cancelScope("battle-reports-navigation");
    void backendData.battleReports({ requestScope: "battle-reports-navigation" }).catch(() => {});

    return () => {
      backendData.cancelScope("battle-reports-navigation");
    };
  }, [apiBaseUrl, backendData, page]);

  const loadMissionDetail = useCallback(() => {
    if (!apiBaseUrl || !missionDetailId) {
      return;
    }
    void backendData!.mission(missionDetailId, { requestScope: "mission-detail-navigation" }).catch(() => {});
  }, [apiBaseUrl, backendData, missionDetailId]);

  // VEY-KANEO-433: background refresh for the *open* mission detail. The auto-poll/ETA one-shot keep
  // the Mission Control lists live, but a viewer sitting on a battle report (`/mission/<id>` or a
  // legacy `#/battle-report/<id>`) when the mission resolves would still see stale loot / "no battle
  // report yet" until a manual Refresh — exactly the gap this ticket targets. Unlike `loadMissionDetail`
  // (the manual Refresh button), this never toggles the loading spinner and never clobbers the rendered
  // detail or surfaces an error on a transient poll failure, so the page updates silently in place.
  const refreshOpenMissionDetailSilently = useCallback(async () => {
    if (!apiBaseUrl || !missionDetailId) return;
    try {
      await backendData!.mission(missionDetailId, { requestScope: "mission-detail-navigation" });
    } catch {
      // Keep the last-rendered detail on a transient background failure; the next tick retries.
    }
  }, [apiBaseUrl, backendData, missionDetailId]);

  useEffect(() => {
    if (!missionDetailId) return;
    if (!apiBaseUrl || !backendData) return;
    backendData.cancelScope("mission-detail-navigation");
    void backendData.mission(missionDetailId, { requestScope: "mission-detail-navigation" }).catch(() => {});

    return () => {
      backendData.cancelScope("mission-detail-navigation");
    };
  }, [apiBaseUrl, backendData, missionDetailId]);

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
      backendData!.mission(missionDetailId, { requestScope: "mission-detail-navigation" })
        .catch(() => {
          // Keep the visible mission detail while the generator is still catching up.
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };

    const interval = window.setInterval(pollPendingReport, MISSION_REPORT_PENDING_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [apiBaseUrl, backendData, missionDetail, missionDetailId]);

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
      const profile = await backendData!.profile(account);
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
      return;
    }

    setWatchedPlanetsError(undefined);
    try {
      await backendData!.watchedPlanets(account, { page, pageSize: 25 });
    } catch (error) {
      console.error(error);
      setWatchedPlanetsError(walletRequestErrorMessage(error));
    }
  }, [account, apiBaseUrl, backendData, watchedPlanetsPage]);

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
  const moonAttackParityEnabled = runtimeConfig.status === "ready"
    && runtimeConfig.config.featureSupport?.moonAttackParity === true;
  const allianceContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? allianceContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const paidAllianceInviteContract = runtimeConfig.status === "ready"
    ? runtimeConfig.config.paidAllianceInviteAddress ?? undefined
    : undefined;
  const moonContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? moonContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const chickenBurnConfig = useMemo(() => {
    return runtimeConfig.status === "ready" ? burningChickenConfig(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const transactionReceiptRpcUrl = useMemo(() => {
    return runtimeConfig.status === "ready"
      ? veydriftChainForChainId(runtimeConfig.config.chainId).rpcUrls[0]
      : "";
  }, [runtimeConfig]);
  const gameActionInputsAvailable = currentPlanetTransactionInputsAvailable(
    gameActionsAvailableForBody(activeBodyKind, Boolean(provider && account && gameContract && (activePlanetId ?? onChainSettlement?.homePlanetId))),
    activePlanetStateFresh,
  );
  const missionActionInputsAvailable = currentPlanetTransactionInputsAvailable(
    Boolean(provider && account && gameContract && (activePlanetId ?? onChainSettlement?.homePlanetId)),
    activePlanetStateFresh,
  );
  const allianceActionInputsAvailable = Boolean(provider && account && allianceContract);
  const moonActionInputsAvailable = currentPlanetTransactionInputsAvailable(
    Boolean(provider && account && moonContract && (activePlanetId ?? onChainSettlement?.homePlanetId)),
    activePlanetStateFresh,
  );

  useEffect(() => {
    if (!gameActionInputsAvailable) return;
    setBuildingAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setDefenseAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setShipyardAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setResearchAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setRiftAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setPlanetManagementAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setPlanetRenameAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [gameActionInputsAvailable, transactionActionPending]);

  useEffect(() => {
    if (!missionActionInputsAvailable) return;
    setGalaxyAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
    setMissionAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [missionActionInputsAvailable, transactionActionPending]);

  useEffect(() => {
    if (!allianceActionInputsAvailable) return;
    setAllianceAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [allianceActionInputsAvailable, transactionActionPending]);

  useEffect(() => {
    if (!moonActionInputsAvailable) return;
    setMoonAction((current) => clearRecoveredWalletContractUnavailableAction(current, true));
  }, [moonActionInputsAvailable, transactionActionPending]);

  const confirmSubmittedTransaction = useCallback(async (txHash: string): Promise<TransactionReceipt> => {
    if (!provider) {
      throw new Error("Wallet provider is unavailable while confirming the transaction.");
    }
    return confirmTransactionReceiptForProviderSource(
      provider,
      walletProviderSource,
      transactionReceiptRpcUrl,
      txHash,
    );
  }, [provider, transactionReceiptRpcUrl, walletProviderSource]);

  const runCoordinatedWriteTransaction = useCallback(async <IndexedSnapshot,>({
    applyIndexedState,
    errorLabel,
    key,
    label,
    onErrorRefresh,
    onStateChange,
    send,
    waitForIndexed,
  }: {
    applyIndexedState?: (snapshot: IndexedSnapshot) => Promise<void> | void;
    errorLabel?: (error: unknown) => string;
    key: string;
    label: string;
    onErrorRefresh?: (error: unknown) => Promise<void> | void;
    onStateChange?: (state: WriteTransactionState) => void;
    send: () => Promise<string>;
    waitForIndexed?: (receipt: TransactionReceipt, txHash: string) => Promise<IndexedSnapshot>;
  }) => {
    return runWriteTransaction(transactionActionGate, {
      ...(applyIndexedState ? { applyIndexedState } : {}),
      confirm: confirmSubmittedTransaction,
      ...(errorLabel ? { errorLabel } : {}),
      key,
      label,
      ...(onErrorRefresh ? { onErrorRefresh } : {}),
      onStateChange: (state) => {
        setWriteTransactionState(state);
        setTransactionActionPending(state.phase !== "idle" && state.phase !== "success" && state.phase !== "error");
        // Success/error feedback arrives through the action-notice hook below;
        // the gate only voices wallet/chain progress so sounds never double up.
        if (state.phase === "pending") {
          playSfx("tx-pending");
        } else if (state.phase === "confirming") {
          playSfx("tx-confirm");
          haptic("select");
        }
        onStateChange?.(state);
      },
      send,
      ...(waitForIndexed ? { waitForIndexed: waitForIndexed as (receipt: unknown, txHash: string) => Promise<IndexedSnapshot> } : {}),
    });
  }, [confirmSubmittedTransaction, transactionActionGate]);

  const refreshInfrastructureState = useCallback(async () => {
    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    if (!apiBaseUrl || !account) {
      setInfrastructureChainState(null);
      setMoonState(null);
      return;
    }

    setInfrastructureError(undefined);
    setMoonError(undefined);
    {
      const [infrastructureResult, moonResult] = await Promise.all([
        settlePromise(backendData!.infrastructure(account, activePlanetId)),
        settlePromise(backendData!.moon(account, activePlanetId)),
      ]);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return;
      if (infrastructureResult.status === "fulfilled") {
        const nextInfrastructure = infrastructureResult.value;
        promoteBackendResourceState(nextInfrastructure);
      } else {
        console.error(infrastructureResult.reason);
      }
      if (moonResult.status === "fulfilled") {
        promoteBackendResourceState(moonResult.value, { bodyKind: "moon", planetId: activePlanetId });
      } else {
        console.error(moonResult.reason);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, infrastructureChainState, moonState, promoteBackendResourceState]);

  const refreshLiveInfrastructureState = useCallback(async () => {
    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    if (!apiBaseUrl || !account) {
      setInfrastructureChainState(null);
      setActivePlanetSectionStatus("infrastructureChainState", { loading: false, error: undefined });
      return null;
    }

    setInfrastructureError(undefined);
    try {
      const nextInfrastructure = await backendData!.infrastructure(account, activePlanetId);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return nextInfrastructure;
      promoteBackendResourceState(nextInfrastructure);
      return nextInfrastructure;
    } catch (error) {
      console.error(error);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) throw error;
      throw error;
    }
  }, [account, activePlanetId, apiBaseUrl, infrastructureChainState, promoteBackendResourceState]);

  const refreshDefenseState = useCallback(async () => {
    const requestId = beginRefreshRequest(defenseRefreshGate);
    if (!apiBaseUrl || !account) {
      setDefenseState(null);
      return null;
    }

    setDefenseError(undefined);
    try {
      const next = await backendData!.defenses(account, activePlanetId);
      if (!canApplyRefreshRequest(defenseRefreshGate, requestId)) return next;
      promoteBackendResourceState(next, { planetId: activePlanetId });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(defenseRefreshGate, requestId)) {
      }
      return null;
    }
  }, [account, activePlanetId, apiBaseUrl, promoteBackendResourceState]);

  const refreshAllianceState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      return Promise.resolve(null);
    }

    return backendData!.alliance(account)
      .then((next) => next)
      .catch((error) => {
        console.error(error);
        return null;
      });
  }, [account, apiBaseUrl]);

  const refreshShipyardState = useCallback(async (options: { clearCachedState?: boolean } = {}) => {
    const requestId = beginRefreshRequest(shipyardRefreshGate);
    if (!apiBaseUrl || !account) {
      setShipyardState(null);
      return null;
    }

    setShipyardError(undefined);
    if (options.clearCachedState) {
      setShipyardState(null);
    }
    try {
      const next = await backendData!.shipyard(account, activePlanetId);
      if (!canApplyRefreshRequest(shipyardRefreshGate, requestId)) return next;
      promoteBackendResourceState(next, { planetId: activePlanetId });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(shipyardRefreshGate, requestId)) {
      }
      return null;
    }
  }, [account, activePlanetId, apiBaseUrl, promoteBackendResourceState]);

  const refreshResearchState = useCallback(async () => {
    const requestId = beginRefreshRequest(researchRefreshGate);
    if (!apiBaseUrl || !account) {
      setResearchState(null);
      return null;
    }

    setResearchError(undefined);
    try {
      const next = await backendData!.research(account, activePlanetId);
      if (!canApplyRefreshRequest(researchRefreshGate, requestId)) return next;
      promoteBackendResourceState(next, { planetId: activePlanetId });
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(researchRefreshGate, requestId)) {
      }
      return null;
    }
  }, [account, activePlanetId, apiBaseUrl, promoteBackendResourceState, researchState]);

  const refreshRiftState = useCallback(async () => {
    const requestId = beginRefreshRequest(riftRefreshGate);
    if (!apiBaseUrl || !account) {
      setRiftState(null);
      return null;
    }

    setRiftError(undefined);
    try {
      const next = await backendData!.rift(account, activePlanetId);
      if (!canApplyRefreshRequest(riftRefreshGate, requestId)) return next;
      return next;
    } catch (error) {
      console.error(error);
      if (canApplyRefreshRequest(riftRefreshGate, requestId)) {
      }
      return null;
    }
  }, [account, activePlanetId, apiBaseUrl, onChainQueues?.research]);

  const refreshOnChainState = useCallback(async (
    renameExpectation?: { planetId: string; name: string },
    options: { force?: boolean; forceHomePlanet?: boolean; forceWalletPlanets?: boolean } = {},
  ) => {
    const requestId = beginRefreshRequest(onChainRefreshGate);
    if (!apiBaseUrl || !account) {
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
          fresh: true,
          ...(options.forceHomePlanet === undefined ? {} : { forceHomePlanet: options.forceHomePlanet }),
          ...(options.forceWalletPlanets === undefined ? {} : { forceWalletPlanets: options.forceWalletPlanets }),
        },
        {},
        backendData,
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
      // Successful wallet sync reads are authoritative for queues and fleet visibility.
      setOnChainQueues(queues);
      if (fleetVisibility) {
        setFleetVisibility((current) => newestFleetVisibility(current, fleetVisibility));
      }
      setOnChainError(undefined);
      setOnChainStatus("ready");
      promoteWalletPlanetResourceStates(planets);
      promoteBackendResourceState(nextSettlement.planet, { planetId: nextSettlement.homePlanetId, wallet: nextSettlement.wallet });
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
      if (pendingPlanetStateRefreshRef.current === nextSelectedPlanetId) {
        pendingPlanetStateRefreshRef.current = undefined;
        setPlanetStateFresh(nextSelectedPlanetId, true);
      }
      setPlayerProfile((current) => mergePlayerProfile(current, nextSettlement.player ?? planetsResponse.player));
      setHydratedWalletSnapshotKey(walletSnapshotHydrationKey(apiBaseUrl, account));
    } catch (error) {
      if (!canApplyRefreshRequest(onChainRefreshGate, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to load live game state";
      setOnChainError(message);
      setOnChainStatus((current) => hasUsableOnChainState && current !== "local" ? current : "error");
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, hydratedWalletSnapshotKey, isWalletConnected, onChainQueues, onChainSettlementState, onChainSettlementState?.homePlanetId, promoteBackendResourceState, promoteWalletPlanetResourceStates, selectedPlanetId, walletPlanets]);

  const applyBackendConfirmedResourceState = useCallback((state: BackendConfirmedResourceState) => {
    // This backend snapshot is proven to include the write transaction. Promote
    // it synchronously into the canonical resource store and invalidate
    // any older wallet/infrastructure request that was already in flight.
    markFreshStateWrite(onChainRefreshGate);
    markFreshStateWrite(infrastructureRefreshGate);
    promoteBackendResourceState(state, { confirmedTransaction: true });
    return true;
  }, [promoteBackendResourceState]);

  const applyBackendConfirmedMoonResourceState = useCallback((state: ChainMoonState) => {
    const planetId = state.resourceSnapshot?.planetId ?? state.parentPlanetId ?? state.homePlanetId;
    if (!planetId) return false;
    markFreshStateWrite(infrastructureRefreshGate);
    promoteBackendResourceState(state, {
      bodyKind: "moon",
      confirmedTransaction: true,
      planetId,
    });
    if (activePlanetId === planetId) {
      setMoonState(state);
    }
    return true;
  }, [activePlanetId, promoteBackendResourceState, setMoonState]);

  const convergeBackendIndexedResourceState = useCallback(async <State extends BackendResourceState>(
    load: () => Promise<State>,
    expectation: ResourceIndexingExpectation,
    options: { bodyKind?: OrbitBodyKind; planetId?: string | null | undefined } = {},
  ): Promise<State> => {
    const state = await waitForIndexedResourceState(load, expectation);
    if (options.bodyKind === "moon") {
      applyBackendConfirmedMoonResourceState(state as unknown as ChainMoonState);
    } else {
      applyBackendConfirmedResourceState(state as unknown as BackendConfirmedResourceState);
    }
    return state;
  }, [applyBackendConfirmedMoonResourceState, applyBackendConfirmedResourceState]);

  const refreshConfirmedResourceChange = useCallback(async (change: ChainResourceChange) => {
    if (!apiBaseUrl || !account) return null;
    const planetSwitchRequestId = planetSwitchGate.current;
    const expectation = resourceIndexingExpectationForTransaction(
      change.transactionHash,
      undefined,
      { blockNumber: change.blockNumber },
    );
    if (change.bodyKind === "moon") {
      const state = await convergeBackendIndexedResourceState(
        () => backendData!.moon(account, change.planetId),
        expectation,
        { bodyKind: "moon", planetId: change.planetId },
      );
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return null;
      return state;
    }

    const state = await convergeBackendIndexedResourceState(
      () => backendData!.infrastructure(account, change.planetId),
      expectation,
      { planetId: change.planetId },
    );
    if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return null;
    if (activePlanetId === change.planetId) {
      setInfrastructureChainState(state);
    }
    return state;
  }, [
    account,
    activePlanetId,
    apiBaseUrl,
    convergeBackendIndexedResourceState,
  ]);

  const loadMissionArchive = useCallback(async (page: number) => {
    const requestId = beginRefreshRequest(missionArchiveRefreshGate);
    if (!apiBaseUrl || !account) {
      return;
    }
    setMissionArchivePage(page);
    backendData!.cancelScope("mission-archive-filter");
    try {
      await backendData!.fleetArchive(account, {
        missionNumber: normalizedMissionFilters.missionNumber,
        missionType: normalizedMissionFilters.missionType,
        page,
        pageSize: 25,
        planetId: normalizedMissionFilters.planetId,
        requestScope: "mission-archive-filter",
      });
    } catch (error) {
      if (!canApplyRefreshRequest(missionArchiveRefreshGate, requestId)) return;
      console.error(error);
    }
  }, [account, apiBaseUrl, backendData, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);

  const loadMissileAttackArchive = useCallback(async () => {
    const requestId = beginRefreshRequest(missileAttackArchiveRefreshGate);
    if (!apiBaseUrl || !account) {
      return;
    }
    backendData!.cancelScope("missile-archive-filter");
    try {
      await backendData!.missileArchive(account, { ...missileAttackArchiveOptions, requestScope: "missile-archive-filter" });
    } catch (error) {
      if (!canApplyRefreshRequest(missileAttackArchiveRefreshGate, requestId)) return;
      console.error(error);
    }
  }, [account, apiBaseUrl, backendData, missileAttackArchiveOptions]);

  const loadIncomingAttackArchive = useCallback(async (page: number) => {
    const requestId = beginRefreshRequest(incomingAttackArchiveRefreshGate);
    if (!apiBaseUrl || !account) {
      return;
    }
    setIncomingAttackArchivePage(page);
    backendData!.cancelScope("incoming-archive-filter");
    try {
      await backendData!.fleetArchive(account, {
        filter: "incomingAttacks",
        missionNumber: normalizedMissionFilters.missionNumber,
        missionType: normalizedMissionFilters.missionType,
        page,
        pageSize: 25,
        planetId: normalizedMissionFilters.planetId,
        requestScope: "incoming-archive-filter",
      });
    } catch (error) {
      if (!canApplyRefreshRequest(incomingAttackArchiveRefreshGate, requestId)) return;
      console.error(error);
    }
  }, [account, apiBaseUrl, backendData, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);

  const loadAllActiveMissions = useCallback(async () => {
    const requestId = beginRefreshRequest(allActiveMissionsRefreshGate);
    if (!apiBaseUrl) {
      return;
    }
    try {
      await backendData!.globalActiveMissions();
    } catch (error) {
      if (!canApplyRefreshRequest(allActiveMissionsRefreshGate, requestId)) return;
      console.error(error);
      // The "All" active tab is supplementary. Keep its last confirmed rows when a background
      // request fails; replacing them with [] produces a visible disappear/reappear cycle.
    }
  }, [apiBaseUrl, backendData]);

  const loadMissionLaunchSnapshot = useCallback(async (): Promise<MissionLaunchSnapshot> => {
    if (!apiBaseUrl || !account) {
      throw new Error("Wallet or game API is unavailable while syncing the launched mission.");
    }
    const [fleetVisibility, allActiveMissionsResult] = await Promise.all([
      backendData!.fleetVisibility(account, { includeArchive: false, fresh: true }),
      settlePromise(backendData!.globalActiveMissions()),
    ]);
    return {
      allActiveMissions: allActiveMissionsResult.status === "fulfilled" ? allActiveMissionsResult.value.missions : [],
      fleetVisibility,
    };
  }, [account, apiBaseUrl]);

  const loadGlobalMissionArchive = useCallback(async (page: number) => {
    const requestId = beginRefreshRequest(globalMissionArchiveRefreshGate);
    if (!apiBaseUrl) {
      return;
    }
    setGlobalMissionArchivePage(page);
    backendData!.cancelScope("global-archive-filter");
    try {
      const nextArchive = await backendData!.globalMissionArchive({
        missionNumber: normalizedMissionFilters.missionNumber,
        missionType: normalizedMissionFilters.missionType,
        page,
        pageSize: 25,
        planetId: normalizedMissionFilters.planetId,
        requestScope: "global-archive-filter",
      });
      if (!canApplyRefreshRequest(globalMissionArchiveRefreshGate, requestId)) return;
      setGlobalMissionArchiveTotalEntries(nextArchive.pagination.totalEntries);
    } catch (error) {
      if (!canApplyRefreshRequest(globalMissionArchiveRefreshGate, requestId)) return;
      console.error(error);
    }
  }, [apiBaseUrl, backendData, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);

  const loadGlobalMissionArchiveSummary = useCallback(async () => {
    const requestId = beginRefreshRequest(globalMissionArchiveSummaryRefreshGate);
    if (!apiBaseUrl) {
      setGlobalMissionArchiveTotalEntries(undefined);
      return;
    }

    backendData!.cancelScope("global-archive-summary-filter");
    try {
      const summary = await backendData!.globalMissionArchive({
        missionNumber: normalizedMissionFilters.missionNumber,
        missionType: normalizedMissionFilters.missionType,
        page: 1,
        pageSize: 1,
        planetId: normalizedMissionFilters.planetId,
        requestScope: "global-archive-summary-filter",
        summaryOnly: true,
      });
      if (!canApplyRefreshRequest(globalMissionArchiveSummaryRefreshGate, requestId)) return;
      setGlobalMissionArchiveTotalEntries(summary.pagination.totalEntries);
    } catch (error) {
      if (!canApplyRefreshRequest(globalMissionArchiveSummaryRefreshGate, requestId)) return;
      console.error("Universe mission archive total could not be loaded.", error);
    }
  }, [apiBaseUrl, normalizedMissionFilters.missionNumber, normalizedMissionFilters.missionType, normalizedMissionFilters.planetId]);

  useEffect(() => {
    if (!pageStateHydrationReady || page !== "mission-control") return;
    // The default visible scope. These are wallet-sized reads and make the initial screen useful
    // without waiting for the two universe/incoming archives behind hidden tabs.
    void loadMissionArchive(1);
    void loadMissileAttackArchive();
    void loadGlobalMissionArchiveSummary();
  }, [account, apiBaseUrl, loadGlobalMissionArchiveSummary, loadMissionArchive, loadMissileAttackArchive, page, pageStateHydrationReady]);

  useEffect(() => {
    if (!pageStateHydrationReady || page !== "mission-control") return;
    // Load expensive scopes only when their persisted deep-link tab is selected or the user
    // switches to it. The active tab widgets increment missionControlTabRevision after persisting
    // selection, so resolveMissionControlView above is already authoritative here.
    if (missionControlInitialView?.activeTab === "all") {
      void loadAllActiveMissions();
    }
    if (missionControlInitialView?.pastTab === "all") {
      void loadGlobalMissionArchive(1);
    } else if (missionControlInitialView?.pastTab === "incomingAttacks") {
      void loadIncomingAttackArchive(1);
    }
  }, [apiBaseUrl, loadAllActiveMissions, loadGlobalMissionArchive, loadIncomingAttackArchive, missionControlInitialView?.activeTab, missionControlInitialView?.pastTab, missionControlTabRevision, page, pageStateHydrationReady]);

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
    const view = resolveMissionControlView();
    const refreshes: Array<Promise<unknown>> = [
      refreshAllianceState(),
      refreshOnChainState(),
      loadMissionArchive(missionArchivePage),
      loadMissileAttackArchive(),
    ];
    // Do not spend every ten-second poll refreshing data from hidden tabs. A selected All or
    // Incoming tab remains live; switching tabs starts its own load through the tab callback.
    if (view.activeTab === "all") refreshes.push(loadAllActiveMissions());
    if (view.pastTab === "all") refreshes.push(loadGlobalMissionArchive(globalMissionArchivePage));
    else refreshes.push(loadGlobalMissionArchiveSummary());
    if (view.pastTab === "incomingAttacks") refreshes.push(loadIncomingAttackArchive(incomingAttackArchivePage));
    await Promise.allSettled(refreshes);
  }, [globalMissionArchivePage, incomingAttackArchivePage, loadAllActiveMissions, loadGlobalMissionArchive, loadGlobalMissionArchiveSummary, loadIncomingAttackArchive, loadMissionArchive, loadMissileAttackArchive, missionArchivePage, refreshAllianceState, refreshOnChainState]);

  const refreshFinishedBuildingState = useCallback(async (expectation: FinishedBuildingExpectation): Promise<boolean> => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await refreshOnChainState();
      await refreshInfrastructureState();
      return true;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForFinishedBuildingState(
        async () => {
          const [settlement, queues, infrastructure] = await Promise.all([
            backendData!.settlement(account),
            backendData!.queues(account, activePlanetId),
            backendData!.infrastructure(account, activePlanetId),
          ]);

          return { settlement, queues, infrastructure };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
      markFreshStateWrite(onChainRefreshGate);
      markFreshStateWrite(infrastructureRefreshGate);
      promoteBackendResourceState(snapshot.settlement.planet, {
        planetId: snapshot.settlement.homePlanetId,
        wallet: snapshot.settlement.wallet,
      });
      promoteBackendResourceState(snapshot.infrastructure);
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
      }
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, infrastructureChainState, promoteBackendResourceState, refreshInfrastructureState, refreshOnChainState]);

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
    setDefenseError(undefined);

    try {
      const snapshot = await waitForStartedDefenseProductionState(
        async () => {
          const [defense, queues] = await Promise.all([
            backendData!.defenses(account, activePlanetId),
            backendData!.queues(account, activePlanetId),
          ]);

          return { defense, queues };
        },
        expectation,
      );
      if (expectation.resourceIndexing) {
        await convergeBackendIndexedResourceState(
          () => backendData!.defenses(account, activePlanetId),
          expectation.resourceIndexing,
          { planetId: activePlanetId },
        );
      }

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
      }
    }
  }, [account, activePlanetId, apiBaseUrl, convergeBackendIndexedResourceState, refreshDefenseState, refreshOnChainState]);

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
    setShipyardError(undefined);

    try {
      const snapshot = await waitForStartedShipProductionState(
        async () => {
          const [shipyard, queues] = await Promise.all([
            backendData!.shipyard(account, activePlanetId),
            backendData!.queues(account, activePlanetId),
          ]);

          return { shipyard, queues };
        },
        expectation,
      );
      if (expectation.resourceIndexing) {
        await convergeBackendIndexedResourceState(
          () => backendData!.shipyard(account, activePlanetId),
          expectation.resourceIndexing,
          { planetId: activePlanetId },
        );
      }

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
      }
    }
  }, [account, activePlanetId, apiBaseUrl, convergeBackendIndexedResourceState, refreshOnChainState, refreshShipyardState]);

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
    setResearchError(undefined);

    try {
      const snapshot = await waitForStartedResearchState(
        async () => {
          const [research, queues] = await Promise.all([
            backendData!.research(account, activePlanetId),
            backendData!.queues(account, activePlanetId),
          ]);

          return { research, queues };
        },
        expectation,
      );
      if (expectation.resourceIndexing) {
        await convergeBackendIndexedResourceState(
          () => backendData!.research(account, activePlanetId),
          expectation.resourceIndexing,
          { planetId: activePlanetId },
        );
      }

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
      }
    }
  }, [account, activePlanetId, apiBaseUrl, convergeBackendIndexedResourceState, refreshOnChainState, refreshResearchState]);

  const refreshStartedBuildingState = useCallback(async (expectation: StartedBuildingExpectation) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    if (!apiBaseUrl || !account) {
      await Promise.allSettled([
        refreshOnChainState(),
        refreshInfrastructureState(),
      ]);
      return;
    }

    setOnChainStatus(keepGlobalReadStateDuringTransaction);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForStartedBuildingState(
        async () => {
          const [infrastructure, queues, planetsResponse] = await Promise.all([
            backendData!.infrastructure(account, activePlanetId),
            backendData!.queues(account, activePlanetId),
            backendData!.planets(account).catch(() => undefined),
          ]);

          return { infrastructure, planetsResponse, queues };
        },
        expectation,
      );
      if (expectation.resourceIndexing) {
        await convergeBackendIndexedResourceState(
          () => backendData!.infrastructure(account, activePlanetId),
          expectation.resourceIndexing,
          { planetId: activePlanetId },
        );
      }

      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const walletPlanetQueue = startedBuildingQueueFromWalletPlanets(snapshot.planetsResponse, expectation);
      const visibleBuildingQueue = snapshot.infrastructure.queue?.active
        ? snapshot.infrastructure.queue
        : walletPlanetQueue ?? snapshot.queues.building;
      setInfrastructureChainState(snapshot.infrastructure);
      if (snapshot.planetsResponse) {
        promoteWalletPlanetResourceStates(snapshot.planetsResponse.planets);
        setWalletPlanets(snapshot.planetsResponse.planets);
      }
      setOnChainQueues(visibleBuildingQueue === snapshot.queues.building
        ? snapshot.queues
        : { ...snapshot.queues, building: visibleBuildingQueue ?? null });
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
      const message = error instanceof Error ? error.message : "Failed to load started building state.";
      setOnChainError(message);
      setOnChainStatus(globalReadStatusAfterTransactionRefreshFailure);
      setInfrastructureError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
      }
    }
  }, [account, activePlanetId, apiBaseUrl, convergeBackendIndexedResourceState, promoteWalletPlanetResourceStates, refreshInfrastructureState, refreshOnChainState]);

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
    setResearchError(undefined);

    try {
      const snapshot = await waitForFinishedResearchState(
        async () => {
          const [research, queues] = await Promise.all([
            backendData!.research(account, activePlanetId),
            backendData!.queues(account, activePlanetId),
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

    let cancelled = false;
    backendData!.system<ApiSystemResponse>(homeCoords.galaxy, homeCoords.system)
      .then((payload) => {
        if (cancelled) return;
        const systemPlanet = rememberGalaxySystemPayload(apiBaseUrl, homeCoords.galaxy, homeCoords.system, payload)
          .find((item) => item.position === homeCoords.position);
        const basePlanet = systemPlanet ?? (settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined);
        const mergedPlanet = basePlanet && settlementPlanet
          ? mergePlanetWithSettlement(basePlanet, settlementPlanet)
          : basePlanet;
        setHomePlanetIdentity(namedSettlementPlanet(mergedPlanet, settlementPlanet?.name, playerProfile?.displayName));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setHomePlanetIdentity(namedSettlementPlanet(
            settlementPlanet ? planetFromSettlementPlanet(settlementPlanet) : undefined,
            settlementPlanet?.name,
            playerProfile?.displayName,
          ));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [homePlanetIdentitySyncKey]);

  const initialPageRefreshRef = useRef({
    page,
    refreshInfrastructureState,
    refreshOnChainState,
  });
  initialPageRefreshRef.current = {
    page,
    refreshInfrastructureState,
    refreshOnChainState,
  };
  const previousOnChainRefreshIdentityRef = useRef({ account, activePlanetId, apiBaseUrl });
  const previousInfrastructureRefreshIdentityRef = useRef({ account, activePlanetId, apiBaseUrl });

  useEffect(() => {
    const previous = previousOnChainRefreshIdentityRef.current;
    const current = { account, activePlanetId, apiBaseUrl };
    previousOnChainRefreshIdentityRef.current = current;
    if (!shouldRefreshPlanetStateForIdentityChange(initialPageRefreshRef.current.page, previous, current)) return;
    void initialPageRefreshRef.current.refreshOnChainState();
  }, [account, activePlanetId, apiBaseUrl]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    const previous = previousInfrastructureRefreshIdentityRef.current;
    const current = { account, activePlanetId, apiBaseUrl };
    previousInfrastructureRefreshIdentityRef.current = current;
    if (!shouldRefreshPlanetStateForIdentityChange(initialPageRefreshRef.current.page, previous, current)) return;
    void initialPageRefreshRef.current.refreshInfrastructureState();
  }, [account, activePlanetId, apiBaseUrl, pageStateHydrationReady]);

  const chainEventRefreshRef = useRef({
    page,
    refreshConfirmedResourceChange,
    refreshAllianceState,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshMissionControl,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
    walletPlanets,
  });
  chainEventRefreshRef.current = {
    page,
    refreshConfirmedResourceChange,
    refreshAllianceState,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshMissionControl,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
    walletPlanets,
  };

  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady || typeof window.EventSource === "undefined") {
      setChainSyncHealthy(false);
      return;
    }

    const events = new window.EventSource(`${apiBaseUrl.replace(/\/+$/, "")}/chain/events`);
    let refreshTimer: number | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    let forceWalletPlanetsRefreshQueued = false;
    const resourceChangesQueued = new Map<string, ChainResourceChange>();

    const runChainEventRefresh = () => {
      const {
        page: currentPage,
        refreshConfirmedResourceChange: refreshConfirmedResourceChangeFromEvent,
        refreshAllianceState: refreshAllianceStateFromEvent,
        refreshDefenseState: refreshDefenseStateFromEvent,
        refreshInfrastructureState: refreshInfrastructureStateFromEvent,
        refreshMissionControl: refreshMissionControlFromEvent,
        refreshOnChainState: refreshOnChainStateFromEvent,
        refreshResearchState: refreshResearchStateFromEvent,
        refreshRiftState: refreshRiftStateFromEvent,
        refreshShipyardState: refreshShipyardStateFromEvent,
        walletPlanets: walletPlanetsFromEvent,
      } = chainEventRefreshRef.current;
      const forceWalletPlanetsRefresh = forceWalletPlanetsRefreshQueued;
      const ownedPlanetIds = new Set(walletPlanetsFromEvent.map((planet) => planet.planetId));
      const confirmedResourceChanges = [...resourceChangesQueued.values()]
        .filter((change) => ownedPlanetIds.has(change.planetId));
      refreshInFlight = true;
      refreshQueued = false;
      forceWalletPlanetsRefreshQueued = false;
      resourceChangesQueued.clear();
      const refreshes: Array<Promise<unknown>> = [
        currentPage === "mission-control"
          ? refreshMissionControlFromEvent()
          : refreshOnChainStateFromEvent(undefined, forceWalletPlanetsRefresh
              ? { force: true, forceWalletPlanets: true }
              : undefined),
        refreshInfrastructureStateFromEvent(),
        ...confirmedResourceChanges.map((change) => refreshConfirmedResourceChangeFromEvent(change)),
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
      for (const change of chainEventResourceChanges(event)) {
        resourceChangesQueued.set(`${change.bodyKind}:${change.planetId}`, change);
      }
      refreshQueued = true;
      if (refreshTimer !== undefined || refreshInFlight) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        runChainEventRefresh();
      }, chainEventRefreshRef.current.page === "mission-control"
        ? MISSION_CONTROL_CHAIN_EVENT_REFRESH_DEBOUNCE_MS
        : CHAIN_EVENT_REFRESH_DEBOUNCE_MS);
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
    pageStateHydrationReady,
  ]);

  useEffect(() => {
    if (chainSyncHealthy || !backendData) {
      return;
    }

    const interval = window.setInterval(() => {
      void backendData.coordinateRefresh("background-selected-planet", "background", async () => (
        Promise.allSettled([refreshOnChainState(), refreshInfrastructureState()])
      ), 20_000);
    }, 120_000);
    return () => window.clearInterval(interval);
  }, [backendData, chainSyncHealthy, refreshInfrastructureState, refreshOnChainState]);

  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady || !onChainSettlement?.planet) {
      return;
    }

    const refreshTopBarResources = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void backendData!.coordinateRefresh("top-bar-selected-planet", "selected-planet", async () => (
        Promise.allSettled([refreshOnChainState(), refreshInfrastructureState()])
      ), 20_000);
    };

    const interval = window.setInterval(refreshTopBarResources, TOP_BAR_RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    account,
    apiBaseUrl,
    backendData,
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
    if (!apiBaseUrl || !account || !pageStateHydrationReady || !shouldAutoPollMissionControlForPage(page)) {
      return;
    }

    const pollMissionControl = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      // Refresh the lists and, when a battle report is open, that detail too, so loot/report on the
      // open report surface live alongside the list status (VEY-KANEO-433).
      void backendData!.coordinateRefresh("mission-control", "mission-control", async () => (
        Promise.allSettled([refreshMissionControl(), refreshOpenMissionDetailSilently()])
      ), 20_000);
    };

    const interval = window.setInterval(pollMissionControl, TOP_BAR_RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [account, apiBaseUrl, backendData, page, pageStateHydrationReady, refreshMissionControl, refreshOpenMissionDetailSilently]);

  // VEY-KANEO-433: tighten the poll around resolution — schedule a one-shot refresh just after the
  // soonest active mission is due to arrive (or a returning fleet to land) so the new status, loot,
  // and battle report appear promptly instead of waiting for the next full poll tick. Re-derived
  // whenever fleet visibility changes; only active while Mission Control is open.
  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady || !shouldAutoPollMissionControlForPage(page)) {
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
      void backendData!.coordinateRefresh("mission-control-resolution", "transaction", async () => (
        Promise.allSettled([refreshMissionControl(), refreshOpenMissionDetailSilently()])
      ), 20_000);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [account, apiBaseUrl, backendData, fleetVisibility, page, pageStateHydrationReady, refreshMissionControl, refreshOpenMissionDetailSilently]);

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
      planetResources: onChainSettlement?.planet?.resourcesAsOfNow
        ?? onChainSettlement?.planet?.resources
        ?? defenseState?.resourcesAsOfNow
        ?? defenseState?.resources,
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
    defenseState?.resourcesAsOfNow,
    defenseState?.resources,
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
    () => infrastructureChainState
      ? (infrastructureChainState.queue?.active ? infrastructureChainState.queue : null)
      : activeBuildingQueueResponse(onChainQueues, infrastructureChainState),
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
      canTransact: currentPlanetTransactionInputsAvailable(
        Boolean(provider && account && gameContract),
        activePlanetStateFresh,
      ),
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
    activePlanetStateFresh,
  ]);
  const buildingQueue = useMemo(() => {
    if (activeBuildingQueue?.active) {
      return buildingQueueItemForDisplay(activeBuildingQueue, now);
    }

    return settledState.queue?.kind === "building" ? settledState.queue : undefined;
  }, [activeBuildingQueue, now, settledState.queue]);
  const attributedResearchQueue = researchQueueWithPlanetAttribution(
    activeResearchQueue(researchState?.queue) ?? activeResearchQueue(onChainQueues?.research) ?? null,
    researchState?.planetId ?? activePlanetId,
  );
  const constructionQueueObservations = useMemo<ConstructionQueueObservation[]>(() => {
    const observations: ConstructionQueueObservation[] = [];
    for (const managedPlanet of walletPlanets) {
      const section = planetSectionForPlanet(planetSectionStore, managedPlanet.planetId);
      const queuesResearch = researchQueueWithPlanetAttribution(
        activeResearchQueue(section.queuesState?.research) ?? null,
        managedPlanet.planetId,
      );
      const sectionResearchQueue = researchQueueWithPlanetAttribution(
        activeResearchQueue(section.researchState?.queue) ?? null,
        section.researchState?.planetId ?? managedPlanet.planetId,
      );
      observations.push(
        {
          bodyKind: "planet",
          kind: "building",
          planetId: managedPlanet.planetId,
          queue: selectActiveConstructionQueue([
            section.infrastructureChainState?.queue,
            section.queuesState?.building,
            managedPlanet.queues.building,
          ]),
        },
        {
          bodyKind: "planet",
          kind: "defense",
          planetId: managedPlanet.planetId,
          queue: selectActiveConstructionQueue([
            section.defenseState?.queue,
            section.queuesState?.defense,
            managedPlanet.planetId === activePlanetId ? onChainQueues?.defense : undefined,
            managedPlanet.queues.defense,
          ]),
        },
        {
          bodyKind: "planet",
          kind: "ship",
          planetId: managedPlanet.planetId,
          queue: selectActiveConstructionQueue([
            section.shipyardState?.queue,
            section.queuesState?.ship,
            managedPlanet.planetId === activePlanetId ? onChainQueues?.ship : undefined,
            managedPlanet.queues.ship,
          ]),
        },
        {
          bodyKind: "planet",
          kind: "research",
          planetId: managedPlanet.planetId,
          queue: selectActiveConstructionQueue([
            researchQueueForPlanet(sectionResearchQueue, managedPlanet.planetId),
            researchQueueForPlanet(queuesResearch, managedPlanet.planetId),
            researchQueueForPlanet(attributedResearchQueue, managedPlanet.planetId),
          ]),
        },
      );
      if (section.moonState) {
        observations.push(
          {
            bodyKind: "moon",
            kind: "moon-building",
            planetId: managedPlanet.planetId,
            queue: section.moonState.queue?.active ? section.moonState.queue : null,
          },
          {
            bodyKind: "moon",
            kind: "defense",
            planetId: managedPlanet.planetId,
            queue: section.moonState.defenseQueue?.active ? section.moonState.defenseQueue : null,
          },
        );
      }
    }
    return observations;
  }, [
    attributedResearchQueue,
    activePlanetId,
    onChainQueues?.defense,
    onChainQueues?.ship,
    planetSectionStore,
    walletPlanets,
  ]);
  const confirmedConstructionQueuesRef = useRef(new Map<string, QueueStateResponse | null>());
  const confirmedConstructionQueues = useMemo(() => {
    const next = reconcileConstructionQueues(confirmedConstructionQueuesRef.current, constructionQueueObservations);
    confirmedConstructionQueuesRef.current = next;
    return next;
  }, [constructionQueueObservations]);
  const constructionProgressState = useMemo(() => projectConstructionProgress(
    confirmedConstructionQueues,
    constructionQueueObservations,
    now,
  ), [confirmedConstructionQueues, constructionQueueObservations, now]);
  const progressFor = useCallback((
    planetId: string | undefined,
    bodyKind: "moon" | "planet",
    kind: "building" | "defense" | "moon-building" | "research" | "ship",
  ): ConstructionProgress | undefined => planetId
    ? constructionProgressState.get(constructionProgressKey(planetId, bodyKind, kind))
    : undefined, [constructionProgressState]);
  const centralizedResearchQueue = progressFor(activePlanetId, "planet", "research")?.queue ?? null;
  const effectiveResearchState = researchState
    ? { ...researchState, queue: centralizedResearchQueue }
    : researchState;
  const overviewOnChainQueues = useMemo<PlayerQueuesResponse | undefined>(() => {
    if (!onChainQueues || !activePlanetId) return onChainQueues;
    return {
      ...onChainQueues,
      building: progressFor(activePlanetId, "planet", "building")?.queue ?? null,
      defense: progressFor(activePlanetId, "planet", "defense")?.queue ?? null,
      research: progressFor(activePlanetId, "planet", "research")?.queue ?? null,
      ship: progressFor(activePlanetId, "planet", "ship")?.queue ?? null,
    };
  }, [activePlanetId, onChainQueues, progressFor]);

  useEffect(() => {
    if (!apiBaseUrl || !account || !pageStateHydrationReady) {
      return;
    }

    const nextEventMs = nextProductionQueueCompletionEventMs(
      Array.from(confirmedConstructionQueues.values()),
      Date.now(),
    );
    if (nextEventMs === undefined) {
      return;
    }

    const delay = Math.max(0, nextEventMs - Date.now()) + PRODUCTION_QUEUE_COMPLETION_REFRESH_BUFFER_MS;
    const timer = window.setTimeout(() => {
      const refreshes: Array<Promise<unknown> | unknown> = [
        refreshOnChainState(undefined, { force: true, forceWalletPlanets: true }),
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
    confirmedConstructionQueues,
    effectiveResearchState?.queue,
    moonState?.defenseQueue,
    moonState?.queue,
    pageStateHydrationReady,
    refreshDefenseState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshShipyardState,
  ]);

  // Chime when an active production queue reaches completion.
  useEffect(() => {
    if (!pageStateHydrationReady) {
      return;
    }

    const nextEventMs = nextProductionQueueCompletionEventMs(productionQueueCompletionCandidates({
      building: activeBuildingQueue,
      defense: activeDefenseProductionQueue,
      moonBuilding: moonState?.queue,
      moonDefense: moonState?.defenseQueue,
      research: effectiveResearchState?.queue,
      shipyard: activeShipyardProductionQueue,
    }), Date.now());
    if (nextEventMs === undefined) {
      return;
    }

    const timer = window.setTimeout(() => {
      playSfx("queue-complete");
      haptic("complete");
    }, Math.max(0, nextEventMs - Date.now()));

    return () => window.clearTimeout(timer);
  }, [
    activeBuildingQueue,
    activeDefenseProductionQueue,
    activeShipyardProductionQueue,
    effectiveResearchState?.queue,
    moonState?.defenseQueue,
    moonState?.queue,
    pageStateHydrationReady,
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
    if (!shouldRefreshShipyardStateForPage(page)) return;
    if (shouldClearCachedShipyardStateForPageRefresh(page)) {
      refreshShipyardState({ clearCachedState: true });
    } else {
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
    if (
      page !== "defenses"
      || pageStateHydrationReady
      || !apiBaseUrl
      || !account
      || defenseState
    ) {
      return;
    }
    void refreshDefenseState();
  }, [account, apiBaseUrl, defenseState, page, pageStateHydrationReady, refreshDefenseState]);

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
    if (
      page !== "infrastructure"
      || pageStateHydrationReady
      || !apiBaseUrl
      || !account
      || infrastructureChainState
    ) {
      return;
    }
    void refreshInfrastructureState();
  }, [account, apiBaseUrl, infrastructureChainState, page, pageStateHydrationReady, refreshInfrastructureState]);

  const previousInfrastructurePageRef = useRef(page);
  useEffect(() => {
    const previousPage = previousInfrastructurePageRef.current;
    previousInfrastructurePageRef.current = page;
    if (
      pageStateHydrationReady
      && previousPage !== page
      && (page === "overview" || page === "infrastructure")
    ) {
      refreshInfrastructureState();
    }
  }, [page, pageStateHydrationReady, refreshInfrastructureState]);

  useEffect(() => {
    let cancelled = false;
    backendDataStoreFor("").runtimeConfig<RuntimeConfig>(runtimeConfigUrl())
      .then((config) => {
        if (!cancelled) setRuntimeConfig({ config, status: "ready" });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setRuntimeConfig({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runBuildingTransaction = useCallback(async (key: BuildingKey) => {
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
      const resourceBaseline = liveInfrastructure?.resourceSnapshot;
      startedExpectation = {
        itemId: building,
        planetId,
        targetLevel: currentLevel + 1,
      };
      await runCoordinatedWriteTransaction({
        key: `building:start:${key}`,
        label,
        send: () => sendStartBuildingUpgradeTransaction(
          provider,
          account,
          gameContract,
          planetId,
          building,
        ),
        waitForIndexed: async (receipt, txHash) => {
          const expectation = {
            ...startedExpectation,
            resourceIndexing: resourceIndexingExpectationForTransaction(txHash, resourceBaseline, receipt),
          } as StartedBuildingExpectation;
          startedExpectation = expectation;
          await refreshStartedBuildingState(expectation);
        },
        errorLabel: (error) => {
          const actionLabel = backendStateReady ? spendTransactionErrorMessage(error) : buildingUpgradeActionErrorLabel(error);
          if (startedExpectation && isStartedBuildingQueueSyncingLabel(actionLabel)) {
            setFailedStartedBuildingExpectation(startedExpectation);
          }
          return actionLabel;
        },
        onStateChange: (state) => {
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
          if (state.phase === "success") {
            setFailedStartedBuildingExpectation(undefined);
            setBuildingAction({ status: "success", buildingKey: key, label: "Building upgrade started." });
          } else if (state.phase === "error") {
            setBuildingAction({
              status: "error",
              buildingKey: key,
              label: state.label ?? "Building upgrade transaction failed.",
              ...rejectedActionAutoDismiss(state.error),
            });
          } else if (state.phase !== "idle") {
            setBuildingAction({ status: "pending", buildingKey: key, label: state.label ?? buildingWalletConfirmationLabel(label) });
          }
        },
      });
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
    runCoordinatedWriteTransaction,
  ]);

  const handleUpgrade = useCallback((key: BuildingKey) => {
    void runBuildingTransaction(key);
  }, [runBuildingTransaction]);

  const runShipyardTransaction = useCallback(async (
    label: string,
    actionKey: string,
    send: () => Promise<string>,
    afterReceipt?: ((receipt: TransactionReceipt, txHash: string) => Promise<boolean | void>) | undefined,
  ) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    let synced = true;
    await runCoordinatedWriteTransaction({
      key: actionKey,
      label,
      send,
      waitForIndexed: async (receipt, txHash) => {
        if (afterReceipt) {
          const result = await afterReceipt(receipt, txHash);
          synced = result !== false;
        } else {
          await Promise.allSettled([
            refreshShipyardState(),
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
      },
      errorLabel: (error) => `${label} failed: ${spendTransactionErrorMessage(error)}`,
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") {
          setShipyardAction(synced
            ? { status: "success", label: `${label} confirmed.` }
            : { status: "pending", label: serverUnavailableRetryMessage() });
          return;
        }
        if (state.phase === "pending" || state.phase === "confirming" || state.phase === "confirmed" || state.phase === "indexing") {
          setShipyardAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
        } else if (state.phase === "error") {
          setShipyardAction({ status: "error", label: state.label ?? `${label} failed.` });
        }
      },
    });
  }, [refreshInfrastructureState, refreshOnChainState, refreshShipyardState, runCoordinatedWriteTransaction]);

  const runDefenseTransaction = useCallback(async (
    label: string,
    actionKey: string,
    send: () => Promise<string>,
    afterReceipt?: ((receipt: TransactionReceipt, txHash: string) => Promise<void>) | undefined,
  ) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    await runCoordinatedWriteTransaction({
      key: actionKey,
      label,
      send,
      waitForIndexed: async (receipt, txHash) => {
        if (afterReceipt) {
          await afterReceipt(receipt, txHash);
        } else {
          await Promise.allSettled([
            refreshDefenseState(),
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
      },
      errorLabel: spendTransactionErrorMessage,
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setDefenseAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setDefenseAction({ status: "error", label: state.label ?? spendTransactionErrorMessage(state.error) });
        else if (state.phase !== "idle") setDefenseAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [refreshDefenseState, refreshInfrastructureState, refreshOnChainState, runCoordinatedWriteTransaction]);

  const waitForAllianceApplicationState = useCallback((
    expectation: AllianceApplicationExpectation,
  ) => {
    if (!apiBaseUrl || !account) {
      throw new Error("Alliance contract unavailable.");
    }

    return waitForAllianceApplicationCleared(
      async () => backendData!.alliance(account),
      expectation,
    );
  }, [account, apiBaseUrl]);

  const runAllianceTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<ChainAllianceState | null | undefined>) | undefined,
  ) => {
    await runCoordinatedWriteTransaction({
      key: `alliance:${label}`,
      label,
      send,
      waitForIndexed: async () => {
        const next = await (afterReceipt ? afterReceipt() : refreshAllianceState());
        if (next) {
          setAllianceState(next);
        }
      },
      onErrorRefresh: async () => {
        await refreshAllianceState();
      },
      onStateChange: (state) => {
        if (state.phase === "success") setAllianceAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setAllianceAction({ status: "error", label: state.label ?? `${label} failed.` });
        else if (state.phase !== "idle") setAllianceAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [refreshAllianceState, runCoordinatedWriteTransaction, transactionActionGate]);

  const runResearchTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    afterReceipt?: ((receipt: TransactionReceipt, txHash: string) => Promise<void>) | undefined,
  ) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    await runCoordinatedWriteTransaction({
      key: `research:${label}`,
      label,
      send,
      waitForIndexed: async (receipt, txHash) => {
        if (afterReceipt) {
          await afterReceipt(receipt, txHash);
        } else {
          await Promise.allSettled([
            refreshResearchState(),
            refreshOnChainState(undefined, { force: true }),
            refreshInfrastructureState(),
          ]);
        }
      },
      errorLabel: spendTransactionErrorMessage,
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setResearchAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setResearchAction({ status: "error", label: state.label ?? spendTransactionErrorMessage(state.error) });
        else if (state.phase !== "idle") setResearchAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [refreshInfrastructureState, refreshOnChainState, refreshResearchState, runCoordinatedWriteTransaction]);

  const runRiftTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    resourceChange?: Pick<ChainResourceChange, "bodyKind" | "planetId">,
  ) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    await runCoordinatedWriteTransaction({
      key: `rift:${label}`,
      label,
      send,
      waitForIndexed: async (receipt, txHash) => {
        await Promise.allSettled([
          refreshRiftState(),
          refreshOnChainState(undefined, { force: true }),
          refreshInfrastructureState(),
        ]);
        if (resourceChange) {
          await refreshConfirmedResourceChange({
            ...resourceChange,
            blockNumber: String(receipt.blockNumber ?? ""),
            transactionHash: txHash,
          });
        }
      },
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setRiftAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setRiftAction({ status: "error", label: state.label ?? `${label} failed.` });
        else if (state.phase !== "idle") setRiftAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [refreshConfirmedResourceChange, refreshInfrastructureState, refreshOnChainState, refreshRiftState, runCoordinatedWriteTransaction]);

  const runGalaxyTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    options: {
      validateAttackProtection?: { targetPlanetId: string; targetIsMoon?: boolean | undefined } | undefined;
      expectedMissionLaunch?: ((txHash: string) => FleetMissionSummary);
      resourceChange?: Pick<ChainResourceChange, "bodyKind" | "planetId">;
      syncMissionLaunch?: boolean;
      validateShipInventory?: { originIsMoon?: boolean | undefined; originPlanetId: string; ships: MissionShips } | undefined;
    } = {},
  ): Promise<boolean> => {
    let completed = false;
    const planetSwitchRequestId = planetSwitchGate.current;
    setGalaxyAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });
    try {
        if (options.validateShipInventory) {
          setGalaxyAction({ status: "pending", label: `${label}: refreshing fleet inventory.` });
          if (!apiBaseUrl || !account) {
            throw new Error("Wallet or game API is unavailable while refreshing fleet inventory.");
          }
          const [freshShipyardState, freshMoonState] = await Promise.all([
            backendData!.shipyard(account, options.validateShipInventory.originPlanetId),
            options.validateShipInventory.originIsMoon
              ? backendData!.moon(account, options.validateShipInventory.originPlanetId)
              : Promise.resolve(null),
          ]);
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
          setShipyardState(freshShipyardState);
          if (freshMoonState) setMoonState(freshMoonState);
          const freshOriginInventoryState = options.validateShipInventory.originIsMoon
            ? missionMoonShipyardState({ moonState: freshMoonState, shipyardState: freshShipyardState })
            : freshShipyardState;
          const shipBlocker = missionShipInventoryBlocker({
            originBody: options.validateShipInventory.originIsMoon ? "moon" : "planet",
            shipyardState: freshOriginInventoryState,
            ships: options.validateShipInventory.ships,
          });
          if (shipBlocker) {
            throw new Error(shipBlocker);
          }
        }
        if (options.validateAttackProtection) {
          const { targetPlanetId, targetIsMoon = false } = options.validateAttackProtection;
          setGalaxyAction({ status: "pending", label: `${label}: refreshing target protection.` });
          if (!apiBaseUrl || !account) {
            throw new Error("Wallet or game API is unavailable while refreshing target protection.");
          }
          await revalidateAttackProtectionBeforeSubmit(
            () => backendData!.attackProtection(account, targetPlanetId, targetIsMoon),
          );
          if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
        }
        const result = await runCoordinatedWriteTransaction({
          key: `galaxy:${label}`,
          label,
          send,
          waitForIndexed: async (_receipt, submittedTxHash) => {
            if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
            const expectedMission = options.expectedMissionLaunch?.(submittedTxHash);
            const confirmedResourcePromise = options.resourceChange
              ? refreshConfirmedResourceChange({
                  ...options.resourceChange,
                  blockNumber: String(_receipt.blockNumber ?? ""),
                  transactionHash: submittedTxHash,
                })
              : Promise.resolve(null);
            await Promise.allSettled([
              refreshShipyardState(),
              refreshDefenseState(),
              refreshOnChainState(undefined, { force: true }),
              refreshInfrastructureState(),
            ]);
            if (options.syncMissionLaunch) {
              const [missionSnapshot] = await Promise.all([
                waitForMissionLaunchState(loadMissionLaunchSnapshot, submittedTxHash, {
                  expectedMission,
                }),
                confirmedResourcePromise,
              ]);
              if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
              markFreshStateWrite(onChainRefreshGate);
              const launchedMissions = missionLaunchMissionsForTransaction(missionSnapshot, submittedTxHash, expectedMission);
              setFleetVisibility((current) => newestFleetVisibility(current, missionSnapshot.fleetVisibility));
              setAllActiveMissions(mergeActiveMissionList(missionSnapshot.allActiveMissions, launchedMissions));
              if (options.validateShipInventory && apiBaseUrl && account) {
                try {
                  const [nextShipyardState, nextMoonState] = await Promise.all([
                    backendData!.shipyard(account, options.validateShipInventory.originPlanetId),
                    options.validateShipInventory.originIsMoon
                      ? backendData!.moon(account, options.validateShipInventory.originPlanetId)
                      : Promise.resolve(null),
                  ]);
                  if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
                  setShipyardState(nextShipyardState);
                  if (nextMoonState) setMoonState(nextMoonState);
                } catch (error) {
                  console.error(error);
                }
              }
            } else {
              await confirmedResourcePromise;
            }
          },
          errorLabel: (error) => galaxyMissionActionErrorLabel(label, error),
          onStateChange: (state) => {
            if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
            if (state.phase === "success") setGalaxyAction({ status: "success", label: `${label} confirmed.` });
            else if (state.phase === "error") setGalaxyAction({ status: "error", label: state.label ?? galaxyMissionActionErrorLabel(label, state.error) });
            else if (state.phase !== "idle") setGalaxyAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
          },
        });
        completed = result;
    } catch (error) {
        console.error(error);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return false;
        setGalaxyAction({
          status: "error",
          label: galaxyMissionActionErrorLabel(label, error),
        });
    }
    return completed;
  }, [account, apiBaseUrl, loadMissionLaunchSnapshot, refreshConfirmedResourceChange, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, refreshShipyardState, runCoordinatedWriteTransaction, setMoonState]);

  const handleOpenBatchSupply = useCallback((target: ManagedPlanetResponse) => {
    if (!account || !backendData) {
      setGalaxyAction({ status: "error", label: "Connect your wallet before planning a supply transport." });
      return;
    }
    const origins = walletPlanets.filter((planet) => planet.planetId !== target.planetId);
    setBatchSupplyTarget(target);
    setBatchSupplySources([]);
    setBatchSupplyError(undefined);
    setBatchSupplyLoading(true);
    void Promise.all(origins.map(async (planet) => [planet, await backendData.shipyard(account, planet.planetId, { fresh: true })] as const))
      .then((rows) => {
        const fleetSource = rows.map(([, shipyard]) => shipyard).find((shipyard) => shipyard.fleetSlots);
        const freeSlots = fleetSource?.fleetSlots
          ? Math.max(0, fleetSource.fleetSlots.limit - fleetSource.fleetSlots.active)
          : 0;
        setBatchSupplyMaxSources(freeSlots);
        setBatchSupplySources(rows
          .map(([planet, shipyard]) => batchSupplySourceForPlanet(planet, shipyard))
          .sort((left, right) => (
            fleetMissionDistance(left.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position })
              - fleetMissionDistance(right.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position })
          )));
      })
      .catch((error) => {
        console.error(error);
        setBatchSupplyError("Could not read source cargo fleets. Refresh and try again.");
        setBatchSupplySources(origins.map((planet) => batchSupplySourceForPlanet(planet, undefined)));
        setBatchSupplyMaxSources(0);
      })
      .finally(() => setBatchSupplyLoading(false));
  }, [account, backendData, walletPlanets]);

  const handleConfirmBatchSupply = useCallback((orders: BatchSupplyOrder[]) => {
    const target = batchSupplyTarget;
    if (!provider || !account || !gameContract || !target) {
      setBatchSupplyError("Wallet or target planet is unavailable.");
      return;
    }
    setBatchSupplyError(undefined);
    void (async () => {
      const completed = await runGalaxyTransaction(`Supply ${orders.length} transport${orders.length === 1 ? "" : "s"}`, () => sendLaunchTransportBatchTransaction(
        provider,
        account,
        gameContract,
        {
          targetPlanetId: target.planetId,
          orders: orders.map((order) => ({
            originPlanetId: order.originPlanetId,
            ships: order.ships,
            cargo: {
              metal: String(order.cargo.metal),
              crystal: String(order.cargo.crystal),
              deuterium: String(order.cargo.deuterium),
            },
            speedPercent: 100,
          })),
        },
      ), { syncMissionLaunch: true });
      if (completed) setBatchSupplyTarget(null);
      else setBatchSupplyError("The one-call supply transaction was not sent. Check the wallet error and try again.");
    })();
  }, [account, batchSupplyTarget, gameContract, provider, runGalaxyTransaction]);

  const runMoonTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    resourceChange?: Pick<ChainResourceChange, "bodyKind" | "planetId">,
  ) => {
    const planetSwitchRequestId = planetSwitchGate.current;
    await runCoordinatedWriteTransaction({
      key: `moon:${label}`,
      label,
      send,
      waitForIndexed: async (receipt, txHash) => {
        await Promise.allSettled([
          refreshInfrastructureState(),
          refreshOnChainState(undefined, { force: true }),
        ]);
        if (resourceChange) {
          await refreshConfirmedResourceChange({
            ...resourceChange,
            blockNumber: String(receipt.blockNumber ?? ""),
            transactionHash: txHash,
          });
        }
      },
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setMoonAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setMoonAction({ status: "error", label: state.label ?? `${label} failed.` });
        else if (state.phase !== "idle") setMoonAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [refreshConfirmedResourceChange, refreshInfrastructureState, refreshOnChainState, runCoordinatedWriteTransaction]);

  const handleBurnChickenForMoon = useCallback((tokenId: string) => {
    if (!provider || !account || !chickenBurnConfig || !activePlanetId || !activePlanetCoords) {
      setMoonAction({ status: "error", label: "Wallet, Burning Chicken config, or selected planet coordinates are unavailable." });
      return;
    }
    const targetLabel = `${activePlanetCoords.galaxy}:${activePlanetCoords.system}:${activePlanetCoords.position}`;
    const label = `Burn Chicken #${tokenId} for ${targetLabel}`;
    const planetSwitchRequestId = planetSwitchGate.current;
    void runCoordinatedWriteTransaction({
      key: `moon:chicken-burn:${tokenId}`,
      label,
      send: async () => {
        setMoonAction({ status: "pending", label: `Checking Chicken #${tokenId} ownership...` });
        await backendData!.burningChicken(account, tokenId, chickenBurnConfig);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) {
          throw new Error("Chicken burn was cancelled because the selected planet changed.");
        }
        return sendBurningChickenMoonTransaction(
          provider,
          account,
          chickenBurnConfig,
          tokenId,
          activePlanetId,
          activePlanetCoords,
        );
      },
      waitForIndexed: async () => {
        await ensureVeydriftNetwork(provider, gameWalletChain);
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (!apiBaseUrl || !activePlanetId) {
          throw new Error("Chicken burn confirmed, but Veydrift API state is unavailable for moon confirmation.");
        }
        setMoonAction({ status: "pending", label: "Chicken burned. Waiting for Veydrift indexed moon state..." });
        const confirmedMoonState = await waitForConfirmedChickenMoonState(backendData!, account, activePlanetId);
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
      },
      onErrorRefresh: async () => {
        try {
          await ensureVeydriftNetwork(provider, gameWalletChain);
        } catch (switchError) {
          console.error(switchError);
        }
      },
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setMoonAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setMoonAction({ status: "error", label: state.label ?? `${label} failed.` });
        else if (state.phase !== "idle") setMoonAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [
    account,
    activePlanetId,
    activePlanetCoords,
    apiBaseUrl,
    chickenBurnConfig,
    gameWalletChain,
    provider,
    refreshOnChainState,
    runCoordinatedWriteTransaction,
    setActivePlanetSectionStatus,
    setMoonState,
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
    const resourceBaseline = shipyardState?.resourceSnapshot;

    void runShipyardTransaction("Ship production", `shipyard:start:${shipId}`, () => sendStartShipProductionTransaction(
      provider,
      account,
      gameContract,
      planetId,
      shipId,
      quantity,
    ), (receipt, txHash) => refreshStartedShipProductionState({
      itemId: shipId,
      planetId,
      quantity: expectedQuantity,
      resourceIndexing: resourceIndexingExpectationForTransaction(txHash, resourceBaseline, receipt),
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
    shipyardState?.resourceSnapshot,
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
    const resourceBaseline = defenseState.resourceSnapshot;

    void runDefenseTransaction("Defense production", `defense:start:${defenseId}`, () => sendStartDefenseProductionTransaction(
      provider,
      account,
      gameContract,
      planetId,
      defenseId,
      quantity,
    ), (receipt, txHash) => refreshStartedDefenseProductionState({
      itemId: defenseId,
      planetId,
      quantity: expectedQuantity,
      resourceIndexing: resourceIndexingExpectationForTransaction(txHash, resourceBaseline, receipt),
    }));
  }, [
    account,
    activeDefenseProductionQueue,
    defenseState?.homePlanetId,
    defenseState?.resourceSnapshot,
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
    ), () => waitForAllianceCreationState(
      async () => backendData!.alliance(account, { fresh: true }),
      { tag, name, description },
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

  const handleBuyPaidAllianceInvite = useCallback((secret: string) => {
    if (!provider || !account || !paidAllianceInviteContract || !apiBaseUrl) {
      setAllianceAction({ status: "error", label: "Paid alliance invites are not configured." });
      return;
    }
    void runAllianceTransaction("Paid alliance invite purchase", () => sendBuyPaidAllianceInviteTransaction(
      provider,
      account,
      paidAllianceInviteContract,
      paidAllianceInviteCommitment(secret),
      PAID_ALLIANCE_INVITE_PRICE_WEI,
    ), async () => {
      await storePaidAllianceInvite(apiBaseUrl, provider, account, secret);
      return refreshAllianceState();
    });
  }, [account, apiBaseUrl, paidAllianceInviteContract, provider, refreshAllianceState, runAllianceTransaction]);

  const handleRecoverPaidAllianceInvites = useCallback(async () => {
    if (!provider || !account || !apiBaseUrl) return null;
    const invites = await recoverPaidAllianceInvites(apiBaseUrl, provider, account);
    const links = invites.map((invite) => paidAllianceInviteLink(invite.secret, window.location.origin));
    return links.length ? links.join("\n") : null;
  }, [account, apiBaseUrl, provider]);

  const handleWithdrawPaidAllianceBonus = useCallback((amount: PaidAllianceBonusAmount) => {
    if (!provider || !account || !paidAllianceInviteContract || !allianceState?.membership.allianceId || !activePlanetId) {
      setAllianceAction({ status: "error", label: "Alliance production treasury is not configured." });
      return;
    }
    const activePlanetHasRift = infrastructureChainState?.buildings.some((building) => (
      building.id === buildingContractIds.interdimensionalRiftStabilizer && building.level > 0
    ));
    if (!activePlanetHasRift) {
      setAllianceAction({ status: "error", label: "Build an Interdimensional Rift Stabilizer on the active planet first." });
      return;
    }
    void runAllianceTransaction("Alliance production treasury withdrawal", () => sendWithdrawPaidAllianceBonusTransaction(
      provider,
      account,
      paidAllianceInviteContract,
      allianceState.membership.allianceId,
      activePlanetId,
      amount,
    ));
  }, [account, activePlanetId, allianceState?.membership.allianceId, infrastructureChainState?.buildings, paidAllianceInviteContract, provider, runAllianceTransaction]);

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
      async () => backendData!.alliance(account, { fresh: true }),
      { allianceId, tag, name, description },
    ));
  }, [account, apiBaseUrl, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

  const handleAcceptAllianceInvite = useCallback((allianceId: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    setAllianceAction({ status: "pending", label: "Refreshing alliance invitation..." });
    void backendData!.alliance(account)
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
    void backendData!.alliance(account)
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
      });
  }, [account, apiBaseUrl, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction, waitForAllianceApplicationState]);

  const handleDismissAllianceJoinRequest = useCallback((playerAddress: string) => {
    if (!provider || !account || !apiBaseUrl || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    const currentAllianceId = allianceState.membership.allianceId;
    setAllianceAction({ status: "pending", label: "Refreshing alliance application..." });
    void backendData!.alliance(account)
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
      loadResearchState: (_apiUrl, wallet, planetId, options) => backendData!.research(wallet, planetId, options),
      loadWalletQueues: (_apiUrl, wallet, planetId, options) => backendData!.queues(wallet, planetId, options),
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

        const resourceBaseline = stateForTransaction.resourceSnapshot;
        void runResearchTransaction(researchStartTransactionLabel(technologyId, key, stateForTransaction), () => sendStartResearchTransaction(
          provider,
          account,
          gameContract,
          transactionPlanetId,
          technologyId,
        ), (receipt, txHash) => refreshStartedResearchState({
          itemId: technologyId,
          resourceIndexing: resourceIndexingExpectationForTransaction(txHash, resourceBaseline, receipt),
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
    ), { bodyKind: "planet", planetId: homePlanetId });
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

    void runRiftTransaction(`${resource.label} extraction start`, () => sendStartRiftExtractionTransaction(
      provider,
      account,
      gameContract,
      homePlanetId,
      resource.resourceId,
      parsed,
    ), { bodyKind: "planet", planetId: homePlanetId });
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.riftAvailable, riftState?.unavailableReason, runRiftTransaction]);

  const handleFinishRiftWithdrawal = useCallback((withdrawal: PendingWithdrawal) => {
    const resource = riftState?.resources.find((item) => item.key === withdrawal.resource);
    if (!provider || !account || !gameContract || !resource) {
      setRiftAction({ status: "error", label: "Wallet, game contract, or withdrawal resource is unavailable." });
      return;
    }

    if (withdrawal.kind === "legacyMarketWithdrawal") {
      void runRiftTransaction(`${resource.label} legacy withdrawal finalization`, () => sendFinishResourceWithdrawalTransaction(
        provider,
        account,
        gameContract,
        resource.resourceId,
      ));
      return;
    }

    const riftPlanetId = withdrawal.planetId ?? riftState?.homePlanetId;
    if (!riftPlanetId) {
      setRiftAction({ status: "error", label: "Select a Rift-enabled planet before finalizing extraction." });
      return;
    }
    void runRiftTransaction(`${resource.label} extraction finalization`, () => sendFinalizeRiftExtractionTransaction(
      provider,
      account,
      gameContract,
      riftPlanetId,
      resource.resourceId,
    ));
  }, [account, gameContract, provider, riftState?.homePlanetId, riftState?.resources, runRiftTransaction]);

  const handleSelectManagedPlanet = useCallback((planetId: string, bodyKind: OrbitBodyKind = "planet") => {
    const nextPlanet = walletPlanets.find((planet) => planet.planetId === planetId);
    const nextBodyKind: OrbitBodyKind = bodyKind === "moon" && nextPlanet?.moon?.exists ? "moon" : "planet";
    const nextInspectRoute = inspectRouteForManagedPlanetSelection(page, nextBodyKind, nextPlanet);
    if (planetId === activePlanetId && nextBodyKind === activeBodyKind && !nextInspectRoute) return;
    markFreshStateWrite(planetSwitchGate);
    markFreshStateWrite(onChainRefreshGate);
    markFreshStateWrite(infrastructureRefreshGate);
    markFreshStateWrite(defenseRefreshGate);
    markFreshStateWrite(shipyardRefreshGate);
    markFreshStateWrite(researchRefreshGate);
    markFreshStateWrite(riftRefreshGate);
    if (planetId !== activePlanetId) {
      pendingPlanetStateRefreshRef.current = planetId;
      setPlanetStateFresh(planetId, false);
    }
    setSelectedPlanetId(planetId);
    setSelectedBodyKind(nextBodyKind);
    if (nextInspectRoute) {
      setPlanetBackRoute(null);
      setInspectedPlayerWallet(null);
      setInspectedAllianceId(null);
      setMissionDetailId(null);
      setMissionReportId(null);
      setGalaxyNav({ galaxy: nextInspectRoute.coords.galaxy, system: nextInspectRoute.coords.system });
      setSelectedCoords(nextInspectRoute.coords);
      setPage(nextInspectRoute.kind === "moon" ? "moon-inspect" : "planet");
      writeInspectRoute(nextInspectRoute);
    } else if (nextBodyKind === "moon") {
      setPage("moon");
    }
    applyOnChainSettlementSnapshot(walletSettlementForManagedPlanet(onChainSettlement, nextPlanet));
    const nextQueues = walletQueuesForManagedPlanet(onChainQueues, nextPlanet);
    setOnChainQueues(nextQueues);
    setOnChainError(undefined);
    setOnChainStatus(planetId === activePlanetId && nextPlanet ? "ready" : "loading");
    setInfrastructureError(undefined);
    setMoonError(undefined);
    setDefenseError(undefined);
    setShipyardError(undefined);
    setResearchError(undefined);
    setRiftError(undefined);
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
    page,
    playerProfile?.displayName,
    walletPlanets,
  ]);

  useEffect(() => {
    const inspectRoute = page === "planet" && selectedCoords
      ? { kind: "planet" as const, coords: selectedCoords }
      : page === "moon-inspect" && selectedCoords
        ? { kind: "moon" as const, coords: selectedCoords }
        : null;
    const routedSelection = managedPlanetSelectionForInspectRoute(inspectRoute, walletPlanets);
    if (!routedSelection) return;
    if (routedSelection.planetId === activePlanetId && routedSelection.bodyKind === activeBodyKind) return;
    handleSelectManagedPlanet(routedSelection.planetId, routedSelection.bodyKind);
  }, [activeBodyKind, activePlanetId, handleSelectManagedPlanet, page, selectedCoords, walletPlanets]);

  const handleRenamePlanet = useCallback((name: string) => {
    if (!provider || !account || !gameContract || !activePlanetId) {
      setPlanetRenameAction({ status: "error", label: "Wallet, game contract, or planet is unavailable." });
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const planetSwitchRequestId = planetSwitchGate.current;
    void runCoordinatedWriteTransaction({
      key: "planet:rename",
      label: "Planet rename",
      send: () => sendRenamePlanetTransaction(provider, account, gameContract, activePlanetId, trimmedName),
      waitForIndexed: async () => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        await refreshOnChainState({ planetId: activePlanetId, name: trimmedName });
      },
      errorLabel: (error) => error instanceof Error ? error.message : "Rename transaction failed.",
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setPlanetRenameAction({ status: "success", label: "Planet renamed." });
        else if (state.phase === "error") setPlanetRenameAction({ status: "error", label: state.label ?? "Rename transaction failed." });
        else if (state.phase !== "idle") setPlanetRenameAction({ status: "pending", label: state.label ?? transactionSyncingLabel("Planet rename") });
      },
    });
  }, [account, activePlanetId, gameContract, provider, refreshOnChainState, runCoordinatedWriteTransaction]);

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
          const refreshedProfile = await backendData!.profile(account);
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

    const planetSwitchRequestId = planetSwitchGate.current;
    void runCoordinatedWriteTransaction({
      key: "planet:abandon",
      label: "Colony abandon",
      send: () => sendAbandonPlanetTransaction(provider, account, gameContract, activePlanetId),
      waitForIndexed: async () => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        setSelectedPlanetId(undefined);
        await refreshOnChainState(undefined, { force: true, forceHomePlanet: true });
      },
      errorLabel: (error) => error instanceof Error ? error.message : "Abandon transaction failed.",
      onStateChange: (state) => {
        if (!canApplyRefreshRequest(planetSwitchGate, planetSwitchRequestId)) return;
        if (state.phase === "success") setPlanetManagementAction({ status: "success", label: "Colony abandoned." });
        else if (state.phase === "error") setPlanetManagementAction({ status: "error", label: state.label ?? "Abandon transaction failed." });
        else if (state.phase !== "idle") setPlanetManagementAction({ status: "pending", label: state.label ?? transactionSyncingLabel("Colony abandon") });
      },
    });
  }, [account, activePlanetId, gameContract, provider, refreshOnChainState, runCoordinatedWriteTransaction, selectedManagedPlanet]);

  const missionComposerRefreshKey = pendingGalaxyMission
    ? `${pendingGalaxyMission.originPlanet?.planetId ?? activePlanetId ?? "unknown"}:${pendingGalaxyMission.bodySelectionDefaults?.originIsMoon === true ? "moon" : "planet"}`
    : null;
  useEffect(() => {
    if (!missionComposerRefreshKey) {
      missionComposerRefreshKeyRef.current = null;
      return;
    }
    if (missionComposerRefreshKeyRef.current === missionComposerRefreshKey) return;
    missionComposerRefreshKeyRef.current = missionComposerRefreshKey;

    // A fleet can cross arrivalAt while the app remains open. Refresh both independent launch gates
    // when composition starts so a pre-arrival slot count and moon inventory cannot keep blocking the
    // newly launchable fleet. The ref makes callback/state identity changes harmless and reopening the
    // composer performs another fresh read.
    void Promise.allSettled([
      refreshShipyardState({ clearCachedState: true }),
      refreshInfrastructureState(),
    ]);
  }, [missionComposerRefreshKey, refreshInfrastructureState, refreshShipyardState]);

  const missionCounterplayComposerRefreshKey = pendingJoinAttack
    ? `join:${pendingJoinAttack.attackMissionId}:${activePlanetId ?? "unknown"}`
    : pendingAcsDefend
      ? `defend:${pendingAcsDefend.hostileMissionId}:${activePlanetId ?? "unknown"}`
      : null;
  const missionCounterplayComposerRefreshKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!missionCounterplayComposerRefreshKey) {
      missionCounterplayComposerRefreshKeyRef.current = null;
      return;
    }
    if (missionCounterplayComposerRefreshKeyRef.current === missionCounterplayComposerRefreshKey) return;
    missionCounterplayComposerRefreshKeyRef.current = missionCounterplayComposerRefreshKey;

    // Mission Control can switch origins entirely from its cached wallet roster. Only fetch the
    // selected origin's live ship inventory once the player actually opens Join/Defend composition.
    void refreshShipyardState({ clearCachedState: true });
  }, [missionCounterplayComposerRefreshKey, refreshShipyardState]);

  const handleGalaxyAction = useCallback((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingAttackProtection(null);
    setPendingGalaxyMission({ action, target, coords, originPlanet: selectedManagedPlanet });
  }, [selectedManagedPlanet]);

  const overviewMyPlanetActionGroups = useMemo<OverviewMyPlanetActionGroup[]>(() =>
    orderedWalletPlanets.map((managedPlanet) => ({
      planet: managedPlanet,
      actions: overviewMyPlanetActionsFor({
        account,
        activePlanetId,
        defenseState,
        homePlanetId: onChainSettlement?.homePlanetId,
        planet: managedPlanet,
        shipyardState,
      }),
      moonActions: overviewMyPlanetMoonActionsFor({
        account,
        defenseState,
        homePlanetId: onChainSettlement?.homePlanetId,
        planet: managedPlanet,
        shipyardState,
      }),
    })),
    [account, activePlanetId, defenseState, onChainSettlement?.homePlanetId, orderedWalletPlanets, shipyardState]
  );

  const handleOverviewMyPlanetAction = useCallback((action: GalaxyAction, managedPlanet: ManagedPlanetResponse) => {
    const targetPlanet = planetFromSettlementPlanet(managedPlanet);
    handleGalaxyAction(action, targetPlanet, {
      galaxy: managedPlanet.galaxy,
      system: managedPlanet.system,
      position: managedPlanet.position,
    });
  }, [handleGalaxyAction]);

  const handleMoonMissionAction = useCallback((action: GalaxyAction, managedPlanet: ManagedPlanetResponse) => {
    if (!action.enabled) return;
    const targetPlanet = planetFromSettlementPlanet(managedPlanet);
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({
      action,
      bodySelectionDefaults: { originIsMoon: true, targetIsMoon: false },
      coords: {
        galaxy: managedPlanet.galaxy,
        system: managedPlanet.system,
        position: managedPlanet.position,
      },
      originPlanet: selectedManagedPlanet,
      target: targetPlanet,
    });
  }, [selectedManagedPlanet]);

  const watchedMoonActionsForPlanet = useCallback((planet: Planet): GalaxyAction[] => overviewWatchedPlanetMoonActionsFor({
    account,
    defenseState,
    homePlanetId: onChainSettlement?.homePlanetId,
    planet,
    shipyardState,
  }), [account, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const watchedPlanetActionsForPlanet = useCallback((planet: Planet): GalaxyAction[] => overviewWatchedPlanetActionsFor({
    account,
    defenseState,
    homePlanetId: onChainSettlement?.homePlanetId,
    planet,
    shipyardState,
  }), [account, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const handleOverviewWatchedPlanetAction = useCallback((action: GalaxyAction, planet: Planet) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({
      action,
      coords: {
        galaxy: planet.galaxy,
        system: planet.system,
        position: planet.position,
      },
      originPlanet: selectedManagedPlanet,
      target: planet,
    });
  }, [selectedManagedPlanet]);

  const handleOverviewWatchedMoonAction = useCallback((action: GalaxyAction, planet: Planet) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({
      action,
      bodySelectionDefaults: { targetIsMoon: true },
      coords: {
        galaxy: planet.galaxy,
        system: planet.system,
        position: planet.position,
      },
      originPlanet: selectedManagedPlanet,
      target: planet,
    });
  }, [selectedManagedPlanet]);

  const rankingsMoonActionsForPlanet = useCallback((planet: HighscorePlanet, entry: HighscoreEntry): GalaxyAction[] => {
    if (!planet.hasMoon && !planet.moon?.exists) return [];
    const targetPlanet = highscorePlanetForMission(planet, entry);
    const actionsByKind = new Map(
      galaxyActionsForSlot({
        account,
        attackProtection: rankingsAttackProtectionForEntry({
          currentAllianceId: allianceState?.membership.allianceId,
          currentWallet: account,
          entry,
        }),
        defenseState,
        homePlanetId: onChainSettlement?.homePlanetId,
        isOrigin: false,
        planet: targetPlanet,
        shipyardState,
      }).map((action) => [action.kind, action])
    );

    const isOwnTarget = Boolean(account && entry.wallet.toLowerCase() === account.toLowerCase());
    if (isOwnTarget) {
      return [
        moonTargetMissionAction(actionsByKind.get("transport"), "transport", "Transport"),
        moonTargetMissionAction(actionsByKind.get("deploy"), "deploy", "Deploy"),
        moonTargetMissionAction(actionsByKind.get("defenseHold"), "defenseHold", "Defend"),
      ];
    }

    const defendAction = actionsByKind.get("defenseHold");
    return defendAction
      ? [moonTargetMissionAction(defendAction, "defenseHold", "Defend")]
      : [moonTargetMissionAction(actionsByKind.get("attack"), "attack", "Attack")];
  }, [account, allianceState?.membership.allianceId, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const rankingsPlanetActionsForPlanet = useCallback((planet: HighscorePlanet, entry: HighscoreEntry): GalaxyAction[] => {
    const targetPlanet = highscorePlanetForMission(planet, entry);
    return galaxyActionsForSlot({
      account,
      attackProtection: rankingsAttackProtectionForEntry({
        currentAllianceId: allianceState?.membership.allianceId,
        currentWallet: account,
        entry,
      }),
      defenseState,
      homePlanetId: onChainSettlement?.homePlanetId,
      isOrigin: false,
      planet: targetPlanet,
      shipyardState,
    });
  }, [account, allianceState?.membership.allianceId, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const hydratePendingAttackTarget = useCallback((targetPlanetId: string, coords: Coordinates) => {
    if (!apiBaseUrl || !account) return;
    setPendingAttackProtection((current) =>
      current?.targetPlanetId === targetPlanetId && current.status !== "error"
        ? current
        : { targetPlanetId, status: "checking" }
    );
    void backendData!.system(coords.galaxy, coords.system, { detail: "full" })
      .then((payload) => {
        const hydratedTarget = joinAttackTargetFromSystemPayload(payload, targetPlanetId, coords);
        if (!hydratedTarget) return;
        setPendingGalaxyMission((current) =>
          current?.action.kind === "attack" && current.target?.id === targetPlanetId
            ? { ...current, target: hydratedTarget }
            : current
        );
      })
      .catch((error) => console.error(error));
    void backendData!.attackProtection(account, targetPlanetId)
      .then((protection) => {
        setPendingAttackProtection((current) =>
          current?.targetPlanetId === targetPlanetId
            ? { targetPlanetId, status: "ready", protection }
            : current
        );
      })
      .catch((error) => {
        console.error(error);
        setPendingAttackProtection((current) =>
          current?.targetPlanetId === targetPlanetId
            ? { targetPlanetId, status: "error" }
            : current
        );
      });
  }, [account, apiBaseUrl]);

  useEffect(() => {
    const targetPlanetId = pendingGalaxyMission?.action.kind === "attack"
      ? pendingGalaxyMission.target?.occupiedBy?.planetId
      : undefined;
    if (!targetPlanetId || !pendingGalaxyMission) {
      if (pendingAttackProtection !== null) setPendingAttackProtection(null);
      return;
    }
    if (pendingAttackProtection?.targetPlanetId === targetPlanetId) return;
    hydratePendingAttackTarget(targetPlanetId, pendingGalaxyMission.coords);
  }, [hydratePendingAttackTarget, pendingAttackProtection, pendingGalaxyMission]);

  const handleRankingsMoonAction = useCallback((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({
      action,
      bodySelectionDefaults: { targetIsMoon: true },
      coords: planet.coordinates,
      originPlanet: selectedManagedPlanet,
      target: highscorePlanetForMission(planet, entry),
    });
    if (action.kind === "attack") hydratePendingAttackTarget(planet.planetId, planet.coordinates);
  }, [hydratePendingAttackTarget, selectedManagedPlanet]);

  const handleRankingsPlanetAction = useCallback((action: GalaxyAction, planet: HighscorePlanet, entry: HighscoreEntry) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({
      action,
      coords: planet.coordinates,
      originPlanet: selectedManagedPlanet,
      target: highscorePlanetForMission(planet, entry),
    });
    if (action.kind === "attack") hydratePendingAttackTarget(planet.planetId, planet.coordinates);
  }, [hydratePendingAttackTarget, selectedManagedPlanet]);

  const raidFinderAttackAction = useCallback((target: RaidTarget): GalaxyAction => {
    const planet = raidTargetPlanetForMission(target);
    return galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: target.protection.blockedReason === "none",
        atWar: target.protection.isAtWar,
        warEligibilityNeedsCheck: target.protection.isAtWar,
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
    const action = raidFinderAttackAction(target);
    handleGalaxyAction(action, raidTargetPlanetForMission(target), target.coordinates);
    if (!action.enabled || target.stationedDefenderTimelineComplete) return;

    // Highscore/Raid Finder rows are intentionally compact and older API deployments do not carry
    // the complete stationed-defense forecast timeline. Hydrate the selected target from the public
    // system payload so visible base forces, scheduled defenders, and combat tech all feed the same
    // exact battle preview instead of leaving DEF/report availability unknown.
    hydratePendingAttackTarget(target.planetId, target.coordinates);
  }, [handleGalaxyAction, hydratePendingAttackTarget, raidFinderAttackAction]);

  const raidFinderHarvestAction = useCallback((target: DebrisFinderTarget): GalaxyAction | null => {
    const planet = debrisTargetPlanetForMission(target);
    const action = galaxyActionsForSlot({
      account,
      defenseState,
      homePlanetId: onChainSettlement?.homePlanetId,
      isOrigin: activePlanetId === target.planetId,
      planet,
      shipyardState,
    }).find((candidate) => candidate.kind === "harvest");
    if (action) return action;
    if (account && target.owner.toLowerCase() === account.toLowerCase()) return null;
    return {
      enabled: false,
      kind: "harvest",
      label: "Harvest",
      mode: "mission",
      mission: "harvest",
      reason: "Harvest is unavailable for this debris field.",
    };
  }, [account, activePlanetId, defenseState, onChainSettlement?.homePlanetId, shipyardState]);

  const raidFinderHarvestActionState = useCallback((target: DebrisFinderTarget): RaidTargetAttackAction | null => {
    const action = raidFinderHarvestAction(target);
    if (!action) return null;
    if (target.harvestDisabledReason) return { label: "Harvest", disabledReason: target.harvestDisabledReason };
    return action.enabled
      ? { label: action.label }
      : { label: action.label, disabledReason: action.reason };
  }, [raidFinderHarvestAction]);

  const handleRaidFinderHarvest = useCallback((target: DebrisFinderTarget) => {
    const action = raidFinderHarvestAction(target);
    if (action) handleGalaxyAction(action, debrisTargetPlanetForMission(target), target.coordinates);
  }, [handleGalaxyAction, raidFinderHarvestAction]);

  const handleConfirmGalaxyMission = useCallback(async (draft: MissionLaunchDraft) => {
    const pending = pendingGalaxyMission;
    if (!pending) return;
    const { action, target, coords } = pending;
    const missionOriginPlanet = pending.originPlanet ?? selectedManagedPlanet;
    const originPlanetId = missionOriginPlanet?.planetId ?? activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }
    if (action.kind === "attack") {
      if (!apiBaseUrl) {
        setGalaxyAction({ status: "error", label: "Randomness safety status is unavailable. New attacks are temporarily paused." });
        return;
      }
      try {
        const readiness = await backendData!.randomnessReadiness<{ ready?: unknown; reasons?: unknown }>();
        if (readiness.ready !== true) {
          const reason = Array.isArray(readiness.reasons) && typeof readiness.reasons[0] === "string"
            ? readiness.reasons[0]
            : "Randomness safety is not ready. New attacks are temporarily paused.";
          setGalaxyAction({ status: "error", label: reason });
          return;
        }
      } catch {
        setGalaxyAction({ status: "error", label: "Randomness safety status is unavailable. New attacks are temporarily paused." });
        return;
      }
    }
    playSfx("mission-launch");
    haptic("select");
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
      validateAttackProtection?: { targetPlanetId: string; targetIsMoon?: boolean | undefined } | undefined;
      validateShipInventory?: { originIsMoon?: boolean | undefined; originPlanetId: string; ships: MissionShips } | undefined;
    }) => ({
      validateAttackProtection,
      expectedMissionLaunch: (txHash: string) => expectedMissionLaunchForDraft(txHash, {
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
      resourceChange: {
        bodyKind: originIsMoon ? "moon" as const : "planet" as const,
        planetId: originPlanetId,
      },
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
    if (action.kind === "attack" && (originIsMoon || targetIsMoon) && !moonAttackParityEnabled) {
      setGalaxyAction({
        status: "error",
        label: "Moon attack parity is still activating. Refresh shortly before launching.",
      });
      return;
    }
    if (action.kind === "attack" && draft.lootRatio) {
      const { metal, crystal, deuterium } = draft.lootRatio;
      const lootRatio = {
        metalBps: metal * 100,
        crystalBps: crystal * 100,
        deuteriumBps: deuterium * 100,
      };
      const launchAttack = () => originIsMoon || targetIsMoon
        ? sendLaunchBodyAttackMissionTransaction(provider, account, gameContract, {
            originPlanetId,
            targetPlanetId,
            ships: draft.ships,
            speedPercent: draft.speedPercent,
            originIsMoon,
            targetIsMoon,
            lootRatio,
          })
        : sendLaunchAttackMissionTransaction(provider, account, gameContract, {
            originPlanetId,
            targetPlanetId,
            ships: draft.ships,
            speedPercent: draft.speedPercent,
            lootRatio,
          });
      closeMissionCreationWhenComplete(runGalaxyTransaction(`${action.label} mission`, launchAttack, pendingLaunchOptions({
          missionType: "Attack",
          targetPlanet: target,
          targetPlanetId,
          targetCoords: coords,
          originIsMoon,
          targetIsMoon,
          validateAttackProtection: { targetPlanetId, targetIsMoon },
          validateShipInventory: { originIsMoon, originPlanetId, ships: draft.ships },
        })));
      return;
    }
    const cargo = supportsCargoMission
      ? cargoForCargoMissionLaunch({
          cargo: draft.cargo,
        })
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
      validateAttackProtection: action.kind === "attack" ? { targetPlanetId, targetIsMoon } : undefined,
      validateShipInventory: { originIsMoon, originPlanetId, ships: draft.ships },
    }));
    closeMissionCreationWhenComplete(runMission());
  }, [
    account,
    activePlanetId,
    apiBaseUrl,
    effectiveResearchState?.technologyLevels,
    gameContract,
    onChainSettlement?.homePlanetId,
    pendingGalaxyMission,
    provider,
    runGalaxyTransaction,
    selectedManagedPlanet,
    shipyardState?.technologyLevels,
    moonState,
    missionResourcesForOrigin,
    moonAttackParityEnabled,
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
    ), { bodyKind: "moon", planetId: moonState.homePlanetId });
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
    ), { bodyKind: "moon", planetId: moonState.homePlanetId });
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

  const runMissionTransaction = useCallback((
    label: string,
    request: () => Promise<string>,
    resourceChange?: Pick<ChainResourceChange, "bodyKind" | "planetId">,
  ) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    void runCoordinatedWriteTransaction({
      key: `mission:${label}`,
      label,
      send: request,
      waitForIndexed: async (receipt, txHash) => {
        const [visibility] = await Promise.all([
          waitForFleetVisibilityIndexedThrough(
            () => backendData!.fleetVisibility(account, { includeArchive: false, fresh: true }),
            receipt.blockNumber,
          ),
          resourceChange
            ? refreshConfirmedResourceChange({
                ...resourceChange,
                blockNumber: String(receipt.blockNumber ?? ""),
                transactionHash: txHash,
              })
            : Promise.resolve(null),
        ]);
        setFleetVisibility((current) => newestFleetVisibility(current, visibility));
        await refreshOnChainState(undefined, { force: true });
      },
      errorLabel: (error) => error instanceof Error ? error.message : `${label} transaction failed.`,
      onStateChange: (state) => {
        if (state.phase === "success") setMissionAction({ status: "success", label: `${label} confirmed.` });
        else if (state.phase === "error") setMissionAction({ status: "error", label: state.label ?? `${label} transaction failed.` });
        else if (state.phase !== "idle") setMissionAction({ status: "pending", label: state.label ?? transactionSyncingLabel(label) });
      },
    });
  }, [account, gameContract, provider, refreshConfirmedResourceChange, refreshOnChainState, runCoordinatedWriteTransaction]);

  const handleRecallMission = useCallback((missionId: string) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    const mission = [
      ...(displayFleetVisibility?.outgoing ?? []),
      ...(displayFleetVisibility?.returning ?? []),
    ].find((candidate) => candidate.missionId === missionId);
    runMissionTransaction(
      `Recall mission #${missionId}`,
      () => sendRecallFleetMissionTransaction(provider, account, gameContract, missionId),
      mission ? {
        bodyKind: "planet",
        planetId: mission.originPlanetId,
      } : undefined,
    );
  }, [account, displayFleetVisibility, gameContract, provider, runMissionTransaction]);

  const handleResolveMission = useCallback((missionId: string, kind: ManualMissionResolutionKind) => {
    if (!provider || !account || !gameContract) {
      setMissionAction({ status: "error", label: "Wallet or game contract is unavailable." });
      return;
    }

    const mission = missionDetail?.mission?.missionId === missionId
      ? missionDetail.mission
      : [
          ...(displayFleetVisibility?.incoming ?? []),
          ...(displayFleetVisibility?.outgoing ?? []),
          ...(displayFleetVisibility?.returning ?? []),
          ...displayAllActiveMissions,
        ].find((candidate) => candidate.missionId === missionId);
    const destinationOwned = mission
      ? mission.targetPlanet?.owner?.toLowerCase() === account.toLowerCase()
        || walletPlanets.some((planet) => planet.planetId === mission.targetPlanetId)
      : false;
    const originOwned = mission?.owner.toLowerCase() === account.toLowerCase();
    const changedBody = mission && ((kind === "arrival" && destinationOwned) || (kind === "return" && originOwned))
      ? {
          bodyKind: (kind === "arrival" ? mission.targetIsMoon : mission.originIsMoon) ? "moon" as const : "planet" as const,
          planetId: kind === "arrival" ? mission.targetPlanetId : mission.originPlanetId,
        }
      : undefined;

    runMissionTransaction(
      `Resolve mission #${missionId}`,
      () => kind === "arrival"
        ? sendResolveFleetMissionTransaction(provider, account, gameContract, missionId)
        : sendCompleteFleetMissionReturnTransaction(provider, account, gameContract, missionId),
      changedBody,
    );
  }, [account, displayAllActiveMissions, displayFleetVisibility, gameContract, missionDetail, provider, runMissionTransaction, walletPlanets]);

  // VEY-KANEO-440: ACS Defend ("Defend planet") opens the full compose picker (fleet + speed +
  // hold/holding-fuel + Alliance Depot preview) instead of firing a default fleet. Intercept was
  // removed from the frontend (VEY-KANEO-439), so this is the only remaining counterplay path.
  const handleMissionCounterplay = useCallback((mission: FleetMissionSummary, _mode: "acsDefend") => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setMissionAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }
    const backendQualifiedAllianceDefense = displayFleetVisibility?.joinableDefenses
      ?.some((candidate) => candidate.missionId === mission.missionId) === true;
    const coordinationBlocker = acsDefendCoordinationBlocker(
      mission,
      account,
      allianceState,
      backendQualifiedAllianceDefense,
    );
    if (coordinationBlocker) {
      setMissionAction({ status: "error", label: coordinationBlocker });
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
      coordinationBlocker,
    });
  }, [account, allianceState, displayFleetVisibility, gameContract, onChainSettlement?.homePlanetId, provider]);

  const handleConfirmAcsDefend = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingAcsDefend;
    if (!pending) return;
    const originPlanetId = activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }
    if (pending.coordinationBlocker) {
      setGalaxyAction({ status: "error", label: pending.coordinationBlocker });
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
      expectedMissionLaunch: (txHash) => expectedMissionLaunchForDraft(txHash, {
        account,
        originPlanet: selectedManagedPlanet,
        originPlanetId,
        targetPlanetId: pending.hostileMissionId,
        targetCoords: pending.coords,
        missionType: "AcsDefend",
        draft,
        driveLevels,
      }),
      resourceChange: { bodyKind: "planet", planetId: originPlanetId },
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

  const handleJoinAttack = useCallback((mission: FleetMissionSummary, targetCoords: Coordinates | null) => {
    if (!provider || !account || !gameContract || !onChainSettlement?.homePlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or home planet is unavailable." });
      return;
    }

    // VEY-KANEO-431: open the Attack fleet picker so the player chooses the
    // fleet to commit, rather than sending a default counterplay fleet on click.
    setGalaxyAction({ status: "idle" });
    const coords = targetCoords ?? { galaxy: 0, system: 0, position: 0 };
    const systemKey = `${coords.galaxy}:${coords.system}`;
    const cachedPayload = activePlanetSection.galaxySystemDataByKey?.[systemKey];
    const cachedTarget = joinAttackTargetFromSystemPayload(cachedPayload, mission.targetPlanetId, coords);
    setPendingJoinAttack({
      attackMissionId: mission.missionId,
      targetPlanetId: mission.targetPlanetId,
      coords,
      mission,
      target: cachedTarget,
    });

    if (cachedTarget || !apiBaseUrl || coords.galaxy <= 0 || coords.system <= 0) return;
    void backendData!.system(coords.galaxy, coords.system, { detail: "full" })
      .then((payload) => {
        const target = joinAttackTargetFromSystemPayload(payload, mission.targetPlanetId, coords);
        setPendingJoinAttack((current) =>
          current?.attackMissionId === mission.missionId ? { ...current, target } : current
        );
      })
      .catch((error) => console.error(error));
  }, [
    account,
    activePlanetSection.galaxySystemDataByKey,
    apiBaseUrl,
    gameContract,
    onChainSettlement?.homePlanetId,
    provider,
  ]);

  const handleConfirmJoinAttack = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingJoinAttack;
    if (!pending) return;
    const originPlanetId = activePlanetId ?? selectedManagedPlanet?.planetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or selected origin is unavailable." });
      return;
    }

    const closeJoinAttack = () => {
      setPendingJoinAttack(null);
      setPendingAcsDefend(null);
    };
    const driveLevels = driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels);
    void (async () => {
      const originIsMoon = draft.originIsMoon === true;
      const targetIsMoon = pending.mission.targetIsMoon === true;
      if ((originIsMoon || targetIsMoon) && !moonAttackParityEnabled) {
        setGalaxyAction({
          status: "error",
          label: "Moon attack parity is still activating. Refresh shortly before joining.",
        });
        return;
      }
      const sendJoin = originIsMoon
        ? () => sendJoinBodyAttackMissionTransaction(provider, account, gameContract, {
          originPlanetId,
          attackMissionId: pending.attackMissionId,
          targetPlanetId: pending.targetPlanetId,
          ships: draft.ships,
          originIsMoon: true,
        })
        : () => sendJoinAttackMissionTransaction(provider, account, gameContract, {
          originPlanetId,
          attackMissionId: pending.attackMissionId,
          targetPlanetId: pending.targetPlanetId,
          ships: draft.ships,
        });
      const completed = await runGalaxyTransaction("Group attack join", sendJoin, {
        expectedMissionLaunch: (txHash) => expectedMissionLaunchForDraft(txHash, {
          account,
          originPlanet: selectedManagedPlanet,
          originPlanetId,
          targetPlanet: pending.target,
          targetPlanetId: pending.targetPlanetId,
          targetCoords: pending.coords,
          missionType: "AcsAttack",
          draft,
          driveLevels,
          originIsMoon,
          targetIsMoon,
        }),
        resourceChange: {
          bodyKind: originIsMoon ? "moon" : "planet",
          planetId: originPlanetId,
        },
        syncMissionLaunch: true,
        validateAttackProtection: {
          targetIsMoon,
          targetPlanetId: pending.targetPlanetId,
        },
        validateShipInventory: { originIsMoon, originPlanetId, ships: draft.ships },
      });
      if (completed) closeJoinAttack();
    })();
  }, [account, activePlanetId, gameContract, moonAttackParityEnabled, pendingJoinAttack, provider, runGalaxyTransaction, selectedManagedPlanet, shipyardState?.technologyLevels]);

  const handleNavigate = useCallback((target: Page) => {
    playSfx("tab");
    haptic("tick");
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

  const moonOverviewActions = useMemo(() => {
    if (!selectedManagedPlanet?.moon?.exists) return [];
    const targetPlanet = planetFromSettlementPlanet(selectedManagedPlanet);
    const moonOriginShipyardState = missionMoonShipyardState({ moonState, shipyardState });
    const targetActions = galaxyActionsForSlot({
      account,
      defenseState,
      homePlanetId: onChainSettlement?.homePlanetId,
      isOrigin: false,
      planet: targetPlanet,
      shipyardState: moonOriginShipyardState,
    });
    const actionsByKind = new Map(targetActions.map((action) => [action.kind, action]));
    const transportAction = moonOverviewMissionAction(actionsByKind.get("transport"), "transport", "Transport");
    const deployAction = moonOverviewMissionAction(actionsByKind.get("deploy"), "deploy", "Deploy");

    return [
      {
        kind: "inspect" as const,
        label: "Inspect",
        onClick: () => handleSelectMoon({
          galaxy: selectedManagedPlanet.galaxy,
          system: selectedManagedPlanet.system,
          position: selectedManagedPlanet.position,
        }),
      },
      {
        disabledReason: transportAction.enabled ? undefined : transportAction.reason,
        kind: "transport" as const,
        label: transportAction.label,
        onClick: transportAction.enabled ? () => handleMoonMissionAction(transportAction, selectedManagedPlanet) : undefined,
      },
      {
        disabledReason: deployAction.enabled ? undefined : deployAction.reason,
        kind: "deploy" as const,
        label: deployAction.label,
        onClick: deployAction.enabled ? () => handleMoonMissionAction(deployAction, selectedManagedPlanet) : undefined,
      },
      {
        disabledReason: "Moon defense stationing is not available in the current mission contract.",
        kind: "defend" as const,
        label: "Defend",
      },
    ];
  }, [
    account,
    defenseState,
    handleMoonMissionAction,
    handleSelectMoon,
    onChainSettlement?.homePlanetId,
    moonState,
    selectedManagedPlanet,
    shipyardState,
  ]);

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

    if (target.kind === "ship") {
      setSelectedShipKey(target.key);
      setPage("shipyard");
    }
  }, []);

  const topBar = (
    <TopBar
      caps={caps}
      crawlerProduction={infrastructureChainState?.crawlerProduction}
      inviteeProductionBoost={infrastructureChainState?.inviteeProductionBoost}
      energy={topBarEnergy}
      isWalletConnected={isWalletConnected}
      queue={isWalletConnected ? undefined : settledState.queue}
      rates={rates}
      resourceStatus={isWalletConnected && !walletPlanetHydrated && onChainStatus !== "error" ? "loading" : isWalletConnected ? onChainStatus : "local"}
      researchQueue={isWalletConnected ? undefined : settledState.researchQueue}
      resources={isWalletConnected ? spendableResources : settledState.resources}
    />
  );

  const showPlanetSelector = hasPlanetSelectorChoice(walletPlanets);
  const mobilePlanetPicker = showPlanetSelector ? (
    <PlanetSelector
      attackHighlights={planetPickerAttackHighlights}
      layout="mobile"
      onOrderChange={handlePlanetPickerOrderChange}
      onSelect={handleSelectManagedPlanet}
      planets={orderedWalletPlanets}
      progressState={constructionProgressState}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  // Below `md` the picker lives inside the hamburger menu; between `md` and `lg`
  // (no right sidebar, no hamburger) it stays as a compact row above content.
  const compactPlanetSelector = mobilePlanetPicker ? (
    <div className="mb-3 hidden min-w-0 max-w-full overflow-hidden md:block lg:hidden">
      {mobilePlanetPicker}
    </div>
  ) : null;

  const planetSidebar = showPlanetSelector ? (
    <PlanetSelector
      attackHighlights={planetPickerAttackHighlights}
      layout="sidebar"
      onOrderChange={handlePlanetPickerOrderChange}
      onSelect={handleSelectManagedPlanet}
      planets={orderedWalletPlanets}
      progressState={constructionProgressState}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  const missionDetailShareUrl = typeof window === "undefined" || !missionDetailId
    ? ""
    : `${window.location.origin}/mission/${encodeURIComponent(missionDetailId)}`;
  const battleReportsShareUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}${buildInspectPath({ kind: "page", page: "battle-reports" })}`;
  const gameContractTransactionInputsAvailable = Boolean(provider && account && gameContract);
  const gameMaintenancePaused = displayFleetVisibility?.gameMaintenance?.paused === true;
  const gameTransactionInputsAvailable = currentPlanetTransactionInputsAvailable(
    gameActionsAvailableForBody(activeBodyKind, gameContractTransactionInputsAvailable),
    activePlanetStateFresh,
  ) && !gameMaintenancePaused;
  const missionTransactionInputsAvailable = currentPlanetTransactionInputsAvailable(
    gameContractTransactionInputsAvailable,
    activePlanetStateFresh,
  ) && !gameMaintenancePaused;
  const allianceTransactionInputsAvailable = Boolean(provider && account && allianceContract);
  const moonTransactionInputsAvailable = currentPlanetTransactionInputsAvailable(
    Boolean(provider && account && moonContract),
    activePlanetStateFresh,
  );
  const chickenBurnTransactionInputsAvailable = currentPlanetTransactionInputsAvailable(
    Boolean(provider && account && chickenBurnConfig),
    activePlanetStateFresh,
  );
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
	    ) ?? writeTransactionState.label,
    inputsAvailable: gameTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: gameMaintenancePaused
      ? GAME_MAINTENANCE_MESSAGE
      : gameContractTransactionInputsAvailable && !activePlanetStateFresh
      ? "Loading the selected planet's latest state."
      : "Wallet or game contract unavailable",
  });
  const missionTransactionUnavailableReason = transactionUnavailableReasonFor({
    activeActionLabel: pendingActionLabel(galaxyAction, missionAction) ?? writeTransactionState.label,
    inputsAvailable: missionTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: gameMaintenancePaused
      ? GAME_MAINTENANCE_MESSAGE
      : gameContractTransactionInputsAvailable && !activePlanetStateFresh
      ? "Loading the selected planet's latest state."
      : "Wallet or game contract unavailable",
  });
	  const allianceTransactionUnavailableReason = transactionUnavailableReasonFor({
	    activeActionLabel: pendingActionLabel(allianceAction) ?? writeTransactionState.label,
    inputsAvailable: allianceTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: "Alliance contract unavailable.",
  });
	  const moonTransactionUnavailableReason = transactionUnavailableReasonFor({
	    activeActionLabel: pendingActionLabel(moonAction) ?? writeTransactionState.label,
    inputsAvailable: moonTransactionInputsAvailable,
    transactionPending: transactionActionPending,
    unavailableReason: Boolean(provider && account && moonContract) && !activePlanetStateFresh
      ? "Loading the selected planet's latest state."
      : "Wallet or moon contract unavailable.",
  });
  const canSubmitGameTransaction = gameTransactionInputsAvailable && !transactionActionPending;
  const canSubmitMissionTransaction = missionTransactionInputsAvailable && !transactionActionPending;
  const canSubmitAllianceTransaction = allianceTransactionInputsAvailable && !transactionActionPending;
  const canSubmitMoonTransaction = moonTransactionInputsAvailable && !transactionActionPending;
  const canSubmitChickenBurnTransaction = chickenBurnTransactionInputsAvailable && !transactionActionPending;
  const canSubmitProfileMutation = Boolean(provider && account && apiBaseUrl) && !transactionActionPending;
  const effectiveConnectWallet = onConnectWallet ?? (miniAppMode ? connectMiniAppWallet : undefined);
  const walletRecoveryReadError = walletRecoveryActionMessage(onChainError) ? onChainError : undefined;
  const missionLaunchBlocker = missionTransactionUnavailableReason ?? missionLaunchStateBlocker;
  const content = (() => {
    if (miniAppMode && miniAppWalletError && !isWalletConnected) {
      return (
        <MiniAppWalletErrorState
          error={miniAppWalletError}
          onRetry={() => void connectMiniAppWallet()}
        />
      );
    }

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
          activePlanetId={activePlanetId}
          canTransact={canSubmitMissionTransaction}
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
          onResolve={handleResolveMission}
          onRetry={loadMissionDetail}
          onSelectCoordinates={handleSelectPlanet}
          onSelectMoon={handleSelectMoon}
          onSelectPlayer={handleSelectPlayer}
        />
      );
    }

    const indexedPageStateCanRender = (
      (page === "infrastructure" && Boolean(infrastructureChainState))
      || (page === "defenses" && Boolean(defenseState))
    );
    if (!walletPlanetHydrated && !indexedPageStateCanRender) {
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
      const pendingAttackTargetId = pendingGalaxyMission.action.kind === "attack"
        ? pendingGalaxyMission.target?.occupiedBy?.planetId
        : undefined;
      const pendingAttackProtectionBlocker = pendingAttackTargetId
        ? pendingAttackProtection?.targetPlanetId !== pendingAttackTargetId || pendingAttackProtection?.status === "checking"
          ? "Checking this target's active-war roster and protection rules."
          : pendingAttackProtection?.status === "error"
            ? "Could not verify this target's active-war protection. Retry before launching an attack."
            : attackProtectionSubmitBlocker(pendingAttackProtection?.protection)
        : undefined;
      const pendingAttackWarNotice = Boolean(pendingAttackTargetId)
        && pendingAttackProtection?.targetPlanetId === pendingAttackTargetId
        && pendingAttackProtection?.status === "ready"
        && pendingAttackProtection.protection?.atWar
        ? pendingAttackProtection.protection.allowed
          ? "War eligibility verified for this target. Bypass applies only to original declaration-roster members in the allowed direction."
          : "This war does not bypass protection for this attacker/target pairing. Frozen original rosters and declaration direction still apply."
        : undefined;
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
            defaultOriginIsMoon: pendingGalaxyMission.bodySelectionDefaults?.originIsMoon,
            defaultTargetIsMoon: pendingGalaxyMission.bodySelectionDefaults?.targetIsMoon,
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
          actionError={galaxyAction.status === "error" ? galaxyAction.label : undefined}
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
          moonAttackParityEnabled={moonAttackParityEnabled}
          key={missionComposerIdentity({
            account,
            activePlanetId,
            pending: pendingGalaxyMission,
          })}
          nowMs={now}
          onBack={() => {
            setPendingGalaxyMission(null);
            setPendingAttackProtection(null);
          }}
          onConfirm={handleConfirmGalaxyMission}
          originCoords={pendingMissionOriginCoords}
          originLabel={pendingMissionOriginLabel}
          missileInventory={defenseState?.defenses?.find((defense) => defense.id === 9)?.count ?? 0}
          resources={pendingMissionOriginResources}
          shipyardState={shipyardState}
          submitBlocker={pendingAttackProtectionBlocker ?? missionLaunchBlocker}
          target={pendingGalaxyMission.target}
          warProtectionNotice={pendingAttackWarNotice}
        />
      );
    }

    if (pendingJoinAttack) {
      return (
        <MissionCreationPage
          action={{
            enabled: true,
            kind: "attack",
            label: "Join attack",
            mode: "mission",
            mission: "attack",
            ships: emptyMissionShips(),
            defaultTargetIsMoon: pendingJoinAttack.mission.targetIsMoon === true,
          }}
          actionPending={galaxyAction.status === "pending"}
          actionPendingLabel={galaxyAction.status === "pending" ? galaxyAction.label : undefined}
          attackerCombatTechLevels={attackerCombatTechLevels}
          bodySelection={{
            defaultOriginIsMoon: activeBodyKind === "moon",
            defaultTargetIsMoon: pendingJoinAttack.mission.targetIsMoon === true,
            originMoonAvailable: Boolean(selectedManagedPlanet?.moon?.exists && moonState?.moon?.exists),
            originMoonResources: missionMoonResources(moonState),
            originMoonShipyardState: missionMoonShipyardState({ moonState, shipyardState }),
            targetMoonAvailable: pendingJoinAttack.mission.targetIsMoon === true
              ? Boolean(pendingJoinAttack.target?.hasMoon)
              : false,
            targetSelectionLocked: true,
          }}
          coords={pendingJoinAttack.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          joinAttackContext={joinAttackForecastContextForMission(pendingJoinAttack.mission)}
          joinAttackMode
          moonAttackParityEnabled={moonAttackParityEnabled}
          nowMs={now}
          onBack={() => setPendingJoinAttack(null)}
          onConfirm={handleConfirmJoinAttack}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
          submitBlocker={missionLaunchBlocker}
          target={pendingJoinAttack.target}
        />
      );
    }

    if (pendingAcsDefend) {
      return (
        <MissionCreationPage
          acsDefendContext={{ hostileArrivalMs: pendingAcsDefend.hostileArrivalMs, depotLevel: pendingAcsDefend.depotLevel }}
          acsDefendMode
          action={{ enabled: true, kind: "acsDefend", label: "Defend planet", mode: "mission", mission: "acsDefend", ships: emptyMissionShips() }}
          actionPending={galaxyAction.status === "pending"}
          actionPendingLabel={galaxyAction.status === "pending" ? galaxyAction.label : undefined}
          attackerCombatTechLevels={attackerCombatTechLevels}
          coords={pendingAcsDefend.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          nowMs={now}
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
          ownedPlanets={walletPlanets.map(planetFromSettlementPlanet)}
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
          transactionUnavailableReason={missionTransactionUnavailableReason}
          watchedPlanetIds={watchedPlanets?.watchedPlanetIds ?? []}
          watchBusyPlanetId={watchBusyPlanetId}
        />
      );
    }

    if (page === "planet" && selectedCoords) {
      return (
        <PlanetDetail
          key={`planet:${selectedCoords.galaxy}:${selectedCoords.system}:${selectedCoords.position}`}
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
          onSelectMoon={handleSelectMoon}
          provider={provider}
          shipyardState={missionActionShipyardState}
          transactionUnavailableReason={missionTransactionUnavailableReason}
        />
      );
    }

    if (page === "moon-inspect" && selectedCoords) {
      return (
        <PublicMoonDetail
          key={`moon:${selectedCoords.galaxy}:${selectedCoords.system}:${selectedCoords.position}`}
          account={account}
          actionState={galaxyAction}
          apiBaseUrl={apiBaseUrl}
          coords={selectedCoords}
          defenseState={defenseState}
          homeCoords={activePlanetCoords}
          homePlanetId={activePlanetId ?? onChainSettlement?.homePlanetId}
          onAction={handleGalaxyAction}
          onBack={handlePlanetDetailBack}
          onSelectPlanet={handleSelectPlanet}
          shipyardState={missionActionShipyardState}
          transactionUnavailableReason={missionTransactionUnavailableReason}
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
          constructionProgress={progressFor(activePlanetId, "planet", "building")}
          hasLoadedInfrastructureState={hasInfrastructureDisplayState({
            activeBuildingQueue,
            homePlanetId: onChainSettlement?.homePlanetId,
            infrastructureChainState,
            onChainResources,
          })}
          loading={infrastructureLoading}
          loadError={infrastructureLoadErrorFor({
            activeBuildingQueue,
            infrastructureChainState,
            infrastructureError,
            isWalletConnected,
          })}
          now={now}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshInfrastructureState}
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
          }}
          canBurnChicken={canSubmitChickenBurnTransaction}
          canTransact={canSubmitMoonTransaction}
          constructionProgress={progressFor(activePlanetId, "moon", "moon-building")}
          defenseProgress={progressFor(activePlanetId, "moon", "defense")}
          error={moonError}
          loading={moonLoading || (isWalletConnected && !moonState && !moonError)}
          moonActions={moonOverviewActions}
          moonState={moonState}
          now={now}
          onBurnChicken={handleBurnChickenForMoon}
          onJumpGate={handleJumpGate}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshInfrastructureState}
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
          activePlanetId={activePlanetId}
          allianceMemberAddresses={allianceState?.members.map((member) => member.address) ?? []}
          allActiveMissions={displayAllActiveMissions}
          canTransact={canSubmitMissionTransaction}
          fleetVisibility={displayFleetVisibility}
          hasAlliance={hasAllianceMembership(allianceState)}
          hasAvailableMissionFleet={missionCooperativeActionAvailable(missionActionShipyardState)}
          globalMissionArchive={globalMissionArchive}
          globalMissionArchiveError={globalMissionArchiveError}
          globalMissionArchiveLoading={globalMissionArchiveLoading}
          globalMissionArchiveTotalEntries={globalMissionArchiveTotalEntries}
          incomingAttackArchive={incomingAttackArchive}
          incomingAttackArchiveError={incomingAttackArchiveError}
          incomingAttackArchiveLoading={incomingAttackArchiveLoading}
          loading={isWalletConnected && onChainStatus === "loading"}
          initialView={missionControlInitialView}
          missionArchive={missionArchive}
          missionArchiveError={missionArchiveError}
          missionArchiveLoading={missionArchiveLoading}
          missileAttackArchive={missileAttackArchive}
          missileAttackArchiveError={missileAttackArchiveError}
          missileAttackArchiveLoading={missileAttackArchiveLoading}
          missionFilters={normalizedMissionFilters}
          now={now}
          onCounterplay={handleMissionCounterplay}
          onDefendPlanet={handleDefendPlanet}
          onJoinAttack={handleJoinAttack}
          onActiveMissionTabChange={requestMissionControlTabLoad}
          onOpenReport={handleOpenMissionReport}
          onOpenReportList={handleOpenMissionReportList}
          onRecall={handleRecallMission}
          onResolve={handleResolveMission}
          onGlobalMissionArchivePageChange={(page) => void loadGlobalMissionArchive(page)}
          onIncomingAttackArchivePageChange={(page) => void loadIncomingAttackArchive(page)}
          onPastMissionTabChange={requestMissionControlTabLoad}
          onMissionArchivePageChange={(page) => void loadMissionArchive(page)}
          onMissionFiltersChange={setMissionFilters}
          onRefresh={() => void refreshMissionControl()}
          planetArchetypesByCoordinate={missionPlanetArchetypesByCoordinate}
          reportMissionId={missionReportId ?? undefined}
          reportUrlForMission={missionReportUrlForMission}
          transactionUnavailableReason={missionTransactionUnavailableReason}
          walletPlanets={walletPlanets}
        />
      );
    }

    if (page === "research") {
      return (
        <ResearchPage
          actionState={researchAction}
          canTransact={canSubmitGameTransaction}
          error={researchError ?? walletRecoveryReadError}
          loading={researchLoading}
          now={now}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshResearchState}
          onResearch={handleResearch}
          onSelectResearch={setSelectedResearchKey}
          productionRates={productionRatesForEta}
          progressState={progressFor(activePlanetId, "planet", "research")}
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
          error={defenseError ?? walletRecoveryReadError}
          loading={defenseLoading}
          now={now}
          onBuild={handleBuildDefense}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshDefenseState}
          onSelectDefense={setSelectedDefenseKey}
          overviewQueue={progressFor(activePlanetId, "planet", "defense")?.queue ?? undefined}
          productionRates={productionRatesForEta}
          progressState={progressFor(activePlanetId, "planet", "defense")}
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
          activePlanetHasRift={infrastructureChainState
            ? infrastructureChainState.buildings.some((building) => (
              building.id === buildingContractIds.interdimensionalRiftStabilizer && building.level > 0
            ))
            : null}
          activePlanetName={selectedManagedPlanet?.name}
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
          onBuyPaidInvite={handleBuyPaidAllianceInvite}
          onRecoverPaidInvites={handleRecoverPaidAllianceInvites}
          onWithdrawPaidInviteBonus={handleWithdrawPaidAllianceBonus}
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

    if (page === "alliance-invites") {
      return (
        <AllianceInvitesPage
          referralProgramPanel={referralProgramPanel}
        />
      );
    }

    if (page === "alliance-inspect" && inspectedAllianceId) {
      return (
        <AllianceInspectPage
          actionBusy={allianceAction.status === "pending"}
          allianceId={inspectedAllianceId}
          allianceState={allianceState}
          apiBaseUrl={apiBaseUrl}
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
          provider={provider}
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
          onSelectMoon={handleSelectMoon}
          onSelectPlanet={handleSelectPlanet}
          originCoords={activePlanetCoords}
          provider={provider}
          wallet={inspectedPlayerWallet}
        />
      );
    }

    if (page === "shipyard") {
      return (
        <ShipyardPage
          actionState={shipyardAction}
          canTransact={canSubmitGameTransaction}
          error={shipyardError ?? walletRecoveryReadError}
          loading={shipyardLoading}
          now={now}
          onBuild={handleBuildShip}
          onCollect={refreshShipyardState}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshShipyardState}
          onSelectShip={setSelectedShipKey}
          overviewQueue={progressFor(activePlanetId, "planet", "ship")?.queue ?? undefined}
          productionRates={productionRatesForEta}
          progressState={progressFor(activePlanetId, "planet", "ship")}
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
          error={riftError}
          loading={riftLoading}
          now={now}
          onApprove={handleApproveRiftResource}
          onDeposit={handleDepositRiftResource}
          onFinishWithdrawal={handleFinishRiftWithdrawal}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshRiftState}
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
          moonActionsForPlanet={rankingsMoonActionsForPlanet}
          now={now}
          onMoonAction={handleRankingsMoonAction}
          onPlanetAction={handleRankingsPlanetAction}
          onSelectAlliance={handleSelectAlliance}
          onSelectMoon={handleSelectMoon}
          onSelectPlayer={handleSelectPlayer}
          onSelectPlanet={handleSelectPlanet}
          originCoordinates={activePlanetCoords}
          planetActionsForPlanet={rankingsPlanetActionsForPlanet}
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
        constructionProgress={{
          building: progressFor(activePlanetId, "planet", "building"),
          defense: progressFor(activePlanetId, "planet", "defense"),
          research: progressFor(activePlanetId, "planet", "research"),
          ship: progressFor(activePlanetId, "planet", "ship"),
        }}
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
        onSelectMoon={handleSelectMoon}
        onSelectPlanet={handleSelectPlanet}
        onSwitchPlanet={handleSelectManagedPlanet}
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
        watchedMoonActionsForPlanet={watchedMoonActionsForPlanet}
        watchedPlanetActionsForPlanet={watchedPlanetActionsForPlanet}
        onWatchedPlanetAction={handleOverviewWatchedPlanetAction}
        onWatchedMoonAction={handleOverviewWatchedMoonAction}
        watchBusyPlanetId={watchBusyPlanetId}
        myPlanets={overviewMyPlanetActionGroups}
        currentCommanderLabel={playerProfile?.displayName ?? "You"}
        selectedPlanetId={activePlanetId}
        onMyPlanetAction={handleOverviewMyPlanetAction}
        onSupplyPlanet={handleOpenBatchSupply}
      />
    );
  })();

  return (
    <div className="playable-starfield relative isolate min-h-dvh w-full max-w-full overflow-x-clip bg-[#05070f] text-slate-100">
      {topBar}

      {/* overflow-x-clip (not overflow-hidden): a hidden overflow would make
          this box the scrollport for the sticky mobile nav, permanently
          displacing it by --topbar-h and detaching it from the viewport. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[96rem] flex-col overflow-x-clip md:h-[calc(100dvh-var(--topbar-h,2.75rem))] md:flex-row">
        <NavBar
          account={account}
          active={page}
          canEditPlayerProfile={canSubmitProfileMutation}
          coordinates={homeCoordinateLabel}
          onConnectWallet={effectiveConnectWallet}
          onNavigate={handleNavigate}
          onOpenActivity={() => setPlayerActivityOpen(true)}
          onUpdatePlayerProfile={handleUpdatePlayerProfile}
          planetPicker={mobilePlanetPicker}
          playerProfile={playerProfile}
          playerProfileAction={playerProfileAction}
        />

        <main
          className="min-w-0 max-w-full flex-1 overflow-visible p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))] md:min-h-0 md:overflow-y-auto md:overscroll-contain lg:p-6 lg:pb-6"
          data-app-scrollport
        >
          {compactPlanetSelector}
          <div className="page-enter" key={page}>
            {content}
          </div>
        </main>

        {planetSidebar}
      </div>

      {shareDialogUrl ? (
        <ShareDialog onClose={() => setShareDialogUrl(null)} url={shareDialogUrl} />
      ) : null}
      <PlayerActivityCenter
        apiUrl={apiBaseUrl}
        explorerUrl={gameWalletChain.blockExplorerUrls[0]}
        historyOpen={playerActivityOpen}
        onHistoryClose={() => setPlayerActivityOpen(false)}
        wallet={account}
      />
      {batchSupplyTarget ? (
        <BatchSupplyModal
          actionPending={galaxyAction.status === "pending"}
          error={batchSupplyError}
          loading={batchSupplyLoading}
          maxSources={batchSupplyMaxSources}
          onClose={() => {
            if (galaxyAction.status !== "pending") setBatchSupplyTarget(null);
          }}
          onConfirm={handleConfirmBatchSupply}
          sources={batchSupplySources}
          target={batchSupplyTarget}
        />
      ) : null}
    </div>
  );
}

function PlanetSelector({
  attackHighlights,
  layout,
  onOrderChange,
  onSelect,
  planets,
  progressState,
  selectedPlanetId,
}: {
  attackHighlights: PlanetPickerAttackHighlights;
  layout: "mobile" | "sidebar";
  onOrderChange: (planetIds: string[]) => void;
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planets: ManagedPlanetResponse[];
  progressState: ConstructionProgressState;
  selectedPlanetId: string | undefined;
}) {
  const [draggingPlanetId, setDraggingPlanetId] = useState<string | undefined>();
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const interaction = useRef(createPlanetPickerInteractionController());
  const capturedPointer = useRef<{
    planetId: string;
    pointerId: number;
    target: HTMLButtonElement;
  }>();
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const suppressedClickPlanetId = useRef<string>();
  const touchReorderingPlanetId = useRef<string>();
  const planetIds = planets.map((planet) => planet.planetId);
  const selectedPlanet = planets.find((planet) => planet.planetId === selectedPlanetId) ?? planets[0];

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current === undefined) return;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  }, []);

  const releaseCapturedPointer = useCallback((pointerId: number) => {
    const captured = capturedPointer.current;
    if (!captured || captured.pointerId !== pointerId) return;
    if (captured.target.hasPointerCapture(pointerId)) {
      captured.target.releasePointerCapture(pointerId);
    }
    capturedPointer.current = undefined;
  }, []);

  useEffect(() => () => {
    clearLongPressTimer();
    interaction.current.cancelPointer();
    capturedPointer.current = undefined;
    touchReorderingPlanetId.current = undefined;
  }, [clearLongPressTimer]);

  const commitOrder = useCallback((nextPlanetIds: string[], movedPlanetId: string) => {
    onOrderChange(nextPlanetIds);
    const movedPlanet = planets.find((planet) => planet.planetId === movedPlanetId);
    const position = nextPlanetIds.indexOf(movedPlanetId) + 1;
    setReorderAnnouncement(
      `${movedPlanet ? planetDisplayName(movedPlanet) : "Planet"} moved to position ${position} of ${nextPlanetIds.length}.`,
    );
  }, [onOrderChange, planetIds, planets]);

  const handlePointerDown = useCallback((
    planetId: string,
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
  ) => {
    const accepted = interaction.current.beginPointer({
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      orderIds: planetIds,
      planetId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
    if (!accepted) return;
    const pointerId = event.pointerId;
    suppressedClickPlanetId.current = undefined;
    touchReorderingPlanetId.current = undefined;
    event.currentTarget.setPointerCapture(pointerId);
    capturedPointer.current = {
      planetId,
      pointerId,
      target: event.currentTarget,
    };
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = undefined;
      const activation = interaction.current.activatePointer(pointerId);
      if (!activation.activated || !activation.planetId) return;
      touchReorderingPlanetId.current = activation.planetId;
      setDraggingPlanetId(activation.planetId);
      const activePlanet = planets.find((planet) => planet.planetId === activation.planetId);
      setReorderAnnouncement(
        `Reorder mode active for ${activePlanet ? planetDisplayName(activePlanet) : "planet"}. Move it, then release to finish. Press Escape to cancel.`,
      );
    }, PLANET_PICKER_LONG_PRESS_MS);
  }, [clearLongPressTimer, planetIds, planets]);

  const handlePointerMove = useCallback((event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const move = interaction.current.movePointer({
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
    if (move.status === "cancelled") {
      clearLongPressTimer();
      touchReorderingPlanetId.current = undefined;
      suppressedClickPlanetId.current = move.planetId;
      releaseCapturedPointer(event.pointerId);
      return;
    }
    if (move.status !== "dragging") return;
    clearLongPressTimer();
    if (move.dragStarted) setDraggingPlanetId(move.planetId);

    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-planet-selector-item]");
    const targetPlanetId = target?.dataset.planetSelectorItem;
    if (!targetPlanetId || targetPlanetId === move.planetId) return;

    const bounds = target.getBoundingClientRect();
    const position = planetPickerDropPosition(layout, event.clientX, event.clientY, bounds);
    const reorder = interaction.current.reorderPointerTarget(targetPlanetId, position);
    if (!reorder) return;
    commitOrder(reorder.nextPlanetIds, reorder.movedPlanetId);
  }, [clearLongPressTimer, commitOrder, layout, releaseCapturedPointer]);

  const finishPointerDrag = useCallback((event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    clearLongPressTimer();
    const result = interaction.current.finishPointer(event.pointerId);
    touchReorderingPlanetId.current = undefined;
    releaseCapturedPointer(event.pointerId);
    if (!result.finished) return;
    if (result.wasDragging && result.planetId) {
      suppressedClickPlanetId.current = result.planetId;
      event.preventDefault();
      setReorderAnnouncement("Reorder mode ended.");
    }
    setDraggingPlanetId(undefined);
  }, [clearLongPressTimer, releaseCapturedPointer]);

  const handleReorderKeyDown = useCallback((
    planetId: string,
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === "Escape") {
      const result = interaction.current.cancelPointer();
      if (!result.finished) return;
      event.preventDefault();
      event.stopPropagation();
      clearLongPressTimer();
      touchReorderingPlanetId.current = undefined;
      if (result.planetId) suppressedClickPlanetId.current = result.planetId;
      if (capturedPointer.current) releaseCapturedPointer(capturedPointer.current.pointerId);
      setDraggingPlanetId(undefined);
      setReorderAnnouncement("Reorder mode cancelled.");
      return;
    }

    const reorder = interaction.current.reorderFromKey(planetIds, planetId, event.key);
    if (!reorder.handled) return;

    event.preventDefault();
    event.stopPropagation();
    const nextPlanetIds = reorder.nextPlanetIds;
    if (nextPlanetIds.every((nextPlanetId, index) => nextPlanetId === planetIds[index])) return;
    commitOrder(nextPlanetIds, planetId);
  }, [clearLongPressTimer, commitOrder, planetIds, releaseCapturedPointer]);

  const handlePlanetSelectClick = useCallback((
    planetId: string,
    event: JSX.TargetedMouseEvent<HTMLButtonElement>,
  ) => {
    if (suppressedClickPlanetId.current !== planetId) return true;
    suppressedClickPlanetId.current = undefined;
    event.preventDefault();
    event.stopPropagation();
    return false;
  }, []);

  const handlePlanetContextMenu = useCallback((
    planetId: string,
    event: JSX.TargetedMouseEvent<HTMLButtonElement>,
  ) => {
    if (capturedPointer.current?.planetId !== planetId) return;
    event.preventDefault();
  }, []);

  const shouldPreventPlanetTouchMove = useCallback(
    (planetId: string) => touchReorderingPlanetId.current === planetId,
    [],
  );

  if (!selectedPlanet) return null;

  const selectorItems = planets.map((planet) => (
    <PlanetSelectorItem
      attackHighlights={attackHighlights}
      dragging={draggingPlanetId === planet.planetId}
      key={planet.planetId}
      layout={layout}
      onBeforePlanetSelect={handlePlanetSelectClick}
      onPlanetContextMenu={handlePlanetContextMenu}
      onPlanetKeyDown={handleReorderKeyDown}
      onPlanetLostPointerCapture={finishPointerDrag}
      onPlanetPointerCancel={finishPointerDrag}
      onPlanetPointerDown={handlePointerDown}
      onPlanetPointerMove={handlePointerMove}
      onPlanetPointerUp={finishPointerDrag}
      onSelect={onSelect}
      planet={planet}
      progressState={progressState}
      selectedPlanet={selectedPlanet}
      shouldPreventPlanetTouchMove={shouldPreventPlanetTouchMove}
    />
  ));

  if (layout === "mobile") {
    return (
      <section aria-label="Select planet" className="block min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <span aria-live="polite" className="sr-only">{reorderAnnouncement}</span>
        <div className="flex w-max min-w-full gap-2 pb-1">
          {selectorItems}
        </div>
      </section>
    );
  }

  return (
    <aside aria-label="Select planet" className="hidden w-32 shrink-0 border-l border-white/10 bg-[#07111d]/92 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:flex lg:flex-col">
      <span aria-live="polite" className="sr-only">{reorderAnnouncement}</span>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {selectorItems}
      </div>
    </aside>
  );
}

function PlanetSelectorItem({
  attackHighlights,
  dragging,
  layout,
  onBeforePlanetSelect,
  onPlanetContextMenu,
  onPlanetKeyDown,
  onPlanetLostPointerCapture,
  onPlanetPointerCancel,
  onPlanetPointerDown,
  onPlanetPointerMove,
  onPlanetPointerUp,
  onSelect,
  planet,
  progressState,
  selectedPlanet,
  shouldPreventPlanetTouchMove,
}: {
  attackHighlights: PlanetPickerAttackHighlights;
  dragging: boolean;
  layout: "mobile" | "sidebar";
  onBeforePlanetSelect: (planetId: string, event: JSX.TargetedMouseEvent<HTMLButtonElement>) => boolean;
  onPlanetContextMenu: (planetId: string, event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onPlanetKeyDown: (planetId: string, event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => void;
  onPlanetLostPointerCapture: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPlanetPointerCancel: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPlanetPointerDown: (planetId: string, event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPlanetPointerMove: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPlanetPointerUp: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planet: ManagedPlanetResponse;
  progressState: ConstructionProgressState;
  selectedPlanet: ManagedPlanetResponse;
  shouldPreventPlanetTouchMove: (planetId: string) => boolean;
}) {
  const selected = isPlanetSelectorParentSelected(planet.planetId, selectedPlanet.planetId);
  const hasIncomingPlanetAttack = planetPickerHasIncomingAttack(attackHighlights, planet.planetId, "planet");
  const hasIncomingMoonAttack = planetPickerHasIncomingAttack(attackHighlights, planet.planetId, "moon");
  const reorderInstructionsId = `planet-picker-reorder-${layout}-${planet.planetId}`;
  return (
    <div
      className={`relative grid w-24 min-w-0 shrink-0 gap-1 rounded transition ${
        dragging ? "z-20 scale-[1.03] ring-2 ring-cyan-200/80 shadow-lg shadow-cyan-950/60" : ""
      }`}
      data-planet-selector-item={planet.planetId}
      data-planet-selector-incoming-attack={
        hasIncomingPlanetAttack && hasIncomingMoonAttack
          ? "planet-and-moon"
          : hasIncomingPlanetAttack
            ? "planet"
            : hasIncomingMoonAttack
              ? "moon"
              : undefined
      }
      data-planet-selector-reordering={dragging ? "true" : undefined}
    >
      <span className="sr-only" id={reorderInstructionsId}>
        {dragging
          ? "Reorder mode active. Move the pointer and release to finish, or press Escape to cancel."
          : "Press and hold to reorder. With the keyboard, use arrow keys, Home, or End to move this planet."}
      </span>
      {dragging ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-1 z-10 rounded bg-cyan-950/95 px-1 py-0.5 text-center text-[0.58rem] font-semibold uppercase tracking-wide text-cyan-100 shadow"
        >
          Reordering
        </span>
      ) : null}
      <PlanetSelectorButton
        ariaDescribedBy={reorderInstructionsId}
        bodyKind="planet"
        hasIncomingAttack={hasIncomingPlanetAttack}
        onBeforeSelect={onBeforePlanetSelect}
        onContextMenu={(event) => onPlanetContextMenu(planet.planetId, event)}
        onKeyDown={(event) => onPlanetKeyDown(planet.planetId, event)}
        onLostPointerCapture={onPlanetLostPointerCapture}
        onPointerCancel={onPlanetPointerCancel}
        onPointerDown={(event) => onPlanetPointerDown(planet.planetId, event)}
        onPointerMove={onPlanetPointerMove}
        onPointerUp={onPlanetPointerUp}
        onSelect={onSelect}
        planet={planet}
        progressState={progressState}
        reordering={dragging}
        selected={selected}
        shouldPreventTouchMove={() => shouldPreventPlanetTouchMove(planet.planetId)}
        showMoonIndicator={planet.moon?.exists === true}
      />
    </div>
  );
}

function PlanetSelectorButton({
  ariaDescribedBy,
  bodyKind,
  hasIncomingAttack,
  onBeforeSelect,
  onContextMenu,
  onKeyDown,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelect,
  planet,
  progressState,
  reordering,
  selected,
  shouldPreventTouchMove,
  showMoonIndicator,
}: {
  ariaDescribedBy?: string;
  bodyKind: OrbitBodyKind;
  hasIncomingAttack: boolean;
  onBeforeSelect?: (planetId: string, event: JSX.TargetedMouseEvent<HTMLButtonElement>) => boolean;
  onContextMenu?: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => void;
  onLostPointerCapture?: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  onSelect: (planetId: string, bodyKind?: OrbitBodyKind) => void;
  planet: ManagedPlanetResponse;
  progressState: ConstructionProgressState;
  reordering?: boolean;
  selected: boolean;
  shouldPreventTouchMove?: () => boolean;
  showMoonIndicator: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!buttonRef.current) return;
    const guard = installPlanetPickerTouchMoveGuard(buttonRef.current, shouldPreventTouchMove);
    return () => guard.dispose();
  }, []);

  const bodyLabel = bodyKind === "moon" ? "moon" : "planet";
  const label = `${hasIncomingAttack ? "Incoming attack warning. " : ""}Select ${planetDisplayName(planet)} ${bodyLabel} at ${planet.coordinates}`;
  const selectionStateClass = selected
    ? "bg-cyan-300/[0.07] shadow-[inset_0_0_0_1px_rgba(128,241,255,0.10)]"
    : hasIncomingAttack
      ? "bg-red-500/15 shadow-lg shadow-red-950/25"
      : "bg-white/[0.045] hover:bg-white/[0.075]";
  const borderStateClass = hasIncomingAttack
    ? "border-red-400/70 ring-1 ring-red-400/25"
    : selected
      ? "border-cyan-300/35"
      : "border-white/10 hover:border-cyan-200/40";
  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-describedby={ariaDescribedBy}
      aria-label={label}
      className={`veydrift-planet-selector-button group relative grid w-full min-w-0 shrink-0 justify-items-center gap-1 rounded border p-1.5 text-center transition focus:outline-none ${
        reordering ? "cursor-grabbing" : "cursor-pointer"
      } ${selectionStateClass} ${borderStateClass}`}
      data-planet-selector-long-press={bodyKind === "planet" ? planet.planetId : undefined}
      data-planet-selector-reorder-active={reordering ? "true" : undefined}
      onClick={(event) => {
        if (onBeforeSelect && !onBeforeSelect(planet.planetId, event)) return;
        onSelect(planet.planetId, bodyKind);
      }}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onLostPointerCapture={onLostPointerCapture}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={buttonRef}
      style={{ touchAction: "pan-x pan-y" }}
      title={label}
      type="button"
    >
      <span className="relative h-14 w-14">
        <span className="block h-14 w-14 overflow-hidden rounded-full bg-black/30">
          <img
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            src={planetImage(planet)}
          />
        </span>
        {showMoonIndicator ? (
          <PlanetMoonIndicator
            className="!-right-1 !-top-1 !h-5 !w-5 xl:!h-5 xl:!w-5"
            compact
            planetType={planetTypeFromTemperature(planet.temperature)}
          />
        ) : null}
        {hasIncomingAttack ? (
          <span
            aria-hidden="true"
            className={`absolute -top-1 z-10 grid h-5 w-5 place-items-center rounded-full border border-red-300/60 bg-red-500/85 text-white shadow shadow-red-950/40 ${
              showMoonIndicator ? "-left-1" : "-right-1"
            }`}
            title="Incoming attack"
          >
            <AlertTriangle className="block h-3 w-3" strokeWidth={2.4} />
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 block max-w-full text-[0.68rem] font-medium leading-4 text-slate-200 [overflow-wrap:anywhere]">
        {planetDisplayName(planet)}
      </span>
      <span className="block max-w-full truncate font-mono text-[0.6rem] leading-3 text-slate-400">
        {planet.coordinates}
      </span>
      <PlanetSelectorProgressBars planet={planet} progressState={progressState} />
    </button>
  );
}

function PlanetSelectorProgressBars({
  planet,
  progressState,
}: {
  planet: ManagedPlanetResponse;
  progressState: ConstructionProgressState;
}) {
  const bars = planetSelectorQueueProgressBars(planet, progressState).filter((bar) => bar.active);
  if (bars.length === 0) return null;

  const summary = bars.map((bar) => bar.title).join(". ");
  return (
    <span
      aria-label={`Planet production progress. ${summary}`}
      className="grid w-full gap-1"
      data-planet-selector-progress-bars={planet.planetId}
    >
      {bars.map((bar) => (
        <span
          className="contents"
          data-planet-selector-progress={bar.kind}
          data-planet-selector-progress-active="true"
          key={bar.kind}
          title={bar.title}
        >
          <AnimatedProgressBar
            className="h-1.5 border border-white/5 bg-white/10 opacity-100"
            fillClassName={bar.color}
            indeterminate={bar.indeterminate}
            label={bar.title}
            value={bar.progress}
          />
        </span>
      ))}
    </span>
  );
}

type PlanetSelectorProgressBar = {
  active: boolean;
  color: string;
  indeterminate: boolean;
  kind: "building" | "defense" | "research" | "ship";
  progress: number;
  remaining: string;
  title: string;
};

function researchQueuePreview(queue: QueueStateResponse | null | undefined): { label: string } {
  const research = queue?.itemId === undefined
    ? undefined
    : researchCatalog.find((item) => item.id === queue.itemId);
  return { label: research?.label ?? "Research" };
}

function planetSelectorQueueProgressBars(
  planet: ManagedPlanetResponse,
  progressState: ConstructionProgressState,
): PlanetSelectorProgressBar[] {
  return [
    planetSelectorQueueProgressBar({
      color: "bg-amber-300",
      kind: "building",
      label: "Building",
      preview: buildingQueuePreview(progressState.get(constructionProgressKey(planet.planetId, "planet", "building"))?.queue),
      progressState: progressState.get(constructionProgressKey(planet.planetId, "planet", "building")),
    }),
    planetSelectorQueueProgressBar({
      color: "bg-rose-300",
      kind: "defense",
      label: "Defense",
      preview: defenseQueuePreview(progressState.get(constructionProgressKey(planet.planetId, "planet", "defense"))?.queue),
      progressState: progressState.get(constructionProgressKey(planet.planetId, "planet", "defense")),
    }),
    planetSelectorQueueProgressBar({
      color: "bg-sky-300",
      kind: "ship",
      label: "Shipyard",
      preview: shipQueuePreview(progressState.get(constructionProgressKey(planet.planetId, "planet", "ship"))?.queue),
      progressState: progressState.get(constructionProgressKey(planet.planetId, "planet", "ship")),
    }),
    planetSelectorQueueProgressBar({
      color: "bg-violet-300",
      kind: "research",
      label: "Research",
      preview: researchQueuePreview(progressState.get(constructionProgressKey(planet.planetId, "planet", "research"))?.queue),
      progressState: progressState.get(constructionProgressKey(planet.planetId, "planet", "research")),
    }),
  ];
}

export function researchQueueForPlanet(
  queue: QueueStateResponse | null | undefined,
  planetId: string,
): QueueStateResponse | null {
  if (!queue?.active || !queue.planetId || queue.planetId !== planetId) return null;
  return queue;
}

const selectorResearchOriginByQueueKey = new Map<string, string>();

export function researchQueueWithPlanetAttribution(
  queue: QueueStateResponse | null | undefined,
  fallbackPlanetId: string | null | undefined,
): QueueStateResponse | null {
  if (!queue?.active) return null;

  const queueKey = [
    queue.kind ?? "research",
    queue.itemId ?? "unknown",
    queue.targetLevel ?? "unknown",
    queue.readyAt ?? "unknown",
  ].join(":");
  const planetId =
    queue.planetId ??
    selectorResearchOriginByQueueKey.get(queueKey) ??
    fallbackPlanetId ??
    undefined;

  if (!planetId) return queue;

  selectorResearchOriginByQueueKey.set(queueKey, planetId);
  return queue.planetId === planetId ? queue : { ...queue, planetId };
}

function planetSelectorQueueProgressBar({
  color,
  kind,
  label,
  preview,
  progressState,
}: {
  color: string;
  kind: PlanetSelectorProgressBar["kind"];
  label: string;
  preview: { label: string };
  progressState: ConstructionProgress | undefined;
}): PlanetSelectorProgressBar {
  if (!progressState?.active) {
    return {
      active: false,
      color,
      indeterminate: false,
      kind,
      progress: 0,
      remaining: "Idle",
      title: `${label}: idle`,
    };
  }

  const queue = progressState.queue;
  const startedAt = timestampToMs(queue?.startedAt ?? queue?.productionTiming?.startedAt);
  const finalReadyAt = timestampToMs(queue?.backlog?.at(-1)?.readyAt ?? queue?.readyAt);
  const hasWholeQueueTimeline = startedAt !== undefined
    && finalReadyAt !== undefined
    && startedAt < finalReadyAt;
  const now = Date.now();
  const totalProgress = hasWholeQueueTimeline
    ? Math.min(1, Math.max(0, (now - startedAt) / (finalReadyAt - startedAt)))
    : progressState.progress;
  const totalRemaining = finalReadyAt === undefined
    ? progressState.remaining
    : formatDurationUntil(finalReadyAt, now);

  return {
    active: true,
    color,
    indeterminate: false,
    kind,
    progress: totalProgress,
    remaining: totalRemaining,
    title: `${label}: ${preview.label}, ${totalRemaining} total left`,
  };
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

function MiniAppWalletErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-[52vh] place-items-center">
      <div className="max-w-xl rounded-lg border border-amber-300/20 bg-[#101624] p-5 text-center shadow-2xl shadow-black/20">
        <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-full border border-amber-200/25 bg-amber-300/10 text-amber-200">
          <AlertTriangle size={20} strokeWidth={2.4} />
        </div>
        <h1 className="text-base font-semibold text-white">Wallet error</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">{error}</p>
        <button
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-300/10 px-4 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
