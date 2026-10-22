import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CircleCheck,
  Crosshair,
  History,
  Hourglass,
  Lock,
  Swords,
  TriangleAlert,
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
/** One resource's share of a Rift action; the contracts take one resource per call. */
export type RiftTransfer = { resource: RiftResourceState; amount: bigint };

interface RiftPageProps {
  /** The planet owner: extractions pay out to this wallet. */
  account?: string | undefined;
  actionState: RiftActionState;
  canTransact: boolean;
  error?: string | undefined;
  gameContract?: string | undefined;
  loading: boolean;
  now: number;
  onApprove: (transfers: readonly RiftTransfer[]) => void;
  onDeposit: (transfers: readonly RiftTransfer[]) => void;
  onFinishWithdrawal: (withdrawal: PendingWithdrawal) => void;
  onOpenRaidFinder?: (() => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh: () => void;
  onRequestWithdrawal: (transfers: readonly RiftTransfer[]) => void;
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

const resourceStyles: Record<RiftResourceKey, { label: string; symbol: string; dot: string; text: string }> = {
  metal: { label: "Metal", symbol: "vMETAL", dot: "bg-amber-300", text: "text-amber-200" },
  crystal: { label: "Crystal", symbol: "vCRYSTAL", dot: "bg-cyan-300", text: "text-cyan-200" },
  deuterium: { label: "Deuterium", symbol: "vDEUT", dot: "bg-emerald-300", text: "text-emerald-200" },
};
const resourceKeys = ["metal", "crystal", "deuterium"] as const satisfies readonly RiftResourceKey[];

const buttonBase = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500 sm:min-h-10";
const cyanButton = `${buttonBase} border-cyan-300/40 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20`;
const amberButton = `${buttonBase} border-amber-300/45 bg-amber-300/10 text-amber-50 hover:bg-amber-300/20`;
const emeraldButton = `${buttonBase} border-emerald-300/45 bg-emerald-300/10 text-emerald-50 hover:bg-emerald-300/20`;
const quietButton = `${buttonBase} border-white/10 bg-white/5 text-slate-200 hover:bg-white/10`;
const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/70";

export function RiftPage(props: RiftPageProps) {
  const { actionState, canTransact, error, loading, onRefresh, planets = [], riftState, transactionUnavailableReason } = props;
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
  const planetLabel = planetName(planets, riftState?.homePlanetId ?? undefined);
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
          <RiftClaims {...props} planets={planets} riftState={riftState} transactionUnavailableReason={unavailableReason} />
          {riftState.unlocked ? (
            <RiftWorkbench {...props} lockSeconds={lockSeconds} planetLabel={planetLabel} riftState={riftState} tokenWallet={tokenWallet} transactionUnavailableReason={unavailableReason} />
          ) : (
            <RiftLockedPanel {...props} planetLabel={planetLabel} riftState={riftState} />
          )}
          <RiftHistoryPanel planets={planets} riftState={riftState} />
        </>
      )}
    </section>
  );
}

