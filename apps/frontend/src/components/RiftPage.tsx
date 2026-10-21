import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CircleCheck,
  Coins,
  Crosshair,
  History,
  Hourglass,
  Lock,
  Swords,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-preact";
import { buildingCatalog, type BuildingKey, type ResearchKey } from "../playableMvp";
import { formatIntegerAmount } from "../numberFormat";
import { playerNotice } from "../playerNotice";
import { formatUserTimestamp } from "../timestampFormat";
import {
  fetchRiftTokenWallet,
  parseRiftTokenAmount,
  shortAddress,
  type ChainRiftState,
  type ManagedPlanetResponse,
  type PendingWithdrawal,
  type RiftHistoryEntry,
  type RiftResourceKey,
  type RiftResourceState,
  type RiftTokenWallet,
} from "../walletFlow";
import { ActionReasonNote } from "./ActionReasonNote";
import { AnimatedProgressBar } from "./AnimatedProgressBar";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { InlineStateNotice } from "./InlineStateNotice";
import { RiftSkeleton } from "./LoadingSkeletons";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";
import { OptimizedImage } from "./OptimizedImage";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";

type RiftActionState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string }
  | { status: "error"; label: string };

type RiftMode = "extract" | "inject";
type RiftPlanet = Pick<ManagedPlanetResponse, "planetId" | "name" | "coordinates" | "buildingLevels">;
type TokenWallet = Partial<Record<RiftResourceKey, RiftTokenWallet>>;

interface RiftPageProps {
  /** The planet owner: extractions pay out to this wallet. */
  account?: string | undefined;
  actionState: RiftActionState;
  canTransact: boolean;
  error?: string | undefined;
  gameContract?: string | undefined;
  loading: boolean;
  now: number;
  onApprove: (resource: RiftResourceState, amount: bigint) => void;
  onDeposit: (resource: RiftResourceState, amount: bigint) => void;
  onFinishWithdrawal: (withdrawal: PendingWithdrawal) => void;
  onOpenRaidFinder?: (() => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onRequestWithdrawal: (resource: RiftResourceState, amount: bigint) => void;
  onSelectPlanet?: ((planetId: string) => void) | undefined;
  planets?: readonly RiftPlanet[] | undefined;
  riftState: ChainRiftState | null;
  /** The app's Base read RPC; token balances never depend on the wallet's network. */
  rpcUrl?: string | undefined;
  /** The connected wallet: it approves and pays for injections (a delegate signs for its main). */
  signerAccount?: string | undefined;
  transactionUnavailableReason?: string | undefined;
}

const MAX_UINT128 = (1n << 128n) - 1n;
const DEFAULT_LOCK_SECONDS = 28 * 24 * 60 * 60;
const RIFT_ART = "/assets/game/style-pass/generated/buildings/interdimensional-rift-stabilizer-mid.webp";
const RIFT_STABILIZER_BUILDING_ID = 15;
const stabilizerCost = (() => {
  const cost = buildingCatalog.find((building) => building.key === "interdimensionalRiftStabilizer")?.baseCost ?? { metal: 0, crystal: 0, deuterium: 0 };
  return `${cost.metal.toLocaleString("en-US")} Metal, ${cost.crystal.toLocaleString("en-US")} Crystal and ${cost.deuterium.toLocaleString("en-US")} Deuterium`;
})();

const resourceStyles: Record<RiftResourceKey, { label: string; symbol: string; dot: string; text: string; selected: string }> = {
  metal: { label: "Metal", symbol: "vMETAL", dot: "bg-amber-300", text: "text-amber-200", selected: "border-amber-300/50 bg-amber-300/10 text-amber-100" },
  crystal: { label: "Crystal", symbol: "vCRYSTAL", dot: "bg-cyan-300", text: "text-cyan-200", selected: "border-cyan-300/50 bg-cyan-300/10 text-cyan-100" },
  deuterium: { label: "Deuterium", symbol: "vDEUT", dot: "bg-emerald-300", text: "text-emerald-200", selected: "border-emerald-300/50 bg-emerald-300/10 text-emerald-100" },
};
const resourceKeys = ["metal", "crystal", "deuterium"] as const satisfies readonly RiftResourceKey[];

const buttonBase = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:min-h-10";
const cyanButton = `${buttonBase} border-cyan-300/40 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20`;
const amberButton = `${buttonBase} border-amber-300/45 bg-amber-300/10 text-amber-50 hover:bg-amber-300/20`;
const emeraldButton = `${buttonBase} border-emerald-300/45 bg-emerald-300/10 text-emerald-50 hover:bg-emerald-300/20`;
const quietButton = `${buttonBase} border-white/10 bg-white/5 text-slate-200 hover:bg-white/10`;
const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70";

export function RiftPage(props: RiftPageProps) {
  const { actionState, canTransact, error, loading, now, onRefresh, planets = [], riftState, transactionUnavailableReason } = props;
  const [txRevision, setTxRevision] = useState(0);
  // Re-read wallet tokens after every confirmed Rift transaction (approvals change nothing the game indexes).
  useEffect(() => {
    if (actionState.status === "success") setTxRevision((value) => value + 1);
  }, [actionState]);

  const tokens = useMemo(
    () => Object.fromEntries((riftState?.resources ?? []).map((resource) => [resource.key, resource.tokenAddress])) as Partial<Record<RiftResourceKey, string | null>>,
    [riftState?.resources],
  );
  const tokenWallet = useRiftTokenWallet(props.rpcUrl, props.signerAccount, props.gameContract, tokens, txRevision);
  const planetId = riftState?.homePlanetId ?? undefined;
  const planetLabel = planetName(planets, planetId);
  const lockSeconds = Number(riftState?.withdrawalDelaySeconds) || DEFAULT_LOCK_SECONDS;
  const loadError = error ? playerNotice(error) ?? error : undefined;
  const unavailableReason = actionState.status === "pending" ? actionState.label : transactionUnavailableReason;

  return (
    <section aria-label="The Rift" className="grid min-w-0 gap-4">
      {actionState.status === "error" ? (
        <InlineStateNotice blocking tone="error">{actionState.label}</InlineStateNotice>
      ) : null}
      {!canTransact && transactionUnavailableReason && actionState.status !== "pending" ? (
        <InlineStateNotice tone="info">{transactionUnavailableReason}</InlineStateNotice>
      ) : null}

      <RiftHero lockSeconds={lockSeconds} planetLabel={riftState ? planetLabel : undefined} />

      {loading && !riftState ? (
        <RiftSkeleton />
      ) : !riftState ? (
        loadError && isGameUnavailableMessage(loadError) ? (
          <GameUnavailableNotice />
        ) : (
          <InlineStateNotice blocking={Boolean(loadError)} title={loadError ? "The Rift couldn't load" : undefined} tone={loadError ? "error" : "neutral"}>
            {loadError ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {loadError}
                <button className="font-semibold text-cyan-200 underline-offset-4 hover:underline" onClick={onRefresh} type="button">Try again</button>
              </span>
            ) : "Connect a wallet and settle a planet to use the Rift."}
          </InlineStateNotice>
        )
      ) : (
        <>
          {riftState.unlocked ? (
            <RiftWorkbench {...props} lockSeconds={lockSeconds} planetLabel={planetLabel} riftState={riftState} tokenWallet={tokenWallet} transactionUnavailableReason={unavailableReason} />
          ) : (
            <RiftLockedPanel {...props} planetLabel={planetLabel} riftState={riftState} />
          )}
          <RiftClaims {...props} planets={planets} riftState={riftState} transactionUnavailableReason={unavailableReason} />
          <RiftHistoryPanel planetId={planetId} planets={planets} riftState={riftState} />
        </>
      )}
    </section>
  );
}

