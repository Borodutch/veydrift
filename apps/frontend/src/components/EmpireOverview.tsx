import { ChevronDown, ChevronsDownUp, ChevronsUpDown, FlaskConical, Hammer, House, Rocket, Shield, Swords } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { BackendDataStore } from "../backendDataStore";
import { currentResources } from "../currentResources";
import { planetFromSettlementPlanet } from "../data/mockUniverse";
import { formatDurationUntil } from "../durationFormat";
import { moonBuildingAsset, moonImageForType } from "../gameAssets";
import { buildingQueuePreview } from "../overviewData";
import { buildingCatalog, buildingContractIds, defenseCatalog, researchCatalog, shipCatalog } from "../playableMvp";
import { useBackendDataQuery } from "../useBackendDataQuery";
import type {
  ChainInfrastructureState,
  ChainMoonState,
  FleetMissionVisibilityResponse,
  OnChainResources,
  QueueStateResponse,
} from "../walletFlow";
import { formatCompactResource } from "./GalaxyView";
import { getSizedImageSrc } from "../utils/imageSizes";
import { OptimizedImage } from "./OptimizedImage";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";
import {
  compactOverviewLevelLabel,
  compactOverviewResearchLabel,
  FleetSummaryRow,
  managedPlanetOverviewDisplayName,
  summarizeFleets,
  type OverviewMyPlanetActionGroup,
} from "./OverviewPage";

type BodyKind = "planet" | "moon";
type QueueKind = "building" | "research" | "ship" | "defense";
type QueueLine = { kind: QueueKind; label: string; asset?: string | undefined; startedAt?: number | undefined; readyAt?: number | undefined; extra?: number | undefined };
type Tile = { key: string; label: string; asset?: string | undefined; value: string };

const EXPANDED_STORAGE_PREFIX = "veydrift.overview.expanded.v1:";

export function readExpandedBodies(wallet: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(EXPANDED_STORAGE_PREFIX + wallet) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeExpandedBodies(wallet: string, keys: Set<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_PREFIX + wallet, JSON.stringify([...keys]));
  } catch {
    // Storage can be blocked; expansion still works for this session.
  }
}

export function bodyKey(planetId: string, kind: BodyKind): string {
  return kind === "moon" ? `${planetId}:moon` : planetId;
}

/** Missions touching one body: arrivals at it (including the wallet's own fleets sent from its other bodies), departures from it, and fleets returning to it. */
export function bodyFleetVisibility(
  visibility: FleetMissionVisibilityResponse,
  planetId: string,
  kind: BodyKind,
): FleetMissionVisibilityResponse {
  const isMoon = kind === "moon";
  const isTarget = (mission: FleetMissionVisibilityResponse["incoming"][number]) =>
    mission.targetPlanetId === planetId && Boolean(mission.targetIsMoon) === isMoon;
  const isOrigin = (mission: FleetMissionVisibilityResponse["incoming"][number]) =>
    mission.originPlanetId === planetId && Boolean(mission.originIsMoon) === isMoon;
  return {
    ...visibility,
    incoming: [...visibility.incoming, ...visibility.outgoing].filter(isTarget),
    outgoing: visibility.outgoing.filter(isOrigin),
    returning: visibility.returning.filter(isOrigin),
  };
}

function seconds(value: string | null | undefined): number | undefined {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed * 1_000 : undefined;
}

