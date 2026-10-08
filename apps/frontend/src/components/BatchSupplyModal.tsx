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
  suggestBatchSupplySourceIds,
  defaultSupplyShipTypes,
  hasUsableSupplyFleet,
  type SupplyShipKey,
  type SupplyFleetModesBySource,
  type SupplyMission,
  type SupplyShipTypesBySource,
  emptySupplyResources,
  normalizeSupplyResources,
  type BatchSupplyOrder,
  type BatchSupplySource,
  type SupplyResources,
} from "../batchSupplyPlanner";
import { useBatchSupplyMax } from "../useBatchSupplyMax";
import { shipAssetByKey } from "../gameAssets";
import type { ManagedPlanetResponse } from "../walletFlow";
import { transactionIsBusy, transactionStateOutcome, type WriteTransactionState } from "../transactionActionGate";

const supplyShips: Array<{ key: SupplyShipKey; label: string }> = [
  { key: "largeCargo", label: "Large Cargo" },
  { key: "smallCargo", label: "Small Cargo" },
  { key: "recycler", label: "Recycler" },
  { key: "colonyShip", label: "Colony Ship" },
  { key: "lightFighter", label: "Light Fighter" },
  { key: "heavyFighter", label: "Heavy Fighter" },
  { key: "cruiser", label: "Cruiser" },
  { key: "battleship", label: "Battleship" },
  { key: "bomber", label: "Bomber" },
  { key: "destroyer", label: "Destroyer" },
  { key: "deathstar", label: "Dreadstar" },
  { key: "battlecruiser", label: "Battlecruiser" },
  { key: "reaper", label: "Reaper" },
  { key: "pathfinder", label: "Pathfinder" },
];

export const MAX_TRANSPORT_BATCH_MISSIONS = 15;

