import { isActionBusy } from "../actionNoticeAutoDismiss";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Info,
  Package,
  PackagePlus,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  Satellite,
  Shield,
  Swords,
  Trash2,
  X,
} from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { BackendDataStore } from "../backendDataStore";
import { planetsFromSystemResponse } from "../data/mockUniverse";
import { formatDurationUntil } from "../durationFormat";
import type { GalaxyAction } from "../galaxyActions";
import {
  displayPlanetStats,
  overviewPlanetEffects,
  usedFieldsFromBuildings,
  type ChainLoadStatus,
  type OverviewPlanetEffectsDisplay,
} from "../overviewData";
import {
  type PlayableState,
  type Resources,
} from "../playableMvp";
import { timestampToMs } from "../timestampFormat";
import type { Planet } from "../types";
import {
  decodeColonizationTargetId,
  type FleetMissionPlanetReference,
  type FleetMissionVisibilityResponse,
  type ManagedPlanetResponse,
  type PlanetSummary,
  type PlayerQueuesResponse,
  type QueueStateResponse,
  type WalletSettlementResponse,
  type WatchedPlanetsResponse
} from "../walletFlow";
import { watchedPlanetsPanelRange } from "../watchedPlanetsView";
import { EmpireOverview } from "./EmpireOverview";
import { galaxyActionIcon } from "./GalaxyActionIcon";
import {
  formatCompactResource,
  formatGalaxyAllianceIdentityLabel,
  formatGalaxyCommanderLabel,
  formatGalaxyHeatLabel,
} from "./GalaxyView";
import { GalaxyRowsSkeleton, OverviewSkeleton } from "./LoadingSkeletons";
import { combatProgressLabel, isMissionQueued, missionTypeLabel, proofBattlePresentation } from "./missionControlModel";
import { Skeleton, SkeletonRegion } from "./Skeleton";
import { type PlanetMetaItem } from "./WatchablePlanetRow";
import { moonImageForType } from "../gameAssets";
import { getSizedImageSrc } from "../utils/imageSizes";
export { isOverviewResearchReadyToFinish } from "./overviewQueueModel";

export function compactOverviewLevelLabel(label: string): string {
  return label.replace(/\s+[Ll]evel\s+(\d+)$/, " $1");
}

export function compactOverviewResearchLabel(label: string): string {
  return label.replace(/\s+Technology(?=(?:\s+\d+)?$)/, "");
}

export type PlanetRenameActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

export type PlanetManagementActionState = PlanetRenameActionState;

export type OverviewMyPlanetActionGroup = {
  planet: ManagedPlanetResponse;
  actions: GalaxyAction[];
  moonActions?: GalaxyAction[] | undefined;
};

interface OverviewPageProps {
  account?: string | undefined;
  backendData?: BackendDataStore | undefined;
  researchQueue?: QueueStateResponse | null | undefined;
  selectedBodyKind?: "planet" | "moon";
  settledState: PlayableState;
  rates: Resources;
  now: number;
  planet?: PlanetSummary | undefined;
  homePlanet?: Planet | undefined;
  isWalletConnected: boolean;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectMoon?: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlanet?: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  // Tapping one of the player's own planet or moon names makes it the selected body.
  onSwitchPlanet?: ((planetId: string, bodyKind: "planet" | "moon") => void) | undefined;
  onToggleWatchPlanet?: ((planetId: string, watched: boolean) => void) | undefined;
  onRenamePlanet?: ((name: string) => void) | undefined;
  onChainError?: string | undefined;
  fleetVisibility?: FleetMissionVisibilityResponse | undefined;
  onChainSettlement?: WalletSettlementResponse | undefined;
  onChainQueues?: PlayerQueuesResponse | undefined;
  onChainStatus: ChainLoadStatus;
  planetRenameAction?: PlanetRenameActionState | undefined;
  canRenamePlanet?: boolean | undefined;
  planetManagementAction?: PlanetManagementActionState | undefined;
  canAbandonPlanet?: boolean | undefined;
  onAbandonPlanet?: (() => void) | undefined;
  usedFields?: number | undefined;
  watchedPlanets?: WatchedPlanetsResponse | undefined;
  watchedPlanetsError?: string | undefined;
  watchedPlanetsLoading?: boolean | undefined;
  watchedPlanetsPage?: number | undefined;
  onWatchedPlanetsPageChange?: ((page: number) => void) | undefined;
  onRefreshWatchedPlanets?: (() => void) | undefined;
  watchedPlanetActionsForPlanet?: ((planet: Planet) => GalaxyAction[]) | undefined;
  watchedMoonActionsForPlanet?: ((planet: Planet) => GalaxyAction[]) | undefined;
  onWatchedPlanetAction?: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onWatchedMoonAction?: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  watchBusyPlanetId?: string | undefined;
  myPlanets?: readonly OverviewMyPlanetActionGroup[] | undefined;
  selectedPlanetId?: string | undefined;
  onMyPlanetAction?: ((action: GalaxyAction, planet: ManagedPlanetResponse) => void) | undefined;
  onSupplyPlanet?: ((planet: ManagedPlanetResponse) => void) | undefined;
}

