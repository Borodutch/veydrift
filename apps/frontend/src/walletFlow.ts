export type Eip1193Provider = {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[];
  }): Promise<T>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type InjectedWindow = {
  ethereum?: Eip1193Provider;
};

export type SettlementConfig = {
  address?: string;
  legacyAddress?: string;
  resourceTokensConfigured?: boolean;
};

export type SettlementFundingState = {
  affordable: boolean;
  balanceWei: bigint | null;
  contractKind: "game" | "legacy";
  startPriceWei: bigint | null;
  unavailableReason?: string;
};

export type OnChainResources = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export type OnChainEnergyBalance = {
  produced: string;
  required: string;
  scaleBps: string;
};

export type PlanetSummary = {
  label: string;
  coordinates?: string;
  fields?: string;
  rarity?: string;
  resources?: OnChainResources;
  settledAt?: string;
  settledBlock?: string;
  temperature?: string;
  txHash?: string;
  source: "chain" | "transaction";
};

export type WalletSettlementResponse = {
  wallet: string;
  hasFirstPlanet: boolean;
  homePlanetId: string | null;
  planet: {
    planetId: string;
    owner: string;
    galaxy: number;
    system: number;
    position: number;
    fields: number;
    temperature: number;
    metalMultiplierBps: number;
    crystalMultiplierBps: number;
    deuteriumMultiplierBps: number;
    lastSettledAt: string;
    resources: OnChainResources;
  } | null;
};

export type QueueStateResponse = {
  active: boolean;
  kind: string | null;
  itemId?: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string | null;
  startedAt?: string | null;
  cost: OnChainResources;
};

export type PlayerQueuesResponse = {
  wallet: string;
  homePlanetId: string | null;
  building: QueueStateResponse | null;
  defense: QueueStateResponse | null;
  ship: QueueStateResponse | null;
  research: QueueStateResponse | null;
};

export type ChainShipyardState = {
  wallet: string;
  homePlanetId: string | null;
  productionAvailable?: boolean;
  unavailableReason?: string;
  resources: OnChainResources | null;
  shipyardLevel: number;
  technologyLevels: Record<string, number>;
  ships: Array<{
    id: number;
    count: number;
    cost: OnChainResources;
  }>;
  queue: QueueStateResponse | null;
};

export type ChainDefenseState = {
  wallet: string;
  homePlanetId: string | null;
  productionAvailable?: boolean;
  unavailableReason?: string;
  resources: OnChainResources | null;
  shipyardLevel: number;
  missileSiloLevel: number;
  technologyLevels: Record<string, number>;
  defenses: Array<{
    id: number;
    count: number;
    cost: OnChainResources;
  }>;
  queue: QueueStateResponse | null;
};

export type ChainInfrastructureState = {
  wallet: string;
  homePlanetId: string | null;
  infrastructureAvailable?: boolean;
  unavailableReason?: string;
  resources: OnChainResources | null;
  productionPerHour: OnChainResources | null;
  energyBalance: OnChainEnergyBalance | null;
  storageCaps: OnChainResources | null;
  buildings: Array<{
    id: number;
    level: number;
    cost: OnChainResources;
  }>;
  queue: QueueStateResponse | null;
};

export type ChainResearchState = {
  wallet: string;
  homePlanetId: string | null;
  researchAvailable?: boolean;
  unavailableReason?: string;
  resources: OnChainResources | null;
  researchLabLevel: number;
  technologyLevels: Record<string, number>;
  technologies: Array<{
    id: number;
    level: number;
    cost: OnChainResources;
  }>;
  queue: QueueStateResponse | null;
};

export type RiftResourceKey = "metal" | "crystal" | "deuterium";

export type RiftRequirement = {
  kind: "building" | "technology";
  key: string;
  label: string;
  currentLevel: number | null;
  requiredLevel: number;
};

export type RiftResourceState = {
  key: RiftResourceKey;
  label: string;
  resourceId: number;
  tokenAddress: string | null;
  walletBalance: string | null;
  allowance: string | null;
  inGameBalance: string;
  lockedBalance: string;
};

export type PendingWithdrawal = {
  id: string;
  resource: RiftResourceKey;
  amount: string;
  requestedAt: string;
  unlocksAt: string;
  ready: boolean;
};

