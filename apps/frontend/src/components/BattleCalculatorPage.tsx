import { Download, Moon, Plus, X } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { activeCombatModel, REFEREE_COMBAT_MODEL_VERSION } from "../battlePreview";
import {
  clampCount,
  decodeSetup,
  emptyFleet,
  emptySetup,
  encodeSetup,
  fleetHasUnits,
  isFleetShip,
  isPlayableShip,
  loadForcesAt,
  MAX_COORDS_LENGTH,
  MAX_FLEETS,
  setupToBattleInput,
  type CalculatorFleet,
  type CalculatorSetup,
} from "../battleCalculatorState";
import { EXACT_SIMULATION, useBattleSimulation } from "../battleSimulation";
import { useVerifiedCombatModel } from "../combatModel";
import { defenseAssetByKey, shipAssetByKey } from "../gameAssets";
import { defenseCatalog, shipCatalog } from "../playableMvp";
import { apiBaseUrlForRuntimeConfig, runtimeConfigUrl } from "../runtimeConfig";
import { getSrcSet } from "../utils/imageSizes";
import { fetchGameApiJson } from "../walletFlow";
import { BattleResults } from "./BattleResults";
import { SiteHeader } from "./SiteHeader";

let apiUrl: Promise<string> | undefined;
function resolveApiUrl(): Promise<string> {
  apiUrl ??= fetchGameApiJson<{ apiUrl: string }>(runtimeConfigUrl(), "Game configuration")
    .then((config) => apiBaseUrlForRuntimeConfig(config))
    .catch((error: unknown) => {
      apiUrl = undefined;
      throw error;
    });
  return apiUrl;
}

function initialSetup(): CalculatorSetup {
  if (typeof window === "undefined") return emptySetup();
  const encoded = new URLSearchParams(window.location.search).get("b");
  return (encoded && decodeSetup(encoded)) || emptySetup();
}

const URL_DEBOUNCE_MS = 400;

/** Coordinates-only fleets in a shared link, to load on open. The target keeps the link's supports. */
export function fleetsToLoadOnOpen(setup: CalculatorSetup): Array<{ side: keyof CalculatorSetup; fleet: CalculatorFleet; keepSupports: boolean }> {
  return (["attackers", "defenders"] as const).flatMap((side) => setup[side].flatMap((fleet, index) => {
    const target = side === "defenders" && index === 0;
    return fleet.coords && !fleetHasUnits(fleet, target) ? [{ side, fleet, keepSupports: target && setup.defenders.length > 1 }] : [];
  }));
}

export function BattleCalculatorApp() {
  return (
    // No z-indexed content wrapper: the battle report dialog must stack above the sticky header.
    <div className="min-h-dvh bg-[#060b16] text-slate-100">
      <SiteHeader current="calculator" wide />
      <BattleCalculator />
    </div>
  );
}

