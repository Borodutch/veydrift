import type { LevelSupplyRequest, LevelSupplyPreview } from "../levelSupply";
import { playerNotice } from "../playerNotice";
import { Check, PackagePlus } from "lucide-preact";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  fleetMissionDistance,
  fleetMissionTravelSeconds,
} from "../fleetMissionRules";
import {
  allowedSupplyShips,
  buildBatchSupplyPlan,
  defaultSupplyShipTypes,
  hasUsableSupplyCargoFleet,
  type SupplyShipKey,
  type SupplyMission,
  type SupplyShipTypesBySource,
  emptySupplyResources,
  normalizeSupplyResources,
  type BatchSupplyOrder,
  type BatchSupplySource,
  type SupplyResources,
} from "../batchSupplyPlanner";
import { shipAssetByKey } from "../gameAssets";
import type { ManagedPlanetResponse } from "../walletFlow";
import { transactionIsBusy, transactionStateOutcome, type WriteTransactionState } from "../transactionActionGate";

const supplyCargoShips: Array<{ key: SupplyShipKey; label: string }> = [
  { key: "largeCargo", label: "Large Cargo" },
  { key: "smallCargo", label: "Small Cargo" },
  { key: "recycler", label: "Recycler" },
  { key: "colonyShip", label: "Colony Ship" },
];

export const MAX_TRANSPORT_BATCH_MISSIONS = 15;

