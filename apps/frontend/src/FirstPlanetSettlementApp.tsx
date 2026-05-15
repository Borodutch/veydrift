import { useEffect, useMemo, useState } from "preact/hooks";
import heroUrl from "./assets/veydrift-hero.webp";
import { PlayableMvpApp } from "./PlayableMvpApp";
import {
  buildingDefinitions,
  createInitialGameState,
  formatCost,
  formatTime,
  getActionReason,
  researchDefinitions,
  startBuilding,
  startResearch,
  STORAGE_KEY,
  type GameState,
  type QueueItem
} from "./gameState";
import { playableApiUrl } from "./runtimeConfig";
import {
  ensureBaseSepoliaNetwork,
  getChainId,
  getCurrentAccounts,
  getInjectedProvider,
  isBaseSepoliaChain,
  isUserRejected,
  planetFromTransaction,
  readSettlementState,
  requestAccounts,
  sendSettlementTransaction,
  settlementContractConfigured,
  shortAddress,
  waitForReceipt,
  type Eip1193Provider,
  type PlanetSummary,
  type SettlementConfig
} from "./walletFlow";

const BASE_SEPOLIA_SETTLEMENT_ADDRESS = "0x8bA1807073ac642A55596A4934c49115E400cD2f";
const UNIVERSE_SYSTEM_URL = `${playableApiUrl.replace(/\/+$/, "")}/universe/systems?galaxy=1&center=1&radius=1`;

type WalletState =
  | { kind: "loading" }
  | { kind: "no-wallet" }
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "wrong-network"; account: string; chainId: string }
  | { kind: "connected"; account: string };

type PlanetState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "contract-unconfigured" }
  | { kind: "not-settled" }
  | { kind: "pending"; txHash?: string }
  | { kind: "success"; planet: PlanetSummary }
  | { kind: "already-settled"; planet: PlanetSummary }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

type UniverseState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; galaxy: number; center: number; systems: number; planetCount: number; occupiedCount: number }
  | { kind: "error"; message: string };

type UniverseSystemsResponse = {
  galaxy: number;
  center: number;
  systems: Array<{
    planets: Array<{
      occupiedBy: unknown | null;
    }>;
  }>;
};

const settlementConfig: SettlementConfig = buildSettlementConfig();

