import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Coordinates, Planet } from "./types";
import { GalaxyView, type GalaxyActionState } from "./components/GalaxyView";
import { PlanetDetail } from "./components/PlanetDetail";
import { TopBar } from "./components/TopBar";
import { NavBar, type Page } from "./components/NavBar";
import { isOverviewResearchReadyToFinish, OverviewPage, type PlanetRenameActionState } from "./components/OverviewPage";
import { InfrastructurePage } from "./components/InfrastructurePage";
import { DefensePage } from "./components/DefensePage";
import { AlliancePage, allianceInviteAcceptanceState, allianceJoinRequestApprovalState, allianceJoinRequestDismissalState } from "./components/AlliancePage";
import { ResearchPage, type ResearchActionState } from "./components/ResearchPage";
import { ShipyardPage } from "./components/ShipyardPage";
import type { RequirementTarget } from "./components/RequirementFlairs";
import { RiftPage } from "./components/RiftPage";
import { MoonPage } from "./components/MoonPage";
import { MissionDetailPage } from "./components/MissionDetailPage";
import { MissionControlPage } from "./components/MissionControlPage";
import { MissionCreationPage, type MissionCargoDraft, type MissionLaunchDraft } from "./components/MissionCreationPage";
import { BattleReportsPage } from "./components/BattleReportsPage";
import { RankingsPage } from "./components/RankingsPage";
import { RaidTargetFinderPage } from "./components/RaidTargetFinderPage";
import { AllianceInspectPage, PlayerInspectPage } from "./components/InspectPages";
import { buildInspectHash, parseInspectRoute, type InspectRoute } from "./inspectRoutes";
import { ShareDialog } from "./components/ShareDialog";
import {
  buildingKeyForContractId,
  infrastructureActionNoticeFor,
  infrastructureDisplayActionNoticeFor,
  type BuildingActionState,
} from "./buildingActionNotice";
import { buildingUpgradeStatus } from "./buildingDetails";

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
  progress,
  researchCatalog,
  type BuildingKey,
  type DefenseKey,
  type EnergyBalance,
  type PlanetProductionProfile,
  type PlayableState,
  type ResearchKey,
  type Resources,
  type ShipKey,
} from "./playableMvp";
import { activeProductionQueue } from "./productionQueueFallback";
import { allianceContractAddress, gameContractAddress, moonContractAddress, runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";
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
  buildGameStateSnapshot,
  clearGameStateSnapshot,
  hydrateGameStateForAccount,
  readGameStateSnapshot,
  writeGameStateSnapshot,
  type GameStateSnapshot,
  type PersistedGameState,
} from "./gameStateCache";
import {
  isTransientGameStateReadFailure,
  waitForFinishedResearchState,
  waitForStartedResearchState,
  waitForStartedDefenseProductionState,
  waitForStartedShipProductionState,
  waitForStartedBuildingState,
  waitForFinishedBuildingState,
  waitForHydratedWalletPlanet,
  waitForAllianceApplicationCleared,
  waitForRenamedWalletPlanet,
  type AllianceApplicationExpectation,
  type FinishedResearchExpectation,
  type StartedBuildingExpectation,
  type StartedDefenseProductionExpectation,
  type StartedShipProductionExpectation,
  type StartedResearchExpectation,
  type WalletPlanetSyncSnapshot,
  type FinishedBuildingExpectation,
} from "./postTransactionRefresh";
import {
  emptyMissionShips,
  missionTypeId,
  type GalaxyAction,
  type MissionShips,
} from "./galaxyActions";
import {
  type FleetDriveLevels,
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
} from "./fleetMissionRules";
import {
  fetchInfrastructureState,
  fetchMoonState,
  fetchDefenseState,
  fetchShipyardState,
  fetchResearchState,
  fetchRiftState,
  fetchWalletPlanets,
  fetchFleetMissionArchive,
  fetchFleetMissionVisibility,
  fetchGlobalActiveMissions,
  fetchGlobalMissionArchive,
  fetchMission,
  fetchBattleReports,
  fetchAllianceState,
  fetchPlayerProfile,
  mergePlayerProfile,
  walletRequestErrorMessage,
  spendTransactionErrorMessage,
  confirmTransactionReceipt,
  fetchWalletQueues,
  fetchWalletSettlement,
  parseRiftTokenAmount,
  sendApproveResourceTokenTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendAbandonPlanetTransaction,
  sendCreateColonyTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchAttackMissionTransaction,
  sendLaunchDefenseHoldTransaction,
  sendLaunchFleetMissionTransaction,
  sendJoinAttackMissionTransaction,
  sendJumpGateJumpTransaction,
  sendRecallFleetMissionTransaction,
  sendDepositResourceTransaction,
  sendRenamePlanetTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartMoonBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendAcceptAllianceInviteTransaction,
  sendAllianceJoinRequestTransaction,
  sendAllianceKickTransaction,
  sendAllianceLeaveTransaction,
  sendAllianceInviteTransaction,
  sendAllianceProfileTransaction,
  sendAllianceRoleTransaction,
  sendAllianceTransferOwnershipTransaction,
  sendApproveAllianceJoinRequestTransaction,
  sendCancelAllianceJoinRequestTransaction,
  sendDismissAllianceJoinRequestTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  sendCreateAllianceTransaction,
  isOnChainRevertError,
  isUserRejected,
  updatePlayerDisplayName,
  type ChainDefenseState,
  type ChainAllianceState,
  type ChainInfrastructureState,
  type ChainMoonState,
  type ChainResearchState,
  type ChainRiftState,
  type ChainShipyardState,
  type BattleReport,
  type Eip1193Provider,
  type FleetMissionVisibilityResponse,
  type FleetMissionArchiveResponse,
  type FleetMissionSummary,
  type GlobalMissionArchiveResponse,
  type MissionDetailResponse,
  type OnChainResources,
  type PendingWithdrawal,
  type ManagedPlanetResponse,
  type PlanetSummary,
  type PlayerProfile,
  type RiftResourceState,
  type PlayerQueuesResponse,
  type QueueStateResponse,
  type WalletPlanetsResponse,
  type WalletSettlementResponse,
} from "./walletFlow";
import {
  createTransactionActionGate,
  transactionAwaitingWalletLabel,
  transactionConfirmingLabel,
  transactionSyncingLabel,
} from "./transactionActionGate";
import { timestampToMs } from "./timestampFormat";

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
  "Infrastructure API is temporarily unavailable. The app will keep retrying, and building actions are paused until current backend state is available.";
const buildingWalletConfirmationLabel = (label: string) =>
  label === "Building completion"
    ? "Building completion: confirm the game-state update in your wallet; token balance changes are not expected."
    : `${label}: unlock your wallet if needed, then confirm in your wallet.`;
const TOP_BAR_RESOURCE_POLL_INTERVAL_MS = 10_000;
// VEY-KANEO-433: after an active mission's ETA passes, wait a short beat before the tightened Mission
// Control refresh so the backend indexer has settled the arrival/resolution before we re-read it.
const MISSION_RESOLUTION_REFRESH_BUFFER_MS = 1_500;

type RefreshFreshnessGate = { current: number };
export type ResourceSnapshotFreshness = {
  planetId: string | null;
  lastSettledAt: string | null;
};

export type OnChainRefreshPlan = {
  applyQueues: boolean;
  applyResourceState: boolean;
};

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
  return {
    planetId: settlement?.planet?.planetId ?? settlement?.homePlanetId ?? null,
    lastSettledAt: settlement?.planet?.lastSettledAt ?? null,
  };
}

export function resourceSnapshotFreshnessForInfrastructure(
  infrastructure: ChainInfrastructureState | null,
): ResourceSnapshotFreshness {
  return {
    planetId: infrastructure?.planetId ?? infrastructure?.homePlanetId ?? null,
    lastSettledAt: infrastructure?.planetLastSettledAt ?? null,
  };
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

  return nextSettledAt >= currentSettledAt;
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

// Authoritative on-chain construction queues + fleet visibility are not resource
// snapshots, so they must apply even when the resource anti-snapback gate rejects
// an equal/older settlement read (e.g. after a building completes with no fresh
// spend to settle). Only the resource/settlement state stays behind the gate. The
// request-ordering gate still guards against out-of-order responses upstream.
export function planOnChainRefresh(
  current: ResourceSnapshotFreshness,
  next: ResourceSnapshotFreshness,
): OnChainRefreshPlan {
  return {
    applyQueues: true,
    applyResourceState: shouldApplyResourceSnapshot(current, next),
  };
}

export function shouldRefreshAllianceStateForPage(page: Page): boolean {
  return page === "alliance" || page === "rankings" || page === "alliance-inspect";
}

export function shouldRefreshMissionActionStateForPage(page: Page): boolean {
  return page === "galaxy" || page === "planet";
}

// VEY-KANEO-433: Mission Control auto-polls its own data (active missions, the past-mission archives,
// and battle reports/loot) while the player is viewing it, so a mission resolving at its destination —
// and the resulting status flip, loot, and battle report — appears within a poll cycle instead of only
// after a manual Refresh.
export function shouldAutoPollMissionControlForPage(page: Page): boolean {
  return page === "mission-control";
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

function resourceSnapshotSettledAt(snapshot: ResourceSnapshotFreshness): bigint | undefined {
  if (!snapshot.lastSettledAt) return undefined;
  try {
    return BigInt(snapshot.lastSettledAt);
  } catch {
    return undefined;
  }
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
    return `${label} could not load current game API state before launch. The game API may be temporarily unavailable; refresh mission state and retry.`;
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
    return `${label} could not verify game contract state before launch. The game API or RPC is temporarily unavailable; refresh mission state and retry.`;
  }

  return message || `${label} failed.`;
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
  researchState,
  walletResearchQueue,
}: {
  canTransact: boolean;
  knownResearchQueue?: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
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

  return undefined;
}

export async function researchStartUnavailableReasonAfterLiveRevalidation({
  account,
  activePlanetId,
  apiBaseUrl,
  fallback,
  knownResearchQueue,
  loadResearchState = fetchResearchState,
  loadWalletQueues = fetchWalletQueues,
}: {
  account: string | undefined;
  activePlanetId: string | undefined;
  apiBaseUrl: string | undefined;
  fallback: ChainResearchState | null;
  knownResearchQueue?: ChainResearchState["queue"] | PlayerQueuesResponse["research"] | undefined;
  loadResearchState?: typeof fetchResearchState;
  loadWalletQueues?: typeof fetchWalletQueues;
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
      researchState,
      walletResearchQueue: queues.research,
    }),
  };
}

