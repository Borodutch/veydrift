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
    <main className="relative flex min-h-dvh items-center bg-[#070a10] px-5 py-10 text-slate-100 sm:px-8">
      <div className="fixed inset-0 -z-10">
        <img alt="" className="h-full w-full object-cover opacity-35" src={heroUrl} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,10,16,0.98)_0%,rgba(7,10,16,0.94)_48%,rgba(7,10,16,0.72)_100%)]" />
      </div>

      <section className="mx-auto w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Veydrift</p>
        <FlowBody
          mode={mode}
          onConnect={connectWallet}
          onSettle={settlePlanet}
          onSwitchNetwork={switchNetwork}
          planet={planet}
          settlementReady={settlementContractConfigured(settlementConfig)}
          wallet={wallet}
        />
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
      body="Create the first planet for this wallet."
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
    <div className="mt-4 flex min-h-44 min-w-0 flex-col justify-between gap-5">
      <div className="min-w-0">
        <h1 className="break-words text-3xl font-semibold text-white sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-full break-words text-base leading-7 text-slate-300">{body}</p>
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
  children: ComponentChildren;
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
