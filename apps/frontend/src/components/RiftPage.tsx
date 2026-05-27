import { useMemo, useState } from "preact/hooks";
import type { ChainRiftState, PendingWithdrawal, RiftResourceKey, RiftResourceState } from "../walletFlow";

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
  onRefresh: () => void;
  onRequestWithdrawal: (resource: RiftResourceState, amount: string) => void;
  riftState: ChainRiftState | null;
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
  onRefresh,
  onRequestWithdrawal,
  riftState,
}: RiftPageProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const locked = !riftState?.riftAvailable || !riftState.unlocked;
  const unavailableReason = error
    ?? riftState?.unavailableReason
    ?? (!riftState ? "Rift state is not loaded yet." : undefined);

  const updateAmount = (resource: RiftResourceKey, intent: AmountIntent, value: string) => {
    setAmounts((current) => ({
      ...current,
      [`${resource}:${intent}`]: value,
    }));
  };

  const amountFor = (resource: RiftResourceKey, intent: AmountIntent) => amounts[`${resource}:${intent}`] ?? "";

  return (
    <section className="grid gap-4">
      <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">
            Veydrift Rift Stabilizer
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Resource Bridge</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Move open-market resource tokens into your empire instantly, or lock in-game resources for a 30-day Veydrift withdrawal window.
          </p>
        </div>
        <button
          className="inline-flex h-9 items-center justify-center rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
      </header>

      {actionState.status !== "idle" && (
        <Notice tone={actionState.status === "error" ? "danger" : actionState.status === "success" ? "success" : "info"}>
          {actionState.label}
        </Notice>
      )}

      {loading && <Notice tone="info">Loading Rift bridge state.</Notice>}

      {locked ? (
        <LockedRiftState riftState={riftState} unavailableReason={unavailableReason} />
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
                      inputLabel={`Deposit ${resource.label}`}
                      onAction={() => onApprove(resource, depositAmount)}
                      onChange={(value) => updateAmount(resource.key, "deposit", value)}
                      placeholder="0.00"
                      secondaryAction={{
                        disabled: !tokenReady || !depositAmount,
                        label: "Deposit",
                        onClick: () => onDeposit(resource, depositAmount),
                      }}
                    />
                    <AmountControl
                      actionLabel="Request withdrawal"
                      amount={withdrawAmount}
                      disabled={!canTransact || !withdrawAmount}
                      inputLabel={`Withdraw ${resource.label}`}
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
            now={now}
            onFinish={onFinishWithdrawal}
            pendingWithdrawals={riftState.pendingWithdrawals}
          />
        </>
      )}
    </section>
  );
}

function LockedRiftState({
  riftState,
  unavailableReason,
}: {
  riftState: ChainRiftState | null;
  unavailableReason?: string | undefined;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-amber-200/20 bg-amber-200/5 p-4">
      <div>
        <h3 className="text-base font-semibold text-amber-100">Rift bridge locked</h3>
        <p className="mt-1 text-sm leading-6 text-amber-100/75">
          {unavailableReason ?? "Build the Interdimensional Rift Stabilizer before moving resources through the bridge."}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(riftState?.requirements ?? []).map((requirement) => (
          <div className="rounded border border-white/10 bg-black/20 p-3" key={`${requirement.kind}:${requirement.key}`}>
            <p className="text-sm font-medium text-white">{requirement.label}</p>
            <p className="mt-1 text-xs text-slate-400">
              {riftRequirementStatus(requirement)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WithdrawalQueue({
  now,
  onFinish,
  pendingWithdrawals,
}: {
  now: number;
  onFinish: (withdrawal: PendingWithdrawal) => void;
  pendingWithdrawals: PendingWithdrawal[];
}) {
  if (pendingWithdrawals.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
        <h3 className="text-base font-semibold text-white">Pending Withdrawals</h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Requested withdrawals will appear here with their 30-day unlock countdown and finish action.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold text-white">Pending Withdrawals</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {pendingWithdrawals.map((withdrawal) => {
          const ready = isWithdrawalReady(withdrawal, now);
          return (
            <article className="rounded-lg border border-white/10 bg-[#101624] p-4" key={withdrawal.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{resourceLabel(withdrawal.resource)}</p>
                  <p className="mt-1 text-xl font-semibold text-cyan-100">{formatToken(withdrawal.amount)}</p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${ready ? "bg-lime-300/10 text-lime-200" : "bg-amber-200/10 text-amber-100"}`}>
                  {ready ? "Ready" : formatRiftCountdown(withdrawal.unlocksAt, now)}
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Unlocks {formatUnlockDate(withdrawal.unlocksAt)}. Resources remain locked until the finish transaction confirms.
              </p>
              <button
                className="mt-4 inline-flex h-9 w-full items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                disabled={!ready}
                onClick={() => onFinish(withdrawal)}
                type="button"
              >
                Finish withdrawal
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
  inputLabel,
  onAction,
  onChange,
  placeholder,
  secondaryAction,
}: {
  actionLabel: string;
  amount: string;
  disabled: boolean;
  inputLabel: string;
  onAction: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  secondaryAction?: { disabled: boolean; label: string; onClick: () => void } | undefined;
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
            className="inline-flex h-9 items-center justify-center rounded border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
            disabled={disabled}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
          {secondaryAction && (
            <button
              className="inline-flex h-9 items-center justify-center rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
              type="button"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
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
    <div className={`rounded-lg border px-4 py-3 text-sm leading-6 ${toneClass}`}>
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "after the 30-day wait";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
