import type { BuildingKey, ResearchKey, ShipKey } from "../playableMvp";

export type RequirementTarget =
  | { kind: "building"; key: BuildingKey }
  | { kind: "research"; key: ResearchKey }
  | { kind: "ship"; key: ShipKey };

export type RequirementFlair = {
  label: string;
  met: boolean;
  target?: RequirementTarget | undefined;
};

export function RequirementFlairs({
  className = "",
  emptyLabel = "None",
  onOpenRequirement,
  requirements,
}: {
  className?: string | undefined;
  emptyLabel?: string | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  requirements: RequirementFlair[];
}) {
  const visibleRequirements = requirements.length > 0
    ? requirements
    : [{ label: emptyLabel, met: true }];

  return (
    <div className={`flex min-h-10 flex-wrap content-start gap-1.5 text-xs ${className}`}>
      {visibleRequirements.map((requirement) => (
        <RequirementChip
          key={`${requirement.label}:${requirement.target?.kind ?? "info"}:${requirement.target?.key ?? ""}`}
          onOpenRequirement={onOpenRequirement}
          requirement={requirement}
        />
      ))}
    </div>
  );
}

function RequirementChip({
  onOpenRequirement,
  requirement,
}: {
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  requirement: RequirementFlair;
}) {
  const clickable = Boolean(requirement.target && onOpenRequirement);
  const toneClass = requirement.met
    ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
    : "border-amber-300/20 bg-amber-300/10 text-amber-200";
  const clickableClass = clickable
    ? "cursor-pointer transition hover:border-cyan-300/50 hover:bg-cyan-300/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
    : "";
  const className = `rounded border px-2 py-1 ${toneClass} ${clickableClass}`;

  const target = requirement.target;
  if (!target || !onOpenRequirement) {
    return <span className={className}>{requirement.label}</span>;
  }

  return (
    <button
      aria-label={`Open ${requirement.label} requirement`}
      className={className}
      onClick={() => onOpenRequirement(target)}
      type="button"
    >
      {requirement.label}
    </button>
  );
}
