import type { PlanetMissionLine, PlanetMissionSubtext } from "../planetMissionSubtext";

// Shared per-planet mission subtext list used by both the Rankings page (VEY-445) and the Raid Target
// Finder (VEY-446) so the two surfaces classify and style fleet lines identically (VEY-KANEO-448).
//
// Styling encodes the classification at a glance:
// - third-party hostile (incoming attack)  -> rose/danger text + a ⚔ marker
// - third-party friendly (incoming visit)  -> neutral slate text
// - owner-originated incoming/returning     -> amber text
// - owner-originated outgoing               -> sky text
export function PlanetMissionLines({
  className,
  planetId,
  subtext,
}: {
  className?: string | undefined;
  planetId: string;
  subtext: PlanetMissionSubtext;
}) {
  if (subtext.lines.length === 0) return null;
  return (
    <ul className={`space-y-0.5 ${className ?? ""}`.trim()} data-planet-missions={planetId}>
      {subtext.lines.map((line) => (
        <li
          className={`flex min-w-0 items-center gap-1 truncate font-mono text-[10px] leading-4 ${planetMissionLineToneClass(line)}`}
          key={line.key}
          title={line.title}
        >
          <span aria-hidden="true" className="shrink-0 text-slate-500">
            {planetMissionLineIcon(line)}
          </span>
          <span className="min-w-0 truncate">{line.label}</span>
        </li>
      ))}
      {subtext.overflow > 0 ? (
        <li className="font-mono text-[10px] leading-4 text-slate-500">+{subtext.overflow} more</li>
      ) : null}
    </ul>
  );
}

export function planetMissionLineToneClass(line: PlanetMissionLine): string {
  if (line.origin === "third-party") {
    return line.hostile ? "text-rose-300/90" : "text-slate-300/80";
  }
  return line.direction === "incoming" ? "text-amber-200/80" : "text-sky-200/70";
}

export function planetMissionLineIcon(line: PlanetMissionLine): string {
  if (line.origin === "third-party" && line.hostile) return "⚔";
  return line.direction === "incoming" ? "↘" : "↗";
}