export function batchSupplyMissionLimitError(missionCount: number, mission: SupplyMission = "transport"): string | undefined {
  if (mission === "deploy" && missionCount > 1) return "Deploy Supply launches one source at a time. Deselect other sources before launching.";
  return missionCount > MAX_TRANSPORT_BATCH_MISSIONS
    ? `A Supply batch can launch at most ${MAX_TRANSPORT_BATCH_MISSIONS} missions. Reduce the plan before launching.`
    : undefined;
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
  upgrade,
  preview,
  onRefresh,
  error,
  fleetSlotsKnown = true,
  initialRequested,
  loading = false,
  onClose,
  onConfirm,
  sources,
  maxSources,
  target,
  transactionState,
}: {
  actionPending?: boolean | undefined;
  upgrade?: LevelSupplyRequest | undefined;
  preview?: LevelSupplyPreview | undefined;
  onRefresh?: (() => void) | undefined;
  error?: string | undefined;
  fleetSlotsKnown?: boolean | undefined;
  initialRequested?: Partial<SupplyResources> | undefined;
  loading?: boolean | undefined;
  onClose: () => void;
  onConfirm: (orders: BatchSupplyOrder[], shipTypesBySource: SupplyShipTypesBySource, mission: SupplyMission) => void;
  sources: readonly BatchSupplySource[];
  maxSources: number;
  target: ManagedPlanetResponse;
  transactionState?: Pick<WriteTransactionState, "label" | "phase" | "txHash"> | undefined;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const levelLayers = Array.from(document.querySelectorAll<HTMLElement>("[data-level-info-layer]"));
    const hidden = levelLayers.map(layer => ({ layer, inert: layer.inert, ariaHidden: layer.getAttribute("aria-hidden") }));
    for (const { layer } of hidden) { layer.inert = true; layer.setAttribute("aria-hidden", "true"); }
    dialogRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Close supply resources"]')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      for (const { layer, inert, ariaHidden } of hidden) {
        layer.inert = inert;
        if (ariaHidden === null) layer.removeAttribute("aria-hidden"); else layer.setAttribute("aria-hidden", ariaHidden);
      }
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const [mission, setMission] = useState<SupplyMission>("transport");
  const [requested, setRequested] = useState<Record<keyof SupplyResources, string>>(() => supplyResourceInputValues(initialRequested));
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [shipTypesBySource, setShipTypesBySource] = useState<SupplyShipTypesBySource>({});
  const sourcesInitialized = useRef(false);
  const [sourceCargoOverrides, setSourceCargoOverrides] = useState<Record<string, Partial<SupplyResources>>>({});

  useEffect(() => {
    setRequested(supplyResourceInputValues(initialRequested));
    setSourceCargoOverrides({});
    if (!upgrade) {
      setSelectedSourceIds(new Set());
      setShipTypesBySource({});
      sourcesInitialized.current = false;
    }
  }, [initialRequested?.crystal, initialRequested?.deuterium, initialRequested?.metal, target.planetId]);

  useEffect(() => {
    if (sourcesInitialized.current || loading || sources.length === 0 || maxSources <= 0) return;
    sourcesInitialized.current = true;
    setSelectedSourceIds(new Set(sources.filter((source) => !source.unavailableReason).slice(0, maxSources).map((source) => source.planetId)));
  }, [initialRequested?.crystal, initialRequested?.deuterium, initialRequested?.metal, target.planetId, loading, maxSources, sources]);

  const selected = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const requestedNumbers = useMemo(() => ({
    metal: inputAmount(requested.metal),
    crystal: inputAmount(requested.crystal),
    deuterium: inputAmount(requested.deuterium),
  }), [requested]);
  const plan = useMemo(() => buildBatchSupplyPlan({
    mission,
    targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position },
    targetIsMoon: upgrade?.kind === "moon",
    requested: requestedNumbers,
    selectedPlanetIds: selected,
    sourceCargoOverrides,
    shipTypesBySource,
    sources,
    maxOrders: maxSources,
  }), [mission, requestedNumbers, selected, sourceCargoOverrides, shipTypesBySource, sources, maxSources, target.galaxy, target.position, target.system, upgrade?.kind]);
  const orderByOrigin = useMemo(() => new Map(plan.orders.map((order) => [order.originPlanetId, order])), [plan.orders]);

  const missingTotal = resourceTotal(plan.missing);
  const transactionOutcome = transactionStateOutcome(transactionState);
  const transactionPending = transactionIsBusy(transactionState);
  const canonicalTransactionError = transactionState?.phase === "error" || transactionOutcome === "unknown" || transactionOutcome === "reverted"
    ? transactionState?.label
    : undefined;
  const missionLimitError = batchSupplyMissionLimitError(plan.orders.length, mission);
  const canSubmit = (!upgrade || (Boolean(preview) && !preview?.inProgress)) && !loading && !actionPending && !transactionPending && plan.orders.length > 0 && missingTotal === 0 && !plan.sourceLimitReached && !missionLimitError;
  const targetLabel = `${target.name?.trim() || target.coordinates}${upgrade?.kind === "moon" ? " moon" : ""}`;
  const etaRange = plan.orders.length > 0
    ? {
      earliest: Math.min(...plan.orders.map((order) => order.travelSeconds)),
      latest: Math.max(...plan.orders.map((order) => order.travelSeconds)),
    }
    : undefined;
  const selectableSourceCount = Math.min(maxSources, sources.length);

  const setMax = (resource: keyof SupplyResources) => {
    const maximum = buildBatchSupplyPlan({
      mission,
      targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position },
      targetIsMoon: upgrade?.kind === "moon",
      requested: { ...requestedNumbers, [resource]: Number.MAX_SAFE_INTEGER },
      selectedPlanetIds: selected,
      shipTypesBySource,
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

  // The supply dialog runs its own focus trap and Escape handling, and stays open on backdrop clicks.
  return (
    <Modal
      closeOnEscape={false}
      dismissible={false}
      label={`Supply ${targetLabel}`}
      onClose={onClose}
      panelClassName="grid min-w-0 max-w-3xl grid-cols-[minmax(0,1fr)] auto-rows-max gap-4 p-4 [overflow-wrap:anywhere] sm:p-5"
      panelRef={dialogRef}
    >
      <ModalHeader closeLabel="Close supply resources" icon={PackagePlus} onClose={onClose} title={`Supply ${targetLabel}`} />

      <section className="grid gap-2" aria-label="Supply mission">
        <div className="inline-flex justify-self-start rounded-lg border border-white/15 bg-black/20 p-0.5" role="group" aria-label="Mission type">
          {(["transport", "deploy"] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={mission === kind}
              disabled={loading || actionPending || transactionPending}
              onClick={() => setMission(kind)}
              className={"min-h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50 " + (mission === kind ? "bg-cyan-300/20 text-cyan-100" : "text-slate-400 hover:text-white")}>
              {kind === "transport" ? "Transport" : "Deploy"}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-300">{plan.shipsReturn ? "Delivers resources, then ships return to their source planets." : "Delivers resources and leaves the planned ships at the destination. No return trip. Deploy launches one source at a time."}</p>
      </section>

      {upgrade ? <section aria-label="Upgrade requirement" className="grid gap-2 text-sm text-slate-300">
        <strong className="text-white">{upgrade.label} · Level {upgrade.level} · {upgrade.kind === "moon" ? "Moon" : "Planet"} {target.coordinates}</strong>
        <p>Cost for this level only, not the sum of prerequisite levels. Supply does not start or unlock the upgrade. Energy cannot be shipped.</p>
        <p>Resources to send are your reviewed shipment. Production or arrivals may reduce the shortfall before delivery; refresh to reduce your shipment.</p>
        {preview ? <>
          <p>Requirement: M {format(preview.requirement.metal)} · C {format(preview.requirement.crystal)} · D {format(preview.requirement.deuterium)}</p>
          <p>Destination shortfall: M {format(preview.missing.metal)} · C {format(preview.missing.crystal)} · D {format(preview.missing.deuterium)}</p>
          {resourceTotal(preview.missing) === 0 ? <p role="status">{preview.inProgress ? "Already funded: this level is in progress. No resources need to be sent." : preview.energyOnly ? "This research requires energy, not shippable resources." : "Fully funded: no resources need to be sent for this level."}</p> : null}
        </> : <p role="status">{loading ? "Refreshing destination resources…" : "Live destination resources are unavailable. Refresh to retry."}</p>}
        {upgrade.kind === "moon" ? <p>Moon Supply uses one source per mission. Select a source and review before launching.</p> : null}
        {onRefresh ? <button className="min-h-10 justify-self-start rounded border border-white/20 px-3" disabled={loading || actionPending} onClick={onRefresh} type="button">Refresh destination and shortfall</button> : null}
      </section> : null}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-2" aria-label="Resources to send">
        {(["metal", "crystal", "deuterium"] as const).map((resource) => (
          <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg surface-inset px-2 py-1.5" key={resource}>
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

      <section className="grid gap-2" aria-label="Source planets">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">Source planets</h3>
          <span className="text-xs text-slate-400">{selected.size}/{selectableSourceCount} selected</span>
        </div>
        <div className="grid content-start border-t border-cyan-300/[0.08] pr-1">
          {loading && sources.length === 0 ? (
            <SkeletonRegion className="grid gap-2" label="Loading cargo fleets">
              {skeletonList(3, (index) => (
                <div key={index} className="grid gap-3 rounded-lg border border-white/10 p-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </SkeletonRegion>
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
            const allowedShipTypes = shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes;
            const eligibleShips = allowedSupplyShips(source.ships, allowedShipTypes);
            const typeUnavailableReason = hasUsableSupplyCargoFleet(source.ships) && !hasUsableSupplyCargoFleet(eligibleShips)
              ? "No ships of the selected types. Enable another ship type to use this source."
              : undefined;
            const disabled = Boolean(source.unavailableReason) || (!checked && !hasUsableSupplyCargoFleet(eligibleShips)) || selectionLimitReached;
            const order = orderByOrigin.get(source.planetId);
            const requestedSourceCargo = sourceCargoOverrides[source.planetId];
            const sourceCargo = order?.cargo ?? requestedSourceCargo ?? emptySupplyResources();
            const hasManualCargo = sourceCargoOverrides[source.planetId] !== undefined;
            const shipmentAdjusted = requestedSourceCargo !== undefined && (
              sourceCargo.metal !== requestedSourceCargo.metal
              || sourceCargo.crystal !== requestedSourceCargo.crystal
              || sourceCargo.deuterium !== requestedSourceCargo.deuterium
            );
            const distance = fleetMissionDistance(source.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position }, { targetIsMoon: upgrade?.kind === "moon" });
            const eta = order?.travelSeconds ?? fleetMissionTravelSeconds(distance, eligibleShips, source.driveLevels);
            return (
              <div className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-cyan-300/[0.08] px-1 py-3 ${checked ? "" : "opacity-70"} ${source.unavailableReason ? "cursor-not-allowed opacity-60" : ""}`} key={source.planetId}>
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
                        <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded surface-inset px-1.5 py-1" key={resource}>
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
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Planned fleet</span>
                    <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Planned fleet at ${source.label}`}>
                      {supplyCargoShips.filter(({ key }) => (source.ships[key] ?? 0) > 0).map(({ key, label }) => {
                        const included = allowedShipTypes.includes(key);
                        return (
                          <button key={key} type="button" aria-pressed={included}
                            aria-label={label + " at " + source.label}
                            aria-describedby={`supply-planned-${source.planetId}-${key}`}
                            disabled={actionPending || transactionPending || loading || Boolean(source.unavailableReason)}
                            title={label}
                            className="group inline-flex min-h-6 min-w-6 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => setShipTypesBySource((current) => {
                              const types = current[source.planetId] ?? defaultSupplyShipTypes;
                              return { ...current, [source.planetId]: types.includes(key) ? types.filter((type) => type !== key) : [...types, key] };
                            })}>
                            <span className={"inline-flex items-center gap-0.5 rounded border p-0.5 text-[10px] group-hover:border-cyan-300/60 " + (included ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100" : "border-white/15 bg-black/20 text-slate-400")}>
                              <img alt="" className={"h-5 w-5 rounded object-contain " + (included ? "" : "opacity-50")} loading="lazy" src={shipAssetByKey[key]} />
                              <span id={`supply-planned-${source.planetId}-${key}`}>×{format(order?.ships[key] ?? 0)}<span className="sr-only"> planned</span></span>
                            </span>
                          </button>
                        );
                      })}
                      {!hasUsableSupplyCargoFleet(source.ships) ? <span className="text-xs text-slate-500">No cargo ships</span> : null}
                    </span>
                  </span>
                  {!order && hasUsableSupplyCargoFleet(source.ships) ? <span className="mt-1 block text-xs text-slate-400">No ships planned from this source.</span> : null}
                  {sourceLimitReason ? <span className="block text-xs text-slate-400">{sourceLimitReason}</span> : null}
                  {typeUnavailableReason ? <span className="block text-xs text-amber-200">{typeUnavailableReason}</span> : null}
                  {source.unavailableReason ? <span className="block text-xs text-amber-200">{playerNotice(source.unavailableReason)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        {!loading && fleetSlotsKnown && maxSources === 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">All fleet slots are currently occupied. Wait for a fleet to return or research Computer Technology before supplying this planet.</p> : null}
        {plan.sourceLimitReached ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Select at most {maxSources} sources because that is your current fleet-slot capacity.</p> : null}
        {plan.blockedSources.length > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Some selected sources cannot launch: {plan.blockedSources.map((source) => source.reason).join(" ")}</p> : null}
        {missingTotal > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Missing: M {format(plan.missing.metal)} · C {format(plan.missing.crystal)} · D {format(plan.missing.deuterium)}. {sources.some((source) => !source.unavailableReason && supplyCargoShips.some(({ key }) => (source.ships[key] ?? 0) > 0 && !(shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes).includes(key))) ? "Enable more ship types, select more sources, or reduce the request." : "Select more sources with available cargo ships, or reduce the request."}</p> : null}
        {transactionPending ? <p className="rounded border border-cyan-300/30 bg-cyan-300/10 p-2 text-sm text-cyan-100">Processing… You can close this window.</p> : null}
        {missionLimitError ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{missionLimitError}</p> : null}
        {(error ?? canonicalTransactionError) ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{error ?? canonicalTransactionError}</p> : null}

        <footer className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t border-white/10 pt-3">
          <div className="text-sm text-slate-300">
            <strong className="text-white">{plan.orders.length} {mission === "transport" ? "transport" : "deployment"}{plan.orders.length === 1 ? "" : "s"}</strong>
            <span> · M {format(plan.delivered.metal)} · C {format(plan.delivered.crystal)} · D {format(plan.delivered.deuterium)} · Fuel {format(plan.fuelCost)} D</span>
            {etaRange ? <span> · arrives {formatDuration(etaRange.earliest)}{etaRange.latest === etaRange.earliest ? "" : `–${formatDuration(etaRange.latest)}`}</span> : null}
          </div>
          <button className="inline-flex w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm" disabled={!canSubmit} onClick={() => onConfirm(plan.orders, shipTypesBySource, mission)} type="button">
            <Check aria-hidden="true" className="shrink-0" size={16} />
            <span className="min-w-0">{transactionPending ? "Processing…" : actionPending ? "Launching…" : `Launch ${plan.orders.length} ${mission === "transport" ? "transport" : "deployment"}${plan.orders.length === 1 ? "" : "s"} ${upgrade?.kind === "moon" ? "to moon" : "in one call"}`}</span>
          </button>
        </footer>
      </div>
    </Modal>
  );
}

export function supplyResourceInputValues(
  resources: Partial<SupplyResources> | undefined,
): Record<keyof SupplyResources, string> {
  const normalized = resources ? normalizeSupplyResources(resources) : emptySupplyResources();
  return {
    metal: normalized.metal > 0 ? String(normalized.metal) : "",
    crystal: normalized.crystal > 0 ? String(normalized.crystal) : "",
    deuterium: normalized.deuterium > 0 ? String(normalized.deuterium) : "",
  };
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
