import { Check, LoaderCircle, PackagePlus, X } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  fleetMissionAvailableCargoCapacity,
  fleetMissionDistance,
  fleetMissionTravelSeconds,
} from "../fleetMissionRules";
import {
  buildBatchSupplyPlan,
  emptySupplyResources,
  type BatchSupplyOrder,
  type BatchSupplySource,
  type SupplyResources,
} from "../batchSupplyPlanner";
import type { ManagedPlanetResponse } from "../walletFlow";

export function BatchSupplyModal({
  actionPending = false,
  error,
  loading = false,
  onClose,
  onConfirm,
  sources,
  maxSources,
  target,
}: {
  actionPending?: boolean | undefined;
  error?: string | undefined;
  loading?: boolean | undefined;
  onClose: () => void;
  onConfirm: (orders: BatchSupplyOrder[]) => void;
  sources: readonly BatchSupplySource[];
  maxSources: number;
  target: ManagedPlanetResponse;
}) {
  const [requested, setRequested] = useState<Record<keyof SupplyResources, string>>({
    metal: "",
    crystal: "",
    deuterium: "",
  });
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRequested({ metal: "", crystal: "", deuterium: "" });
    setSelectedSourceIds(new Set());
  }, [target.planetId]);

  useEffect(() => {
    if (sources.length === 0) return;
    setSelectedSourceIds((current) => current.size > 0
      ? current
      : new Set(sources.filter((source) => !source.unavailableReason).slice(0, maxSources).map((source) => source.planetId)));
  }, [maxSources, sources]);

  const selected = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const requestedNumbers = useMemo(() => ({
    metal: inputAmount(requested.metal),
    crystal: inputAmount(requested.crystal),
    deuterium: inputAmount(requested.deuterium),
  }), [requested]);
  const plan = useMemo(() => buildBatchSupplyPlan({
    targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position },
    requested: requestedNumbers,
    selectedPlanetIds: selected,
    sources,
    maxOrders: maxSources,
  }), [requestedNumbers, selected, sources, target.galaxy, target.position, target.system]);

  const missingTotal = resourceTotal(plan.missing);
  const canSubmit = !loading && !actionPending && plan.orders.length > 0 && missingTotal === 0 && !plan.sourceLimitReached;
  const targetLabel = target.name?.trim() || target.coordinates;
  const etaRange = plan.orders.length > 0
    ? {
      earliest: Math.min(...plan.orders.map((order) => order.travelSeconds)),
      latest: Math.max(...plan.orders.map((order) => order.travelSeconds)),
    }
    : undefined;
  const selectableSourceCount = Math.min(maxSources, sources.length);

  const setMax = (resource: keyof SupplyResources) => {
    const maximum = buildBatchSupplyPlan({
      targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position },
      requested: { ...requestedNumbers, [resource]: Number.MAX_SAFE_INTEGER },
      selectedPlanetIds: selected,
      sources,
      maxOrders: maxSources,
    }).delivered[resource];
    setRequested((current) => ({ ...current, [resource]: maximum === 0 ? "" : String(maximum) }));
  };

  const toggleSource = (planetId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(planetId)) next.delete(planetId);
      else if (next.size < maxSources) next.add(planetId);
      return next;
    });
  };

  return (
    <div
      aria-label={`Supply ${targetLabel}`}
      aria-modal="true"
      className="modal-backdrop-enter fixed inset-0 z-[100] grid place-items-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
    >
      <div className="grid max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-4 overflow-hidden rounded-xl border border-cyan-300/25 bg-[#101827] p-4 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-100">
              <PackagePlus aria-hidden="true" size={20} />
              <h2 className="text-lg font-semibold">Supply {targetLabel}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-300">Choose the total resources to deliver, then select the colonies that should send them. Each transport is confirmed separately in your wallet.</p>
          </div>
          <button aria-label="Close supply resources" className="rounded border border-white/15 p-2 text-slate-300 hover:bg-white/10" disabled={actionPending} onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <section className="grid gap-2 sm:grid-cols-3" aria-label="Resources to send">
          {(["metal", "crystal", "deuterium"] as const).map((resource) => (
            <label className="grid gap-1 rounded-lg border border-white/10 bg-black/20 p-3" key={resource}>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{resource}</span>
              <span className="flex gap-2">
                <input
                  aria-label={`${resource} to send`}
                  className="min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none focus:border-cyan-300"
                  inputMode="numeric"
                  min="0"
                  onInput={(event) => setRequested((current) => ({ ...current, [resource]: numericInput(event.currentTarget.value) }))}
                  placeholder="0"
                  value={requested[resource]}
                />
                <button className="rounded border border-cyan-300/35 px-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => setMax(resource)} type="button">Max</button>
              </span>
            </label>
          ))}
        </section>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2" aria-label="Source planets">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Source planets</h3>
            <span className="text-xs text-slate-400">{selected.size}/{selectableSourceCount} selected</span>
          </div>
          <div className="grid min-h-0 content-start gap-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 p-4 text-sm text-slate-300"><LoaderCircle className="animate-spin" size={16} /> Reading cargo fleets…</div>
            ) : sources.length === 0 ? (
              <div className="rounded-lg border border-white/10 p-4 text-sm text-slate-300">No other owned planets can supply this target.</div>
            ) : sources.map((source) => {
              const checked = selected.has(source.planetId);
              const disabled = Boolean(source.unavailableReason) || (!checked && selected.size >= maxSources);
              const order = plan.orders.find((candidate) => candidate.originPlanetId === source.planetId);
              const distance = fleetMissionDistance(source.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position });
              const cargoCapacity = fleetMissionAvailableCargoCapacity(source.ships, distance, source.driveLevels);
              const eta = order?.travelSeconds ?? fleetMissionTravelSeconds(distance, source.ships, source.driveLevels);
              return (
                <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${checked ? "border-cyan-300/35 bg-cyan-300/5" : "border-white/10 bg-black/15"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`} key={source.planetId}>
                  <input checked={checked} disabled={disabled} onChange={() => toggleSource(source.planetId)} type="checkbox" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{source.label}</span>
                    <span className="block text-xs text-slate-400">M {format(source.resources.metal)} · C {format(source.resources.crystal)} · D {format(source.resources.deuterium)} · Cap {format(cargoCapacity)}</span>
                    {source.unavailableReason ? <span className="block text-xs text-amber-200">{source.unavailableReason}</span> : null}
                  </span>
                  {order ? <span className="text-right text-xs text-cyan-100">Sends {format(resourceTotal(order.cargo))}<br />Fuel {format(order.fuelCost)} D · {formatDuration(eta)}</span> : null}
                </label>
              );
            })}
          </div>
        </section>

        <div className="grid gap-3">
          {!loading && maxSources === 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">All fleet slots are currently occupied. Wait for a fleet to return or research Computer Technology before supplying this planet.</p> : null}
          {plan.sourceLimitReached ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Select at most {maxSources} sources because that is your current fleet-slot capacity.</p> : null}
          {plan.blockedSources.length > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Some selected sources cannot launch: {plan.blockedSources.map((source) => source.reason).join(" ")}</p> : null}
          {missingTotal > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Missing: M {format(plan.missing.metal)} · C {format(plan.missing.crystal)} · D {format(plan.missing.deuterium)}. Select more sources or reduce the request.</p> : null}
          {error ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{error}</p> : null}

          <footer className="flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-300">
              <strong className="text-white">{plan.orders.length} transport{plan.orders.length === 1 ? "" : "s"}</strong>
              <span> · M {format(plan.delivered.metal)} · C {format(plan.delivered.crystal)} · D {format(plan.delivered.deuterium)} · Fuel {format(plan.fuelCost)} D</span>
              {etaRange ? <span> · arrives {formatDuration(etaRange.earliest)}{etaRange.latest === etaRange.earliest ? "" : `–${formatDuration(etaRange.latest)}`}</span> : null}
            </div>
            <button className="inline-flex items-center justify-center gap-2 rounded bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit} onClick={() => onConfirm(plan.orders)} type="button">
              <Check aria-hidden="true" size={16} />
              {actionPending ? "Launching…" : `Launch ${plan.orders.length} separate transport${plan.orders.length === 1 ? "" : "s"}`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function inputAmount(value: string): number {
  return value === "" ? 0 : Number(value);
}

function numericInput(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function resourceTotal(resources: SupplyResources): number {
  return resources.metal + resources.crystal + resources.deuterium;
}

function format(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}
