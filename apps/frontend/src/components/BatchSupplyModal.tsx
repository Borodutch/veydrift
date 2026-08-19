import { Check, LoaderCircle, PackagePlus, X } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
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
import { shipAssetByKey } from "../gameAssets";
import type { MissionShipKey, MissionShips } from "../galaxyActions";
import type { ManagedPlanetResponse } from "../walletFlow";

const supplyCargoShips: Array<{ key: MissionShipKey; label: string }> = [
  { key: "largeCargo", label: "Large Cargo" },
  { key: "smallCargo", label: "Small Cargo" },
  { key: "recycler", label: "Recycler" },
  { key: "colonyShip", label: "Colony Ship" },
];

export function batchSupplyFleetPresentation(
  source: Pick<BatchSupplySource, "ships">,
  order: Pick<BatchSupplyOrder, "ships"> | undefined,
): { label: "Available cargo fleet" | "Planned fleet"; ships: Partial<MissionShips> } {
  return order
    ? { label: "Planned fleet", ships: order.ships }
    : { label: "Available cargo fleet", ships: source.ships };
}

export function batchSupplySourceLimitReason({
  checked,
  maxSources,
  selectedSourceCount,
  unavailableReason,
}: {
  checked: boolean;
  maxSources: number;
  selectedSourceCount: number;
  unavailableReason?: string | undefined;
}): string | undefined {
  if (checked || unavailableReason || selectedSourceCount < maxSources) return undefined;
  if (maxSources <= 0) return "No fleet slots are available for another transport.";
  return `Deselect another source to use this planet (${maxSources.toLocaleString()} fleet slot${maxSources === 1 ? "" : "s"} available).`;
}

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
  const [sourceCargoOverrides, setSourceCargoOverrides] = useState<Record<string, Partial<SupplyResources>>>({});

  useEffect(() => {
    setRequested({ metal: "", crystal: "", deuterium: "" });
    setSelectedSourceIds(new Set());
    setSourceCargoOverrides({});
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
    sourceCargoOverrides,
    sources,
    maxOrders: maxSources,
  }), [requestedNumbers, selected, sourceCargoOverrides, sources, target.galaxy, target.position, target.system]);
  const orderByOrigin = useMemo(() => new Map(plan.orders.map((order) => [order.originPlanetId, order])), [plan.orders]);

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

  const updateSourceCargo = (source: BatchSupplySource, resource: keyof SupplyResources, value: string) => {
    setSourceCargoOverrides((current) => {
      const existing = orderByOrigin.get(source.planetId)?.cargo ?? current[source.planetId] ?? emptySupplyResources();
      return {
        ...current,
        [source.planetId]: { ...existing, [resource]: inputAmount(numericInput(value)) },
      };
    });
  };

  const restoreAutomaticSourceCargo = (planetId: string) => {
    setSourceCargoOverrides((current) => {
      const { [planetId]: _removed, ...remaining } = current;
      return remaining;
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
          </div>
          <button aria-label="Close supply resources" className="rounded border border-white/15 p-2 text-slate-300 hover:bg-white/10" disabled={actionPending} onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <section className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-2" aria-label="Resources to send">
          {(["metal", "crystal", "deuterium"] as const).map((resource) => (
            <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5" key={resource}>
              <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{resource === "metal" ? "M" : resource === "crystal" ? "C" : "D"}</span>
              <span className="contents">
                <input
                  aria-label={`${resource} to send`}
                  className="min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none focus:border-cyan-300"
                  inputMode="numeric"
                  min="0"
                  onInput={(event) => setRequested((current) => ({ ...current, [resource]: numericInput(event.currentTarget.value) }))}
                  placeholder="0"
                  value={requested[resource]}
                />
                <button className="min-h-8 whitespace-nowrap rounded border border-cyan-300/35 px-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => setMax(resource)} type="button">Max</button>
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
              const sourceLimitReason = batchSupplySourceLimitReason({
                checked,
                maxSources,
                selectedSourceCount: selected.size,
                unavailableReason: source.unavailableReason,
              });
              const selectionLimitReached = sourceLimitReason !== undefined;
              const disabled = Boolean(source.unavailableReason) || selectionLimitReached;
              const order = orderByOrigin.get(source.planetId);
              const fleetPresentation = batchSupplyFleetPresentation(source, order);
              const requestedSourceCargo = sourceCargoOverrides[source.planetId];
              const sourceCargo = order?.cargo ?? requestedSourceCargo ?? emptySupplyResources();
              const hasManualCargo = sourceCargoOverrides[source.planetId] !== undefined;
              const shipmentAdjusted = requestedSourceCargo !== undefined && (
                sourceCargo.metal !== requestedSourceCargo.metal
                || sourceCargo.crystal !== requestedSourceCargo.crystal
                || sourceCargo.deuterium !== requestedSourceCargo.deuterium
              );
              const distance = fleetMissionDistance(source.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position });
              const eta = order?.travelSeconds ?? fleetMissionTravelSeconds(distance, source.ships, source.driveLevels);
              return (
                <div className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border p-3 ${checked ? "border-cyan-300/35 bg-cyan-300/5" : "border-white/10 bg-black/15"} ${source.unavailableReason ? "cursor-not-allowed opacity-60" : ""}`} key={source.planetId}>
                  <label className="cursor-pointer">
                    <input checked={checked} className="mt-1" disabled={disabled} onChange={() => toggleSource(source.planetId)} type="checkbox" />
                    <span className="sr-only">Select {source.label}</span>
                  </label>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="truncate text-sm font-medium text-white">{source.label}</span>
                      {order ? <span className="text-xs text-cyan-100">Sends {format(resourceTotal(order.cargo))} · Fuel {format(order.fuelCost)} D · {formatDuration(eta)}</span> : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">M {format(source.resources.metal)} · C {format(source.resources.crystal)} · D {format(source.resources.deuterium)}</span>
                    {checked ? (
                      <span className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5" aria-label={`${source.label} shipment`}>
                        {(["metal", "crystal", "deuterium"] as const).map((resource) => (
                          <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded border border-white/10 bg-black/20 px-1.5 py-1" key={resource}>
                            <span className="text-[10px] font-bold text-slate-400">{resource === "metal" ? "M" : resource === "crystal" ? "C" : "D"}</span>
                            <input
                              aria-label={`${source.label} ${resource} to send`}
                              className="min-w-0 w-full bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
                              inputMode="numeric"
                              min="0"
                              onInput={(event) => updateSourceCargo(source, resource, event.currentTarget.value)}
                              value={String(sourceCargo[resource])}
                            />
                          </label>
                        ))}
                        {hasManualCargo ? <button className="min-h-7 rounded border border-white/15 px-1.5 text-[10px] font-semibold text-slate-300 hover:bg-white/10" onClick={() => restoreAutomaticSourceCargo(source.planetId)} type="button">Auto</button> : <span aria-hidden="true" />}
                      </span>
                    ) : null}
                    {shipmentAdjusted ? <span className="mt-1 block text-[11px] text-amber-200">Adjusted to available stock, cargo capacity, and fuel.</span> : null}
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{fleetPresentation.label}</span>
                      <SupplyFleetIcons ships={fleetPresentation.ships} />
                    </span>
                    {sourceLimitReason ? <span className="block text-xs text-slate-400">{sourceLimitReason}</span> : null}
                    {source.unavailableReason ? <span className="block text-xs text-amber-200">{source.unavailableReason}</span> : null}
                  </span>
                </div>
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

          <footer className="grid gap-3 border-t border-white/10 pt-3">
            <div className="text-sm text-slate-300">
              <strong className="text-white">{plan.orders.length} transport{plan.orders.length === 1 ? "" : "s"}</strong>
              <span> · M {format(plan.delivered.metal)} · C {format(plan.delivered.crystal)} · D {format(plan.delivered.deuterium)} · Fuel {format(plan.fuelCost)} D</span>
              {etaRange ? <span> · arrives {formatDuration(etaRange.earliest)}{etaRange.latest === etaRange.earliest ? "" : `–${formatDuration(etaRange.latest)}`}</span> : null}
            </div>
            <button className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm" disabled={!canSubmit} onClick={() => onConfirm(plan.orders)} type="button">
              <Check aria-hidden="true" size={16} />
              {actionPending ? "Launching…" : `Launch ${plan.orders.length} transport${plan.orders.length === 1 ? "" : "s"} in one call`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function SupplyFleetIcons({ ships }: { ships: Partial<MissionShips> | undefined }) {
  if (!ships) return <span className="text-xs text-slate-500">Set resources to plan fleet</span>;
  const units = supplyCargoShips.filter((ship) => (ships[ship.key] ?? 0) > 0);
  if (units.length === 0) return <span className="text-xs text-slate-500">No cargo ships</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {units.map((ship) => {
        const count = Math.max(0, Math.trunc(ships[ship.key] ?? 0));
        const label = `${ship.label} ×${count.toLocaleString()}`;
        return (
          <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1 py-0.5" key={ship.key} title={label}>
            <img alt="" className="h-5 w-5 rounded object-contain" loading="lazy" src={shipAssetByKey[ship.key]} />
            <span className="text-[11px] font-semibold tabular-nums text-slate-200">×{count.toLocaleString()}</span>
          </span>
        );
      })}
    </span>
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
