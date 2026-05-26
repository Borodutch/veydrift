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
    name: string | null;
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

export type ManagedPlanetResponse = NonNullable<WalletSettlementResponse["planet"]> & {
  coordinates: string;
  isHomePlanet: boolean;
  fieldsUsed: number;
  fieldsCapacity: number;
  keyLevels: {
    metalMine: number;
    crystalMine: number;
    deuteriumSynthesizer: number;
    solarPlant: number;
    roboticsFactory: number;
    shipyard: number;
    researchLab: number;
    terraformer: number;
  };
  queues: {
    building: QueueStateResponse | null;
    defense: QueueStateResponse | null;
    ship: QueueStateResponse | null;
  };
  moon: {
    exists: boolean;
  } | null;
};

export type WalletPlanetsResponse = {
  wallet: string;
  homePlanetId: string | null;
  planets: ManagedPlanetResponse[];
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

export type FleetMissionSummary = {
  missionId: string;
  status: string;
  missionType: string;
  owner: string;
  originPlanetId: string;
  targetPlanetId: string;
  arrivalAt: string;
  returnAt: string;
  fuelCost: string;
  recallCost: string | null;
  attackGroupId: string | null;
  joinedAttackMissionIds: string[];
  cargo: OnChainResources;
  ships: Record<string, string>;
  transactionHash: string;
  blockNumber: string;
  needsResolution?: boolean;
};

export type FleetMissionVisibilityResponse = {
  wallet: string;
  homePlanetId: string | null;
  incoming: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
};

export type ChainShipyardState = {
  wallet: string;
  homePlanetId: string | null;
  productionAvailable?: boolean;
  unavailableReason?: string;
  resources: OnChainResources | null;
  fleetSlots?: {
    active: number;
    limit: number;
  };
  shipyardLevel: number;
  naniteLevel: number;
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
  protectedResources?: OnChainResources | null;
  raidableResources?: OnChainResources | null;
  technologyLevels?: Record<string, number>;
  buildings: Array<{
    id: number;
    level: number;
    cost: OnChainResources;
  }>;
  queue: QueueStateResponse | null;
};

export type ChainMoonState = {
  wallet: string;
  homePlanetId: string | null;
  moonAvailable?: boolean;
  unavailableReason?: string;
  moon: {
    exists: boolean;
    planetId: string;
    owner: string;
    fields: number;
    diameterKm: number;
    createdAt: string;
    jumpGateReadyAt: string;
  } | null;
  sensorPhalanxRange: string | null;
  buildings: Array<{
    id: number;
    key: "lunarBase" | "sensorPhalanx" | "jumpGate";
    label: string;
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
  binary?: boolean;
  built?: boolean | null;
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

export type MissionShips = {
  smallCargo: number;
  lightFighter: number;
  recycler: number;
  colonyShip: number;
  largeCargo: number;
  heavyFighter: number;
  cruiser: number;
  battleship: number;
  bomber: number;
  destroyer: number;
  deathstar: number;
  battlecruiser: number;
  reaper: number;
  pathfinder: number;
};

export type ChainAllianceState = {
  wallet: string;
  allianceAvailable: boolean;
  unavailableReason?: string;
  membership: {
    allianceId: string;
    role: AllianceRole;
    joinedAt: string;
  };
  profile: {
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: string;
    createdAt: string;
    memberCount: number;
  } | null;
  directory: Array<{
    allianceId: string;
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: string;
    createdAt: string;
    memberCount: number;
  }>;
  pendingInvites: Array<{
    allianceId: string;
    inviter: string;
    invitedAt: string;
  }>;
  pendingJoinRequests: Array<{
    allianceId: string;
    requester: string;
    requestedAt: string;
  }>;
  allianceJoinRequests: Array<{
    allianceId: string;
    requester: string;
    requestedAt: string;
  }>;
  members: Array<{
    address: string;
    role: AllianceRole;
    joinedAt: string;
  }>;
};

export type AllianceRole = "none" | "member" | "officer" | "owner";

export type HighscoreCategory =
  | "total"
  | "economy"
  | "research"
  | "researchLevels"
  | "military"
  | "fleet"
  | "fleetCount"
  | "defense";

export type HighscoreEntry = {
  rank: number;
  wallet: string;
  homePlanetId: string | null;
  planetCount: number;
  score: Record<HighscoreCategory, string>;
};

export type HighscoreResponse = {
  generatedAt: string;
  formula: {
    pointsDivisor: string;
    summary: string;
    target?: string;
    excludedCategories?: string[];
  };
  rankings: Record<HighscoreCategory, HighscoreEntry[]>;
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
  abandonPlanet: "0xfa16dddc",
  completeFleetMissionReturn: "0xc2472852",
  collectResources: "0xdb43284d",
  createColony: "0x71358ab8",
  depositResource: "0x25819e15",
  finishDefenseProduction: "0xa5a0d597",
  finishBuildingUpgrade: "0x6ab2f9d4",
  finishResourceWithdrawal: "0xde0f208c",
  joinAttackMission: "0x28260eb6",
  launchInterplanetaryMissileAttack: "0xa72cd29a",
  launchFleetMission: "0x28247df8",
  resolveFleetMission: "0xde09e7cf",
  startBuildingUpgrade: "0x165715e3",
  finishShipProduction: "0x7bd93154",
  finishResearch: "0xba2fbdc8",
  renamePlanet: "0xa74c0906",
  requestResourceWithdrawal: "0x62a10a46",
  recallFleetMission: "0x1cbc460c",
  startDefenseProduction: "0xfec06283",
  startResearch: "0x7f314b93",
  startShipProduction: "0x13aed9a2"
} as const;
const ALLIANCE_SELECTORS = {
  createAlliance: "0x944cde0e",
  updateAllianceProfile: "0x3fd0e7a5",
  inviteMember: "0x9e6d6830",
  acceptInvite: "0xbf8e9176",
  requestJoinAlliance: "0xbc46277a",
  cancelJoinRequest: "0xc5c4bdcc",
  approveJoinRequest: "0x8ff388c7",
  kickMember: "0xbd0e667c",
  setMemberRole: "0xbfbb73f1"
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

export function encodePlanetNameCall(selector: string, planetId: bigint | number | string, name: string): string {
  const encoded = new TextEncoder().encode(name);
  const length = encoded.length;
  const chunks = Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(Math.ceil(length / 32) * 64, "0");
  return `${selector}${BigInt(planetId).toString(16).padStart(64, "0")}${(64n).toString(16).padStart(64, "0")}${BigInt(length).toString(16).padStart(64, "0")}${chunks}`;
}

export function encodeLaunchFleetMissionCall({
  originPlanetId,
  targetPlanetId,
  missionType,
  ships,
  cargo,
  randomnessRequestId = 0,
}: {
  originPlanetId: bigint | number | string;
  targetPlanetId: bigint | number | string;
  missionType: number;
  ships: MissionShips;
  cargo?: Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined;
  randomnessRequestId?: bigint | number | string | undefined;
}): string {
  return encodeGameCall(GAME_SELECTORS.launchFleetMission, [
    originPlanetId,
    targetPlanetId,
    missionType,
    ships.smallCargo,
    ships.lightFighter,
    ships.recycler,
    ships.colonyShip,
    ships.largeCargo,
    ships.heavyFighter,
    ships.cruiser,
    ships.battleship,
    ships.bomber,
    ships.destroyer,
    ships.deathstar,
    ships.battlecruiser,
    ships.reaper,
    ships.pathfinder,
    cargo?.metal ?? 0,
    cargo?.crystal ?? 0,
    cargo?.deuterium ?? 0,
    randomnessRequestId,
  ]);
}

export function encodeJoinAttackMissionCall({
  originPlanetId,
  attackMissionId,
  targetPlanetId,
  ships,
  cargo,
}: {
  originPlanetId: bigint | number | string;
  attackMissionId: bigint | number | string;
  targetPlanetId: bigint | number | string;
  ships: MissionShips;
  cargo?: Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined;
}): string {
  return encodeGameCall(GAME_SELECTORS.joinAttackMission, [
    originPlanetId,
    attackMissionId,
    targetPlanetId,
    ships.smallCargo,
    ships.lightFighter,
    ships.recycler,
    ships.colonyShip,
    ships.largeCargo,
    ships.heavyFighter,
    ships.cruiser,
    ships.battleship,
    ships.bomber,
    ships.destroyer,
    ships.deathstar,
    ships.battlecruiser,
    ships.reaper,
    ships.pathfinder,
    cargo?.metal ?? 0,
    cargo?.crystal ?? 0,
    cargo?.deuterium ?? 0,
  ]);
}

export function encodeLaunchInterplanetaryMissileAttackCall({
  originPlanetId,
  targetPlanetId,
  primaryTargetId,
  quantity,
}: {
  originPlanetId: bigint | number | string;
  targetPlanetId: bigint | number | string;
  primaryTargetId: bigint | number | string;
  quantity: bigint | number | string;
}): string {
  return encodeGameCall(GAME_SELECTORS.launchInterplanetaryMissileAttack, [
    originPlanetId,
    targetPlanetId,
    primaryTargetId,
    quantity,
  ]);
}

export function encodeStringTripleCall(selector: string, values: [string, string, string]): string {
  const heads: string[] = [];
  const tails: string[] = [];
  let offset = 32n * BigInt(values.length);
  for (const value of values) {
    const encoded = encodeAbiString(value);
    heads.push(offset.toString(16).padStart(64, "0"));
    tails.push(encoded);
    offset += BigInt(encoded.length / 2);
  }
  return `${selector}${heads.join("")}${tails.join("")}`;
}

export function encodeUintStringTripleCall(selector: string, value: bigint | number | string, values: [string, string, string]): string {
  const heads = [BigInt(value).toString(16).padStart(64, "0")];
  const tails: string[] = [];
  let offset = 32n * BigInt(values.length + 1);
  for (const item of values) {
    const encoded = encodeAbiString(item);
    heads.push(offset.toString(16).padStart(64, "0"));
    tails.push(encoded);
    offset += BigInt(encoded.length / 2);
  }
  return `${selector}${heads.join("")}${tails.join("")}`;
}

export function encodeAddressUintCall(selector: string, address: string, value: bigint | number | string): string {
  return `${selector}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${BigInt(value).toString(16).padStart(64, "0")}`;
}

export function encodeUintAddressCall(selector: string, value: bigint | number | string, address: string): string {
  return `${selector}${BigInt(value).toString(16).padStart(64, "0")}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function encodeUintAddressUintCall(selector: string, value: bigint | number | string, address: string, role: bigint | number | string): string {
  return `${encodeUintAddressCall(selector, value, address)}${BigInt(role).toString(16).padStart(64, "0")}`;
}

function encodeAbiString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const body = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const paddedLength = Math.ceil(body.length / 64) * 64;
  return `${bytes.length.toString(16).padStart(64, "0")}${body.padEnd(paddedLength, "0")}`;
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

export async function sendCreateAllianceTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  tag: string,
  name: string,
  description: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeStringTripleCall(ALLIANCE_SELECTORS.createAlliance, [tag, name, description])
      }
    ]
  });
}

export async function sendAllianceInviteTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: `${ALLIANCE_SELECTORS.inviteMember}${BigInt(allianceId).toString(16).padStart(64, "0")}${playerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`
      }
    ]
  });
}

export async function sendAllianceProfileTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  tag: string,
  name: string,
  description: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintStringTripleCall(ALLIANCE_SELECTORS.updateAllianceProfile, allianceId, [tag, name, description])
      }
    ]
  });
}

export async function sendAcceptAllianceInviteTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintCall(ALLIANCE_SELECTORS.acceptInvite, allianceId)
      }
    ]
  });
}

export async function sendAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintCall(ALLIANCE_SELECTORS.requestJoinAlliance, allianceId)
      }
    ]
  });
}

export async function sendCancelAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintCall(ALLIANCE_SELECTORS.cancelJoinRequest, allianceId)
      }
    ]
  });
}

export async function sendApproveAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintAddressCall(ALLIANCE_SELECTORS.approveJoinRequest, allianceId, playerAddress)
      }
    ]
  });
}

export async function sendAllianceKickTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintAddressCall(ALLIANCE_SELECTORS.kickMember, allianceId, playerAddress)
      }
    ]
  });
}

export async function sendAllianceRoleTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string,
  role: "member" | "officer"
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeUintAddressUintCall(ALLIANCE_SELECTORS.setMemberRole, allianceId, playerAddress, role === "officer" ? 2 : 1)
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

export async function sendRenamePlanetTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  name: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodePlanetNameCall(GAME_SELECTORS.renamePlanet, planetId, name)
      }
    ]
  });
}

export async function sendAbandonPlanetTransaction(
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
        data: encodeGameCall(GAME_SELECTORS.abandonPlanet, [planetId])
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

export async function sendLaunchFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeLaunchFleetMissionCall>[0]
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeLaunchFleetMissionCall(params)
      }
    ]
  });
}

export async function sendJoinAttackMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeJoinAttackMissionCall>[0]
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeJoinAttackMissionCall(params)
      }
    ]
  });
}

export async function sendLaunchInterplanetaryMissileAttackTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeLaunchInterplanetaryMissileAttackCall>[0]
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeLaunchInterplanetaryMissileAttackCall(params)
      }
    ]
  });
}

export async function sendRecallFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.recallFleetMission, [missionId])
      }
    ]
  });
}

export async function sendResolveFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.resolveFleetMission, [missionId])
      }
    ]
  });
}

export async function sendCompleteFleetMissionReturnTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.completeFleetMissionReturn, [missionId])
      }
    ]
  });
}

export async function sendCreateColonyTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  originPlanetId: string,
  galaxy: number,
  system: number,
  position: number
): Promise<string> {
  return provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: contractAddress,
        data: encodeGameCall(GAME_SELECTORS.createColony, [originPlanetId, galaxy, system, position])
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

export async function fetchWalletPlanets(apiUrl: string, wallet: string): Promise<WalletPlanetsResponse> {
  return fetchWalletJson<WalletPlanetsResponse>(apiUrl, wallet, "planets", "Planets");
}

export async function fetchWalletQueues(apiUrl: string, wallet: string, planetId?: string): Promise<PlayerQueuesResponse> {
  return fetchWalletJson<PlayerQueuesResponse>(apiUrl, wallet, withPlanetId("queues", planetId), "Queues");
}

export async function fetchFleetMissionVisibility(apiUrl: string, wallet: string): Promise<FleetMissionVisibilityResponse> {
  return fetchWalletJson<FleetMissionVisibilityResponse>(apiUrl, wallet, "fleet-visibility", "Fleet visibility");
}

export async function fetchInfrastructureState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainInfrastructureState> {
  return fetchWalletJson<ChainInfrastructureState>(apiUrl, wallet, withPlanetId("infrastructure", planetId), "Infrastructure");
}

export async function fetchMoonState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainMoonState> {
  return fetchWalletJson<ChainMoonState>(apiUrl, wallet, withPlanetId("moon", planetId), "Moon");
}

export async function fetchShipyardState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainShipyardState> {
  return fetchWalletJson<ChainShipyardState>(apiUrl, wallet, withPlanetId("shipyard", planetId), "Shipyard");
}

export async function fetchDefenseState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainDefenseState> {
  return fetchWalletJson<ChainDefenseState>(apiUrl, wallet, withPlanetId("defenses", planetId), "Defenses");
}

export async function fetchResearchState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainResearchState> {
  return fetchWalletJson<ChainResearchState>(apiUrl, wallet, withPlanetId("research", planetId), "Research");
}

export async function fetchRiftState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainRiftState> {
  return fetchWalletJson<ChainRiftState>(apiUrl, wallet, withPlanetId("rift", planetId), "Rift");
}

export async function fetchAllianceState(apiUrl: string, wallet: string): Promise<ChainAllianceState> {
  return fetchWalletJson<ChainAllianceState>(apiUrl, wallet, "alliance", "Alliance");
}

export async function fetchHighscores(apiUrl: string, limit = 100): Promise<HighscoreResponse> {
  let response: Response;

  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, "")}/highscores?limit=${limit}`, {
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    throw new Error(highscoreNetworkFailureMessage(error));
  }

  if (!response.ok) throw new Error(await highscoreHttpFailureMessage(response));
  return response.json();
}

async function highscoreHttpFailureMessage(response: Response): Promise<string> {
  const errorBody = await readJsonErrorBody(response);
  const errorCode = typeof errorBody?.error === "string" ? errorBody.error : undefined;

  if (response.status === 503 && errorCode === "highscores_not_supported") {
    return "Rankings are temporarily unavailable because the deployed game API does not support highscores yet. Retry after the backend redeploys.";
  }

  if (response.status === 503 && errorCode === "backend_not_configured") {
    return "Rankings are temporarily unavailable because the game API is not fully configured. Retry after the backend configuration is restored.";
  }

  if (response.status === 503 && errorCode === "highscores_unavailable") {
    return "Rankings are temporarily unavailable because the game API could not read current chain data. Retry in a moment.";
  }

  if (response.status >= 500) {
    return `Rankings are temporarily unavailable because the game API returned ${response.status}. Retry in a moment.`;
  }

  return `Rankings could not be loaded because the game API returned ${response.status}.`;
}

async function readJsonErrorBody(response: Response): Promise<{ error?: unknown } | undefined> {
  try {
    const parsed = await response.clone().json();
    return parsed && typeof parsed === "object" ? parsed as { error?: unknown } : undefined;
  } catch {
    return undefined;
  }
}

function highscoreNetworkFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  if (/failed to fetch|load failed|network/i.test(message)) {
    return "Rankings are temporarily unavailable because the game API could not be reached from this browser. Check the API deployment or CORS settings, then retry.";
  }

  return message || "Rankings could not be loaded.";
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
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, label));
  }
  return response.json() as Promise<T>;
}

function withPlanetId(path: string, planetId: string | undefined): string {
  return planetId && isContractPlanetId(planetId) ? `${path}?planetId=${encodeURIComponent(planetId)}` : path;
}

function isContractPlanetId(planetId: string): boolean {
  return /^[1-9][0-9]*$/.test(planetId);
}

async function apiErrorMessage(response: Response, label: string): Promise<string> {
  const fallback = `${label} API failed: ${response.status}`;
  try {
    const body = await response.clone().json() as { error?: unknown };
    return typeof body.error === "string" && body.error.trim()
      ? `${fallback}: ${body.error}`
      : fallback;
  } catch {
    return fallback;
  }
}
