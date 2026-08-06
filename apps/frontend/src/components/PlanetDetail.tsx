import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Database,
  FlaskConical,
  Globe2,
  Hash,
  MapPin,
  Orbit,
  Rocket,
  Shield,
  Thermometer,
  Trophy,
  UserRound,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Planet, Coordinates, PublicPlanetState, PublicQueueState } from "../types";
import { formatPlanetType, planetsFromSystemResponse, type ApiSystemResponse } from "../data/mockUniverse";
import { galaxyActionsForSlot, type GalaxyAction } from "../galaxyActions";
import { playableApiUrl } from "../runtimeConfig";
import {
  shortAddress,
  type ChainDefenseState,
  type ChainShipyardState,
  type Eip1193Provider,
  type FleetMissionSummary,
  type GlobalActiveMissionsResponse,
} from "../walletFlow";
import { isImageReady } from "../imageLoadState";
import { formatScore } from "../attackProtectionLabels";
import { buildingCatalog, defenseCatalog, researchCatalog, shipCatalog, solarSatelliteEnergy } from "../playableMvp";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { GalaxyActionButtons, type AttackProtectionStatus, type GalaxyActionState, formatAttackBlockReason } from "./GalaxyView";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { MoonImage, PlanetMoonIndicator } from "./PlanetMoonIndicator";
import { EntityMediaPanel } from "./EntityMediaPanel";
import { canEditEntityMedia } from "../entityMedia";
import { PlanetDetailSkeleton } from "./LoadingSkeletons";
import { QueueProgressPanel, type QueueProgressTone } from "./QueueProgressPanel";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";
import { missionTypeLabel } from "./MissionControlPage";
import { buildInspectPath } from "../inspectRoutes";
import { backendDataStoreFor } from "../backendDataStore";

interface Props {
  account?: string | undefined;
  actionState?: GalaxyActionState | undefined;
  coords: Coordinates;
  apiBaseUrl?: string | undefined;
  defenseState?: ChainDefenseState | null | undefined;
  homeCoords?: Coordinates | undefined;
  homePlanetId?: string | null | undefined;
  homePlanet?: Planet | undefined;
  onAction?: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  onBack: () => void;
  onSelectMoon?: ((coords: Coordinates) => void) | undefined;
  provider?: Eip1193Provider | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
  transactionUnavailableReason?: string | undefined;
}

export type PlanetRecordRow = {
  label: string;
  value: string;
  tone?: "default" | "accent" | "muted";
};

export function planetDetailRefreshStartPlanet({
  coords,
  currentPlanet,
  trustedHomePlanet,
}: {
  coords: Coordinates;
  currentPlanet: Planet | null;
  trustedHomePlanet: Planet | null;
}): Planet | null {
  const matchingTrustedPlanet = trustedHomePlanet && sameCoordinates(trustedHomePlanet, coords)
    ? trustedHomePlanet
    : null;
  return matchingTrustedPlanet ?? (currentPlanet && sameCoordinates(currentPlanet, coords) ? currentPlanet : null);
}

export function planetDetailRefreshResultPlanet({
  apiPlanet,
  coords,
  currentPlanet,
  trustedHomePlanet,
}: {
  apiPlanet: Planet | null;
  coords: Coordinates;
  currentPlanet: Planet | null;
  trustedHomePlanet: Planet | null;
}): Planet | null {
  const matchingTrustedPlanet = trustedHomePlanet && sameCoordinates(trustedHomePlanet, coords)
    ? trustedHomePlanet
    : null;
  const matchingApiPlanet = apiPlanet && sameCoordinates(apiPlanet, coords) ? apiPlanet : null;
  if (matchingTrustedPlanet && matchingApiPlanet) {
    const moonName = matchingTrustedPlanet.moonName ?? matchingApiPlanet.moonName;
    const publicMoonState = matchingApiPlanet.publicMoonState ?? matchingTrustedPlanet.publicMoonState;
    const publicState = matchingApiPlanet.publicState ?? matchingTrustedPlanet.publicState;
    return {
      ...matchingApiPlanet,
      ...matchingTrustedPlanet,
      alliance: matchingTrustedPlanet.alliance ?? matchingApiPlanet.alliance,
      debrisField: matchingApiPlanet.debrisField,
      hasMoon: matchingTrustedPlanet.hasMoon || matchingApiPlanet.hasMoon,
      moonChance: matchingApiPlanet.moonChance,
      occupiedBy: matchingTrustedPlanet.occupiedBy
        ? { ...matchingApiPlanet.occupiedBy, ...matchingTrustedPlanet.occupiedBy }
        : matchingApiPlanet.occupiedBy,
      ...(moonName !== undefined ? { moonName } : {}),
      ...(publicMoonState !== undefined ? { publicMoonState } : {}),
      ...(publicState !== undefined ? { publicState } : {}),
    };
  }
  return matchingTrustedPlanet ?? matchingApiPlanet ?? (currentPlanet && sameCoordinates(currentPlanet, coords) ? currentPlanet : null);
}

export function planetDetailRequestKey(coords: Coordinates): string {
  return `${coords.galaxy}:${coords.system}:${coords.position}`;
}

export function canApplyPlanetDetailResponse(
  requestKey: string,
  currentCoords: Coordinates,
  aborted = false,
): boolean {
  return !aborted && requestKey === planetDetailRequestKey(currentCoords);
}

export function planetDetailVisiblePlanet(
  loadedPlanet: Planet | null,
  coords: Coordinates,
  trustedPlanet: Planet | null = null,
): Planet | null {
  const matchingLoadedPlanet = loadedPlanet && sameCoordinates(loadedPlanet, coords) ? loadedPlanet : null;
  const matchingTrustedPlanet = trustedPlanet && sameCoordinates(trustedPlanet, coords) ? trustedPlanet : null;
  return matchingLoadedPlanet ?? matchingTrustedPlanet;
}

