import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import heroUrl from "./assets/veydrift-hero.webp";
import { TelegramIcon } from "./components/TelegramIcon";
import { PlayableMvpApp } from "./PlayableMvpApp";
import { gameContractAddress, runtimeConfigUrl, type RuntimeConfig } from "./runtimeConfig";
import { preSettlementMode, type PlanetState, type WalletState } from "./settlementScreen";
import { TELEGRAM_SUPPORT_URL } from "./supportLinks";
import {
  createTransactionActionGate,
  transactionAwaitingWalletLabel,
  transactionConfirmingLabel,
  transactionSyncingLabel,
} from "./transactionActionGate";
import {
  ensureBaseSepoliaNetwork,
  getChainId,
  getCurrentAccounts,
  getInjectedProvider,
  isBaseSepoliaChain,
  isUserRejected,
  readSettlementFundingState,
  readSettlementState,
  requestAccounts,
  fetchWalletSettlement,
  sendSettlementTransaction,
  settlementContractConfigured,
  waitForReceipt,
  walletRequestErrorMessage,
  type Eip1193Provider,
  type PlanetSummary,
  type SettlementFundingState,
  type SettlementConfig,
  type WalletSettlementResponse
} from "./walletFlow";

const FIRST_PLANET_URL = "/assets/game/planets/temperate-ocean.webp";
const POST_SETTLEMENT_READ_ATTEMPTS = 8;
const POST_SETTLEMENT_READ_INTERVAL_MS = 2_000;

type SettlementConfigState =
  | { status: "loading"; apiUrl?: string; config: SettlementConfig }
  | { status: "ready"; apiUrl?: string; config: SettlementConfig };

type SettlementFunding =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; funding: SettlementFundingState }
  | { status: "error"; message: string };

