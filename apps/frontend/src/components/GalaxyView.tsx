import { useState, useEffect } from "preact/hooks";
import type { Planet, Coordinates } from "../types";
import { generateSystem, GALAXY_COUNT, SYSTEM_COUNT, POSITION_COUNT } from "../data/mockUniverse";

interface Props {
  galaxy: number;
  system: number;
  onSelectPlanet: (coords: Coordinates) => void;
  onNavigate: (galaxy: number, system: number) => void;
  onBack: () => void;
}

export function GalaxyView({ galaxy, system, onSelectPlanet, onNavigate, onBack }: Props) {
  const [planets, setPlanets] = useState<Planet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      setPlanets(generateSystem(galaxy, system));
      setLoading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [galaxy, system]);

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

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6">
      {/* Navigation bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur">
        <button
          onClick={onBack}
          className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        >
          ← Universe
        </button>

        <div className="flex items-center gap-2">
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
            className="rounded border border-white/15 bg-void px-2 py-1.5 text-sm text-white outline-none focus:border-signal/50"
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
            className="rounded border border-white/15 bg-void px-2 py-1.5 text-sm text-white outline-none focus:border-signal/50"
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

        <span className="ml-auto text-xs text-slate-500">
          [{galaxy}:{system}:{1}-{POSITION_COUNT}]
        </span>
      </div>

      {/* Galaxy grid */}
      <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur">
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 p-2 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-x-4 sm:p-3">
          {/* Header */}
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Pos
          </div>
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Planet
          </div>
          <div className="hidden px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 sm:block">
            Owner
          </div>
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Alliance
          </div>
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Actions
          </div>

          {loading && (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">
              Loading system data...
            </div>
          )}

          {!loading &&
            positions.map((pos) => {
              const planet = planetByPosition.get(pos);
              return (
                <div
                  key={pos}
                  className="contents [&>*]:border-b [&>*]:border-white/5 [&>*]:py-2 sm:[&>*]:py-2.5"
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
                          <img
                            src={planet.image}
                            alt={planet.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white group-hover:text-signal">
                            {planet.name}
                          </div>
                          <div className="text-xs capitalize text-slate-400">
                            {planet.type.replace(/-/g, " ")}
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
                    {planet?.owner ? (
                      <span className="text-sm text-slate-300">
                        {planet.owner}
                      </span>
                    ) : planet ? (
                      <span className="text-xs text-slate-600">
                        Uninhabited
                      </span>
                    ) : null}
                  </div>

                  <div className="px-2">
                    {planet?.alliance && (
                      <span className="inline-block rounded border border-ember/30 bg-ember/10 px-2 py-0.5 text-xs text-ember">
                        {planet.alliance}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 px-2">
                    {planet?.owner && planet.owner !== "VoidWalker" && (
                      <>
                        <button
                          className="rounded p-1 text-xs text-slate-400 transition-colors hover:bg-signal/10 hover:text-signal"
                          title="Send spy probe"
                        >
                          👁
                        </button>
                        <button
                          className="rounded p-1 text-xs text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          title="Attack"
                        >
                          ⚔
                        </button>
                        <button
                          className="rounded p-1 text-xs text-slate-400 transition-colors hover:bg-signal/10 hover:text-signal"
                          title="Send message"
                        >
                          ✉
                        </button>
                      </>
                    )}
                    {planet && !planet.owner && (
                      <button
                        className="rounded px-2 py-1 text-xs font-medium text-signal transition-colors hover:bg-signal/10"
                        title="Colonize"
                      >
                        Colonize
                      </button>
                    )}
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
        <span>{planets.filter((p) => p.owner).length} colonized</span>
        <span className="text-slate-700">|</span>
        <span>{planets.filter((p) => p.hasMoon).length} with moon</span>
      </div>
    </div>
  );
}
