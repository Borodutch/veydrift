import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Planet, Coordinates, PublicPlanetState, PublicQueueState } from "../types";
import { formatPlanetType, planetsFromSystemResponse } from "../data/mockUniverse";
import { galaxyActionsForSlot, type GalaxyAction } from "../galaxyActions";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress, type ChainDefenseState, type ChainShipyardState } from "../walletFlow";
import { isImageReady } from "../imageLoadState";
import { formatScore } from "../attackProtectionLabels";
import { buildingCatalog, defenseCatalog, researchCatalog, shipCatalog, solarSatelliteEnergy } from "../playableMvp";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { GalaxyActionButtons, type AttackProtectionStatus, type GalaxyActionState, formatAttackBlockReason } from "./GalaxyView";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { MoonImage, PlanetMoonIndicator } from "./PlanetMoonIndicator";

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
  return trustedHomePlanet ?? (currentPlanet && sameCoordinates(currentPlanet, coords) ? currentPlanet : null);
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
  return trustedHomePlanet ?? apiPlanet ?? (currentPlanet && sameCoordinates(currentPlanet, coords) ? currentPlanet : null);
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
  shipyardState = null,
  transactionUnavailableReason,
}: Props) {
  const trustedHomePlanet = useMemo(
    () => sameCoordinates(homeCoords, coords) && homePlanet
      ? homePlanet
      : null,
    [coords.galaxy, coords.position, coords.system, homeCoords?.galaxy, homeCoords?.position, homeCoords?.system, homePlanet],
  );
  const [planet, setPlanet] = useState<Planet | null>(trustedHomePlanet);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");
  const [attackProtection, setAttackProtection] = useState<AttackProtectionStatus | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const isHome = planet ? sameCoordinates(homeCoords, planet) : false;

  useEffect(() => {
    const abortController = new AbortController();
    setPlanet((current) => planetDetailRefreshStartPlanet({
      coords,
      currentPlanet: current,
      trustedHomePlanet,
    }));
    setSource("loading");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${coords.galaxy}/systems/${coords.system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
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
        if (!abortController.signal.aborted) {
          console.error(error);
          setSource("error");
        }
      });

    return () => abortController.abort();
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

    const abortController = new AbortController();
    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/wallet/${account}/attack-protection?targetPlanetId=${targetPlanetId}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Attack protection request failed with ${response.status}`);
        return response.json() as Promise<AttackProtectionStatus>;
      })
      .then((status) => {
        if (!abortController.signal.aborted) setAttackProtection(status);
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setAttackProtection(null);
        }
      });

    return () => abortController.abort();
  }, [account, apiBaseUrl, isHome, planet?.occupiedBy?.planetId]);

  useEffect(() => {
    setImageLoaded(isImageReady(imageRef.current));
  }, [planet?.image]);

  if (!planet) {
    if (shouldShowPlanetDetailInitialLoader({ planet, source })) {
      return (
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
            >
              ← System [{coords.galaxy}:{coords.system}:{coords.position}]
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <PlanetImageSkeleton className="aspect-square rounded-lg border border-white/15" />
            <div className="grid content-start gap-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
                <div className="mt-3 h-4 w-64 max-w-full animate-pulse rounded bg-white/5" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-28 rounded-lg border border-white/10 bg-white/5" />
                <div className="h-28 rounded-lg border border-white/10 bg-white/5" />
                <div className="h-32 rounded-lg border border-white/10 bg-white/5 sm:col-span-2" />
              </div>
            </div>
          </div>
        </div>
      );
    }

    const emptyMissionActions = source === "api"
      ? planetDetailGalaxyActions({
        account,
        attackProtection: null,
        coords,
        defenseState,
        homeCoords,
        homePlanetId,
        planet: undefined,
        shipyardState,
      })
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
        <button
          onClick={onBack}
          className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        >
          ← Back
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
  });
  const attackBlockLabel = formatAttackBlockReason(attackProtection ?? undefined);
  const targetScoreText = attackProtection?.scoreComparison?.defenderScore
    ? formatScore(attackProtection.scoreComparison.defenderScore)
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        >
          ← System [{coords.galaxy}:{coords.system}:{coords.position}]
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
        {/* Planet image */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-white/15 bg-black/30">
            {!imageLoaded && <PlanetImageSkeleton className="absolute inset-0" />}
            <OptimizedImage
              key={planet.image}
              alt={planet.name}
              className={`h-full w-full object-cover transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              imageRef={imageRef}
              loading="eager"
              onLoad={(event) => {
                if (isImageReady(event.currentTarget)) setImageLoaded(true);
              }}
              sizes="planetPreview"
              src={planet.image}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,rgba(5,7,13,0.6),transparent_60%)]" />
            {planet.hasMoon ? <PlanetMoonIndicator className="right-3 top-3" /> : null}
            {isHome ? (
              <span className="absolute left-3 top-3 rounded border border-cyan-300/30 bg-cyan-300/15 px-2 py-1 text-xs font-semibold uppercase text-cyan-100">
                Home Planet
              </span>
            ) : null}
          </div>
          {planet.hasMoon ? (
            <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 overflow-hidden rounded-full border border-cyan-100/30 bg-black/40">
                  <MoonImage className="h-full w-full object-cover" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-cyan-100">{planet.moonName ?? "Moon"}</span>
                  <span className="block text-xs text-slate-500">Nested moon body</span>
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Planet summary */}
        <div className="grid min-w-0 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-white">{planet.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                  <span>{formatPlanetType(planet.type)}</span>
                  <span className="text-slate-700">|</span>
                  <span>Position [{planet.galaxy}:{planet.system}:{planet.position}]</span>
                  <span className="text-slate-700">|</span>
                  <span>{planet.diameter.toLocaleString()} km</span>
                  <span className="text-slate-700">|</span>
                  <span>{planetRecordStatusLabel(planet, source, isHome)}</span>
                  {attackBlockLabel ? (
                    <>
                      <span className="text-slate-700">|</span>
                      <span className="text-red-100">{attackBlockLabel}</span>
                    </>
                  ) : null}
                  {targetScoreText ? (
                    <>
                      <span className="text-slate-700">|</span>
                      <span className="font-mono text-cyan-100">Score {targetScoreText}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <PlanetMissionControls
                actions={missionActions}
                busy={actionState.status === "pending" || Boolean(transactionUnavailableReason)}
                coords={{ galaxy: planet.galaxy, system: planet.system, position: planet.position }}
                onAction={onAction}
                planet={planet}
                transactionUnavailableReason={transactionUnavailableReason}
              />
            </div>
            <PlanetActionStatus actionState={actionState} />
            {transactionUnavailableReason ? (
              <div className="mt-3 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                {transactionUnavailableReason}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PlanetCommanderPanel planet={planet} isHome={isHome} />
            <PlanetTemperaturePanel planet={planet} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Public Planet Data
          </h3>
          <PublicRecordRows rows={publicPlanetDataRows(planet)} columns />
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Production Modifiers
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {publicProductionRows(planet).map((row) => (
              <ProductionMetric key={row.label} {...row} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current Public Resources
          </h3>
          <ResourceBars resources={planet.publicState?.resources} />
        </div>

        <PublicStatePanel
          title="Buildings"
          rows={publicStateRows(planet.publicState?.buildings, buildingCatalog, "level")}
        />
        <PublicStatePanel
          title="Fleet"
          rows={publicStateRows(planet.publicState?.fleet, shipCatalog, "count")}
        />
        <PublicStatePanel
          title="Defenses"
          rows={publicStateRows(planet.publicState?.defenses, defenseCatalog, "count")}
        />
        <PublicStatePanel
          title="Stationed Defenders"
          rows={publicStationedDefenderRows(planet.publicState?.stationedDefenders)}
        />
        <PublicStatePanel
          title="Research"
          rows={publicStateRows(planet.publicState?.research, researchCatalog, "level")}
        />

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 md:col-span-2 xl:col-span-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active Public Queues
          </h3>
          <PublicRecordRows rows={publicQueueRows(planet)} columns />
        </div>
      </div>
    </div>
  );
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
  transactionUnavailableReason,
}: {
  actions: GalaxyAction[];
  busy: boolean;
  coords: Coordinates;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet | undefined;
  transactionUnavailableReason?: string | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      <GalaxyActionButtons
        actions={actions}
        busy={busy}
        busyReason={transactionUnavailableReason}
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

function PlanetCommanderPanel({ isHome, planet }: { isHome: boolean; planet: Planet }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Public Commander
      </h3>
      <PublicRecordRows rows={publicCommanderRows(planet, isHome)} />
    </div>
  );
}

function PlanetTemperaturePanel({ planet }: { planet: Planet }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Temperature
      </h3>
      <span className="text-sm text-slate-300">
        {planet.temperature.min}°C to {planet.temperature.max}°C
      </span>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-signal/60"
          style={{
            width: `${Math.min(
              100,
              Math.max(0, (planet.temperature.max + 150) / 300 * 100)
            )}%`,
          }}
        />
      </div>
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
  if (source === "loading") return "Refreshing public records";
  if (source === "error") return "Last known public profile";
  if (isHome) return "Your settled world";
  if (planet.occupiedBy) return "Occupied public world";
  return "Open public world";
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
    { label: "Wallet", value: "No public owner yet", tone: "muted" },
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

export const publicSignalRows = publicPlanetDataRows;

type ProductionMetricRow = {
  label: string;
  value: string;
  fillPercent: number;
  color: string;
};

export function publicProductionRows(planet: Planet): ProductionMetricRow[] {
  return [
    {
      label: "Metal",
      value: formatProductionMultiplier(planet.resources.metal),
      fillPercent: productionFillPercent(planet.resources.metal),
      color: "bg-slate-400",
    },
    {
      label: "Crystal",
      value: formatProductionMultiplier(planet.resources.crystal),
      fillPercent: productionFillPercent(planet.resources.crystal),
      color: "bg-signal",
    },
    {
      label: "Deuterium",
      value: formatProductionMultiplier(planet.resources.deuterium),
      fillPercent: productionFillPercent(planet.resources.deuterium),
      color: "bg-blue-400",
    },
    {
      label: "Solar satellite",
      value: formatSolarSatelliteEnergy(planetSolarSatelliteTemperature(planet.temperature)),
      fillPercent: solarSatelliteFillPercent(planetSolarSatelliteTemperature(planet.temperature)),
      color: "bg-ember",
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
  const max = Math.max(1, values.metal, values.crystal, values.deuterium);

  return [
    {
      label: "Metal",
      value: values.metal.toLocaleString(),
      fillPercent: values.metal / max * 100,
      color: "bg-slate-400",
    },
    {
      label: "Crystal",
      value: values.crystal.toLocaleString(),
      fillPercent: values.crystal / max * 100,
      color: "bg-signal",
    },
    {
      label: "Deuterium",
      value: values.deuterium.toLocaleString(),
      fillPercent: values.deuterium / max * 100,
      color: "bg-blue-400",
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

function productionFillPercent(resourceIndex: number): number {
  return Math.min(100, Math.max(0, resourceIndex / 2));
}

function formatSolarSatelliteEnergy(maxTemperature: number): string {
  return `${solarSatelliteEnergy(maxTemperature).toLocaleString()} E`;
}

function solarSatelliteFillPercent(maxTemperature: number): number {
  return Math.min(100, Math.max(0, solarSatelliteEnergy(maxTemperature) / 50 * 100));
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
        <div className="flex min-w-0 items-baseline justify-between gap-3" key={row.label}>
          <dt className="text-xs text-slate-500">{row.label}</dt>
          <dd className={`truncate text-right text-sm ${recordToneClass(row.tone)}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResourceBars({
  resources,
}: {
  resources: PublicPlanetState["resources"] | undefined;
}) {
  const rows = publicResourceRows(resources);
  if (!rows) {
    return (
      <PublicRecordRows rows={[{ label: "Resources", value: "Public resource state unavailable", tone: "muted" }]} />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {rows.map((row) => (
        <ProductionMetric key={row.label} {...row} />
      ))}
    </div>
  );
}

function PublicStatePanel({ rows, title }: { rows: PlanetRecordRow[]; title: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <PublicRecordRows rows={rows.length > 0 ? rows : [{ label: "Public records", value: "No public entries", tone: "muted" }]} />
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

export function publicStationedDefenderRows(
  defenders: PublicPlanetState["stationedDefenders"] | null | undefined
): PlanetRecordRow[] {
  return (defenders ?? [])
    .filter((defender) => stationedDefenderShipCount(defender.ships) > 0)
    .map((defender) => ({
      label: defender.defenderDisplayName ?? shortAddress(defender.defender),
      value: `${stationedDefenderShipCount(defender.ships).toLocaleString()} ships until ${formatUserTimestamp(timestampToMs(defender.holdUntil))}`,
      tone: "accent" as const,
    }));
}

export function publicQueueRows(planet: Planet): PlanetRecordRow[] {
  const queues = planet.publicState?.queues;
  if (!queues) return [{ label: "Queues", value: "Public queue data unavailable", tone: "muted" }];

  const rows: PlanetRecordRow[] = [
    queueRow("Building", queues.building, buildingCatalog, "Level"),
    queueRow("Defense", queues.defense, defenseCatalog, "x"),
    queueRow("Shipyard", queues.ship, shipCatalog, "x"),
    queueRow("Research", queues.research, researchCatalog, "Level"),
  ];

  return rows.some((row) => row.tone === "accent")
    ? rows
    : [{ label: "Queues", value: "No active public queues", tone: "muted" }];
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

function ProductionMetric({
  label,
  value,
  fillPercent,
  color,
}: {
  label: string;
  value: string;
  fillPercent: number;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-slate-500" title={label}>{label}</span>
        <span className="whitespace-nowrap text-xs font-medium text-slate-300">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    </div>
  );
}
