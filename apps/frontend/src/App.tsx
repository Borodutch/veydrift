import heroUrl from "./assets/veydrift-hero.webp";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  STORAGE_KEY,
  advanceState,
  buildingDefinitions,
  createInitialGameState,
  formatCost,
  formatTime,
  getActionReason,
  loadGameState,
  queueProgress,
  researchDefinitions,
  resourceLabels,
  startBuilding,
  startResearch,
  type ActionReason,
  type GameState,
  type QueueItem,
  type QueueType,
  type ResourceKey
} from "./gameState";
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

type Screen = "overview" | "building" | "research";

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

const screens: Array<{ id: Screen; label: string }> = [
  { id: "overview", label: "Planet" },
  { id: "building", label: "Build" },
  { id: "research", label: "Research" }
];

const resourceCaps: Record<ResourceKey, number> = {
  alloy: 900,
  energy: 700,
  data: 520,
  crew: 220
};

const actionLabels: Record<ActionReason, string> = {
  available: "Start",
  "building-slots-full": "Slots full",
  "insufficient-resources": "Need resources",
  locked: "Locked",
  maxed: "Maxed",
  pending: "Queued",
  "research-slots-full": "Lab busy"
};

const requirementLabels: Record<QueueType, string> = {
  building: "building",
  research: "research"
};

const settlementConfig: SettlementConfig = buildSettlementConfig();

function initGameState(): GameState {
  if (typeof window === "undefined") {
    return createInitialGameState();
  }

  return advanceState(loadGameState(window.localStorage.getItem(STORAGE_KEY)), Date.now());
}

function initScreen(): Screen {
  if (typeof window === "undefined") {
    return "overview";
  }

  const screen = new URLSearchParams(window.location.search).get("screen");

  if (screen === "building" || screen === "research") {
    return screen;
  }

  return "overview";
}