export function FirstPlanetSettlementApp() {
  const [provider, setProvider] = useState<Eip1193Provider>();
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading"
  });
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle"
  });
  const [gameState, setGameState] = useState<GameState>(() => loadManagementState());
  const [universe, setUniverse] = useState<UniverseState>({ kind: "idle" });

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";

  const stepState = useMemo(() => {
    return [
      {
        label: "Wallet",
        value: walletLabel(wallet)
      },
      {
        label: "Network",
        value: wallet.kind === "wrong-network" ? "Switch required" : wallet.kind === "connected" ? "Base Sepolia" : "Waiting"
      },
      {
        label: "Planet",
        value: planetLabel(planet)
      }
    ];
  }, [planet, wallet]);

  useEffect(() => {
    const injected = getInjectedProvider(window as typeof window & { ethereum?: Eip1193Provider });
    setProvider(injected);

    if (!injected) {
      setWallet({
        kind: "no-wallet"
      });
      return;
    }

    void refreshWallet(injected);

    const handleAccountsChanged = (...args: unknown[]) => {
      const nextAccounts = Array.isArray(args[0]) ? args[0] as string[] : [];

      if (nextAccounts[0]) {
        void refreshWallet(injected, nextAccounts[0]);
      } else {
        setWallet({
          kind: "disconnected"
        });
        setPlanet({
          kind: "idle"
        });
      }
    };

    const handleChainChanged = () => {
      void refreshWallet(injected);
    };

    injected.on?.("accountsChanged", handleAccountsChanged);
    injected.on?.("chainChanged", handleChainChanged);

    return () => {
      injected.removeListener?.("accountsChanged", handleAccountsChanged);
      injected.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
  }, [gameState]);

  useEffect(() => {
    if (!hasOverview || universe.kind !== "idle") {
      return;
    }

    setUniverse({ kind: "loading" });
    fetch(UNIVERSE_SYSTEM_URL, {
      headers: {
        accept: "application/json"
      }
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Universe request failed with ${response.status}`);
        }

        return response.json() as Promise<UniverseSystemsResponse>;
      })
      .then((payload) => {
        const planetCount = payload.systems.reduce((sum, system) => sum + system.planets.length, 0);
        const occupiedCount = payload.systems.reduce(
          (sum, system) => sum + system.planets.filter((planet) => planet.occupiedBy).length,
          0
        );
        setUniverse({
          center: payload.center,
          galaxy: payload.galaxy,
          kind: "ready",
          occupiedCount,
          planetCount,
          systems: payload.systems.length
        });
      })
      .catch((error) => {
        setUniverse({
          kind: "error",
          message: errorMessage(error)
        });
      });
  }, [hasOverview, universe.kind]);

  async function refreshWallet(injected = provider, preferredAccount?: string) {
    if (!injected) {
      setWallet({
        kind: "no-wallet"
      });
      return;
    }

    const accounts = preferredAccount ? [preferredAccount] : await getCurrentAccounts(injected);

    if (!accounts[0]) {
      setWallet({
        kind: "disconnected"
      });
      setPlanet({
        kind: "idle"
      });
      return;
    }

    const chainId = await getChainId(injected);

    if (!isBaseSepoliaChain(chainId)) {
      setWallet({
        kind: "wrong-network",
        account: accounts[0],
        chainId
      });
      setPlanet({
        kind: "idle"
      });
      return;
    }

    setWallet({
      kind: "connected",
      account: accounts[0]
    });
    await refreshPlanet(injected, accounts[0]);
  }

  async function refreshPlanet(injected: Eip1193Provider, connectedAccount: string) {
    setPlanet({
      kind: "checking"
    });

    try {
      const settlement = await readSettlementState(injected, connectedAccount, settlementConfig);

      if (settlement.kind === "unconfigured") {
        setPlanet({
          kind: "contract-unconfigured"
        });
      } else if (settlement.kind === "settled") {
        setPlanet({
          kind: "already-settled",
          planet: settlement.planet
        });
      } else {
        setPlanet({
          kind: "not-settled"
        });
      }
    } catch (error) {
      setPlanet({
        kind: "error",
        message: errorMessage(error)
      });
    }
  }

  async function connectWallet() {
    if (!provider) {
      setWallet({
        kind: "no-wallet"
      });
      return;
    }

    setWallet({
      kind: "connecting"
    });

    try {
      const accounts = await requestAccounts(provider);
      await refreshWallet(provider, accounts[0]);
    } catch (error) {
      setWallet({
        kind: "disconnected"
      });
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Wallet connection was rejected." : errorMessage(error)
      });
    }
  }

  async function switchNetwork() {
    if (!provider) {
      return;
    }

    setPlanet({
      kind: "checking"
    });

    try {
      await ensureBaseSepoliaNetwork(provider);
      await refreshWallet(provider, account);
    } catch (error) {
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Network switch was rejected." : errorMessage(error)
      });
    }
  }

  async function settlePlanet() {
    if (!provider || wallet.kind !== "connected") {
      return;
    }

    setPlanet({
      kind: "pending"
    });

    try {
      const txHash = await sendSettlementTransaction(provider, wallet.account, settlementConfig);
      setPlanet({
        kind: "pending",
        txHash
      });
      await waitForReceipt(provider, txHash);

      const settlement = await readSettlementState(provider, wallet.account, settlementConfig);

      setPlanet({
        kind: "success",
        planet: settlement.kind === "settled" ? settlement.planet : planetFromTransaction(wallet.account, txHash)
      });
    } catch (error) {
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Settlement transaction was rejected." : errorMessage(error)
      });
    }
  }

  if (hasOverview) {
    return (
      <PlayableMvpApp
        provider={provider}
        account={account}
        planet={planet.kind === "success" || planet.kind === "already-settled" ? planet.planet : undefined}
      />
    );
  }

  return (
    <main className="min-h-dvh bg-[#070a10] text-slate-100">
      <div className="fixed inset-0 -z-10">
        <img alt="" className="h-full w-full object-cover opacity-45" src={heroUrl} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,10,16,0.98)_0%,rgba(7,10,16,0.9)_45%,rgba(7,10,16,0.68)_100%)]" />
      </div>

      <header className="border-b border-white/10 bg-[#070a10]/88 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-200">Veydrift command</p>
            <h1 className="text-xl font-semibold text-white">First planet settlement</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={walletLabel(wallet)} tone={walletTone(wallet)} />
            {account ? <StatusPill label={shortAddress(account)} tone="neutral" /> : null}
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 md:grid-cols-[280px_minmax(0,1fr)] md:px-8">
        <aside className="min-w-0 border border-white/10 bg-[#0c111b]/92 p-4 shadow-2xl shadow-black/25">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <h2 className="text-sm font-semibold uppercase text-slate-300">Launch checks</h2>
            <span className="text-xs text-slate-500">Base Sepolia</span>
          </div>
          <div className="mt-4 space-y-3">
            {stepState.map((step) => (
              <div className="flex items-center justify-between gap-3" key={step.label}>
                <span className="text-sm text-slate-400">{step.label}</span>
                <span className="text-right text-sm font-medium text-slate-100">{step.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-2 text-sm sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
            <Metric label="Chain" value="84532" />
            <Metric label="RPC" value="Base" />
          </div>
        </aside>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <section className="min-w-0 border border-white/10 bg-[#0c111b]/92 p-4 shadow-2xl shadow-black/25 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-cyan-200">First run</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Settle your first planet</h2>
              </div>
              <StatusPill label={planetLabel(planet)} tone={planetTone(planet)} />
            </div>

            <div className="mt-6 min-h-56 min-w-0 border border-white/10 bg-[#080c14] p-4">
              <FlowBody
                onConnect={connectWallet}
                onSettle={settlePlanet}
                onSwitchNetwork={switchNetwork}
                planet={planet}
                settlementReady={settlementContractConfigured(settlementConfig)}
                wallet={wallet}
              />
            </div>
          </section>

          <section className="min-w-0 border border-white/10 bg-[#0c111b]/92 p-4 shadow-2xl shadow-black/25 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-amber-200">Overview</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Planet command</h2>
              </div>
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)]" />
            </div>
            <LockedOverview />
          </section>
        </div>
        {hasOverview ? (
          <PostSettlementControls
            gameState={gameState}
            onStartBuilding={(targetId) => {
              const result = startBuilding(gameState, targetId, Date.now());
              if (result.ok) {
                setGameState(result.state);
              }
            }}
            onStartResearch={(targetId) => {
              const result = startResearch(gameState, targetId, Date.now());
              if (result.ok) {
                setGameState(result.state);
              }
            }}
            universe={universe}
          />
        ) : null}
      </section>
    </main>
  );
}

function FlowBody({
  onConnect,
  onSettle,
  onSwitchNetwork,
  planet,
  settlementReady,
  wallet
}: {
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  settlementReady: boolean;
  wallet: WalletState;
}) {
  if (wallet.kind === "loading") {
    return <StateMessage title="Scanning wallet state" body="Checking for an injected wallet and active account." />;
  }

  if (wallet.kind === "no-wallet") {
    return (
      <StateMessage
        title="No injected wallet found"
        body="Install MetaMask or open this page in a browser profile with an injected EVM wallet."
        action={<PrimaryButton onClick={onConnect}>Check again</PrimaryButton>}
      />
    );
  }

  if (wallet.kind === "disconnected" || wallet.kind === "connecting") {
    return (
      <StateMessage
        title={wallet.kind === "connecting" ? "Waiting for wallet approval" : "Connect wallet"}
        body="Connect an EVM wallet to claim the first playable Veydrift planet for this address."
        action={<PrimaryButton disabled={wallet.kind === "connecting"} onClick={onConnect}>Connect wallet</PrimaryButton>}
      />
    );
  }

  if (wallet.kind === "wrong-network") {
    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to Base Sepolia before settlement.`}
        action={<PrimaryButton onClick={onSwitchNetwork}>Switch network</PrimaryButton>}
      />
    );
  }

  if (planet.kind === "checking") {
    return <StateMessage title="Checking settlement" body="Reading first-planet status from Base Sepolia." />;
  }

  if (planet.kind === "contract-unconfigured") {
    return (
      <StateMessage
        title="Settlement contract not configured"
        body="Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the Base Sepolia settlement contract."
      />
    );
  }

  if (planet.kind === "pending") {
    return (
      <StateMessage
        title="Settlement pending"
        body={planet.txHash ? `Transaction submitted: ${planet.txHash}` : "Confirm the transaction in your wallet."}
      />
    );
  }

  if (planet.kind === "already-settled") {
    return (
      <StateMessage
        title="Planet already settled"
        body="This wallet already has its first Veydrift planet. The overview is open."
      />
    );
  }

  if (planet.kind === "success") {
    return (
      <StateMessage
        title="Settlement confirmed"
        body="Your first planet is active. Continue in the planet overview."
      />
    );
  }

  if (planet.kind === "rejected" || planet.kind === "error") {
    return (
      <StateMessage
        title={planet.kind === "rejected" ? "Request rejected" : "Wallet error"}
        body={planet.message}
        action={<PrimaryButton onClick={planet.kind === "rejected" ? onSettle : onConnect}>Retry</PrimaryButton>}
      />
    );
  }

  return (
    <StateMessage
      title="Ready to settle"
      body="Settle the first planet for this connected wallet. The overview opens after the Base Sepolia transaction confirms."
      action={<PrimaryButton disabled={!settlementReady} onClick={onSettle}>Settle first planet</PrimaryButton>}
    />
  );
}

function LockedOverview() {
  return (
    <div className="mt-5 border border-white/10 bg-[#080c14] p-4 text-sm leading-6 text-slate-400">
      Planet controls unlock immediately after the wallet has an onchain first-planet settlement.
    </div>
  );
}

function PostSettlementControls({
  gameState,
  onStartBuilding,
  onStartResearch,
  universe
}: {
  gameState: GameState;
  onStartBuilding: (targetId: string) => void;
  onStartResearch: (targetId: string) => void;
  universe: UniverseState;
}) {
  const building = buildingDefinitions[0]!;
  const research = researchDefinitions[0]!;
  const buildingReason = getActionReason(gameState, building, "building");
  const researchReason = getActionReason(gameState, research, "research");

  return (
    <section className="min-w-0 border border-white/10 bg-[#0c111b]/92 p-4 shadow-2xl shadow-black/25 md:p-5 md:col-span-2">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase text-amber-200">Universe scout</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Explore nearby systems</h2>
          <div className="mt-4 border border-white/10 bg-[#080c14] p-4 text-sm leading-6 text-slate-300">
            {universe.kind === "loading" || universe.kind === "idle" ? "Loading deterministic Base Sepolia universe data." : null}
            {universe.kind === "error" ? `Universe unavailable: ${universe.message}` : null}
            {universe.kind === "ready" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Metric label="Galaxy" value={universe.galaxy.toString()} />
                <Metric label="Center system" value={universe.center.toString()} />
                <Metric label="Systems scanned" value={universe.systems.toString()} />
                <Metric label="Planets found" value={`${universe.planetCount} (${universe.occupiedCount} occupied)`} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase text-cyan-200">MVP orders</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Start building and research</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <OrderCard
              actionLabel="Start building"
              disabled={buildingReason !== "available"}
              helper={actionHelper(buildingReason)}
              label={building.name}
              meta={`Level ${gameState.buildings[building.id] ?? 0} -> ${(gameState.buildings[building.id] ?? 0) + 1}`}
              onClick={() => onStartBuilding(building.id)}
              subcopy={formatCost(building.cost)}
            />
            <OrderCard
              actionLabel="Start research"
              disabled={researchReason !== "available"}
              helper={actionHelper(researchReason)}
              label={research.name}
              meta={`Level ${gameState.research[research.id] ?? 0} -> ${(gameState.research[research.id] ?? 0) + 1}`}
              onClick={() => onStartResearch(research.id)}
              subcopy={formatCost(research.cost)}
            />
          </div>
          <QueueSummary queue={gameState.queue} />
        </div>
      </div>
    </section>
  );
}

function OrderCard({
  actionLabel,
  disabled,
  helper,
  label,
  meta,
  onClick,
  subcopy
}: {
  actionLabel: string;
  disabled: boolean;
  helper: string;
  label: string;
  meta: string;
  onClick: () => void;
  subcopy: string;
}) {
  return (
    <article className="min-w-0 border border-white/10 bg-[#080c14] p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{meta}</p>
      <h3 className="mt-2 text-lg font-semibold text-white">{label}</h3>
      <p className="mt-2 text-sm text-slate-400">{subcopy}</p>
      <button
        className="mt-4 inline-flex min-h-10 items-center justify-center bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {actionLabel}
      </button>
      <p className="mt-3 text-xs text-slate-500">{helper}</p>
    </article>
  );
}

function QueueSummary({ queue }: { queue: QueueItem[] }) {
  if (queue.length === 0) {
    return <p className="mt-4 text-sm text-slate-400">No active orders yet.</p>;
  }

  return (
    <div className="mt-4 grid gap-2">
      {queue.map((item) => (
        <div className="flex items-center justify-between gap-3 border border-white/10 bg-[#080c14] px-3 py-2 text-sm" key={item.id}>
          <span className="text-slate-300">{queueLabel(item)}</span>
          <span className="text-slate-500">{formatTime(item.completesAt - Date.now())}</span>
        </div>
      ))}
    </div>
  );
}

function queueLabel(item: QueueItem): string {
  const catalog = item.type === "building" ? buildingDefinitions : researchDefinitions;
  const definition = catalog.find((entry) => entry.id === item.targetId);

  return `${item.type === "building" ? "Building" : "Research"}: ${definition?.name ?? item.targetId}`;
}

function actionHelper(reason: string): string {
  if (reason === "available") return "Ready to queue.";
  if (reason === "pending") return "Already queued.";
  if (reason === "insufficient-resources") return "Needs more resources.";
  if (reason === "building-slots-full" || reason === "research-slots-full") return "Queue slot occupied.";
  if (reason === "maxed") return "Maximum level reached.";

  return "Prerequisite locked.";
}

function loadManagementState(): GameState {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);

    if (!serialized) {
      return createInitialGameState();
    }

    const parsed = JSON.parse(serialized) as GameState;

    if (parsed.version !== 1 || !parsed.resources || !parsed.buildings || !parsed.research || !Array.isArray(parsed.queue)) {
      return createInitialGameState();
    }

    return parsed;
  } catch {
    return createInitialGameState();
  }
}

