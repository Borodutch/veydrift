import { useMemo, useState } from "preact/hooks";
import type { BuildingKey, ResearchKey } from "../playableMvp";
import { formatUserTimestamp } from "../timestampFormat";
import type { ChainRiftState, PendingWithdrawal, RiftResourceKey, RiftResourceState } from "../walletFlow";
import { PageHeader, RefreshButton } from "./PageHeader";
import { ActionReasonNote } from "./ActionReasonNote";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { RiftSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

type RiftActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type AmountIntent = "deposit" | "withdraw";

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

const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function RiftPage({
  actionState,
  canTransact,
  error,
  loading,
  now,
  onApprove,
  onDeposit,
  onFinishWithdrawal,
  onOpenRequirement,
  onRefresh,
  onRequestWithdrawal,
  riftState,
  transactionUnavailableReason,
}: RiftPageProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const locked = !riftState?.riftAvailable || !riftState.unlocked;
  const unavailableReason = error
    ?? riftState?.unavailableReason
    ?? (!riftState ? "Rift state is not loaded yet." : undefined);
  const initialLoading = loading && !riftState;

  const updateAmount = (resource: RiftResourceKey, intent: AmountIntent, value: string) => {
    setAmounts((current) => ({
      ...current,
      [`${resource}:${intent}`]: value,
    }));
  };

  const amountFor = (resource: RiftResourceKey, intent: AmountIntent) => amounts[`${resource}:${intent}`] ?? "";

  return (
    <section className="grid gap-4">
      <RiftPageHeader loading={loading} onRefresh={onRefresh} />

      {/* Only surface failures. Success/pending action banners are intentionally
          not rendered so the page does not flash transient status banners. */}
      {actionState.status === "error" && (
        <Notice tone="danger">
          {actionState.label}
        </Notice>
      )}
      {!canTransact && transactionUnavailableReason ? (
        <Notice tone="info">
          {transactionUnavailableReason}
        </Notice>
      ) : null}

      {initialLoading ? (
        <RiftSkeleton />
      ) : locked ? (
        isGameUnavailableMessage(unavailableReason) ? (
          <GameUnavailableNotice />
        ) : (
          <LockedRiftState
            onOpenRequirement={onOpenRequirement}
            riftState={riftState}
            unavailableReason={unavailableReason}
          />
        )
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {riftState.resources.map((resource) => {
              const depositAmount = amountFor(resource.key, "deposit");
              const withdrawAmount = amountFor(resource.key, "withdraw");
              const tokenReady = canTransact && Boolean(resource.tokenAddress);
              return (
                <article
                  className="rounded-lg border border-white/10 bg-[#101624] p-4 shadow-2xl shadow-black/10"
                  key={resource.key}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">{resource.label}</h3>
                      <p className="text-xs text-slate-500">Resource token #{resource.resourceId}</p>
                    </div>
                    <span className="rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-200">
                      6 decimals
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm">
                    <BalanceRow label="Wallet tokens" value={formatToken(resource.walletBalance)} />
                    <BalanceRow label="In-game spendable" value={formatToken(resource.inGameBalance)} />
                    <BalanceRow label="Locked withdrawal" value={formatToken(resource.lockedBalance)} />
                    <BalanceRow label="Approved for bridge" value={formatToken(resource.allowance)} />
                  </dl>

                  <div className="mt-4 grid gap-3">
                    <AmountControl
                      actionLabel="Approve"
                      amount={depositAmount}
                      disabled={!tokenReady || !depositAmount}
                      disabledReason={!canTransact ? transactionUnavailableReason : !resource.tokenAddress ? "Token address is not configured for this resource yet." : undefined}
                      inputLabel={`Deposit ${resource.label}`}
                      onAction={() => onApprove(resource, depositAmount)}
                      onChange={(value) => updateAmount(resource.key, "deposit", value)}
                      placeholder="0.00"
                      secondaryAction={{
                        disabled: !tokenReady || !depositAmount,
                        disabledReason: !canTransact ? transactionUnavailableReason : !resource.tokenAddress ? "Token address is not configured for this resource yet." : undefined,
                        label: "Deposit",
                        onClick: () => onDeposit(resource, depositAmount),
                      }}
                    />
                    <AmountControl
                      actionLabel="Start 28-day extraction"
                      amount={withdrawAmount}
                      disabled={!canTransact || !withdrawAmount}
                      disabledReason={!canTransact ? transactionUnavailableReason : undefined}
                      inputLabel={`Extract ${resource.label}`}
                      onAction={() => onRequestWithdrawal(resource, withdrawAmount)}
                      onChange={(value) => updateAmount(resource.key, "withdraw", value)}
                      placeholder="0.00"
                    />
                  </div>

                  {!resource.tokenAddress && (
                    <p className="mt-3 text-xs leading-5 text-amber-200">
                      Token address is not configured for this resource yet.
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          <WithdrawalQueue
            canTransact={canTransact}
            now={now}
            onFinish={onFinishWithdrawal}
            pendingWithdrawals={riftState.pendingWithdrawals}
            transactionUnavailableReason={transactionUnavailableReason}
          />
        </>
      )}
    </section>
  );
}

export function RiftPageHeader({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <PageHeader
      actions={<RefreshButton loading={loading} onRefresh={onRefresh} title="Refresh Rift state" />}
      title="Rift Stabilizer"
    />
  );
}

function LockedRiftState({
  onOpenRequirement,
  riftState,
  unavailableReason,
}: {
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  riftState: ChainRiftState | null;
  unavailableReason?: string | undefined;
}) {
  const requirements = riftRequirementFlairs(riftState?.requirements ?? []);

  return (
    <div className="grid gap-4 rounded-lg border border-amber-200/20 bg-amber-200/5 p-4">
      <div>
        <h3 className="text-base font-semibold text-amber-100">Rift Stabilizer locked</h3>
        <p className="mt-1 text-sm leading-6 text-amber-100/75">
          {unavailableReason ?? "Build the Rift Stabilizer before moving resources through the bridge."}
        </p>
      </div>

      <RequirementFlairs
        emptyLabel="Rift requirement state is not available."
        onOpenRequirement={onOpenRequirement}
        requirements={requirements}
      />
    </div>
  );
}

function WithdrawalQueue({
  canTransact,
  now,
  onFinish,
  pendingWithdrawals,
  transactionUnavailableReason,
}: {
  canTransact: boolean;
  now: number;
  onFinish: (withdrawal: PendingWithdrawal) => void;
  pendingWithdrawals: PendingWithdrawal[];
  transactionUnavailableReason?: string | undefined;
}) {
  if (pendingWithdrawals.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
        <h3 className="text-base font-semibold text-white">Active Rift extractions</h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Extractions remain fully raidable for 28 days before they can be finalized.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold text-white">Active Rift extractions</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {pendingWithdrawals.map((withdrawal) => {
          const ready = isWithdrawalReady(withdrawal, now);
          const legacy = withdrawal.kind === "legacyMarketWithdrawal";
          return (
            <article className="rounded-lg border border-white/10 bg-[#101624] p-4" key={withdrawal.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {legacy ? "Grandfathered legacy withdrawal" : resourceLabel(withdrawal.resource)}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-cyan-100">{formatToken(withdrawal.amount)}</p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${ready ? "bg-lime-300/10 text-lime-200" : "bg-amber-200/10 text-amber-100"}`}>
                  {ready ? "Ready" : formatRiftCountdown(withdrawal.unlocksAt, now)}
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                {legacy
                  ? `Unlocks ${formatUnlockDate(withdrawal.unlocksAt)}. This retired withdrawal is shown only so its owner can recover it.`
                  : `Unlocks ${formatUnlockDate(withdrawal.unlocksAt)}. Resources remain 100% raidable until the finish transaction confirms.`}
              </p>
              <button
                className="mt-4 inline-flex h-11 sm:h-9 w-full items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!ready || !canTransact}
                onClick={() => onFinish(withdrawal)}
                title={!canTransact ? transactionUnavailableReason : undefined}
                type="button"
              >
                {legacy ? "Finish legacy withdrawal" : "Finalize extraction"}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AmountControl({
  actionLabel,
  amount,
  disabled,
  disabledReason,
  inputLabel,
  onAction,
  onChange,
  placeholder,
  secondaryAction,
}: {
  actionLabel: string;
  amount: string;
  disabled: boolean;
  disabledReason?: string | undefined;
  inputLabel: string;
  onAction: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  secondaryAction?: { disabled: boolean; disabledReason?: string | undefined; label: string; onClick: () => void } | undefined;
}) {
  return (
    <div className="grid gap-2">
      <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {inputLabel}
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className="h-9 min-w-0 rounded border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
          inputMode="decimal"
          onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
          placeholder={placeholder}
          value={amount}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            className="inline-flex h-11 sm:h-9 items-center justify-center rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={disabled}
            onClick={onAction}
            title={disabled ? disabledReason : undefined}
            type="button"
          >
            {actionLabel}
          </button>
          {secondaryAction && (
            <button
              className="inline-flex h-11 sm:h-9 items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
              title={secondaryAction.disabled ? secondaryAction.disabledReason : undefined}
              type="button"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
        <ActionReasonNote reason={disabled ? disabledReason : undefined} />
        {!disabled && secondaryAction?.disabled ? (
          <ActionReasonNote reason={secondaryAction.disabledReason} />
        ) : null}
      </div>
    </div>
  );
}

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-slate-100">{value}</dd>
    </div>
  );
}

function Notice({ children, tone }: { children: string; tone: "danger" | "info" | "success" }) {
  const toneClass = tone === "danger"
    ? "border-red-300/20 bg-red-300/10 text-red-100"
    : tone === "success"
      ? "border-lime-300/20 bg-lime-300/10 text-lime-100"
      : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  return (
    <div className={`notice-enter rounded-lg border px-4 py-3 text-sm leading-6 ${toneClass}`}>
      {children}
    </div>
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

function formatUnlockDate(value: string): string {
  return formatUserTimestamp(value, { fallback: "after the 30-day wait" });
}

function formatToken(value: string | null): string {
  if (value === null) return "Not configured";
  const raw = BigInt(value);
  const whole = raw / 1_000_000n;
  const fraction = raw % 1_000_000n;
  const asNumber = Number(whole) + Number(fraction) / 1_000_000;
  if (asNumber >= 10_000) return integerFormatter.format(asNumber);
  return formatter.format(asNumber);
}

function resourceLabel(resource: RiftResourceKey): string {
  const labels = {
    metal: "Metal",
    crystal: "Crystal",
    deuterium: "Deuterium",
  } satisfies Record<RiftResourceKey, string>;
  return labels[resource];
}