export type ChainRiftState = {
  wallet: string;
  homePlanetId: string | null;
  riftAvailable: boolean;
  unlocked: boolean;
  unavailableReason?: string;
  withdrawalDelaySeconds: string;
  requirements: RiftRequirement[];
  resources: RiftResourceState[];
  pendingWithdrawals: PendingWithdrawal[];
};

export type SettlementState =
  | { kind: "unconfigured" }
  | { kind: "not-settled" }
  | { kind: "legacy-settled"; planet: PlanetSummary }
  | { kind: "settled"; planet: PlanetSummary };

export const BASE_SEPOLIA = {
  chainId: 84532,
  chainIdHex: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: [
    "https://sepolia.base.org"
  ],
  blockExplorerUrls: [
    "https://sepolia.basescan.org"
  ]
} as const;

const READ_SELECTORS = {
  firstPlanetOf: "0x29147f24",
  hasFirstPlanet: "0x1d750846",
  homePlanetOf: "0x0ff79fa5",
  planet: "0x181c1bc4",
  previewFirstPlanet: "0x729b082f"
} as const;

const SETTLE_FIRST_PLANET_SELECTOR = "0x59268393";
const START_PLANET_SELECTOR = "0xf45f1f18";
const START_PRICE_SELECTOR = "0xf1a9af89";
const GAME_SELECTORS = {
  collectResources: "0xdb43284d",
  depositResource: "0x25819e15",
  finishDefenseProduction: "0xa5a0d597",
  finishBuildingUpgrade: "0x6ab2f9d4",
  finishResourceWithdrawal: "0xde0f208c",
  startBuildingUpgrade: "0x165715e3",
  collectShips: "0xb30a921c",
  finishShipProduction: "0x7bd93154",
  finishResearch: "0xba2fbdc8",
  requestResourceWithdrawal: "0x62a10a46",
  startDefenseProduction: "0xfec06283",
  startResearch: "0x7f314b93",
  startShipProduction: "0x13aed9a2"
} as const;
const ERC20_SELECTORS = {
  approve: "0x095ea7b3"
} as const;
const REJECTED_CODES = new Set([4001, "4001", "ACTION_REJECTED", "USER_REJECTED"]);

export function getInjectedProvider(globalWindow: InjectedWindow | undefined): Eip1193Provider | undefined {
  return globalWindow?.ethereum;
}

export function isUserRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  if (REJECTED_CODES.has(candidate.code as string | number)) {
    return true;
  }

  return typeof candidate.message === "string" && /reject|denied|cancel/i.test(candidate.message);
}

export function walletRequestErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  const code = errorCode(error);

  if (code === -32603 || code === "-32603" || /internal json-rpc error/i.test(message)) {
    return "The wallet could not read the current game contract state. Retry in a moment, or switch to Base Sepolia and reconnect your wallet.";
  }

  if (/execution reverted/i.test(message)) {
    return "The game contract rejected a wallet read. Retry sync after the latest deployment finishes, or reconnect your wallet on Base Sepolia.";
  }

  return message;
}

