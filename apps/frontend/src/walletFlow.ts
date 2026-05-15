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
};

export type PlanetSummary = {
  label: string;
  coordinates?: string;
  fields?: string;
  rarity?: string;
  resources?: {
    metal: string;
    crystal: string;
    deuterium: string;
  };
  settledAt?: string;
  settledBlock?: string;
  temperature?: string;
  txHash?: string;
  source: "chain" | "transaction";
};

export type SettlementState =
  | { kind: "unconfigured" }
  | { kind: "not-settled" }
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
  previewFirstPlanet: "0x729b082f"
} as const;

const SETTLE_FIRST_PLANET_SELECTOR = "0x59268393";
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

export function decodeUintResult(hex: string): bigint {
  const clean = hex.replace(/^0x/, "");

  if (!clean) {
    return 0n;
  }

  return BigInt(`0x${clean.slice(-64)}`);
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

  const hasSettlement = await readHasFirstPlanet(provider, config.address, account);

  if (!hasSettlement) {
    return {
      kind: "not-settled"
    };
  }

  const planet = await readFirstPlanet(provider, config.address, account);

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

function decodeFirstPlanetWords(hex: string): PlanetSummary | undefined {
  const clean = hex.replace(/^0x/, "");

  if (clean.length < 7 * 64 || /^0+$/.test(clean)) {
    return undefined;
  }

  const words = clean.match(/.{1,64}/g) ?? [];
  const galaxy = words[0] ? Number(decodeUintWord(words[0])) : undefined;
  const system = words[1] ? Number(decodeUintWord(words[1])) : undefined;
  const position = words[2] ? Number(decodeUintWord(words[2])) : undefined;
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


  return planet;
}

function decodeUintWord(word: string): bigint {
  return BigInt(`0x${word}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
