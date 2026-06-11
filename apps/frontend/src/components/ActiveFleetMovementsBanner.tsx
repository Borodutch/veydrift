import { useState } from "preact/hooks";
import { ChevronDown, ChevronRight, Radar } from "lucide-preact";
import type { UniverseActiveMissions } from "../planetMissionSubtext";
import { planetMissionLineIcon, planetMissionLineToneClass } from "./PlanetMissionLines";

// Always-visible summary of the universe-wide active fleet movements, shown above the Rankings table
// and the Raid Target Finder list (VEY-KANEO-448).
//
// The enriched per-planet subtext only renders on the row of an involved planet. With sparse live
// traffic plus pagination (Rankings: 50 commanders/page) or sorting (Raid Finder: loot/distance), the
// involved planet can sit on a later page or far down the list, so the enrichment is effectively
// invisible — the recurring "Rankings shows no mission information" QA bounce. This banner hoists the
// same enriched, owner-vs-third-party-classified lines to the top so they stay discoverable regardless
// of where the involved planets fall in the list. Built from `universeActiveMissionLines`, so it stays
// styled identically to the per-row `PlanetMissionLines` (shared tone + icon helpers).
export function ActiveFleetMovementsBanner({
  className,
  missions,
}: {
  className?: string | undefined;
  missions: UniverseActiveMissions;
}) {
  const [expanded, setExpanded] = useState(true);
  const total = missions.lines.length + missions.overflow;
  if (total === 0) return null;

  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] p-3 ${className ?? ""}`.trim()}>
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left text-sm text-slate-200"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <Radar aria-hidden="true" className="shrink-0 text-cyan-200" size={16} />
        <span className="font-semibold">
          {total} active fleet movement{total === 1 ? "" : "s"} in the universe
        </span>
        <span aria-hidden="true" className="ml-auto shrink-0 text-slate-400">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {expanded ? (
        <ul className="mt-2 space-y-1" data-active-fleet-movements>
          {missions.lines.map((line) => (
            <li
              className={`flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] leading-4 ${planetMissionLineToneClass(line)}`}
              key={line.key}
              title={line.title}
            >
              <span aria-hidden="true" className="shrink-0 text-slate-500">
                {planetMissionLineIcon(line)}
              </span>
              {line.planetCoordinates ? (
                <span className="shrink-0 text-slate-400">[{line.planetCoordinates}]</span>
              ) : null}
              <span className="min-w-0 truncate">{line.label}</span>
            </li>
          ))}
          {missions.overflow > 0 ? (
            <li className="font-mono text-[11px] leading-4 text-slate-500">+{missions.overflow} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