function Meter({ value }: { value: number }) {
  return (
    <span className="meter" aria-label={`${Math.round(value)}%`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </span>
  );
}

function getQueueName(item: QueueItem) {
  const definitions = item.type === "building" ? buildingDefinitions : researchDefinitions;

  return definitions.find((definition) => definition.id === item.targetId)?.name ?? item.targetId;
}

function describeRequirements(state: GameState, targetId: string, type: QueueType) {
  const definition = type === "building"
    ? buildingDefinitions.find((item) => item.id === targetId)
    : researchDefinitions.find((item) => item.id === targetId);

  if (!definition?.requires?.length) {
    return "No prerequisite";
  }

  return definition.requires
    .map((requirement) => {
      const definitions = requirement.type === "building" ? buildingDefinitions : researchDefinitions;
      const name = definitions.find((item) => item.id === requirement.targetId)?.name ?? requirement.targetId;
      const levels = requirement.type === "building" ? state.buildings : state.research;
      const current = levels[requirement.targetId] ?? 0;

      return `${name} ${requirementLabels[requirement.type]} level ${requirement.level} (${current}/${requirement.level})`;
    })
    .join(", ");
}

function QueuePanel({ now, queue }: { now: number; queue: QueueItem[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Command queue</h3>
        <span>{queue.length} active</span>
      </div>

      {queue.length === 0 ? (
        <p className="empty-state">No orders running. Start a building or research action.</p>
      ) : (
        <ol className="queue-list">
          {queue.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{getQueueName(item)}</strong>
                <span>{formatTime(item.completesAt - now)}</span>
              </div>
              <Meter value={queueProgress(item, now)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OverviewScreen({
  gameState,
  now
}: {
  gameState: GameState;
  now: number;
}) {
  const fieldsUsed = Object.values(gameState.buildings).reduce((sum, level) => sum + level, 0);
  const activeResearch = gameState.queue.find((item) => item.type === "research");
  const researchComplete = Object.values(gameState.research).reduce((sum, level) => sum + level, 0);

  return (
    <div className="screen-grid overview-grid">
      <section className="planet-panel">
        <div>
          <p className="eyebrow">Settled planet</p>
          <h2>Kepler-442b Forward Base</h2>
          <p>
            Your first colony is online. Spend the starting stockpile, keep
            energy positive, and push research before the next settlement cycle.
          </p>
          <div className="planet-summary">
            <span>Fields {fieldsUsed}/18</span>
            <span>Build slots {gameState.queue.filter((item) => item.type === "building").length}/2</span>
            <span>Lab {activeResearch ? "busy" : "idle"}</span>
          </div>
        </div>
        <div className="planet-visual" aria-hidden="true">
          <img src={heroUrl} alt="" />
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
        </div>
      </section>

      <section className="stat-grid" aria-label="Planet status">
        <article className="stat-card">
          <span>Buildings</span>
          <strong>{fieldsUsed}</strong>
          <small>levels constructed</small>
        </article>
        <article className="stat-card">
          <span>Research</span>
          <strong>{researchComplete}</strong>
          <small>levels complete</small>
        </article>
        <article className="stat-card">
          <span>Queue</span>
          <strong>{gameState.queue.length}</strong>
          <small>orders running</small>
        </article>
        <article className="stat-card">
          <span>Stability</span>
          <strong>91%</strong>
          <small>secure</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Resource flow</h3>
          <span>Local MVP</span>
        </div>
        <div className="resource-list">
          {(Object.keys(resourceLabels) as ResourceKey[]).map((resource) => (
            <div className="resource-row" key={resource}>
              <div>
                <strong>{resourceLabels[resource]}</strong>
                <span>
                  {gameState.resources[resource]}/{resourceCaps[resource]}
                </span>
              </div>
              <Meter value={(gameState.resources[resource] / resourceCaps[resource]) * 100} />
            </div>
          ))}
        </div>
      </section>

      <QueuePanel now={now} queue={gameState.queue} />
    </div>
  );
}

function BuildingScreen({
  gameState,
  now,
  onStart
}: {
  gameState: GameState;
  now: number;
  onStart: (targetId: string) => void;
}) {
  return (
    <div className="screen-grid building-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <h3>Construction planner</h3>
          <span>{gameState.queue.filter((item) => item.type === "building").length}/2 slots</span>
        </div>
        <div className="building-list">
          {buildingDefinitions.map((building) => {
            const reason = getActionReason(gameState, building, "building");
            const pending = gameState.queue.find((item) => item.type === "building" && item.targetId === building.id);

            return (
              <article className="building-card" key={building.id}>
                <div className="building-title">
                  <div>
                    <h4>{building.name}</h4>
                    <span>{building.role} level {gameState.buildings[building.id] ?? 0}</span>
                  </div>
                  <strong>{pending ? formatTime(pending.completesAt - now) : actionLabels[reason]}</strong>
                </div>
                <p>{building.effect}</p>
                <div className="requirement-line">{describeRequirements(gameState, building.id, "building")}</div>
                {pending && <Meter value={queueProgress(pending, now)} />}
                <div className="building-footer">
                  <span>{formatCost(building.cost)}</span>
                  <button disabled={reason !== "available"} onClick={() => onStart(building.id)} type="button">
                    {actionLabels[reason]}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>District map</h3>
          <span>18 fields</span>
        </div>
        <div className="site-grid">
          {buildingDefinitions.map((building, index) => (
            <article className="site-tile" key={building.id}>
              <strong>{String.fromCharCode(65 + index)}{index + 1}</strong>
              <span>{building.name}</span>
              <small>Level {gameState.buildings[building.id] ?? 0}</small>
              <em>{building.role}</em>
            </article>
          ))}
        </div>
      </section>

      <QueuePanel now={now} queue={gameState.queue.filter((item) => item.type === "building")} />
    </div>
  );
}

function ResearchScreen({
  gameState,
  now,
  onStart
}: {
  gameState: GameState;
  now: number;
  onStart: (targetId: string) => void;
}) {
  const activeResearch = gameState.queue.find((item) => item.type === "research");
  const activeName = activeResearch ? getQueueName(activeResearch) : "Lab idle";

  return (
    <div className="screen-grid research-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <h3>Research deck</h3>
          <span>{gameState.queue.filter((item) => item.type === "research").length}/1 lab</span>
        </div>
        <div className="research-list">
          {researchDefinitions.map((item) => {
            const reason = getActionReason(gameState, item, "research");
            const pending = gameState.queue.find((queueItem) => queueItem.type === "research" && queueItem.targetId === item.id);

            return (
              <article className={`research-card ${reason}`} key={item.id}>
                <div>
                  <span>{item.lane}</span>
                  <h4>{item.name}</h4>
                  <p>{item.unlock}</p>
                  <div className="requirement-line">{describeRequirements(gameState, item.id, "research")}</div>
                </div>
                <div className="research-progress">
                  <strong>
                    Level {gameState.research[item.id] ?? 0} / {item.maxLevel}
                  </strong>
                  <span>{pending ? formatTime(pending.completesAt - now) : actionLabels[reason]}</span>
                  {pending && <Meter value={queueProgress(pending, now)} />}
                  <button disabled={reason !== "available"} onClick={() => onStart(item.id)} type="button">
                    {actionLabels[reason]}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel focus-panel">
        <div className="panel-heading">
          <h3>Active project</h3>
          <span>{activeResearch ? formatTime(activeResearch.completesAt - now) : "ready"}</span>
        </div>
        <div className="focus-ring">
          <strong>{activeResearch ? `${Math.round(queueProgress(activeResearch, now))}%` : "0%"}</strong>
          <span>{activeName}</span>
        </div>
        <p>
          Research consumes data and lab time. Locked projects show the exact
          building or research prerequisite needed to open them.
        </p>
      </section>

      <QueuePanel now={now} queue={gameState.queue.filter((item) => item.type === "research")} />
    </div>
  );
}

function WalletSettlementPanel({
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
  const settled = planet.kind === "success" || planet.kind === "already-settled";

  return (
    <section className={`wallet-panel ${settled ? "settled" : ""}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">First planet settlement</p>
          <h3>{settled ? "Onchain planet active" : walletPanelTitle(wallet, planet)}</h3>
        </div>
        <span>{walletLabel(wallet)}</span>
      </div>
      <div className="wallet-steps" aria-label="Wallet settlement status">
        <Metric label="Wallet" value={walletLabel(wallet)} />
        <Metric label="Network" value={wallet.kind === "wrong-network" ? "Switch required" : wallet.kind === "connected" ? "Base Sepolia" : "Waiting"} />
        <Metric label="Planet" value={planetLabel(planet)} />
      </div>
      <WalletFlowBody
        onConnect={onConnect}
        onSettle={onSettle}
        onSwitchNetwork={onSwitchNetwork}
        planet={planet}
        settlementReady={settlementReady}
        wallet={wallet}
      />
    </section>
  );
}

function WalletFlowBody({
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
        body="Open this page in the Chromium profile with MetaMask installed."
        action={<button onClick={onConnect} type="button">Check again</button>}
      />
    );
  }

  if (wallet.kind === "disconnected" || wallet.kind === "connecting") {
    return (
      <StateMessage
        title={wallet.kind === "connecting" ? "Waiting for wallet approval" : "Connect wallet"}
        body="Connect MetaMask to claim the first playable Veydrift planet for this address."
        action={<button disabled={wallet.kind === "connecting"} onClick={onConnect} type="button">Connect wallet</button>}
      />
    );
  }

  if (wallet.kind === "wrong-network") {
    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to Base Sepolia before settlement.`}
        action={<button onClick={onSwitchNetwork} type="button">Switch network</button>}
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
        body={planet.txHash ? `Transaction submitted: ${planet.txHash}` : "Confirm the transaction in MetaMask."}
      />
    );
  }

  if (planet.kind === "already-settled") {
    return <PlanetSettlementSummary planet={planet.planet} title="Planet already settled" />;
  }

  if (planet.kind === "success") {
    return <PlanetSettlementSummary planet={planet.planet} title="Settlement confirmed" />;
  }

  if (planet.kind === "rejected" || planet.kind === "error") {
    return (
      <StateMessage
        title={planet.kind === "rejected" ? "Request rejected" : "Wallet error"}
        body={planet.message}
        action={<button onClick={planet.kind === "rejected" ? onSettle : onConnect} type="button">Retry</button>}
      />
    );
  }

  return (
    <StateMessage
      title="Ready to settle"
      body="Settle the first planet for this connected wallet. The management screens unlock after the Base Sepolia transaction confirms."
      action={<button disabled={!settlementReady} onClick={onSettle} type="button">Settle first planet</button>}
    />
  );
}

function PlanetSettlementSummary({ planet, title }: { planet: PlanetSummary; title: string }) {
  return (
    <div className="settlement-summary">
      <div>
        <strong>{title}</strong>
        <span>{planet.label}</span>
      </div>
      <div className="wallet-steps">
        <Metric label="Coordinates" value={planet.coordinates ?? "Assigned"} />
        <Metric label="Class" value={planet.rarity ?? "Genesis"} />
        <Metric label="Block" value={planet.settledBlock ?? "Confirmed"} />
      </div>
    </div>
  );
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
    <div className="state-message">
      <div>
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function App() {
  const [provider, setProvider] = useState<Eip1193Provider>();
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading"
  });
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle"
  });
  const [activeScreen, setActiveScreen] = useState<Screen>(initScreen);
  const [gameState, setGameState] = useState<GameState>(initGameState);
  const [now, setNow] = useState(() => Date.now());
  const [statusMessage, setStatusMessage] = useState("Planet state loaded from this browser.");
  const account = "account" in wallet ? wallet.account : undefined;
  const hasSettlement = planet.kind === "success" || planet.kind === "already-settled";

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
    const interval = window.setInterval(() => {
      const current = Date.now();

      setNow(current);
      setGameState((state) => advanceState(state, current));
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
  }, [gameState]);

  const headerTitle = useMemo(() => {
    if (activeScreen === "building") {
      return "Building planner";
    }

    if (activeScreen === "research") {
      return "Research control";
    }

    return "Planet command";
  }, [activeScreen]);

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
      setStatusMessage("Onchain first planet settled. Management loop unlocked.");
    } catch (error) {
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Settlement transaction was rejected." : errorMessage(error)
      });
    }
  }

  function handleStartBuilding(targetId: string) {
    const current = Date.now();
    const result = startBuilding(advanceState(gameState, current), targetId, current);

    if (!result.ok) {
      setStatusMessage(`Cannot start building: ${actionLabels[result.reason]}.`);
      return;
    }

    setNow(current);
    setGameState(result.state);
    setStatusMessage(`${getQueueName(result.item)} started. State persists in this browser.`);
  }

  function handleStartResearch(targetId: string) {
    const current = Date.now();
    const result = startResearch(advanceState(gameState, current), targetId, current);

    if (!result.ok) {
      setStatusMessage(`Cannot start research: ${actionLabels[result.reason]}.`);
      return;
    }

    setNow(current);
    setGameState(result.state);
    setStatusMessage(`${getQueueName(result.item)} started. State persists in this browser.`);
  }

  function handleReset() {
    const reset = createInitialGameState();

    setGameState(reset);
    setStatusMessage("Local planet state reset.");
  }

  function handleScreenChange(screen: Screen) {
    setActiveScreen(screen);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);

      if (screen === "overview") {
        url.searchParams.delete("screen");
      } else {
        url.searchParams.set("screen", screen);
      }

      window.history.replaceState(null, "", url);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Veydrift navigation">
        <div className="brand-lockup">
          <span className="brand-mark">V</span>
          <div>
            <strong>Veydrift</strong>
            <span>Command MVP</span>
          </div>
        </div>

        <nav className="screen-tabs" aria-label="Screens">
          {screens.map((screen) => (
            <button
              aria-current={activeScreen === screen.id ? "page" : undefined}
              className={activeScreen === screen.id ? "active" : ""}
              key={screen.id}
              onClick={() => handleScreenChange(screen.id)}
              type="button"
            >
              {screen.label}
            </button>
          ))}
        </nav>

        <div className="cycle-card">
          <span>Settled wallet</span>
          <strong>{account ? shortAddress(account) : walletLabel(wallet)}</strong>
          <p>{planetLabel(planet)}. {statusMessage}</p>
          {hasSettlement ? <button onClick={handleReset} type="button">Reset state</button> : null}
        </div>

        <div className="cycle-card wallet-card">
          <span>Base Sepolia</span>
          <strong>{walletLabel(wallet)}</strong>
          <p>{statusMessage}</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">MVP management loop</p>
            <h1>{headerTitle}</h1>
          </div>
          <div className="topbar-actions">
            <span>{account ? shortAddress(account) : walletLabel(wallet)}</span>
            <button onClick={() => setGameState((state) => advanceState(state, Date.now()))} type="button">
              Refresh
            </button>
          </div>
        </header>

        <WalletSettlementPanel
          onConnect={connectWallet}
          onSettle={settlePlanet}
          onSwitchNetwork={switchNetwork}
          planet={planet}
          settlementReady={settlementContractConfigured(settlementConfig)}
          wallet={wallet}
        />

        {hasSettlement && activeScreen === "overview" && <OverviewScreen gameState={gameState} now={now} />}
        {hasSettlement && activeScreen === "building" && (
          <BuildingScreen gameState={gameState} now={now} onStart={handleStartBuilding} />
        )}
        {hasSettlement && activeScreen === "research" && (
          <ResearchScreen gameState={gameState} now={now} onStart={handleStartResearch} />
        )}
      </section>
    </main>
  );
}

function walletPanelTitle(wallet: WalletState, planet: PlanetState): string {
  if (wallet.kind === "wrong-network") {
    return "Switch to Base Sepolia";
  }

  if (wallet.kind === "connected" && planet.kind === "not-settled") {
    return "Settle your first planet";
  }

  return walletLabel(wallet);
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
  return {
    address: import.meta.env.VITE_VEYDRIFT_SETTLEMENT_ADDRESS || BASE_SEPOLIA_SETTLEMENT_ADDRESS
  };
}
