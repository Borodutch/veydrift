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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Galaxy</h2>
          <p className="text-xs text-slate-400">
            System [{galaxy}:{system}:1-{POSITION_COUNT}]
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2 backdrop-blur">
          <button
            onClick={handlePrevSystem}
            className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            ← Prev
          </button>

          <span className="text-sm text-slate-400">Galaxy</span>
          <select
            value={galaxy}
            onChange={handleGalaxyChange}
            className="rounded border border-white/15 bg-[#070913] px-2 py-1.5 text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
          >
            {Array.from({ length: GALAXY_COUNT }, (_, i) => i + 1).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <span className="text-sm text-slate-400">System</span>
          <select
            value={system}
            onChange={handleSystemChange}
            className="rounded border border-white/15 bg-[#070913] px-2 py-1.5 text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
          >
            {Array.from({ length: SYSTEM_COUNT }, (_, i) => i + 1).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <button
            onClick={handleNextSystem}
            className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Galaxy grid */}
      <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:p-3">
          {/* Header */}
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Pos
          </div>
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Planet
          </div>
          <div className="hidden px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 sm:block">
            Status
          </div>
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Details
          </div>

          {loading && (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">
              Loading system data...
            </div>
          )}

          {!loading &&
            positions.map((pos) => {
              const planet = planetByPosition.get(pos);
              const isHome = planet ? sameCoordinates(homeCoords, planet) : false;
              return (
                <div
                  key={pos}
                  className={`contents [&>*]:border-b [&>*]:border-white/5 [&>*]:py-2 sm:[&>*]:py-2.5 ${isHome ? "[&>*]:bg-cyan-300/5" : ""}`}
                >
                  <div className="px-2 text-sm font-mono text-slate-400">
                    {pos}
                  </div>

                  <div className="flex items-center gap-2 px-2">
                    {planet ? (
                      <button
                        onClick={() =>
                          onSelectPlanet({ galaxy, system, position: pos })
                        }
                        className="group flex items-center gap-2.5 text-left transition-opacity hover:opacity-80"
                      >
                        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/30">
                          <OptimizedImage
                            alt={planet.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            sizes="icon"
                            src={planet.image}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white group-hover:text-signal">
                            {planet.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="capitalize">{planet.type.replace(/-/g, " ")}</span>
                            {isHome ? (
                              <span className="rounded border border-cyan-300/30 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-200">
                                Home
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    ) : (
                      <span className="text-sm text-slate-600 italic">
                        Empty space
                      </span>
                    )}
                  </div>

                  <div className="hidden items-center px-2 sm:flex">
                    {isHome ? (
                      <span className="text-xs font-semibold uppercase text-cyan-200">
                        Home planet
                      </span>
                    ) : planet?.ownerId ? (
                      <span className="font-mono text-sm text-slate-300">
                        {shortAddress(planet.ownerId)}
                      </span>
                    ) : planet ? (
                      <span className="text-xs text-slate-600">
                        Unclaimed
                      </span>
                    ) : (
                      <span className="text-xs text-slate-700">
                        Empty
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 px-2">
                    {planet ? (
                      <button
                        className="rounded px-2 py-1 text-xs font-medium text-signal transition-colors hover:bg-signal/10"
                        onClick={() => onSelectPlanet({ galaxy, system, position: pos })}
                        title="View planet details"
                      >
                        Details
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>{planets.length} planets in this system</span>
        <span className="text-slate-700">|</span>
        <span>{emptyCount} empty slots</span>
        <span className="text-slate-700">|</span>
        <span>{occupiedCount} occupied</span>
        <span className="text-slate-700">|</span>
        <span>{source === "api" ? "Real occupancy data" : homePlanetInSystem ? "Home planet from wallet" : "Occupancy unavailable"}</span>
        <span className="text-slate-700">|</span>
        <span>{planets.filter((p) => p.hasMoon).length} with moon</span>
      </div>
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
