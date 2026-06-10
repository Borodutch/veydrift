import { useMemo, useState } from "preact/hooks";
import type { Coordinates, Planet } from "../types";
import {
  DEFAULT_MISSION_SPEED_PERCENT,
  MISSION_SPEED_OPTIONS,
  fleetMissionAvailableCargoCapacity,
  fleetMissionCargoCapacity,
  fleetMissionDistance,
  fleetMissionFuelCost,
  fleetMissionShipCount,
  fleetMissionTravelSeconds,
  type FleetDriveLevels,
} from "../fleetMissionRules";
import { emptyMissionShips, type GalaxyAction, type MissionShipKey, type MissionShips } from "../galaxyActions";
import type { ChainShipyardState } from "../walletFlow";
import { formatDuration } from "../durationFormat";
import { formatUserTimestamp } from "../timestampFormat";

export type MissionCargoDraft = {
  metal?: string | undefined;
  crystal?: string | undefined;
  deuterium?: string | undefined;
};

export type MissionLootRatioDraft = {
  metal: number;
  crystal: number;
  deuterium: number;
};

export type MissionLaunchDraft = {
  speedPercent: number;
  ships: MissionShips;
  cargo?: MissionCargoDraft | undefined;
  lootRatio?: MissionLootRatioDraft | undefined;
  primaryTargetId?: number | undefined;
  quantity?: number | undefined;
};

export const LOOT_RATIO_TOTAL_PERCENT = 100;
const DEFAULT_LOOT_RATIO: MissionLootRatioDraft = { metal: 34, crystal: 33, deuterium: 33 };

type EnabledGalaxyAction = Extract<GalaxyAction, { enabled: true }>;

type MissionResourceSnapshot = {
  metal: number;
  crystal: number;
  deuterium: number;
};

type ShipOption = {
  key: MissionShipKey;
  id: number;
  label: string;
};

const missionShipOptions: ShipOption[] = [
  { key: "smallCargo", id: 0, label: "Small Cargo" },
  { key: "lightFighter", id: 1, label: "Light Fighter" },
  { key: "recycler", id: 2, label: "Recycler" },
  { key: "colonyShip", id: 3, label: "Colony Ship" },
  { key: "largeCargo", id: 4, label: "Large Cargo" },
  { key: "heavyFighter", id: 5, label: "Heavy Fighter" },
  { key: "cruiser", id: 6, label: "Cruiser" },
  { key: "battleship", id: 7, label: "Battleship" },
  { key: "bomber", id: 8, label: "Bomber" },
  { key: "destroyer", id: 10, label: "Destroyer" },
  { key: "deathstar", id: 11, label: "Deathstar" },
  { key: "battlecruiser", id: 12, label: "Battlecruiser" },
  { key: "reaper", id: 13, label: "Reaper" },
  { key: "pathfinder", id: 14, label: "Pathfinder" },
];

const cargoShipKeys = new Set<MissionShipKey>(["smallCargo", "largeCargo", "pathfinder", "recycler", "colonyShip"]);

