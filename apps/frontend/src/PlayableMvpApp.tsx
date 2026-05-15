import { useEffect, useMemo, useState } from "preact/hooks";
import {
  buildingCatalog,
  buildingCost,
  canAfford,
  createInitialPlayableState,
  planetSummary,
  productionPerHour,
  progress,
  settleState,
  shipCatalog,
  startBuildingUpgrade,
  startShipProduction,
  storageCaps,
  type PlayableState,
  type Resources,
} from "./playableMvp";
import { runtimeConfigUrl, type RuntimeConfigState } from "./runtimeConfig";

const formatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export function PlayableMvpApp() {
  const [now, setNow] = useState(() => Date.now());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfigState>({ status: "loading" });
  const [state, setState] = useState<PlayableState>(() => createInitialPlayableState(now));
  const settledState = useMemo(() => settleState(state, now), [state, now]);
  const rates = productionPerHour(settledState.buildings);
  const caps = storageCaps(settledState.buildings);
  const planet = planetSummary();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    fetch(runtimeConfigUrl(), {
      headers: {
        accept: "application/json",
      },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Runtime config failed with ${response.status}`);
        }

        return response.json();
      })
      .then((config) => {
        setRuntimeConfig({ config, status: "ready" });
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setRuntimeConfig({ status: "error" });
        }
      });

    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    if (!settledState.queue && state.queue) {
      setState(settledState);
    }
  }, [settledState, state.queue]);

  const queueProgress = progress(settledState.queue, now);

  return (
    <main className="min-h-dvh bg-[#070913] text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="grid gap-4 border-b border-white/10 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">
              test.veydrift.com
            </p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Veydrift Playable MVP
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Start from a fresh home planet, collect lazy resources, upgrade
              infrastructure, and open the first shipyard queue.
            </p>
            <RuntimeConfigBadge runtimeConfig={runtimeConfig} />
          </div>

          <button
            className="h-11 w-full rounded-md border border-white/15 bg-white/8 px-4 text-sm font-semibold text-white transition hover:bg-white/12 lg:w-auto"
            onClick={() => {
              setNow(Date.now());
              setState(createInitialPlayableState(Date.now()));
            }}
            type="button"
          >
            Reset Planet
          </button>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <div className="grid gap-4">
            <div className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
              <div className="relative min-h-[280px]">
                <img
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  src="/assets/game/planets/lush-temperate.webp"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,19,0.16),rgba(7,9,19,0.9)),linear-gradient(90deg,rgba(7,9,19,0.8),rgba(7,9,19,0.2))]" />
                <div className="relative flex min-h-[280px] flex-col justify-end p-5">
                  <p className="text-sm font-medium text-slate-300">Home planet</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    Eos Relay
                  </h2>
                  <dl className="mt-4 grid max-w-xl grid-cols-3 gap-3 text-sm">
                    <Metric label="Fields" value={planet.fields.toString()} />
                    <Metric label="Temp" value={`${planet.temperature}C`} />
                    <Metric label="Queue" value={settledState.queue ? "Active" : "Ready"} />
                  </dl>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ResourcePanel
                cap={caps.metal}
                label="Metal"
                rate={rates.metal}
                value={settledState.resources.metal}
              />
              <ResourcePanel
                cap={caps.crystal}
                label="Crystal"
                rate={rates.crystal}
                value={settledState.resources.crystal}
              />
              <ResourcePanel
                cap={caps.deuterium}
                label="Deuterium"
                rate={rates.deuterium}
                value={settledState.resources.deuterium}
              />
            </div>
          </div>

          <aside className="grid content-start gap-4">
            <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Active Queue</h2>
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  MVP timer
                </span>
              </div>

              {settledState.queue ? (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-semibold text-white">{settledState.queue.label}</p>
                    <p className="text-sm text-slate-300">
                      {Math.max(0, Math.ceil((settledState.queue.readyAt - now) / 1_000))}s
                    </p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-signal transition-[width]"
                      style={{ width: `${queueProgress * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Choose a building or ship order. The test surface keeps one
                  active queue, matching the Solidity MVP.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
              <h2 className="text-base font-semibold text-white">Fleet</h2>
              <div className="mt-3 grid gap-2">
                {shipCatalog.map((ship) => (
                  <div className="flex items-center justify-between text-sm" key={ship.key}>
                    <span className="text-slate-300">{ship.label}</span>
                    <span className="font-semibold text-white">{settledState.ships[ship.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.72fr]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-white">Infrastructure</h2>
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                Contract catalog
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {buildingCatalog.map((building) => {
                const cost = buildingCost(settledState.buildings, building.key);
                const affordable = canAfford(settledState.resources, cost);
                return (
                  <ActionTile
                    actionLabel={`Upgrade to ${settledState.buildings[building.key] + 1}`}
                    asset={building.asset}
                    cost={cost}
                    disabled={Boolean(settledState.queue) || !affordable}
                    key={building.key}
                    label={building.label}
                    level={`Level ${settledState.buildings[building.key]}`}
                    onClick={() => {
                      setState(startBuildingUpgrade(settledState, building.key, Date.now()));
                      setNow(Date.now());
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-white">Shipyard</h2>
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                Requires Shipyard L1
              </span>
            </div>
            <div className="grid gap-3">
              {shipCatalog.map((ship) => {
                const affordable = canAfford(settledState.resources, ship.baseCost);
                return (
                  <ActionTile
                    actionLabel="Build 1"
                    asset={ship.asset}
                    cost={ship.baseCost}
                    disabled={
                      Boolean(settledState.queue)
                        || settledState.buildings.shipyard === 0
                        || !affordable
                    }
                    key={ship.key}
                    label={ship.label}
                    level={`${settledState.ships[ship.key]} owned`}
                    onClick={() => {
                      setState(startShipProduction(settledState, ship.key, 1, Date.now()));
                      setNow(Date.now());
                    }}
                  />
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function RuntimeConfigBadge({ runtimeConfig }: { runtimeConfig: RuntimeConfigState }) {
  if (runtimeConfig.status === "loading") {
    return (
      <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
        API connecting
      </p>
    );
  }

  if (runtimeConfig.status === "error") {
    return (
      <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-amber-300">
        API unavailable
      </p>
    );
  }

  return (
    <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-signal">
      {runtimeConfig.config.network} API ready · Contract{" "}
      {runtimeConfig.config.contractAddress ? "configured" : "pending"}
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-3 backdrop-blur">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-white">{value}</dd>
    </div>
  );
}

function ResourcePanel({
  cap,
  label,
  rate,
  value,
}: {
  cap: number;
  label: string;
  rate: number;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#101624] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{label}</h2>
        <p className="text-xs text-slate-400">+{format(rate)}/h</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{format(value)}</p>
      <p className="mt-1 text-xs text-slate-400">Cap {format(cap)}</p>
    </div>
  );
}

function ActionTile({
  actionLabel,
  asset,
  cost,
  disabled,
  label,
  level,
  onClick,
}: {
  actionLabel: string;
  asset: string;
  cost: Resources;
  disabled: boolean;
  label: string;
  level: string;
  onClick: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-[#101624]">
      <img alt="" className="aspect-[16/9] w-full object-cover" src={asset} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">{label}</h3>
            <p className="mt-1 text-sm text-slate-400">{level}</p>
          </div>
          <button
            className="h-9 shrink-0 rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            disabled={disabled}
            onClick={onClick}
            type="button"
          >
            {actionLabel}
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          {formatCost(cost)}
        </p>
      </div>
    </article>
  );
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}

function formatCost(cost: Resources): string {
  const resourceCosts: Array<[string, number]> = [
    ["M", cost.metal],
    ["C", cost.crystal],
    ["D", cost.deuterium],
  ];

  return resourceCosts
    .filter(([, value]) => value > 0)
    .map(([label, value]) => `${label} ${format(value)}`)
    .join(" / ");
}