export function OverviewPage({
  account,
  backendData,
  researchQueue,
  selectedBodyKind = "planet",
  settledState,
  rates,
  now,
  planet,
  homePlanet,
  isWalletConnected,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlanet,
  onSelectPlayer,
  onSwitchPlanet,
  onToggleWatchPlanet,
  onRenamePlanet,
  onChainError,
  fleetVisibility,
  onChainSettlement,
  onChainQueues,
  onChainStatus,
  planetRenameAction = { status: "idle" },
  canRenamePlanet = false,
  planetManagementAction = { status: "idle" },
  canAbandonPlanet = false,
  onAbandonPlanet,
  usedFields: selectedPlanetUsedFields,
  watchedPlanets,
  watchedPlanetsError,
  watchedPlanetsLoading = false,
  watchedPlanetsPage = 1,
  onWatchedPlanetsPageChange,
  onRefreshWatchedPlanets,
  watchedPlanetActionsForPlanet,
  watchedMoonActionsForPlanet,
  onWatchedPlanetAction,
  onWatchedMoonAction,
  watchBusyPlanetId,
  myPlanets = [],
  selectedPlanetId,
  onMyPlanetAction,
  onSupplyPlanet,
}: OverviewPageProps) {
  const usedFields = selectedPlanetUsedFields ?? usedFieldsFromBuildings(settledState.buildings);
  const stats = displayPlanetStats(onChainSettlement, onChainQueues, usedFields, isWalletConnected ? onChainStatus : "local");
  const planetEffects = overviewPlanetEffects({
    buildings: settledState.buildings,
    energyTechnologyLevel: settledState.research.energy,
    productionRates: rates,
    settlement: onChainSettlement,
    solarSatelliteCount: settledState.ships.solarSatellite,
    usedFields,
  });
  const watchedPlanetRows = useMemo(() =>
    watchedPlanets
      ? planetsFromSystemResponse({
          galaxy: 0,
          system: 0,
          planets: watchedPlanets.planets,
        })
      : [],
    [watchedPlanets]
  );
  const fleetPlanetNames = useMemo(() => {
    const names = new Map<string, string>();
    const remember = (planetId: string | null | undefined, coordinates: string, name: string | null | undefined) => {
      const trimmedName = name?.trim();
      if (!trimmedName) return;
      if (planetId) names.set(`id:${planetId}`, trimmedName);
      names.set(`coords:${coordinates}`, trimmedName);
    };

    for (const group of myPlanets) {
      remember(group.planet.planetId, group.planet.coordinates, group.planet.name);
    }
    for (const watched of watchedPlanets?.planets ?? []) {
      remember(
        watched.occupiedBy?.planetId,
        `${watched.galaxy}:${watched.system}:${watched.position}`,
        watched.name,
      );
    }
    return names;
  }, [myPlanets, watchedPlanets]);

  const planetName = overviewPlanetDisplayName(homePlanet, planet) ?? "";
  const [renameDraft, setRenameDraft] = useState(planetName);
  const [renamePanelOpen, setRenamePanelOpen] = useState(false);
  const [renameValidation, setRenameValidation] = useState<string | undefined>(undefined);
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false);
  useEffect(() => {
    setEffectsPanelOpen(false);
    setRenamePanelOpen(false);
  }, [selectedBodyKind]);

  useEffect(() => {
    if (!renamePanelOpen) {
      setRenameDraft(planetName);
      setRenameValidation(undefined);
    }
  }, [planetName, renamePanelOpen]);

  useEffect(() => {
    if (planetRenameAction.status === "success") {
      setRenamePanelOpen(false);
    }
  }, [planetRenameAction.status]);

  const canShowRename = Boolean(isWalletConnected && onRenamePlanet);
  const renameBusy = isActionBusy(planetRenameAction);
  const renameStatusTone = planetRenameAction.status === "error"
    ? "text-amber-200"
    : planetRenameAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const renameStatusLabel = planetRenameAction.status === "idle" ? undefined : planetRenameAction.label;
  const managementStatusTone = planetManagementAction.status === "error"
    ? "text-amber-200"
    : planetManagementAction.status === "success"
      ? "text-emerald-200"
      : "text-slate-300";
  const showAbandonAction = Boolean(canAbandonPlanet && onAbandonPlanet);
  const handleRenameSubmit = (event: Event) => {
    event.preventDefault();
    const name = renameDraft.trim();
    if (!name) {
      setRenameValidation("Enter a planet name.");
      return;
    }
    setRenameValidation(undefined);
    onRenamePlanet?.(name);
  };

  useEffect(() => {
    if (!renamePanelOpen && !effectsPanelOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!renameBusy) setRenamePanelOpen(false);
      setEffectsPanelOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [effectsPanelOpen, renameBusy, renamePanelOpen]);

  const selectedBodyActions = (
    <>
      <button
        aria-controls="overview-planet-effects"
        aria-expanded={effectsPanelOpen}
        aria-haspopup="dialog"
        aria-label="Show planet stats and effects"
        className="inline-grid h-7 w-7 place-items-center rounded text-slate-400 transition hover:bg-white/[0.06] hover:text-cyan-100 sm:h-6 sm:w-6"
        onClick={() => {
          setRenamePanelOpen(false);
          setEffectsPanelOpen(true);
        }}
        title="Planet stats and effects"
        type="button"
      >
        <Info aria-hidden="true" size={12} strokeWidth={2} />
      </button>
      {canShowRename ? (
        <button
          aria-controls="overview-planet-name-editor"
          aria-expanded={renamePanelOpen}
          aria-haspopup="dialog"
          aria-label="Rename planet"
          className="inline-grid h-7 w-7 place-items-center rounded text-slate-400 transition hover:bg-white/[0.06] hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600 sm:h-6 sm:w-6"
          disabled={renameBusy}
          onClick={() => {
            setEffectsPanelOpen(false);
            setRenamePanelOpen(true);
            setRenameDraft(planetName);
            setRenameValidation(undefined);
          }}
          title="Rename planet"
          type="button"
        >
          <Pencil aria-hidden="true" size={11} strokeWidth={2} />
        </button>
      ) : null}
      {showAbandonAction ? (
        <button
          aria-label="Abandon planet"
          className="inline-grid h-7 w-7 place-items-center rounded text-red-300/70 transition hover:bg-red-300/10 hover:text-red-200 sm:h-6 sm:w-6"
          onClick={() => onAbandonPlanet?.()}
          title="Abandon planet"
          type="button"
        >
          <Trash2 aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      ) : null}
    </>
  );

  return (
    <div className="grid gap-3">
      {/* When the wallet is disconnected we show a clear connect-wallet card instead of a
          fabricated home planet (VEY-KANEO-458). */}
      {!isWalletConnected ? (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624] p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Home planet</p>
          <h2 className="mt-1 text-base font-semibold text-white">Connect your wallet</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-slate-300">
            Connect your wallet to view your home planet and resources.
          </p>
        </div>
      ) : null}

      {canShowRename && renamePanelOpen ? (
        <div
          className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !renameBusy) setRenamePanelOpen(false);
          }}
        >
          <form
            aria-labelledby="overview-planet-name-editor-title"
            aria-modal="true"
            className="modal-panel-enter grid max-h-[calc(100dvh-1.5rem)] w-full max-w-sm gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 shadow-2xl shadow-black/45"
            id="overview-planet-name-editor"
            onSubmit={handleRenameSubmit}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Planet</p>
                <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-white" id="overview-planet-name-editor-title">
                  Edit name
                </h2>
              </div>
              <button
                aria-label="Cancel planet name edit"
                className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                onClick={() => setRenamePanelOpen(false)}
                title="Cancel"
                type="button"
              >
                <X aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            </div>
            <label className="grid gap-1 text-xs font-medium text-slate-200">
              New planet name
              <input
                className="h-9 rounded border border-white/10 bg-[#050b14]/95 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                maxLength={64}
                onInput={(event) => {
                  setRenameDraft(event.currentTarget.value);
                  setRenameValidation(undefined);
                }}
                placeholder="Enter planet name"
                value={renameDraft}
              />
            </label>
            <p className="text-[11px] leading-4 text-slate-300">
              Renaming this planet is an onchain transaction. Your wallet will ask for confirmation, and ETH gas on Base may be required; Ethereum Mainnet is not used.
            </p>
            {(renameValidation || renameStatusLabel) && (
              <p className={`break-words text-[11px] leading-4 ${renameValidation ? "text-amber-200" : renameStatusTone}`}>
                {renameValidation ?? renameStatusLabel}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                aria-label="Cancel planet name edit"
                className="inline-grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
                disabled={renameBusy}
                onClick={() => setRenamePanelOpen(false)}
                title="Cancel"
                type="button"
              >
                <X aria-hidden="true" size={14} strokeWidth={2} />
              </button>
              <button
                aria-label="Rename planet onchain"
                className="inline-grid h-8 w-8 place-items-center rounded border border-cyan-300/40 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!canRenamePlanet || renameBusy}
                title={renameBusy ? "Confirming" : "Rename onchain"}
                type="submit"
              >
                <Check aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {effectsPanelOpen ? (
        <PlanetEffectsPanel
          effects={planetEffects}
          id="overview-planet-effects"
          onClose={() => setEffectsPanelOpen(false)}
          stats={stats}
        />
      ) : null}

      {isWalletConnected && onChainStatus === "error" && (
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 sm:p-4">
          Planet data is unavailable right now. Please refresh and try again.
          {onChainError ? <span className="block truncate text-amber-200/70">{onChainError}</span> : null}
        </div>
      )}

      {canShowRename && planetRenameAction.status !== "idle" && !renamePanelOpen ? (
        <p className={`truncate text-xs ${renameStatusTone}`} role="status">{planetRenameAction.label}</p>
      ) : null}
      {planetManagementAction.status !== "idle" ? (
        <p className={`truncate text-xs ${managementStatusTone}`} role="status">{planetManagementAction.label}</p>
      ) : null}

      {isWalletConnected && myPlanets.length === 0 && onChainStatus === "loading" ? <OverviewSkeleton /> : null}
      {isWalletConnected && myPlanets.length > 0 ? (
        <EmpireOverview
          account={account}
          backendData={backendData}
          fleetVisibility={fleetVisibility}
          myPlanets={myPlanets}
          now={now}
          onSwitchPlanet={onSwitchPlanet}
          planetNames={fleetPlanetNames}
          renderActions={(group, kind) => kind === "moon" ? (
            <MyPlanetActionButtons actions={group.moonActions ?? []} compact onAction={(action) => onMyPlanetAction?.(action, group.planet)} />
          ) : (
            <MyPlanetActionButtons
              actions={group.actions}
              compact
              onAction={(action) => onMyPlanetAction?.(action, group.planet)}
              onSupply={onSupplyPlanet ? () => onSupplyPlanet(group.planet) : undefined}
            />
          )}
          researchQueue={researchQueue}
          selectedActions={selectedBodyActions}
          selectedBodyKind={selectedBodyKind}
          selectedPlanetId={selectedPlanetId ?? onChainSettlement?.homePlanetId ?? onChainSettlement?.planet?.planetId}
        />
      ) : null}

      {shouldRenderWatchedPlanetsPanel({
        error: watchedPlanetsError,
        isWalletConnected,
        loading: watchedPlanetsLoading,
        planetCount: watchedPlanetRows.length,
      }) ? (
        <WatchedPlanetsPanel
          loading={watchedPlanetsLoading}
          onPageChange={onWatchedPlanetsPageChange}
          onRefresh={onRefreshWatchedPlanets}
          planetActionsForPlanet={watchedPlanetActionsForPlanet}
          moonActionsForPlanet={watchedMoonActionsForPlanet}
          onPlanetAction={onWatchedPlanetAction}
          onMoonAction={onWatchedMoonAction}
          onSelectAlliance={onSelectAlliance}
          onSelectMoon={onSelectMoon}
          onSelectPlanet={onSelectPlanet}
          onSelectPlayer={onSelectPlayer}
          onToggleWatchPlanet={onToggleWatchPlanet}
          page={watchedPlanetsPage}
          pageSize={watchedPlanets?.pagination.pageSize ?? 25}
          planets={watchedPlanetRows}
          total={watchedPlanets?.pagination.total ?? watchedPlanetRows.length}
          totalPages={watchedPlanets?.pagination.totalPages ?? 1}
          watchBusyPlanetId={watchBusyPlanetId}
          watchedPlanetIds={watchedPlanets?.watchedPlanetIds ?? []}
          error={watchedPlanetsError}
        />
      ) : null}

    </div>
  );
}

