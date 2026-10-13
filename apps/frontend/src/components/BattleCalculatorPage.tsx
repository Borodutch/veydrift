import { Download, Moon, Plus, X } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { activeCombatModel, REFEREE_COMBAT_MODEL_VERSION } from "../battlePreview";
import {
  clampCount,
  decodeSetup,
  emptyFleet,
  emptySetup,
  encodeSetup,
  isFleetShip,
  isPlayableShip,
  loadForcesAt,
  MAX_FLEETS,
  setupToBattleInput,
  type CalculatorFleet,
  type CalculatorSetup,
} from "../battleCalculatorState";
import { useBattleSimulation } from "../battleSimulation";
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

const hasUnits = (fleet: CalculatorFleet) => fleet.ships.some(Boolean) || fleet.defenses.some(Boolean);

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
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const verified = useVerifiedCombatModel();
  const input = useMemo(() => setupToBattleInput(setup), [setup]);
  const fighting = setup.attackers.some(hasUnits) && setup.defenders.some(hasUnits);
  const simulation = useBattleSimulation(fighting ? input : null, verified ? activeCombatModel() : REFEREE_COMBAT_MODEL_VERSION);

  useEffect(() => {
    const path = setup.attackers.some(hasUnits) || setup.defenders.some(hasUnits) || setup.attackers.length > 1 || setup.defenders.length > 1
      ? `/calculator?b=${encodeSetup(setup)}` : "/calculator";
    window.history.replaceState(null, "", path);
  }, [setup]);

  const update = (side: keyof CalculatorSetup, index: number, change: (fleet: CalculatorFleet) => CalculatorFleet) =>
    setSetup((current) => ({ ...current, [side]: current[side].map((fleet, at) => at === index ? change(fleet) : fleet) }));

  const load = async (side: keyof CalculatorSetup, index: number, fleet: CalculatorFleet) => {
    const key = `${side}:${index}`;
    setLoading((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const loaded = await loadForcesAt(await resolveApiUrl(), fleet.coords, fleet.moon);
      setSetup((current) => {
        // The fleet list may have changed while loading; only fill the fleet that asked.
        if (current[side][index]?.coords !== fleet.coords) return current;
        const forces = current[side].map((existing, at) => at === index ? loaded.force : existing);
        // The target brings the fleets stationed in its defense; they replace earlier supports.
        if (side === "defenders" && index === 0) return { ...current, defenders: [loaded.force, ...loaded.supports].slice(0, MAX_FLEETS) };
        return { ...current, [side]: forces };
      });
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Could not load these coordinates." }));
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  };

  // Shared links may carry coordinates only; fill those forces once on open.
  const loadedOnOpen = useRef(false);
  useEffect(() => {
    if (loadedOnOpen.current) return;
    loadedOnOpen.current = true;
    (["attackers", "defenders"] as const).forEach((side) => setup[side].forEach((fleet, index) => {
      if (fleet.coords && !hasUnits(fleet)) void load(side, index, fleet);
    }));
  }, []);

  return (
    <main className="mx-auto grid max-w-6xl gap-4 px-3 py-4 sm:px-6 lg:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-white">Battle calculator</h1>
        <button
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
          onClick={() => { setSetup(emptySetup()); setErrors({}); }}
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
          <BattleResults detailed input={simulation.input} running={simulation.status === "running"} stats={simulation.stats} />
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
                error={errors[`${side}:${index}`]}
                fleet={fleet}
                key={index}
                loading={Boolean(loading[`${side}:${index}`])}
                onChange={(change) => update(side, index, change)}
                onLoad={() => void load(side, index, fleet)}
                onRemove={(side === "attackers" ? setup.attackers.length > 1 : index > 0)
                  ? () => setSetup((current) => ({ ...current, [side]: current[side].filter((_, at) => at !== index) }))
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
            onInput={(event) => {
              const coords = event.currentTarget.value;
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
