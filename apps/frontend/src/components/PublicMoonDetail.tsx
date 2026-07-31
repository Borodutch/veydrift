import { useEffect, useRef, useState } from "preact/hooks";
import type { Coordinates, Planet } from "../types";
import { formatPlanetType, planetsFromSystemResponse } from "../data/mockUniverse";
import { galaxyActionsForSlot, type GalaxyAction } from "../galaxyActions";
import { defenseCatalog, shipCatalog } from "../playableMvp";
import { playableApiUrl } from "../runtimeConfig";
import { formatAttackBlockReason, type AttackProtectionStatus, type GalaxyActionState } from "./GalaxyView";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import { shortAddress, type ChainDefenseState, type ChainShipyardState, type Eip1193Provider } from "../walletFlow";
import { MoonActionStrip, type MoonOverviewAction } from "./MoonPage";
import { MoonImage } from "./PlanetMoonIndicator";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { EntityMediaPanel } from "./EntityMediaPanel";
import { canEditEntityMedia } from "../entityMedia";
import { canApplyPlanetDetailResponse, planetDetailRequestKey, planetDetailVisiblePlanet } from "./PlanetDetail";

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
  provider?: Eip1193Provider | undefined;
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
  provider,
  shipyardState = null,
  transactionUnavailableReason,
}: PublicMoonDetailProps) {
  const [loadedPlanet, setPlanet] = useState<Planet | null>(null);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");
  const [attackProtection, setAttackProtection] = useState<AttackProtectionStatus | null>(null);
  const currentRequestKey = useRef(planetDetailRequestKey(coords));
  currentRequestKey.current = planetDetailRequestKey(coords);
  const planet = planetDetailVisiblePlanet(loadedPlanet, coords);

  useEffect(() => {
    const abortController = new AbortController();
    const requestKey = planetDetailRequestKey(coords);
    setSource("loading");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${coords.galaxy}/systems/${coords.system}?detail=full`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!canApplyPlanetDetailResponse(requestKey, coords, abortController.signal.aborted)
          || currentRequestKey.current !== requestKey) return;
        const apiPlanet = planetsFromSystemResponse(payload).find((item) => item.position === coords.position) ?? null;
        setPlanet(apiPlanet);
        setSource("api");
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setSource("error");
        }
      });

    return () => abortController.abort();
  }, [apiBaseUrl, coords.galaxy, coords.position, coords.system]);

  useEffect(() => {
    const targetPlanetId = planet?.occupiedBy?.planetId;
    const isHome = planet ? sameCoordinates(homeCoords, planet) : false;
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
  }, [account, apiBaseUrl, homeCoords?.galaxy, homeCoords?.position, homeCoords?.system, planet?.occupiedBy?.planetId]);

  const coordinateText = `[${coords.galaxy}:${coords.system}:${coords.position}]`;
  const actions = planet?.hasMoon
      ? publicMoonActions({
        account,
        actionState,
        attackProtection,
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

  if (source === "loading" && !planet) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <button
          className="min-h-11 w-fit rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          ← Back
        </button>
        <div className="celestial-detail celestial-detail-layout">
          <PlanetImageSkeleton className="celestial-detail-artwork aspect-square rounded-lg border border-white/15" />
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-4 w-64 max-w-full animate-pulse rounded bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  if (!planet || !planet.hasMoon) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-slate-400">
          {source === "error" ? "Moon data could not be loaded." : `No moon in orbit at ${coordinateText}.`}
        </p>
        <button
          className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="celestial-detail flex min-w-0 flex-col gap-4 p-4 sm:p-6" data-celestial-detail="moon">
      <button
        className="min-h-11 w-fit rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        data-celestial-back
        onClick={onBack}
        type="button"
      >
        ← System {coordinateText}
      </button>

      <div className="celestial-detail-layout" data-celestial-layout>
        <div className="celestial-detail-artwork aspect-square overflow-hidden rounded-lg border border-cyan-200/20 bg-black/40" data-celestial-artwork data-celestial-media>
          <MoonImage
            alt={planet.moonName ?? "Moon"}
            className="h-full w-full object-contain"
            loading="eager"
            planetType={planet.type}
            sizes="planetPreview"
          />
        </div>

        <div className="grid min-w-0 gap-3" data-celestial-summary>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h2 className="text-xl font-semibold text-white">{planet.moonName ?? "Moon"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>Moon orbiting {planet.name}</span>
              <span className="text-slate-700">|</span>
              <span>{coordinateText}</span>
              <span className="text-slate-700">|</span>
              <span>{formatPlanetType(planet.type)} parent</span>
            </div>
            <div className="mt-4">
              <MoonActionStrip actions={actions} />
            </div>
            {actionState.status !== "idle" ? (
              <div className={`mt-3 rounded border px-3 py-2 text-xs ${
                actionState.status === "error"
                  ? "border-red-300/30 bg-red-500/10 text-red-100"
                  : actionState.status === "success"
                    ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                    : "border-signal/25 bg-signal/10 text-signal"
              }`}>
                {actionState.label}
              </div>
            ) : null}
          </div>

          {planet.occupiedBy?.planetId ? (
            <EntityMediaPanel
              account={account}
              apiBaseUrl={apiBaseUrl}
              canEdit={canEditEntityMedia({
                entityKind: "moon",
                ownerWallet: planet.occupiedBy.owner,
                viewerWallet: account,
              })}
              entityId={planet.occupiedBy.planetId}
              entityKind="moon"
              provider={provider}
            />
          ) : null}

          <div className="celestial-detail-panel-grid">
            <MoonRecordPanel title="Public Owner" rows={[
              { label: "Player", value: planet.occupiedBy?.ownerDisplayName ?? (planet.ownerId ? shortAddress(planet.ownerId) : "Unknown") },
              { label: "Planet", value: planet.name },
              { label: "Planet ID", value: planet.occupiedBy?.planetId ? `#${planet.occupiedBy.planetId}` : "Unknown" },
            ]} />
            <MoonRecordPanel title="Moon Record" rows={moonRecordRows(planet)} />
            <MoonRecordPanel title="Moon Resources" rows={moonResourceRows(planet)} />
            <MoonRecordPanel title="Moon Structures" rows={moonStateRows(planet.publicMoonState?.buildings, moonBuildingCatalog, "level")} />
            <MoonRecordPanel title="Moon Fleet" rows={moonStateRows(planet.publicMoonState?.fleet, shipCatalog, "count")} />
            <MoonRecordPanel title="Moon Defenses" rows={moonStateRows(planet.publicMoonState?.defenses, defenseCatalog, "count")} />
          </div>

          <MoonRecordPanel title="Moon Queues" rows={moonQueueRows(planet)} />
        </div>
      </div>
    </div>
  );
}

function MoonRecordPanel({
  rows,
  title,
}: {
  rows: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-3 text-sm" key={row.label}>
            <span className="text-slate-500">{row.label}</span>
            <span className="min-w-0 break-words text-right font-mono text-slate-200" data-celestial-record-value>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  { id: 0, label: "Lunar Base" },
  { id: 1, label: "Robotics Factory" },
  { id: 2, label: "Jump Gate" },
  { id: 3, label: "Shipyard" },
] as const;

export function moonRecordRows(planet: Planet): Array<{ label: string; value: string }> {
  const moon = planet.publicMoonState;
  return [
    { label: "Fields", value: moon?.fields === undefined ? "Unknown" : moon.fields.toLocaleString("en-US") },
    { label: "Diameter", value: moon?.diameterKm === undefined ? "Unknown" : `${moon.diameterKm.toLocaleString("en-US")} km` },
    { label: "Created", value: moon?.createdAt ? formatUserTimestamp(timestampToMs(moon.createdAt)) : "Unknown" },
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
      unavailableReason,
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
