import { Flame, Moon, Orbit } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import { useState } from "preact/hooks";
import type { Resources } from "../playableMvp";
import type { MissionShips } from "../galaxyActions";
import type { ChainMoonState } from "../walletFlow";
import type { Coordinates } from "../types";
import { formatCost } from "../buildingDetails";
import { defenseCatalog } from "../playableMvp";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../moonActions";
import { formatUserTimestamp } from "../timestampFormat";
import { PageHeader, RefreshButton } from "./PageHeader";
import { InlineSyncIndicator } from "./VeydriftLoader";
import { MoonSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";

interface MoonPageProps {
  action?: { status: "idle" | "pending" | "success" | "error"; label?: string } | undefined;
  burningChicken?: {
    configured: boolean;
    maxMoonsPerPlayer: number;
    moonCount: number;
  } | undefined;
  canTransact?: boolean | undefined;
  canBurnChicken?: boolean | undefined;
  error?: string | undefined;
  loading?: boolean | undefined;
  moonState?: ChainMoonState | null | undefined;
  onBurnChicken?: ((tokenId: string) => void) | undefined;
  onFinishBuilding?: ((label: string) => void) | undefined;
  onFinishDefense?: ((label: string) => void) | undefined;
  onJumpGate?: ((destinationPlanetId: string, ships?: Partial<MissionShips>) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onStartBuilding?: ((buildingId: number, label: string) => void) | undefined;
  onStartDefense?: ((defenseId: number, label: string, quantity: number) => void) | undefined;
  selectedCoordinates?: Coordinates | undefined;
  transactionUnavailableReason?: string | undefined;
}

export function MoonPage({
  action,
  burningChicken,
  canTransact,
  canBurnChicken,
  error,
  loading,
  moonState,
  onBurnChicken,
  onFinishBuilding,
  onFinishDefense,
  onJumpGate,
  onRefresh,
  onStartBuilding,
  onStartDefense,
  selectedCoordinates,
  transactionUnavailableReason,
}: MoonPageProps) {
  const moon = moonState?.moon;
  const hasMoon = Boolean(moon?.exists);
  const unavailableReason = moonState?.unavailableReason;
  const moonUnavailable = moonState?.moonAvailable === false;
  const isLoading = Boolean(loading);

  return (
    <div className="grid gap-4">
      <PageHeader
        actions={onRefresh ? <RefreshButton loading={isLoading} onRefresh={onRefresh} title="Refresh moon state" /> : undefined}
        title="Moon"
      />

      <ChickenBurnPanel
        action={action}
        burningChicken={burningChicken}
        canBurnChicken={canBurnChicken}
        hasMoon={hasMoon}
        onBurnChicken={onBurnChicken}
        selectedCoordinates={selectedCoordinates}
        transactionUnavailableReason={transactionUnavailableReason}
      />

      {hasMoon && moon ? (
        <>
          {loading ? (
            <InlineSyncIndicator label="Refreshing moon state" />
          ) : error ? (
            isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <MoonStatusPanel title="Moon state refresh failed" body={error} tone="warning" />
          ) : null}
          <MoonSystemsPanel
            action={action}
            canTransact={canTransact}
            moon={moon}
            moonState={moonState}
            onFinishBuilding={onFinishBuilding}
            onFinishDefense={onFinishDefense}
            onJumpGate={onJumpGate}
            onStartBuilding={onStartBuilding}
            onStartDefense={onStartDefense}
            transactionUnavailableReason={transactionUnavailableReason}
          />
        </>
      ) : loading ? (
        <MoonSkeleton />
      ) : moonUnavailable ? (
        <MoonStatusPanel
          title={moonState?.indexedNotReady ? "Moon state is indexing" : "Moon systems unavailable"}
          body={unavailableReason ?? "Moon state is not available for the selected planet yet."}
          tone="warning"
        />
      ) : error ? (
        isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <MoonStatusPanel title="Moon state unavailable" body={error} tone="warning" />
      ) : (
        <NoMoonGuidance moonState={moonState} reason={unavailableReason} />
      )}
    </div>
  );
}

function ChickenBurnPanel({
  action,
  burningChicken,
  canBurnChicken,
  hasMoon,
  onBurnChicken,
  selectedCoordinates,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  burningChicken?: MoonPageProps["burningChicken"];
  canBurnChicken?: boolean | undefined;
  hasMoon: boolean;
  onBurnChicken?: MoonPageProps["onBurnChicken"];
  selectedCoordinates?: Coordinates | undefined;
  transactionUnavailableReason?: string | undefined;
}) {
  const pending = action?.status === "pending";
  const configured = Boolean(burningChicken?.configured);
  const capCount = burningChicken?.moonCount ?? 0;
  const capMax = burningChicken?.maxMoonsPerPlayer ?? 2;
  const moonLimitReached = Boolean(
    burningChicken && capCount >= capMax
  );
  const disabledReason = chickenBurnDisabledReason({
    canBurnChicken,
    configured,
    hasMoon,
    moonLimitReached,
    pending,
    transactionUnavailableReason,
  });
  const targetLabel = selectedCoordinates
    ? `${selectedCoordinates.galaxy}:${selectedCoordinates.system}:${selectedCoordinates.position}`
    : "selected planet";
  const submitChickenBurn = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    const tokenId = String(new FormData(form ?? undefined).get("chickenTokenId") ?? "").trim();
    onBurnChicken?.(tokenId);
  };

  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded border border-amber-200/20 bg-amber-200/10 text-amber-200">
            <Flame aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <h3 className="text-sm font-semibold text-white">Burning Chickens</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Enter a Chicken ID to burn it on Base mainnet and grant a moon to {targetLabel}. Veydrift verifies this wallet owns the chicken before opening the transaction.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Burning Chicken burn config is not available yet.
        </p>
      ) : null}

      {configured ? (
        <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          During testnet, each account can receive only {capMax} Chicken moons. {capCount} / {capMax} testnet Chicken moons used.
        </p>
      ) : null}

      {moonLimitReached ? (
        <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          Moon limit reached: this wallet already has {capCount} of {capMax} testnet Chicken moons.
        </p>
      ) : null}

      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitChickenBurn}>
        <label className="grid gap-1 text-xs text-slate-300">
          <span>Chicken ID</span>
          <input
            className="h-9 min-w-0 rounded border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none transition focus:border-amber-200/40"
            inputMode="numeric"
            name="chickenTokenId"
            placeholder="91528"
            type="text"
          />
        </label>
        <button
          className="h-9 self-end rounded border border-amber-200/20 bg-amber-200/10 px-4 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          type="submit"
        >
          Burn for Moon
        </button>
      </form>

      {action?.status !== "idle" && action?.label ? (
        <p className={`mt-3 text-xs ${chickenBurnActionTone(action.status)}`}>{action.label}</p>
      ) : null}
    </section>
  );
}

