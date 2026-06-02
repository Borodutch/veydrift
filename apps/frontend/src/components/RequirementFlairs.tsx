export type RequirementFlair = {
  label: string;
  met: boolean;
};

export function RequirementFlairs({
  className = "",
  emptyLabel = "None",
  requirements,
}: {
  className?: string | undefined;
  emptyLabel?: string | undefined;
  requirements: RequirementFlair[];
}) {
  const visibleRequirements = requirements.length > 0
    ? requirements
    : [{ label: emptyLabel, met: true }];

  return (
    <div className={`flex min-h-10 flex-wrap content-start gap-1.5 text-xs ${className}`}>
      {visibleRequirements.map((requirement) => (
        <span
          className={
            requirement.met
              ? "rounded border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-emerald-200"
              : "rounded border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-200"
          }
          key={requirement.label}
        >
          {requirement.label}
        </span>
      ))}
    </div>
  );
}
