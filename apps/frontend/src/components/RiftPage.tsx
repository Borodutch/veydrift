import type { BuildingKey, ResearchKey } from "../playableMvp";
import type { ChainRiftState, PendingWithdrawal, RiftResourceState } from "../walletFlow";
import { type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { OptimizedImage } from "./OptimizedImage";

type RiftActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

interface RiftPageProps {
  actionState: RiftActionState;
  canTransact: boolean;
  error?: string | undefined;
  loading: boolean;
  now: number;
  onApprove: (resource: RiftResourceState, amount: string) => void;
  onDeposit: (resource: RiftResourceState, amount: string) => void;
  onFinishWithdrawal: (withdrawal: PendingWithdrawal) => void;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onRequestWithdrawal: (resource: RiftResourceState, amount: string) => void;
  riftState: ChainRiftState | null;
  transactionUnavailableReason?: string | undefined;
}

export function RiftPage(_props: RiftPageProps) {
  return <RiftUnderConstruction />;
}

export function RiftUnderConstruction() {
  return (
    <section
      aria-labelledby="rift-under-construction-title"
      className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-xl border border-cyan-300/15 bg-[#0d131f] shadow-2xl shadow-black/30"
    >
      <div className="relative overflow-hidden bg-black/30">
        <OptimizedImage
          alt="An unfinished interdimensional Rift facility surrounded by cranes and construction platforms"
          className="aspect-[4/3] h-full w-full object-cover sm:aspect-[3/2]"
          height={1024}
          loading="eager"
          sizes="(min-width: 1280px) 1024px, calc(100vw - 2rem)"
          src="/assets/game/style-pass/generated/rift-under-construction.webp"
          width={1536}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d131f] via-transparent to-black/10" />
      </div>

      <div className="relative grid justify-items-center gap-2 px-5 pb-7 pt-2 text-center sm:px-8 sm:pb-9">
        <span className="rounded border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-200">
          Under construction
        </span>
        <h2 id="rift-under-construction-title" className="text-xl font-semibold text-white sm:text-2xl">
          The Rift is taking shape
        </h2>
        <p className="max-w-xl text-sm leading-6 text-slate-400">
          Interdimensional systems are still being assembled and stabilized.
        </p>
      </div>
    </section>
  );
}

export function riftRequirementStatus(requirement: Pick<ChainRiftState["requirements"][number], "binary" | "built" | "currentLevel" | "requiredLevel">): string {
  if (requirement.binary) {
    if (requirement.built === null || requirement.currentLevel === null) return "Not available on this deployment";
    return requirement.built || requirement.currentLevel > 0 ? "Built" : "Not built";
  }

  if (requirement.currentLevel === null) return `Requires Level ${requirement.requiredLevel}; not available on this deployment`;
  if (requirement.currentLevel >= requirement.requiredLevel) return `Level ${requirement.currentLevel} / ${requirement.requiredLevel}`;
  return `Level ${requirement.currentLevel} / ${requirement.requiredLevel} required`;
}

export function riftRequirementFlairs(requirements: ChainRiftState["requirements"]): RequirementFlair[] {
  return requirements.map((requirement) => ({
    label: requirement.binary ? requirement.label : `${requirement.label} ${requirement.requiredLevel}`,
    met: riftRequirementMet(requirement),
    target: riftRequirementTarget(requirement),
  }));
}

function riftRequirementMet(requirement: ChainRiftState["requirements"][number]): boolean {
  if (requirement.binary) {
    return Boolean(requirement.built || (requirement.currentLevel !== null && requirement.currentLevel > 0));
  }

  return requirement.currentLevel !== null && requirement.currentLevel >= requirement.requiredLevel;
}

function riftRequirementTarget(requirement: ChainRiftState["requirements"][number]): RequirementTarget | undefined {
  if (requirement.kind === "building" && isRiftBuildingKey(requirement.key)) {
    return { kind: "building", key: requirement.key };
  }

  if (requirement.kind === "technology" && isRiftResearchKey(requirement.key)) {
    return { kind: "research", key: requirement.key };
  }

  return undefined;
}

function isRiftBuildingKey(key: string): key is BuildingKey {
  return riftBuildingRequirementKeys.has(key);
}

function isRiftResearchKey(key: string): key is ResearchKey {
  return riftResearchRequirementKeys.has(key);
}

const riftBuildingRequirementKeys = new Set<string>([
  "interdimensionalRiftStabilizer",
  "roboticsFactory",
  "researchLab",
]);

const riftResearchRequirementKeys = new Set<string>([
  "energy",
  "hyperspace",
]);

export function isWithdrawalReady(withdrawal: PendingWithdrawal, now: number): boolean {
  return withdrawal.ready || Date.parse(withdrawal.unlocksAt) <= now;
}

export function formatRiftCountdown(unlocksAt: string, now: number): string {
  const remainingMs = Math.max(0, Date.parse(unlocksAt) - now);
  if (remainingMs <= 0) return "Ready";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
