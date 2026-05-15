import { GALAXY_COUNT, SYSTEM_COUNT } from "../data/mockUniverse";

interface Props {
  onSelectGalaxy: (galaxy: number) => void;
  onSelectSystem: (galaxy: number, system: number) => void;
  onBack: () => void;
}

export function UniverseView({ onSelectGalaxy, onSelectSystem, onBack }: Props) {
  const galaxies = Array.from({ length: GALAXY_COUNT }, (_, i) => i + 1);
  const quickSystems = [1, 42, 88, 137, 199];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        >
          ← Home
        </button>
        <h2 className="text-lg font-semibold text-white">Universe Overview</h2>
      </div>

      {/* Galaxy cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {galaxies.map((g) => (
          <button
            key={g}
            onClick={() => onSelectGalaxy(g)}
            className="group flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-4 transition-all hover:border-signal/30 hover:bg-white/8"
          >
            <div className="relative h-16 w-16 overflow-hidden rounded-full border border-white/15">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(128,241,255,0.3),transparent_60%)]" />
              <div className="absolute inset-2 rounded-full bg-[radial-gradient(circle_at_40%_40%,rgba(5,7,13,0.9),rgba(20,30,50,0.6))]" />
              <div className="absolute bottom-1 left-1/2 h-8 w-20 -translate-x-1/2 rounded-full bg-black/40 blur-md" />
            </div>
            <span className="text-sm font-medium text-slate-300 group-hover:text-signal">
              Galaxy {g}
            </span>
            <span className="text-xs text-slate-500">{SYSTEM_COUNT} systems</span>
          </button>
        ))}
      </div>

      {/* Quick navigation */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Quick Jump
        </h3>
        <div className="flex flex-wrap gap-2">
          {galaxies.map((g) =>
            quickSystems.map((s) => (
              <button
                key={`${g}-${s}`}
                onClick={() => onSelectSystem(g, s)}
                className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-signal/30 hover:bg-white/8 hover:text-signal"
              >
                [{g}:{s}:1]
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
