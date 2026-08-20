import {
  Building2,
  Database,
  MapPin,
  Orbit,
  Rocket,
  Shield,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Coordinates, Planet } from "../types";
import { formatPlanetType, planetsFromSystemResponse, type ApiSystemResponse } from "../data/mockUniverse";
import { galaxyActionsForSlot, type GalaxyAction } from "../galaxyActions";
import { defenseCatalog, shipCatalog } from "../playableMvp";
import { playableApiUrl } from "../runtimeConfig";
import { formatAttackBlockReason, type AttackProtectionStatus, type GalaxyActionState } from "./GalaxyView";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import {
  shortAddress,
  type ChainDefenseState,
  type ChainShipyardState,
  type FleetMissionSummary,
  type GlobalActiveMissionsResponse,
} from "../walletFlow";
import { MoonActionStrip, type MoonOverviewAction } from "./MoonPage";
import { MoonImage } from "./PlanetMoonIndicator";
import {
  canApplyPlanetDetailResponse,
  planetDetailRequestKey,
  planetDetailVisiblePlanet,
  planetFleetActivityRows,
  PlanetFleetActivityPanel,
  PublicAssetStatePanel,
  PublicQueuesPanel,
  publicQueueView,
  publicStateAssetRows,
  type PublicQueueView,
} from "./PlanetDetail";
import { MoonDetailSkeleton } from "./LoadingSkeletons";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";
import { buildInspectPath } from "../inspectRoutes";
import { backendDataStoreFor } from "../backendDataStore";

type PublicMoonDetailProps = {
  account?: string | undefined;
  actionState?: GalaxyActionState | undefined;
  apiBaseUrl?: string | undefined;
  coords: Coordinates;
  defenseState?: ChainDefenseState | null | undefined;
  homeCoords?: Coordinates | undefined;
  homePlanetId?: string | null | undefined;
  onAction?: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  onBack: () => void;
  onSelectPlanet?: ((coords: Coordinates) => void) | undefined;
  shipyardState?: ChainShipyardState | null | undefined;
  transactionUnavailableReason?: string | undefined;
};