export function isBaseSepoliaChain(chainId: string | number | bigint): boolean {
  if (typeof chainId === "string") {
    return chainId.toLowerCase() === BASE_SEPOLIA.chainIdHex;
  }

  return Number(chainId) === BASE_SEPOLIA.chainId;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function settlementContractConfigured(config: SettlementConfig): config is SettlementConfig & { address: string } {
  return Boolean(config.address && /^0x[a-fA-F0-9]{40}$/.test(config.address));
}

export function settlementTransactionData(): string {
  return SETTLE_FIRST_PLANET_SELECTOR;
}

export function encodeAddressCall(selector: string, address: string): string {
  return `${selector}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function encodeUintCall(selector: string, value: bigint | number | string): string {
  return `${selector}${BigInt(value).toString(16).padStart(64, "0")}`;
}

export function encodeGameCall(selector: string, values: Array<bigint | number | string>): string {
  return `${selector}${values.map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")}`;
}

export function encodeAddressUintCall(selector: string, address: string, value: bigint | number | string): string {
  return `${selector}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${BigInt(value).toString(16).padStart(64, "0")}`;
}

export function parseRiftTokenAmount(value: string, decimals = 6): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid token amount.");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Use at most ${decimals} decimal places.`);
  }

  const base = 10n ** BigInt(decimals);
  return BigInt(whole) * base + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function decodeUintResult(hex: string): bigint {
  const clean = hex.replace(/^0x/, "");

  if (!clean) {
    return 0n;
  }

  return BigInt(`0x${clean.slice(-64)}`);
}

export function encodeQuantity(value: bigint | number | string): string {
  const quantity = BigInt(value);
  if (quantity < 0n) {
    throw new Error("Cannot encode a negative quantity.");
  }

  return `0x${quantity.toString(16)}`;
}

export function decodeBoolResult(hex: string): boolean {
  return decodeUintResult(hex) !== 0n;
}

export async function getCurrentAccounts(provider: Eip1193Provider): Promise<string[]> {
  return provider.request<string[]>({
    method: "eth_accounts"
  });
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  return provider.request<string[]>({
    method: "eth_requestAccounts"
  });
}

export async function getChainId(provider: Eip1193Provider): Promise<string> {
  return provider.request<string>({
    method: "eth_chainId"
  });
}

export async function ensureBaseSepoliaNetwork(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [
        {
          chainId: BASE_SEPOLIA.chainIdHex
        }
      ]
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

    if (code !== 4902 && code !== "4902") {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        BASE_SEPOLIA
      ]
    });
  }
}

export async function readSettlementState(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig
): Promise<SettlementState> {
  if (!settlementContractConfigured(config)) {
    return {
      kind: "unconfigured"
    };
  }

  let hasSettlement: boolean;

  try {
    hasSettlement = await readHasFirstPlanet(provider, config.address, account);
  } catch (error) {
    const gameSettlement = await readGameSettlement(provider, config.address, account);
    if (gameSettlement) {
      return gameSettlement.kind === "not-settled"
        ? await readLegacySettlementState(provider, account, config) ?? gameSettlement
        : gameSettlement;
    }

    throw error;
  }

  if (!hasSettlement) {
    return await readLegacySettlementState(provider, account, config) ?? {
      kind: "not-settled"
    };
  }

  let planet: PlanetSummary;

  try {
    planet = await readFirstPlanet(provider, config.address, account);
  } catch (error) {
    const gameSettlement = await readGameSettlement(provider, config.address, account);
    if (gameSettlement?.kind === "settled") {
      return gameSettlement;
    }

    throw error;
  }

  return {
    kind: "settled",
    planet
  };
}

export async function sendSettlementTransaction(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig
): Promise<string> {
  if (!settlementContractConfigured(config)) {
    throw new Error("Settlement contract address is not configured.");
  }

  const startPrice = await readStartPrice(provider, config.address);
  if (startPrice !== undefined) {
    if (config.resourceTokensConfigured === false) {
      throw new Error("Resource token reserves are not configured for this game deployment yet.");
    }

    const balance = await readNativeBalance(provider, account);
    if (balance < startPrice) {
      throw new Error(
        `First planet settlement costs ${formatEth(startPrice)} ETH, but this wallet only has ${formatEth(balance)} ETH on Base Sepolia.`
      );
    }

    return provider.request<string>({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: config.address,
          data: START_PLANET_SELECTOR,
          value: encodeQuantity(startPrice)
        }
      ]
    });
  }

  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: config.address,
        data: settlementTransactionData()
      }
    ]
  });
}

export async function readSettlementFundingState(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig
): Promise<SettlementFundingState> {
  if (!settlementContractConfigured(config)) {
    throw new Error("Settlement contract address is not configured.");
  }

  const startPrice = await readStartPrice(provider, config.address);
  if (startPrice === undefined) {
    return {
      affordable: true,
      balanceWei: null,
      contractKind: "legacy",
      startPriceWei: null
    };
  }

  if (config.resourceTokensConfigured === false) {
    return {
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: startPrice,
      unavailableReason: "Resource token reserves are not configured for this game deployment yet."
    };
  }

  const balance = await readNativeBalance(provider, account);
  return {
    affordable: balance >= startPrice,
    balanceWei: balance,
    contractKind: "game",
    startPriceWei: startPrice
  };
}