export function MissionCreationPage({
  action,
  actionPending,
  coords,
  driveLevels = {},
  onBack,
  onConfirm,
  originCoords,
  originLabel,
  resources,
  shipyardState,
  target,
  targetLabel,
  targetOwnerLabel,
}: {
  action: EnabledGalaxyAction;
  actionPending: boolean;
  coords: Coordinates;
  driveLevels?: FleetDriveLevels | undefined;
  onBack: () => void;
  onConfirm: (draft: MissionLaunchDraft) => void;
  originCoords: Coordinates | undefined;
  originLabel?: string | undefined;
  resources?: MissionResourceSnapshot | undefined;
  shipyardState: ChainShipyardState | null;
  target: Planet | undefined;
  // Display fallbacks for callers that have no full Planet record (e.g. joining an alliance attack
  // from Mission Control, where only the mission's target reference is available).
  targetLabel?: string | undefined;
  targetOwnerLabel?: string | undefined;
}) {
  const [speedPercent, setSpeedPercent] = useState(DEFAULT_MISSION_SPEED_PERCENT);
  const [ships, setShips] = useState<MissionShips>(() => initialMissionShips(action));
  const [cargo, setCargo] = useState<MissionCargoDraft>({});
  const [lootRatioEnabled, setLootRatioEnabled] = useState(false);
  const [lootRatio, setLootRatio] = useState<MissionLootRatioDraft>(DEFAULT_LOOT_RATIO);
  const [primaryTargetId, setPrimaryTargetId] = useState(action.mode === "missile" ? action.primaryTargetId : 0);
  const [quantity, setQuantity] = useState(action.mode === "missile" ? action.quantity : 1);

  const distance = originCoords ? fleetMissionDistance(originCoords, coords) : 0;
  const travelSeconds = action.mode === "missile" ? 0 : fleetMissionTravelSeconds(distance, ships, driveLevels, speedPercent);
  const fuelCost = action.mode === "missile" ? 0 : fleetMissionFuelCost(ships, distance, driveLevels, speedPercent);
  const totalCargoCapacity = action.mode === "missile" ? 0 : fleetMissionCargoCapacity(ships);
  const cargoCapacity = action.mode === "missile" ? 0 : fleetMissionAvailableCargoCapacity(ships, distance, driveLevels, speedPercent);
  const selectedShipCount = action.mode === "missile" ? 0 : fleetMissionShipCount(ships);
  const availableShips = useMemo(() => missionShipOptionsForAction(action, shipyardState), [action, shipyardState]);
  const cargoSupported = action.mode === "mission" && (action.kind === "transport" || action.kind === "deploy");
  const cargoTotal = resourceDraftNumber(cargo.metal) + resourceDraftNumber(cargo.crystal) + resourceDraftNumber(cargo.deuterium);
  // joinAttack catches an in-flight group, so its on-chain call takes no speed of its own — hide the
  // selector and keep the default 100% used for the summary's fuel/arrival estimate (VEY-KANEO-431).
  const speedSupported = action.kind !== "joinAttack";
  const lootRatioSupported = action.mode === "mission" && action.kind === "attack";
  const lootRatioActive = lootRatioSupported && lootRatioEnabled;
  const lootRatioTotal = lootRatio.metal + lootRatio.crystal + lootRatio.deuterium;
  const timingSummary = missionTimingSummary(travelSeconds);
  const blockedReason = missionDraftBlocker({
    action,
    cargoCapacity,
    cargoSupported,
    cargoTotal,
    fleetSlots: shipyardState?.fleetSlots,
    fuelCost,
    lootRatioActive,
    lootRatioTotal,
    originCoords,
    quantity,
    resources,
    selectedShipCount,
    totalCargoCapacity,
  });

  const maxCargoResources = {
    metal: Math.max(0, Math.trunc(resources?.metal ?? 0)),
    crystal: Math.max(0, Math.trunc(resources?.crystal ?? 0)),
    deuterium: Math.max(0, Math.trunc((resources?.deuterium ?? 0) - fuelCost)),
  };

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{action.label} Mission</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {originLabel ?? "Active planet"} to [{coords.galaxy}:{coords.system}:{coords.position}]
          </p>
        </div>
        <button
          className="rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="grid gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target</h3>
            <div className="text-sm font-medium text-white">
              {target?.name ?? targetLabel ?? `Coordinate ${coords.galaxy}:${coords.system}:${coords.position}`}
            </div>
            <div className="text-xs text-slate-500">
              {target?.occupiedBy?.ownerDisplayName ?? target?.owner ?? targetOwnerLabel ?? "Open coordinate"}
            </div>
          </div>

          {action.mode === "missile" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Missiles"
                min={1}
                onChange={setQuantity}
                value={quantity}
              />
              <NumberField
                label="Primary target"
                min={0}
                onChange={setPrimaryTargetId}
                value={primaryTargetId}
              />
            </div>
          ) : (
            <div className="grid gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ships</h3>
              {availableShips.length > 0 ? (
                <div className="grid gap-2">
                  {availableShips.map((ship) => {
                    const owned = shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0;
                    return (
                      <label className="grid gap-1 rounded border border-white/10 bg-black/15 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center" key={ship.key}>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-200">{ship.label}</span>
                          <span className="block text-xs text-slate-500">{owned.toLocaleString()} available</span>
                        </span>
                        <input
                          className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
                          inputMode="numeric"
                          max={owned}
                          min={0}
                          onInput={(event) => setShips((current) => ({
                            ...current,
                            [ship.key]: clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, owned),
                          }))}
                          type="number"
                          value={ships[ship.key] ?? 0}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                  No eligible ships are available on the active planet.
                </p>
              )}
            </div>
          )}

          {cargoSupported ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cargo</h3>
                <span className="text-xs text-slate-500">Capacity {cargoCapacity.toLocaleString()}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <ResourceField label="Metal" max={maxCargoResources.metal} onChange={(metal) => setCargo((current) => ({ ...current, metal }))} value={cargo.metal ?? ""} />
                <ResourceField label="Crystal" max={maxCargoResources.crystal} onChange={(crystal) => setCargo((current) => ({ ...current, crystal }))} value={cargo.crystal ?? ""} />
                <ResourceField label="Deuterium" max={maxCargoResources.deuterium} onChange={(deuterium) => setCargo((current) => ({ ...current, deuterium }))} value={cargo.deuterium ?? ""} />
              </div>
            </div>
          ) : null}

          {speedSupported ? (
          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Speed</h3>
            <div className="flex flex-wrap gap-1.5">
              {MISSION_SPEED_OPTIONS.map((speed) => (
                <button
                  aria-pressed={speedPercent === speed}
                  className={`h-8 rounded border px-2 text-xs font-semibold transition ${
                    speedPercent === speed
                      ? "border-signal/45 bg-signal/15 text-signal"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
                  }`}
                  key={speed}
                  onClick={() => setSpeedPercent(speed)}
                  type="button"
                >
                  {speed}%
                </button>
              ))}
            </div>
          </div>
          ) : null}

          {lootRatioSupported ? (
            <div className="grid gap-2">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Loot ratio</span>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  Custom split
                  <input
                    checked={lootRatioEnabled}
                    className="h-4 w-4 accent-signal [color-scheme:dark]"
                    onChange={(event) => setLootRatioEnabled((event.currentTarget as HTMLInputElement).checked)}
                    type="checkbox"
                  />
                </span>
              </label>
              {lootRatioEnabled ? (
                <div className="grid gap-2">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <PercentField label="Metal %" onChange={(metal) => setLootRatio((current) => ({ ...current, metal }))} value={lootRatio.metal} />
                    <PercentField label="Crystal %" onChange={(crystal) => setLootRatio((current) => ({ ...current, crystal }))} value={lootRatio.crystal} />
                    <PercentField label="Deuterium %" onChange={(deuterium) => setLootRatio((current) => ({ ...current, deuterium }))} value={lootRatio.deuterium} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className={lootRatioTotal === LOOT_RATIO_TOTAL_PERCENT ? "text-slate-500" : "text-amber-200"}>
                      Total {lootRatioTotal}% (must equal {LOOT_RATIO_TOTAL_PERCENT}%)
                    </span>
                    <button
                      className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-semibold text-slate-400 transition hover:border-white/20 hover:text-white"
                      onClick={() => setLootRatio(DEFAULT_LOOT_RATIO)}
                      type="button"
                    >
                      Even split
                    </button>
                  </div>
                  {lootRatioTotal === LOOT_RATIO_TOTAL_PERCENT && cargoCapacity > 0 ? (
                    <p className="text-xs text-slate-500">
                      Up to {Math.floor((cargoCapacity * lootRatio.metal) / 100).toLocaleString()} metal /{" "}
                      {Math.floor((cargoCapacity * lootRatio.crystal) / 100).toLocaleString()} crystal /{" "}
                      {Math.floor((cargoCapacity * lootRatio.deuterium) / 100).toLocaleString()} deuterium of cargo capacity.
                      Unfilled shares roll over to the other resources.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">Unfilled shares roll over to the other resources.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Loot fills greedily (metal, then crystal, then deuterium).</p>
              )}
            </div>
          ) : null}
        </section>

        <aside className="grid content-start gap-3 rounded-lg border border-white/10 bg-[#101624] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mission Summary</h3>
          <SummaryRow label="Distance" value={distance.toLocaleString()} />
          <SummaryRow label="Ships" value={action.mode === "missile" ? "Missile launch" : selectedShipCount.toLocaleString()} />
          <SummaryRow label="Fuel" value={`${fuelCost.toLocaleString()} / ${totalCargoCapacity.toLocaleString()} deuterium`} />
          <SummaryRow label="Cargo" value={cargoSupported ? `${cargoTotal.toLocaleString()} / ${cargoCapacity.toLocaleString()}` : "None"} />
          {timingSummary ? (
            <>
              <SummaryRow label="Arrival" subvalue={timingSummary.arrivalClock} value={timingSummary.arrivalDuration} />
              <SummaryRow label="Return" subvalue={timingSummary.returnClock} value={timingSummary.returnDuration} />
            </>
          ) : null}
          {blockedReason ? (
            <p className="rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
              {blockedReason}
            </p>
          ) : null}
          <button
            className="h-10 rounded border border-signal/35 bg-signal/15 px-3 text-sm font-semibold text-signal transition hover:bg-signal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
            disabled={Boolean(blockedReason) || actionPending}
            onClick={() => onConfirm({
              speedPercent,
              ships,
              cargo: cargoSupported ? normalizeCargoDraft(cargo) : undefined,
              lootRatio: lootRatioActive ? { ...lootRatio } : undefined,
              primaryTargetId,
              quantity,
            })}
            type="button"
          >
            Confirm Mission
          </button>
        </aside>
      </div>
    </div>
  );
}

export function missionDraftBlocker({
  action,
  cargoCapacity,
  cargoSupported,
  cargoTotal,
  fleetSlots,
  fuelCost,
  lootRatioActive = false,
  lootRatioTotal = 0,
  originCoords,
  quantity,
  resources,
  selectedShipCount,
  totalCargoCapacity,
}: {
  action: EnabledGalaxyAction;
  cargoCapacity: number;
  cargoSupported: boolean;
  cargoTotal: number;
  fleetSlots?: { active: number; limit: number } | undefined;
  fuelCost: number;
  lootRatioActive?: boolean | undefined;
  lootRatioTotal?: number | undefined;
  originCoords: Coordinates | undefined;
  quantity: number;
  resources: MissionResourceSnapshot | undefined;
  selectedShipCount: number;
  totalCargoCapacity: number;
}): string | undefined {
  if (!originCoords) return "Active origin planet is unavailable.";
  // Interplanetary missiles do not occupy fleet slots, so they skip the fleet-slot gate below.
  if (action.mode === "missile") return quantity > 0 ? undefined : "Choose at least one missile.";
  // Every fleet mission (attack/transport/deploy/harvest/colonize) consumes a fleet slot, capped at
  // 1 + Computer Technology level on-chain (FleetSlotLimitReached). Block before submit when the cap is
  // reached and name the lever. Fail open when the backend did not provide slot counts so a valid
  // launch is never blocked; the on-chain revert remains the backstop.
  if (fleetSlots && fleetSlots.limit > 0 && fleetSlots.active >= fleetSlots.limit) {
    return `Fleet slots full (${fleetSlots.active}/${fleetSlots.limit}) — research Computer Technology to raise the limit, or wait for a fleet to return.`;
  }
  if (selectedShipCount <= 0) return "Choose at least one ship.";
  if ((resources?.deuterium ?? 0) < fuelCost) return `Need ${fuelCost.toLocaleString()} deuterium for fuel.`;
  if (fuelCost > totalCargoCapacity) {
    return `Selected ships have ${totalCargoCapacity.toLocaleString()} cargo capacity, but this mission needs ${fuelCost.toLocaleString()} for fuel.`;
  }
  if (cargoSupported && cargoTotal > cargoCapacity) return "Cargo exceeds available capacity.";
  if (cargoSupported && cargoTotal < 0) return "Cargo cannot be negative.";
  if (lootRatioActive && lootRatioTotal !== LOOT_RATIO_TOTAL_PERCENT) {
    return `Loot ratio must total ${LOOT_RATIO_TOTAL_PERCENT}%.`;
  }
  return undefined;
}

export function missionTimingSummary(travelSeconds: number, nowMs: number = Date.now()): {
  arrivalClock: string;
  arrivalDuration: string;
  returnClock: string;
  returnDuration: string;
} | null {
  if (!Number.isFinite(travelSeconds) || travelSeconds <= 0) return null;
  const arrivalSeconds = Math.ceil(travelSeconds);
  const returnSeconds = arrivalSeconds * 2;
  const arrivalAt = nowMs + arrivalSeconds * 1_000;
  const returnAt = nowMs + returnSeconds * 1_000;
  return {
    arrivalClock: formatUserTimestamp(arrivalAt),
    arrivalDuration: formatDuration(arrivalSeconds),
    returnClock: formatUserTimestamp(returnAt),
    returnDuration: formatDuration(returnSeconds),
  };
}

function initialMissionShips(action: EnabledGalaxyAction): MissionShips {
  return action.mode === "missile" ? emptyMissionShips() : { ...emptyMissionShips(), ...action.ships };
}

function missionShipOptionsForAction(action: EnabledGalaxyAction, shipyardState: ChainShipyardState | null): ShipOption[] {
  if (action.mode === "missile") return [];
  const allowed = allowedShipKeysForAction(action);
  return missionShipOptions.filter((ship) => allowed.has(ship.key) && (shipyardState?.ships.find((item) => item.id === ship.id)?.count ?? 0) > 0);
}

function allowedShipKeysForAction(action: EnabledGalaxyAction): Set<MissionShipKey> {
  if (action.kind === "colonize") return new Set(["colonyShip"]);
  if (action.kind === "harvest") return new Set(["recycler"]);
  if (action.kind === "transport" || action.kind === "deploy") return cargoShipKeys;
  return new Set(missionShipOptions.map((ship) => ship.key).filter((key) => key !== "colonyShip"));
}

function normalizeCargoDraft(cargo: MissionCargoDraft): MissionCargoDraft | undefined {
  const normalized = {
    metal: String(resourceDraftNumber(cargo.metal)),
    crystal: String(resourceDraftNumber(cargo.crystal)),
    deuterium: String(resourceDraftNumber(cargo.deuterium)),
  };
  return normalized.metal === "0" && normalized.crystal === "0" && normalized.deuterium === "0"
    ? undefined
    : normalized;
}

function ResourceField({
  label,
  max,
  onChange,
  value,
}: {
  label: string;
  max: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        max={max}
        min={0}
        onInput={(event) => onChange(String(clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, max)))}
        placeholder="0"
        type="number"
        value={value}
      />
    </label>
  );
}

function PercentField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        max={LOOT_RATIO_TOTAL_PERCENT}
        min={0}
        onInput={(event) => onChange(clampInteger(Number((event.currentTarget as HTMLInputElement).value), 0, LOOT_RATIO_TOTAL_PERCENT))}
        type="number"
        value={value}
      />
    </label>
  );
}

function NumberField({
  label,
  min,
  onChange,
  value,
}: {
  label: string;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        className="h-9 rounded border border-white/10 bg-[#070913] px-2 text-right font-mono text-sm text-white outline-none [color-scheme:dark] focus:border-signal/50"
        inputMode="numeric"
        min={min}
        onInput={(event) => onChange(Math.max(min, Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || min)))}
        type="number"
        value={value}
      />
    </label>
  );
}

function SummaryRow({ label, subvalue, value }: { label: string; subvalue?: string | undefined; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-2 text-sm last:border-b-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right">
        <span className="block font-medium text-slate-200">{value}</span>
        {subvalue ? <span className="block text-xs text-slate-500">{subvalue}</span> : null}
      </span>
    </div>
  );
}

function resourceDraftNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
