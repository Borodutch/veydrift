import { useEffect, useMemo, useState } from "preact/hooks";
import type { Planet, Coordinates } from "../types";
import { getPlanet, planetsFromSystemResponse } from "../data/mockUniverse";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress } from "../walletFlow";

interface Props {
  coords: Coordinates;
  apiBaseUrl?: string | undefined;
  homeCoords?: Coordinates | undefined;
  onBack: () => void;
  onNavigateSystem: (galaxy: number, system: number) => void;
}

export function PlanetDetail({ coords, apiBaseUrl = playableApiUrl, homeCoords, onBack, onNavigateSystem }: Props) {
  const fallbackPlanet = useMemo(
    () => getPlanet(coords.galaxy, coords.system, coords.position),
    [coords.galaxy, coords.position, coords.system],
  );
  const [planet, setPlanet] = useState<Planet | null>(fallbackPlanet);
  const [source, setSource] = useState<"api" | "fallback" | "loading">("loading");
  const isHome = planet ? sameCoordinates(homeCoords, planet) : false;

  useEffect(() => {
    const abortController = new AbortController();
    setPlanet(fallbackPlanet);
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
        setPlanet(planetsFromSystemResponse(payload).find((item) => item.position === coords.position) ?? null);
        setSource("api");
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setSource("fallback");
        }
      });

    return () => abortController.abort();
  }, [apiBaseUrl, coords.galaxy, coords.position, coords.system, fallbackPlanet]);

  if (!planet) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-slate-400">No planet at this position.</p>
        <button
          onClick={onBack}
          className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        >
          ← Back
        </button>
      </div>
    );
  }

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
        {/* Planet image */}
        <div className="flex flex-col gap-3">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-white/15 bg-black/30">
            <img
              src={planet.image}
              alt={planet.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,rgba(5,7,13,0.6),transparent_60%)]" />
            {isHome ? (
              <span className="absolute left-3 top-3 rounded border border-cyan-300/30 bg-cyan-300/15 px-2 py-1 text-xs font-semibold uppercase text-cyan-100">
                Home Planet
              </span>
            ) : null}
          </div>
          {planet.hasMoon && (
            <div className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="h-8 w-8 rounded-full bg-slate-600/30" />
              <span className="text-sm text-slate-400">{planet.moonName}</span>
            </div>
          )}
        </div>

        {/* Planet info */}
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h2 className="text-xl font-semibold text-white">{planet.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span className="capitalize">{planet.type.replace(/-/g, " ")}</span>
              <span className="text-slate-700">|</span>
              <span>Position [{planet.galaxy}:{planet.system}:{planet.position}]</span>
              <span className="text-slate-700">|</span>
              <span>{planet.diameter.toLocaleString()} km</span>
              <span className="text-slate-700">|</span>
              <span>{source === "api" ? "Indexed universe data" : "Neutral deterministic data"}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Owner */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Owner
              </h3>
              {isHome ? (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-cyan-100">
                    Home Planet
                  </span>
                  {planet.ownerId ? (
                    <span className="font-mono text-xs text-slate-500">
                      {shortAddress(planet.ownerId)}
                    </span>
                  ) : (
                    <span className="text-xs leading-5 text-slate-600">
                      This planet is settled by the connected wallet. Indexer owner data is not required for the MVP home marker.
                    </span>
                  )}
                </div>
              ) : planet.ownerId ? (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-white">
                    Occupied
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {shortAddress(planet.ownerId)}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-slate-500">Unclaimed</span>
                  <span className="text-xs leading-5 text-slate-600">
                    Informational only. Planet claiming beyond the first wallet settlement is not enabled in this MVP.
                  </span>
                </div>
              )}
            </div>

            {/* Temperature */}
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

            {/* Resources */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 sm:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Base Resources
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ResourceBar
                  label="Metal"
                  value={planet.resources.metal}
                  max={300}
                  color="bg-slate-400"
                />
                <ResourceBar
                  label="Crystal"
                  value={planet.resources.crystal}
                  max={300}
                  color="bg-signal"
                />
                <ResourceBar
                  label="Deuterium"
                  value={planet.resources.deuterium}
                  max={250}
                  color="bg-blue-400"
                />
                <ResourceBar
                  label="Energy"
                  value={planet.resources.energy}
                  max={100}
                  color="bg-ember"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onNavigateSystem(planet.galaxy, planet.system)}
              className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
            >
              View System
            </button>
          </div>
        </div>
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

function ResourceBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-xs font-medium text-slate-300">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