export function batchSupplyMissionLimitError(missionCount: number, _mission: SupplyMission = "transport", targetIsMoon = false): string | undefined {
  if (targetIsMoon && missionCount > 1) return "Moon Supply requires exactly one source per mission.";
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
  targetIsMoon = false,
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
  onConfirm: (orders: BatchSupplyOrder[], shipTypesBySource: SupplyShipTypesBySource, mission: SupplyMission, fleetModesBySource: SupplyFleetModesBySource) => void;
  sources: readonly BatchSupplySource[];
  maxSources: number;
  target: ManagedPlanetResponse;
  targetIsMoon?: boolean;
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
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
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
  const [fleetModesBySource, setFleetModesBySource] = useState<SupplyFleetModesBySource>({});
  const sourcesInitialized = useRef(false);
  const [draftSources, setDraftSources] = useState(sources);
  const initializedRequest = useRef(false);
  const refreshRequested = useRef(false);
  // Accruing production alone cannot invalidate a reviewed shipment every ten seconds.
  // Compare inventories/locks, but only resource decreases below the reviewed reserve.
  const inventoryChanged = draftSources.length !== sources.length || draftSources.some(previous => {
    const current = sources.find(source => source.planetId === previous.planetId);
    return !current || current.unavailableReason !== previous.unavailableReason
      || JSON.stringify(current.ships) !== JSON.stringify(previous.ships)
      || JSON.stringify(current.driveLevels) !== JSON.stringify(previous.driveLevels)
      || JSON.stringify(current.coordinates) !== JSON.stringify(previous.coordinates)
      || (["metal", "crystal", "deuterium"] as const).some(key => current.resources[key] < previous.resources[key]);
  });
  const [sourceCargoOverrides, setSourceCargoOverrides] = useState<Record<string, Partial<SupplyResources>>>({});

  useEffect(() => {
    // Only initial hydration or an explicit destination refresh replaces the draft.
    if (loading || (upgrade && !preview)) return;
    if (initializedRequest.current && !refreshRequested.current) return;
    initializedRequest.current = true;
    refreshRequested.current = false;
    setRequested(supplyResourceInputValues(initialRequested));
    setSourceCargoOverrides({});
  }, [initialRequested?.crystal, initialRequested?.deuterium, initialRequested?.metal, loading, preview]);

  useEffect(() => {
    if (sourcesInitialized.current || loading || sources.length === 0 || maxSources <= 0 || (upgrade && !preview)) return;
    sourcesInitialized.current = true;
    setDraftSources(sources);
    setSelectedSourceIds(suggestBatchSupplySourceIds({ sources, maxOrders: maxSources,
      requested: normalizeSupplyResources(initialRequested ?? {}), targetIsMoon,
      targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position } }));
  }, [loading, maxSources, sources, preview]);

  const selected = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const requestedNumbers = useMemo(() => ({
    metal: inputAmount(requested.metal),
    crystal: inputAmount(requested.crystal),
    deuterium: inputAmount(requested.deuterium),
  }), [requested]);
  const planOptions = useMemo(() => ({
    mission,
    targetCoordinates: { galaxy: target.galaxy, system: target.system, position: target.position },
    targetIsMoon,
    requested: requestedNumbers,
    selectedPlanetIds: selected,
    sourceCargoOverrides,
    shipTypesBySource,
    fleetModesBySource,
    sources: draftSources,
    maxOrders: maxSources,
  }), [mission, requestedNumbers, selected, sourceCargoOverrides, shipTypesBySource, fleetModesBySource, draftSources, maxSources, target.galaxy, target.position, target.system, targetIsMoon]);
  const plan = useMemo(() => buildBatchSupplyPlan(planOptions), [planOptions]);
  const orderByOrigin = useMemo(() => new Map(plan.orders.map((order) => [order.originPlanetId, order])), [plan.orders]);

  const missingTotal = resourceTotal(plan.missing);
  const manualCargoAdjusted = Object.entries(sourceCargoOverrides).some(([id, cargo]) => selected.has(id)
    && (["metal", "crystal", "deuterium"] as const).some(key => (cargo[key] ?? 0) !== (orderByOrigin.get(id)?.cargo[key] ?? 0)));
  const transactionOutcome = transactionStateOutcome(transactionState);
  const transactionPending = transactionIsBusy(transactionState);
  const canonicalTransactionError = transactionState?.phase === "error" || transactionOutcome === "unknown" || transactionOutcome === "reverted"
    ? transactionState?.label
    : undefined;
  const missionLimitError = batchSupplyMissionLimitError(plan.orders.length, mission, targetIsMoon);
  const maximum = useBatchSupplyMax(planOptions, target.planetId, loading || actionPending || transactionPending || inventoryChanged, (resource, value) => {
    setRequested((current) => ({ ...current, [resource]: value === 0 ? "" : String(value) }));
  });
  const canSubmit = !inventoryChanged && !manualCargoAdjusted && fleetSlotsKnown && !maximum.busy && (!upgrade || (Boolean(preview) && !preview?.inProgress && resourceTotal(preview!.missing) > 0)) && !loading && !actionPending && !transactionPending && plan.orders.length > 0 && missingTotal === 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && !missionLimitError;
  const targetLabel = `${target.name?.trim() || target.coordinates}${targetIsMoon ? " moon" : ""}`;
  const etaRange = plan.orders.length > 0
    ? {
      earliest: Math.min(...plan.orders.map((order) => order.travelSeconds)),
      latest: Math.max(...plan.orders.map((order) => order.travelSeconds)),
    }
    : undefined;
  const selectableSourceCount = sources.length;

  const recalculate = () => { maximum.cancel(); setDraftSources(sources); };
  const autoPlan = () => {
    maximum.cancel();
    setDraftSources(sources);
    setSourceCargoOverrides({});
    setShipTypesBySource({});
    setFleetModesBySource({});
    setSelectedSourceIds(suggestBatchSupplySourceIds({ ...planOptions, sources,
      sourceCargoOverrides: {}, shipTypesBySource: {}, fleetModesBySource: {} }));
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
    maximum.cancel();
    setSourceCargoOverrides((current) => {
      const existing = current[source.planetId] ?? orderByOrigin.get(source.planetId)?.cargo ?? emptySupplyResources();
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
      panelClassName="flex min-w-0 max-w-3xl flex-col !overflow-hidden [touch-action:manipulation] [overflow-wrap:anywhere]"
      panelRef={dialogRef}
    >
      <div className="shrink-0 px-4 pt-4 pb-2"><ModalHeader closeLabel="Close supply resources" icon={PackagePlus} onClose={onClose} title={`Supply ${targetLabel}`} />

      </div>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain px-4 pb-3 [overflow-anchor:none]" data-supply-scroll>
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
        <p className="text-xs text-slate-300">{plan.shipsReturn ? "Ships return after delivery." : "Delivers resources and leaves the planned ships at the destination. No return trip."}</p>
      </section>

      {upgrade ? <section aria-label="Upgrade requirement" className="grid gap-1 text-xs text-slate-300">
        <strong className="text-sm text-white">{upgrade.label} · Level {upgrade.level} · {targetIsMoon ? "Moon" : "Planet"} {target.coordinates}</strong>
        <details><summary className="cursor-pointer text-slate-400">Level cost and help</summary>
          <p>Cost for this level only, not the sum of prerequisite levels. Supply does not start or unlock the upgrade. Energy cannot be shipped.</p>
          {preview ? <p>Requirement: M {format(preview.requirement.metal)} · C {format(preview.requirement.crystal)} · D {format(preview.requirement.deuterium)}</p> : null}
        </details>
        {preview && resourceTotal(preview.missing) === 0 ? <p role="status">{preview.inProgress ? "Already funded: this level is in progress. No resources need to be sent." : preview.energyOnly ? "This research requires energy, not shippable resources." : "Fully funded: no resources need to be sent for this level."}</p> : null}
        {preview && (["metal", "crystal", "deuterium"] as const).some(key => preview.missing[key] !== requestedNumbers[key]) ? <p className="text-amber-100">Current shortfall: M {format(preview.missing.metal)} · C {format(preview.missing.crystal)} · D {format(preview.missing.deuterium)}. Refresh to replace your reviewed totals.</p> : null}
        {!preview ? <p role="status">{loading ? "Refreshing destination resources…" : "Live destination resources are unavailable. Refresh to retry."}</p> : null}
        {onRefresh ? <button className="min-h-8 justify-self-start rounded border border-white/20 px-2" disabled={loading || actionPending || transactionPending} onClick={() => { refreshRequested.current = true; onRefresh(); }} type="button">Refresh destination and shortfall</button> : null}
      </section> : null}
      <section aria-label="Supply totals" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg surface-inset p-2 text-xs font-mono">
        <span className="text-slate-400">Needed</span><span>M {format(requestedNumbers.metal)} · C {format(requestedNumbers.crystal)} · D {format(requestedNumbers.deuterium)}</span>
        <span className="text-cyan-200">Planned</span><span>M {format(plan.delivered.metal)} · C {format(plan.delivered.crystal)} · D {format(plan.delivered.deuterium)}</span>
        <span className={missingTotal ? "text-amber-200" : "text-slate-400"}>Remaining</span><span>M {format(plan.missing.metal)} · C {format(plan.missing.crystal)} · D {format(plan.missing.deuterium)}</span>
      </section>
      {inventoryChanged ? <div className="flex flex-wrap items-center gap-2 text-xs text-amber-100" aria-live="polite">
        <span>Source inventory changed. Your draft is unchanged.</span>
        <button type="button" className="min-h-8 rounded border border-amber-200/30 px-2" disabled={actionPending || transactionPending || loading} onClick={recalculate}>Review latest inventory</button>
      </div> : null}
      {targetIsMoon ? <p className="text-sm text-slate-300">Moon Supply uses one source per mission. Select a source and review before launching.</p> : null}
      <section className="grid gap-2" aria-label="Proposed shipments">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Proposed shipments</h3>
          <button type="button" className="min-h-8 rounded border border-white/20 px-2 text-xs" disabled={loading || actionPending || transactionPending} onClick={autoPlan}>Auto-plan cargo</button>
        </div>
        <p className="text-xs text-slate-400">Fewer shipments first; compare fuel and ETA below.</p>
        {plan.orders.map(order => <div key={order.originPlanetId} className="rounded border border-cyan-300/15 px-2 py-1.5 text-xs">
          <strong className="text-cyan-100">{order.originLabel}</strong> · M {format(order.cargo.metal)} · C {format(order.cargo.crystal)} · D {format(order.cargo.deuterium)}
          <div className="text-slate-400">{supplyShips.filter(({ key }) => order.ships[key] > 0).map(({ key, label }) => format(order.ships[key]) + " " + label).join(", ")} · Fuel {format(order.fuelCost)} D · {formatDuration(order.travelSeconds)}</div>
        </div>)}
      </section>
      <details data-supply-amounts>
        <summary className="cursor-pointer py-1 text-sm text-cyan-100">Edit resource totals / Max</summary>
      <section className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-2" aria-label="Resources to send">
        {(["metal", "crystal", "deuterium"] as const).map((resource) => (
          <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg surface-inset px-2 py-1.5" key={resource}>
            <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{resource === "metal" ? "M" : resource === "crystal" ? "C" : "D"}</span>
            <span className="contents">
              <input
                aria-label={`${resource} to send`}
                disabled={loading || actionPending || transactionPending}
                className="min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none focus:border-cyan-300"
                inputMode="numeric"
                min="0"
                onInput={(event) => { maximum.cancel(); setRequested((current) => ({ ...current, [resource]: numericInput(event.currentTarget.value) })); }}
                placeholder="0"
                value={requested[resource]}
              />
              <button aria-busy={maximum.busy === resource} className="min-h-8 whitespace-nowrap rounded border border-cyan-300/35 px-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10" disabled={loading || actionPending || transactionPending} onClick={() => maximum.start(resource)} type="button">Max</button>
            </span>
          </label>
        ))}
      </section>

      <div className="flex min-h-8 items-center gap-3 text-xs text-cyan-100">
        <p className="min-w-0 flex-1" role="status">{maximum.notice}</p>
        <button className={`min-h-8 shrink-0 rounded border border-white/20 px-2 ${maximum.busy ? "" : "invisible"}`} disabled={!maximum.busy} type="button" onClick={maximum.cancel}>Cancel Max</button>
      </div>
      {maximum.error ? <p role="alert" className="text-sm text-red-100">{maximum.error}</p> : null}

      </details>
      <details data-supply-details>
        <summary className="cursor-pointer py-2 text-sm text-cyan-100">Sources and manual allocation · {selected.size}/{selectableSourceCount} selected</summary>
        <p className="mb-2 text-xs text-slate-400">Auto-plan compares a bounded set of source combinations, not a global fastest or cheapest route.</p>
        <button type="button" className="mb-2 min-h-8 rounded border border-white/20 px-2 text-xs" disabled={loading || actionPending || transactionPending} onClick={recalculate}>Recalculate with latest stock</button>
        <p className="mb-2 text-xs text-slate-400">Cargo ships are automatic. Enabling a combat type sends every available ship of that type. Select all ships includes the entire fleet; deselect types to keep them home.</p>
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
            const typeUnavailableReason = hasUsableSupplyFleet(source.ships) && !hasUsableSupplyFleet(eligibleShips)
              ? "No ships of the selected types. Enable another ship type to use this source."
              : undefined;
            const disabled = loading || actionPending || transactionPending || Boolean(source.unavailableReason) || (!checked && !hasUsableSupplyFleet(eligibleShips)) || selectionLimitReached;
            const order = orderByOrigin.get(source.planetId);
            const requestedSourceCargo = sourceCargoOverrides[source.planetId];
            const sourceCargo = requestedSourceCargo ?? order?.cargo ?? emptySupplyResources();
            const hasManualCargo = sourceCargoOverrides[source.planetId] !== undefined;
            const shipmentAdjusted = requestedSourceCargo !== undefined && (
              (order?.cargo.metal ?? 0) !== requestedSourceCargo.metal
              || (order?.cargo.crystal ?? 0) !== requestedSourceCargo.crystal
              || (order?.cargo.deuterium ?? 0) !== requestedSourceCargo.deuterium
            );
            const distance = fleetMissionDistance(source.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position }, { targetIsMoon });
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
                  <button type="button" className="mt-1 min-h-7 rounded border border-white/15 px-2 text-xs text-cyan-100" aria-label={"Use only " + source.label} disabled={loading || actionPending || transactionPending || Boolean(source.unavailableReason) || maxSources < 1} onClick={() => { maximum.cancel(); setDraftSources(sources); setSelectedSourceIds(new Set([source.planetId])); }}>Use only this source</button>
                  {checked ? (
                    <span className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5" aria-label={`${source.label} shipment`}>
                      {(["metal", "crystal", "deuterium"] as const).map((resource) => (
                        <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded surface-inset px-1.5 py-1" key={resource}>
                          <span className="text-[10px] font-bold text-slate-400">{resource === "metal" ? "M" : resource === "crystal" ? "C" : "D"}</span>
                          <input
                            aria-label={`${source.label} ${resource} to send`}
                            disabled={loading || actionPending || transactionPending}
                            className="min-w-0 w-full bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
                            inputMode="numeric"
                            min="0"
                            onInput={(event) => updateSourceCargo(source, resource, event.currentTarget.value)}
                            value={String(sourceCargo[resource])}
                          />
                        </label>
                      ))}
                      {hasManualCargo ? <button className="min-h-7 rounded border border-white/15 px-1.5 text-[10px] font-semibold text-slate-300 hover:bg-white/10" disabled={loading || actionPending || transactionPending} onClick={() => restoreAutomaticSourceCargo(source.planetId)} type="button">Auto</button> : <span aria-hidden="true" />}
                    </span>
                  ) : null}
                  {shipmentAdjusted ? <span className="mt-1 block text-[11px] text-amber-200">Planned cargo is lower than your manual request. Review stock, capacity and fuel.</span> : null}
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button type="button" className="min-h-8 rounded border border-white/20 px-2 text-xs text-cyan-100"
                      aria-label={`Select all ships at ${source.label}`}
                      disabled={actionPending || transactionPending || loading || Boolean(source.unavailableReason) || !hasUsableSupplyFleet(source.ships)}
                      onClick={() => {
                        setShipTypesBySource(current => ({ ...current, [source.planetId]: supplyShips.filter(({ key }) => (source.ships[key] ?? 0) > 0).map(({ key }) => key) }));
                        setFleetModesBySource(current => ({ ...current, [source.planetId]: "all" }));
                      }}>Select all ships</button>
                    {fleetModesBySource[source.planetId] === "all" ? <button type="button" className="min-h-8 rounded border border-white/20 px-2 text-xs text-slate-300"
                      disabled={actionPending || transactionPending || loading}
                      onClick={() => {
                        setFleetModesBySource(current => ({ ...current, [source.planetId]: "auto" }));
                        setShipTypesBySource(current => ({ ...current, [source.planetId]: defaultSupplyShipTypes }));
                      }}>Reset to automatic cargo</button> : null}
                    <span className="text-xs text-slate-400">{fleetModesBySource[source.planetId] === "all" ? "All selected ships" : "Automatic cargo + all selected combat ships"}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Planned fleet</span>
                    <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Planned fleet at ${source.label}`}>
                      {supplyShips.filter(({ key }) => (source.ships[key] ?? 0) > 0).map(({ key, label }) => {
                        const included = allowedShipTypes.includes(key);
                        return (
                          <button key={key} type="button" aria-pressed={included}
                            aria-label={label + " at " + source.label}
                            aria-describedby={`supply-planned-${source.planetId}-${key}`}
                            disabled={actionPending || transactionPending || loading || Boolean(source.unavailableReason)}
                            title={`${label}: ${format(source.ships[key] ?? 0)} available; ${format(order?.ships[key] ?? 0)} planned`}
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
                      {!hasUsableSupplyFleet(source.ships) ? <span className="text-xs text-slate-500">No mobile ships</span> : null}
                    </span>
                  </span>
                  {!order && hasUsableSupplyFleet(source.ships) ? <span className="mt-1 block text-xs text-slate-400">{!checked ? "Not selected. Use only this source to compare its fuel and ETA." : resourceTotal(plan.missing) === 0 ? "Not needed for this request." : "No contribution: check stock, selected ships and fuel."}</span> : null}
                  {sourceLimitReason ? <span className="block text-xs text-slate-400">{sourceLimitReason}</span> : null}
                  {typeUnavailableReason ? <span className="block text-xs text-amber-200">{typeUnavailableReason}</span> : null}
                  {source.unavailableReason ? <span className="block text-xs text-amber-200">{playerNotice(source.unavailableReason)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      </details>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        {!loading && fleetSlotsKnown && maxSources === 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">All fleet slots are currently occupied. Wait for a fleet to return or research Computer Technology before supplying this planet.</p> : null}
        {plan.sourceLimitReached ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Select at most {maxSources} sources because that is your current fleet-slot capacity.</p> : null}
        {plan.blockedSources.length > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Some selected sources cannot launch: {plan.blockedSources.map((blocked) => `${sources.find(source => source.planetId === blocked.planetId)?.label ?? blocked.planetId}: ${blocked.reason}`).join(" ")}</p> : null}
        {manualCargoAdjusted ? <p className="text-xs text-amber-100">A manual shipment exceeds current stock or capacity. Edit it or restore Auto before launching.</p> : null}
        {missingTotal > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Missing: M {format(plan.missing.metal)} · C {format(plan.missing.crystal)} · D {format(plan.missing.deuterium)}. {sources.some((source) => !source.unavailableReason && supplyShips.some(({ key }) => (source.ships[key] ?? 0) > 0 && !(shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes).includes(key))) ? "Enable more ship types, select more sources, or reduce the request." : "Select more sources with available cargo ships, or reduce the request."}</p> : null}
        {transactionPending ? <p className="rounded border border-cyan-300/30 bg-cyan-300/10 p-2 text-sm text-cyan-100">Processing… You can close this window.</p> : null}
        {missionLimitError ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{missionLimitError}</p> : null}
        {(error ?? canonicalTransactionError) ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{error ?? canonicalTransactionError}</p> : null}

      </div>
      </div>
        <footer className="grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)] gap-2 border-t border-white/10 bg-[#0d1829] p-3">
          <div className="text-sm text-slate-300">
            <strong className="text-white">{plan.orders.length} {mission === "transport" ? "transport" : "deployment"}{plan.orders.length === 1 ? "" : "s"}</strong>
            <span> · M {format(plan.delivered.metal)} · C {format(plan.delivered.crystal)} · D {format(plan.delivered.deuterium)} · Fuel {format(plan.fuelCost)} D</span>
            {etaRange ? <span> · arrives {formatDuration(etaRange.earliest)}{etaRange.latest === etaRange.earliest ? "" : `–${formatDuration(etaRange.latest)}`}</span> : null}
          </div>
          <button className="inline-flex w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm" disabled={!canSubmit} onClick={() => { if (canSubmit) onConfirm(plan.orders, shipTypesBySource, mission, fleetModesBySource); }} type="button">
            <Check aria-hidden="true" className="shrink-0" size={16} />
            <span className="min-w-0">{transactionPending ? "Processing…" : actionPending ? "Launching…" : `Launch ${plan.orders.length} ${mission === "transport" ? "transport" : "deployment"}${plan.orders.length === 1 ? "" : "s"} ${targetIsMoon ? "to moon" : "in one call"}`}</span>
          </button>
        </footer>
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