function RiftHero({ lockSeconds, planetLabel }: { lockSeconds: number; planetLabel?: string | undefined }) {
  const lockDays = Math.round(lockSeconds / 86_400);
  return (
    <section aria-labelledby="rift-title" className="surface relative grid overflow-hidden rounded-xl md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
      <div className="relative h-44 overflow-hidden bg-black/30 sm:h-56 md:h-full md:min-h-[17rem]">
        <OptimizedImage
          alt="A Rift Stabilizer holding an interdimensional rift open"
          className="absolute inset-0 h-full w-full object-cover"
          height={1024}
          loading="eager"
          sizes="(min-width: 768px) 360px, calc(100vw - 2rem)"
          src={RIFT_ART}
          width={1024}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d1829] via-[#0d1829]/10 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-[#0d1829]" />
      </div>
      <div className="relative grid content-center gap-3 px-5 pb-5 pt-1 sm:px-6 md:py-6">
        <h2 className="text-xl font-semibold leading-tight text-white sm:text-2xl" id="rift-title">
          {planetLabel ? `Move resources between ${planetLabel} and your wallet` : "Move resources between your planets and your wallet"}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-300">
          Metal, Crystal and Deuterium also exist as tokens: vMETAL, vCRYSTAL and vDEUT. Inject tokens to add resources to a planet
          right away, or extract resources to lock them on the planet for {lockDays} days in plain sight of every raider, after which
          whatever survives is paid to your wallet.
        </p>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs">
          <HeroChip icon={ArrowDownToLine} label="Injecting is instant" />
          <HeroChip icon={Hourglass} label={`Extracting takes ${lockDays} days`} />
          <HeroChip icon={Coins} label="1 token = 1 unit" />
        </ul>
      </div>
    </section>
  );
}

function HeroChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <li className="surface-inset inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-slate-200">
      <Icon aria-hidden="true" className="h-3.5 w-3.5 text-cyan-300" />
      {label}
    </li>
  );
}