function RiftArt() {
  return (
    <div className="relative h-44 overflow-hidden bg-black/30 sm:h-56 md:h-auto md:min-h-[24rem]">
      <OptimizedImage
        alt="A Rift Stabilizer holding an interdimensional rift open"
        className="absolute inset-0 h-full w-full object-cover"
        height={1024}
        loading="eager"
        sizes="(min-width: 768px) 40vw, calc(100vw - 2rem)"
        src={RIFT_ART}
        width={1024}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0d1829] via-[#0d1829]/10 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-[#0d1829]" />
    </div>
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
  const [inputs, setInputs] = useState<Partial<Record<`${RiftMode}:${RiftResourceKey}`, string>>>({});
  const [understood, setUnderstood] = useState(false);
  const inject = mode === "inject";
  const delegated = Boolean(signerAccount && account && signerAccount.toLowerCase() !== account.toLowerCase());
  const clearInputs = (transfers: readonly RiftTransfer[]) => setInputs((current) => ({
    ...current,
    ...Object.fromEntries(transfers.map(({ resource }) => [`${mode}:${resource.key}`, ""])),
  }));

  const rows = riftState.resources.map((resource) => {
    const style = resourceStyles[resource.key];
    const input = inputs[`${mode}:${resource.key}`] ?? "";
    const wallet = tokenWallet.data?.[resource.key];
    const activeClaim = inject ? undefined : riftState.pendingWithdrawals.find((claim) => claim.planetId === riftState.homePlanetId
      && claim.resource === resource.key);
    const disabled = inject ? !resource.tokenAddress || (!wallet && tokenWallet.failed) : Boolean(activeClaim);
    const available = inject ? wallet?.balance : toUnits(resource.inGameBalance);
    const check = input && !disabled
      ? riftAmountCheck(input, inject ? "tokens" : "units", available, inject
        ? `Your wallet holds ${formatRiftTokens(available ?? 0n)} ${style.symbol}.`
        : `${planetLabel} holds ${formatIntegerAmount(resource.inGameBalance)} ${style.label}.`)
      : {};
    return {
      resource,
      style,
      input,
      disabled,
      invalid: Boolean(check.reason),
      // A typed injection waits for the wallet balance before it counts.
      amount: inject && !wallet ? undefined : check.amount,
      available: inject
        ? wallet ? formatRiftTokens(wallet.balance) : disabled ? "—" : "…"
        : formatIntegerAmount(resource.inGameBalance),
      max: available && available > 0n ? available.toString() : undefined,
      note: activeClaim
        ? `Already extracting until ${formatUnlock(activeClaim.unlocksAt)}.`
        : inject && !resource.tokenAddress ? `${style.symbol} isn't available right now.` : check.reason,
    };
  });
  const transfers = rows.flatMap((row) => row.amount === undefined ? [] : [{ resource: row.resource, amount: row.amount }]);
  const toApprove = inject ? transfers.filter(({ resource, amount }) => (tokenWallet.data?.[resource.key]?.allowance ?? 0n) < amount) : [];
  const blocker = !canTransact
    ? transactionUnavailableReason ?? "Wallet or game connection unavailable"
    : rows.some((row) => row.invalid)
      ? "Fix the amounts above."
      : inject && rows.some((row) => row.input && !row.disabled && row.amount === undefined)
        ? tokenWallet.failed ? "Your token balances couldn't be read." : "Reading your token balances."
        : transfers.length === 0 ? `Enter an amount to ${inject ? "inject" : "extract"}.` : undefined;
  const ready = !blocker;
  const several = (toApprove.length || transfers.length) > 1;

  return (
    <section aria-labelledby="rift-title" className="surface grid overflow-hidden rounded-xl md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <RiftArt />
      <div className="grid min-w-0 content-start gap-5 p-4 sm:p-5">
        <div>
          <h2 className="text-lg font-semibold leading-tight text-white" id="rift-title">Move resources between {planetLabel} and your wallet</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Metal, Crystal and Deuterium also exist as the tokens vMETAL, vCRYSTAL and vDEUT, one token per unit.
          </p>
        </div>

        <div aria-label="Rift direction" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1" role="group">
          <ModeButton active={!inject} icon={ArrowUpFromLine} label="Extract to wallet" onClick={() => setMode("extract")} />
          <ModeButton active={inject} icon={ArrowDownToLine} label="Inject into planet" onClick={() => setMode("inject")} />
        </div>

        <div className="grid gap-3">
          <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3 ${sectionLabel}`}>
            <span>{inject ? "In your wallet" : `On ${planetLabel}`}</span>
            <span>{inject ? "Inject" : "Extract"}</span>
          </div>
          {rows.map((row) => {
            const id = `rift-amount-${row.resource.key}`;
            return (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-x-3 gap-y-1" key={row.resource.key}>
                <label className="min-w-0" htmlFor={id}>
                  <span className={`flex items-center gap-2 text-sm font-semibold ${row.style.text}`}>
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${row.style.dot}`} />
                    {row.style.label}
                  </span>
                  <span className="block truncate font-mono text-xs tabular-nums text-slate-400">{row.available}</span>
                </label>
                <div className="flex min-w-0 gap-2">
                  <input
                    aria-describedby={row.note ? `${id}-note` : undefined}
                    aria-invalid={row.invalid}
                    autoComplete="off"
                    className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:text-sm"
                    disabled={row.disabled}
                    id={id}
                    inputMode="numeric"
                    onInput={(event) => {
                      const value = (event.currentTarget as HTMLInputElement).value;
                      setInputs((current) => ({ ...current, [`${mode}:${row.resource.key}`]: value }));
                    }}
                    placeholder="0"
                    spellcheck={false}
                    value={row.disabled ? "" : row.input}
                  />
                  <button
                    aria-label={`Max ${row.style.label}`}
                    className={quietButton}
                    disabled={row.disabled || !row.max}
                    onClick={() => row.max && setInputs((current) => ({ ...current, [`${mode}:${row.resource.key}`]: row.max! }))}
                    type="button"
                  >
                    Max
                  </button>
                </div>
                {row.note ? (
                  <p className={`col-start-2 text-xs leading-5 ${row.invalid ? "text-amber-200" : "text-slate-400"}`} id={`${id}-note`} role={row.invalid ? "alert" : undefined}>
                    {row.note}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {inject && tokenWallet.failed ? (
          <InlineStateNotice tone="error">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              Your token balances couldn't be read.
              <button className="font-semibold text-cyan-200 underline-offset-4 hover:underline" onClick={tokenWallet.retry} type="button">Try again</button>
            </span>
          </InlineStateNotice>
        ) : null}

        {inject ? (
          <div className="grid gap-2">
            {ready ? (
              <p className="text-sm leading-6 text-slate-300">
                {planetLabel} gets{" "}
                <span className="font-semibold text-white">{listJoin(transfers.map(({ resource, amount }) => `+${formatRiftTokens(amount)} ${resourceStyles[resource.key].label}`))}</span>{" "}
                right away{delegated && signerAccount ? `, paid from ${shortAddress(signerAccount)}` : ""}.
              </p>
            ) : null}
            {ready && toApprove.length ? (
              <button className={cyanButton} onClick={() => onApprove(toApprove)} type="button">
                <CircleCheck aria-hidden="true" className="h-4 w-4" />
                Approve {listJoin(toApprove.map(({ resource }) => resourceStyles[resource.key].symbol))}
              </button>
            ) : (
              <button
                className={cyanButton}
                disabled={!ready}
                onClick={() => {
                  onDeposit(transfers);
                  clearInputs(transfers);
                }}
                type="button"
              >
                <ArrowDownToLine aria-hidden="true" className="h-4 w-4" />
                Inject
              </button>
            )}
            {ready && toApprove.length ? <p className="text-xs leading-5 text-slate-400">Step 1 of 2: lets the game take exactly these amounts. Then inject.</p> : null}
            {ready && several ? <p className="text-xs leading-5 text-slate-400">Your wallet asks you to confirm each resource separately.</p> : null}
            <ActionReasonNote reason={blocker} />
          </div>
        ) : (
          <div className="grid gap-3">
            {ready ? (
              <p className="text-sm leading-6 text-slate-300">
                You receive up to{" "}
                <span className="font-semibold text-white">{listJoin(transfers.map(({ resource, amount }) => `${formatRiftTokens(amount)} ${resourceStyles[resource.key].symbol}`))}</span>
                {delegated && account ? ` at ${shortAddress(account)}` : " in your wallet"} on {formatUnlock(new Date(now + lockSeconds * 1_000).toISOString())}.
              </p>
            ) : null}
            <p className="flex gap-2 rounded-md border border-amber-300/25 bg-amber-300/[0.07] p-3 text-xs leading-5 text-amber-100">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span>
                For {Math.round(lockSeconds / 86_400)} days the extracted resources stay on {planetLabel}, and anyone outside your alliance can
                raid them, even through newbie, score and bashing protection. Only what survives is paid out.
              </span>
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-slate-200">
              <input
                checked={understood}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-300"
                onChange={(event) => setUnderstood((event.currentTarget as HTMLInputElement).checked)}
                type="checkbox"
              />
              I understand they can be raided and an extraction can't be cancelled.
            </label>
            <div className="grid gap-1">
              <button
                className={amberButton}
                disabled={!ready || !understood}
                onClick={() => {
                  onRequestWithdrawal(transfers);
                  clearInputs(transfers);
                  setUnderstood(false);
                }}
                type="button"
              >
                <Lock aria-hidden="true" className="h-4 w-4" />
                {transfers.length > 1 ? `Start ${transfers.length} extractions` : "Start extraction"}
              </button>
              {ready && several ? <p className="text-xs leading-5 text-slate-400">Your wallet asks you to confirm each resource separately.</p> : null}
              <ActionReasonNote reason={blocker} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:min-h-10 ${active ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className={`hidden h-4 w-4 sm:block ${active ? "text-cyan-300" : ""}`} />
      {label}
    </button>
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
    <section aria-labelledby="rift-locked-title" className="surface grid overflow-hidden rounded-xl md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <RiftArt />
      <div className="grid content-start gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-white" id="rift-locked-title">Build a Rift Stabilizer on {planetLabel}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            The Rift turns Metal, Crystal and Deuterium into the tokens vMETAL, vCRYSTAL and vDEUT and back. It opens on planets with a
            Rift Stabilizer, which costs {stabilizerCost} and needs:
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
  if (riftState.pendingWithdrawals.length === 0) return null;
  const claims = [...riftState.pendingWithdrawals].sort((left, right) =>
    Number(right.planetId === riftState.homePlanetId) - Number(left.planetId === riftState.homePlanetId)
      || Date.parse(left.unlocksAt) - Date.parse(right.unlocksAt));
  return (
    <section aria-labelledby="rift-claims-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className={sectionLabel} id="rift-claims-title">Extractions</h2>
        {onOpenRaidFinder ? (
          <button className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-200 underline-offset-4 hover:underline" onClick={onOpenRaidFinder} type="button">
            <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
            See what raiders see
          </button>
        ) : null}
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
  const raided = started > toUnits(claim.amount) ? started - toUnits(claim.amount) : 0n;
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
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-100"}`}>
          {ready ? <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" /> : <Hourglass aria-hidden="true" className="h-3.5 w-3.5" />}
          {ready ? "Ready" : formatRiftCountdown(claim.unlocksAt, now)}
        </span>
      </div>
      <AnimatedProgressBar
        className="h-1.5 w-full bg-white/10"
        fillClassName={ready ? "bg-emerald-300" : "bg-amber-300"}
        label={`${style.label} extraction on ${planetLabel}`}
        value={riftLockProgress(claim, now)}
      />
      <p className="text-xs leading-5 text-slate-400">
        {ready ? "Raiders can still take it until you finalize." : `Open to raiders until ${formatUnlock(claim.unlocksAt)}.`}
        {raided > 0n ? ` Raids took ${formatIntegerAmount(raided.toString())} (${percentOf(raided, started)}).` : ""}
      </p>
      {ready ? (
        <div className="grid gap-1">
          <button className={emeraldButton} disabled={!canTransact} onClick={onFinish} type="button">
            <ArrowUpFromLine aria-hidden="true" className="h-4 w-4" />
            Finalize and receive {formatRiftTokens(claim.amount)} {style.symbol}
          </button>
          <ActionReasonNote reason={canTransact ? undefined : transactionUnavailableReason} />
        </div>
      ) : null}
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

function RiftHistoryPanel({ planets, riftState }: { planets: readonly RiftPlanet[]; riftState: ChainRiftState }) {
  const entries = riftState.history ?? [];
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="rift-history-title" className="grid gap-3">
      <h2 className={`${sectionLabel} inline-flex items-center gap-2`} id="rift-history-title">
        <History aria-hidden="true" className="h-3.5 w-3.5" />
        History
      </h2>
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

/** "a", "a and b", "a, b and c". */
function listJoin(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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
