import type { LevelSupplyRequest, LevelSupplyPreview } from "../levelSupply";
import { playerNotice } from "../playerNotice";
import { Check, ChevronDown, PackagePlus, Package, Rocket } from "lucide-preact";
import { Modal } from "./Modal";
import { ModalHeader } from "./ModalHeader";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  fleetMissionDistance,
  fleetMissionTravelSeconds,
} from "../fleetMissionRules";
import {
  allowedSupplyShips,
  buildBatchSupplyPlan,
  maximumBatchSupplyResource,
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
import { shipAssetByKey } from "../gameAssets";
import { MOON_SUPPLY_BATCH_UNAVAILABLE } from "../walletFlow";
import type { ManagedPlanetResponse } from "../walletFlow";
import { transactionIsBusy, transactionStateOutcome, type WriteTransactionState } from "../transactionActionGate";
import { AssetImage } from "./OptimizedImage";

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
const resourceKeys = ["metal", "crystal", "deuterium"] as const;

export const MAX_TRANSPORT_BATCH_MISSIONS = 15;

export function batchSupplyMissionLimitError(missionCount: number, _mission: SupplyMission = "transport", targetIsMoon = false, moonBatchSupported = false): string | undefined {
  if (targetIsMoon && missionCount > 1 && !moonBatchSupported) return MOON_SUPPLY_BATCH_UNAVAILABLE;
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
  if (checked || unavailableReason || selectedSourceCount < Math.min(maxSources, MAX_TRANSPORT_BATCH_MISSIONS)) return undefined;
  if (selectedSourceCount >= MAX_TRANSPORT_BATCH_MISSIONS) return `A Supply batch can use at most ${MAX_TRANSPORT_BATCH_MISSIONS} sources.`;
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
  moonBatchSupported = false,
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
  moonBatchSupported?: boolean;
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
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
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
  const [expandedSourceIds, setExpandedSourceIds] = useState<ReadonlySet<string>>(new Set());
  const sourcesInitialized = useRef(false);
  const [inventoryNeedsReview, setInventoryNeedsReview] = useState(false);
  const [reviewedFailure, setReviewedFailure] = useState<string>();
  useLayoutEffect(() => {
    if (!error || actionPending) setReviewedFailure(undefined);
  }, [error, actionPending]);
  const failureNeedsReview = Boolean(error && error !== reviewedFailure);
  const initializedRequest = useRef(false);
  const refreshRequested = useRef(false);
  const [reviewedGoal, setReviewedGoal] = useState(preview);
  const [sourceCargoOverrides, setSourceCargoOverrides] = useState<Record<string, Partial<SupplyResources>>>({});

  useEffect(() => {
    // Only initial hydration or an explicit destination refresh replaces the draft.
    if (loading || (upgrade && !preview)) return;
    if (initializedRequest.current && !refreshRequested.current) return;
    initializedRequest.current = true;
    refreshRequested.current = false;
    setReviewedGoal(preview);
    setRequested(supplyResourceInputValues(initialRequested));
    setSourceCargoOverrides({});
  }, [initialRequested?.crystal, initialRequested?.deuterium, initialRequested?.metal, loading, preview]);

  useEffect(() => {
    if (sourcesInitialized.current || loading || sources.length === 0 || maxSources <= 0 || (upgrade && !preview)) return;
    sourcesInitialized.current = true;
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
    sources,
    maxOrders: maxSources,
  }), [mission, requestedNumbers, selected, sourceCargoOverrides, shipTypesBySource, fleetModesBySource, sources, maxSources, target.galaxy, target.position, target.system, targetIsMoon]);
  const plan = useMemo(() => buildBatchSupplyPlan(planOptions), [planOptions]);
  const orderByOrigin = useMemo(() => new Map(plan.orders.map((order) => [order.originPlanetId, order])), [plan.orders]);

  // Publishing a fresh preflight preview is not consent to a changed goal.
  const goalNeedsReview = Boolean(upgrade && preview && (!reviewedGoal
    || resourceKeys.some(key => preview.requirement[key] !== reviewedGoal.requirement[key] || preview.missing[key] > reviewedGoal.missing[key])
    || Boolean(preview.inProgress) !== Boolean(reviewedGoal.inProgress)));
  const needed = Object.fromEntries(resourceKeys.map(key => [key, Math.max(requestedNumbers[key], upgrade && preview ? preview.missing[key] : 0)])) as SupplyResources;
  const remaining = Object.fromEntries(resourceKeys.map(key => [key, Math.max(0, needed[key] - plan.delivered[key])])) as SupplyResources;
  const missingTotal = resourceTotal(remaining);
  // Cumulative level Supply funds every level from the current (or queued) level up to the selected one.
  const levelRange = upgrade && preview?.fromLevel !== undefined && preview.fromLevel < upgrade.level ? `${preview.fromLevel}–${upgrade.level}` : undefined;
  // Inventory always comes from the newest server snapshot. Ask for a second look only when a
  // launchable shipment materially changes under an unchanged draft: which origins launch, what they
  // deliver in total, or a blocked/limited source. Production ticks that only shift cargo between
  // origins, or that change a plan which cannot launch anyway, are not worth an extra click.
  const draftKey = JSON.stringify([mission, requestedNumbers, [...selected].sort(), sourceCargoOverrides,
    shipTypesBySource, fleetModesBySource, target.planetId, targetIsMoon]);
  const shipmentKey = missingTotal > 0 ? "incomplete"
    : JSON.stringify([plan.orders.map(order => order.originPlanetId), plan.delivered, plan.blockedSources, plan.sourceLimitReached]);
  const reviewed = useRef({ draftKey, shipmentKey });
  const changedShipment = reviewed.current.draftKey === draftKey && reviewed.current.shipmentKey !== shipmentKey;
  const inventoryChanged = failureNeedsReview || (reviewed.current.draftKey === draftKey && (inventoryNeedsReview || changedShipment));
  useLayoutEffect(() => {
    if (reviewed.current.draftKey !== draftKey) setInventoryNeedsReview(false);
    else if (changedShipment) setInventoryNeedsReview(true);
    reviewed.current = { draftKey, shipmentKey };
  }, [draftKey, shipmentKey]);
  const manualCargoAdjusted = Object.entries(sourceCargoOverrides).some(([id, cargo]) => selected.has(id)
    && resourceKeys.some(key => (cargo[key] ?? 0) !== (orderByOrigin.get(id)?.cargo[key] ?? 0)));
  const transactionOutcome = transactionStateOutcome(transactionState);
  const transactionPending = transactionIsBusy(transactionState);
  const busy = loading || actionPending || transactionPending;
  const canonicalTransactionError = transactionState?.phase === "error" || transactionOutcome === "unknown" || transactionOutcome === "reverted"
    ? transactionState?.label
    : undefined;
  const missionLimitError = batchSupplyMissionLimitError(plan.orders.length, mission, targetIsMoon, moonBatchSupported);
  const canSubmit = !goalNeedsReview && !inventoryChanged && !manualCargoAdjusted && fleetSlotsKnown && (!upgrade || (Boolean(preview) && !preview?.inProgress && resourceTotal(preview!.missing) > 0)) && !busy && plan.orders.length > 0 && missingTotal === 0 && !plan.sourceLimitReached && plan.blockedSources.length === 0 && !missionLimitError;
  const targetLabel = `${target.name?.trim() || target.coordinates}${targetIsMoon ? " moon" : ""}`;
  const etaRange = plan.orders.length > 0
    ? {
      earliest: Math.min(...plan.orders.map((order) => order.travelSeconds)),
      latest: Math.max(...plan.orders.map((order) => order.travelSeconds)),
    }
    : undefined;
  const missionNoun = mission === "transport" ? "transport" : "deployment";
  const hiddenShipTypes = sources.some((source) => !source.unavailableReason && supplyShips.some(({ key }) => (source.ships[key] ?? 0) > 0 && !(shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes).includes(key)));

  const reviewInventory = () => { setInventoryNeedsReview(false); setReviewedFailure(error); };
  // Max is a synchronous, budgeted search over the same preview inputs; it also counts as a review
  // of the latest inventory, since its total is computed from it.
  const applyMax = (resource: keyof SupplyResources) => {
    if (busy || goalNeedsReview) return;
    const maximum = maximumBatchSupplyResource(planOptions, resource);
    reviewInventory();
    setRequested((current) => ({ ...current, [resource]: maximum === 0 ? "" : String(maximum) }));
  };
  // Short resources become what the selected sources can actually send. Max keeps an existing
  // shortfall of another resource untouched, so drop every short resource first, then fill them
  // one by one in cargo order: each step is an exact (replayed) Max, so the result launches.
  const sendAvailable = () => {
    if (busy || goalNeedsReview) return;
    const short = resourceKeys.filter(key => remaining[key] > 0);
    let next: SupplyResources = { ...requestedNumbers, ...Object.fromEntries(short.map(key => [key, 0])) };
    for (const key of short) next = { ...next, [key]: maximumBatchSupplyResource({ ...planOptions, requested: next }, key) };
    reviewInventory();
    setRequested(supplyResourceInputValues(next));
  };
  const toggleSource = (planetId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(planetId)) next.delete(planetId);
      else if (next.size < Math.min(maxSources, MAX_TRANSPORT_BATCH_MISSIONS)) next.add(planetId);
      return next;
    });
  };
  const toggleExpanded = (planetId: string) => setExpandedSourceIds((current) => {
    const next = new Set(current);
    if (next.has(planetId)) next.delete(planetId); else next.add(planetId);
    return next;
  });

  const updateSourceCargo = (source: BatchSupplySource, resource: keyof SupplyResources, value: string) => {
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
      <div className="shrink-0 px-4 pt-4 pb-2"><ModalHeader alignment="center" closeLabel="Close supply resources" icon={PackagePlus} onClose={onClose} title={`Supply ${targetLabel}`} /></div>
      <div className="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain px-4 pb-3 [overflow-anchor:none]" data-supply-scroll>
        {upgrade ? <section aria-label="Upgrade requirement" className="grid gap-1 text-xs text-slate-300">
          <strong className="text-sm text-white">{upgrade.label} · {levelRange ? `Levels ${levelRange}` : `Level ${upgrade.level}`} · {targetIsMoon ? "Moon" : "Planet"} {target.coordinates}</strong>
          {preview ? <p>{levelRange ? `Total cost for levels ${levelRange}` : "Level cost"}: M {format(preview.requirement.metal)} · C {format(preview.requirement.crystal)} · D {format(preview.requirement.deuterium)}</p> : null}
          {preview && resourceTotal(preview.missing) === 0 ? <p role="status">{preview.inProgress ? "Already funded: this level is in progress. No resources need to be sent." : preview.energyOnly ? "This research requires energy, not shippable resources." : `Fully funded: no resources need to be sent for ${levelRange ? "these levels" : "this level"}.`}</p> : null}
          {preview && resourceKeys.some(key => preview.missing[key] !== requestedNumbers[key]) ? <p className="text-amber-100">Current shortfall: M {format(preview.missing.metal)} · C {format(preview.missing.crystal)} · D {format(preview.missing.deuterium)}. Refresh to replace your reviewed totals.</p> : null}
          {!preview ? <p role="status">{loading ? "Refreshing destination resources…" : "Live destination resources are unavailable. Refresh to retry."}</p> : null}
          {onRefresh ? <button className="min-h-8 justify-self-start rounded border border-white/20 px-2" disabled={busy} onClick={() => { refreshRequested.current = true; onRefresh(); }} type="button">Refresh destination and shortfall</button> : null}
        </section> : null}

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/20 p-1" role="group" aria-label="Mission type">
          {(["transport", "deploy"] as const).map(kind => {
            const Icon = kind === "transport" ? Package : Rocket;
            const label = kind === "transport" ? "Transport" : "Deploy";
            return <button key={kind} type="button" aria-label={label} title={label} aria-pressed={mission === kind}
              disabled={busy}
              onClick={() => setMission(kind)}
              className={"inline-flex min-h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50 " + (mission === kind ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:text-white")}>
              <Icon aria-hidden="true" size={16} />
              {label}
            </button>;
          })}
        </div>

        {goalNeedsReview ? <p role="alert" className="text-xs text-amber-100">Destination goal changed. Your draft is unchanged; refresh destination and shortfall to review it before launching.</p> : null}
        {inventoryChanged ? <div className="flex flex-wrap items-center gap-2 text-xs text-amber-100" aria-live="polite">
          <span>Source inventory changed. Your draft is unchanged.</span>
          <button type="button" className="min-h-8 rounded border border-amber-200/30 px-2" disabled={busy} onClick={reviewInventory}>Review latest inventory</button>
        </div> : null}
        {targetIsMoon && !moonBatchSupported ? <p className="text-sm text-slate-300" role="status">{MOON_SUPPLY_BATCH_UNAVAILABLE}</p> : null}

        <div className="grid gap-2" data-supply-amounts>
          <section className="grid grid-cols-3 gap-2" aria-label="Resources to send">
            {resourceKeys.map((resource) => (
              <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded-lg surface-inset px-2 py-1.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-2" key={resource}>
                <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{resourceLetter(resource)}</span>
                <span className="contents">
                  <input
                    aria-label={`${resource} to send`}
                    disabled={busy}
                    className="min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none focus:border-cyan-300"
                    inputMode="numeric"
                    min="0"
                    onInput={(event) => setRequested((current) => ({ ...current, [resource]: numericInput(event.currentTarget.value) }))}
                    placeholder="0"
                    value={requested[resource]}
                  />
                  <button className="col-span-2 min-h-8 whitespace-nowrap rounded border border-cyan-300/35 px-2 sm:col-span-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/10" disabled={busy || goalNeedsReview} onClick={() => applyMax(resource)} type="button">Max</button>
                </span>
              </label>
            ))}
          </section>
          {missingTotal > 0 && !loading ? (
            <div aria-label="Supply totals" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-amber-300/30 bg-amber-300/10 p-2 text-xs text-amber-100" role="status">
              <span className="min-w-0 flex-1">Short {formatResources(remaining)}. {hiddenShipTypes ? "Enable more ship types, select more sources, or reduce the request." : "Select more sources with available cargo ships, or reduce the request."}</span>
              {!upgrade && resourceTotal(plan.delivered) > 0 ? (
                <button className="min-h-8 shrink-0 rounded border border-amber-200/40 px-2 font-semibold text-amber-50 hover:bg-amber-200/10" disabled={busy || goalNeedsReview} onClick={sendAvailable} type="button">
                  Send what's available
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <section className="grid gap-1" aria-label="Source planets" data-supply-details>
          <div className="flex items-center justify-between gap-3">
            <h3 className="shrink-0 text-sm font-semibold text-slate-100">From</h3>
            <span className="text-xs text-slate-400">{selected.size}/{sources.length} selected</span>
          </div>
          <div className="grid content-start border-t border-cyan-300/[0.08]">
            {loading && sources.length === 0 ? (
              <SkeletonRegion className="grid gap-2 pt-2" label="Loading cargo fleets">
                {skeletonList(3, (index) => (
                  <div key={index} className="grid gap-2 rounded-lg border border-white/10 p-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </SkeletonRegion>
            ) : sources.length === 0 ? (
              <div className="mt-2 rounded-lg border border-white/10 p-4 text-sm text-slate-300">No other owned planets can supply this target.</div>
            ) : sources.map((source) => {
              const checked = selected.has(source.planetId);
              const sourceLimitReason = batchSupplySourceLimitReason({
                checked,
                maxSources,
                selectedSourceCount: selected.size,
                unavailableReason: source.unavailableReason,
              });
              const usable = hasUsableSupplyFleet(source.ships);
              const allowedShipTypes = shipTypesBySource[source.planetId] ?? defaultSupplyShipTypes;
              const eligibleShips = allowedSupplyShips(source.ships, allowedShipTypes);
              const typeUnavailableReason = usable && !hasUsableSupplyFleet(eligibleShips)
                ? "No ships of the selected types. Enable another ship type to use this source."
                : undefined;
              const disabled = busy || Boolean(source.unavailableReason) || (!checked && !usable) || sourceLimitReason !== undefined;
              const selectionReason = source.unavailableReason ? playerNotice(source.unavailableReason) : sourceLimitReason ?? (!usable ? "No mobile ships are available on this planet." : undefined);
              const order = orderByOrigin.get(source.planetId);
              const requestedSourceCargo = sourceCargoOverrides[source.planetId];
              const sourceCargo = requestedSourceCargo ?? order?.cargo ?? emptySupplyResources();
              const hasManualCargo = requestedSourceCargo !== undefined;
              const shipmentAdjusted = requestedSourceCargo !== undefined && resourceKeys.some(key => (order?.cargo[key] ?? 0) !== requestedSourceCargo[key]);
              const distance = fleetMissionDistance(source.coordinates, { galaxy: target.galaxy, system: target.system, position: target.position }, { targetIsMoon });
              const eta = order?.travelSeconds ?? fleetMissionTravelSeconds(distance, eligibleShips, source.driveLevels);
              const expanded = checked && expandedSourceIds.has(source.planetId);
              const summary = !checked
                ? selectionReason ?? `Has ${formatResources(source.resources)}`
                : order
                  ? `Sends ${formatResources(order.cargo)} · ${shipSummary(order.ships)} · ${formatDuration(eta)}${order.fuelCost ? ` · fuel ${format(order.fuelCost)} D` : ""}`
                  : source.unavailableReason ? playerNotice(source.unavailableReason)
                    : typeUnavailableReason ?? (!usable ? "No mobile ships are available on this planet." : resourceTotal(plan.missing) === 0 ? "Not needed for this request." : "No contribution: check stock, selected ships and fuel.");
              const warn = Boolean(checked && (source.unavailableReason || typeUnavailableReason || shipmentAdjusted || (!order && usable && resourceTotal(plan.missing) > 0)));
              return (
                <div className={`grid border-b border-cyan-300/[0.08] ${source.unavailableReason ? "opacity-60" : ""}`} key={source.planetId} data-supply-source={source.planetId}>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5">
                    <label className="flex min-h-8 cursor-pointer items-center" title={selectionReason}>
                      <input checked={checked} aria-describedby={selectionReason ? "supply-selection-" + source.planetId : undefined} disabled={disabled} onChange={() => toggleSource(source.planetId)} type="checkbox" />
                      <span className="sr-only">Select {source.label}</span>
                      {selectionReason ? <span className="sr-only" id={"supply-selection-" + source.planetId}>{selectionReason}</span> : null}
                    </label>
                    <span className={`min-w-0 ${checked ? "" : "opacity-70"}`}>
                      <span className="block text-sm font-medium text-white">{source.label} <span className="whitespace-nowrap font-mono text-xs text-slate-400">[{source.coordinates.galaxy}:{source.coordinates.system}:{source.coordinates.position}]</span></span>
                      <span className={`block text-xs ${warn ? "text-amber-200" : checked && order ? "text-cyan-100" : "text-slate-400"}`}>{summary}</span>
                    </span>
                    {checked && usable && !source.unavailableReason ? (
                      <button type="button" aria-expanded={expanded} aria-label={`Edit ${source.label} shipment`}
                        className="inline-flex min-h-8 items-center gap-1 rounded border border-white/15 px-2 text-xs text-slate-200 hover:bg-white/10"
                        onClick={() => toggleExpanded(source.planetId)}>
                        Edit
                        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
                      </button>
                    ) : <span aria-hidden="true" />}
                  </div>
                  {expanded ? <div className="grid gap-2 px-1 pb-3 pl-8" aria-label={`${source.label} shipment`}>
                    <span className="text-xs text-slate-400">Available: M {format(source.resources.metal)} · C {format(source.resources.crystal)} · D {format(source.resources.deuterium)}</span>
                    <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                      {resourceKeys.map((resource) => (
                        <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded surface-inset px-1.5 py-1" key={resource}>
                          <span className="text-[10px] font-bold text-slate-400">{resourceLetter(resource)}</span>
                          <input
                            aria-label={`${source.label} ${resource} to send`}
                            disabled={!checked || busy || Boolean(source.unavailableReason)}
                            className="min-w-0 w-full bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
                            inputMode="numeric"
                            min="0"
                            onInput={(event) => updateSourceCargo(source, resource, event.currentTarget.value)}
                            value={String(sourceCargo[resource])}
                          />
                        </label>
                      ))}
                      {hasManualCargo ? <button className="min-h-7 rounded border border-white/15 px-1.5 text-[10px] font-semibold text-slate-300 hover:bg-white/10" disabled={busy} onClick={() => restoreAutomaticSourceCargo(source.planetId)} type="button">Auto</button> : <span aria-hidden="true" />}
                    </span>
                    {shipmentAdjusted ? <span className="text-[11px] text-amber-200">Planned cargo is lower than your manual request. Review stock, capacity and fuel.</span> : null}
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ships · planned / available</span>
                      <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Planned fleet at ${source.label}`}>
                        {supplyShips.filter(({ key }) => (source.ships[key] ?? 0) > 0).map(({ key, label }) => {
                          const included = allowedShipTypes.includes(key);
                          return (
                            <button key={key} type="button" aria-pressed={included}
                              aria-label={label + " at " + source.label}
                              aria-describedby={`supply-planned-${source.planetId}-${key}`}
                              disabled={busy || Boolean(source.unavailableReason)}
                              title={`${label}: ${format(source.ships[key] ?? 0)} available; ${format(order?.ships[key] ?? 0)} planned`}
                              className="group inline-flex min-h-6 min-w-6 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => setShipTypesBySource((current) => {
                                const types = current[source.planetId] ?? defaultSupplyShipTypes;
                                return { ...current, [source.planetId]: types.includes(key) ? types.filter((type) => type !== key) : [...types, key] };
                              })}>
                              <span className={"inline-flex items-center gap-0.5 rounded border p-0.5 text-[10px] group-hover:border-cyan-300/60 " + (included ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100" : "border-white/15 bg-black/20 text-slate-400")}>
                                <AssetImage alt="" className={"h-5 w-5 rounded object-contain " + (included ? "" : "opacity-50")} loading="lazy" src={shipAssetByKey[key]} />
                                <span id={`supply-planned-${source.planetId}-${key}`}>×{format(order?.ships[key] ?? 0)}<span className="sr-only"> planned</span> / {format(source.ships[key] ?? 0)}<span className="sr-only"> available</span></span>
                              </span>
                            </button>
                          );
                        })}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className="min-h-8 rounded border border-white/20 px-2 text-xs text-cyan-100"
                        aria-label={`Select all ships at ${source.label}`}
                        disabled={busy || Boolean(source.unavailableReason)}
                        onClick={() => {
                          setShipTypesBySource(current => ({ ...current, [source.planetId]: supplyShips.filter(({ key }) => (source.ships[key] ?? 0) > 0).map(({ key }) => key) }));
                          setFleetModesBySource(current => ({ ...current, [source.planetId]: "all" }));
                        }}>Select all ships</button>
                      {fleetModesBySource[source.planetId] === "all" ? <button type="button" className="min-h-8 rounded border border-white/20 px-2 text-xs text-slate-300"
                        disabled={busy}
                        onClick={() => {
                          setFleetModesBySource(current => ({ ...current, [source.planetId]: "auto" }));
                          setShipTypesBySource(current => ({ ...current, [source.planetId]: defaultSupplyShipTypes }));
                        }}>Reset to automatic cargo</button> : null}
                    </span>
                  </div> : null}
                </div>
              );
            })}
          </div>
        </section>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          {!loading && fleetSlotsKnown && maxSources === 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">All fleet slots are currently occupied. Wait for a fleet to return or research Computer Technology before supplying this planet.</p> : null}
          {plan.sourceLimitReached ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Select at most {maxSources} sources because that is your current fleet-slot capacity.</p> : null}
          {plan.blockedSources.length > 0 ? <p className="rounded border border-amber-300/30 bg-amber-300/10 p-2 text-sm text-amber-100">Some selected sources cannot launch: {plan.blockedSources.map((blocked) => `${sources.find(source => source.planetId === blocked.planetId)?.label ?? blocked.planetId}: ${blocked.reason}`).join(" ")}</p> : null}
          {manualCargoAdjusted ? <p className="text-xs text-amber-100">A manual shipment exceeds current stock or capacity. Edit it or restore Auto before launching.</p> : null}
          {transactionPending ? <p className="rounded border border-cyan-300/30 bg-cyan-300/10 p-2 text-sm text-cyan-100">Processing… You can close this window.</p> : null}
          {missionLimitError ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{missionLimitError}</p> : null}
          {(error ?? canonicalTransactionError) ? <p className="rounded border border-red-300/30 bg-red-300/10 p-2 text-sm text-red-100">{error ?? canonicalTransactionError}</p> : null}
        </div>
      </div>
      <footer className="grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)] gap-2 border-t border-white/10 bg-[#0d1829] p-3">
        <div className="text-sm text-slate-300">
          <strong className="text-white">{plan.orders.length} {missionNoun}{plan.orders.length === 1 ? "" : "s"}</strong>
          <span> · {formatResources(plan.delivered)} · fuel {format(plan.fuelCost)} D</span>
          {etaRange ? <span> · arrives {formatDuration(etaRange.earliest)}{etaRange.latest === etaRange.earliest ? "" : `–${formatDuration(etaRange.latest)}`}</span> : null}
        </div>
        <button className="inline-flex w-full min-w-0 items-center justify-center gap-2 whitespace-normal rounded bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm" disabled={!canSubmit} onClick={() => { if (canSubmit) onConfirm(plan.orders, shipTypesBySource, mission, fleetModesBySource); }} type="button">
          <Check aria-hidden="true" className="shrink-0" size={16} />
          <span className="min-w-0">{transactionPending ? "Processing…" : actionPending ? "Launching…" : `Launch ${plan.orders.length} ${missionNoun}${plan.orders.length === 1 ? "" : "s"} ${targetIsMoon ? "to moon in one call" : "in one call"}`}</span>
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

function resourceLetter(resource: keyof SupplyResources): string {
  return resource === "metal" ? "M" : resource === "crystal" ? "C" : "D";
}

/** "M 14,560 · C 2,000", skipping empty resources ("nothing" when all are empty). */
function formatResources(resources: SupplyResources): string {
  const parts = resourceKeys.filter(key => resources[key] > 0).map(key => `${resourceLetter(key)} ${format(resources[key])}`);
  return parts.length ? parts.join(" · ") : "nothing";
}

/** "2 Large Cargo, 1 Small Cargo". */
function shipSummary(ships: Partial<Record<SupplyShipKey, number>>): string {
  const parts = supplyShips.filter(({ key }) => (ships[key] ?? 0) > 0).map(({ key, label }) => `${format(ships[key] ?? 0)} ${label}`);
  return parts.length ? parts.join(", ") : "no ships";
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