function MyPlanetActionButtons({
  actions,
  compact = false,
  onAction,
  onSupply,
}: {
  actions: GalaxyAction[];
  compact?: boolean;
  onAction: (action: GalaxyAction) => void;
  onSupply?: (() => void) | undefined;
}) {
  const buttonClassName = compact
    ? "inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-white/[0.06] hover:text-signal sm:h-6 sm:w-6"
    : "inline-flex h-11 w-11 items-center justify-center rounded border border-signal/30 bg-signal/10 text-signal transition hover:bg-signal/20 sm:h-8 sm:w-8";
  const iconSize = compact ? 12 : 15;
  const enabledActions = actions.filter((action) => action.enabled);
  if (enabledActions.length === 0 && !onSupply) return null;

  return (
    <span className={compact ? "flex items-center gap-1" : "flex flex-wrap justify-end gap-1.5"}>
      {enabledActions.map((action) => {
        const Icon = galaxyActionIcon(action.kind);
        return (
          <button
            aria-label={action.label}
            className={buttonClassName}
            key={action.kind}
            onClick={() => onAction(action)}
            title={action.label}
            type="button"
          >
            <Icon aria-hidden="true" size={iconSize} strokeWidth={1.9} />
          </button>
        );
      })}
      {onSupply ? (
        <button
          aria-label="Supply this planet"
          className={buttonClassName}
          onClick={onSupply}
          title="Supply this planet"
          type="button"
        >
          <PackagePlus aria-hidden="true" size={iconSize} strokeWidth={1.9} />
        </button>
      ) : null}
    </span>
  );
}