interface PlayableMvpAppProps {
  provider?: Eip1193Provider | undefined;
  account?: string | undefined;
  miniAppMode?: boolean | undefined;
  planet?: PlanetSummary | undefined;
}

type ShipyardActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type DefenseActionState = ShipyardActionState;
type AllianceActionState = ShipyardActionState;
type RiftActionState = ShipyardActionState;
export type PlanetActionState = ShipyardActionState;
type PlanetManagementActionState = PlanetActionState;
type MissionActionState = ShipyardActionState;
type MoonActionState = ShipyardActionState;

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
}: {
  buildingKey: BuildingKey;
  gameContract?: string | undefined;
  homePlanetId?: string | null | undefined;
  infrastructureChainState: ChainInfrastructureState | null;
  isWalletConnected: boolean;
  onChainResources?: PlayableState["resources"] | undefined;
  runtimeConfigStatus: RuntimeConfigState["status"];
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
  const refreshedResources = resourcesFromChain(infrastructureChainState.resources);
  const status = buildingUpgradeStatus(
    {
      ...refreshedState,
      resources: refreshedResources ?? onChainResources ?? refreshedState.resources,
    },
    buildingKey,
    { chainCost: buildingCosts(infrastructureChainState)[buildingKey] },
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
  if (
    !resourceAmountIsZero(planet.resources.metal)
    || !resourceAmountIsZero(planet.resources.crystal)
    || !resourceAmountIsZero(planet.resources.deuterium)
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
};

function transportCargoForSelectedPlanet(
  planet: ManagedPlanetResponse | undefined,
  ships: MissionShips,
  target: Coordinates,
  driveLevels: FleetDriveLevels = {},
  speedPercent = 100,
): Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined {
  if (!planet?.resources) return undefined;

  const distance = fleetMissionDistance(planet, target);
  const fuelCost = fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  let remaining = fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  if (remaining <= 0) return undefined;

  const metal = Math.min(safeResourceNumber(planet.resources.metal) ?? 0, remaining);
  remaining -= metal;
  const crystal = Math.min(safeResourceNumber(planet.resources.crystal) ?? 0, remaining);
  remaining -= crystal;

  const deuteriumAvailable = Math.max(0, (safeResourceNumber(planet.resources.deuterium) ?? 0) - fuelCost);
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
): Promise<WalletPlanetSyncSnapshot> {
  const planetsResult = await settlePromise(fetchWalletPlanets(apiBaseUrl, account));
  const indexedSettlement = settlementFromIndexedPlanets(
    account,
    planetsResult.status === "fulfilled" ? planetsResult.value : undefined,
  );
  if (indexedSettlement) {
    const indexedQueues = playerQueuesFromIndexedPlanet(
      account,
      indexedSettlement.homePlanetId,
      activePlanetId,
      planetsResult.status === "fulfilled" ? planetsResult.value : undefined,
    );
    const queuesResultPromise = indexedPlanetsExposeResearchQueue(planetsResult)
      ? Promise.resolve({ status: "fulfilled", value: indexedQueues } satisfies PromiseSettledResult<PlayerQueuesResponse>)
      : settlePromise(fetchWalletQueues(apiBaseUrl, account, activePlanetId));
    const visibilityResultPromise = settlePromise(fetchFleetMissionVisibility(apiBaseUrl, account, { includeArchive: false }));
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
    fetchWalletSettlement(apiBaseUrl, account),
    fetchWalletQueues(apiBaseUrl, account, activePlanetId),
    fetchFleetMissionVisibility(apiBaseUrl, account, { includeArchive: false }),
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
): PlayerQueuesResponse {
  if (isActiveResearchQueue(nextQueues.research) || !isActiveResearchQueue(currentQueues?.research)) {
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
  const route = parseInspectRoute(window.location.hash);
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
  return { page: route.page, playerWallet: null, allianceId: null, missionDetailId: null, missionReportId: null };
}

function initialSelectedCoords(): Coordinates | undefined {
  if (typeof window === "undefined") return undefined;
  const route = parseInspectRoute(window.location.hash);
  return route.kind === "planet" ? route.coords : undefined;
}

function writeInspectHash(route: InspectRoute): void {
  if (typeof window === "undefined") return;
  const hash = buildInspectHash(route);
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

export function PlayableMvpApp({ provider, account, miniAppMode = false, planet }: PlayableMvpAppProps = {}) {
  const isWalletConnected = Boolean(provider && account);
  // VEY-242: seed initial state from the previous session's snapshot so a full
  // page reload shows the last loaded data immediately (stale-while-revalidate)
  // instead of blanking into "Resources loading" / "Syncing planetfall".
  //
  // Hydration is intentionally NOT gated on `isWalletConnected`: on a hard reload
  // the wallet provider/account reconnect asynchronously, so they are still
  // undefined on the first render. Gating on the live connection would therefore
  // suppress the snapshot for exactly the reload case this is meant to fix and
  // re-blank the page into loaders. We hydrate optimistically (the snapshot is
  // wallet-scoped and per-tab) and the effect below reconciles/clears it if the
  // account that ultimately resolves differs from the snapshot's wallet.
  const [persistedGameSnapshot] = useState<GameStateSnapshot | undefined>(() => readGameStateSnapshot());
  const [hydratedGameState] = useState<PersistedGameState | undefined>(
    () => hydrateGameStateForAccount(persistedGameSnapshot, account)
  );
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [page, setPage] = useState<Page>(() => initialInspectPageState().page);
  const [inspectedPlayerWallet, setInspectedPlayerWallet] = useState<string | null>(() => initialInspectPageState().playerWallet);
  const [inspectedAllianceId, setInspectedAllianceId] = useState<string | null>(() => initialInspectPageState().allianceId);
  const [missionDetailId, setMissionDetailId] = useState<string | null>(() => initialInspectPageState().missionDetailId);
  const [missionReportId, setMissionReportId] = useState<string | null>(() => initialInspectPageState().missionReportId);
  const [selectedBuildingKey, setSelectedBuildingKey] = useState<BuildingKey>("metalMine");
  const [selectedResearchKey, setSelectedResearchKey] = useState<ResearchKey>("energy");
  const [selectedDefenseKey, setSelectedDefenseKey] = useState<DefenseKey>("rocketLauncher");
  const [selectedShipKey, setSelectedShipKey] = useState<ShipKey>("smallCargo");
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | undefined>(() => initialSelectedCoords());
  const [onChainSettlement, setOnChainSettlementState] = useState<WalletSettlementResponse | undefined>(
    () => hydratedGameState?.onChainSettlement
  );
  const applyOnChainSettlementSnapshot = useCallback((settlement: WalletSettlementResponse | undefined) => {
    setOnChainSettlementState(settlement);
  }, []);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | undefined>(
    () => hydratedGameState?.playerProfile
  );
  const [walletPlanets, setWalletPlanets] = useState<ManagedPlanetResponse[]>(
    () => hydratedGameState?.walletPlanets ?? []
  );
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | undefined>(
    () => hydratedGameState?.selectedPlanetId
  );
  const [onChainQueues, setOnChainQueues] = useState<PlayerQueuesResponse | undefined>(
    () => hydratedGameState?.onChainQueues
  );
  const [fleetVisibility, setFleetVisibility] = useState<FleetMissionVisibilityResponse | undefined>(
    () => hydratedGameState?.fleetVisibility
  );
  const [missionArchive, setMissionArchive] = useState<FleetMissionArchiveResponse | undefined>(
    () => hydratedGameState?.missionArchive
  );
  const [missionArchivePage, setMissionArchivePage] = useState(1);
  const [missionArchiveLoading, setMissionArchiveLoading] = useState(false);
  const [missionArchiveError, setMissionArchiveError] = useState<string | undefined>();
  const [allActiveMissions, setAllActiveMissions] = useState<FleetMissionSummary[] | undefined>();
  const [globalMissionArchive, setGlobalMissionArchive] = useState<GlobalMissionArchiveResponse | undefined>();
  const [globalMissionArchivePage, setGlobalMissionArchivePage] = useState(1);
  const [globalMissionArchiveLoading, setGlobalMissionArchiveLoading] = useState(false);
  const [globalMissionArchiveError, setGlobalMissionArchiveError] = useState<string | undefined>();
  const [publicBattleReports, setPublicBattleReports] = useState<BattleReport[]>([]);
  const [publicBattleReportsLoading, setPublicBattleReportsLoading] = useState(false);
  const [publicBattleReportsError, setPublicBattleReportsError] = useState<string | undefined>();
  const [missionDetail, setMissionDetail] = useState<MissionDetailResponse | undefined>();
  const [missionDetailLoading, setMissionDetailLoading] = useState(false);
  const [missionDetailError, setMissionDetailError] = useState<string | undefined>();
  const [onChainStatus, setOnChainStatus] = useState<ChainLoadStatus>(
    () => (hydratedGameState?.onChainSettlement ? "ready" : "local")
  );
  const [onChainError, setOnChainError] = useState<string | undefined>();
  const [hydratedWalletSnapshotKey, setHydratedWalletSnapshotKey] = useState<string | undefined>();
  const [chainSyncHealthy, setChainSyncHealthy] = useState(false);
  const [infrastructureChainState, setInfrastructureChainState] = useState<ChainInfrastructureState | null>(
    () => hydratedGameState?.infrastructureChainState ?? null
  );
  // Client-side ledger of submitted-but-not-yet-settled resource spends. Keeps
  // the displayed/gated balance from over-reporting during the window between a
  // spend mining and the backend infrastructure read reflecting it (VEY-392).
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState<string | undefined>();
  const [moonState, setMoonState] = useState<ChainMoonState | null>(
    () => hydratedGameState?.moonState ?? null
  );
  const [moonLoading, setMoonLoading] = useState(false);
  const [moonError, setMoonError] = useState<string | undefined>();
  const [defenseState, setDefenseState] = useState<ChainDefenseState | null>(
    () => hydratedGameState?.defenseState ?? null
  );
  const [defenseLoading, setDefenseLoading] = useState(false);
  const [defenseError, setDefenseError] = useState<string | undefined>();
  const [defenseAction, setDefenseAction] = useState<DefenseActionState>({ status: "idle" });
  const [allianceState, setAllianceState] = useState<ChainAllianceState | null>(
    () => hydratedGameState?.allianceState ?? null
  );
  const [allianceLoading, setAllianceLoading] = useState(false);
  const [allianceError, setAllianceError] = useState<string | undefined>();
  const [allianceAction, setAllianceAction] = useState<AllianceActionState>({ status: "idle" });
  const [selectedAllianceId, setSelectedAllianceId] = useState<string | null>(null);
  const [shipyardState, setShipyardState] = useState<ChainShipyardState | null>(
    () => hydratedGameState?.shipyardState ?? null
  );
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
  const [researchState, setResearchState] = useState<ChainResearchState | null>(
    () => hydratedGameState?.researchState ?? null
  );
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | undefined>();
  const [researchAction, setResearchAction] = useState<ResearchActionState>({ status: "idle" });
  const [riftState, setRiftState] = useState<ChainRiftState | null>(null);
  const [riftLoading, setRiftLoading] = useState(false);
  const [riftError, setRiftError] = useState<string | undefined>();
  const [riftAction, setRiftAction] = useState<RiftActionState>({ status: "idle" });
  const [buildingAction, setBuildingAction] = useState<BuildingActionState>({ status: "idle" });
  const [completedBuildingFinishExpectation, setCompletedBuildingFinishExpectation] =
    useState<FinishedBuildingExpectation | undefined>();
  const [failedBuildingFinishExpectation, setFailedBuildingFinishExpectation] =
    useState<FinishedBuildingExpectation | undefined>();
  const [planetManagementAction, setPlanetManagementAction] = useState<PlanetManagementActionState>({ status: "idle" });
  const [planetRenameAction, setPlanetRenameAction] = useState<PlanetRenameActionState>({ status: "idle" });
  const [playerProfileAction, setPlayerProfileAction] = useState<PlanetRenameActionState>({ status: "idle" });
  const [missionAction, setMissionAction] = useState<MissionActionState>({ status: "idle" });
  // The shareable battle-report URL currently shown in the share dialog; null when it is closed.
  const [shareDialogUrl, setShareDialogUrl] = useState<string | null>(null);
  const [moonAction, setMoonAction] = useState<MoonActionState>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;
  const onChainRefreshGate = useRef(0);
  const infrastructureRefreshGate = useRef(0);
  const latestOnChainResourceSnapshot = useRef<ResourceSnapshotFreshness>({ planetId: null, lastSettledAt: null });
  const latestInfrastructureResourceSnapshot = useRef<ResourceSnapshotFreshness>({ planetId: null, lastSettledAt: null });
  const [homePlanetIdentity, setHomePlanetIdentity] = useState<Planet | undefined>(
    () => hydratedGameState?.homePlanetIdentity
  );
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
  const selectedManagedPlanet = useMemo(
    () => walletPlanets.find((item) => item.planetId === (selectedPlanetId ?? onChainSettlement?.homePlanetId))
      ?? walletPlanets[0],
    [onChainSettlement?.homePlanetId, selectedPlanetId, walletPlanets]
  );
  const activePlanetId = selectedManagedPlanet?.planetId ?? onChainSettlement?.homePlanetId ?? undefined;
  const missionActionShipyardState = useMemo(() => shipyardStateForMissionActions({
    account,
    activePlanetId,
    homePlanetId: onChainSettlement?.homePlanetId,
    shipyardError,
    shipyardLoading,
    shipyardState,
  }), [
    account,
    activePlanetId,
    onChainSettlement?.homePlanetId,
    shipyardError,
    shipyardLoading,
    shipyardState,
  ]);
  const activeShipyardProductionQueue = activeProductionQueue(shipyardState?.queue, onChainQueues?.ship, "ship");
  const activeDefenseProductionQueue = activeProductionQueue(defenseState?.queue, onChainQueues?.defense, "defense");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRouteChange = () => applyInspectRoute(parseInspectRoute(window.location.hash));
    window.addEventListener("hashchange", handleRouteChange);
    return () => window.removeEventListener("hashchange", handleRouteChange);

    function applyInspectRoute(route: InspectRoute) {
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

  const onChainResources = useMemo(() => {
    if (!onChainSettlement?.planet) return undefined;
    const metal = safeResourceNumber(onChainSettlement.planet.resources.metal);
    const crystal = safeResourceNumber(onChainSettlement.planet.resources.crystal);
    const deuterium = safeResourceNumber(onChainSettlement.planet.resources.deuterium);
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

  // VEY-242: if the connected wallet turns out to differ from the snapshot we
  // optimistically hydrated (e.g. account resolved after mount, or a different
  // wallet auto-connected), drop the stale slices so we never show another
  // account's data. The live fetch then repopulates from scratch.
  const accountMismatchReconciled = useRef(false);
  useEffect(() => {
    if (accountMismatchReconciled.current) return;
    if (!account) return;
    accountMismatchReconciled.current = true;
    if (!persistedGameSnapshot) return;
    if (persistedGameSnapshot.account === account.toLowerCase()) return;
    clearGameStateSnapshot();
    if (!hydratedGameState) return;
    setOnChainSettlementState(undefined);
    setOnChainQueues(undefined);
    setWalletPlanets([]);
    setSelectedPlanetId(undefined);
    setPlayerProfile(undefined);
    setHomePlanetIdentity(undefined);
    setInfrastructureChainState(null);
    setResearchState(null);
    setShipyardState(null);
    setDefenseState(null);
    setMoonState(null);
    setAllianceState(null);
    setFleetVisibility(undefined);
    setMissionArchive(undefined);
    setOnChainStatus("local");
  }, [account, hydratedGameState, persistedGameSnapshot]);

  // VEY-242: persist the loaded snapshot for the connected wallet so the next
  // reload can render it immediately. Only writes once a settlement exists, so
  // the transient empty state during first load never clobbers a good snapshot.
  useEffect(() => {
    if (!isWalletConnected || !account) return;
    const snapshot = buildGameStateSnapshot({
      account,
      savedAtMs: Date.now(),
      state: {
        onChainSettlement,
        onChainQueues,
        walletPlanets,
        selectedPlanetId,
        playerProfile,
        homePlanetIdentity,
        infrastructureChainState,
        researchState,
        shipyardState,
        defenseState,
        moonState,
        allianceState,
        fleetVisibility,
        missionArchive,
      },
    });
    if (snapshot) writeGameStateSnapshot(snapshot);
  }, [
    account,
    isWalletConnected,
    onChainSettlement,
    onChainQueues,
    walletPlanets,
    selectedPlanetId,
    playerProfile,
    homePlanetIdentity,
    infrastructureChainState,
    researchState,
    shipyardState,
    defenseState,
    moonState,
    allianceState,
    fleetVisibility,
    missionArchive,
  ]);

  const gameContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? gameContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const allianceContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? allianceContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
  const moonContract = useMemo(() => {
    return runtimeConfig.status === "ready" ? moonContractAddress(runtimeConfig.config) : undefined;
  }, [runtimeConfig]);
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
      return;
    }

    setInfrastructureLoading(true);
    setMoonLoading(true);
    setInfrastructureError(undefined);
    setMoonError(undefined);
    try {
      const [infrastructureResult, moonResult] = await Promise.all([
        settlePromise(fetchInfrastructureState(apiBaseUrl, account, activePlanetId)),
        settlePromise(fetchMoonState(apiBaseUrl, account, activePlanetId)),
      ]);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return;
      if (infrastructureResult.status === "fulfilled") {
        const nextFreshness = resourceSnapshotFreshnessForInfrastructure(infrastructureResult.value);
        if (shouldApplyResourceSnapshot(latestInfrastructureResourceSnapshot.current, nextFreshness)) {
          latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
            latestInfrastructureResourceSnapshot.current,
            nextFreshness,
          );
          setInfrastructureChainState(infrastructureResult.value);
        }
      } else {
        console.error(infrastructureResult.reason);
        setInfrastructureError(infrastructureResult.reason instanceof Error ? infrastructureResult.reason.message : "Infrastructure state could not be loaded.");
      }
      if (moonResult.status === "fulfilled") {
        setMoonState(moonResult.value);
      } else {
        console.error(moonResult.reason);
        setMoonError(moonResult.reason instanceof Error ? moonResult.reason.message : "Moon state could not be loaded.");
      }
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
        setMoonLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshLiveInfrastructureState = useCallback(async () => {
    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    if (!apiBaseUrl || !account) {
      latestInfrastructureResourceSnapshot.current = { planetId: null, lastSettledAt: null };
      setInfrastructureChainState(null);
      return null;
    }

    setInfrastructureLoading(true);
    setInfrastructureError(undefined);
    try {
      const nextInfrastructure = await fetchInfrastructureState(apiBaseUrl, account, activePlanetId);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return nextInfrastructure;
      const nextFreshness = resourceSnapshotFreshnessForInfrastructure(nextInfrastructure);
      if (shouldApplyResourceSnapshot(latestInfrastructureResourceSnapshot.current, nextFreshness)) {
        latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
          latestInfrastructureResourceSnapshot.current,
          nextFreshness,
        );
        setInfrastructureChainState(nextInfrastructure);
      }
      return nextInfrastructure;
    } catch (error) {
      console.error(error);
      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) throw error;
      setInfrastructureError(error instanceof Error ? error.message : "Infrastructure state could not be loaded.");
      throw error;
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshDefenseState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setDefenseState(null);
      return;
    }

    setDefenseLoading(true);
    setDefenseError(undefined);
    fetchDefenseState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setDefenseState(next);
      })
      .catch((error) => {
        console.error(error);
        setDefenseError(error instanceof Error ? error.message : "Defense state could not be loaded.");
      })
      .finally(() => {
        setDefenseLoading(false);
      });
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

  const refreshShipyardState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setShipyardState(null);
      return;
    }

    setShipyardLoading(true);
    setShipyardError(undefined);
    fetchShipyardState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setShipyardState(next);
      })
      .catch((error) => {
        console.error(error);
        setShipyardError(error instanceof Error ? error.message : "Shipyard state could not be loaded.");
      })
      .finally(() => {
        setShipyardLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl]);

  const refreshResearchState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setResearchState(null);
      return;
    }

    setResearchLoading(true);
    setResearchError(undefined);
    fetchResearchState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setResearchState((current) => {
          const preserved = preserveActiveResearchState(current, next);
          return researchStateWithFallbackQueue(preserved, onChainQueues?.research) ?? preserved;
        });
      })
      .catch((error) => {
        console.error(error);
        setResearchError(error instanceof Error ? error.message : "Research state could not be loaded.");
      })
      .finally(() => {
        setResearchLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl, onChainQueues?.research]);

  const refreshRiftState = useCallback(() => {
    if (!apiBaseUrl || !account) {
      setRiftState(null);
      return;
    }

    setRiftLoading(true);
    setRiftError(undefined);
    fetchRiftState(apiBaseUrl, account, activePlanetId)
      .then((next) => {
        setRiftState(next);
      })
      .catch((error) => {
        console.error(error);
        setRiftError(error instanceof Error ? error.message : "Rift state could not be loaded.");
      })
      .finally(() => {
        setRiftLoading(false);
      });
  }, [account, activePlanetId, apiBaseUrl, onChainQueues?.research]);

  const refreshOnChainState = useCallback(async (renameExpectation?: { planetId: string; name: string }) => {
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

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    try {
      const loadSnapshot = () => loadWalletPlanetSyncSnapshot(apiBaseUrl, account, activePlanetId);
      const snapshot = renameExpectation
        ? await waitForRenamedWalletPlanet(loadSnapshot, renameExpectation)
        : await waitForHydratedWalletPlanet(loadSnapshot, activePlanetId);
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
      const plan = planOnChainRefresh(latestOnChainResourceSnapshot.current, nextFreshness);
      // Construction queues + fleet visibility are authoritative and not resource
      // snapshots, so apply them regardless of the resource anti-snapback gate.
      // This is what lets the Overview Buildings card clear a completed build
      // queue on the periodic poll without waiting for a manual page reload.
      if (plan.applyQueues) {
        setOnChainQueues((current) => preserveActiveResearchQueue(current, queues));
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
      if (!selectedPlanetId && selectedPlanet?.planetId) {
        setSelectedPlanetId(selectedPlanet.planetId);
      }
      applyOnChainSettlementSnapshot(nextSettlement);
      setPlayerProfile((current) => mergePlayerProfile(current, nextSettlement.player ?? planetsResponse.player));
      setHydratedWalletSnapshotKey(walletSnapshotHydrationKey(apiBaseUrl, account));
    } catch (error) {
      if (!canApplyRefreshRequest(onChainRefreshGate, requestId)) {
        return;
      }
      setOnChainError(error instanceof Error ? error.message : "Failed to load live game state");
      setOnChainStatus("error");
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, isWalletConnected, selectedPlanetId]);

  const loadMissionArchive = useCallback(async (page: number) => {
    if (!apiBaseUrl || !account) {
      setMissionArchive(undefined);
      setMissionArchiveError(undefined);
      setMissionArchiveLoading(false);
      return;
    }

    setMissionArchiveLoading(true);
    setMissionArchiveError(undefined);
    try {
      const nextArchive = await fetchFleetMissionArchive(apiBaseUrl, account, { page, pageSize: 25 });
      setMissionArchive(nextArchive);
      setMissionArchivePage(nextArchive.pagination.page);
    } catch (error) {
      console.error(error);
      setMissionArchiveError(error instanceof Error ? error.message : "Mission archive could not be loaded.");
    } finally {
      setMissionArchiveLoading(false);
    }
  }, [account, apiBaseUrl]);

  const loadAllActiveMissions = useCallback(async () => {
    if (!apiBaseUrl) {
      setAllActiveMissions(undefined);
      return;
    }
    try {
      const response = await fetchGlobalActiveMissions(apiBaseUrl);
      setAllActiveMissions(response.missions);
    } catch (error) {
      console.error(error);
      // The "All" active tab is supplementary; failing to load it must not break My missions/Alliance.
      setAllActiveMissions([]);
    }
  }, [apiBaseUrl]);

  const loadGlobalMissionArchive = useCallback(async (page: number) => {
    if (!apiBaseUrl) {
      setGlobalMissionArchive(undefined);
      setGlobalMissionArchiveError(undefined);
      setGlobalMissionArchiveLoading(false);
      return;
    }

    setGlobalMissionArchiveLoading(true);
    setGlobalMissionArchiveError(undefined);
    try {
      const nextArchive = await fetchGlobalMissionArchive(apiBaseUrl, { page, pageSize: 25 });
      setGlobalMissionArchive(nextArchive);
      setGlobalMissionArchivePage(nextArchive.pagination.page);
    } catch (error) {
      console.error(error);
      setGlobalMissionArchiveError(error instanceof Error ? error.message : "Universe mission archive could not be loaded.");
    } finally {
      setGlobalMissionArchiveLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (page === "mission-control") {
      void loadMissionArchive(1);
      void loadAllActiveMissions();
      void loadGlobalMissionArchive(1);
    }
  }, [account, apiBaseUrl, loadAllActiveMissions, loadGlobalMissionArchive, loadMissionArchive, page]);

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
      loadAllActiveMissions(),
      loadGlobalMissionArchive(globalMissionArchivePage),
    ]);
  }, [globalMissionArchivePage, loadAllActiveMissions, loadGlobalMissionArchive, loadMissionArchive, missionArchivePage, refreshOnChainState]);

  const refreshFinishedBuildingState = useCallback(async (expectation: FinishedBuildingExpectation): Promise<boolean> => {
    if (!apiBaseUrl || !account) {
      await refreshOnChainState();
      await refreshInfrastructureState();
      return true;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
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
      const message = error instanceof Error ? error.message : "Failed to load completed building state.";
      if (isTransientGameStateReadFailure(error) && infrastructureChainState) {
        setOnChainError(undefined);
        setOnChainStatus("ready");
        setInfrastructureError(message);
        return false;
      }

      setOnChainError(message);
      setOnChainStatus("error");
      setInfrastructureError(message);
      throw error;
    } finally {
      setInfrastructureLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, applyOnChainSettlementSnapshot, infrastructureChainState, refreshInfrastructureState, refreshOnChainState]);

  const refreshStartedDefenseProductionState = useCallback(async (expectation: StartedDefenseProductionExpectation) => {
    if (!apiBaseUrl || !account) {
      refreshDefenseState();
      void refreshOnChainState();
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
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

      setDefenseState(snapshot.defense);
      setDefenseError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load started defense production state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setDefenseError(message);
      throw error;
    } finally {
      setDefenseLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, refreshDefenseState, refreshOnChainState]);

  const refreshStartedShipProductionState = useCallback(async (expectation: StartedShipProductionExpectation) => {
    if (!apiBaseUrl || !account) {
      refreshShipyardState();
      void refreshOnChainState();
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
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

      setShipyardState(snapshot.shipyard);
      setShipyardError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load started ship production state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setShipyardError(message);
      throw error;
    } finally {
      setShipyardLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, refreshOnChainState, refreshShipyardState]);

  const refreshStartedResearchState = useCallback(async (expectation: StartedResearchExpectation) => {
    if (!apiBaseUrl || !account) {
      refreshResearchState();
      void refreshOnChainState();
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    setResearchLoading(true);
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

      setResearchState(snapshot.research);
      setResearchError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load started research state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setResearchError(message);
      throw error;
    } finally {
      setResearchLoading(false);
    }
  }, [account, activePlanetId, apiBaseUrl, refreshOnChainState, refreshResearchState]);

  const refreshStartedBuildingState = useCallback(async (expectation: StartedBuildingExpectation) => {
    if (!apiBaseUrl || !account) {
      void refreshOnChainState();
      await refreshInfrastructureState();
      return;
    }

    const requestId = beginRefreshRequest(infrastructureRefreshGate);
    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    setInfrastructureLoading(true);
    setInfrastructureError(undefined);

    try {
      const snapshot = await waitForStartedBuildingState(
        async () => {
          const [infrastructure, queues] = await Promise.all([
            fetchInfrastructureState(apiBaseUrl, account, activePlanetId),
            fetchWalletQueues(apiBaseUrl, account, activePlanetId),
          ]);

          return { infrastructure, queues };
        },
        expectation,
      );

      if (!canApplyRefreshRequest(infrastructureRefreshGate, requestId)) return;
      latestInfrastructureResourceSnapshot.current = recordedResourceSnapshotFreshness(
        latestInfrastructureResourceSnapshot.current,
        resourceSnapshotFreshnessForInfrastructure(snapshot.infrastructure),
      );
      setInfrastructureChainState(snapshot.infrastructure);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
      // Reconcile the settlement snapshot so the top-bar resources reflect the
      // amount just spent on the upgrade. Safe to fire here: the indexer is
      // already confirmed caught up (the queue poll succeeded), and the queue
      // display prefers infrastructureChainState.queue, so this cannot regress
      // the freshly-applied build queue.
      void refreshOnChainState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load started building state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setInfrastructureError(message);
      throw error;
    } finally {
      if (canApplyRefreshRequest(infrastructureRefreshGate, requestId)) {
        setInfrastructureLoading(false);
      }
    }
  }, [account, activePlanetId, apiBaseUrl, refreshInfrastructureState, refreshOnChainState]);

  const refreshFinishedResearchState = useCallback(async (expectation: FinishedResearchExpectation) => {
    if (!apiBaseUrl || !account) {
      refreshResearchState();
      void refreshOnChainState();
      return;
    }

    setOnChainStatus((current) => current === "ready" ? "ready" : "loading");
    setResearchLoading(true);
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

      setResearchState(snapshot.research);
      setResearchError(undefined);
      setOnChainQueues(snapshot.queues);
      setOnChainError(undefined);
      setOnChainStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load finished research state.";
      setOnChainError(message);
      setOnChainStatus("error");
      setResearchError(message);
      throw error;
    } finally {
      setResearchLoading(false);
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
        const systemPlanet = planetsFromSystemResponse(payload)
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

  useEffect(() => {
    void refreshOnChainState();
  }, [refreshOnChainState]);

  useEffect(() => {
    if (!pageStateHydrationReady) return;
    refreshInfrastructureState();
  }, [pageStateHydrationReady, refreshInfrastructureState]);

  useEffect(() => {
    if (!apiBaseUrl || !account || typeof window.EventSource === "undefined") {
      setChainSyncHealthy(false);
      return;
    }

    const events = new window.EventSource(`${apiBaseUrl.replace(/\/+$/, "")}/chain/events`);
    const refreshFromChainEvent = () => {
      void refreshOnChainState();
      refreshInfrastructureState();
      if (page === "shipyard" || shouldRefreshMissionActionStateForPage(page)) refreshShipyardState();
      if (page === "defenses" || shouldRefreshMissionActionStateForPage(page)) refreshDefenseState();
      if (shouldRefreshAllianceStateForPage(page)) refreshAllianceState();
      if (page === "research") refreshResearchState();
      if (page === "rift") refreshRiftState();
      if (page === "moon") refreshInfrastructureState();
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

    events.addEventListener("chain-event", refreshFromChainEvent);
    events.addEventListener("sync-status", updateSyncStatus);
    events.onerror = () => setChainSyncHealthy(false);

    return () => events.close();
  }, [
    account,
    apiBaseUrl,
    page,
    refreshDefenseState,
    refreshAllianceState,
    refreshInfrastructureState,
    refreshOnChainState,
    refreshResearchState,
    refreshRiftState,
    refreshShipyardState,
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
    const production = infrastructureChainState?.productionPerHour;
    return {
      metal: production ? Number(production.metal) : 0,
      crystal: production ? Number(production.crystal) : 0,
      deuterium: production ? Number(production.deuterium) : 0,
    };
  }, [infrastructureChainState?.productionPerHour]);
  // VEY-KANEO-481: production rate that feeds the "affordable in …" ETA on disabled
  // build/research/defense/shipyard actions. Only defined once the backend production
  // rate has loaded so the ETA never renders the stalled copy during the initial load.
  const productionRatesForEta = infrastructureChainState?.productionPerHour ? rates : undefined;
  // VEY-KANEO-465: storage caps are backend-derived (`storageCaps` on
  // /infrastructure) — no client recomputation.
  const caps = useMemo(() => {
    const nextCaps = infrastructureChainState?.storageCaps;
    return {
      metal: nextCaps ? Number(nextCaps.metal) : 0,
      crystal: nextCaps ? Number(nextCaps.crystal) : 0,
      deuterium: nextCaps ? Number(nextCaps.deuterium) : 0,
    };
  }, [infrastructureChainState?.storageCaps]);
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
    return (
      resourcesFromChain(infrastructureChainState?.resourcesAsOfNow ?? null)
      ?? resourcesFromChain(infrastructureChainState?.resources ?? null)
      ?? onChainResources
    );
  }, [
    infrastructureChainState?.resourcesAsOfNow,
    infrastructureChainState?.resources,
    onChainResources,
  ]);
  const liveOnChainResources = backendSpendableResources;
  const spendableResources = useMemo(() => {
    return walletSpendableResourcesFor({ isWalletConnected, onChainResources: backendSpendableResources });
  }, [isWalletConnected, backendSpendableResources]);
  // VEY-KANEO-453: the mission fuel/cargo gate reads the canonical spendable balance for
  // the active (origin) planet — the same value the top bar shows and a transaction spends
  // against — falling back to the backend wallet-planet snapshot only when no wallet-connected
  // spendable balance is available.
  const originMissionResources = useMemo(() => missionOriginResources({
    isWalletConnected,
    spendableResources,
    planetResources: selectedManagedPlanet?.resources,
  }), [isWalletConnected, spendableResources, selectedManagedPlanet?.resources]);
  const activeBuildingQueue = useMemo(
    () => activeBuildingQueueResponse(onChainQueues, infrastructureChainState),
    [infrastructureChainState, onChainQueues],
  );
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
  const effectiveResearchState = useMemo(
    () => researchStateWithFallbackQueue(researchState, onChainQueues?.research),
    [onChainQueues?.research, researchState],
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
    if (page === "shipyard" || shouldRefreshMissionActionStateForPage(page)) {
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
    await transactionActionGate.run(`building:start:${key}`, async () => {
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
      setBuildingAction({ status: "pending", buildingKey: key, label: "Refreshing infrastructure state" });

      try {
        const liveInfrastructure = await refreshLiveInfrastructureState();
        const unavailableReason = refreshedInfrastructureUpgradeUnavailableReasonFor({
          buildingKey: key,
          gameContract,
          homePlanetId: planetId,
          infrastructureChainState: liveInfrastructure,
          isWalletConnected,
          onChainResources,
          runtimeConfigStatus: runtimeConfig.status,
        });
        if (unavailableReason) {
          setBuildingAction({ status: "error", buildingKey: key, label: unavailableReason });
          return;
        }

        backendStateReady = true;
        setBuildingAction({ status: "pending", buildingKey: key, label: buildingWalletConfirmationLabel(label) });
        const txHash = await sendStartBuildingUpgradeTransaction(
          provider,
          account,
          gameContract,
          planetId,
          building,
        );
        setBuildingAction({
          status: "pending",
          buildingKey: key,
          label: transactionConfirmingLabel(label, txHash),
        });
        await confirmSubmittedTransaction(txHash);
        setBuildingAction({ status: "pending", buildingKey: key, label: transactionSyncingLabel(label) });
        const currentLevel = liveInfrastructure?.buildings.find((row) => row.id === building)?.level ?? 0;
        await refreshStartedBuildingState({
          itemId: building,
          planetId,
          targetLevel: currentLevel + 1,
        });
        setBuildingAction({ status: "success", buildingKey: key, label: "Building upgrade started." });
      } catch (error) {
        console.error(error);
        setBuildingAction({
          status: "error",
          buildingKey: key,
          label: backendStateReady ? spendTransactionErrorMessage(error) : buildingUpgradeActionErrorLabel(error),
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
    transactionActionGate,
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
    await transactionActionGate.run(actionKey, async () => {
      setShipyardAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        setShipyardAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setShipyardAction({ status: "pending", label: transactionSyncingLabel(label) });
        let synced = true;
        if (afterReceipt) {
          const result = await afterReceipt();
          synced = result !== false;
        } else {
          refreshShipyardState();
          void refreshOnChainState();
          refreshInfrastructureState();
        }
        setShipyardAction(synced
          ? { status: "success", label: `${label} confirmed.` }
          : { status: "pending", label: `${label} confirmed. Rechecking game state after a temporary API/RPC outage.` });
      } catch (error) {
        console.error(error);
        const message = spendTransactionErrorMessage(error);
        setShipyardAction({
          status: "error",
          label: `${label} failed: ${message}`,
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshShipyardState, transactionActionGate]);

  const runDefenseTransaction = useCallback(async (
    label: string,
    actionKey: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<void>) | undefined,
  ) => {
    await transactionActionGate.run(actionKey, async () => {
      setDefenseAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        setDefenseAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setDefenseAction({ status: "pending", label: transactionSyncingLabel(label) });
        if (afterReceipt) {
          await afterReceipt();
        } else {
          refreshDefenseState();
          void refreshOnChainState();
          refreshInfrastructureState();
        }
        setDefenseAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        setDefenseAction({
          status: "error",
          label: spendTransactionErrorMessage(error),
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, transactionActionGate]);

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
    setAllianceAction({ status: "pending", label });
    setAllianceLoading(true);

    try {
      const txHash = await send();
      setAllianceAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
      await confirmSubmittedTransaction(txHash);
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
  }, [confirmSubmittedTransaction, refreshAllianceState]);

  const runResearchTransaction = useCallback(async (
    label: string,
    send: () => Promise<string>,
    afterReceipt?: (() => Promise<void>) | undefined,
  ) => {
    await transactionActionGate.run(`research:${label}`, async () => {
      setResearchAction({ status: "pending", label: transactionAwaitingWalletLabel(label) });

      try {
        const txHash = await send();
        setResearchAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setResearchAction({ status: "pending", label: transactionSyncingLabel(label) });
        if (afterReceipt) {
          await afterReceipt();
        } else {
          refreshResearchState();
          void refreshOnChainState();
          refreshInfrastructureState();
        }
        setResearchAction({ status: "success", label: `${label} confirmed.` });
      } catch (error) {
        console.error(error);
        setResearchAction({
          status: "error",
          label: spendTransactionErrorMessage(error),
        });
      }
    });
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshResearchState, transactionActionGate]);

  const runRiftTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setRiftAction({ status: "pending", label });

    try {
      const txHash = await send();
      setRiftAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
      await confirmSubmittedTransaction(txHash);
      setRiftAction({ status: "pending", label: transactionSyncingLabel(label) });
      refreshRiftState();
      void refreshOnChainState();
      refreshInfrastructureState();
      setRiftAction({ status: "success", label: `${label} confirmed.` });
    } catch (error) {
      console.error(error);
      setRiftAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState, refreshRiftState]);

  const runGalaxyTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setGalaxyAction({ status: "pending", label });

    try {
      const txHash = await send();
      setGalaxyAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
      await confirmSubmittedTransaction(txHash);
      setGalaxyAction({ status: "pending", label: transactionSyncingLabel(label) });
      refreshShipyardState();
      refreshDefenseState();
      void refreshOnChainState();
      refreshInfrastructureState();
      setGalaxyAction({ status: "success", label: `${label} confirmed.` });
    } catch (error) {
      console.error(error);
      setGalaxyAction({
        status: "error",
        label: galaxyMissionActionErrorLabel(label, error),
      });
    }
  }, [confirmSubmittedTransaction, refreshDefenseState, refreshInfrastructureState, refreshOnChainState, refreshShipyardState]);

  const runMoonTransaction = useCallback(async (label: string, send: () => Promise<string>) => {
    setMoonAction({ status: "pending", label });

    try {
      const txHash = await send();
      setMoonAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
      await confirmSubmittedTransaction(txHash);
      setMoonAction({ status: "pending", label: transactionSyncingLabel(label) });
      await refreshInfrastructureState();
      void refreshOnChainState();
      setMoonAction({ status: "success", label: `${label} confirmed.` });
    } catch (error) {
      console.error(error);
      setMoonAction({
        status: "error",
        label: error instanceof Error ? error.message : `${label} failed.`,
      });
    }
  }, [confirmSubmittedTransaction, refreshInfrastructureState, refreshOnChainState]);

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
    if (!provider || !account || !allianceContract || !allianceState?.membership.allianceId) {
      setAllianceAction({ status: "error", label: "Alliance contract unavailable." });
      return;
    }

    void runAllianceTransaction("Alliance profile update", () => sendAllianceProfileTransaction(
      provider,
      account,
      allianceContract,
      allianceState.membership.allianceId,
      tag,
      name,
      description,
    ));
  }, [account, allianceContract, allianceState?.membership.allianceId, provider, runAllianceTransaction]);

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
    const knownResearchQueue = activeResearchQueue(effectiveResearchState.queue)
      ?? activeResearchQueue(researchState?.queue)
      ?? activeResearchQueue(onChainQueues?.research);

    void researchStartUnavailableReasonAfterLiveRevalidation({
      account,
      activePlanetId,
      apiBaseUrl,
      fallback: effectiveResearchState,
      knownResearchQueue,
    })
      .then(({ queues, researchState: latestResearchState, unavailableReason }) => {
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
        const homePlanetId = stateForTransaction.homePlanetId;
        if (!homePlanetId) {
          setResearchAction({ status: "error", label: "No VeydriftGame home planet is available for research." });
          return;
        }

        const currentLevel = stateForTransaction.technologies.find((technology) => technology.id === technologyId)?.level
          ?? stateForTransaction.technologyLevels[technologyId.toString()]
          ?? 0;

        void runResearchTransaction(researchStartTransactionLabel(technologyId, key, stateForTransaction), () => sendStartResearchTransaction(
          provider,
          account,
          gameContract,
          homePlanetId,
          technologyId,
        ), () => refreshStartedResearchState({
          itemId: technologyId,
          targetLevel: currentLevel + 1,
        }));
      })
      .catch((error) => {
        console.error(error);
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
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift bridge is unavailable." });
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
      setRiftAction({ status: "error", label: riftState?.unavailableReason ?? "Rift bridge is unavailable." });
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

  const handleSelectManagedPlanet = useCallback((planetId: string) => {
    setSelectedPlanetId(planetId);
    setPlanetManagementAction({ status: "idle" });
    setPlanetRenameAction({ status: "idle" });
  }, []);

  const handleRenamePlanet = useCallback((name: string) => {
    if (!provider || !account || !gameContract || !activePlanetId) {
      setPlanetRenameAction({ status: "error", label: "Wallet, game contract, or planet is unavailable." });
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setPlanetRenameAction({ status: "pending", label: "Waiting for wallet confirmation" });
    void sendRenamePlanetTransaction(provider, account, gameContract, activePlanetId, trimmedName)
      .then(async (txHash) => {
        setPlanetRenameAction({ status: "pending", label: transactionConfirmingLabel("Planet rename", txHash) });
        await confirmSubmittedTransaction(txHash);
        setPlanetRenameAction({ status: "pending", label: transactionSyncingLabel("Planet rename") });
        await refreshOnChainState({ planetId: activePlanetId, name: trimmedName });
        setPlanetRenameAction({ status: "success", label: "Planet renamed." });
      })
      .catch((error) => {
        console.error(error);
        setPlanetRenameAction({
          status: "error",
          label: error instanceof Error ? error.message : "Rename transaction failed.",
        });
      });
  }, [account, activePlanetId, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState]);

  const handleUpdatePlayerDisplayName = useCallback((displayName: string) => {
    if (!provider || !account || !apiBaseUrl) {
      setPlayerProfileAction({ status: "error", label: "Wallet or game API is unavailable." });
      return;
    }

    setPlayerProfileAction({ status: "pending", label: "Waiting for wallet signature" });
    void updatePlayerDisplayName(apiBaseUrl, provider, account, displayName)
      .then(async (profile) => {
        setPlayerProfile((current) => mergePlayerProfile(current, profile));
        markFreshStateWrite(onChainRefreshGate);
        setOnChainSettlementState((current) => current ? { ...current, player: profile } : current);
        try {
          const refreshedProfile = await fetchPlayerProfile(apiBaseUrl, account);
          setPlayerProfile((current) => mergePlayerProfile(current, refreshedProfile));
          markFreshStateWrite(onChainRefreshGate);
          setOnChainSettlementState((current) => current ? { ...current, player: refreshedProfile } : current);
        } catch (error) {
          console.error(error);
        }
        setPlayerProfileAction({ status: "success", label: "Display name saved." });
        if (shouldRefreshAllianceStateForPage(page)) refreshAllianceState();
      })
      .catch((error) => {
        console.error(error);
        setPlayerProfileAction({
          status: "error",
          label: error instanceof Error ? error.message : "Display name update failed.",
        });
      });
  }, [account, apiBaseUrl, page, provider, refreshAllianceState]);

  const handleAbandonPlanet = useCallback(() => {
    if (!provider || !account || !gameContract || !activePlanetId || selectedManagedPlanet?.isHomePlanet) {
      setPlanetManagementAction({ status: "error", label: "Only non-home colonies can be abandoned." });
      return;
    }
    const label = selectedManagedPlanet?.name ?? `Planet ${selectedManagedPlanet?.coordinates ?? activePlanetId}`;
    if (!window.confirm(`Abandon ${label}? This requires an empty colony with no active queues or fleet missions.`)) return;

    setPlanetManagementAction({ status: "pending", label: "Waiting for wallet confirmation" });
    void sendAbandonPlanetTransaction(provider, account, gameContract, activePlanetId)
      .then(async (txHash) => {
        setPlanetManagementAction({ status: "pending", label: transactionConfirmingLabel("Colony abandon", txHash) });
        await confirmSubmittedTransaction(txHash);
        setPlanetManagementAction({ status: "pending", label: transactionSyncingLabel("Colony abandon") });
        setSelectedPlanetId(undefined);
        await refreshOnChainState();
        setPlanetManagementAction({ status: "success", label: "Colony abandoned." });
      })
      .catch((error) => {
        console.error(error);
        setPlanetManagementAction({
          status: "error",
          label: error instanceof Error ? error.message : "Abandon transaction failed.",
        });
      });
  }, [account, activePlanetId, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState, selectedManagedPlanet]);

  const handleGalaxyAction = useCallback((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => {
    if (!action.enabled) return;
    setGalaxyAction({ status: "idle" });
    setPendingGalaxyMission({ action, target, coords });
  }, []);

  const handleConfirmGalaxyMission = useCallback((draft: MissionLaunchDraft) => {
    const pending = pendingGalaxyMission;
    if (!pending) return;
    const { action, target, coords } = pending;
    const originPlanetId = activePlanetId ?? onChainSettlement?.homePlanetId;
    if (!provider || !account || !gameContract || !originPlanetId) {
      setGalaxyAction({ status: "error", label: "Wallet, game contract, or origin planet is unavailable." });
      return;
    }

    if (action.mode === "colonize") {
      setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
      void runGalaxyTransaction("Colony mission", () => sendCreateColonyTransaction(
        provider,
        account,
        gameContract,
        originPlanetId,
        coords.galaxy,
        coords.system,
        coords.position,
        draft.speedPercent,
      ));
      return;
    }

    const targetPlanetId = target?.occupiedBy?.planetId;
    if (!targetPlanetId) {
      setGalaxyAction({ status: "error", label: "Target planet has no public settlement record yet." });
      return;
    }

    if (action.mode === "missile") {
      setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
      void runGalaxyTransaction("Missile attack", () => sendLaunchInterplanetaryMissileAttackTransaction(
        provider,
        account,
        gameContract,
        {
          originPlanetId,
          targetPlanetId,
          primaryTargetId: draft.primaryTargetId ?? action.primaryTargetId,
          quantity: draft.quantity ?? action.quantity,
        },
      ));
      return;
    }

    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    if (action.kind === "defenseHold") {
      // VEY-KANEO-440: proactive ACS Defend — station the fleet at the target own/ally planet for the
      // chosen hold window via launchDefenseHold (pre-flighted so ineligible / out-of-window /
      // under-fuelled reverts surface as a clear message before the wallet prompt).
      void runGalaxyTransaction("Stationed defense", () => sendLaunchDefenseHoldTransaction(
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
      ));
      return;
    }
    if (action.kind === "attack" && draft.lootRatio) {
      const { metal, crystal, deuterium } = draft.lootRatio;
      void runGalaxyTransaction(`${action.label} mission`, () => sendLaunchAttackMissionTransaction(
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
      ));
      return;
    }
    void runGalaxyTransaction(`${action.label} mission`, () => sendLaunchFleetMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId,
        targetPlanetId,
        missionType: missionTypeId(action.mission),
        ships: draft.ships,
        speedPercent: draft.speedPercent,
        cargo: action.kind === "transport" || action.kind === "deploy"
          ? missionCargoFromDraft(draft.cargo) ?? transportCargoForSelectedPlanet(
              selectedManagedPlanet,
              draft.ships,
              coords,
              driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels),
              draft.speedPercent,
            )
          : undefined,
      },
    ));
  }, [account, activePlanetId, gameContract, onChainSettlement?.homePlanetId, pendingGalaxyMission, provider, runGalaxyTransaction, selectedManagedPlanet, shipyardState?.technologyLevels]);

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

    setMissionAction({ status: "pending", label: `${label}: waiting for wallet confirmation.` });
    request()
      .then(async (txHash) => {
        setMissionAction({ status: "pending", label: transactionConfirmingLabel(label, txHash) });
        await confirmSubmittedTransaction(txHash);
        setMissionAction({ status: "pending", label: transactionSyncingLabel(label) });
        await refreshOnChainState();
        setMissionAction({ status: "success", label: `${label} confirmed.` });
      })
      .catch((error) => {
        console.error(error);
        setMissionAction({
          status: "error",
          label: error instanceof Error ? error.message : `${label} transaction failed.`,
        });
      });
  }, [account, confirmSubmittedTransaction, gameContract, provider, refreshOnChainState]);

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

    setPendingAcsDefend(null);
    // The hostile mission id is passed as targetPlanetId; the contract resolves the defended planet and
    // pins the defending fleet's arrival to the attack. The chosen speed controls the natural arrival
    // (and therefore the hold duration), so it must reach the chain.
    void runGalaxyTransaction("Group defense", () => sendLaunchFleetMissionTransaction(
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
    ));
  }, [account, activePlanetId, gameContract, onChainSettlement?.homePlanetId, pendingAcsDefend, provider, runGalaxyTransaction]);

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

    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    void runGalaxyTransaction("Group attack join", () => sendJoinAttackMissionTransaction(
      provider,
      account,
      gameContract,
      {
        originPlanetId: onChainSettlement.homePlanetId ?? "0",
        attackMissionId: pending.attackMissionId,
        targetPlanetId: pending.targetPlanetId,
        ships: draft.ships,
      },
    ));
  }, [account, gameContract, onChainSettlement?.homePlanetId, pendingJoinAttack, provider, runGalaxyTransaction]);

  const handleNavigate = useCallback((target: Page) => {
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setPage(target);
    setSelectedCoords(undefined);
    writeInspectHash({ kind: "page", page: target });
  }, []);

  const handleOpenMissionReport = useCallback((missionId: string) => {
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setInspectedPlayerWallet(null);
    setInspectedAllianceId(null);
    setMissionDetailId(missionId);
    setMissionReportId(null);
    setSelectedCoords(undefined);
    setPage("mission-control");
    writeInspectHash({ kind: "mission", missionId });
  }, []);

  const handleOpenMissionReportList = useCallback(() => {
    setPendingGalaxyMission(null);
    setPendingJoinAttack(null);
    setPendingAcsDefend(null);
    setMissionDetailId(null);
    setMissionReportId(null);
    setPage("mission-control");
    setSelectedCoords(undefined);
    writeInspectHash({ kind: "page", page: "mission-control" });
  }, []);

  const missionReportUrlForMission = useCallback((missionId: string) => {
    const hash = buildInspectHash({ kind: "mission", missionId });
    if (typeof window === "undefined") return hash;
    return `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
  }, []);

  const handleSelectPlanet = useCallback((coords: Coordinates) => {
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
    writeInspectHash({ kind: "planet", coords });
  }, []);

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
    writeInspectHash({ kind: "alliance", allianceId });
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
    writeInspectHash({ kind: "player", wallet });
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
      layout="mobile"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
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
      layout="sidebar"
      onSelect={handleSelectManagedPlanet}
      planets={walletPlanets}
      selectedPlanetId={activePlanetId}
    />
  ) : null;

  const missionDetailShareUrl = typeof window === "undefined" || !missionDetailId
    ? ""
    : `${window.location.origin}${window.location.pathname}${window.location.search}${buildInspectHash({ kind: "mission", missionId: missionDetailId })}`;
  const battleReportsShareUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}${window.location.pathname}${buildInspectHash({ kind: "page", page: "battle-reports" })}`;

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
          canTransact={Boolean(provider && account && gameContract)}
          detail={missionDetail}
          error={missionDetailError}
          fleetVisibility={fleetVisibility}
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
      return (
        <MissionCreationPage
          action={pendingGalaxyMission.action}
          actionPending={galaxyAction.status === "pending"}
          coords={pendingGalaxyMission.coords}
          defenseHoldContext={pendingGalaxyMission.action.kind === "defenseHold"
            ? { depotLevel: allianceDepotLevelFromPlanet(pendingGalaxyMission.target) }
            : undefined}
          defenseHoldMode={pendingGalaxyMission.action.kind === "defenseHold"}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          onBack={() => setPendingGalaxyMission(null)}
          onConfirm={handleConfirmGalaxyMission}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
          target={pendingGalaxyMission.target}
        />
      );
    }

    if (pendingJoinAttack) {
      return (
        <MissionCreationPage
          action={{ enabled: true, kind: "attack", label: "Join attack", mode: "mission", mission: "attack", ships: emptyMissionShips() }}
          actionPending={galaxyAction.status === "pending"}
          coords={pendingJoinAttack.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          joinAttackMode
          onBack={() => setPendingJoinAttack(null)}
          onConfirm={handleConfirmJoinAttack}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
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
          coords={pendingAcsDefend.coords}
          driveLevels={driveLevelsFromTechnologyLevels(shipyardState?.technologyLevels)}
          onBack={() => setPendingAcsDefend(null)}
          onConfirm={handleConfirmAcsDefend}
          originCoords={activePlanetCoords}
          originLabel={selectedManagedPlanet?.name ?? homePlanetIdentity?.name}
          resources={originMissionResources}
          shipyardState={shipyardState}
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
          onNavigate={(g, s) => setGalaxyNav({ galaxy: g, system: s })}
          onSelectPlanet={handleSelectPlanet}
          system={galaxyNav.system}
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
          onBack={() => setPage("galaxy")}
          shipyardState={missionActionShipyardState}
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
          settledState={infrastructureState}
          state={state}
        />
      );
    }

    if (page === "moon") {
      return (
        <MoonPage
          action={moonAction}
          canTransact={Boolean(provider && account && moonContract)}
          error={moonError}
          loading={moonLoading}
          moonState={moonState}
          onJumpGate={handleJumpGate}
          onRefresh={refreshInfrastructureState}
          onStartBuilding={handleStartMoonBuilding}
        />
      );
    }

    if (page === "mission-control") {
      return (
        <MissionControlPage
          actionState={missionAction}
          allActiveMissions={allActiveMissions}
          canTransact={Boolean(provider && account && gameContract)}
          fleetVisibility={fleetVisibility}
          globalMissionArchive={globalMissionArchive}
          globalMissionArchiveError={globalMissionArchiveError}
          globalMissionArchiveLoading={globalMissionArchiveLoading}
          loading={isWalletConnected && onChainStatus === "loading"}
          missionArchive={missionArchive}
          missionArchiveError={missionArchiveError}
          missionArchiveLoading={missionArchiveLoading}
          now={now}
          onCounterplay={handleMissionCounterplay}
          onDefendPlanet={handleDefendPlanet}
          onJoinAttack={handleJoinAttack}
          onOpenReport={handleOpenMissionReport}
          onOpenReportList={handleOpenMissionReportList}
          onRecall={handleRecallMission}
          onGlobalMissionArchivePageChange={(page) => void loadGlobalMissionArchive(page)}
          onMissionArchivePageChange={(page) => void loadMissionArchive(page)}
          onRefresh={refreshMissionControl}
          reportMissionId={missionReportId ?? undefined}
          reportUrlForMission={missionReportUrlForMission}
          walletPlanets={walletPlanets}
        />
      );
    }

    if (page === "research") {
      return (
        <ResearchPage
          actionState={researchAction}
          canTransact={Boolean(provider && account && gameContract)}
          error={researchError}
          loading={researchLoading}
          now={now}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshResearchState}
          onResearch={handleResearch}
          onSelectResearch={setSelectedResearchKey}
          productionRates={productionRatesForEta}
          researchState={effectiveResearchState}
          selectedResearchKey={selectedResearchKey}
          spendableResources={spendableResources}
          settledState={settledState}
          state={state}
          useLocalStateFallback={!isWalletConnected}
        />
      );
    }

    if (page === "defenses") {
      return (
        <DefensePage
          actionState={defenseAction}
          canTransact={Boolean(provider && account && gameContract)}
          defenseState={defenseState}
          error={defenseError}
          fleetVisibility={fleetVisibility}
          loading={defenseLoading}
          now={now}
          onBuild={handleBuildDefense}
          onDefendPlanet={handleDefendPlanet}
          onOpenMission={handleOpenMissionReport}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshDefenseState}
          onSelectDefense={setSelectedDefenseKey}
          overviewQueue={onChainQueues?.defense}
          productionRates={productionRatesForEta}
          selectedDefenseKey={selectedDefenseKey}
          spendableResources={spendableResources}
        />
      );
    }

    if (page === "alliance") {
      return (
        <AlliancePage
          actionState={allianceAction}
          allianceState={allianceState}
          apiBaseUrl={apiBaseUrl}
          canTransact={Boolean(provider && account && allianceContract)}
          error={allianceError}
          loading={allianceLoading}
          selectedAllianceId={selectedAllianceId}
          onAcceptInvite={handleAcceptAllianceInvite}
          onApproveJoinRequest={handleApproveAllianceJoinRequest}
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
          canTransact={Boolean(provider && account && allianceContract)}
          disabled={allianceLoading}
          onApproveJoinRequest={handleApproveAllianceJoinRequest}
          onBack={() => handleNavigate("alliance")}
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
          canTransact={Boolean(provider && account && gameContract)}
          error={shipyardError}
          loading={shipyardLoading}
          now={now}
          onBuild={handleBuildShip}
          onCollect={refreshShipyardState}
          onOpenRequirement={handleOpenRequirement}
          onRefresh={refreshShipyardState}
          onSelectShip={setSelectedShipKey}
          overviewQueue={onChainQueues?.ship}
          productionRates={productionRatesForEta}
          selectedShipKey={selectedShipKey}
          shipyardState={shipyardState}
          spendableResources={spendableResources}
        />
      );
    }

    if (page === "rift") {
      return (
        <RiftPage
          actionState={riftAction}
          canTransact={Boolean(provider && account && gameContract)}
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
        />
      );
    }

    if (page === "rankings") {
      return (
        <RankingsPage
          activeMissions={allActiveMissions}
          apiBaseUrl={apiBaseUrl}
          currentAllianceId={allianceState?.membership.allianceId}
          currentWallet={account}
          now={now}
          onSelectAlliance={handleSelectAlliance}
          onSelectPlayer={handleSelectPlayer}
          onSelectPlanet={handleSelectPlanet}
          originCoordinates={activePlanetCoords}
        />
      );
    }

    if (page === "raid-target-finder") {
      return (
        <RaidTargetFinderPage
          activeMissions={allActiveMissions}
          apiBaseUrl={apiBaseUrl}
          currentWallet={account}
          fleetVisibility={fleetVisibility}
          now={now}
          onSelectAlliance={handleSelectAlliance}
          onSelectPlanet={handleSelectPlanet}
          onSelectPlayer={handleSelectPlayer}
          originCoordinates={activePlanetCoords}
        />
      );
    }

    return (
      <OverviewPage
        caps={caps}
        isWalletConnected={isWalletConnected}
        now={now}
        onChainError={onChainError}
        fleetVisibility={fleetVisibility}
        onChainQueues={overviewOnChainQueues}
        onChainSettlement={onChainSettlement}
        onChainStatus={isWalletConnected ? onChainStatus : "local"}
        buildingActionNotice={infrastructureActionNotice}
        buildingActionPendingLabel={infrastructureActionPendingLabel}
        onNavigate={(target) => handleNavigate(target)}
        onRenamePlanet={handleRenamePlanet}
        onUpdatePlayerDisplayName={handleUpdatePlayerDisplayName}
        playerProfile={playerProfile}
        playerProfileAction={playerProfileAction}
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
        canRenamePlanet={Boolean(provider && account && gameContract && activePlanetId)}
        canEditPlayerProfile={Boolean(provider && account && apiBaseUrl)}
        planetRenameAction={planetRenameAction}
        canAbandonPlanet={selectedManagedPlanet
          ? shouldShowAbandonPlanetButton(selectedManagedPlanet, Boolean(provider && account && gameContract), planetManagementAction)
          : false}
        onAbandonPlanet={handleAbandonPlanet}
        planetManagementAction={planetManagementAction}
        usedFields={selectedManagedPlanet?.fieldsUsed}
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
          coordinates={homeCoordinateLabel}
          onNavigate={handleNavigate}
          planetPicker={mobilePlanetPicker}
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
  layout,
  onSelect,
  planets,
  selectedPlanetId,
}: {
  layout: "mobile" | "sidebar";
  onSelect: (planetId: string) => void;
  planets: ManagedPlanetResponse[];
  selectedPlanetId: string | undefined;
}) {
  const selectedPlanet = planets.find((planet) => planet.planetId === selectedPlanetId) ?? planets[0];
  if (!selectedPlanet) return null;

  if (layout === "mobile") {
    return (
      <section aria-label="Select planet" className="overflow-x-auto">
        <div className="flex min-w-max gap-2 pb-1">
          {planets.map((planet) => {
            const selected = planet.planetId === selectedPlanet.planetId;
            return (
              <PlanetSelectorButton
                key={planet.planetId}
                onSelect={onSelect}
                planet={planet}
                selected={selected}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <aside aria-label="Select planet" className="hidden w-28 shrink-0 border-l border-white/10 bg-[#07111d]/92 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {planets.map((planet) => {
          const selected = planet.planetId === selectedPlanet.planetId;
          return (
            <PlanetSelectorButton
              key={planet.planetId}
              onSelect={onSelect}
              planet={planet}
              selected={selected}
            />
          );
        })}
      </div>
    </aside>
  );
}

function PlanetSelectorButton({
  onSelect,
  planet,
  selected,
}: {
  onSelect: (planetId: string) => void;
  planet: ManagedPlanetResponse;
  selected: boolean;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={`Select ${planetDisplayName(planet)} at ${planet.coordinates}`}
      className={`group grid w-20 shrink-0 justify-items-center gap-1 rounded border p-1.5 text-center transition focus:outline-none focus:ring-2 focus:ring-cyan-300/60 ${
        selected
          ? "border-cyan-300/70 bg-cyan-300/12 shadow-lg shadow-cyan-950/25"
          : "border-white/10 bg-white/[0.045] hover:border-cyan-200/40 hover:bg-white/[0.075]"
      }`}
      onClick={() => onSelect(planet.planetId)}
      type="button"
    >
      <span className="h-14 w-14 overflow-hidden rounded bg-black/30">
        <img
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          src={planetImage(planet)}
        />
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