export async function sendStartShipProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  shipId: number,
  quantity: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.startShipProduction, [planetId, shipId, quantity])
      }
    ]
  });
}

export async function sendApproveResourceTokenTransaction(
  provider: Eip1193Provider,
  account: string,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint | number | string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: tokenAddress,
        data: encodeAddressUintCall(ERC20_SELECTORS.approve, spenderAddress, amount)
      }
    ]
  });
}

export async function sendDepositResourceTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  resourceId: number,
  amount: bigint | number | string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.depositResource, [planetId, resourceId, amount])
      }
    ]
  });
}

export async function sendRequestResourceWithdrawalTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  resourceId: number,
  amount: bigint | number | string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.requestResourceWithdrawal, [planetId, resourceId, amount])
      }
    ]
  });
}

export async function sendFinishResourceWithdrawalTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  resourceId: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.finishResourceWithdrawal, [resourceId])
      }
    ]
  });
}

export async function sendStartDefenseProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  defenseId: number,
  quantity: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.startDefenseProduction, [planetId, defenseId, quantity])
      }
    ]
  });
}

export async function sendStartBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  buildingId: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.startBuildingUpgrade, [planetId, buildingId])
      }
    ]
  });
}

export async function sendStartResearchTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  technologyId: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.startResearch, [planetId, technologyId])
      }
    ]
  });
}

export async function sendFinishBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.finishBuildingUpgrade, [planetId])
      }
    ]
  });
}

export async function sendFinishResearchTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: GAME_SELECTORS.finishResearch
      }
    ]
  });
}

export async function sendCollectResourcesTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.collectResources, [planetId])
      }
    ]
  });
}

export async function sendFinishShipProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.finishShipProduction, [planetId])
      }
    ]
  });
}

export async function sendFinishDefenseProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.finishDefenseProduction, [planetId])
      }
    ]
  });
}

export async function sendCollectShipsTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.collectShips, [planetId])
      }
    ]
  });
}

export async function waitForReceipt(
  provider: Eip1193Provider,
  txHash: string,
  maxAttempts = 40,
  intervalMs = 3_000
): Promise<unknown> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await provider.request<unknown>({
      method: "eth_getTransactionReceipt",
      params: [
        txHash
      ]
    });

    if (receipt) {
      return receipt;
    }

    await delay(intervalMs);
  }

  throw new Error("Timed out waiting for settlement transaction confirmation.");
}

export function planetFromTransaction(account: string, txHash: string): PlanetSummary {
  return {
    label: `Settled by ${shortAddress(account)}`,
    txHash,
    source: "transaction"
  };
}

async function readHasFirstPlanet(
  provider: Eip1193Provider,
  contractAddress: string,
  account: string
): Promise<boolean> {
  const result = await provider.request<string>({
    method: "eth_call",
    params: [
      {
        to: contractAddress,
        data: encodeAddressCall(READ_SELECTORS.hasFirstPlanet, account)
      },
      "latest"
    ]
  });

  return decodeBoolResult(result);
}

async function readFirstPlanet(
  provider: Eip1193Provider,
  contractAddress: string,
  account: string
): Promise<PlanetSummary> {
  const result = await provider.request<string>({
    method: "eth_call",
    params: [
      {
        to: contractAddress,
        data: encodeAddressCall(READ_SELECTORS.firstPlanetOf, account)
      },
      "latest"
    ]
  });

  const decoded = decodeFirstPlanetWords(result);

  if (decoded) {
    return decoded;
  }

  return {
    label: "First planet settled",
    source: "chain"
  };
}

async function readGameSettlement(
  provider: Eip1193Provider,
  contractAddress: string,
  account: string
): Promise<SettlementState | undefined> {
  try {
    const homePlanetId = decodeUintResult(await provider.request<string>({
      method: "eth_call",
      params: [
        {
          to: contractAddress,
          data: encodeAddressCall(READ_SELECTORS.homePlanetOf, account)
        },
        "latest"
      ]
    }));

    if (homePlanetId === 0n) {
      return {
        kind: "not-settled"
      };
    }

    const planet = await readGamePlanet(provider, contractAddress, homePlanetId);

    return {
      kind: "settled",
      planet: planet ?? {
        label: `Planet #${homePlanetId.toString()}`,
        source: "chain"
      }
    };
  } catch {
    return undefined;
  }
}