export function managedPlanetOverviewDisplayName(planet: ManagedPlanetResponse): string {
  return planet.name?.trim() || `Planet ${planet.coordinates}`;
}

function WatchedPlanetsPanel({
  error,
  loading,
  moonActionsForPlanet,
  onPlanetAction,
  onMoonAction,
  onPageChange,
  onRefresh,
  onSelectAlliance,
  onSelectMoon,
  onSelectPlanet,
  onSelectPlayer,
  onToggleWatchPlanet,
  planetActionsForPlanet,
  page,
  pageSize,
  planets,
  total,
  totalPages,
  watchBusyPlanetId,
  watchedPlanetIds,
}: {
  error: string | undefined;
  loading: boolean;
  moonActionsForPlanet: ((planet: Planet) => GalaxyAction[]) | undefined;
  onPlanetAction: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onMoonAction: ((action: GalaxyAction, planet: Planet) => void) | undefined;
  onPageChange: ((page: number) => void) | undefined;
  planetActionsForPlanet: ((planet: Planet) => GalaxyAction[]) | undefined;
  onRefresh: (() => void) | undefined;
  onSelectAlliance: ((allianceId: string) => void) | undefined;
  onSelectMoon: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlanet: ((coords: { galaxy: number; system: number; position: number }) => void) | undefined;
  onSelectPlayer: ((wallet: string) => void) | undefined;
  onToggleWatchPlanet: ((planetId: string, watched: boolean) => void) | undefined;
  page: number;
  pageSize: number;
  planets: Planet[];
  total: number;
  totalPages: number;
  watchBusyPlanetId: string | undefined;
  watchedPlanetIds: readonly string[];
}) {
  const { start, end } = watchedPlanetsPanelRange({ page, pageSize, total });

  return (
    <section aria-label="Watched planets" className="mt-4 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-2 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white">Watched planets</h2>
          {loading && total === 0 ? (
            <SkeletonRegion label="Loading watched planets"><Skeleton className="mt-1 h-3 w-24" /></SkeletonRegion>
          ) : <p className="text-xs text-slate-500">{total > 0 ? `${start}-${end} of ${total}` : "No watched planets"}</p>}
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <button
              className="h-10 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600 sm:h-8"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange?.(Math.max(1, page - 1))}
              type="button"
            >
              Prev
            </button>
            <span className="min-w-16 text-center text-xs text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              className="h-10 rounded border border-white/15 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600 sm:h-8"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange?.(Math.min(totalPages, page + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          <span>{error}</span>
          {onRefresh ? (
            <button
              className="inline-flex h-10 items-center gap-1.5 rounded border border-amber-200/30 bg-amber-200/10 px-2 font-semibold text-amber-50 transition hover:bg-amber-200/20 disabled:cursor-not-allowed disabled:opacity-60 sm:h-8"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {loading && planets.length === 0 ? <GalaxyRowsSkeleton rows={3} /> : null}

      <ul className="-mt-2 divide-y divide-white/[0.06] border-b border-white/[0.06]">
        {planets.map((planet) => {
          const planetId = planet.occupiedBy?.planetId;
          const coords = { galaxy: planet.galaxy, system: planet.system, position: planet.position };
          const watched = Boolean(planetId && watchedPlanetIds.includes(planetId));
          return (
            <li key={planetId ?? planet.id}>
              <WatchedBodyRow
                actions={<MyPlanetActionButtons actions={planetActionsForPlanet?.(planet) ?? []} compact onAction={(action) => onPlanetAction?.(action, planet)} />}
                image={planet.image}
                meta={watchedPlanetMeta(planet).map((item) => item.label).join(" · ")}
                name={planet.name}
                onSelect={onSelectPlanet ? () => onSelectPlanet(coords) : undefined}
                trailing={
                  <span className="flex min-w-0 items-center justify-end gap-2 text-right text-[11px]">
                    {planet.debrisField ? (
                      <span className="shrink-0 rounded bg-amber-300/10 px-1.5 py-0.5 text-amber-200" title="Debris field">
                        {formatCompactResource(planet.debrisField.metal)} M / {formatCompactResource(planet.debrisField.crystal)} C
                      </span>
                    ) : null}
                    <span className="grid min-w-0">
                      <button
                        className="truncate text-slate-300 hover:text-cyan-200 disabled:cursor-default disabled:hover:text-slate-300"
                        disabled={!onSelectPlayer || !planet.occupiedBy?.owner}
                        onClick={() => planet.occupiedBy?.owner && onSelectPlayer?.(planet.occupiedBy.owner)}
                        type="button"
                      >
                        {formatGalaxyCommanderLabel(planet)}
                      </button>
                      {planet.alliance ? (
                        <button
                          className="truncate text-[10px] text-cyan-300/80 hover:text-cyan-200"
                          onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
                          type="button"
                        >
                          {formatGalaxyAllianceIdentityLabel(planet.alliance)}
                        </button>
                      ) : null}
                    </span>
                    {planetId ? (
                      <button
                        aria-label={watched ? "Unwatch planet" : "Watch planet"}
                        aria-pressed={watched}
                        className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded transition hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60 sm:h-6 sm:w-6 ${watched ? "text-cyan-200" : "text-slate-500"}`}
                        disabled={watchBusyPlanetId === planetId}
                        onClick={() => onToggleWatchPlanet?.(planetId, watched)}
                        title={watched ? "Unwatch planet" : "Watch planet"}
                        type="button"
                      >
                        {watched ? <Eye aria-hidden="true" size={12} /> : <EyeOff aria-hidden="true" size={12} />}
                      </button>
                    ) : null}
                  </span>
                }
              />
              {planet.hasMoon ? (
                <div className="border-t border-white/[0.04] pl-6">
                  <WatchedBodyRow
                    actions={<MyPlanetActionButtons actions={moonActionsForPlanet?.(planet) ?? []} compact onAction={(action) => onMoonAction?.(action, planet)} />}
                    image={moonImageForType(planet.type)}
                    meta={`${planet.galaxy}:${planet.system}:${planet.position}`}
                    moon
                    name="Moon"
                    onSelect={onSelectMoon ? () => onSelectMoon(coords) : undefined}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WatchedBodyRow({
  actions,
  image,
  meta,
  moon = false,
  name,
  onSelect,
  trailing,
}: {
  actions?: preact.ComponentChildren;
  image: string;
  meta: string;
  moon?: boolean;
  name: string;
  onSelect: (() => void) | undefined;
  trailing?: preact.ComponentChildren;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 px-2 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className={`shrink-0 overflow-hidden rounded-full bg-white/5 ${moon ? "h-6 w-6" : "h-8 w-8"}`}>
        <img alt="" className="h-full w-full object-cover" loading="lazy" src={getSizedImageSrc(image, 64)} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <button
            className={`truncate font-semibold transition hover:text-cyan-200 disabled:cursor-default ${moon ? "text-xs text-slate-300" : "text-[13px] text-white"}`}
            disabled={!onSelect}
            onClick={onSelect}
            title={`Open ${name}`}
            type="button"
          >
            {name}
          </button>
          {actions}
        </span>
        <span className="block truncate font-mono text-[10px] text-slate-500">{meta}</span>
      </span>
      {trailing ? <span className="col-start-2 min-w-0 sm:col-start-auto">{trailing}</span> : null}
    </div>
  );
}

function watchedPlanetMeta(planet: Planet): PlanetMetaItem[] {
  const meta: PlanetMetaItem[] = [
    { label: `${planet.galaxy}:${planet.system}:${planet.position}` },
    { label: formatGalaxyHeatLabel(planet.temperature) },
    { label: `${planet.fields} fields` },
  ];
  if (planet.hasMoon) meta.push({ label: "Moon" });
  if (planet.debrisField) {
    meta.push({
      label: `${formatCompactResource(planet.debrisField.metal)} M / ${formatCompactResource(planet.debrisField.crystal)} C`,
      tone: "warning",
    });
  }
  return meta;
}

export function shouldRenderWatchedPlanetsPanel({
  error,
  isWalletConnected,
  loading,
  planetCount,
}: {
  error?: string | undefined;
  isWalletConnected: boolean;
  loading: boolean;
  planetCount: number;
}): boolean {
  return Boolean(isWalletConnected && (planetCount > 0 || loading || error));
}

// Research completions settle automatically on-chain (lazy reconcile), so there is no manual
// "complete" control. This predicate is still used to derive backend-state availability messaging.

export function overviewPlanetDisplayName(
  homePlanet: Planet | undefined,
  planet: PlanetSummary | undefined,
): string | undefined {
  const name = homePlanet?.name.trim();
  if (name) return name;

  const coordinates = homePlanet
    ? `${homePlanet.galaxy}:${homePlanet.system}:${homePlanet.position}`
    : planet?.coordinates?.trim();
  return coordinates ? `Planet ${coordinates}` : undefined;
}

export type FleetSummaryLine = {
  direction: "incoming" | "outgoing" | "returning";
  endpointLabel: string;
  eventAt: number | undefined;
  isAttack: boolean;
  key: string;
  missionType: string;
  text: string;
  relation: "friendly" | "hostile" | "self";
  routeLabel: string;
  state: string;
  timingLabel: string;
  timingValue: string;
  tone: "harvest" | "hostile" | "neutral";
};

export type FleetsSummaryData = {
  activeCount: number;
  attackLines: FleetSummaryLine[];
  hiddenCount: number;
  hiddenLines: FleetSummaryLine[];
  lines: FleetSummaryLine[];
  nonAttackLines: FleetSummaryLine[];
  visibleLines: FleetSummaryLine[];
};

export const OVERVIEW_NON_ATTACK_LIMIT = 4;

function missionEndpointLabel(
  ref: FleetMissionPlanetReference | null | undefined,
  fallbackPlanetId: string,
  planetNames?: ReadonlyMap<string, string>,
): string {
  if (ref) {
    const name = ref.name?.trim()
      || planetNames?.get(`id:${ref.planetId}`)
      || planetNames?.get(`coords:${ref.coordinates}`);
    const commander = ref.ownerDisplayName?.trim();
    const label = name && name.length > 0
      ? name
      : commander ? `${commander}'s planet` : "Planet";
    return `${label} [${ref.coordinates}]`;
  }
  const knownName = planetNames?.get(`id:${fallbackPlanetId}`);
  if (knownName) return knownName;
  const colonyTarget = decodeColonizationTargetId(fallbackPlanetId);
  if (colonyTarget) return `Uncharted [${colonyTarget.coordinates}]`;
  return `Planet #${fallbackPlanetId}`;
}

export function summarizeFleets(
  fleetVisibility: FleetMissionVisibilityResponse,
  now: number,
  planetNames?: ReadonlyMap<string, string>,
): FleetsSummaryData {
  const { incoming, outgoing, returning } = fleetVisibility;
  const lines: FleetSummaryLine[] = [];
  const seen = new Set<string>();
  const wallet = fleetVisibility.wallet.trim().toLowerCase();

  for (const mission of incoming) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const isReturning = mission.status === "Returning" || mission.status === "Recalled";
    const eventMs = timestampToMs(isReturning ? mission.returnAt : mission.arrivalAt);
    const self = mission.owner.trim().toLowerCase() === wallet;
    const hostile = !self && isOffensiveFleetMission(mission.missionType);
    const relation = self ? "self" : hostile ? "hostile" : "friendly";
    const endpoint = missionEndpointLabel(mission.originPlanet, mission.originPlanetId, planetNames);
    const state = overviewMissionStatus(mission);
    const timingLabel = isReturning ? "Lands" : "ETA";
    const timingValue = overviewMissionTimingValue(eventMs, now);
    const directionLabel = isReturning ? "Returning to" : "Inbound from";
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: isReturning ? "returning" : "incoming",
      endpointLabel: endpoint,
      eventAt: eventMs,
      isAttack,
      key: `in-${mission.missionId}`,
      missionType: mission.missionType,
      relation,
      routeLabel: directionLabel,
      state,
      text: `${missionTypeLabel(mission.missionType)} · ${directionLabel} ${endpoint} · ${state} · ${timingLabel} ${timingValue}`,
      timingLabel,
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  for (const mission of outgoing) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const arrivalMs = timestampToMs(mission.arrivalAt);
    const defenseHoldUntilMs = mission.missionType === "DefenseHold"
      ? timestampToMs(mission.defenseHoldUntil ?? mission.returnAt)
      : undefined;
    const isHolding = mission.missionType === "DefenseHold"
      && mission.asOfNow?.arrived === true
      && mission.asOfNow.returned !== true;
    const eventMs = isHolding ? defenseHoldUntilMs : arrivalMs;
    const state = overviewMissionStatus(mission);
    const timingLabel = isHolding ? "Ends" : "ETA";
    const timingValue = overviewMissionTimingValue(eventMs, now);
    const endpoint = missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId, planetNames);
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: "outgoing",
      endpointLabel: endpoint,
      eventAt: eventMs,
      isAttack,
      relation: "self",
      key: `out-${mission.missionId}`,
      missionType: mission.missionType,
      routeLabel: "Outbound to",
      state,
      text: `${missionTypeLabel(mission.missionType)} · Outbound to ${endpoint} · ${state} · ${timingLabel} ${timingValue}`,
      timingLabel,
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  for (const mission of returning) {
    if (seen.has(mission.missionId)) continue;
    seen.add(mission.missionId);
    const returnMs = timestampToMs(mission.returnAt);
    const state = overviewMissionStatus(mission);
    const timingValue = overviewMissionTimingValue(returnMs, now);
    const endpoint = missionEndpointLabel(mission.targetPlanet, mission.targetPlanetId, planetNames);
    const isAttack = isOffensiveFleetMission(mission.missionType);
    lines.push({
      direction: "returning",
      endpointLabel: endpoint,
      eventAt: returnMs,
      isAttack,
      relation: "self",
      key: `ret-${mission.missionId}`,
      missionType: mission.missionType,
      routeLabel: "Returning from",
      state,
      text: `${missionTypeLabel(mission.missionType)} · Returning from ${endpoint} · ${state} · Lands ${timingValue}`,
      timingLabel: "Lands",
      timingValue,
      tone: mission.missionType === "Harvest" ? "harvest" : isAttack ? "hostile" : "neutral",
    });
  }

  const attackLines = lines.filter((line) => line.isAttack).sort(compareOverviewFleetLines);
  const nonAttackLines = lines.filter((line) => !line.isAttack).sort(compareOverviewFleetLines);
  const visibleNonAttackLines = nonAttackLines.slice(0, OVERVIEW_NON_ATTACK_LIMIT);
  const hiddenLines = nonAttackLines.slice(OVERVIEW_NON_ATTACK_LIMIT);
  return {
    activeCount: lines.length,
    attackLines,
    hiddenCount: hiddenLines.length,
    hiddenLines,
    lines: [...attackLines, ...nonAttackLines],
    nonAttackLines,
    visibleLines: [...attackLines, ...visibleNonAttackLines],
  };
}

const OFFENSIVE_FLEET_MISSIONS = new Set(["Attack", "AcsAttack", "MissileAttack"]);

function isOffensiveFleetMission(missionType: string): boolean {
  return OFFENSIVE_FLEET_MISSIONS.has(missionType);
}

function overviewMissionStatus(
  mission: FleetMissionVisibilityResponse["outgoing"][number],
): string {
  const proof = proofBattlePresentation(mission);
  if (proof) return proof.label;
  if (mission.resolutionBlocker === "randomness_pending") return "Battle pending";
  if (mission.combatResolutionProgress) return combatProgressLabel(mission.combatResolutionProgress);
  if (mission.needsResolution === true) return "Updating mission";
  if (isMissionQueued(mission)) return "Queued";
  if (
    mission.missionType === "DefenseHold"
    && mission.status === "Outbound"
    && mission.asOfNow?.arrived === true
    && mission.asOfNow.returned !== true
  ) {
    return "Stationed";
  }
  if ((mission.status === "Returning" || mission.status === "Recalled") && mission.asOfNow?.returned === true
    && mission.resolutionEligible === true) {
    return "Updating mission";
  }
  return mission.status;
}

function overviewMissionTimingValue(eventMs: number | undefined, now: number): string {
  if (eventMs === undefined) return "Unknown";
  if (eventMs <= now) return "Now";
  return formatDurationUntil(eventMs, now);
}

function compareOverviewFleetLines(left: FleetSummaryLine, right: FleetSummaryLine): number {
  const leftEvent = left.eventAt ?? Number.POSITIVE_INFINITY;
  const rightEvent = right.eventAt ?? Number.POSITIVE_INFINITY;
  return leftEvent - rightEvent || left.key.localeCompare(right.key);
}

export function FleetSummaryRow({ line }: { line: FleetSummaryLine }) {
  return (
    <li
      aria-label={line.text}
      className={`grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] leading-4 ${
        line.tone === "hostile"
          ? "border-red-400/35 bg-red-500/[0.11] text-red-50"
          : line.tone === "harvest"
            ? "border-amber-300/25 bg-amber-300/[0.08] text-amber-50"
            : line.relation === "friendly"
              ? "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-50"
              : "border-white/10 bg-black/20 text-slate-200"
      }`}
      data-attack-priority={line.isAttack ? "true" : undefined}
      data-direction={line.direction}
      title={line.text}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${overviewMissionTypeTone(line)}`}>
        <OverviewMissionTypeIcon missionType={line.missionType} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-current">{missionTypeLabel(line.missionType)}</span>
          {line.isAttack ? <span className="shrink-0 rounded bg-red-400/15 px-1 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-red-200">Priority</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400">
          <OverviewMissionDirectionIcon direction={line.direction} />
          <span className="shrink-0">{line.routeLabel}</span>
          <span className="truncate" title={line.endpointLabel}>{line.endpointLabel}</span>
        </span>
      </span>
      <span className="ml-auto flex min-w-0 flex-col items-end text-right tabular-nums">
        <span className={`max-w-[5.75rem] truncate text-[10px] font-medium ${line.isAttack ? "text-red-200" : "text-slate-300"}`} title={line.state}>{line.state}</span>
        <span className="whitespace-nowrap text-[10px] text-slate-500"><span className="hidden sm:inline">{line.timingLabel} </span>{line.timingValue}</span>
      </span>
    </li>
  );
}

function OverviewMissionTypeIcon({ missionType }: { missionType: string }) {
  const props = { "aria-hidden": true, size: 14, strokeWidth: 2 } as const;
  if (isOffensiveFleetMission(missionType)) return <Swords {...props} />;
  if (missionType === "Transport") return <Package {...props} />;
  if (missionType === "Deploy") return <Rocket {...props} />;
  if (missionType === "Harvest") return <RefreshCw {...props} />;
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(missionType)) return <Shield {...props} />;
  return <Satellite {...props} />;
}

function OverviewMissionDirectionIcon({ direction }: { direction: FleetSummaryLine["direction"] }) {
  const props = { "aria-hidden": true, className: "shrink-0", size: 11, strokeWidth: 2 } as const;
  if (direction === "incoming") return <ArrowDownLeft {...props} />;
  if (direction === "outgoing") return <ArrowUpRight {...props} />;
  return <RotateCcw {...props} />;
}

function overviewMissionTypeTone(line: FleetSummaryLine): string {
  if (line.isAttack) return "border-red-300/30 bg-red-400/15 text-red-100";
  if (line.missionType === "Transport") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
  if (line.missionType === "Deploy") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (line.missionType === "Harvest") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (["AcsDefend", "DefenseHold", "Intercept"].includes(line.missionType)) return "border-violet-300/25 bg-violet-300/10 text-violet-100";
  return "border-slate-300/20 bg-slate-300/10 text-slate-100";
}

function PlanetEffectsPanel({
  effects,
  id,
  onClose,
  stats,
}: {
  effects: OverviewPlanetEffectsDisplay;
  id: string;
  onClose: () => void;
  stats: ReturnType<typeof displayPlanetStats>;
}) {
  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 backdrop-blur-sm sm:place-items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="modal-panel-enter grid max-h-[calc(100dvh-1.5rem)] w-full max-w-lg gap-3 overflow-y-auto rounded-lg border border-white/10 bg-[#08101d] p-3 text-xs leading-5 text-slate-200 shadow-2xl shadow-black/45"
        id={id}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Planet</p>
            <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-white" id={`${id}-title`}>
              Stats and effects
            </h2>
          </div>
          <button
            aria-label="Close planet effects"
            className="inline-grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>

        <p className="text-slate-300">
          Fields are the planet development budget: each building level consumes one field, and Terraformer expands the limit.
        </p>
        <p className="text-slate-400">
          Temperature changes deuterium production and Solar Satellite energy output, so colder and hotter planets favor different builds.
        </p>

        <dl className="grid gap-2 sm:grid-cols-3">
          <EffectMetric label="Fields" value={stats.fields} />
          <EffectMetric label="Temperature" value={stats.temperature} />
          <EffectMetric label="Diameter" value={stats.diameter} />
          <EffectMetric label="Terraformer" value={effects.terraformer} />
          <EffectMetric label="Deuterium multiplier" value={effects.deuteriumMultiplier} />
          <EffectMetric
            label="Solar Satellite"
            nowrap
            value={effects.solarSatelliteEnergy === undefined ? "Unavailable" : `${effects.solarSatelliteEnergy.toLocaleString()} E each`}
          />
        </dl>
      </section>
    </div>
  );
}

function EffectMetric({ label, value, nowrap = false }: { label: string; value: string; nowrap?: boolean }) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-xs font-semibold text-slate-100 ${nowrap ? "truncate whitespace-nowrap" : "break-words"}`} title={nowrap ? value : undefined}>
        {value === "Loading" ? <SkeletonRegion label={`Loading ${label.toLowerCase()}`}><Skeleton className="h-4 w-20" /></SkeletonRegion> : value}
      </dd>
    </div>
  );
}
