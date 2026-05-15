import { useState, useEffect } from "preact/hooks";
import type { Planet, Coordinates } from "../types";
import {
  ensurePlanetAtCoordinates,
  generateSystem,
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
  planetsFromSystemResponse
} from "../data/mockUniverse";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress } from "../walletFlow";
import { OptimizedImage } from "./OptimizedImage";

interface Props {
  galaxy: number;
  system: number;
  apiBaseUrl?: string | undefined;
  homeCoords?: Coordinates | undefined;
  onSelectPlanet: (coords: Coordinates) => void;
  onNavigate: (galaxy: number, system: number) => void;
}

export function GalaxyView({ galaxy, system, apiBaseUrl = playableApiUrl, homeCoords, onSelectPlanet, onNavigate }: Props) {
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "fallback" | "loading">("loading");
  const homeCoordsInSystem = homeCoords?.galaxy === galaxy && homeCoords.system === system
    ? homeCoords
    : undefined;

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    setSource("loading");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${galaxy}/systems/${system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        setPlanets(ensurePlanetAtCoordinates(planetsFromSystemResponse(payload), homeCoordsInSystem));
        setSource("api");
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setPlanets(ensurePlanetAtCoordinates(generateSystem(galaxy, system), homeCoordsInSystem));
          setSource("fallback");
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [apiBaseUrl, galaxy, homeCoordsInSystem?.position, system]);

  const handlePrevSystem = () => {
    let newSystem = system - 1;
    let newGalaxy = galaxy;
    if (newSystem < 1) {
      newSystem = SYSTEM_COUNT;
      newGalaxy = galaxy - 1;
      if (newGalaxy < 1) newGalaxy = GALAXY_COUNT;
    }
    onNavigate(newGalaxy, newSystem);
  };

  const handleNextSystem = () => {
    let newSystem = system + 1;
    let newGalaxy = galaxy;
    if (newSystem > SYSTEM_COUNT) {
      newSystem = 1;
      newGalaxy = galaxy + 1;
      if (newGalaxy > GALAXY_COUNT) newGalaxy = 1;
    }
    onNavigate(newGalaxy, newSystem);
  };

  const handleGalaxyChange = (e: Event) => {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    onNavigate(val, system);
  };

  const handleSystemChange = (e: Event) => {
    const val = parseInt((e.target as HTMLSelectElement).value, 10);
    onNavigate(galaxy, val);
  };

  const planetByPosition = new Map<number, Planet>();
  for (const p of planets) planetByPosition.set(p.position, p);

  const positions = Array.from({ length: POSITION_COUNT }, (_, i) => i + 1);
  const homePlanetInSystem = planets.find((planet) => sameCoordinates(homeCoords, planet));
  const occupiedCount = planets.filter((planet) => planet.occupiedBy || sameCoordinates(homeCoords, planet)).length;
  const emptyCount = POSITION_COUNT - planets.length;
  const occupiedSummary = occupiedCount > 0 ? `${occupiedCount} occupied` : "No indexed occupants";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Galaxy</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            System [{galaxy}:{system}:1-{POSITION_COUNT}]
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-[#101624] p-2 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
          <button
            onClick={handlePrevSystem}
            className="h-9 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            ← Prev
          </button>

          <ControlSelect
            label="Galaxy"
            value={galaxy}
            onChange={handleGalaxyChange}
            options={GALAXY_COUNT}
          />

          <ControlSelect
            label="System"
            value={system}
            onChange={handleSystemChange}
            options={SYSTEM_COUNT}
          />

          <button
            onClick={handleNextSystem}
            className="h-9 rounded border border-white/15 bg-white/8 px-3 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-white/10 bg-[#101624] p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-1 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{planets.length} planet slots</span>
            <span className="text-slate-700">/</span>
            <span>{emptyCount} empty</span>
            <span className="text-slate-700">/</span>
            <span>{occupiedSummary}</span>
          </div>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-500">
            {source === "api" ? "Real occupancy data" : homePlanetInSystem ? "Wallet home injected" : "Fallback universe"}
          </span>
        </div>

        <div className="grid gap-1.5">
          {loading && (
            <div className="py-12 text-center text-sm text-slate-400">
              Loading system data...
            </div>
          )}

          {!loading &&
            positions.map((pos) => {
              const planet = planetByPosition.get(pos);
              const isHome = planet ? sameCoordinates(homeCoords, planet) : false;
              return (
                <GalaxySlot
                  galaxy={galaxy}
                  isHome={isHome}
                  key={pos}
                  onSelectPlanet={onSelectPlanet}
                  planet={planet}
                  position={pos}
                  system={system}
                />
              );
            })}
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-600">
        Empty positions are deterministic unoccupied slots. Planet entries can be inspected; no unavailable colonize,
        attack, alliance, fleet, or message actions are shown.
      </p>
    </div>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (event: Event) => void;
  options: number;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded border border-white/15 bg-[#070913] px-2">
      <span className="text-[11px] font-medium uppercase text-slate-500">{label}</span>
      <span className="min-w-5 text-center font-mono text-sm font-semibold text-white">{value}</span>
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        className="h-7 w-9 rounded border border-white/10 bg-[#101624] text-center text-xs text-slate-200 outline-none [color-scheme:dark] focus:border-signal/50"
      >
        {Array.from({ length: options }, (_, i) => i + 1).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function GalaxySlot({
  galaxy,
  system,
  position,
  planet,
  isHome,
  onSelectPlanet,
}: {
  galaxy: number;
  system: number;
  position: number;
  planet: Planet | undefined;
  isHome: boolean;
  onSelectPlanet: (coords: Coordinates) => void;
}) {
  if (!planet) {
    return (
      <div className="grid min-h-16 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-md border border-white/5 bg-black/15 px-3 py-2 sm:grid-cols-[4rem_minmax(0,1fr)_7rem]">
        <SlotNumber position={position} muted />
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-500">Empty space</div>
          <div className="text-xs text-slate-700">No generated or indexed planet at this position.</div>
        </div>
        <div className="hidden justify-self-end text-xs text-slate-700 sm:block">No action</div>
      </div>
    );
  }

  const ownerLabel = isHome
    ? "Settled home"
    : planet.ownerId
      ? shortAddress(planet.ownerId)
      : "Unclaimed";

  return (
    <button
      className={`group grid min-h-16 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[4rem_minmax(0,1fr)_7rem_auto] ${
        isHome
          ? "border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_18px_rgba(103,232,249,0.10)]"
          : "border-white/10 bg-white/[0.035] hover:border-signal/35 hover:bg-white/[0.06]"
      }`}
      onClick={() => onSelectPlanet({ galaxy, system, position })}
      type="button"
    >
      <SlotNumber position={position} />

      <div className="flex min-w-0 items-center gap-3">
        <div className={`relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-md border bg-black/30 ${
          isHome ? "border-cyan-300/35" : "border-white/15"
        }`}>
          <OptimizedImage
            alt={planet.name}
            className="h-full w-full object-cover"
            loading="lazy"
            sizes="icon"
            src={planet.image}
          />
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-white group-hover:text-signal">
              {planet.name}
            </span>
            {isHome ? (
              <span className="rounded border border-cyan-300/35 bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">
                Home
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="capitalize">{planet.type.replace(/-/g, " ")}</span>
            <span className="text-slate-700">/</span>
            <span>{planet.fields} fields</span>
            {planet.hasMoon ? (
              <>
                <span className="text-slate-700">/</span>
                <span>Moon</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`hidden justify-self-end text-xs font-medium sm:block ${isHome ? "text-cyan-100" : "text-slate-500"}`}>
        {ownerLabel}
      </div>

      <span className="justify-self-end rounded border border-signal/25 px-2 py-1 text-xs font-medium text-signal group-hover:bg-signal/10">
        Inspect
      </span>
    </button>
  );
}

function SlotNumber({ position, muted = false }: { position: number; muted?: boolean }) {
  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded border font-mono text-sm sm:h-10 sm:w-10 ${
      muted
        ? "border-white/5 bg-white/[0.02] text-slate-700"
        : "border-white/10 bg-black/20 text-slate-400"
    }`}>
      {position}
    </div>
  );
}

function sameCoordinates(homeCoords: Coordinates | undefined, planet: Planet): boolean {
  return Boolean(
    homeCoords
      && homeCoords.galaxy === planet.galaxy
      && homeCoords.system === planet.system
      && homeCoords.position === planet.position
  );
}