function RiftWorkbench({
  account,
  canTransact,
  lockSeconds,
  now,
  onApprove,
  onDeposit,
  onRequestWithdrawal,
  planetLabel,
  riftState,
  signerAccount,
  tokenWallet,
  transactionUnavailableReason,
}: RiftPageProps & { lockSeconds: number; planetLabel: string; riftState: ChainRiftState; tokenWallet: TokenWalletRead }) {
  const [mode, setMode] = useState<RiftMode>("extract");
  const [resourceKey, setResourceKey] = useState<RiftResourceKey>("metal");
  const [inputs, setInputs] = useState<Partial<Record<`${RiftMode}:${RiftResourceKey}`, string>>>({});
  const [confirming, setConfirming] = useState<{ resource: RiftResourceState; amount: bigint } | null>(null);
  const resource = riftState.resources.find((item) => item.key === resourceKey) ?? riftState.resources[0];
  if (!resource) return null;
  const style = resourceStyles[resource.key];
  const input = inputs[`${mode}:${resource.key}`] ?? "";
  const setInput = (value: string) => setInputs((current) => ({ ...current, [`${mode}:${resource.key}`]: value }));
  const wallet = tokenWallet.data?.[resource.key];
  const activeClaim = riftState.pendingWithdrawals.find((claim) => claim.planetId === riftState.homePlanetId
    && claim.resource === resource.key);
  const delegated = Boolean(signerAccount && account && signerAccount.toLowerCase() !== account.toLowerCase());

  const check = mode === "inject"
    ? riftAmountCheck(input, "tokens", wallet?.balance, `Your wallet holds ${formatRiftTokens(wallet?.balance ?? 0n)} ${style.symbol}.`)
    : riftAmountCheck(input, "units", toUnits(resource.inGameBalance), `${planetLabel} holds ${formatIntegerAmount(resource.inGameBalance)} ${style.label}.`);
  const blocker = !canTransact
    ? transactionUnavailableReason ?? "Wallet or game connection unavailable"
    : mode === "inject" && !resource.tokenAddress
      ? `${style.symbol} isn't available right now.`
      : mode === "inject" && !wallet
        ? tokenWallet.failed ? `Your ${style.symbol} balance couldn't be read.` : `Reading your ${style.symbol} balance.`
        : mode === "extract" && activeClaim
          ? `${style.label} is already extracting from ${planetLabel}. Finalize it after ${formatUnlock(activeClaim.unlocksAt)} to start another.`
          : undefined;
  const amount = blocker ? undefined : check.amount;
  const needsApproval = Boolean(amount && wallet && wallet.allowance < amount);
  const maxValue = mode === "inject"
    ? wallet ? formatRiftTokens(wallet.balance).replace(/,/g, "") : undefined
    : resource.inGameBalance;

  return (
    <section aria-labelledby="rift-actions-title" className="grid gap-4">
      <h2 className="sr-only" id="rift-actions-title">Rift balances and actions</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {riftState.resources.map((item) => (
          <ResourceCard
            key={item.key}
            onSelect={() => setResourceKey(item.key)}
            planetLabel={planetLabel}
            resource={item}
            selected={item.key === resource.key}
            wallet={tokenWallet.data?.[item.key]}
            walletFailed={tokenWallet.failed}
          />
        ))}
      </div>
      {tokenWallet.failed ? (
        <InlineStateNotice tone="error">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            Your token balances couldn't be read.
            <button className="font-semibold text-cyan-200 underline-offset-4 hover:underline" onClick={tokenWallet.retry} type="button">Try again</button>
          </span>
        </InlineStateNotice>
      ) : null}

      <div className="surface grid overflow-hidden rounded-xl">
        <div aria-label="Rift direction" className="grid grid-cols-2 border-b border-cyan-300/10" role="group">
          <ModeButton active={mode === "extract"} icon={ArrowUpFromLine} label="Extract to wallet" onClick={() => setMode("extract")} />
          <ModeButton active={mode === "inject"} icon={ArrowDownToLine} label="Inject into planet" onClick={() => setMode("inject")} />
        </div>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div>
              <p className={sectionLabel} id="rift-resource-label">Resource</p>
              <div aria-labelledby="rift-resource-label" className="mt-2 grid grid-cols-3 gap-2" role="group">
                {resourceKeys.map((key) => (
                  <button
                    aria-pressed={key === resource.key}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:min-h-10 ${key === resource.key ? resourceStyles[key].selected : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"}`}
                    key={key}
                    onClick={() => setResourceKey(key)}
                    type="button"
                  >
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${resourceStyles[key].dot}`} />
                    {resourceStyles[key].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={sectionLabel} htmlFor="rift-amount">
                {mode === "inject" ? `Amount in ${style.symbol}` : `Amount of ${style.label}`}
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  aria-describedby="rift-amount-hint"
                  aria-invalid={Boolean(input && check.reason)}
                  autoComplete="off"
                  className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 sm:h-10 sm:text-sm"
                  id="rift-amount"
                  inputMode="numeric"
                  onInput={(event) => setInput((event.currentTarget as HTMLInputElement).value)}
                  placeholder="0"
                  spellcheck={false}
                  value={input}
                />
                <button
                  className={quietButton}
                  disabled={!maxValue || maxValue === "0"}
                  onClick={() => maxValue && setInput(maxValue)}
                  type="button"
                >
                  Max
                </button>
              </div>
              <p className={`mt-2 text-xs leading-5 ${input && check.reason ? "text-amber-200" : "text-slate-400"}`} id="rift-amount-hint" role={input && check.reason ? "alert" : undefined}>
                {input && check.reason
                  ? check.reason
                  : mode === "inject"
                    ? wallet ? `Your wallet holds ${formatRiftTokens(wallet.balance)} ${style.symbol}.` : `Reading your ${style.symbol} balance.`
                    : `${planetLabel} holds ${formatIntegerAmount(resource.inGameBalance)} ${style.label}.`}
              </p>
            </div>
            <ol className="grid gap-3 border-t border-white/[0.06] pt-4">
              {mode === "inject" ? (
                <>
                  <GuideStep icon={Wallet} title="From your wallet">
                    {wallet?.balance === 0n
                      ? `You have no ${style.symbol} yet. Extract ${style.label} through the Rift, or receive ${style.symbol} from another player.`
                      : `The tokens come from ${delegated && signerAccount ? shortAddress(signerAccount) : "your connected wallet"}; the game takes exactly what you approve.`}
                  </GuideStep>
                  <GuideStep icon={ArrowDownToLine} title={`Straight onto ${planetLabel}`}>
                    The {style.label} is ready to spend the moment the injection confirms, just like mined {style.label}.
                  </GuideStep>
                  <GuideStep icon={Hourglass} title={`Leaving again takes ${Math.round(lockSeconds / 86_400)} days`}>
                    Turning {style.label} back into {style.symbol} always goes through an extraction and its public lock.
                  </GuideStep>
                </>
              ) : (
                <>
                  <GuideStep icon={Lock} title="Today">
                    The {style.label} leaves {planetLabel}'s storage and is locked on the planet.
                  </GuideStep>
                  <GuideStep icon={Crosshair} title={`For ${Math.round(lockSeconds / 86_400)} days`}>
                    Every player sees it in the Raid Finder, and raiders can take it.
                  </GuideStep>
                  <GuideStep icon={Coins} title="After it unlocks">
                    Finalize it below and whatever survived arrives in your wallet as {style.symbol}.
                  </GuideStep>
                </>
              )}
            </ol>
          </div>

          {mode === "inject" ? (
            <InjectSummary
              amount={amount}
              blocker={blocker ?? (input ? undefined : "Enter an amount to inject.")}
              delegated={delegated}
              needsApproval={needsApproval}
              onApprove={() => amount && onApprove(resource, amount)}
              onDeposit={() => amount && onDeposit(resource, amount)}
              planetLabel={planetLabel}
              resource={resource}
              signerAccount={signerAccount}
            />
          ) : (
            <ExtractSummary
              account={account}
              amount={amount}
              blocker={blocker ?? (input ? undefined : "Enter an amount to extract.")}
              lockSeconds={lockSeconds}
              now={now}
              onReview={() => amount && setConfirming({ resource, amount })}
              planetLabel={planetLabel}
              resource={resource}
            />
          )}
        </div>
      </div>

      {confirming ? (
        <ExtractDialog
          account={account}
          amount={confirming.amount}
          lockSeconds={lockSeconds}
          now={now}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onRequestWithdrawal(confirming.resource, confirming.amount);
            setInputs((current) => ({ ...current, [`extract:${confirming.resource.key}`]: "" }));
            setConfirming(null);
          }}
          planetLabel={planetLabel}
          resource={confirming.resource}
        />
      ) : null}
    </section>
  );
}

function ResourceCard({
  onSelect,
  planetLabel,
  resource,
  selected,
  wallet,
  walletFailed,
}: {
  onSelect: () => void;
  planetLabel: string;
  resource: RiftResourceState;
  selected: boolean;
  wallet?: RiftTokenWallet | undefined;
  walletFailed: boolean;
}) {
  const style = resourceStyles[resource.key];
  const locked = toUnits(resource.lockedBalance);
  return (
    <button
      aria-pressed={selected}
      className={`landing-feature grid gap-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${selected ? "!border-cyan-300/40 ring-1 ring-cyan-300/20" : "hover:!border-cyan-300/25"}`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-semibold ${style.text}`}>
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{style.symbol}</span>
      </span>
      <span>
        <span className="block text-xs text-slate-400">On {planetLabel}</span>
        <span className="mt-0.5 block text-2xl font-semibold tabular-nums text-white">{formatIntegerAmount(resource.inGameBalance)}</span>
        <span className="block text-xs tabular-nums text-slate-500">= {formatRiftTokens(resource.inGameBalance)} {style.symbol}</span>
      </span>
      <span className="grid gap-1.5 border-t border-white/[0.06] pt-3 text-xs">
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-slate-400"><Wallet aria-hidden="true" className="h-3.5 w-3.5" />Wallet</span>
          <span className="font-mono tabular-nums text-slate-100">
            {wallet ? `${formatRiftTokens(wallet.balance)} ${style.symbol}` : walletFailed || !resource.tokenAddress ? "Unavailable" : "Reading…"}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-slate-400"><Lock aria-hidden="true" className="h-3.5 w-3.5" />Extracting</span>
          <span className={`font-mono tabular-nums ${locked > 0n ? "text-amber-200" : "text-slate-100"}`}>{formatIntegerAmount(resource.lockedBalance)}</span>
        </span>
      </span>
    </button>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex min-h-12 items-center justify-center gap-2 border-b-2 px-3 text-sm font-semibold transition focus:outline-none focus-visible:bg-cyan-300/10 ${active ? "border-cyan-300 bg-cyan-300/[0.06] text-white" : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className={`h-4 w-4 ${active ? "text-cyan-300" : ""}`} />
      {label}
    </button>
  );
}

function SummaryRow({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-100">{children}</dd>
    </div>
  );
}

function InjectSummary({
  amount,
  blocker,
  delegated,
  needsApproval,
  onApprove,
  onDeposit,
  planetLabel,
  resource,
  signerAccount,
}: {
  amount: bigint | undefined;
  blocker: string | undefined;
  delegated: boolean;
  needsApproval: boolean;
  onApprove: () => void;
  onDeposit: () => void;
  planetLabel: string;
  resource: RiftResourceState;
  signerAccount?: string | undefined;
}) {
  const style = resourceStyles[resource.key];
  const ready = amount !== undefined;
  return (
    <div className="surface-inset grid content-start gap-4 rounded-lg p-4">
      <dl className="grid gap-2 text-sm">
        <SummaryRow label="You send">{ready ? `${formatRiftTokens(amount)} ${style.symbol}` : "—"}</SummaryRow>
        <SummaryRow label={`${planetLabel} gets`}>{ready ? `+${formatIntegerAmount(amount.toString())} ${style.label}` : "—"}</SummaryRow>
        <SummaryRow label="Arrives">Right away</SummaryRow>
        {delegated && signerAccount ? <SummaryRow label="Paid from">{shortAddress(signerAccount)}</SummaryRow> : null}
      </dl>
      <ol className="grid gap-2">
        <Step
          action={(
            <button className={cyanButton} disabled={!ready || !needsApproval} onClick={onApprove} type="button">
              {ready && !needsApproval ? <CircleCheck aria-hidden="true" className="h-4 w-4" /> : null}
              {ready && !needsApproval ? "Approved" : "Approve"}
            </button>
          )}
          detail={ready ? `Lets the game take exactly ${formatRiftTokens(amount)} ${style.symbol} from your wallet.` : "Lets the game take exactly the amount you inject."}
          done={ready && !needsApproval}
          index={1}
          title="Approve"
        />
        <Step
          action={(
            <button className={cyanButton} disabled={!ready || needsApproval} onClick={onDeposit} type="button">
              <ArrowDownToLine aria-hidden="true" className="h-4 w-4" />
              Inject
            </button>
          )}
          detail={`Moves the tokens into the game and adds ${style.label} to ${planetLabel}.`}
          index={2}
          title="Inject"
        />
      </ol>
      <ActionReasonNote reason={blocker} />
    </div>
  );
}

function GuideStep({ children, icon: Icon, title }: { children: ComponentChildren; icon: LucideIcon; title: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.06]">
        <Icon className="h-3.5 w-3.5 text-cyan-300" />
      </span>
      <span className="min-w-0 text-xs leading-5 text-slate-400">
        <span className="block text-sm font-semibold text-slate-100">{title}</span>
        {children}
      </span>
    </li>
  );
}

function Step({ action, detail, done = false, index, title }: { action: ComponentChildren; detail: string; done?: boolean; index: number; title: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-black/20 p-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-emerald-300/15 text-emerald-200" : "bg-cyan-300/15 text-cyan-100"}`}>{index}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="block text-xs leading-5 text-slate-400">{detail}</span>
        </span>
      </div>
      {action}
    </li>
  );
}

function ExtractSummary({
  account,
  amount,
  blocker,
  lockSeconds,
  now,
  onReview,
  planetLabel,
  resource,
}: {
  account?: string | undefined;
  amount: bigint | undefined;
  blocker: string | undefined;
  lockSeconds: number;
  now: number;
  onReview: () => void;
  planetLabel: string;
  resource: RiftResourceState;
}) {
  const style = resourceStyles[resource.key];
  const ready = amount !== undefined;
  return (
    <div className="surface-inset grid content-start gap-4 rounded-lg p-4">
      <dl className="grid gap-2 text-sm">
        <SummaryRow label="Locked on planet">{ready ? `${formatIntegerAmount(amount.toString())} ${style.label}` : "—"}</SummaryRow>
        <SummaryRow label="Unlocks">{formatUnlock(new Date(now + lockSeconds * 1_000).toISOString())}</SummaryRow>
        <SummaryRow label="You receive">{ready ? `Up to ${formatRiftTokens(amount)} ${style.symbol}` : "—"}</SummaryRow>
        {account ? <SummaryRow label="Paid to">{shortAddress(account)}</SummaryRow> : null}
      </dl>
      <p className="flex gap-2 rounded-md border border-amber-300/25 bg-amber-300/[0.07] p-3 text-xs leading-5 text-amber-100">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <span>
          Until it unlocks, anyone can attack {planetLabel} for this {style.label}, even through newbie, score and bashing protection,
          and a winning raid can take all of it. Only what survives is paid out.
        </span>
      </p>
      <div className="grid gap-1">
        <button className={amberButton} disabled={!ready} onClick={onReview} type="button">
          <Lock aria-hidden="true" className="h-4 w-4" />
          Review extraction
        </button>
        <ActionReasonNote reason={blocker} />
      </div>
    </div>
  );
}

function ExtractDialog({
  account,
  amount,
  lockSeconds,
  now,
  onCancel,
  onConfirm,
  planetLabel,
  resource,
}: {
  account?: string | undefined;
  amount: bigint;
  lockSeconds: number;
  now: number;
  onCancel: () => void;
  onConfirm: () => void;
  planetLabel: string;
  resource: RiftResourceState;
}) {
  const [understood, setUnderstood] = useState(false);
  const style = resourceStyles[resource.key];
  const lockDays = Math.round(lockSeconds / 86_400);
  return (
    <Modal labelledBy="rift-extract-title" onClose={onCancel} panelClassName="max-w-lg border-amber-300/30 p-4 sm:p-5">
      <ModalHeader
        closeLabel="Close extraction dialog"
        icon={Lock}
        onClose={onCancel}
        title={`Extract ${formatIntegerAmount(amount.toString())} ${style.label} from ${planetLabel}`}
        titleId="rift-extract-title"
      />
      <dl className="mt-4 grid gap-2 rounded-lg surface-inset p-3 text-sm">
        <SummaryRow label="Public lock">{lockDays} days</SummaryRow>
        <SummaryRow label="Unlocks">{formatUnlock(new Date(now + lockSeconds * 1_000).toISOString())}</SummaryRow>
        <SummaryRow label="If nobody raids it">{`${formatRiftTokens(amount)} ${style.symbol}`}</SummaryRow>
        {account ? <SummaryRow label="Paid to">{shortAddress(account)}</SummaryRow> : null}
      </dl>
      <ul className="mt-4 grid gap-2.5 text-sm leading-5 text-slate-300">
        <DialogPoint icon={Crosshair}>Every player sees the locked {style.label} in the Raid Finder for the full {lockDays} days.</DialogPoint>
        <DialogPoint icon={Swords}>
          Attackers can hit {planetLabel} for it even through newbie, score and bashing protection; only your alliance can't. A winning raid fills its spare cargo from the lock with no 50% cap.
        </DialogPoint>
        <DialogPoint icon={Lock}>The extraction can't be cancelled, and each planet runs one extraction per resource at a time.</DialogPoint>
        <DialogPoint icon={Coins}>After {lockDays} days you finalize it here, and whatever survived is paid out as {style.symbol}.</DialogPoint>
      </ul>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-amber-300/25 bg-amber-300/[0.06] p-3 text-sm text-amber-50">
        <input
          checked={understood}
          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-300"
          onChange={(event) => setUnderstood((event.currentTarget as HTMLInputElement).checked)}
          type="checkbox"
        />
        I understand the locked {style.label} can be raided and the extraction can't be cancelled.
      </label>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className={quietButton} onClick={onCancel} type="button">Keep it on {planetLabel}</button>
        <button className={amberButton} disabled={!understood} onClick={onConfirm} type="button">
          <Lock aria-hidden="true" className="h-4 w-4" />
          Start extraction
        </button>
      </div>
    </Modal>
  );
}

function DialogPoint({ children, icon: Icon }: { children: ComponentChildren; icon: LucideIcon }) {
  return (
    <li className="flex gap-2.5">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <span>{children}</span>
    </li>
  );
}

function RiftLockedPanel({
  onOpenRequirement,
  onSelectPlanet,
  planetLabel,
  planets = [],
  riftState,
}: RiftPageProps & { planetLabel: string; riftState: ChainRiftState }) {
  const elsewhere = planets.filter((planet) => planet.planetId !== riftState.homePlanetId
    && planet.buildingLevels?.some((building) => building.id === RIFT_STABILIZER_BUILDING_ID && building.level > 0));
  return (
    <section aria-labelledby="rift-locked-title" className="surface grid gap-4 rounded-xl p-5">
      <div>
        <h2 className="text-base font-semibold text-white" id="rift-locked-title">Build a Rift Stabilizer on {planetLabel}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
          The Rift opens on planets with a Rift Stabilizer, which costs {stabilizerCost} and needs:
        </p>
      </div>
      <RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={riftRequirementFlairs(riftState.requirements)} />
      <div className="flex flex-wrap gap-2">
        {onOpenRequirement ? (
          <button className={cyanButton} onClick={() => onOpenRequirement({ kind: "building", key: "interdimensionalRiftStabilizer" })} type="button">
            Open Rift Stabilizer
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
        {onSelectPlanet ? elsewhere.map((planet) => (
          <button className={quietButton} key={planet.planetId} onClick={() => onSelectPlanet(planet.planetId)} type="button">
            Use the Rift on {planetName(planets, planet.planetId)}
          </button>
        )) : null}
      </div>
    </section>
  );
}

function RiftClaims({
  canTransact,
  now,
  onFinishWithdrawal,
  onOpenRaidFinder,
  planets = [],
  riftState,
  transactionUnavailableReason,
}: RiftPageProps & { riftState: ChainRiftState }) {
  const claims = [...riftState.pendingWithdrawals].sort((left, right) =>
    Number(right.planetId === riftState.homePlanetId) - Number(left.planetId === riftState.homePlanetId)
      || Date.parse(left.unlocksAt) - Date.parse(right.unlocksAt));
  return (
    <section aria-labelledby="rift-claims-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className={sectionLabel} id="rift-claims-title">Active extractions</h2>
        {claims.length > 0 && onOpenRaidFinder ? (
          <button className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200 underline-offset-4 hover:underline" onClick={onOpenRaidFinder} type="button">
            <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
            See what raiders see
          </button>
        ) : null}
      </div>
      {claims.length === 0 ? (
        <p className="surface rounded-xl p-4 text-sm leading-6 text-slate-400">
          No extractions are running. A new extraction appears here with its countdown, and you finalize it here once it unlocks.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {claims.map((claim) => (
            <ClaimCard
              canTransact={canTransact}
              claim={claim}
              key={claim.id}
              now={now}
              onFinish={() => onFinishWithdrawal(claim)}
              planetLabel={planetName(planets, claim.planetId)}
              transactionUnavailableReason={transactionUnavailableReason}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ClaimCard({
  canTransact,
  claim,
  now,
  onFinish,
  planetLabel,
  transactionUnavailableReason,
}: {
  canTransact: boolean;
  claim: PendingWithdrawal;
  now: number;
  onFinish: () => void;
  planetLabel: string;
  transactionUnavailableReason?: string | undefined;
}) {
  const style = resourceStyles[claim.resource];
  const ready = isWithdrawalReady(claim, now);
  const started = toUnits(claim.startedAmount ?? claim.amount);
  const surviving = toUnits(claim.amount);
  const raided = started > surviving ? started - surviving : 0n;
  const blocker = !ready ? `Unlocks in ${formatRiftCountdown(claim.unlocksAt, now)}.` : !canTransact ? transactionUnavailableReason : undefined;
  return (
    <li className={`surface grid gap-3 rounded-xl p-4 ${ready ? "border-emerald-300/30" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`inline-flex items-center gap-2 text-sm font-semibold ${style.text}`}>
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
            {style.label}
            <span className="font-normal text-slate-400">on {planetLabel}</span>
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{formatIntegerAmount(claim.amount)}</p>
          <p className="text-xs tabular-nums text-slate-400">Pays {formatRiftTokens(claim.amount)} {style.symbol}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-100"}`}>
          {ready ? <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" /> : <Hourglass aria-hidden="true" className="h-3.5 w-3.5" />}
          {ready ? "Ready to finalize" : formatRiftCountdown(claim.unlocksAt, now)}
        </span>
      </div>
      <AnimatedProgressBar
        className="h-1.5 w-full bg-white/10"
        fillClassName={ready ? "bg-emerald-300" : "bg-amber-300"}
        label={`${style.label} extraction on ${planetLabel}`}
        value={riftLockProgress(claim, now)}
      />
      <p className="text-xs leading-5 text-slate-400">
        Started {formatUnlock(claim.requestedAt)} · Unlocks {formatUnlock(claim.unlocksAt)}
      </p>
      <p className="flex items-start gap-2 text-xs leading-5 text-slate-300">
        <Crosshair aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ready ? "text-slate-500" : "text-rose-300"}`} />
        <span>
          {ready
            ? "Raiders can still take it until you finalize."
            : `${formatIntegerAmount(claim.amount)} ${style.label} is open to every raider.`}
          {raided > 0n ? ` Raids took ${formatIntegerAmount(raided.toString())} (${percentOf(raided, started)}).` : ""}
        </span>
      </p>
      <div className="grid gap-1">
        <button className={ready ? emeraldButton : quietButton} disabled={!ready || !canTransact} onClick={onFinish} type="button">
          <ArrowUpFromLine aria-hidden="true" className="h-4 w-4" />
          Finalize and receive {formatRiftTokens(claim.amount)} {style.symbol}
        </button>
        <ActionReasonNote reason={blocker} />
      </div>
    </li>
  );
}

const historyCopy: Record<RiftHistoryEntry["kind"], { icon: LucideIcon; tone: string; title: (entry: RiftHistoryEntry) => string; sign: string }> = {
  injected: { icon: ArrowDownToLine, tone: "text-cyan-300", title: () => "Injected tokens", sign: "+" },
  extractionStarted: { icon: Lock, tone: "text-amber-300", title: () => "Extraction started", sign: "" },
  extracted: { icon: ArrowUpFromLine, tone: "text-emerald-300", title: () => "Extraction paid out", sign: "" },
  raided: { icon: Crosshair, tone: "text-rose-300", title: (entry) => `Raided by ${entry.counterparty ? shortAddress(entry.counterparty) : "a raider"}`, sign: "−" },
  raid: { icon: Swords, tone: "text-emerald-300", title: () => "You raided a Rift lock", sign: "+" },
};

function RiftHistoryPanel({ planetId, planets, riftState }: { planetId?: string | undefined; planets: readonly RiftPlanet[]; riftState: ChainRiftState }) {
  const [scope, setScope] = useState<"planet" | "all">("planet");
  const all = riftState.history ?? [];
  const entries = scope === "planet" ? all.filter((entry) => entry.planetId === planetId) : all;
  return (
    <section aria-labelledby="rift-history-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${sectionLabel} inline-flex items-center gap-2`} id="rift-history-title">
          <History aria-hidden="true" className="h-3.5 w-3.5" />
          History
        </h2>
        <div aria-label="History scope" className="inline-flex rounded-md border border-white/10 p-0.5 text-xs" role="group">
          {(["planet", "all"] as const).map((value) => (
            <button
              aria-pressed={scope === value}
              className={`min-h-9 rounded px-3 font-semibold transition sm:min-h-7 ${scope === value ? "bg-cyan-300/15 text-cyan-50" : "text-slate-400 hover:text-slate-200"}`}
              key={value}
              onClick={() => setScope(value)}
              type="button"
            >
              {value === "planet" ? "This planet" : "All planets"}
            </button>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="surface rounded-xl p-4 text-sm leading-6 text-slate-400">
          {scope === "planet" ? "Nothing has moved through the Rift on this planet yet." : "Nothing has moved through your Rifts yet."}
        </p>
      ) : (
        <ol className="surface divide-y divide-white/[0.06] rounded-xl">
          {entries.map((entry) => {
            const copy = historyCopy[entry.kind];
            const moved = resourceKeys.filter((key) => toUnits(entry.amounts[key]) > 0n);
            return (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap" key={entry.id}>
                <copy.icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${copy.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{copy.title(entry)}</p>
                  <p className="text-xs text-slate-400">
                    {entry.kind === "raid" ? `From planet #${entry.planetId}` : planetName(planets, entry.planetId)}
                    {entry.unlocksAt ? ` · unlocks ${formatUnlock(entry.unlocksAt)}` : ""}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-slate-100">
                  {moved.length === 0 ? "0" : moved.map((key) => (
                    <span className={`ml-3 first:ml-0 ${resourceStyles[key].text}`} key={key}>
                      {copy.sign}{formatIntegerAmount(entry.amounts[key])} {resourceStyles[key].label}
                    </span>
                  ))}
                </p>
                <time className="w-full text-xs text-slate-500 sm:w-auto sm:text-right" dateTime={entry.occurredAt}>{formatUnlock(entry.occurredAt)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type TokenWalletRead = { data?: TokenWallet | undefined; failed: boolean; retry: () => void };

function useRiftTokenWallet(
  rpcUrl: string | undefined,
  owner: string | undefined,
  spender: string | undefined,
  tokens: Partial<Record<RiftResourceKey, string | null>>,
  revision: number,
): TokenWalletRead {
  const key = [rpcUrl, owner, spender, ...resourceKeys.map((resource) => tokens[resource] ?? "")].join("|");
  const [result, setResult] = useState<{ key: string; data?: TokenWallet; failed?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!rpcUrl || !owner || !spender || !resourceKeys.some((resource) => tokens[resource])) return;
    let live = true;
    const load = () => fetchRiftTokenWallet(rpcUrl, owner, spender, tokens).then(
      (data) => { if (live) setResult({ key, data }); },
      () => { if (live) setResult((current) => (current?.key === key && current.data ? current : { key, failed: true })); },
    );
    void load();
    // ponytail: one delayed re-read covers a public RPC node that lags a just-confirmed approval; poll if that proves flaky.
    const timer = revision > 0 ? setTimeout(load, 4_000) : undefined;
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, revision, attempt]);
  const current = result?.key === key ? result : undefined;
  return { data: current?.data, failed: Boolean(current?.failed), retry: () => setAttempt((value) => value + 1) };
}

function planetName(planets: readonly RiftPlanet[], planetId: string | undefined): string {
  const planet = planets.find((item) => item.planetId === planetId);
  return planet?.name?.trim() || (planet ? `Planet ${planet.coordinates}` : planetId ? `Planet #${planetId}` : "this planet");
}

function formatUnlock(value: string): string {
  return formatUserTimestamp(value, { fallback: "soon" });
}

function percentOf(part: bigint, whole: bigint): string {
  return whole > 0n ? `${Number((part * 1_000n) / whole) / 10}%` : "0%";
}

/** API amounts are decimal strings; anything else reads as zero instead of breaking the page. */
function toUnits(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** A token amount: the tokens have 0 decimals, so 1 token = 1 in-game unit. */
export function formatRiftTokens(value: bigint | string): string {
  return (typeof value === "bigint" ? value : toUnits(value)).toLocaleString("en-US");
}

/** Validates a typed amount: whole tokens for injections, whole units for extractions. */
export function riftAmountCheck(input: string, unit: "tokens" | "units", available: bigint | undefined, shortfall: string): { amount?: bigint; reason?: string } {
  const value = input.replace(/[\s,_]/g, "");
  if (!value) return { reason: "Enter an amount." };
  let amount: bigint;
  try {
    amount = parseRiftTokenAmount(value, 0);
  } catch {
    return { reason: `Enter a whole number of ${unit}.` };
  }
  if (amount <= 0n) return { reason: "Enter an amount above zero." };
  if (amount > MAX_UINT128 || (available !== undefined && amount > available)) return { reason: shortfall };
  return { amount };
}

export function riftLockProgress(claim: Pick<PendingWithdrawal, "requestedAt" | "unlocksAt">, now: number): number {
  const start = Date.parse(claim.requestedAt);
  const end = Date.parse(claim.unlocksAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function riftRequirementStatus(requirement: Pick<ChainRiftState["requirements"][number], "binary" | "built" | "currentLevel" | "requiredLevel">): string {
  if (requirement.binary) {
    if (requirement.built === null || requirement.currentLevel === null) return "Currently unavailable";
    return requirement.built || requirement.currentLevel > 0 ? "Built" : "Not built";
  }

  if (requirement.currentLevel === null) return `Requires Level ${requirement.requiredLevel}; currently unavailable`;
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