function StateMessage({
  action,
  body,
  title
}: {
  action?: preact.ComponentChildren;
  body: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-48 min-w-0 flex-col justify-between gap-5">
      <div className="min-w-0">
        <h3 className="break-words text-xl font-semibold text-white">{title}</h3>
        <p className="mt-3 max-w-full break-words text-sm leading-6 text-slate-300">{body}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick
}: {
  children: preact.ComponentChildren;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-11 items-center justify-center gap-2 bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">+</span>
      {children}
    </button>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const toneClass = {
    good: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    warn: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    bad: "border-red-300/30 bg-red-300/10 text-red-100",
    neutral: "border-white/12 bg-white/8 text-slate-200"
  }[tone];

  return <span className={`max-w-full break-words border px-3 py-1.5 text-xs font-semibold ${toneClass}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-[#080c14] px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function walletLabel(wallet: WalletState): string {
  switch (wallet.kind) {
    case "loading":
      return "Loading";
    case "no-wallet":
      return "No wallet";
    case "disconnected":
      return "Disconnected";
    case "connecting":
      return "Connecting";
    case "wrong-network":
      return "Wrong network";
    case "connected":
      return "Connected";
  }
}

function walletTone(wallet: WalletState): "good" | "warn" | "bad" | "neutral" {
  switch (wallet.kind) {
    case "connected":
      return "good";
    case "wrong-network":
      return "warn";
    case "no-wallet":
      return "bad";
    default:
      return "neutral";
  }
}

function planetLabel(planet: PlanetState): string {
  switch (planet.kind) {
    case "checking":
      return "Loading";
    case "contract-unconfigured":
      return "Contract needed";
    case "not-settled":
      return "Ready";
    case "pending":
      return "Pending";
    case "success":
      return "Success";
    case "already-settled":
      return "Settled";
    case "rejected":
      return "Rejected";
    case "error":
      return "Error";
    default:
      return "Waiting";
  }
}

function planetTone(planet: PlanetState): "good" | "warn" | "bad" | "neutral" {
  switch (planet.kind) {
    case "success":
    case "already-settled":
      return "good";
    case "contract-unconfigured":
    case "pending":
      return "warn";
    case "rejected":
    case "error":
      return "bad";
    default:
      return "neutral";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return "Unexpected wallet request failure.";
}

function buildSettlementConfig(): SettlementConfig {
  const config: SettlementConfig = {};

  config.address = import.meta.env.VITE_VEYDRIFT_SETTLEMENT_ADDRESS || BASE_SEPOLIA_SETTLEMENT_ADDRESS;

  return config;
}