export function PublicMoonDetail({
  account,
  actionState = { status: "idle" },
  apiBaseUrl = playableApiUrl,
  coords,
  defenseState = null,
  homeCoords,
  homePlanetId,
  onAction,
  onBack,
  onSelectPlanet,
  shipyardState = null,
  transactionUnavailableReason,
}: PublicMoonDetailProps) {
  const [loadedPlanet, setPlanet] = useState<Planet | null>(null);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");
  const [attackProtection, setAttackProtection] = useState<AttackProtectionStatus | null>(null);
  const [attackProtectionUnavailable, setAttackProtectionUnavailable] = useState(true);
  const [activeMissions, setActiveMissions] = useState<FleetMissionSummary[] | null>(null);
  const currentRequestKey = useRef(planetDetailRequestKey(coords));
  currentRequestKey.current = planetDetailRequestKey(coords);
  const planet = planetDetailVisiblePlanet(loadedPlanet, coords);

  useEffect(() => {
    let cancelled = false;
    const requestKey = planetDetailRequestKey(coords);
    setSource("loading");

    backendDataStoreFor(apiBaseUrl).system<ApiSystemResponse>(coords.galaxy, coords.system, { detail: "full" })
      .then((payload) => {
        if (!canApplyPlanetDetailResponse(requestKey, coords, cancelled)
          || currentRequestKey.current !== requestKey) return;
        const apiPlanet = planetsFromSystemResponse(payload).find((item) => item.position === coords.position) ?? null;
        setPlanet(apiPlanet);
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
  }, [apiBaseUrl, coords.galaxy, coords.position, coords.system]);

  useEffect(() => {
    const targetPlanetId = planet?.occupiedBy?.planetId;
    const isHome = planet ? sameCoordinates(homeCoords, planet) : false;
    if (!account || !targetPlanetId || isHome) {
      setAttackProtection(null);
      setAttackProtectionUnavailable(false);
      return;
    }

    let cancelled = false;
    setAttackProtection(null);
    setAttackProtectionUnavailable(true);
    backendDataStoreFor(apiBaseUrl).attackProtection(account, targetPlanetId, true)
      .then((status) => {
        if (!cancelled) {
          setAttackProtection(status);
          setAttackProtectionUnavailable(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          setAttackProtection(null);
          setAttackProtectionUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account, apiBaseUrl, homeCoords?.galaxy, homeCoords?.position, homeCoords?.system, planet?.occupiedBy?.planetId]);

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
          (mission.originPlanetId === planetId && mission.originIsMoon === true)
          || (mission.targetPlanetId === planetId && mission.targetIsMoon === true)
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

  const coordinateText = `[${coords.galaxy}:${coords.system}:${coords.position}]`;
  const visibleTargetPlanetId = planet?.occupiedBy?.planetId;
  const protectionRequired = Boolean(
    account && visibleTargetPlanetId && planet && !sameCoordinates(homeCoords, planet)
  );
  const actions = planet?.hasMoon
      ? publicMoonActions({
        account,
        actionState,
        attackProtection,
        attackProtectionUnavailable: protectionRequired && (
          attackProtectionUnavailable || attackProtection?.targetPlanetId !== visibleTargetPlanetId
        ),
        coords,
        defenseState,
        homeCoords,
        homePlanetId,
        onAction,
        planet,
        shipyardState,
        transactionUnavailableReason,
      })
    : [];
  const visibleActions = actions.filter((action) => Boolean(action.onClick && !action.disabledReason));

  if (source === "loading" && !planet) {
    return <MoonDetailSkeleton />;
  }

  if (!planet || !planet.hasMoon) {
    const parentPath = buildInspectPath({ kind: "planet", coords });
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-slate-400">
          {source === "error" ? "Moon data could not be loaded." : `No moon in orbit at ${coordinateText}.`}
        </p>
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-slate-300 transition-colors hover:border-cyan-200/30 hover:text-cyan-100"
          href={parentPath}
          onClick={onSelectPlanet ? (event) => {
            event.preventDefault();
            onSelectPlanet(coords);
          } : undefined}
        >
          <MapPin aria-hidden="true" className="text-cyan-200/75" size={14} />
          {coordinateText}
        </a>
      </div>
    );
  }

  const isHome = sameCoordinates(homeCoords, planet);
  const moon = planet.publicMoonState;
  const parentPath = buildInspectPath({ kind: "planet", coords });
  const moonStateLoading = source === "loading";
  const parentClick = onSelectPlanet ? () => onSelectPlanet(coords) : onBack;

  return (
    <div className="celestial-detail moon-detail-page flex min-w-0 flex-col gap-3" data-celestial-detail="moon">
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0b111e] shadow-lg shadow-black/15">
        <div className="celestial-detail-layout moon-detail-layout" data-celestial-layout>
          <div className="celestial-detail-artwork relative flex items-center justify-center p-3 sm:p-4 lg:p-5" data-celestial-artwork>
            <div className="relative aspect-square w-full max-w-40 sm:max-w-[11rem] lg:max-w-[13rem]">
              <div className="relative h-full overflow-hidden rounded-full border border-cyan-100/20 bg-black/40 shadow-[0_0_70px_rgba(128,241,255,0.13)]" data-celestial-media>
                <MoonImage
                  alt={planet.moonName ?? "Moon"}
                  className="relative h-full w-full object-contain"
                  loading="eager"
                  planetType={planet.type}
                  sizes="planetPreview"
                />
                <div aria-hidden="true" className="absolute inset-0 rounded-full shadow-[inset_30px_-24px_54px_rgba(0,0,0,0.55)]" />
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col justify-center p-3 sm:p-4 lg:p-5" data-celestial-summary>
            {isHome ? (
              <span className="inline-flex h-7 w-fit items-center rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 pt-px text-[11px] font-bold uppercase leading-none tracking-[0.14em] text-emerald-100">Home moon</span>
            ) : null}

            <div className={`${isHome ? "mt-3" : ""} flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2`}>
              <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">{planet.moonName ?? "Moon"}</h2>
              {actionState.status === "pending" ? (
                <SkeletonRegion className="flex gap-2" label="Loading moon actions">
                  {skeletonList(2, (index) => <Skeleton className="h-11 w-11 rounded" key={index} />)}
                </SkeletonRegion>
              ) : visibleActions.length > 0 ? (
                <MoonActionStrip actions={visibleActions} />
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
              <MoonFact href={parentPath} icon={<MapPin aria-hidden="true" size={14} />} label="Open coordinates" onClick={parentClick} value={coordinateText} mono />
              {moon?.diameterKm !== undefined ? <MoonFact icon={<Orbit aria-hidden="true" size={14} />} label="Diameter" value={`${moon.diameterKm.toLocaleString("en-US")} km`} /> : null}
              {moon?.fields !== undefined ? <MoonFact icon={<Database aria-hidden="true" size={14} />} label="Fields" value={moon.fields.toLocaleString("en-US")} /> : null}
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <MoonResourcePills loading={moonStateLoading && moon?.resources == null} rows={moonResourceRows(planet)} />
            </div>

            {actionState.status === "error" || actionState.status === "success" ? (
              <div className={`mt-3 rounded border px-3 py-2 text-xs ${
                actionState.status === "error"
                  ? "border-red-300/30 bg-red-500/10 text-red-100"
                  : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
              }`}>
                {actionState.label}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <PlanetFleetActivityPanel
        loading={activeMissions === null}
        rows={planetFleetActivityRows(planet.occupiedBy?.planetId, activeMissions ?? [], "moon")}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <PublicAssetStatePanel
          icon={<Building2 aria-hidden="true" size={17} />}
          loading={moonStateLoading && moon?.buildings == null}
          rows={publicStateAssetRows(moon?.buildings, moonBuildingCatalog, "level")}
          title="Structures"
        />
        <PublicAssetStatePanel
          icon={<Rocket aria-hidden="true" size={17} />}
          loading={moonStateLoading && moon?.fleet == null}
          rows={publicStateAssetRows(moon?.fleet, shipCatalog, "count")}
          title="Fleet"
        />
        <PublicAssetStatePanel
          icon={<Shield aria-hidden="true" size={17} />}
          loading={moonStateLoading && moon?.defenses == null}
          rows={publicStateAssetRows(moon?.defenses, defenseCatalog, "count")}
          title="Defenses"
        />
      </div>

      <PublicQueuesPanel
        loading={moonStateLoading && moon?.queues == null}
        queues={publicMoonQueueViews(planet)}
      />
    </div>
  );
}

function MoonResourcePills({
  loading,
  rows,
}: {
  loading: boolean;
  rows: Array<{ label: string; value: string }>;
}) {
  if (loading) {
    return (
      <SkeletonRegion className="flex flex-wrap gap-2" label="Loading moon resources">
        {skeletonList(3, (index) => <Skeleton className={`h-9 rounded-md ${["w-32", "w-36", "w-40"][index]}`} key={index} />)}
      </SkeletonRegion>
    );
  }

  return (
    <dl className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <div className="inline-flex h-9 w-fit shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 px-2.5 text-xs leading-none" key={row.label}>
          <dt className="sr-only">{row.label}</dt>
          <dd className="whitespace-nowrap text-center leading-none text-slate-400 tabular-nums">
            {row.label} <span className="font-semibold text-slate-100">{row.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MoonFact({
  href,
  icon,
  label,
  mono = false,
  onClick,
  value,
}: {
  href?: string | undefined;
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

  if (href) {
    return (
      <a
        className={`${className} min-h-11 transition-colors hover:border-cyan-200/35 hover:text-cyan-100`}
        data-celestial-back
        href={href}
        onClick={onClick ? (event) => {
          event.preventDefault();
          onClick();
        } : undefined}
        title={label}
      >
        {content}
      </a>
    );
  }

  return <span className={`${className} min-h-8`}>{content}</span>;
}

export function moonResourceRows(planet: Planet): Array<{ label: string; value: string }> {
  const resources = planet.publicMoonState?.resources;
  if (!resources) {
    return [
      { label: "Metal", value: "Unknown" },
      { label: "Crystal", value: "Unknown" },
      { label: "Deuterium", value: "Unknown" },
    ];
  }
  return [
    { label: "Metal", value: resourceValue(resources.metal) },
    { label: "Crystal", value: resourceValue(resources.crystal) },
    { label: "Deuterium", value: resourceValue(resources.deuterium) },
  ];
}

const moonBuildingCatalog = [
  { asset: "/assets/game/style-pass/generated/buildings/lunar-base.webp", id: 0, label: "Lunar Base" },
  { asset: "/assets/game/style-pass/generated/buildings/moon-robotics-factory.webp", id: 1, label: "Robotics Factory" },
  { asset: "/assets/game/style-pass/generated/buildings/jump-gate.webp", id: 2, label: "Jump Gate" },
  { asset: "/assets/game/style-pass/generated/buildings/moon-shipyard.webp", id: 3, label: "Shipyard" },
] as const;

export function publicMoonQueueViews(planet: Planet): PublicQueueView[] {
  const queues = planet.publicMoonState?.queues;
  if (!queues) return [];

  return [
    publicQueueView("moon-building", "Structures", queues.building, moonBuildingCatalog, "amber", "level"),
    publicQueueView("moon-defense", "Defenses", queues.defense, defenseCatalog, "rose", "quantity"),
  ].filter((queue): queue is PublicQueueView => queue !== null);
}

export function moonRecordRows(planet: Planet): Array<{ label: string; value: string }> {
  const moon = planet.publicMoonState;
  return [
    { label: "Fields", value: moon?.fields === undefined ? "Unknown" : moon.fields.toLocaleString("en-US") },
    { label: "Diameter", value: moon?.diameterKm === undefined ? "Unknown" : `${moon.diameterKm.toLocaleString("en-US")} km` },
    { label: "Parent type", value: formatPlanetType(planet.type) },
  ];
}

export function moonStateRows(
  rows: Array<{ id: number; level?: number; count?: number }> | null | undefined,
  catalog: readonly { id?: number; label: string }[],
  valueKind: "level" | "count",
): Array<{ label: string; value: string }> {
  const visibleRows = (rows ?? [])
    .map((row) => {
      const value = valueKind === "level" ? row.level ?? 0 : row.count ?? 0;
      const catalogItem = catalog.find((item, index) => (item.id ?? index) === row.id);
      return {
        label: catalogItem?.label ?? `ID ${row.id}`,
        value,
      };
    })
    .filter((row) => row.value > 0);

  if (visibleRows.length === 0) {
    return [{ label: "Public records", value: rows ? "No public entries" : "Unavailable" }];
  }

  return visibleRows.map((row) => ({
    label: row.label,
    value: valueKind === "level" ? `Level ${row.value}` : row.value.toLocaleString("en-US"),
  }));
}

export function moonQueueRows(planet: Planet): Array<{ label: string; value: string }> {
  const queues = planet.publicMoonState?.queues;
  if (!queues) return [{ label: "Queues", value: "Public queue data unavailable" }];

  const rows = [
    moonQueueRow("Building", queues.building, moonBuildingCatalog, "Level"),
    moonQueueRow("Defense", queues.defense, defenseCatalog, "x"),
  ];

  return rows.some((row) => row.value !== "Idle")
    ? rows
    : [{ label: "Queues", value: "No active public queues" }];
}

function moonQueueRow(
  label: string,
  queue: NonNullable<NonNullable<Planet["publicMoonState"]>["queues"]>["building"],
  catalog: readonly { id?: number; label: string }[],
  suffix: "Level" | "x",
): { label: string; value: string } {
  if (!queue?.active) return { label, value: "Idle" };
  const item = queue.itemId === undefined
    ? undefined
    : catalog.find((entry, index) => (entry.id ?? index) === queue.itemId);
  const quantity = suffix === "Level"
    ? queue.targetLevel === undefined ? "" : ` Level ${queue.targetLevel}`
    : queue.quantity === undefined ? "" : ` x${queue.quantity.toLocaleString("en-US")}`;
  const readyAt = queue.readyAt ? ` ready ${formatUserTimestamp(timestampToMs(queue.readyAt))}` : "";
  return { label, value: `${item?.label ?? queue.kind ?? "Queue item"}${quantity}${readyAt}` };
}

export function publicMoonActions({
  account,
  actionState,
  attackProtection,
  attackProtectionUnavailable,
  coords,
  defenseState,
  homeCoords,
  homePlanetId,
  onAction,
  planet,
  shipyardState,
  transactionUnavailableReason,
}: {
  account: string | undefined;
  actionState: GalaxyActionState;
  attackProtection: AttackProtectionStatus | null;
  attackProtectionUnavailable: boolean;
  coords: Coordinates;
  defenseState: ChainDefenseState | null | undefined;
  homeCoords: Coordinates | undefined;
  homePlanetId: string | null | undefined;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet;
  shipyardState: ChainShipyardState | null;
  transactionUnavailableReason?: string | undefined;
}): MoonOverviewAction[] {
  const targetActions = galaxyActionsForSlot({
    account,
    attackProtection,
    defenseState,
    homePlanetId,
    isOrigin: false,
    planet,
    shipyardState,
  });
  const actionsByKind = new Map(targetActions.map((action) => [action.kind, action]));
  const pendingReason = actionState.status === "pending" ? actionState.label : undefined;
  const unavailableReason = pendingReason ?? transactionUnavailableReason;

  return [
    {
      disabledReason: "Viewing this moon.",
      kind: "inspect",
      label: "Inspect",
    },
    moonMissionAction({
      action: actionsByKind.get("attack"),
      coords,
      fallbackReason: attackMoonUnavailableReason(attackProtection),
      kind: "attack",
      label: "Attack",
      onAction,
      planet,
      unavailableReason: unavailableReason
        ?? (attackProtectionUnavailable
          ? "Attack protection is unavailable. Refresh before attacking."
          : undefined),
    }),
    moonMissionAction({
      action: actionsByKind.get("transport"),
      coords,
      fallbackReason: "Transport to this moon is unavailable.",
      kind: "transport",
      label: "Transport",
      onAction,
      planet,
      unavailableReason,
    }),
    moonMissionAction({
      action: actionsByKind.get("deploy"),
      coords,
      fallbackReason: "Deploy to this moon is unavailable.",
      kind: "deploy",
      label: "Deploy",
      onAction,
      planet,
      unavailableReason,
    }),
    {
      disabledReason: "Moon defense stationing is not available in the current mission contract.",
      kind: "defend",
      label: "Defend",
    },
  ];
}

function moonMissionAction({
  action,
  coords,
  fallbackReason,
  kind,
  label,
  onAction,
  planet,
  unavailableReason,
}: {
  action: GalaxyAction | undefined;
  coords: Coordinates;
  fallbackReason: string;
  kind: Extract<MoonOverviewAction["kind"], "attack" | "transport" | "deploy">;
  label: string;
  onAction: ((action: GalaxyAction, target: Planet | undefined, coords: Coordinates) => void) | undefined;
  planet: Planet;
  unavailableReason?: string | undefined;
}): MoonOverviewAction {
  if (!action) {
    return { disabledReason: unavailableReason ?? fallbackReason, kind, label };
  }
  if (!action.enabled) {
    return { disabledReason: unavailableReason ?? action.reason, kind, label: action.label };
  }
  if (action.mode !== "mission") {
    return { disabledReason: unavailableReason ?? fallbackReason, kind, label: action.label };
  }
  if (unavailableReason || !onAction) {
    return { disabledReason: unavailableReason ?? "Mission actions unavailable.", kind, label: action.label };
  }
  return {
    kind,
    label: action.label,
    onClick: () => onAction({ ...action, defaultTargetIsMoon: true }, planet, coords),
  };
}

function attackMoonUnavailableReason(attackProtection: AttackProtectionStatus | null): string {
  return formatAttackBlockReason(attackProtection ?? undefined) ?? "Attack is unavailable for this moon.";
}

function sameCoordinates(left: Coordinates | undefined, right: Coordinates | undefined): boolean {
  return Boolean(left && right && left.galaxy === right.galaxy && left.system === right.system && left.position === right.position);
}

function resourceValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toLocaleString("en-US") : value;
  }
}
