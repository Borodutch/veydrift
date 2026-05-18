import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Factory, FlaskConical, Orbit, Radar, Rocket } from "lucide-preact";
import { OptimizedImage } from "./components/OptimizedImage";
import { shipAssetByKey } from "./gameAssets";
import { PlayableMvpApp } from "./PlayableMvpApp";
import { preSettlementMode, type PlanetState, type WalletState } from "./settlementScreen";
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
  waitForReceipt,
  type Eip1193Provider,
  type SettlementConfig
} from "./walletFlow";

const BASE_SEPOLIA_SETTLEMENT_ADDRESS = "0x8bA1807073ac642A55596A4934c49115E400cD2f";
const HOME_PLANET_ASSET = "/assets/game/planets/temperate-ocean.webp";
const OUTER_PLANET_ASSET = "/assets/game/planets/outer-cryo.webp";

const settlementConfig: SettlementConfig = buildSettlementConfig();

const gamePillars = [
  { icon: Orbit, label: "Settle", value: "first homeworld" },
  { icon: Factory, label: "Build", value: "mines and orbital yards" },
  { icon: FlaskConical, label: "Research", value: "tech paths" },
  { icon: Rocket, label: "Launch", value: "fleet production" },
  { icon: Radar, label: "Expand", value: "toward new systems" },
];

export function FirstPlanetSettlementApp() {
  const [provider, setProvider] = useState<Eip1193Provider>();
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading"
  });
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle"
  });

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";

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

    setPlanet({
      kind: "checking"
    });
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

  const mode = preSettlementMode(wallet, planet);

  return (
    <main className="settlement-entry">
      <div aria-hidden="true" className="settlement-space">
        <div className="settlement-stars settlement-stars-a" />
        <div className="settlement-stars settlement-stars-b" />
        <div className="settlement-nebula" />
      </div>

      <section className="settlement-hero" aria-labelledby="settlement-title">
        <div className="settlement-copy">
          <p className="settlement-kicker">Veydrift</p>
          <h1 id="settlement-title">Command your first world</h1>
          <p className="settlement-lede">
            Settle a home planet, wake the first mines, research new systems, and turn a quiet shipyard into the fleet that opens the galaxy.
          </p>

          <GamePillars />

          <FlowBody
            mode={mode}
            onConnect={connectWallet}
            onSettle={settlePlanet}
            onSwitchNetwork={switchNetwork}
            planet={planet}
            settlementReady={settlementContractConfigured(settlementConfig)}
            wallet={wallet}
          />
        </div>

        <div className="settlement-visual" aria-hidden="true">
          <div className="settlement-orbit settlement-orbit-main" />
          <div className="settlement-orbit settlement-orbit-inner" />
          <OptimizedImage
            alt=""
            className="settlement-planet settlement-planet-main"
            loading="eager"
            sizes="(max-width: 900px) 46vw, 34vw"
            src={HOME_PLANET_ASSET}
          />
          <OptimizedImage
            alt=""
            className="settlement-planet settlement-planet-outer"
            loading="eager"
            sizes="(max-width: 900px) 22vw, 12vw"
            src={OUTER_PLANET_ASSET}
          />
          <OptimizedImage
            alt=""
            className="settlement-ship settlement-ship-battleship"
            loading="eager"
            sizes="(max-width: 900px) 34vw, 22vw"
            src={shipAssetByKey.battleship}
          />
          <OptimizedImage
            alt=""
            className="settlement-ship settlement-ship-cruiser"
            loading="eager"
            sizes="(max-width: 900px) 26vw, 16vw"
            src={shipAssetByKey.battlecruiser}
          />
          <div className="settlement-scanline settlement-scanline-one" />
          <div className="settlement-scanline settlement-scanline-two" />
        </div>
      </section>
    </main>
  );
}

function GamePillars() {
  return (
    <div className="settlement-pillars" aria-label="Veydrift game loop">
      {gamePillars.map((pillar) => {
        const Icon = pillar.icon;

        return (
          <div className="settlement-pillar" key={pillar.label}>
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{pillar.label}</span>
            <strong>{pillar.value}</strong>
          </div>
        );
      })}
    </div>
  );
}

function FlowBody({
  mode,
  onConnect,
  onSettle,
  onSwitchNetwork,
  planet,
  settlementReady,
  wallet
}: {
  mode: ReturnType<typeof preSettlementMode>;
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  settlementReady: boolean;
  wallet: WalletState;
}) {
  if (mode === "resolving") {
    return <StateMessage title="Loading wallet" body="Checking wallet and first-planet settlement state." />;
  }

  if (mode === "no-wallet") {
    return (
      <StateMessage
        title="Wallet not found"
        body="Open this page with MetaMask or another injected EVM wallet."
        action={<PrimaryButton onClick={onConnect}>Check again</PrimaryButton>}
      />
    );
  }

  if (mode === "connect") {
    return (
      <StateMessage
        title={wallet.kind === "connecting" ? "Waiting for wallet approval" : "Connect wallet"}
        body="Connect a wallet to continue."
        action={<PrimaryButton disabled={wallet.kind === "connecting"} onClick={onConnect}>Connect wallet</PrimaryButton>}
      />
    );
  }

  if (mode === "wrong-network" && wallet.kind === "wrong-network") {
    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to Base Sepolia before settlement.`}
        action={<PrimaryButton onClick={onSwitchNetwork}>Switch network</PrimaryButton>}
      />
    );
  }

  if (mode === "contract-unconfigured") {
    return (
      <StateMessage
        title="Settlement contract not configured"
        body="Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the Base Sepolia settlement contract."
      />
    );
  }

  if (mode === "pending" && planet.kind === "pending") {
    return (
      <StateMessage
        title="Settlement pending"
        body={planet.txHash ? `Transaction submitted: ${planet.txHash}` : "Confirm the transaction in your wallet."}
      />
    );
  }

  if (mode === "settled") {
    return (
      <StateMessage
        title="Opening planet"
        body="First-planet settlement is confirmed."
      />
    );
  }

  if (mode === "error" && (planet.kind === "rejected" || planet.kind === "error")) {
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
      title="Settle first planet"
      body="Create the first onchain planet for this wallet and enter the command deck."
      action={<PrimaryButton disabled={!settlementReady} onClick={onSettle}>Settle first planet</PrimaryButton>}
    />
  );
}

function StateMessage({
  action,
  body,
  title
}: {
  action?: ComponentChildren;
  body: string;
  title: string;
}) {
  return (
    <div className="settlement-command">
      <div>
        <p className="settlement-command-label">Genesis protocol</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action ? <div className="settlement-command-action">{action}</div> : null}
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick
}: {
  children: ComponentChildren;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="settlement-primary-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
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
