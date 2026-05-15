import type { Planet, Coordinates } from "../types";
import { getPlanet } from "../data/mockUniverse";

interface Props {
  coords: Coordinates;
  onBack: () => void;
  onNavigateSystem: (galaxy: number, system: number) => void;
}

export function PlanetDetail({ coords, onBack, onNavigateSystem }: Props) {
  const planet = getPlanet(coords.galaxy, coords.system, coords.position);

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
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Owner */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Owner
              </h3>
              {planet.owner ? (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-white">
                    {planet.owner}
                  </span>
                  {planet.ownerId && (
                    <span className="font-mono text-xs text-slate-500">
                      {planet.ownerId.slice(0, 12)}...{planet.ownerId.slice(-4)}
                    </span>
                  )}
                  {planet.alliance && (
                    <span className="mt-1 inline-block w-fit rounded border border-ember/30 bg-ember/10 px-2 py-0.5 text-xs text-ember">
                      {planet.alliance}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-slate-500">Uninhabited</span>
                  <button className="w-fit rounded border border-signal/30 bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal transition-colors hover:bg-signal/20">
                    Colonize
                  </button>
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
            {planet.owner && planet.owner !== "VoidWalker" && (
              <>
                <button className="rounded border border-signal/30 bg-signal/10 px-4 py-2 text-sm text-signal transition-colors hover:bg-signal/20">
                  Send Spy Probe
                </button>
                <button className="rounded border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20">
                  Attack
                </button>
                <button className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white">
                  Send Message
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
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