export function queueLine(
  kind: QueueKind,
  queue: QueueStateResponse | null | undefined,
  moonBuildings?: ChainMoonState["buildings"],
  now = Date.now(),
): QueueLine | undefined {
  if (!queue?.active) return undefined;
  const timing = { startedAt: seconds(queue.startedAt), readyAt: seconds(queue.readyAt), extra: queue.backlog?.length || undefined };
  // Completion settles lazily on-chain: past readyAt the work is done, so it is not an active queue.
  // The backend's as-of-now projection is canonical when present.
  if (!timing.extra && (queue.asOfNow?.complete === true || (timing.readyAt !== undefined && timing.readyAt <= now))) return undefined;
  if (kind === "building") {
    const moonBuilding = moonBuildings?.find((building) => building.id === queue.itemId);
    if (moonBuilding) {
      return { kind, label: `${moonBuilding.label} ${queue.targetLevel ?? ""}`.trim(), asset: moonBuildingAsset(moonBuilding.key), ...timing };
    }
    const preview = buildingQueuePreview(queue);
    return { kind, label: compactOverviewLevelLabel(preview.label), asset: preview.asset, ...timing };
  }
  if (kind === "research") {
    const research = researchCatalog.find((item) => item.id === queue.itemId);
    return { kind, label: `${compactOverviewResearchLabel(research?.label ?? "Research")} ${queue.targetLevel ?? ""}`.trim(), asset: research?.asset, ...timing };
  }
  const catalog = kind === "ship" ? shipCatalog : defenseCatalog;
  const unit = catalog.find((item) => item.id === queue.itemId);
  const quantity = queue.asOfNow?.remainingQuantity ?? queue.quantity;
  return { kind, label: `${unit?.label ?? (kind === "ship" ? "Ships" : "Defenses")}${quantity ? ` ×${quantity.toLocaleString()}` : ""}`, asset: unit?.asset, ...timing };
}

function unitTiles(
  kind: "ship" | "defense",
  units: ReadonlyArray<{ id: number; count: number | string }> | null | undefined,
): Tile[] {
  const catalog = kind === "ship" ? shipCatalog : defenseCatalog;
  return (units ?? []).flatMap((unit) => {
    const count = Number(unit.count);
    if (!(count > 0)) return [];
    const item = catalog.find((entry) => entry.id === unit.id);
    return [{ key: `${kind}-${unit.id}`, label: item?.label ?? `#${unit.id}`, asset: item?.asset, value: `×${count.toLocaleString()}` }];
  });
}

export function planetBuildingTiles(levels: ReadonlyArray<{ id: number; level: number }>): Tile[] {
  const byId = new Map(levels.map((building) => [building.id, building.level]));
  return buildingCatalog.flatMap((building) => {
    const level = byId.get(buildingContractIds[building.key]) ?? 0;
    return level > 0 ? [{ key: building.key, label: building.label, asset: building.asset, value: String(level) }] : [];
  });
}

type MoonDetails = {
  buildings: ChainMoonState["buildings"];
  queues: { building: QueueStateResponse | null; ship: QueueStateResponse | null; defense: QueueStateResponse | null };
};

function moonQueueLines(moon: MoonDetails | undefined, now: number): QueueLine[] {
  return [
    queueLine("building", moon?.queues.building, moon?.buildings, now),
    queueLine("ship", moon?.queues.ship, undefined, now),
    queueLine("defense", moon?.queues.defense, undefined, now),
  ].filter((line): line is QueueLine => Boolean(line));
}