function chickenBurnActionTone(status: NonNullable<MoonPageProps["action"]>["status"]): string {
  if (status === "error") return "text-amber-100";
  if (status === "success") return "text-emerald-100";
  return "text-cyan-100";
}

function chickenBurnDisabledReason({
  canBurnChicken,
  configured,
  hasMoon,
  moonLimitReached,
  pending,
  transactionUnavailableReason,
}: {
  canBurnChicken?: boolean | undefined;
  configured: boolean;
  hasMoon: boolean;
  moonLimitReached: boolean;
  pending: boolean;
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!configured) return "Burning Chicken burn config is unavailable.";
  if (hasMoon) return "The selected planet already has a moon.";
  if (moonLimitReached) return "This wallet has reached the two-moon limit.";
  if (!canBurnChicken) return transactionUnavailableReason ?? "Wallet or Burning Chicken contract unavailable.";
  if (pending) return "A moon transaction is already pending.";
  return undefined;
}

function NoMoonGuidance({
  moonState,
  reason,
}: {
  moonState?: ChainMoonState | null | undefined;
  reason?: string | undefined;
}) {
  const previewBuildings = moonStructurePreviewBuildings(moonState);

  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="grid gap-4">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
            <Moon aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <h3 className="text-base font-semibold text-white">No moon in orbit</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Burn a verified Chicken to grant a moon to this planet, then build moon structures.
          </p>
          {reason ? <p className="mt-2 text-xs text-slate-500">{reason}</p> : null}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-normal text-cyan-200/80">Moon structures</h4>
          <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
            {previewBuildings.map((building) => (
              <GuidanceStep key={building.label} label={building.label} value={building.description} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MoonStatusPanel({
  body,
  title,
  tone = "neutral",
}: {
  body: string;
  title: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <section className={
      "rounded-md border p-4 " + (
        tone === "warning"
          ? "border-amber-300/20 bg-amber-300/10"
          : "border-white/10 bg-[#101624]"
      )
    }>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className={"mt-1 text-sm " + (tone === "warning" ? "text-amber-100/80" : "text-slate-400")}>{body}</p>
    </section>
  );
}

function MoonSystemsPanel({
  action,
  canTransact,
  moon,
  moonState,
  onJumpGate,
  onFinishBuilding,
  onFinishDefense,
  onStartBuilding,
  onStartDefense,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onJumpGate?: MoonPageProps["onJumpGate"];
  onFinishBuilding?: MoonPageProps["onFinishBuilding"];
  onFinishDefense?: MoonPageProps["onFinishDefense"];
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  onStartDefense?: MoonPageProps["onStartDefense"];
  transactionUnavailableReason?: string | undefined;
}) {
  const [jumpDestination, setJumpDestination] = useState("");
  const [jumpSmallCargo, setJumpSmallCargo] = useState("");
  const [jumpLargeCargo, setJumpLargeCargo] = useState("");
  const pending = action?.status === "pending";
  const jumpDestinationReady = isPositiveIntegerInput(jumpDestination);
  const jumpShips = parseMoonJumpShips(jumpSmallCargo, jumpLargeCargo);
  const jumpCargoValid = jumpShips !== null;
  const fieldSummary = moonFieldSummary(moon, moonState);
  const buildingQueueReady = queueReady(moonState?.queue);
  const defenseQueueReady = queueReady(moonState?.defenseQueue);

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MoonMetric icon={Moon} label="Diameter" value={moon.diameterKm.toLocaleString() + " km"} />
          <MoonMetric icon={Orbit} label="Fields" value={moon.fields.toLocaleString()} />
          <MoonMetric icon={Orbit} label="Jump Gate" value={formatMoonReadyAt(moon.jumpGateReadyAt)} />
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        {!canTransact && transactionUnavailableReason ? (
          <p className="mb-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1.5 text-xs text-cyan-100">
            {transactionUnavailableReason}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Moon Structures</h3>
            <p className="text-xs text-slate-400">
              Lunar Base expands fields. Jump Gate supports fleet movement between owned moons. {fieldSummary.used} / {fieldSummary.capacity} fields used.
            </p>
          </div>
          <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-400">
            Created {formatMoonReadyAt(moon.createdAt)}
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {moonState?.buildings.map((building) => {
            const requirements = moonBuildingRequirementRows(building, moon, moonState);
            return (
              <div className="rounded border border-white/10 bg-black/15 p-3" key={building.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{building.label}</span>
                  <span className="shrink-0 text-xs text-signal">L{building.level}</span>
                </div>
                <div className="mt-2 text-xs text-slate-400">{formatCost(resourcesFromChain(building.cost))}</div>
                <div className="mt-1 text-xs text-slate-500">{moonBuildingEffect(building.key)}</div>
                <RequirementRows rows={requirements} />
                {onStartBuilding ? (
                  <button
                    className="mt-3 h-8 w-full rounded border border-cyan-200/20 bg-cyan-200/10 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canTransact || pending || (moonState?.queue?.active && !buildingQueueReady)}
                    onClick={() => onStartBuilding(building.id, building.label)}
                    title={!canTransact ? transactionUnavailableReason : activeQueueTitle(moonState?.queue)}
                    type="button"
                  >
                    Upgrade
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {moonState?.queue?.active ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
            <span>
              Moon queue: {moonBuildingLabel(moonState.queue.itemId)}{" "}
              {moonState.queue.targetLevel ? "L" + moonState.queue.targetLevel : ""} / ready{" "}
              {formatMoonReadyAt(moonState.queue.readyAt)}
            </span>
            {buildingQueueReady && onFinishBuilding ? (
              <button
                className="h-8 rounded border border-amber-200/30 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canTransact || pending}
                onClick={() => onFinishBuilding(moonBuildingLabel(moonState.queue?.itemId))}
                title={!canTransact ? transactionUnavailableReason : undefined}
                type="button"
              >
                Complete
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Only surface failures. Success/pending action status text is intentionally
            not rendered so the panel does not flash transient status banners. */}
        {action?.status === "error" && action.label ? (
          <p className="mt-3 text-xs text-rose-200">
            {action.label}
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Moon Defenses</h3>
            <p className="text-xs text-slate-400">
              Defenses use the moon Shipyard and stay separate from planet defenses.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {moonState?.defenses.map((defense) => {
            const catalog = defenseCatalog.find((item) => item.id === defense.id);
            const label = catalog?.label ?? `Defense ${defense.id}`;
            return (
              <div className="rounded border border-white/10 bg-black/15 p-3" key={defense.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{label}</span>
                  <span className="shrink-0 text-xs text-signal">x{defense.count}</span>
                </div>
                <div className="mt-2 text-xs text-slate-400">{formatCost(resourcesFromChain(defense.cost))}</div>
                {defense.durationSeconds ? (
                  <div className="mt-1 text-xs text-slate-500">Build time {formatDurationSeconds(defense.durationSeconds)}</div>
                ) : null}
                {onStartDefense ? (
                  <button
                    className="mt-3 h-8 w-full rounded border border-cyan-200/20 bg-cyan-200/10 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canTransact || pending || (moonState?.defenseQueue?.active && !defenseQueueReady)}
                    onClick={() => onStartDefense(defense.id, label, 1)}
                    title={!canTransact ? transactionUnavailableReason : activeQueueTitle(moonState?.defenseQueue)}
                    type="button"
                  >
                    Build 1
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {moonState?.defenseQueue?.active ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
            <span>
              Defense queue: {moonDefenseLabel(moonState.defenseQueue.itemId)} x{moonState.defenseQueue.quantity ?? 0} / ready{" "}
              {formatMoonReadyAt(moonState.defenseQueue.readyAt)}
            </span>
            {defenseQueueReady && onFinishDefense ? (
              <button
                className="h-8 rounded border border-amber-200/30 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canTransact || pending}
                onClick={() => onFinishDefense(moonDefenseLabel(moonState.defenseQueue?.itemId))}
                title={!canTransact ? transactionUnavailableReason : undefined}
                type="button"
              >
                Complete
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Jump Gate</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
            <input className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100" inputMode="numeric" onInput={(event) => setJumpDestination(event.currentTarget.value)} placeholder="Destination planet ID" value={jumpDestination} />
            <input className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100" inputMode="numeric" onInput={(event) => setJumpSmallCargo(event.currentTarget.value)} placeholder="Small" value={jumpSmallCargo} />
            <input className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100" inputMode="numeric" onInput={(event) => setJumpLargeCargo(event.currentTarget.value)} placeholder="Large" value={jumpLargeCargo} />
            <button
              className="h-9 rounded border border-cyan-200/20 bg-cyan-200/10 px-3 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canTransact || pending || !onJumpGate || !jumpDestinationReady || !jumpCargoValid}
              onClick={() => jumpCargoValid ? onJumpGate?.(jumpDestination.trim(), jumpShips) : undefined}
              title={!canTransact ? transactionUnavailableReason : undefined}
              type="button"
            >
              Jump
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function GuidanceStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/15 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-normal text-cyan-200/80">{label}</div>
      <div className="mt-1 leading-5 text-slate-300">{value}</div>
    </div>
  );
}

function moonStructurePreviewBuildings(moonState?: ChainMoonState | null | undefined): Array<{ label: string; description: string }> {
  const descriptions = new Map([
    ["Lunar Base", "Adds moon fields so more lunar structures can be built."],
    ["Robotics Factory", "Speeds moon facilities and unlocks the moon Shipyard."],
    ["Shipyard", "Builds moon defenses from the lunar queue."],
    ["Jump Gate", "Moves fleets between owned moons when the gate is ready."],
  ]);
  const labels = [
    ...(moonState?.buildings.map((building) => building.label) ?? []),
    "Lunar Base",
    "Robotics Factory",
    "Shipyard",
    "Jump Gate",
  ];
  const uniqueLabels = Array.from(new Set(labels));

  return uniqueLabels
    .map((label) => ({
      label,
      description: descriptions.get(label) ?? "Buildable moon structure available after the moon is granted.",
    }));
}

function MoonMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded border border-white/10 bg-black/15 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
        <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-normal text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      </div>
    </div>
  );
}

function resourcesFromChain(resources: ChainMoonState["buildings"][number]["cost"]): Resources {
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

type MoonBuilding = ChainMoonState["buildings"][number];
type RequirementRow = {
  label: string;
  met: boolean;
  status: string;
};

function RequirementRows({ rows }: { rows: RequirementRow[] }) {
  return (
    <div className="mt-2 grid gap-1">
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-2 text-[11px]" key={row.label}>
          <span className={row.met ? "text-slate-400" : "text-amber-200"}>{row.label}</span>
          <span className={row.met ? "text-emerald-200" : "text-amber-200"}>{row.status}</span>
        </div>
      ))}
    </div>
  );
}

export function moonBuildingRequirementRows(
  building: MoonBuilding,
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): RequirementRow[] {
  const levels = moonBuildingLevels(moonState);
  const fieldSummary = moonFieldSummary(moon, moonState);
  const rows: RequirementRow[] = [{
    label: "Open field",
    met: fieldSummary.open > 0,
    status: `${fieldSummary.open} open`,
  }];

  if (building.key === "shipyard") {
    const robotics = levels.roboticsFactory;
    rows.push({
      label: "Robotics Factory 2",
      met: robotics >= 2,
      status: `L${robotics} / 2`,
    });
  }

  if (building.key === "jumpGate") {
    const lunarBase = levels.lunarBase;
    const hyperspace = moonState?.technologyLevels?.["8"] ?? 0;
    rows.push({
      label: "Lunar Base 1",
      met: lunarBase >= 1,
      status: `L${lunarBase} / 1`,
    }, {
      label: "Hyperspace 7",
      met: hyperspace >= 7,
      status: `L${hyperspace} / 7`,
    });
  }

  return rows;
}

function moonBuildingLevels(moonState: ChainMoonState | null | undefined): Record<MoonBuilding["key"], number> {
  const levels = {
    lunarBase: 0,
    roboticsFactory: 0,
    jumpGate: 0,
    shipyard: 0,
  };
  for (const building of moonState?.buildings ?? []) {
    levels[building.key] = building.level;
  }
  return levels;
}

export function moonFieldSummary(
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): { capacity: number; used: number; open: number } {
  const capacity = moon.fields;
  const used = (moonState?.buildings ?? []).reduce((sum, building) => sum + building.level, 0);
  return {
    capacity,
    used,
    open: Math.max(0, capacity - used),
  };
}

export function queueReady(queue: ChainMoonState["queue"] | undefined): boolean {
  return Boolean(queue?.active && queue.asOfNow?.complete === true);
}

function activeQueueTitle(queue: ChainMoonState["queue"] | undefined): string | undefined {
  if (!queue?.active || queueReady(queue)) return undefined;
  return "Moon queue is active.";
}

function moonBuildingEffect(key: ChainMoonState["buildings"][number]["key"]): string {
  if (key === "lunarBase") return "Adds 3 gross fields and consumes 1 field.";
  if (key === "roboticsFactory") return "Reduces moon facility build time and unlocks the moon Shipyard.";
  if (key === "shipyard") return "Unlocks and speeds moon defense construction.";
  return "Enables fleet jumps between owned moons.";
}

function moonBuildingLabel(itemId: number | undefined): string {
  return [
    { id: 0, label: "Lunar Base" },
    { id: 1, label: "Robotics Factory" },
    { id: 2, label: "Jump Gate" },
    { id: 3, label: "Shipyard" },
  ].find((building) => building.id === itemId)?.label ?? "Moon building";
}

function moonDefenseLabel(itemId: number | undefined): string {
  return defenseCatalog.find((defense) => defense.id === itemId)?.label ?? "Moon defense";
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatMoonReadyAt(value: string | null | undefined): string {
  if (!value || value === "0") return "Ready";
  return formatUserTimestamp(value);
}