export function BattleCalculator() {
  const [setup, setSetup] = useState(initialSetup);
  // Per-fleet UI state is keyed by fleet id, so removing a fleet never moves it onto a neighbour.
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const verified = useVerifiedCombatModel();
  const input = useMemo(() => setupToBattleInput(setup), [setup]);
  const fighting = setup.attackers.some((fleet) => fleetHasUnits(fleet, false))
    && setup.defenders.some((fleet, index) => fleetHasUnits(fleet, index === 0));
  const simulation = useBattleSimulation(fighting ? input : null, verified ? activeCombatModel() : REFEREE_COMBAT_MODEL_VERSION, EXACT_SIMULATION);

  // Debounced: Safari throws a SecurityError after ~100 replaceState calls in 10s (one per keystroke).
  useEffect(() => {
    const timer = setTimeout(() => {
      const used = setup.attackers.length > 1 || setup.defenders.length > 1
        || [...setup.attackers, ...setup.defenders].some((fleet) => fleet.coords || fleet.ships.some(Boolean) || fleet.defenses.some(Boolean));
      try {
        window.history.replaceState(null, "", used ? `/calculator?b=${encodeSetup(setup)}` : "/calculator");
      } catch {
        // The address bar is only a share convenience; the calculator keeps working.
      }
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [setup]);

  const update = (side: keyof CalculatorSetup, id: number, change: (fleet: CalculatorFleet) => CalculatorFleet) =>
    setSetup((current) => ({ ...current, [side]: current[side].map((fleet) => fleet.id === id ? change(fleet) : fleet) }));

  /** `keepSupports`: fill only the target, keeping the supports already in the setup. */
  const load = async (side: keyof CalculatorSetup, fleet: CalculatorFleet, keepSupports = false) => {
    setLoading((current) => ({ ...current, [fleet.id]: true }));
    setErrors((current) => ({ ...current, [fleet.id]: "" }));
    try {
      const loaded = await loadForcesAt(await resolveApiUrl(), fleet.coords, fleet.moon);
      setSetup((current) => {
        // The fleet list may have changed while loading; only fill the fleet that asked, if still there.
        const index = current[side].findIndex((existing) => existing.id === fleet.id);
        const existing = current[side][index];
        if (!existing || existing.coords !== fleet.coords || existing.moon !== fleet.moon) return current;
        const force = { ...loaded.force, id: fleet.id };
        // The target brings the fleets stationed in its defense; they replace earlier supports.
        if (side === "defenders" && index === 0 && !keepSupports) {
          return { ...current, defenders: [force, ...loaded.supports].slice(0, MAX_FLEETS) };
        }
        return { ...current, [side]: current[side].map((other) => other.id === fleet.id ? force : other) };
      });
    } catch (error) {
      setErrors((current) => ({ ...current, [fleet.id]: error instanceof Error ? error.message : "Could not load these coordinates." }));
    } finally {
      setLoading((current) => ({ ...current, [fleet.id]: false }));
    }
  };

  // Shared links may carry coordinates only; fill those forces once on open. Fleets the link already
  // defines are kept: a coordinates-only target never replaces the supports the link carries.
  const loadedOnOpen = useRef(false);
  useEffect(() => {
    if (loadedOnOpen.current) return;
    loadedOnOpen.current = true;
    for (const { side, fleet, keepSupports } of fleetsToLoadOnOpen(setup)) void load(side, fleet, keepSupports);
  }, []);

  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-3 py-4 sm:px-6 lg:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-white">Battle calculator</h1>
        <button
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
          onClick={() => { setSetup(emptySetup()); setErrors({}); setLoading({}); }}
          type="button"
        >
          Clear
        </button>
      </div>

      <section aria-label="Results" className="rounded-lg surface p-3 sm:p-4">
        {simulation.status === "error" ? (
          <p className="text-sm text-red-200">{simulation.error}</p>
        ) : !fighting ? (
          <p className="text-sm text-slate-400">Add ships to both sides.</p>
        ) : simulation.status !== "idle" && simulation.stats ? (
          <BattleResults
            detailed
            input={simulation.input}
            modelVersion={simulation.modelVersion}
            running={simulation.status === "running"}
            stats={simulation.stats}
          />
        ) : (
          <p className="text-sm text-slate-400" aria-busy="true">Simulating…</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["attackers", "defenders"] as const).map((side) => (
          <section aria-label={side === "attackers" ? "Attackers" : "Defenders"} className="grid content-start gap-3" key={side}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${side === "attackers" ? "text-emerald-200" : "text-red-200"}`}>
              {side === "attackers" ? "Attackers" : "Defenders"}
            </h2>
            {setup[side].map((fleet, index) => (
              <FleetCard
                error={errors[fleet.id]}
                fleet={fleet}
                key={fleet.id}
                loading={Boolean(loading[fleet.id])}
                onChange={(change) => update(side, fleet.id, change)}
                onLoad={() => void load(side, fleet)}
                onRemove={(side === "attackers" ? setup.attackers.length > 1 : index > 0)
                  ? () => setSetup((current) => ({ ...current, [side]: current[side].filter((other) => other.id !== fleet.id) }))
                  : undefined}
                target={side === "defenders" && index === 0}
                title={side === "attackers" ? `Attacker ${index + 1}` : index === 0 ? "Target" : `Support ${index}`}
              />
            ))}
            {setup[side].length < MAX_FLEETS ? (
              <button
                className="inline-flex w-fit items-center gap-1.5 rounded border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-signal/50 hover:text-white"
                onClick={() => setSetup((current) => ({ ...current, [side]: [...current[side], emptyFleet()] }))}
                type="button"
              >
                <Plus aria-hidden="true" size={13} />
                {side === "attackers" ? "Attacker" : "Support"}
              </button>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}

function FleetCard({ error, fleet, loading, onChange, onLoad, onRemove, target, title }: {
  error: string | undefined;
  fleet: CalculatorFleet;
  loading: boolean;
  onChange: (change: (fleet: CalculatorFleet) => CalculatorFleet) => void;
  onLoad: () => void;
  onRemove: (() => void) | undefined;
  target: boolean;
  title: string;
}) {
  const ships = shipCatalog.filter((ship) => isPlayableShip(ship.id) && (target || isFleetShip(ship.id)));
  return (
    <article className="grid gap-3 rounded-lg surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-white">{title}</h3>
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => { event.preventDefault(); onLoad(); }}
        >
          <input
            aria-label={`${title} coordinates`}
            className="h-8 w-24 rounded surface-inset px-2 text-xs tabular-nums text-slate-100 placeholder:text-slate-600"
            maxLength={MAX_COORDS_LENGTH}
            onInput={(event) => {
              const coords = event.currentTarget.value.slice(0, MAX_COORDS_LENGTH);
              onChange((current) => ({ ...current, coords }));
            }}
            placeholder="1:23:4"
            value={fleet.coords}
          />
          <button
            aria-label="Moon"
            aria-pressed={fleet.moon}
            className={`grid h-8 w-8 place-items-center rounded border transition ${fleet.moon ? "border-signal/50 bg-signal/10 text-signal" : "border-white/10 text-slate-500 hover:text-slate-200"}`}
            onClick={() => onChange((current) => ({ ...current, moon: !current.moon }))}
            title="Moon"
            type="button"
          >
            <Moon aria-hidden="true" size={14} />
          </button>
          <button
            aria-label={`Load ${title.toLowerCase()} from coordinates`}
            className="grid h-8 w-8 place-items-center rounded border border-white/10 text-slate-300 transition hover:border-signal/50 hover:text-white disabled:opacity-40"
            disabled={loading || !fleet.coords.trim()}
            title="Load"
            type="submit"
          >
            <Download aria-hidden="true" className={loading ? "animate-pulse" : ""} size={14} />
          </button>
        </form>
        {onRemove ? (
          <button
            aria-label={`Remove ${title.toLowerCase()}`}
            className="grid h-8 w-8 place-items-center rounded text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
            onClick={onRemove}
            title="Remove"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-200" role="alert">{error}</p> : null}
      <div className="grid grid-cols-3 gap-2">
        {(["weapons", "shielding", "armor"] as const).map((key) => (
          <label className="grid gap-1 text-[11px] text-slate-500" key={key}>
            {key === "weapons" ? "Weapons" : key === "shielding" ? "Shields" : "Armor"}
            <CountInput
              label={`${title} ${key}`}
              onValue={(value) => onChange((current) => ({ ...current, tech: { ...current.tech, [key]: clampCount(value, 99) } }))}
              value={fleet.tech[key]}
            />
          </label>
        ))}
      </div>
      <UnitGrid
        items={ships.map((ship) => ({ id: ship.id, label: ship.label, asset: shipAssetByKey[ship.key] }))}
        onValue={(id, value) => onChange((current) => ({ ...current, ships: current.ships.map((count, at) => at === id ? value : count) }))}
        title={title}
        values={fleet.ships}
      />
      {target ? (
        <UnitGrid
          items={defenseCatalog.filter((defense) => defense.id < 8).map((defense) => ({ id: defense.id, label: defense.label, asset: defenseAssetByKey[defense.key] }))}
          onValue={(id, value) => onChange((current) => ({ ...current, defenses: current.defenses.map((count, at) => at === id ? value : count) }))}
          title={title}
          values={fleet.defenses}
        />
      ) : null}
    </article>
  );
}

function UnitGrid({ items, onValue, title, values }: {
  items: Array<{ id: number; label: string; asset: string | undefined }>;
  onValue: (id: number, value: number) => void;
  title: string;
  values: number[];
}) {
  return (
    <div className="grid gap-x-3 gap-y-1.5 min-[420px]:grid-cols-2">
      {items.map((item) => (
        <label className="flex min-w-0 items-center gap-2 text-xs text-slate-300" key={item.id}>
          {item.asset ? <img alt="" className="h-6 w-6 shrink-0 rounded object-cover" height={24} loading="lazy" sizes="24px" src={item.asset} srcSet={getSrcSet(item.asset)} width={24} /> : null}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <CountInput label={`${title} ${item.label}`} onValue={(value) => onValue(item.id, clampCount(value))} value={values[item.id] ?? 0} />
        </label>
      ))}
    </div>
  );
}

function CountInput({ label, onValue, value }: { label: string; onValue: (value: number) => void; value: number }) {
  return (
    <input
      aria-label={label}
      className="h-7 w-20 shrink-0 rounded surface-inset px-2 text-right text-xs tabular-nums text-slate-100 placeholder:text-slate-600"
      inputMode="numeric"
      onInput={(event) => onValue(Number(event.currentTarget.value.replace(/[^\d]/g, "")))}
      onFocus={(event) => event.currentTarget.select()}
      placeholder="0"
      value={value ? String(value) : ""}
    />
  );
}
