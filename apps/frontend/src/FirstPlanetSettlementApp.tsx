import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import heroUrl from "./assets/veydrift-hero.webp";
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
const FIRST_PLANET_URL = "/assets/game/planets/temperate-ocean.webp";

const settlementConfig: SettlementConfig = buildSettlementConfig();

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
    <main className="settlement-stage">
      <div className="settlement-backdrop" aria-hidden="true">
        <img alt="" src={heroUrl} />
        <div className="settlement-starfield settlement-starfield-one" />
        <div className="settlement-starfield settlement-starfield-two" />
        <div className="settlement-nebula" />
        <div className="settlement-scanlines" />
      </div>

      <section className="settlement-shell" aria-label="First planet settlement">
        <div className="settlement-command">
          <div className="settlement-kicker">
            <span />
            Veydrift
          </div>
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

        <SettlementScanner mode={mode} />
      </section>
    </main>
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
    return <StateMessage tone="scanning" title="Reading wallet link" body="Checking wallet signal and first-planet settlement state." />;
  }

  if (mode === "no-wallet") {
    return (
      <StateMessage
        title="No pilot wallet detected"
        body="Open the bridge with MetaMask or another injected EVM wallet."
        action={<PrimaryButton onClick={onConnect}>Check again</PrimaryButton>}
        tone="warning"
      />
    );
  }

  if (mode === "connect") {
    return (
      <StateMessage
        title={wallet.kind === "connecting" ? "Waiting for pilot authorization" : "Link pilot wallet"}
        body="Connect a wallet to claim your first home world."
        action={<PrimaryButton disabled={wallet.kind === "connecting"} onClick={onConnect}>Link wallet</PrimaryButton>}
        tone={wallet.kind === "connecting" ? "scanning" : "ready"}
      />
    );
  }

  if (mode === "wrong-network" && wallet.kind === "wrong-network") {
    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to Base Sepolia to enter the settlement sector.`}
        action={<PrimaryButton onClick={onSwitchNetwork}>Switch network</PrimaryButton>}
        tone="warning"
      />
    );
  }

  if (mode === "contract-unconfigured") {
    return (
      <StateMessage
        title="Settlement beacon offline"
        body="Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the Base Sepolia settlement contract."
        tone="warning"
      />
    );
  }

  if (mode === "pending" && planet.kind === "pending") {
    return (
      <StateMessage
        title="Colony drop in progress"
        body={planet.txHash ? `Transaction beacon: ${planet.txHash}` : "Confirm the settlement launch in your wallet."}
        tone="scanning"
      />
    );
  }

  if (mode === "settled") {
    return (
      <StateMessage
        title="Planetfall confirmed"
        body="First-planet settlement is confirmed. Opening planetary overview."
        tone="ready"
      />
    );
  }

  if (mode === "error" && (planet.kind === "rejected" || planet.kind === "error")) {
    return (
      <StateMessage
        title={planet.kind === "rejected" ? "Request rejected" : "Wallet error"}
        body={planet.message}
        action={<PrimaryButton onClick={planet.kind === "rejected" ? onSettle : onConnect}>Retry</PrimaryButton>}
        tone="warning"
      />
    );
  }

  return (
    <StateMessage
      title="Found your first world"
      body="Launch settlement and mint this wallet's home planet."
      action={<PrimaryButton disabled={!settlementReady} onClick={onSettle}>Launch settlement</PrimaryButton>}
      tone="ready"
    />
  );
}

function StateMessage({
  action,
  body,
  title,
  tone = "ready"
}: {
  action?: ComponentChildren;
  body: string;
  title: string;
  tone?: "ready" | "scanning" | "warning";
}) {
  return (
    <div className={`settlement-state settlement-state-${tone}`}>
      <div className="settlement-state-copy">
        <div className="settlement-status">
          <span />
          {tone === "warning" ? "Alert" : tone === "scanning" ? "Scanning" : "Ready"}
        </div>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      {action ? <div className="settlement-action">{action}</div> : null}
    </div>
  );
}

function SettlementScanner({ mode }: { mode: ReturnType<typeof preSettlementMode> }) {
  const status = mode === "pending"
    ? "Drop vector locked"
    : mode === "wrong-network"
      ? "Network mismatch"
      : mode === "settle"
        ? "Settlement site ready"
        : "Awaiting wallet";

  return (
    <aside className="settlement-scanner" aria-label="Orbital settlement scanner">
      <div className="scanner-frame">
        <div className="scanner-hud scanner-hud-top">
          <span>Orbital scan</span>
          <strong>{status}</strong>
        </div>
        <div className="planet-orbit planet-orbit-a" />
        <div className="planet-orbit planet-orbit-b" />
        <img alt="" className="scanner-planet" src={FIRST_PLANET_URL} />
        <div className="scanner-site scanner-site-a" />
        <div className="scanner-site scanner-site-b" />
        <div className="scanner-site scanner-site-c" />
        <div className="scanner-reticle" />
        <div className="scanner-hud scanner-hud-bottom">
          <span>Atmosphere</span>
          <strong>Habitable</strong>
        </div>
      </div>
    </aside>
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
      className="settlement-primary"
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