async function readLegacySettlementState(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig
): Promise<SettlementState | undefined> {
  if (!config.legacyAddress || config.legacyAddress.toLowerCase() === config.address?.toLowerCase()) {
    return undefined;
  }

  try {
    const hasLegacySettlement = await readHasFirstPlanet(provider, config.legacyAddress, account);
    if (!hasLegacySettlement) {
      return undefined;
    }

    return {
      kind: "legacy-settled",
      planet: await readFirstPlanet(provider, config.legacyAddress, account)
    };
  } catch {
    return undefined;
  }
}

async function readStartPrice(provider: Eip1193Provider, contractAddress: string): Promise<bigint | undefined> {
  try {
    return decodeUintResult(await provider.request<string>({
      method: "eth_call",
      params: [
        {
          to: contractAddress,
          data: START_PRICE_SELECTOR
        },
        "latest"
      ]
    }));
  } catch {
    return undefined;
  }
}

async function readNativeBalance(provider: Eip1193Provider, account: string): Promise<bigint> {
  return decodeUintResult(await provider.request<string>({
    method: "eth_getBalance",
    params: [
      account,
      "latest"
    ]
  }));
}

function formatEth(wei: bigint): string {
  const ether = 10n ** 18n;
  const whole = wei / ether;
  const fraction = wei % ether;
  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

async function readGamePlanet(
  provider: Eip1193Provider,
  contractAddress: string,
  planetId: bigint
): Promise<PlanetSummary | undefined> {
  const result = await provider.request<string>({
    method: "eth_call",
    params: [
      {
        to: contractAddress,
        data: encodeUintCall(READ_SELECTORS.planet, planetId)
      },
      "latest"
    ]
  });

  return decodeGamePlanetWords(result);
}

export async function previewFirstPlanet(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig
): Promise<PlanetSummary | undefined> {
  if (!settlementContractConfigured(config)) {
    return undefined;
  }

  const result = await provider.request<string>({
    method: "eth_call",
    params: [
      {
        to: config.address,
        data: encodeAddressCall(READ_SELECTORS.previewFirstPlanet, account)
      },
      "latest"
    ]
  });

  return decodeFirstPlanetWords(result);
}

function decodeGamePlanetWords(hex: string): PlanetSummary | undefined {
  const clean = hex.replace(/^0x/, "");

  if (clean.length < 13 * 64 || /^0+$/.test(clean)) {
    return undefined;
  }

  const words = clean.match(/.{1,64}/g) ?? [];
  const galaxy = words[1] ? Number(decodeUintWord(words[1])) : undefined;
  const system = words[2] ? Number(decodeUintWord(words[2])) : undefined;
  const position = words[3] ? Number(decodeUintWord(words[3])) : undefined;
  const fields = words[4] ? Number(decodeUintWord(words[4])) : undefined;
  const temperature = words[5] ? Number(decodeSignedWord(words[5])) : undefined;
  const lastSettledAt = words[9] ? decodeUintWord(words[9]) : undefined;
  const metal = words[10] ? decodeUintWord(words[10]) : undefined;
  const crystal = words[11] ? decodeUintWord(words[11]) : undefined;
  const deuterium = words[12] ? decodeUintWord(words[12]) : undefined;

  if (!Number.isFinite(galaxy) || !Number.isFinite(system) || !Number.isFinite(position)) {
    return undefined;
  }

  const planet: PlanetSummary = {
    label: `Planet ${galaxy}:${system}:${position}`,
    coordinates: `${galaxy}:${system}:${position}`,
    rarity: "Genesis settlement",
    source: "chain"
  };

  if (lastSettledAt && lastSettledAt > 0n) {
    planet.settledAt = new Date(Number(lastSettledAt) * 1_000).toISOString();
  }

  if (fields !== undefined && Number.isInteger(fields) && fields > 0 && fields <= 1_000) {
    planet.fields = fields.toString();
  }

  if (temperature !== undefined && Number.isInteger(temperature) && temperature >= -200 && temperature <= 200) {
    planet.temperature = temperature.toString();
  }

  if (metal !== undefined && crystal !== undefined && deuterium !== undefined) {
    planet.resources = {
      metal: metal.toString(),
      crystal: crystal.toString(),
      deuterium: deuterium.toString()
    };
  }

  return planet;
}

function decodeFirstPlanetWords(hex: string): PlanetSummary | undefined {
  const clean = hex.replace(/^0x/, "");

  if (clean.length < 7 * 64 || /^0+$/.test(clean)) {
    return undefined;
  }

  const words = clean.match(/.{1,64}/g) ?? [];
  const galaxy = words[0] ? Number(decodeUintWord(words[0])) : undefined;
  const system = words[1] ? Number(decodeUintWord(words[1])) : undefined;
  const position = words[2] ? Number(decodeUintWord(words[2])) : undefined;
  const fields = words[3] ? Number(decodeUintWord(words[3])) : undefined;
  const temperature = words[4] ? Number(decodeSignedWord(words[4])) : undefined;
  const settledAt = words[5] ? decodeUintWord(words[5]) : undefined;
  const settledBlock = words[6] ? decodeUintWord(words[6]) : undefined;

  if (!Number.isFinite(galaxy) || !Number.isFinite(system) || !Number.isFinite(position)) {
    return undefined;
  }

  const planet: PlanetSummary = {
    label: `Planet ${galaxy}:${system}:${position}`,
    coordinates: `${galaxy}:${system}:${position}`,
    rarity: "Genesis settlement",
    source: "chain"
  };

  if (settledAt && settledAt > 0n) {
    planet.settledAt = new Date(Number(settledAt) * 1_000).toISOString();
  }

  if (settledBlock && settledBlock > 0n) {
    planet.settledBlock = settledBlock.toString();
  }

  if (fields !== undefined && Number.isInteger(fields) && fields > 0 && fields <= 1_000) {
    planet.fields = fields.toString();
  }

  if (temperature !== undefined && Number.isInteger(temperature) && temperature >= -200 && temperature <= 200) {
    planet.temperature = temperature.toString();
  }

  return planet;
}

function decodeUintWord(word: string): bigint {
  return BigInt(`0x${word}`);
}

function decodeSignedWord(word: string): bigint {
  return BigInt.asIntN(256, BigInt(`0x${word}`));
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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code: unknown }).code
    : undefined;
}