export function FirstPlanetSettlementApp() {
  const [provider, setProvider] = useState<Eip1193Provider>();
  const [settlementConfigState, setSettlementConfigState] = useState<SettlementConfigState>(() => ({
    status: "loading",
    config: buildSettlementConfig()
  }));
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading"
  });
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle"
  });
  const [settlementFunding, setSettlementFunding] = useState<SettlementFunding>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";
  const settlementConfig = settlementConfigState.config;

  useEffect(() => {
    const abortController = new AbortController();

    fetch(runtimeConfigUrl(), {
      headers: { accept: "application/json" },
      signal: abortController.signal
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
        return response.json() as Promise<RuntimeConfig>;
      })
      .then((runtimeConfig) => {
        if (abortController.signal.aborted) return;
        const address = gameContractAddress(runtimeConfig) ?? settlementConfig.address;
        const legacyAddress = runtimeConfig.contractAddress && runtimeConfig.contractAddress !== address
          ? runtimeConfig.contractAddress
          : undefined;
        setSettlementConfigState({
          status: "ready",
          apiUrl: runtimeConfig.apiUrl,
          config: address ? {
            address,
            ...(legacyAddress ? { legacyAddress } : {}),
            resourceTokensConfigured: Boolean(
              runtimeConfig.resourceTokenAddresses.metal
                && runtimeConfig.resourceTokenAddresses.crystal
                && runtimeConfig.resourceTokenAddresses.deuterium
            )
          } : settlementConfig
        });
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setSettlementConfigState({ status: "ready", config: settlementConfig });
        }
      });

    return () => abortController.abort();
  }, []);

  useEffect(() => {
    const injected = getInjectedProvider(window as typeof window & { ethereum?: Eip1193Provider });
    setProvider(injected);

    if (!injected) {
      setWallet({
        kind: "no-wallet"
      });
      return;
    }

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
        setSettlementFunding({ status: "idle" });
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
    if (!provider || settlementConfigState.status !== "ready") {
      return;
    }

    void refreshWallet(provider, account);
  }, [provider, settlementConfig.address, settlementConfigState.apiUrl, settlementConfigState.status]);

  async function refreshWallet(injected = provider, preferredAccount?: string) {
    if (!injected) {
      setWallet({
        kind: "no-wallet"
      });
      setSettlementFunding({ status: "idle" });
      return;
    }

    try {
      const accounts = preferredAccount ? [preferredAccount] : await getCurrentAccounts(injected);

      if (!accounts[0]) {
        setWallet({
          kind: "disconnected"
        });
        setPlanet({
          kind: "idle"
        });
        setSettlementFunding({ status: "idle" });
        return;
      }

      if (settlementConfigState.status === "loading") {
        setWallet({
          kind: "connected",
          account: accounts[0]
        });
        setPlanet({
          kind: "checking"
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
        setSettlementFunding({ status: "idle" });
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
    } catch (error) {
      console.error("Wallet bootstrap failed", error);
      setWallet({
        kind: "disconnected"
      });
      setPlanet({
        kind: "error",
        message: walletRequestErrorMessage(error)
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshPlanet(injected: Eip1193Provider, connectedAccount: string) {
    setPlanet({
      kind: "checking"
    });

    try {
      const indexedSettlement = await readIndexedSettlementState(settlementConfigState.apiUrl, connectedAccount);
      if (indexedSettlement) {
        if (indexedSettlement.kind === "settled") {
          setSettlementFunding({ status: "idle" });
          setPlanet({
            kind: "already-settled",
            planet: indexedSettlement.planet
          });
        } else {
          setPlanet({
            kind: "not-settled"
          });
          await refreshSettlementFunding(injected, connectedAccount);
        }
        return;
      }
    } catch (error) {
      console.error("Indexed settlement state read failed", error);
    }

    try {
      const settlement = await readSettlementState(injected, connectedAccount, settlementConfig);

      if (settlement.kind === "unconfigured") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "contract-unconfigured"
        });
      } else if (settlement.kind === "settled") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "already-settled",
          planet: settlement.planet
        });
      } else if (settlement.kind === "legacy-settled") {
        setPlanet({
          kind: "legacy-settled",
          planet: settlement.planet
        });
        await refreshSettlementFunding(injected, connectedAccount);
      } else {
        setPlanet({
          kind: "not-settled"
        });
        await refreshSettlementFunding(injected, connectedAccount);
      }
    } catch (error) {
      console.error("Wallet settlement state read failed", error);
      setPlanet({
        kind: "error",
        message: walletRequestErrorMessage(error)
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshSettlementFunding(injected: Eip1193Provider, connectedAccount: string) {
    setSettlementFunding({ status: "loading" });
    try {
      setSettlementFunding({
        status: "ready",
        funding: await readSettlementFundingState(injected, connectedAccount, settlementConfig)
      });
    } catch (error) {
      setSettlementFunding({
        status: "error",
        message: walletRequestErrorMessage(error)
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
        message: isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error)
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
        message: isUserRejected(error) ? "Network switch was rejected." : walletRequestErrorMessage(error)
      });
    }
  }

  async function settlePlanet() {
    await transactionActionGate.run("settlement:first-planet", async () => {
      if (!provider || wallet.kind !== "connected") {
        return;
      }

      const label = "First planet settlement";
      setPlanet({
        kind: "pending",
        label: transactionAwaitingWalletLabel(label)
      });

      try {
        const txHash = await sendSettlementTransaction(provider, wallet.account, settlementConfig);
        setPlanet({
          kind: "pending",
          label: transactionConfirmingLabel(label, txHash),
          txHash
        });
        await waitForReceipt(provider, txHash);
        setPlanet({
          kind: "pending",
          label: transactionSyncingLabel(label),
          txHash
        });

        const settlement = await waitForSettledPlanet(provider, wallet.account, settlementConfig);

        setPlanet({
          kind: "success",
          planet: settlement.planet
        });
      } catch (error) {
        setPlanet({
          kind: isUserRejected(error) ? "rejected" : "error",
          message: isUserRejected(error) ? "Settlement transaction was rejected." : walletRequestErrorMessage(error)
        });
      }
    });
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

      <SettlementSupportLink />

      <section className="settlement-shell" aria-label="First planet settlement">
        <div className="settlement-command">
          <FlowBody
            mode={mode}
            onConnect={connectWallet}
            onSettle={settlePlanet}
            onSwitchNetwork={switchNetwork}
            planet={planet}
            settlementFunding={settlementFunding}
            settlementReady={settlementContractConfigured(settlementConfig)}
            wallet={wallet}
          />
        </div>

        <SettlementScanner mode={mode} />
      </section>
    </main>
  );
}

export function SettlementSupportLink() {
  return (
    <a
      aria-label="Telegram support"
      className="settlement-support-link"
      href={TELEGRAM_SUPPORT_URL}
      rel="noopener noreferrer"
      target="_blank"
      title="Telegram support"
    >
      <TelegramIcon className="settlement-support-icon" />
      <span>Telegram</span>
    </a>
  );
}

function FlowBody({
  mode,
  onConnect,
  onSettle,
  onSwitchNetwork,
  planet,
  settlementFunding,
  settlementReady,
  wallet
}: {
  mode: ReturnType<typeof preSettlementMode>;
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  settlementFunding: SettlementFunding;
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
        body={planet.label ?? (planet.txHash ? `Transaction beacon: ${planet.txHash}` : "Confirm the settlement launch in your wallet.")}
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

  const actionBlocked = !settlementReady
    || settlementFunding.status === "idle"
    || settlementFunding.status === "loading"
    || settlementFunding.status === "error"
    || (settlementFunding.status === "ready" && !settlementFunding.funding.affordable);
  const actionLabel = settlementFunding.status === "idle" || settlementFunding.status === "loading"
    ? "Checking balance"
    : "Launch settlement";
  const title = settlementFunding.status === "ready" && settlementFunding.funding.unavailableReason
    ? "Settlement setup incomplete"
    : settlementFunding.status === "ready" && !settlementFunding.funding.affordable
    ? "More Base Sepolia ETH required"
    : planet.kind === "legacy-settled"
      ? "Legacy planet detected"
      : "Found your first world";

  return (
    <StateMessage
      title={title}
      body={settlementBody(planet, settlementFunding)}
      action={<PrimaryButton disabled={actionBlocked} onClick={onSettle}>{actionLabel}</PrimaryButton>}
      tone={actionBlocked ? "warning" : "ready"}
    />
  );
}

function settlementBody(planet: PlanetState, settlementFunding: SettlementFunding): string {
  const prefix = planet.kind === "legacy-settled"
    ? "This wallet has a legacy first planet but no game home planet yet. Launch a new game settlement to continue."
    : "Launch settlement and mint this wallet's home planet.";

  if (settlementFunding.status === "idle" || settlementFunding.status === "loading") {
    return `${prefix} Checking the game start price and wallet balance.`;
  }

  if (settlementFunding.status === "error") {
    return `Could not verify the game start price and wallet balance: ${settlementFunding.message}`;
  }

  if (settlementFunding.status === "ready" && settlementFunding.funding.contractKind === "game") {
    const startPrice = formatEth(settlementFunding.funding.startPriceWei ?? 0n);
    const balance = formatEth(settlementFunding.funding.balanceWei ?? 0n);
    if (settlementFunding.funding.unavailableReason) {
      return `${prefix} ${settlementFunding.funding.unavailableReason}`;
    }

    return `${prefix} Settlement costs ${startPrice} ETH; this wallet has ${balance} ETH on Base Sepolia.`;
  }

  return prefix;
}

function formatEth(wei: bigint): string {
  const ether = 10n ** 18n;
  const whole = wei / ether;
  const fraction = wei % ether;
  if (fraction === 0n) return whole.toString();

  return `${whole.toString()}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

type IndexedSettlementState =
  | { kind: "settled"; planet: PlanetSummary }
  | { kind: "not-settled" };

async function readIndexedSettlementState(
  apiUrl: string | undefined,
  account: string,
): Promise<IndexedSettlementState | undefined> {
  if (!apiUrl) return undefined;

  return indexedSettlementState(await fetchWalletSettlement(apiUrl, account));
}

export function indexedSettlementState(settlement: WalletSettlementResponse): IndexedSettlementState {
  if (settlement.homePlanetId || settlement.hasFirstPlanet) {
    return {
      kind: "settled",
      planet: planetSummaryFromIndexedSettlement(settlement),
    };
  }

  return { kind: "not-settled" };
}

function planetSummaryFromIndexedSettlement(settlement: WalletSettlementResponse): PlanetSummary {
  const planet = settlement.planet;
  if (!planet) {
    return {
      label: settlement.homePlanetId ? `Planet #${settlement.homePlanetId}` : "First planet settled",
      source: "chain",
    };
  }

  const summary: PlanetSummary = {
    label: planet.name ?? `Planet ${planet.galaxy}:${planet.system}:${planet.position}`,
    coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
    fields: planet.fields.toString(),
    rarity: "Genesis settlement",
    resources: planet.resources,
    source: "chain",
    temperature: planet.temperature.toString(),
  };
  const settledAt = Number(planet.lastSettledAt);
  if (Number.isFinite(settledAt) && settledAt > 0) {
    summary.settledAt = new Date(settledAt * 1_000).toISOString();
  }

  return summary;
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

function buildSettlementConfig(): SettlementConfig {
  const address = import.meta.env.VITE_VEYDRIFT_SETTLEMENT_ADDRESS;

  return address ? { address } : {};
}

async function waitForSettledPlanet(
  provider: Eip1193Provider,
  account: string,
  settlementConfig: SettlementConfig,
) {
  let lastSettlement = await readSettlementState(provider, account, settlementConfig);

  for (let attempt = 0; attempt < POST_SETTLEMENT_READ_ATTEMPTS; attempt += 1) {
    if (lastSettlement.kind === "settled" && lastSettlement.planet.coordinates) {
      return lastSettlement;
    }

    await delay(POST_SETTLEMENT_READ_INTERVAL_MS);
    lastSettlement = await readSettlementState(provider, account, settlementConfig);
  }

  throw new Error("Settlement is confirmed, but the planet is still syncing. Retry once the chain read catches up.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