export function EmpireOverview({
  account,
  backendData,
  fleetVisibility,
  myPlanets,
  now,
  onSwitchPlanet,
  planetNames,
  renderActions,
  researchQueue,
  selectedActions,
  selectedBodyKind,
  selectedPlanetId,
}: {
  account: string | undefined;
  backendData: BackendDataStore | undefined;
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  myPlanets: readonly OverviewMyPlanetActionGroup[];
  now: number;
  onSwitchPlanet: ((planetId: string, bodyKind: BodyKind) => void) | undefined;
  planetNames: ReadonlyMap<string, string>;
  renderActions?: ((group: OverviewMyPlanetActionGroup, kind: BodyKind) => ComponentChildren) | undefined;
  researchQueue: QueueStateResponse | null | undefined;
  selectedActions?: ComponentChildren;
  selectedBodyKind: BodyKind;
  selectedPlanetId: string | undefined;
}) {
  const wallet = account?.toLowerCase() ?? "";
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpandedBodies(wallet));
  useEffect(() => setExpanded(readExpandedBodies(wallet)), [wallet]);
  const update = (change: (previous: Set<string>) => Set<string>) => {
    setExpanded((previous) => {
      const next = change(previous);
      writeExpandedBodies(wallet, next);
      return next;
    });
  };
  const toggle = (key: string) => update((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const allKeys = myPlanets.flatMap(({ planet }) => planet.moon?.exists ? [bodyKey(planet.planetId, "planet"), bodyKey(planet.planetId, "moon")] : [bodyKey(planet.planetId, "planet")]);
  const anyExpanded = allKeys.some((key) => expanded.has(key));
  const moonCount = myPlanets.filter(({ planet }) => planet.moon?.exists).length;
  const totals = myPlanets.reduce(
    (sum, { planet }) => {
      const add = (resources: OnChainResources | null | undefined) => {
        if (!resources) return;
        sum.metal += Number(resources.metal);
        sum.crystal += Number(resources.crystal);
        sum.deuterium += Number(resources.deuterium);
      };
      add(currentResources(planet));
      if (planet.moon?.exists) add(currentResources(planet.moon));
      const rates = planet.tactical?.productionPerHour;
      if (rates) {
        sum.rate.metal += Number(rates.metal);
        sum.rate.crystal += Number(rates.crystal);
        sum.rate.deuterium += Number(rates.deuterium);
      }
      return sum;
    },
    { metal: 0, crystal: 0, deuterium: 0, rate: { metal: 0, crystal: 0, deuterium: 0 } },
  );

  return (
    <section aria-label="Empire">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.08] px-2 pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">Empire</h1>
          <p className="text-[11px] text-slate-500">
            {myPlanets.length} {myPlanets.length === 1 ? "planet" : "planets"}{moonCount > 0 ? ` · ${moonCount} ${moonCount === 1 ? "moon" : "moons"}` : ""}
          </p>
        </div>
        <ResourceCells
          className="ml-auto"
          rates={{ metal: String(totals.rate.metal), crystal: String(totals.rate.crystal), deuterium: String(totals.rate.deuterium) }}
          resources={{ metal: String(totals.metal), crystal: String(totals.crystal), deuterium: String(totals.deuterium) }}
        />
        <button
          aria-label={anyExpanded ? "Collapse all" : "Expand all"}
          className="inline-grid h-8 w-8 place-items-center rounded border border-white/10 text-slate-400 transition hover:border-cyan-300/40 hover:text-cyan-100"
          onClick={() => update(() => anyExpanded ? new Set() : new Set(allKeys))}
          title={anyExpanded ? "Collapse all" : "Expand all"}
          type="button"
        >
          {anyExpanded ? <ChevronsDownUp aria-hidden="true" size={14} /> : <ChevronsUpDown aria-hidden="true" size={14} />}
        </button>
      </header>
      <ul className="divide-y divide-white/[0.06] border-b border-white/[0.06]">
        {[...myPlanets].sort((a, b) => Number(b.planet.planetId === selectedPlanetId) - Number(a.planet.planetId === selectedPlanetId)).map((group) => {
          const { planet } = group;
          const planetSelected = planet.planetId === selectedPlanetId && selectedBodyKind === "planet";
          const moonSelected = planet.planetId === selectedPlanetId && selectedBodyKind === "moon";
          const rowPlanet = planetFromSettlementPlanet(planet);
          const research = researchQueue?.planetId === planet.planetId ? researchQueue : undefined;
          const moon = planet.moon?.exists ? planet.moon : null;
          return (
            <li key={planet.planetId}>
              <BodyRow
                account={account}
                backendData={backendData}
                expanded={planetSelected || expanded.has(bodyKey(planet.planetId, "planet"))}
                fleetVisibility={fleetVisibility}
                group={group}
                image={rowPlanet.image}
                kind="planet"
                now={now}
                onSwitch={onSwitchPlanet ? () => onSwitchPlanet(planet.planetId, "planet") : undefined}
                onToggle={() => toggle(bodyKey(planet.planetId, "planet"))}
                planetNames={planetNames}
                renderActions={renderActions}
                researchQueue={research}
                selected={planetSelected}
                selectedActions={planetSelected ? selectedActions : undefined}
              />
              {moon ? (
                <BodyRow
                  account={account}
                  backendData={backendData}
                  expanded={moonSelected || expanded.has(bodyKey(planet.planetId, "moon"))}
                  fleetVisibility={fleetVisibility}
                  group={group}
                  image={moonImageForType(rowPlanet.type)}
                  kind="moon"
                  now={now}
                  onSwitch={onSwitchPlanet ? () => onSwitchPlanet(planet.planetId, "moon") : undefined}
                  onToggle={() => toggle(bodyKey(planet.planetId, "moon"))}
                  planetNames={planetNames}
                  renderActions={renderActions}
                  selected={moonSelected}
                  selectedActions={moonSelected ? selectedActions : undefined}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BodyRow({
  account,
  backendData,
  expanded,
  fleetVisibility,
  group,
  image,
  kind,
  now,
  onSwitch,
  onToggle,
  planetNames,
  renderActions,
  researchQueue,
  selected,
  selectedActions,
}: {
  account: string | undefined;
  backendData: BackendDataStore | undefined;
  expanded: boolean;
  fleetVisibility: FleetMissionVisibilityResponse | undefined;
  group: OverviewMyPlanetActionGroup;
  image: string;
  kind: BodyKind;
  now: number;
  onSwitch: (() => void) | undefined;
  onToggle: () => void;
  planetNames: ReadonlyMap<string, string>;
  renderActions: ((group: OverviewMyPlanetActionGroup, kind: BodyKind) => ComponentChildren) | undefined;
  researchQueue?: QueueStateResponse | undefined;
  selected: boolean;
  selectedActions?: ComponentChildren;
}) {
  const { planet } = group;
  const isMoon = kind === "moon";
  const name = isMoon ? "Moon" : managedPlanetOverviewDisplayName(planet);
  const resources = currentResources(isMoon ? planet.moon : planet);
  const caps = isMoon ? undefined : planet.tactical?.storageCaps;
  const rates = isMoon ? undefined : planet.tactical?.productionPerHour;
  const rosterMoon = planet.moon?.buildings && planet.moon.queues
    ? { buildings: planet.moon.buildings as ChainMoonState["buildings"], queues: planet.moon.queues }
    : undefined;
  const queues = isMoon
    ? moonQueueLines(rosterMoon, now)
    : [
        queueLine("building", planet.queues.building, undefined, now),
        queueLine("research", researchQueue, undefined, now),
        queueLine("ship", planet.queues.ship, undefined, now),
        queueLine("defense", planet.queues.defense, undefined, now),
      ].filter((line): line is QueueLine => Boolean(line));
  const missions = fleetVisibility ? summarizeFleets(bodyFleetVisibility(fleetVisibility, planet.planetId, kind), now, planetNames) : undefined;
  const hostile = missions?.lines.some((line) => line.relation === "hostile" && line.direction === "incoming") ?? false;

  return (
    <div className={isMoon ? "border-t border-white/[0.04] pl-6" : undefined}>
      {/* The selected body stays open; elsewhere the row toggles and the name selects. */}
      <div
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 gap-y-1 rounded-md px-2 py-2 text-left transition sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] ${hostile ? "ring-1 ring-inset ring-red-500/60" : ""} ${selected ? "bg-cyan-300/[0.05]" : "cursor-pointer hover:bg-white/[0.03]"}`}
        data-under-attack={hostile ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
        data-body-kind={kind}
        onClick={selected ? undefined : onToggle}
      >
        <span className={`relative shrink-0 overflow-hidden rounded-full bg-white/5 ${isMoon ? "h-6 w-6" : "h-8 w-8"} ${selected ? "ring-1 ring-cyan-300/60" : ""}`}>
          {/* Same fixed 64px animation variant as the planet rail; scaling the 512px master down aliases its edges. */}
          <img alt="" className="h-full w-full object-cover" loading="lazy" src={getSizedImageSrc(image, 64)} />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <button
              className={`truncate font-semibold transition hover:text-cyan-200 disabled:cursor-default disabled:hover:text-inherit ${isMoon ? "text-xs text-slate-300" : "text-[13px] text-white"}`}
              disabled={selected || !onSwitch}
              onClick={(event) => {
                event.stopPropagation();
                onSwitch?.();
              }}
              title={selected ? undefined : `Select ${name}`}
              type="button"
            >
              {name}
            </button>
            {!isMoon && planet.isHomePlanet ? <House aria-label="Home planet" className="shrink-0 text-slate-500" size={11} /> : null}
            <span className="flex shrink-0 items-center gap-1 empty:hidden" onClick={(event) => event.stopPropagation()}>
              {selectedActions}
              {renderActions?.(group, kind)}
            </span>
          </span>
          <span className="block truncate font-mono text-[10px] text-slate-500">
            {planet.coordinates}{!isMoon ? ` · ${planet.fieldsUsed}/${planet.fieldsCapacity}` : ""}
          </span>
        </span>
        <span className="flex items-center justify-end gap-1">
          {queues.map((line) => <QueueBadge key={line.kind} line={line} now={now} />)}
          {missions && missions.activeCount > 0 ? (
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded px-1 text-[10px] font-semibold tabular-nums ${hostile ? "bg-red-500/20 text-red-200" : "bg-white/[0.06] text-slate-300"}`}
              title={`${missions.activeCount} active ${missions.activeCount === 1 ? "mission" : "missions"}`}
            >
              {hostile ? <Swords aria-hidden="true" size={10} /> : <Rocket aria-hidden="true" size={10} />}
              {missions.activeCount}
            </span>
          ) : null}
        </span>
        <ResourceCells caps={caps} className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto" rates={rates} resources={resources} />
        {selected ? (
          <span aria-hidden="true" className="w-3.5" />
        ) : (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
            className="-m-1 p-1 text-slate-500 hover:text-slate-200 sm:col-start-auto"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            type="button"
          >
            <ChevronDown aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} size={14} />
          </button>
        )}
      </div>
      {expanded ? (
        <BodyDetails
          account={account}
          backendData={backendData}
          group={group}
          kind={kind}
          missions={missions}
          now={now}
          queues={queues}
          rosterMoon={rosterMoon}
        />
      ) : null}
    </div>
  );
}

function BodyDetails({
  account,
  backendData,
  group,
  kind,
  missions,
  now,
  queues: rowQueues,
  rosterMoon,
}: {
  account: string | undefined;
  backendData: BackendDataStore | undefined;
  group: OverviewMyPlanetActionGroup;
  kind: BodyKind;
  missions: ReturnType<typeof summarizeFleets> | undefined;
  now: number;
  queues: QueueLine[];
  rosterMoon: MoonDetails | undefined;
}) {
  const { planet } = group;
  const isMoon = kind === "moon";
  const canQuery = Boolean(backendData && account);
  // Current backends put every level and moon detail in the roster; older ones need one read per body.
  const { snapshot: infrastructure } = useBackendDataQuery<ChainInfrastructureState>(
    canQuery && !isMoon && !planet.buildingLevels ? backendData!.queries.infrastructure(account!, planet.planetId) : undefined,
  );
  const { snapshot: moonSnapshot } = useBackendDataQuery<ChainMoonState>(
    canQuery && isMoon && !rosterMoon ? backendData!.queries.moon(account!, planet.planetId) : undefined,
  );
  const fetchedMoon = moonSnapshot?.data;
  const moon: MoonDetails | undefined = rosterMoon ?? (fetchedMoon
    ? { buildings: fetchedMoon.buildings, queues: { building: fetchedMoon.queue, ship: fetchedMoon.shipQueue ?? null, defense: fetchedMoon.defenseQueue ?? null } }
    : undefined);

  const queues = isMoon ? (rosterMoon ? rowQueues : moonQueueLines(moon, now)) : rowQueues;
  const units = isMoon
    ? [...unitTiles("ship", fetchedMoon?.ships ?? planet.moon?.ships), ...unitTiles("defense", fetchedMoon?.defenses ?? planet.moon?.defenses)]
    : [...unitTiles("ship", planet.tactical?.ships.units), ...unitTiles("defense", planet.tactical?.defenses.units)];
  const levels = isMoon ? undefined : planet.buildingLevels ?? infrastructure?.data?.buildings;
  const buildings: Tile[] | undefined = isMoon
    ? moon?.buildings.filter((building) => building.level > 0).map((building) => ({
        key: building.key,
        label: building.label,
        asset: moonBuildingAsset(building.key),
        value: String(building.level),
      }))
    : levels && planetBuildingTiles(levels);
  const loading = buildings === undefined && (isMoon ? moonSnapshot?.freshness !== "failed" : infrastructure?.freshness !== "failed");
  const hasMissions = Boolean(missions && missions.lines.length > 0);
  const empty = !loading && queues.length === 0 && !hasMissions && units.length === 0 && !buildings?.length;

  return (
    <div className="grid gap-3 px-2 pb-4 pt-1 sm:pl-[3.25rem]">
      {empty ? <p className="text-[11px] text-slate-500">Nothing to show here yet.</p> : null}
      {queues.length > 0 || hasMissions ? (
        <div className={`grid gap-3 ${queues.length > 0 && hasMissions ? "lg:grid-cols-2" : ""}`}>
          {queues.length > 0 ? (
            <DetailSection title="Queues">
              <ul className="grid gap-1.5">{queues.map((line) => <QueueRow key={line.kind} line={line} now={now} />)}</ul>
            </DetailSection>
          ) : null}
          {hasMissions ? (
            <DetailSection title="Missions">
              <ul className="grid gap-1">{missions?.lines.map((line) => <FleetSummaryRow key={line.key} line={line} />)}</ul>
            </DetailSection>
          ) : null}
        </div>
      ) : null}
      {units.length > 0 ? <DetailSection title="Fleet & defenses"><TileGrid tiles={units} /></DetailSection> : null}
      {loading ? (
        <DetailSection title="Infrastructure">
          <SkeletonRegion className="flex flex-wrap gap-1" label="Loading infrastructure">
            {skeletonList(6, (index) => <Skeleton className="h-8 w-32 rounded" key={index} />)}
          </SkeletonRegion>
        </DetailSection>
      ) : buildings?.length ? <DetailSection title="Infrastructure"><TileGrid labelled tiles={buildings} /></DetailSection> : null}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function TileGrid({ tiles, labelled = false }: { tiles: Tile[]; labelled?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {tiles.map((tile) => (
        <li
          className="flex max-w-full items-center gap-1.5 rounded border border-white/[0.06] bg-white/[0.03] p-0.5 pr-2"
          key={tile.key}
          title={`${tile.label} ${labelled ? `level ${tile.value}` : tile.value}`}
        >
          <span className="h-7 w-7 shrink-0 overflow-hidden rounded-sm bg-black/30">
            {tile.asset ? <OptimizedImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="icon" src={tile.asset} /> : null}
          </span>
          {labelled ? <span className="min-w-0 truncate text-[11px] text-slate-300">{tile.label}</span> : null}
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-100">{tile.value}</span>
        </li>
      ))}
    </ul>
  );
}

const QUEUE_META: Record<QueueKind, { icon: typeof Hammer; bar: string; text: string; name: string }> = {
  building: { icon: Hammer, bar: "bg-amber-300", text: "text-amber-200", name: "Building" },
  research: { icon: FlaskConical, bar: "bg-violet-300", text: "text-violet-200", name: "Research" },
  ship: { icon: Rocket, bar: "bg-sky-300", text: "text-sky-200", name: "Shipyard" },
  defense: { icon: Shield, bar: "bg-rose-300", text: "text-rose-200", name: "Defense" },
};

function remainingLabel(line: QueueLine, now: number): string {
  if (line.readyAt === undefined) return "Pending";
  return line.readyAt <= now ? "Finishing" : formatDurationUntil(line.readyAt, now);
}

function QueueBadge({ line, now }: { line: QueueLine; now: number }) {
  const meta = QUEUE_META[line.kind];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-grid h-5 w-5 place-items-center rounded bg-white/[0.06] ${meta.text}`}
      title={`${meta.name}: ${line.label} · ${remainingLabel(line, now)}`}
    >
      <Icon aria-hidden="true" size={11} />
    </span>
  );
}

function QueueRow({ line, now }: { line: QueueLine; now: number }) {
  const meta = QUEUE_META[line.kind];
  const progress = line.startedAt !== undefined && line.readyAt !== undefined && line.readyAt > line.startedAt
    ? Math.min(1, Math.max(0, (now - line.startedAt) / (line.readyAt - line.startedAt)))
    : undefined;
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className="h-7 w-7 shrink-0 overflow-hidden rounded-sm bg-black/30">
        {line.asset ? <OptimizedImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="icon" src={line.asset} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2 text-[11px]">
          <span className="truncate font-medium text-slate-100">{line.label}</span>
          {line.extra ? <span className="shrink-0 text-slate-500">+{line.extra} queued</span> : null}
          <span className="ml-auto shrink-0 tabular-nums text-slate-400">{remainingLabel(line, now)}</span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <span className={`block h-full rounded-full ${meta.bar} ${progress === undefined ? "w-1/3 animate-pulse" : ""}`} style={progress === undefined ? undefined : { width: `${progress * 100}%` }} />
        </span>
      </span>
    </li>
  );
}

const RESOURCE_META = [
  { key: "metal", abbr: "M", color: "text-amber-300" },
  { key: "crystal", abbr: "C", color: "text-cyan-300" },
  { key: "deuterium", abbr: "D", color: "text-emerald-300" },
] as const;

function ResourceCells({
  caps,
  className = "",
  rates,
  resources,
}: {
  caps?: OnChainResources | null | undefined;
  className?: string;
  rates?: OnChainResources | null | undefined;
  resources: OnChainResources | null | undefined;
}) {
  return (
    <span className={`grid grid-cols-3 gap-3 tabular-nums sm:w-[13.5rem] ${className}`}>
      {RESOURCE_META.map(({ key, abbr, color }) => {
        const value = resources ? Number(resources[key]) : undefined;
        const cap = caps ? Number(caps[key]) : undefined;
        const full = value !== undefined && cap !== undefined && cap > 0 && value >= cap;
        const rate = rates ? Number(rates[key]) : 0;
        return (
          <span className="min-w-0 text-right" key={key} title={full ? "Storage full" : undefined}>
            <span className={`block truncate text-xs font-semibold ${full ? "text-red-300" : "text-slate-100"}`}>
              <span className={`mr-1 text-[10px] font-bold ${color}`}>{abbr}</span>
              {value === undefined ? "—" : formatCompactResource(value)}
            </span>
            {rate > 0 ? <span className="block truncate text-[10px] text-slate-500">+{formatCompactResource(rate)}/h</span> : null}
          </span>
        );
      })}
    </span>
  );
}