export async function fetchWalletSettlement(apiUrl: string, wallet: string): Promise<WalletSettlementResponse> {
  return fetchWalletJson<WalletSettlementResponse>(apiUrl, wallet, "settlement", "Settlement");
}

export async function fetchWalletQueues(apiUrl: string, wallet: string): Promise<PlayerQueuesResponse> {
  return fetchWalletJson<PlayerQueuesResponse>(apiUrl, wallet, "queues", "Queues");
}

export async function fetchInfrastructureState(apiUrl: string, wallet: string): Promise<ChainInfrastructureState> {
  return fetchWalletJson<ChainInfrastructureState>(apiUrl, wallet, "infrastructure", "Infrastructure");
}

export async function fetchShipyardState(apiUrl: string, wallet: string): Promise<ChainShipyardState> {
  return fetchWalletJson<ChainShipyardState>(apiUrl, wallet, "shipyard", "Shipyard");
}

export async function fetchDefenseState(apiUrl: string, wallet: string): Promise<ChainDefenseState> {
  return fetchWalletJson<ChainDefenseState>(apiUrl, wallet, "defenses", "Defenses");
}

export async function fetchResearchState(apiUrl: string, wallet: string): Promise<ChainResearchState> {
  return fetchWalletJson<ChainResearchState>(apiUrl, wallet, "research", "Research");
}

export async function fetchRiftState(apiUrl: string, wallet: string): Promise<ChainRiftState> {
  return fetchWalletJson<ChainRiftState>(apiUrl, wallet, "rift", "Rift");
}

export async function fetchSystemData(apiUrl: string, galaxy: number, system: number): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/universe/galaxies/${galaxy}/systems/${system}`);
  if (!response.ok) throw new Error(`System API failed: ${response.status}`);
  return response.json();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWalletJson<T>(
  apiUrl: string,
  wallet: string,
  path: string,
  label: string
): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/wallet/${encodeURIComponent(wallet)}/${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${label} API failed: ${response.status}`);
  return response.json() as Promise<T>;
}
