import { Moon, Orbit, RadioTower } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type { Resources } from "../playableMvp";
import type { ChainMoonState } from "../walletFlow";
import { formatCost } from "../buildingDetails";

interface MoonPageProps {
  error?: string | undefined;
  loading?: boolean | undefined;
  moonState?: ChainMoonState | null | undefined;
  onRefresh?: (() => void) | undefined;
}

export function MoonPage({ error, loading, moonState, onRefresh }: MoonPageProps) {
  const moon = moonState?.moon;
  const hasMoon = Boolean(moon?.exists);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">Moon</h2>
          <p className="text-xs text-slate-400">
            Lunar structures and fleet support for the selected home planet.
          </p>
        </div>
        {onRefresh ? (
          <button
            className="h-9 rounded-md border border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100"
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {loading ? (
        <MoonStatusPanel title="Reading lunar telemetry" body="Loading moon state from the game contract." />
      ) : error ? (
        <MoonStatusPanel title="Moon state unavailable" body={error} tone="warning" />
      ) : hasMoon && moon ? (
        <MoonSystemsPanel moon={moon} moonState={moonState} />
      ) : (
        <NoMoonGuidance reason={moonState?.unavailableReason} />
      )}
    </div>
  );
}

function NoMoonGuidance({ reason }: { reason?: string | undefined }) {
  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
            <Moon aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <h3 className="text-base font-semibold text-white">No moon in orbit</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Moons form after major battles when debris gathers around a planet. Until one appears here,
            Lunar Base, Sensor Phalanx, and Jump Gate construction stay unavailable.
          </p>
          {reason ? <p className="mt-2 text-xs text-slate-500">{reason}</p> : null}
        </div>

        <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-3 md:w-[27rem] md:grid-cols-1">
          <GuidanceStep label="Fight" value="A large battle leaves debris in orbit." />
          <GuidanceStep label="Chance" value="The debris field can create a moon." />
          <GuidanceStep label="Build" value="Moon structures unlock only after creation." />
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
  moon,
  moonState,
}: {
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
}) {
  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoonMetric icon={Moon} label="Diameter" value={moon.diameterKm.toLocaleString() + " km"} />
          <MoonMetric icon={Orbit} label="Fields" value={moon.fields.toLocaleString()} />
          <MoonMetric icon={RadioTower} label="Phalanx" value={(moonState?.sensorPhalanxRange ?? "0") + " systems"} />
          <MoonMetric icon={Orbit} label="Jump Gate" value={formatMoonReadyAt(moon.jumpGateReadyAt)} />
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Moon Structures</h3>
            <p className="text-xs text-slate-400">
              Lunar Base expands fields. Sensor Phalanx and Jump Gate support fleet operations.
            </p>
          </div>
          <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-400">
            Created {formatMoonReadyAt(moon.createdAt)}
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {moonState?.buildings.map((building) => (
            <div className="rounded border border-white/10 bg-black/15 p-3" key={building.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-100">{building.label}</span>
                <span className="shrink-0 text-xs text-signal">L{building.level}</span>
              </div>
              <div className="mt-2 text-xs text-slate-400">{formatCost(resourcesFromChain(building.cost))}</div>
            </div>
          ))}
        </div>

        {moonState?.queue?.active ? (
          <div className="mt-3 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
            Moon queue: {moonBuildingLabel(moonState.queue.itemId)}{" "}
            {moonState.queue.targetLevel ? "L" + moonState.queue.targetLevel : ""} / ready{" "}
            {formatMoonReadyAt(moonState.queue.readyAt)}
          </div>
        ) : null}
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

function moonBuildingLabel(itemId: number | undefined): string {
  return [
    { id: 0, label: "Lunar Base" },
    { id: 1, label: "Sensor Phalanx" },
    { id: 2, label: "Jump Gate" },
  ].find((building) => building.id === itemId)?.label ?? "Moon building";
}

function formatMoonReadyAt(value: string | null | undefined): string {
  if (!value || value === "0") return "Ready";
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Date(timestamp * 1_000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