export function PlanetDetail({
  account,
  actionState = { status: "idle" },
  coords,
  apiBaseUrl = playableApiUrl,
  defenseState = null,
  homeCoords,
  homePlanetId,
  homePlanet,
  onAction,
  onBack,
  onSelectMoon,
  provider,
  shipyardState = null,
  transactionUnavailableReason,
}: Props) {
  const trustedHomePlanet = useMemo(
    () => sameCoordinates(homeCoords, coords) && homePlanet
      ? homePlanet
      : null,
    [coords.galaxy, coords.position, coords.system, homeCoords?.galaxy, homeCoords?.position, homeCoords?.system, homePlanet],
  );
  const [loadedPlanet, setPlanet] = useState<Planet | null>(trustedHomePlanet);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");
  const [attackProtection, setAttackProtection] = useState<AttackProtectionStatus | null>(null);
  const [activeMissions, setActiveMissions] = useState<FleetMissionSummary[] | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentRequestKey = useRef(planetDetailRequestKey(coords));
  currentRequestKey.current = planetDetailRequestKey(coords);
  const planet = planetDetailVisiblePlanet(loadedPlanet, coords, trustedHomePlanet);
  const isHome = planet ? sameCoordinates(homeCoords, planet) : false;

  useEffect(() => {
    let cancelled = false;
    const requestKey = planetDetailRequestKey(coords);
    setPlanet((current) => planetDetailRefreshStartPlanet({
      coords,
      currentPlanet: current,
      trustedHomePlanet,
    }));
    setSource("loading");

    backendDataStoreFor(apiBaseUrl).system<ApiSystemResponse>(coords.galaxy, coords.system, { detail: "full" })
      .then((payload) => {
        if (!canApplyPlanetDetailResponse(requestKey, coords, cancelled)
          || currentRequestKey.current !== requestKey) return;
        const apiPlanet = planetsFromSystemResponse(payload).find((item) => item.position === coords.position) ?? null;
        setPlanet((current) => planetDetailRefreshResultPlanet({
          apiPlanet,
          coords,
          currentPlanet: current,
          trustedHomePlanet,
        }));
        setSource("api");
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setSource("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    coords.galaxy,
    coords.position,
    coords.system,
    trustedHomePlanet,
  ]);

  useEffect(() => {
    const targetPlanetId = planet?.occupiedBy?.planetId;
    if (!account || !targetPlanetId || isHome) {
      setAttackProtection(null);
      return;
    }

    let cancelled = false;
    backendDataStoreFor(apiBaseUrl).attackProtection(account, targetPlanetId)
      .then((status) => {
        if (!cancelled) setAttackProtection(status);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setAttackProtection(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account, apiBaseUrl, isHome, planet?.occupiedBy?.planetId]);

  useEffect(() => {
    const planetId = planet?.occupiedBy?.planetId;
    if (!planetId) {
      setActiveMissions([]);
      return;
    }

    let cancelled = false;
    setActiveMissions(null);
    backendDataStoreFor(apiBaseUrl).globalActiveMissions()
      .then((payload) => {
        if (cancelled) return;
        setActiveMissions(payload.missions.filter((mission) => (
          mission.originPlanetId === planetId || mission.targetPlanetId === planetId
        )));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setActiveMissions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, planet?.occupiedBy?.planetId]);

  useEffect(() => {
    setImageLoaded(isImageReady(imageRef.current));
  }, [planet?.image]);

  if (!planet) {
    if (shouldShowPlanetDetailInitialLoader({ planet, source })) {
      return (
        <div>
          <button
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:border-cyan-200/30 hover:text-cyan-100"
            type="button"
          >
            <MapPin aria-hidden="true" className="text-cyan-200/75" size={14} />
            [{coords.galaxy}:{coords.system}:{coords.position}]
          </button>
          <PlanetDetailSkeleton />
        </div>
      );
    }

    const emptyMissionActions = source === "api" && !transactionUnavailableReason
      ? planetDetailGalaxyActions({
        account,
        attackProtection: null,
        coords,
        defenseState,
        homeCoords,
        homePlanetId,
        planet: undefined,
        shipyardState,
      }).filter((action) => action.enabled)
      : [];

    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-slate-400">
          {source === "error" ? "Planet data could not be loaded." : "No planet at this position."}
        </p>
        {emptyMissionActions.length > 0 ? (
          <div className="flex w-full max-w-xl flex-col items-center gap-3">
            <PlanetMissionControls
              actions={emptyMissionActions}
              busy={actionState.status === "pending"}
              coords={coords}
              onAction={onAction}
              planet={undefined}
            />
            <PlanetActionStatus actionState={actionState} />
          </div>
        ) : null}
        <button onClick={onBack} className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:border-cyan-200/30 hover:text-cyan-100" type="button">
          <MapPin aria-hidden="true" className="text-cyan-200/75" size={14} />
          [{coords.galaxy}:{coords.system}:{coords.position}]
        </button>
      </div>
    );
  }

  const missionActions = planetDetailGalaxyActions({
    account,
    attackProtection,
    coords,
    defenseState,
    homeCoords,
    homePlanetId,
    planet,
    shipyardState,
  }).filter((action) => action.enabled);
  const visibleMissionActions = onAction && !transactionUnavailableReason ? missionActions : [];
  const attackBlockLabel = formatAttackBlockReason(attackProtection ?? undefined);
  const targetScoreText = attackProtection?.scoreComparison?.defenderScore
    ? formatScore(attackProtection.scoreComparison.defenderScore)
    : null;

  const planetCoords = `[${planet.galaxy}:${planet.system}:${planet.position}]`;
  const planetStatusRows = publicPlanetStatusRows(planet);
  const settled = isPublicPlanetSettled(planet);
  const commanderLabel = planet.occupiedBy?.ownerDisplayName
    ?? (planet.occupiedBy?.owner ? shortAddress(planet.occupiedBy.owner) : null);
  const planetIdLabel = planet.occupiedBy?.planetId ?? (isHome ? homePlanetId : null);
  const publicStateLoading = source === "loading";

  return (
    <div className="celestial-detail planet-detail-page flex min-w-0 flex-col gap-3" data-celestial-detail="planet">
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0b111e] shadow-lg shadow-black/15">
        <div className="celestial-detail-layout" data-celestial-layout>
          <div className="celestial-detail-artwork relative flex items-center justify-center p-3 sm:p-4 lg:p-5" data-celestial-artwork>
            <div className="relative aspect-square w-full max-w-44 sm:max-w-[13rem] lg:max-w-[17rem]">
              <div className="relative h-full overflow-hidden rounded-full border border-cyan-100/20 bg-black/40 shadow-[0_0_70px_rgba(128,241,255,0.13)]" data-celestial-media>
                {!imageLoaded && <PlanetImageSkeleton className="absolute inset-0" />}
                <OptimizedImage
                  key={planet.image}
                  alt={planet.name}
                  className={`h-full w-full object-contain transition-opacity duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                  imageRef={imageRef}
                  loading="eager"
                  onLoad={(event) => {
                    if (isImageReady(event.currentTarget)) setImageLoaded(true);
                  }}
                  sizes="planetPreview"
                  src={planet.image}
                />
                <div className="absolute inset-0 rounded-full shadow-[inset_30px_-24px_54px_rgba(0,0,0,0.55)]" />
              </div>
              {planet.hasMoon ? (
                <PlanetMoonIndicator
                  className="right-[2%] top-[7%] shadow-xl shadow-black/40 sm:!h-11 sm:!w-11 lg:!h-12 lg:!w-12"
                  label={`Open ${planet.moonName ?? "Moon"}`}
                  onClick={onSelectMoon ? () => onSelectMoon({ galaxy: planet.galaxy, system: planet.system, position: planet.position }) : undefined}
                  planetType={planet.type}
                  title={`Open ${planet.moonName ?? "Moon"} at ${planetCoords}`}
                />
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-center p-3 sm:p-4 lg:p-5" data-celestial-summary>
            {isHome || !settled || source === "loading" ? (
              <div className="flex flex-wrap items-center gap-2">
                {isHome ? (
                  <span className="inline-flex h-7 items-center rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 pt-px text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-emerald-100">Home world</span>
                ) : null}
                {!settled ? (
                  <span className="inline-flex h-7 items-center rounded-full border border-slate-300/20 bg-slate-300/[0.07] px-2.5 pt-px text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-slate-300">Unsettled</span>
                ) : null}
                {source === "loading" ? (
                  <SkeletonRegion label="Loading planet data">
                    <Skeleton className="h-7 w-20 rounded-full border border-white/10" />
                  </SkeletonRegion>
                ) : null}
              </div>
            ) : null}

            <div className={`${isHome || !settled || source === "loading" ? "mt-3" : ""} flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2`}>
              <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">{planet.name}</h2>
              {visibleMissionActions.length > 0 ? (
                <PlanetMissionControls
                  actions={visibleMissionActions}
                  busy={actionState.status === "pending"}
                  coords={{ galaxy: planet.galaxy, system: planet.system, position: planet.position }}
                  onAction={onAction}
                  planet={planet}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
              <PlanetFact icon={<MapPin aria-hidden="true" size={14} />} label="Open system" onClick={onBack} value={planetCoords} mono />
              <PlanetFact icon={<Globe2 aria-hidden="true" size={14} />} label="Planet type" value={formatPlanetType(planet.type)} />
              <PlanetFact icon={<Orbit aria-hidden="true" size={14} />} label="Diameter" value={`${planet.diameter.toLocaleString()} km`} />
              <PlanetFact icon={<Database aria-hidden="true" size={14} />} label="Fields" value={planet.fields.toLocaleString()} />
              <PlanetFact icon={<Thermometer aria-hidden="true" size={14} />} label="Climate" value={`${planet.temperature.min}° to ${planet.temperature.max}°C`} />
              {commanderLabel ? <PlanetFact icon={<UserRound aria-hidden="true" size={14} />} label="Commander" value={commanderLabel} /> : null}
              {planetIdLabel ? <PlanetFact icon={<Hash aria-hidden="true" size={14} />} label="Planet ID" value={planetIdLabel} mono /> : null}
              {targetScoreText ? <PlanetFact icon={<Trophy aria-hidden="true" size={14} />} label="Score" value={targetScoreText} mono /> : null}
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <PlanetEconomyPills
                loading={publicStateLoading && planet.publicState?.resources == null}
                rows={planetEconomyPillRows(planet)}
              />
            </div>

            {attackBlockLabel ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded border border-rose-300/20 bg-rose-300/10 px-2.5 py-1.5 text-rose-100">{attackBlockLabel}</span>
              </div>
            ) : null}

            {actionState.status !== "idle" || transactionUnavailableReason ? (
              <div className="mt-3 flex flex-col gap-2 sm:mt-4">
              <PlanetActionStatus actionState={actionState} />
              {transactionUnavailableReason ? (
                <div className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{transactionUnavailableReason}</div>
              ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {planet.hasMoon ? (
        <button
          className="group flex items-center gap-3 rounded-lg border border-white/10 bg-[#101624] p-2 text-left transition hover:border-cyan-200/35 disabled:cursor-default"
          disabled={!onSelectMoon}
          onClick={() => onSelectMoon?.({ galaxy: planet.galaxy, system: planet.system, position: planet.position })}
          title={`Open ${planet.moonName ?? "Moon"} at ${planetCoords}`}
          type="button"
        >
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-cyan-100/30 bg-black/40">
            <MoonImage className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" planetType={planet.type} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-cyan-50">{planet.moonName ?? "Moon"}</span>
            <span className="mt-0.5 block font-mono text-[11px] text-slate-500">{planetCoords}</span>
          </span>
          <span aria-hidden="true" className="pr-1 text-cyan-200/60 transition-transform group-hover:translate-x-1">→</span>
        </button>
      ) : null}

      {planetStatusRows.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
          <SectionHeading icon={<Orbit aria-hidden="true" size={16} />} title="Planet status" />
          <div className="grid gap-px bg-white/10 sm:grid-cols-2">
            {planetStatusRows.map((row) => <TelemetryCard key={row.label} row={row} />)}
          </div>
        </section>
      ) : null}

      {!settled ? (
        <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
          <SectionHeading icon={<Globe2 aria-hidden="true" size={17} />} title="Unsettled planet" />
          <p className="p-4 text-sm leading-6 text-slate-400">
            No commander has settled this planet yet.
          </p>
        </section>
      ) : (
        <>
          <PlanetFleetActivityPanel
            loading={activeMissions === null}
            rows={planetFleetActivityRows(planet.occupiedBy?.planetId, activeMissions ?? [])}
          />

          {planet.occupiedBy?.planetId ? (
            <EntityMediaPanel
              account={account}
              apiBaseUrl={apiBaseUrl}
              canEdit={canEditEntityMedia({
                entityKind: "planet",
                ownerWallet: planet.occupiedBy.owner,
                viewerWallet: account,
              })}
              entityId={planet.occupiedBy.planetId}
              entityKind="planet"
              provider={provider}
            />
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            <PublicAssetStatePanel
              icon={<Building2 aria-hidden="true" size={17} />}
              loading={publicStateLoading && planet.publicState?.buildings == null}
              rows={publicStateAssetRows(planet.publicState?.buildings, buildingCatalog, "level")}
              title="Buildings"
            />
            <PublicAssetStatePanel
              icon={<FlaskConical aria-hidden="true" size={17} />}
              loading={publicStateLoading && planet.publicState?.research == null}
              rows={compactResearchRows(publicStateAssetRows(planet.publicState?.research, researchCatalog, "level"))}
              title="Research"
            />
            <PublicAssetStatePanel
              icon={<Rocket aria-hidden="true" size={17} />}
              loading={publicStateLoading && planet.publicState?.fleet == null}
              rows={publicStateAssetRows(planet.publicState?.fleet, shipCatalog, "count")}
              title="Fleet"
            />
            <PublicAssetStatePanel
              icon={<Shield aria-hidden="true" size={17} />}
              loading={publicStateLoading && planet.publicState?.defenses == null}
              rows={publicStateAssetRows(planet.publicState?.defenses, defenseCatalog, "count")}
              title="Defenses"
            />
          </div>

          <PublicStatePanel
            icon={<UserRound aria-hidden="true" size={17} />}
            loading={publicStateLoading && planet.publicState?.stationedDefenders == null}
            title="Stationed defenders"
            rows={publicStationedDefenderRows(planet.publicState)}
          />

          <PublicQueuesPanel
            loading={publicStateLoading && planet.publicState?.queues == null}
            queues={publicQueueViews(planet)}
          />
        </>
      )}
    </div>
  );
}

export function isPublicPlanetSettled(planet: Planet): boolean {
  return Boolean(planet.occupiedBy?.planetId);
}

export function planetDetailGalaxyActions({
  account,
  attackProtection,
  coords,
  defenseState,
  homeCoords,
  homePlanetId,
  planet,
  shipyardState,
}: {
  account: string | undefined;
  attackProtection?: AttackProtectionStatus | null | undefined;
  coords: Coordinates;
  defenseState: ChainDefenseState | null | undefined;
  homeCoords: Coordinates | undefined;
  homePlanetId: string | null | undefined;
  planet: Planet | undefined;
  shipyardState: ChainShipyardState | null;
}): GalaxyAction[] {
  return galaxyActionsForSlot({
    account,
    attackProtection,
    defenseState,
    homePlanetId,
    isOrigin: sameCoordinates(homeCoords, planet ?? coords),
    planet,
    shipyardState,
  });
}

function PlanetMissionControls({
  actions,
  busy,
  coords,
  onAction,
  planet,
}: {
  actions: GalaxyAction[];
  busy: boolean;
  coords: Coordinates;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <GalaxyActionButtons
        actions={actions}
        busy={busy}
        coords={coords}
        onAction={onAction}
        planet={planet}
      />
    </div>
  );
}

function PlanetActionStatus({ actionState }: { actionState: GalaxyActionState }) {
  if (actionState.status === "idle") return null;

  return (
    <div className={`mt-3 rounded border px-3 py-2 text-xs ${
      actionState.status === "error"
        ? "border-red-300/30 bg-red-500/10 text-red-100"
        : actionState.status === "success"
          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
          : "border-signal/25 bg-signal/10 text-signal"
    }`}>
      {actionState.label}
    </div>
  );
}

function PlanetFact({
  icon,
  label,
  mono = false,
  onClick,
  value,
}: {
  icon: ComponentChildren;
  label: string;
  mono?: boolean;
  onClick?: (() => void) | undefined;
  value: string;
}) {
  const content = (
    <>
      <span className="text-cyan-200/75">{icon}</span>
      <span className="sr-only">{label}: </span>
      <span className={mono ? "font-mono" : "font-medium"}>{value}</span>
    </>
  );
  const className = "inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-slate-300";

  return onClick ? (
    <button className={`${className} min-h-11 transition-colors hover:border-cyan-200/35 hover:text-cyan-100`} data-celestial-back onClick={onClick} title={label} type="button">
      {content}
    </button>
  ) : <span className={className}>{content}</span>;
}

function SectionHeading({ icon, title }: { icon: ComponentChildren; title: string }) {
  return (
    <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-cyan-200/15 bg-cyan-200/[0.07] text-cyan-100">{icon}</span>
      <span className="min-w-0 text-sm font-semibold text-slate-100">{title}</span>
    </header>
  );
}

function TelemetryCard({ row }: { row: PlanetRecordRow }) {
  return (
    <div className="min-w-0 bg-[#0d1421] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">{row.label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${recordToneClass(row.tone)}`} title={row.value}>{row.value}</div>
    </div>
  );
}

export function shouldShowPlanetDetailInitialLoader({
  planet,
  source,
}: {
  planet: Planet | null;
  source: "api" | "error" | "loading";
}): boolean {
  return source === "loading" && !planet;
}

export function planetRecordStatusLabel(
  planet: Planet,
  source: "api" | "error" | "loading",
  isHome: boolean
): string {
  if (source === "loading") return "Loading records";
  if (source === "error") return "Last known profile";
  if (isHome) return "Your settled world";
  if (planet.occupiedBy) return "Occupied world";
  return "Open world";
}

export function publicCommanderRows(planet: Planet, isHome: boolean): PlanetRecordRow[] {
  if (isHome) {
    return [
      { label: "Settlement", value: "Your home world", tone: "accent" },
      ...(planet.ownerId ? [{ label: "Player", value: planet.occupiedBy?.ownerDisplayName ?? shortAddress(planet.ownerId) }] : []),
      ...(planet.occupiedBy?.planetId ? [{ label: "Planet ID", value: `#${planet.occupiedBy.planetId}` }] : []),
    ];
  }

  if (planet.occupiedBy) {
    return [
      { label: "Settlement", value: "Occupied", tone: "accent" },
      { label: "Player", value: planet.occupiedBy.ownerDisplayName ?? shortAddress(planet.occupiedBy.owner) },
      { label: "Planet ID", value: `#${planet.occupiedBy.planetId}` },
    ];
  }

  return [
    { label: "Settlement", value: "Unclaimed", tone: "muted" },
    { label: "Wallet", value: "No owner yet", tone: "muted" },
  ];
}

export function publicPlanetDataRows(planet: Planet): PlanetRecordRow[] {
  return [
    { label: "Coordinates", value: `[${planet.galaxy}:${planet.system}:${planet.position}]` },
    { label: "Type", value: formatPlanetType(planet.type) },
    { label: "Fields", value: planet.fields.toLocaleString() },
    { label: "Diameter", value: `${planet.diameter.toLocaleString()} km` },
    { label: "Temperature", value: `${planet.temperature.min}°C to ${planet.temperature.max}°C` },
    { label: "Debris", value: debrisFieldLabel(planet), tone: planet.debrisField ? "accent" : "muted" },
    { label: "Moon signal", value: moonSignalLabel(planet), tone: planet.moonChance || planet.hasMoon ? "accent" : "muted" },
  ];
}

export function publicPlanetStatusRows(planet: Planet): PlanetRecordRow[] {
  return [
    ...(planet.debrisField ? [{ label: "Debris", value: debrisFieldLabel(planet), tone: "accent" as const }] : []),
    ...(!planet.hasMoon && planet.moonChance
      ? [{ label: "Moon signal", value: moonSignalLabel(planet), tone: "accent" as const }]
      : []),
  ];
}

export const publicSignalRows = publicPlanetDataRows;

type ProductionMetricRow = {
  label: string;
  value: string;
};

export function publicProductionRows(planet: Planet): ProductionMetricRow[] {
  return [
    {
      label: "Metal",
      value: formatProductionMultiplier(planet.resources.metal),
    },
    {
      label: "Crystal",
      value: formatProductionMultiplier(planet.resources.crystal),
    },
    {
      label: "Deuterium",
      value: formatProductionMultiplier(planet.resources.deuterium),
    },
    {
      label: "Solar satellite",
      value: formatSolarSatelliteEnergy(planetSolarSatelliteTemperature(planet.temperature)),
    },
  ];
}

export function publicResourceRows(resources: PublicPlanetState["resources"] | undefined): ProductionMetricRow[] | null {
  if (!resources) return null;

  const values = {
    metal: publicResourceValue(resources.metal),
    crystal: publicResourceValue(resources.crystal),
    deuterium: publicResourceValue(resources.deuterium),
  };
  return [
    {
      label: "Metal",
      value: values.metal.toLocaleString(),
    },
    {
      label: "Crystal",
      value: values.crystal.toLocaleString(),
    },
    {
      label: "Deuterium",
      value: values.deuterium.toLocaleString(),
    },
  ];
}

function publicResourceValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatProductionMultiplier(resourceIndex: number): string {
  return `${(resourceIndex / 2).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatSolarSatelliteEnergy(maxTemperature: number): string {
  return `${solarSatelliteEnergy(maxTemperature).toLocaleString()} E`;
}

function planetSolarSatelliteTemperature(temperature: Planet["temperature"]): number {
  return Math.floor((temperature.min + temperature.max) / 2);
}

function debrisFieldLabel(planet: Planet): string {
  if (!planet.debrisField) return "No debris field";
  const metal = planet.debrisField.metal.toLocaleString();
  const crystal = planet.debrisField.crystal.toLocaleString();
  return `${metal} metal / ${crystal} crystal`;
}

function moonSignalLabel(planet: Planet): string {
  if (planet.hasMoon) return planet.moonName ? `Moon: ${planet.moonName}` : "Moon present";
  if (!planet.moonChance) return "No moon activity";

  if (planet.moonChance.status === "created") {
    return planet.moonChance.moonDiameterKm
      ? `Moon created, ${planet.moonChance.moonDiameterKm.toLocaleString()} km`
      : "Moon created";
  }

  if (planet.moonChance.status === "pending") {
    return planet.moonChance.chanceBps === undefined
      ? "Moon chance pending"
      : `Moon chance ${(planet.moonChance.chanceBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% pending`;
  }

  if (planet.moonChance.status === "not_created") return "Moon chance missed";
  if (planet.moonChance.status === "moon_destruction_pending") return "Moon destruction pending";
  if (planet.moonChance.status === "moon_destroyed") return "Moon destroyed";
  if (planet.moonChance.status === "moon_survived") return "Moon survived";
  return "Existing moon preserved";
}

function PublicRecordRows({
  columns = false,
  rows,
}: {
  columns?: boolean;
  rows: PlanetRecordRow[];
}) {
  return (
    <dl className={`grid gap-2 ${columns ? "sm:grid-cols-2" : ""}`}>
      {rows.map((row) => (
        <div className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-3" key={row.label}>
          <dt className="text-xs text-slate-500">{row.label}</dt>
          <dd className={`min-w-0 break-words text-right text-sm ${recordToneClass(row.tone)}`} data-celestial-record-value>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type PlanetEconomyPillRow = {
  label: string;
  modifier?: string | undefined;
  value?: string | undefined;
};

export function planetEconomyPillRows(planet: Planet): PlanetEconomyPillRow[] {
  const resources = new Map(
    (publicResourceRows(planet.publicState?.resources) ?? []).map((row) => [row.label, row.value]),
  );
  const production = new Map(publicProductionRows(planet).map((row) => [row.label, row.value]));
  return [
    ...["Metal", "Crystal", "Deuterium"].map((label) => ({
      label,
      modifier: production.get(label),
      ...(resources.has(label) ? { value: resources.get(label) } : {}),
    })),
    { label: "Solar satellite", value: production.get("Solar satellite") ?? "Unknown" },
  ];
}

function PlanetEconomyPills({
  loading,
  rows,
}: {
  loading: boolean;
  rows: PlanetEconomyPillRow[];
}) {
  if (loading) {
    return (
      <SkeletonRegion className="flex flex-wrap gap-2" label="Loading planet economy">
        {skeletonList(4, (index) => <Skeleton className={`h-9 rounded-md ${["w-36", "w-40", "w-44", "w-36"][index]}`} key={index} />)}
      </SkeletonRegion>
    );
  }

  return (
    <dl className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <div className="inline-flex h-9 w-fit shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 px-2.5 text-xs leading-none" key={row.label}>
          <dt className="sr-only">{row.label}</dt>
          <dd className="whitespace-nowrap text-center leading-none text-slate-400 tabular-nums">
            {row.label}
            {row.value ? <> <span className="font-semibold text-slate-100">{row.value}</span></> : null}
            {row.modifier ? (
              <> <span className="text-slate-600">at</span> <span className="font-semibold text-cyan-100">{row.modifier}</span></>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type PlanetAssetRecordRow = PlanetRecordRow & {
  asset?: string | undefined;
};

export type PlanetFleetActivityRow = {
  asset?: string | undefined;
  direction: "Inbound" | "Outbound" | "Local";
  eventLabel: string;
  missionId: string;
  missionLabel: string;
  routeLabel: string;
  shipCountLabel: string;
  tone: "accent" | "danger";
};

export function planetFleetActivityRows(
  planetId: string | null | undefined,
  missions: readonly FleetMissionSummary[],
  bodyKind: "planet" | "moon" = "planet",
): PlanetFleetActivityRow[] {
  if (!planetId) return [];

  return missions
    .filter((mission) => (
      mission.originPlanetId === planetId && missionBodyMatches(mission.originIsMoon, bodyKind)
    ) || (
      mission.targetPlanetId === planetId && missionBodyMatches(mission.targetIsMoon, bodyKind)
    ))
    .map((mission) => {
      const returning = mission.status === "Returning" || mission.status === "Recalled";
      const destinationId = returning ? mission.originPlanetId : mission.targetPlanetId;
      const destinationIsMoon = returning ? mission.originIsMoon : mission.targetIsMoon;
      const sourceId = returning ? mission.targetPlanetId : mission.originPlanetId;
      const sourceIsMoon = returning ? mission.targetIsMoon : mission.originIsMoon;
      const sourceMatches = sourceId === planetId && missionBodyMatches(sourceIsMoon, bodyKind);
      const destinationMatches = destinationId === planetId && missionBodyMatches(destinationIsMoon, bodyKind);
      const direction = sourceMatches && destinationMatches
        ? "Local" as const
        : destinationMatches ? "Inbound" as const : "Outbound" as const;
      const endpointSide = direction === "Inbound"
        ? (returning ? "target" : "origin")
        : (returning ? "origin" : "target");
      const endpoint = endpointSide === "origin" ? mission.originPlanet : mission.targetPlanet;
      const endpointId = endpointSide === "origin" ? mission.originPlanetId : mission.targetPlanetId;
      const endpointIsMoon = endpointSide === "origin" ? mission.originIsMoon : mission.targetIsMoon;
      const eventAt = returning ? mission.returnAt : mission.arrivalAt;
      const shipEntries = shipCatalog
        .map((ship) => ({ ship, count: Number(mission.ships[ship.key] ?? 0) }))
        .filter((entry) => Number.isFinite(entry.count) && entry.count > 0)
        .sort((left, right) => right.count - left.count);
      const shipCount = shipEntries.reduce((total, entry) => total + entry.count, 0);
      const hostile = direction === "Inbound" && (mission.missionType === "Attack" || mission.missionType === "AcsAttack");

      return {
        ...(shipEntries[0]?.ship.asset ? { asset: shipEntries[0].ship.asset } : {}),
        direction,
        eventLabel: `${returning ? "Lands" : "Arrives"} ${formatUserTimestamp(eventAt)}`,
        missionId: mission.missionId,
        missionLabel: missionTypeLabel(mission.missionType),
        routeLabel: direction === "Local"
          ? planetFleetEndpointLabel(endpoint, endpointId, endpointIsMoon)
          : `${direction === "Inbound" ? "From" : "To"} ${planetFleetEndpointLabel(endpoint, endpointId, endpointIsMoon)}`,
        shipCountLabel: `${shipCount.toLocaleString()} ${shipCount === 1 ? "ship" : "ships"}`,
        tone: hostile ? "danger" as const : "accent" as const,
      };
    })
    .sort((left, right) => {
      const leftMission = missions.find((mission) => mission.missionId === left.missionId);
      const rightMission = missions.find((mission) => mission.missionId === right.missionId);
      const leftAt = timestampToMs(leftMission?.status === "Returning" || leftMission?.status === "Recalled" ? leftMission.returnAt : leftMission?.arrivalAt);
      const rightAt = timestampToMs(rightMission?.status === "Returning" || rightMission?.status === "Recalled" ? rightMission.returnAt : rightMission?.arrivalAt);
      return (leftAt ?? Number.MAX_SAFE_INTEGER) - (rightAt ?? Number.MAX_SAFE_INTEGER);
    });
}

function missionBodyMatches(isMoon: boolean | undefined, bodyKind: "planet" | "moon"): boolean {
  return bodyKind === "moon" ? isMoon === true : isMoon !== true;
}

function planetFleetEndpointLabel(
  endpoint: FleetMissionSummary["originPlanet"],
  fallbackPlanetId: string,
  isMoon = false,
): string {
  if (endpoint) {
    const name = endpoint.name?.trim() || `Planet ${endpoint.planetId}`;
    const bodyName = isMoon ? `${name} moon` : name;
    return endpoint.coordinates ? `${bodyName} [${endpoint.coordinates}]` : bodyName;
  }
  return `Planet ${fallbackPlanetId}${isMoon ? " moon" : ""}`;
}

export function PlanetFleetActivityPanel({
  loading,
  rows,
}: {
  loading: boolean;
  rows: PlanetFleetActivityRow[];
}) {
  if (!loading && rows.length === 0) return null;
  const visibleRows = rows.slice(0, 6);
  const overflow = rows.length - visibleRows.length;

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <SectionHeading icon={<Rocket aria-hidden="true" size={17} />} title="Fleet activity" />
      {loading ? (
        <SkeletonRegion className="grid gap-2 p-3 sm:grid-cols-2" label="Loading fleet activity">
          {skeletonList(2, (index) => (
            <div className="grid min-h-14 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded border border-white/[0.08] bg-black/20 p-1.5" key={index}>
              <Skeleton className="h-10 w-10 rounded" />
              <div className="min-w-0">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="mt-2 h-2.5 w-4/5" />
              </div>
            </div>
          ))}
        </SkeletonRegion>
      ) : (
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {visibleRows.map((row) => {
            const DirectionIcon = row.direction === "Inbound" ? ArrowDownLeft : ArrowUpRight;
            return (
              <a
                className="group grid min-h-14 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-white/[0.08] bg-black/20 p-1.5 transition hover:border-cyan-200/25 hover:bg-cyan-200/[0.035]"
                href={buildInspectPath({ kind: "mission", missionId: row.missionId })}
                key={`${row.missionId}-${row.direction}`}
              >
                <span className="h-10 w-10 overflow-hidden rounded border border-white/10 bg-[#080d18]">
                  {row.asset ? <OptimizedImage alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" sizes="icon" src={row.asset} /> : <Rocket aria-hidden="true" className="m-2.5 text-cyan-200/40" size={18} />}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <DirectionIcon aria-hidden="true" className={row.tone === "danger" ? "text-rose-300" : "text-cyan-200"} size={14} />
                    <span className="truncate">{row.direction} · {row.missionLabel}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">#{row.missionId}</span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500" title={`${row.routeLabel} · ${row.eventLabel}`}>{row.routeLabel} · {row.eventLabel}</span>
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] text-slate-400">{row.shipCountLabel}</span>
              </a>
            );
          })}
          {overflow > 0 ? <p className="px-1 text-xs text-slate-500 sm:col-span-2">{overflow.toLocaleString()} more active {overflow === 1 ? "fleet" : "fleets"}</p> : null}
        </div>
      )}
    </section>
  );
}

export function PublicAssetStatePanel({
  icon,
  loading,
  rows,
  title,
}: {
  icon: ComponentChildren;
  loading: boolean;
  rows: PlanetAssetRecordRow[];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <SectionHeading icon={icon} title={title} />
      {loading ? (
        <AssetRowsSkeleton label={`Loading ${title.toLowerCase()}`} />
      ) : rows.length > 0 ? (
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {rows.map((row) => (
            <article className="group grid min-h-14 min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded border border-white/[0.08] bg-black/20 p-1.5 transition-colors hover:border-cyan-200/20 hover:bg-cyan-200/[0.035]" key={row.label}>
              <div className="relative h-10 w-10 overflow-hidden rounded border border-white/10 bg-[#080d18]">
                {row.asset ? (
                  <OptimizedImage
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                    sizes="icon"
                    src={row.asset}
                  />
                ) : (
                  <div aria-hidden="true" className="grid h-full place-items-center bg-[radial-gradient(circle,rgba(128,241,255,0.12),transparent_68%)] text-cyan-200/35">
                    <Orbit size={20} />
                  </div>
                )}
                <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(145deg,transparent_55%,rgba(5,7,13,0.45))]" />
              </div>
              <div className="min-w-0">
                <h4 className="break-words text-xs font-semibold leading-tight text-slate-200">{row.label}</h4>
                <p className={`mt-1 font-mono text-[11px] font-semibold leading-none ${recordToneClass(row.tone)}`}>{row.value}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyPublicState label={`No ${title.toLowerCase()}`} />
      )}
    </section>
  );
}

function PublicStatePanel({
  icon,
  loading,
  rows,
  title,
}: {
  icon: ComponentChildren;
  loading: boolean;
  rows: PlanetRecordRow[];
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <SectionHeading icon={icon} title={title} />
      {loading ? (
        <RecordRowsSkeleton label={`Loading ${title.toLowerCase()}`} />
      ) : rows.length > 0 ? (
        <div className="p-3"><PublicRecordRows columns rows={rows} /></div>
      ) : (
        <EmptyPublicState label="No entries" />
      )}
    </section>
  );
}

function AssetRowsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion className="grid gap-2 p-3 sm:grid-cols-2" label={label}>
      {skeletonList(4, (index) => (
        <div className="grid min-h-14 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded border border-white/[0.08] bg-black/20 p-1.5" key={index}>
          <Skeleton className="h-10 w-10 rounded" />
          <div className="min-w-0">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="mt-2 h-2.5 w-12" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

function RecordRowsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion className="grid gap-2 p-3 sm:grid-cols-2" label={label}>
      {skeletonList(2, (index) => (
        <div className="flex items-center justify-between gap-3" key={index}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

function EmptyPublicState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 text-sm text-slate-500">
      <span aria-hidden="true" className="h-2 w-2 rounded-full border border-slate-500/50 bg-slate-500/10" />
      {label}
    </div>
  );
}

export function publicStateRows(
  rows: Array<{ id: number; level?: number; count?: number }> | null | undefined,
  catalog: readonly { id?: number; label: string }[],
  valueKind: "level" | "count"
): PlanetRecordRow[] {
  return (rows ?? [])
    .map((row) => {
      const value = valueKind === "level" ? row.level ?? 0 : row.count ?? 0;
      const catalogItem = catalog.find((item, index) => (item.id ?? index) === row.id);
      return {
        label: catalogItem?.label ?? `ID ${row.id}`,
        value,
      };
    })
    .filter((row) => row.value > 0)
    .map((row) => ({
      label: row.label,
      value: valueKind === "level" ? `Level ${row.value}` : row.value.toLocaleString(),
    }));
}

export function publicStateAssetRows(
  rows: Array<{ id: number; level?: number; count?: number }> | null | undefined,
  catalog: readonly { id?: number; label: string; asset?: string | undefined }[],
  valueKind: "level" | "count"
): PlanetAssetRecordRow[] {
  return (rows ?? [])
    .map((row) => {
      const value = valueKind === "level" ? row.level ?? 0 : row.count ?? 0;
      const catalogItem = catalog.find((item, index) => (item.id ?? index) === row.id);
      return {
        asset: catalogItem?.asset,
        label: catalogItem?.label ?? `ID ${row.id}`,
        value,
      };
    })
    .filter((row) => row.value > 0)
    .map((row) => ({
      asset: row.asset,
      label: row.label,
      value: valueKind === "level" ? `Level ${row.value}` : row.value.toLocaleString(),
    }));
}

export function compactResearchRows(rows: PlanetAssetRecordRow[]): PlanetAssetRecordRow[] {
  return rows.map((row) => ({
    ...row,
    label: row.label.replace(/\s+Technology$/i, ""),
  }));
}

export function publicStationedDefenderRows(
  publicState: PublicPlanetState | null | undefined
): PlanetRecordRow[] {
  return (publicState?.stationedDefenders ?? [])
    .filter((defender) => stationedDefenderShipCount(defender.ships) > 0)
    .map((defender) => ({
      label: defender.defenderDisplayName ?? shortAddress(defender.defender),
      value: `${stationedDefenderShipCount(defender.ships).toLocaleString()} ships until ${formatUserTimestamp(timestampToMs(defender.holdUntil))}`,
      tone: "accent" as const,
    }));
}

export type PublicQueueView = {
  asset?: string | undefined;
  completedQuantity?: number | undefined;
  currentUnitProgressBps?: number | undefined;
  currentUnitSecondsRemaining?: number | undefined;
  itemText: string;
  key: string;
  label: string;
  progress?: number | undefined;
  quantity?: number | undefined;
  readyAt: string | null;
  remainingQuantity?: number | undefined;
  startedAt?: string | null | undefined;
  title: string;
  tone: QueueProgressTone;
};

export function publicQueueViews(planet: Planet): PublicQueueView[] {
  const queues = planet.publicState?.queues;
  if (!queues) return [];

  return [
    publicQueueView("building", "Buildings", queues.building, buildingCatalog, "amber", "level"),
    publicQueueView("defense", "Defenses", queues.defense, defenseCatalog, "rose", "quantity"),
    publicQueueView("research", "Research", queues.research, researchCatalog, "violet", "level"),
    publicQueueView("shipyard", "Shipyard", queues.ship, shipCatalog, "sky", "quantity"),
  ].filter((queue): queue is PublicQueueView => queue !== null);
}

export function publicQueueView(
  key: string,
  title: string,
  queue: PublicQueueState | null | undefined,
  catalog: readonly { id?: number; label: string; asset?: string | undefined }[],
  tone: QueueProgressTone,
  valueKind: "level" | "quantity",
): PublicQueueView | null {
  if (!queue?.active) return null;
  const item = queue.itemId === undefined
    ? undefined
    : catalog.find((candidate, index) => (candidate.id ?? index) === queue.itemId);
  const label = item?.label ?? queue.kind ?? "Queue";
  const detail = valueKind === "level"
    ? queue.targetLevel ? `Level ${queue.targetLevel}` : null
    : queue.quantity ? `×${queue.quantity.toLocaleString()}` : null;

  return {
    ...(item?.asset ? { asset: item.asset } : {}),
    ...(queue.asOfNow?.completedQuantity !== undefined
      ? { completedQuantity: queue.asOfNow.completedQuantity }
      : {}),
    ...(queue.asOfNow?.currentUnitProgressBps !== undefined
      ? { currentUnitProgressBps: queue.asOfNow.currentUnitProgressBps }
      : {}),
    ...(queue.asOfNow?.currentUnitSecondsRemaining !== undefined
      ? { currentUnitSecondsRemaining: queue.asOfNow.currentUnitSecondsRemaining }
      : {}),
    ...(queue.asOfNow?.overallProgressBps !== undefined
      ? { progress: queue.asOfNow.overallProgressBps / 10_000 }
      : {}),
    ...(queue.quantity !== undefined ? { quantity: queue.quantity } : {}),
    ...(queue.asOfNow?.remainingQuantity !== undefined
      ? { remainingQuantity: queue.asOfNow.remainingQuantity }
      : {}),
    itemText: detail ? `${label} · ${detail}` : label,
    key,
    label,
    readyAt: queue.readyAt,
    startedAt: queue.startedAt ?? queue.productionTiming?.startedAt,
    title,
    tone,
  };
}

export function PublicQueuesPanel({
  loading,
  queues,
}: {
  loading: boolean;
  queues: PublicQueueView[];
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <SectionHeading icon={<Orbit aria-hidden="true" size={17} />} title="Active queues" />
      {loading ? (
        <SkeletonRegion className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4" label="Loading active queues">
          {skeletonList(4, (index) => (
            <div className="rounded-lg border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-2.5 w-16" />
              <div className="mt-3 grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
                <Skeleton className="h-11 w-11 rounded" />
                <div>
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="mt-2 h-2.5 w-20" />
                  <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </SkeletonRegion>
      ) : queues.length > 0 ? (
        <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {queues.map((queue) => (
            <article className="min-w-0 rounded-lg border border-white/10 bg-black/15 p-3" key={queue.key}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{queue.title}</h3>
              <QueueProgressPanel
                asset={queue.asset}
                completedQuantity={queue.completedQuantity}
                currentUnitProgressBps={queue.currentUnitProgressBps}
                currentUnitSecondsRemaining={queue.currentUnitSecondsRemaining}
                embedded
                itemText={queue.itemText}
                label={queue.label}
                progress={queue.progress}
                quantity={queue.quantity}
                readyAt={queue.readyAt}
                remainingQuantity={queue.remainingQuantity}
                startedAt={queue.startedAt}
                title={queue.title}
                tone={queue.tone}
              />
            </article>
          ))}
        </div>
      ) : (
        <EmptyPublicState label="No active queues" />
      )}
    </section>
  );
}

export function publicQueueRows(planet: Planet): PlanetRecordRow[] {
  const queues = planet.publicState?.queues;
  if (!queues) return [{ label: "Queues", value: "Queue data unavailable", tone: "muted" }];

  const rows: PlanetRecordRow[] = [
    queueRow("Building", queues.building, buildingCatalog, "Level"),
    queueRow("Defense", queues.defense, defenseCatalog, "x"),
    queueRow("Shipyard", queues.ship, shipCatalog, "x"),
    queueRow("Research", queues.research, researchCatalog, "Level"),
  ];

  return rows.some((row) => row.tone === "accent")
    ? rows
    : [{ label: "Queues", value: "No active queues", tone: "muted" }];
}

function stationedDefenderShipCount(ships: Record<string, string>): number {
  return Object.values(ships).reduce((total, count) => {
    const parsed = Number(count);
    return total + (Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, 0);
}

function queueRow(
  label: string,
  queue: PublicQueueState | null | undefined,
  catalog: readonly { id?: number; label: string }[],
  suffix: "Level" | "x"
): PlanetRecordRow {
  if (!queue?.active) return { label, value: "Idle", tone: "muted" };
  const item = queue.itemId === undefined
    ? undefined
    : catalog.find((candidate, index) => (candidate.id ?? index) === queue.itemId);
  const quantity = suffix === "Level"
    ? queue.targetLevel ? ` ${suffix} ${queue.targetLevel}` : ""
    : queue.quantity ? ` ${suffix}${queue.quantity}` : "";
  return {
    label,
    value: `${item?.label ?? queue.kind ?? "Queue"}${quantity}`,
    tone: "accent",
  };
}

function recordToneClass(tone: PlanetRecordRow["tone"]): string {
  if (tone === "accent") return "text-cyan-100";
  if (tone === "muted") return "text-slate-500";
  return "text-slate-300";
}

function sameCoordinates(homeCoords: Coordinates | undefined, planet: Coordinates): boolean {
  return Boolean(
    homeCoords
      && homeCoords.galaxy === planet.galaxy
      && homeCoords.system === planet.system
      && homeCoords.position === planet.position
  );
}
