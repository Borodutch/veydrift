import { sdk } from "@farcaster/miniapp-sdk";
import type { PlanetType } from "./types";

export type Eip1193Provider = {
  request<T = unknown>(args: {
    method: string;
    params?: unknown[];
  }): Promise<T>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  providers?: Eip1193Provider[];
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
};

type WalletLockProbe = {
  _metamask?: {
    isUnlocked?: () => boolean | Promise<boolean>;
  };
};

export type InjectedWindow = {
  ethereum?: Eip1193Provider;
  okxwallet?: Eip1193Provider;
};

const WALLET_READ_TIMEOUT_MS = 10_000;
// Initial first-planet bootstrap reads use a shorter timeout so a stalled
// mobile wallet provider (e.g. Trust Wallet on Android intermittently not
// answering the first eth_accounts/eth_chainId) is detected and retried
// quickly instead of leaving the player on "Reading wallet link".
export const WALLET_BOOTSTRAP_READ_TIMEOUT_MS = 6_000;
const FARCASTER_WALLET_PROVIDER_TIMEOUT_MS = 1_200;
const WALLET_API_READ_TIMEOUT_MS = 10_000;
export const WALLET_LOCKED_MESSAGE = "Wallet is locked. Please unlock your wallet and try again.";
export const WALLET_ACCOUNT_UNAVAILABLE_MESSAGE = "Wallet account is unavailable. Reconnect your wallet, then retry.";
export const WALLET_CONNECTION_REJECTED_MESSAGE = "Wallet connection was rejected. Reconnect your wallet, then retry.";
export const WALLET_ACCOUNT_MISMATCH_MESSAGE = "The selected wallet account changed. Reconnect the active wallet, then retry.";

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

export type SettlementTransactionOptions = {
  startPriceWei?: bigint | null;
};

type TransactionRequest = {
  from: string;
  to: string;
  data: string;
  value?: string;
};

type TransactionReceipt = {
  status?: string | number | bigint | null;
  transactionHash?: string;
};

export const TRANSACTION_REVERTED_MESSAGE = "Transaction reverted on-chain. No game state was changed.";
export const TRANSACTION_RECEIPT_TIMEOUT_MESSAGE = "Transaction submitted, but the chain did not confirm it yet. Check the transaction status before retrying.";
const TRANSACTION_RECEIPT_TIMEOUT_MS = 120_000;
const TRANSACTION_RECEIPT_POLL_MS = 1_500;

export type OnChainResources = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export type OnChainEnergyBalance = {
  produced: string;
  required: string;
  scaleBps: string;
  sources?: {
    solarPlant: string;
    fusionReactor: string;
    fusionReactorDeuteriumConsumed: string;
    solarSatellites: string;
    solarSatelliteCount: number;
    solarSatelliteEnergy: string;
  };
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

export type PlayerProfile = {
  wallet: string;
  displayName: string | null;
  fallbackName: string;
  updatedAt: string | null;
};

export type WalletSettlementResponse = {
  wallet: string;
  hasFirstPlanet: boolean;
  homePlanetId: string | null;
  indexer?: {
    indexedState?: "healthy" | "reconciling" | "stale";
    safeToServeIndexedState?: boolean;
    staleReason?: string | null;
  };
  player?: PlayerProfile | undefined;
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
  source?: "contract-state-indexer" | string;
  stale?: boolean;
};

export type BackendIndexerState = NonNullable<WalletSettlementResponse["indexer"]>;

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
  tactical?: {
    raidableResources: OnChainResources;
    raidableResourceTotal: string;
    ships: {
      count: number;
      power: string;
    };
    defenses: {
      count: number;
      power: string;
    };
    combatPower: string;
  } | undefined;
};

export type WalletPlanetsResponse = {
  wallet: string;
  homePlanetId: string | null;
  player?: PlayerProfile | undefined;
  queues?: {
    research: QueueStateResponse | null;
  } | undefined;
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
  backlog?: QueueStateResponse[];
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
  originPlanet?: FleetMissionPlanetReference | null;
  targetPlanet?: FleetMissionPlanetReference | null;
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

export type FleetMissionPlanetReference = {
  planetId: string;
  owner: string;
  ownerDisplayName?: string | null;
  name: string | null;
  galaxy: number;
  system: number;
  position: number;
  coordinates: string;
};

export type FleetMissionVisibilityResponse = {
  wallet: string;
  homePlanetId: string | null;
  incoming: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
  completedMissions: FleetMissionSummary[];
  battleReports: BattleReport[];
};

export type FleetMissionArchiveEntry =
  | { kind: "mission"; mission: FleetMissionSummary }
  | { kind: "battleReport"; report: BattleReport };

export type FleetMissionArchiveResponse = {
  wallet: string;
  homePlanetId: string | null;
  rows: FleetMissionArchiveEntry[];
  pagination: {
    page: number;
    pageSize: number;
    totalEntries: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

export type MissionDetailResponse = {
  mission: FleetMissionSummary;
  battleReport: BattleReport | null;
  source?: string;
};

export type BattleOutcomeName = "Draw" | "AttackerWin" | "DefenderWin";

export type CombatRoundReport = {
  round: number;
  attackerUnits: string;
  defenderUnits: string;
  attackerLosses: OnChainResources;
  defenderLosses: OnChainResources;
};

export type BattleReport = {
  missionId: string;
  attacker: string;
  targetPlanetId: string;
  outcome: BattleOutcomeName;
  rounds: number;
  randomSeed: string;
  loot: OnChainResources;
  attackerLosses: OnChainResources;
  defenderLosses: OnChainResources;
  debris: {
    metal: string;
    crystal: string;
  };
  roundReports: CombatRoundReport[];
  transactionHash: string;
  blockNumber: string;
};

export type ChainShipyardState = {
  wallet: string;
  homePlanetId: string | null;
  planetId?: string | null;
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
    energyPerUnit?: string;
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
  naniteLevel: number;
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
  indexer?: BackendIndexerState;
  planetId?: string | null;
  planetLastSettledAt?: string | null;
  source?: "contract-state-indexer" | string;
  degraded?: boolean;
  stale?: boolean;
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
  indexer?: BackendIndexerState | null;
  source?: "contract-state-indexer" | string;
  stale?: boolean;
  detail?: string;
  indexedNotReady?: boolean;
  indexedNotReadyAt?: string;
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
  buildings: Array<{
    id: number;
    key: "lunarBase" | "jumpGate";
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
  researchNetworkLabLevels: number[];
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
  dismissJoinRequestAvailable?: boolean;
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
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
    totalMemberScore?: string;
  } | null;
  directory: Array<{
    allianceId: string;
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: string;
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
    totalMemberScore?: string;
    members?: Array<{
      address: string;
      displayName?: string | null;
      role: AllianceRole;
      joinedAt: string;
      totalScore?: string;
    }>;
  }>;
  pendingInvites: Array<{
    allianceId: string;
    inviter: string;
    inviterDisplayName?: string | null;
    invitedAt: string;
  }>;
  pendingJoinRequests: Array<{
    allianceId: string;
    requester: string;
    requesterDisplayName?: string | null;
    requestedAt: string;
  }>;
  allianceJoinRequests: Array<{
    allianceId: string;
    requester: string;
    requesterDisplayName?: string | null;
    requesterMembership?: {
      allianceId: string;
      role: AllianceRole;
      joinedAt: string;
    };
    requestedAt: string;
  }>;
  members: Array<{
    address: string;
    displayName?: string | null;
    role: AllianceRole;
    joinedAt: string;
    totalScore?: string;
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
  alliance?: {
    allianceId: string;
    tag: string;
    name: string;
  } | null;
  attackProtection?: {
    allowed: boolean;
    blockedReason: "none" | "bashing_limit" | "score_protection" | "same_alliance";
    blockedReasonLabel: string | null;
  } | null;
  displayName?: string | null;
  homePlanetId: string | null;
  homePlanet: HighscorePlanet | null;
  planets?: HighscorePlanet[];
  planetCount: number;
  score: Record<HighscoreCategory, string>;
};

export type HighscorePlanet = {
  planetId: string;
  name: string | null;
  coordinates: {
    galaxy: number;
    system: number;
    position: number;
  };
  archetype: PlanetType;
  tactical?: {
    raidableResources: OnChainResources;
    raidableResourceTotal: string;
    ships: {
      count: number;
      power: string;
    };
    defenses: {
      count: number;
      power: string;
    };
    combatPower: string;
  };
};

export type HighscoreResponse = {
  generatedAt: string;
  durationMs?: number;
  formula: {
    pointsDivisor: string;
    summary: string;
    target?: string;
    excludedCategories?: string[];
  };
  pagination?: {
    page: number;
    pageSize: number;
    totalEntries: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  currentPlayer?: {
    wallet: string;
    rankings: Record<HighscoreCategory, { rank: number; page: number } | null>;
  };
  rankings: Record<HighscoreCategory, HighscoreEntry[]>;
};

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
const BASE_MAINNET_CHAIN_ID_HEX = "0x2105";

const SETTLE_FIRST_PLANET_SELECTOR = "0x59268393";
const START_PLANET_SELECTOR = "0xf45f1f18";
const GAME_SELECTORS = {
  abandonPlanet: "0xfa16dddc",
  completeFleetMissionReturn: "0xc2472852",
  createColony: "0x71358ab8",
  depositResource: "0x25819e15",
  finishDefenseProduction: "0xa5a0d597",
  finishBuildingUpgrade: "0x6ab2f9d4",
  finishResourceWithdrawal: "0xde0f208c",
  joinAttackMission: "0x28260eb6",
  launchInterplanetaryMissileAttack: "0xa72cd29a",
  launchFleetMission: "0x60eac16f",
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
const COLONIZATION_COORDINATE_FLAG = 1n << 255n;
const COLONIZE_MISSION_TYPE = 2;
const MOON_SELECTORS = {
  finishMoonBuildingUpgrade: "0x713b9e66",
  jumpGateJump: "0x36aaf8f8",
  jumpGateJumpShips: "0x3095d992",
  startMoonBuildingUpgrade: "0x715e1b1a"
} as const;
const ALLIANCE_SELECTORS = {
  createAlliance: "0x944cde0e",
  updateAllianceProfile: "0x3fd0e7a5",
  inviteMember: "0x9e6d6830",
  acceptInvite: "0xbf8e9176",
  requestJoinAlliance: "0xbc46277a",
  cancelJoinRequest: "0xc5c4bdcc",
  dismissJoinRequest: "0xcd844a18",
  approveJoinRequest: "0x8ff388c7",
  kickMember: "0xbd0e667c",
  leaveAlliance: "0xdabd761d",
  setMemberRole: "0xbfbb73f1"
} as const;
const ERC20_SELECTORS = {
  approve: "0x095ea7b3"
} as const;
const REJECTED_CODES = new Set([4001, "4001", "ACTION_REJECTED", "USER_REJECTED"]);

export type FarcasterWalletClient = {
  wallet?: {
    ethProvider?: Eip1193Provider | undefined;
    getEthereumProvider?: () => Promise<Eip1193Provider | undefined> | Eip1193Provider | undefined;
  };
};

export type AvailableWalletProvider = {
  provider: Eip1193Provider;
  source: "injected" | "farcaster";
};

export type AvailableWalletProviderOptions = {
  preferFarcasterProvider?: boolean;
};

export function getInjectedProvider(
  globalWindow: InjectedWindow | undefined,
): Eip1193Provider | undefined {
  const ethereum = globalWindow?.ethereum;
  const injectedProviders = ethereum?.providers?.filter(isEip1193Provider) ?? [];
  const preferredProvider = injectedProviders.find((provider) => provider.isRabby)
    ?? injectedProviders.find((provider) => provider.isOkxWallet || provider.isOKExWallet)
    ?? (isEip1193Provider(globalWindow?.okxwallet) ? globalWindow.okxwallet : undefined);

  return preferredProvider ?? ethereum;
}

export async function getAvailableWalletProviderDetails(
  globalWindow: InjectedWindow | undefined,
  farcasterClient: FarcasterWalletClient = sdk as unknown as FarcasterWalletClient,
  options: AvailableWalletProviderOptions = {},
): Promise<AvailableWalletProvider | undefined> {
  const injected = getInjectedProvider(globalWindow);
  if (injected && !options.preferFarcasterProvider) {
    return {
      provider: injected,
      source: "injected",
    };
  }

  const farcasterProvider = await getFarcasterEthereumProvider(farcasterClient);
  return farcasterProvider
    ? {
      provider: farcasterProvider,
      source: "farcaster",
    }
    : injected
      ? {
        provider: injected,
        source: "injected",
      }
      : undefined;
}

export async function getAvailableWalletProvider(
  globalWindow: InjectedWindow | undefined,
  farcasterClient: FarcasterWalletClient = sdk as unknown as FarcasterWalletClient,
  options: AvailableWalletProviderOptions = {},
): Promise<Eip1193Provider | undefined> {
  return (await getAvailableWalletProviderDetails(globalWindow, farcasterClient, options))?.provider;
}

async function getFarcasterEthereumProvider(
  farcasterClient: FarcasterWalletClient,
): Promise<Eip1193Provider | undefined> {
  try {
    const providerRequest = farcasterClient.wallet?.getEthereumProvider?.();
    const provider = providerRequest
      ? await timeoutPromise(Promise.resolve(providerRequest), FARCASTER_WALLET_PROVIDER_TIMEOUT_MS, "Farcaster wallet provider")
      : undefined;
    if (isEip1193Provider(provider)) {
      return provider;
    }
  } catch {
    // Fall through to the legacy SDK provider below.
  }

  const legacyProvider = farcasterClient.wallet?.ethProvider;
  return isEip1193Provider(legacyProvider) ? legacyProvider : undefined;
}

function isEip1193Provider(provider: unknown): provider is Eip1193Provider {
  return Boolean(provider && typeof provider === "object" && typeof (provider as Eip1193Provider).request === "function");
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
  const missionReason = fleetMissionRevertReason(error);

  if (missionReason) {
    return missionReason;
  }

  if (/wallet is locked|metamask is locked|unlock metamask|unlock your wallet/i.test(message)) {
    return WALLET_LOCKED_MESSAGE;
  }

  if (/timed out reading .* from the wallet/i.test(message)) {
    return `${message} Unlock or reconnect your wallet, then retry.`;
  }

  if (/timed out reading .* from the game api/i.test(message)) {
    return `${message} The game API may be temporarily unavailable; the app will retry with backend state.`;
  }

  if (code === -32603 || code === "-32603" || /internal json-rpc error/i.test(message)) {
    return "The wallet could not read the current game contract state. Retry in a moment while the app checks whether the game API or RPC recovered.";
  }

  if (/execution reverted/i.test(message)) {
    return "The game contract rejected this transaction, but the wallet did not provide a specific reason. Refresh game state and retry, or choose a different action if the state changed.";
  }

  return message;
}

const COLONY_SHIP_ID = 3n;

type FleetMissionRevertContext = {
  missionType?: number | string | bigint | undefined;
};

const contractRevertReasons: Record<string, string> = {
  "0x2ab0f96f": "The origin planet does not have enough resources or deuterium fuel for this mission. Refresh backend resources and queues before retrying; the indexed spendable balance may still be catching up with earlier queued spending.",
  "0xd7c35576": "The selected ships do not have enough cargo capacity for this mission. Add cargo-capable ships, reduce cargo, slow the mission, or choose a closer target.",
  "0x57aab7e3": "All fleet slots are already in use. Wait for a fleet to return, then retry.",
  "0x400d5197": "You cannot attack your own planet.",
  "0xbb3f9d15": "Choose a target planet that is different from the origin planet.",
  "0x9a3d4eb9": "The selected target planet no longer exists. Refresh galaxy state and choose a target again.",
  "0xab2bcfd3": "This wallet does not own the selected origin planet. Refresh planets and retry.",
  "0x524f409b": "Select at least one valid ship for this mission.",
  "0x13b7fff2": "This position is already occupied. Refresh Galaxy state and choose an empty slot.",
  "0x179a0545": "Choose a valid colonization slot within galaxy 1-9, system 1-499, position 1-15.",
  "0x791438b6": "Your colony limit has been reached. Research Astrophysics or abandon a colony before colonizing another planet.",
  "0x65dba1c3": "This target has reached the attack bashing limit. Choose another target or retry later.",
  "0x3570048f": "This target is protected by score rules and cannot be attacked.",
  "0x1fbd4a7a": "You cannot attack a planet owned by your alliance.",
  "0xa3ab075a": "The selected debris field is empty. Refresh galaxy state and retry.",
  "0x84c69485": "This mission type is not supported for the selected fleet action.",
  "0xbacdb922": "The target attack is already too close to arrival for this fleet action.",
  "0xb3439205": "A fleet mission involving this planet still needs resolution. Resolve it before launching another mission.",
  "0x1c31409a": "This fleet mission is no longer active. Refresh mission control and retry.",
  "0x828c1183": "This wallet does not own the selected fleet mission. Refresh mission control and retry.",
  "0xa8d5807a": "This fleet has not arrived yet. Wait for arrival or refresh mission control before retrying.",
  "0x77c3008c": "This fleet mission is already returning. Refresh mission control before retrying.",
  "0xb85299a2": "This fleet action is too late because the target mission has already arrived or cannot be joined in time.",
  "0xbee20108": "The recall cutoff has passed for this mission. Wait for arrival and resolve it instead.",
  "0x4ba3e176": "You cannot join an attack against your own planet.",
  "0xdfa1a408": "The selected mission or target no longer matches current chain state. Refresh mission control and retry.",
  "0x1f38cd02": "Attack battle randomness is not configured for this deployment yet.",
};

const fleetMissionTransactionSelectors = new Set<string>([
  GAME_SELECTORS.completeFleetMissionReturn,
  GAME_SELECTORS.joinAttackMission,
  GAME_SELECTORS.launchFleetMission,
  GAME_SELECTORS.recallFleetMission,
  GAME_SELECTORS.resolveFleetMission,
]);

function isColonizeMissionContext(context: FleetMissionRevertContext | undefined): boolean {
  if (context?.missionType === undefined) {
    return false;
  }

  try {
    return BigInt(context.missionType) === BigInt(COLONIZE_MISSION_TYPE);
  } catch {
    return false;
  }
}

function revertSelector(error: unknown): string | undefined {
  const data = errorData(error);
  return typeof data === "string" && /^0x[a-fA-F0-9]{8}/.test(data)
    ? data.slice(0, 10).toLowerCase()
    : undefined;
}

function revertUintArg(error: unknown, index: number): bigint | undefined {
  const data = errorData(error);
  if (typeof data !== "string") return undefined;
  const wordStart = 10 + index * 64;
  const word = data.slice(wordStart, wordStart + 64);
  if (!/^[a-fA-F0-9]{64}$/.test(word)) return undefined;
  return BigInt(`0x${word}`);
}

function contractRevertReason(error: unknown, context?: FleetMissionRevertContext): string | undefined {
  const selector = revertSelector(error);
  if (selector === "0x705f508b") {
    return revertUintArg(error, 0) === COLONY_SHIP_ID || isColonizeMissionContext(context)
      ? "Build or keep a Colony Ship on the origin planet before colonizing."
      : "Selected origin planet does not have the requested ships. Refresh shipyard state and retry.";
  }

  if (selector === "0x524f409b" && isColonizeMissionContext(context)) {
    return "Include exactly one Colony Ship for colonization.";
  }

  return contractRevertReasons[selector ?? ""];
}

function fleetMissionRevertReason(error: unknown, context?: FleetMissionRevertContext): string | undefined {
  const message = errorMessage(error);
  if (/INVALID_MISSION_SPEED/i.test(message)) {
    return "Choose a valid mission speed between 10% and 100%.";
  }

  const data = errorData(error);
  const decodedMessage = typeof data === "string" ? decodeStandardRevertReason(data) : undefined;
  if (decodedMessage) {
    if (/INVALID_MISSION_SPEED/i.test(decodedMessage)) {
      return "Choose a valid mission speed between 10% and 100%.";
    }
    return `Game contract rejected this fleet action: ${decodedMessage}.`;
  }

  return contractRevertReason(error, context);
}

function isFleetMissionPreflightRevert(error: unknown): boolean {
  // A real contract revert carries revert data (a 4-byte selector), the EVM
  // revert code 3, or an "execution reverted" message. Anything else (internal
  // JSON-RPC errors, RPC/node unavailability, read timeouts) means the
  // simulation could not run, not that the mission is invalid.
  if (revertSelector(error) !== undefined) {
    return true;
  }
  if (errorCode(error) === 3 || errorCode(error) === "3") {
    return true;
  }
  return /execution reverted/i.test(errorMessage(error));
}

async function assertFleetMissionCallSucceeds(
  provider: Eip1193Provider,
  from: string,
  to: string,
  data: string,
  context?: FleetMissionRevertContext,
): Promise<void> {
  try {
    await provider.request({
      method: "eth_call",
      params: [{ from, to, data }, "latest"],
    });
  } catch (error) {
    const reason = fleetMissionRevertReason(error, context);
    if (reason) {
      throw new Error(reason);
    }
    if (isFleetMissionPreflightRevert(error)) {
      throw new Error(walletRequestErrorMessage(error));
    }
    // The preflight simulation could not reach the game contract (RPC/node
    // unavailable, internal JSON-RPC error, or a read timeout). This is a
    // best-effort guard, not a validity gate — don't block the mission. Let
    // the wallet submit the transaction and re-simulate it on send.
  }
}

export async function assertWalletUnlocked(provider: Eip1193Provider): Promise<void> {
  const lockProbe = (provider as Eip1193Provider & WalletLockProbe)._metamask;

  if (typeof lockProbe?.isUnlocked === "function") {
    try {
      const unlocked = await lockProbe.isUnlocked();
      if (!unlocked) {
        throw new Error(WALLET_LOCKED_MESSAGE);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message === WALLET_LOCKED_MESSAGE) {
        throw error;
      }
    }
  }

  if (!lockProbe && !isAccountProbeWallet(provider)) {
    return;
  }

  let accounts: string[];
  try {
    accounts = await readWalletRequest<string[]>(provider, {
      method: "eth_accounts",
    }, "wallet accounts");
  } catch {
    return;
  }

  if (accounts.length === 0) {
    throw new Error(WALLET_LOCKED_MESSAGE);
  }
}

async function assertAccountProbeWalletReady(provider: Eip1193Provider, account: string): Promise<void> {
  if (!isAccountProbeWallet(provider)) {
    return;
  }

  let accounts: string[];
  try {
    accounts = await readWalletRequest<string[]>(provider, {
      method: "eth_accounts",
    }, "wallet accounts");
  } catch {
    return;
  }

  if (accountListIncludes(accounts, account)) {
    return;
  }

  if (accounts.length > 0) {
    throw new Error(WALLET_ACCOUNT_MISMATCH_MESSAGE);
  }

  let requestedAccounts: string[];
  try {
    requestedAccounts = await readWalletRequest<string[]>(provider, {
      method: "eth_requestAccounts",
    }, "wallet account authorization");
  } catch (error) {
    if (isUserRejected(error)) {
      throw new Error(WALLET_CONNECTION_REJECTED_MESSAGE);
    }
    const code = errorCode(error);
    if (code === 4100 || code === "4100") {
      throw new Error(WALLET_ACCOUNT_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }

  if (accountListIncludes(requestedAccounts, account)) {
    return;
  }

  throw new Error(requestedAccounts.length > 0 ? WALLET_ACCOUNT_MISMATCH_MESSAGE : WALLET_ACCOUNT_UNAVAILABLE_MESSAGE);
}

function accountListIncludes(accounts: string[], account: string): boolean {
  return accounts.some((candidate) => candidate.toLowerCase() === account.toLowerCase());
}

async function prepareAccountProbeWalletForTransaction(provider: Eip1193Provider, account: string): Promise<boolean> {
  if (!isAccountProbeWallet(provider)) {
    return false;
  }

  await assertAccountProbeWalletReady(provider, account);
  return true;
}

async function sendWalletTransaction(
  provider: Eip1193Provider,
  account: string,
  transaction: TransactionRequest,
  options: { accountProbeReadyChecked?: boolean } = {},
): Promise<string> {
  if (!options.accountProbeReadyChecked) {
    await prepareAccountProbeWalletForTransaction(provider, account);
  }

  try {
    return await provider.request<string>({
      method: "eth_sendTransaction",
      params: [transaction]
    });
  } catch (error) {
    if (isFleetMissionTransactionData(transaction.data)) {
      const reason = fleetMissionRevertReason(error);
      if (reason) {
        throw new Error(reason);
      }
    }

    throw error;
  }
}

function isFleetMissionTransactionData(data: string): boolean {
  return fleetMissionTransactionSelectors.has(data.slice(0, 10).toLowerCase());
}

function isAccountProbeWallet(provider: Eip1193Provider): boolean {
  return Boolean(provider.isRabby || provider.isOkxWallet || provider.isOKExWallet);
}

export function isBaseSepoliaChain(chainId: string | number | bigint): boolean {
  if (typeof chainId === "string") {
    const normalized = chainId.trim().toLowerCase();
    if (normalized === BASE_SEPOLIA.chainIdHex) {
      return true;
    }

    const decimalChainId = Number(normalized);
    return Number.isFinite(decimalChainId) && decimalChainId === BASE_SEPOLIA.chainId;
  }

  return Number(chainId) === BASE_SEPOLIA.chainId;
}

export function miniAppUnsupportedChainMessage(chainId: string): string {
  const normalized = chainId.toLowerCase();
  const currentChain = normalized === BASE_MAINNET_CHAIN_ID_HEX
    ? `Base mainnet (${BASE_MAINNET_CHAIN_ID_HEX})`
    : `chain ${chainId}`;

  return `${currentChain} is active in this Farcaster client, but test.veydrift.com requires Base Sepolia (${BASE_SEPOLIA.chainIdHex}). Veydrift can ask the Farcaster wallet to switch or add Base Sepolia; if the host rejects that request, use a Farcaster client with Base Sepolia support or open the desktop browser wallet flow.`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const playerDisplayNameMaxLength = 32;

export function playerDisplayNameMessage(wallet: string, displayName: string): string {
  return [
    "Veydrift player display name",
    `Wallet: ${wallet.toLowerCase()}`,
    `Display name: ${displayName}`,
    "Only sign this message if you want this public name shown in Veydrift."
  ].join("\n");
}

export function validatePlayerDisplayName(value: string): string | undefined {
  const displayName = value.trim().replace(/ {2,}/g, " ");
  if (!displayName) return "Enter a display name.";
  if (Array.from(displayName).length > playerDisplayNameMaxLength) {
    return `Display names can be at most ${playerDisplayNameMaxLength} characters.`;
  }
  if (/[\p{Cc}\p{Cf}]/u.test(displayName)) {
    return "Display names cannot include control or formatting characters.";
  }
  return undefined;
}

export function playerDisplayLabel(profile: PlayerProfile | null | undefined, wallet: string | null | undefined): string {
  return profile?.displayName ?? profile?.fallbackName ?? (wallet ? shortAddress(wallet) : "Unnamed player");
}

export function mergePlayerProfile(
  current: PlayerProfile | undefined,
  next: PlayerProfile | undefined
): PlayerProfile | undefined {
  if (!next) return current;
  if (!current?.displayName) return next;
  if (current.wallet.toLowerCase() !== next.wallet.toLowerCase()) return next;
  if (next.displayName?.trim()) return next;

  return {
    ...next,
    displayName: current.displayName,
    updatedAt: current.updatedAt ?? next.updatedAt,
  };
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
  speedPercent = 100,
  randomnessRequestId = 0,
}: {
  originPlanetId: bigint | number | string;
  targetPlanetId: bigint | number | string;
  missionType: number;
  ships: MissionShips;
  cargo?: Partial<Pick<OnChainResources, "metal" | "crystal" | "deuterium">> | undefined;
  speedPercent?: number | undefined;
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
    speedPercent,
    randomnessRequestId,
  ]);
}

export function encodeColonizationTargetId(galaxy: number, system: number, position: number): string {
  if (!Number.isInteger(galaxy) || galaxy < 1 || galaxy > 9) {
    throw new Error("Enter a valid galaxy.");
  }
  if (!Number.isInteger(system) || system < 1 || system > 499) {
    throw new Error("Enter a valid system.");
  }
  if (!Number.isInteger(position) || position < 1 || position > 15) {
    throw new Error("Enter a valid position.");
  }

  return (COLONIZATION_COORDINATE_FLAG
    | (BigInt(galaxy) << 24n)
    | (BigInt(system) << 8n)
    | BigInt(position)).toString();
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

export async function getCurrentAccounts(provider: Eip1193Provider, timeoutMs?: number): Promise<string[]> {
  return readWalletRequest<string[]>(provider, {
    method: "eth_accounts"
  }, "wallet accounts", timeoutMs);
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = await readWalletRequest<string[]>(provider, {
    method: "eth_requestAccounts"
  }, "wallet account authorization");
  if (!accounts[0]) {
    throw new Error(WALLET_ACCOUNT_UNAVAILABLE_MESSAGE);
  }

  return accounts;
}

export async function getChainId(provider: Eip1193Provider, timeoutMs?: number): Promise<string> {
  return readWalletRequest<string>(provider, {
    method: "eth_chainId"
  }, "wallet network", timeoutMs);
}

export async function ensureBaseSepoliaNetwork(provider: Eip1193Provider): Promise<void> {
  try {
    await switchToBaseSepolia(provider);
  } catch (error) {
    if (!isUnknownChainError(error)) {
      throw error;
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          BASE_SEPOLIA
        ]
      });
    } catch (addError) {
      if (!isAlreadyAddedChainError(addError)) {
        throw addError;
      }
    }
    await switchToBaseSepolia(provider);
  }
}

function switchToBaseSepolia(provider: Eip1193Provider): Promise<unknown> {
  return provider.request({
    method: "wallet_switchEthereumChain",
    params: [
      {
        chainId: BASE_SEPOLIA.chainIdHex
      }
    ]
  });
}

function isUnknownChainError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 4902 || candidate.code === "4902") {
    return true;
  }

  return typeof candidate.message === "string"
    && /unknown chain|unrecognized chain|chain .*not (?:been )?added|wallet_addEthereumChain/i.test(candidate.message);
}

function isAlreadyAddedChainError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { message?: unknown };
  return typeof candidate.message === "string"
    && /already (?:been )?(?:added|exists)|chain .*already/i.test(candidate.message);
}

export async function sendSettlementTransaction(
  provider: Eip1193Provider,
  account: string,
  config: SettlementConfig,
  options: SettlementTransactionOptions = {}
): Promise<string> {
  if (!settlementContractConfigured(config)) {
    throw new Error("Settlement contract address is not configured.");
  }

  if (options.startPriceWei === undefined) {
    throw new Error("Settlement funding information is required before sending a settlement transaction.");
  }

  if (options.startPriceWei !== null) {
    if (config.resourceTokensConfigured === false) {
      throw new Error("Resource token reserves are not configured for this game deployment yet.");
    }

    return sendWalletTransaction(provider, account, {
      from: account,
      to: config.address,
      data: START_PLANET_SELECTOR,
      value: encodeQuantity(options.startPriceWei)
    });
  }

  return sendWalletTransaction(provider, account, {
    from: account,
    to: config.address,
    data: settlementTransactionData()
  });
}

export async function sendStartShipProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  shipId: number,
  quantity: number
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.startShipProduction, [planetId, shipId, quantity])
  });
}

export async function sendApproveResourceTokenTransaction(
  provider: Eip1193Provider,
  account: string,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint | number | string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: tokenAddress,
    data: encodeAddressUintCall(ERC20_SELECTORS.approve, spenderAddress, amount)
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.depositResource, [planetId, resourceId, amount])
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.requestResourceWithdrawal, [planetId, resourceId, amount])
  });
}

export async function sendFinishResourceWithdrawalTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  resourceId: number
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.finishResourceWithdrawal, [resourceId])
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.startDefenseProduction, [planetId, defenseId, quantity])
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeStringTripleCall(ALLIANCE_SELECTORS.createAlliance, [tag, name, description])
  });
}

export async function sendAllianceInviteTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: `${ALLIANCE_SELECTORS.inviteMember}${BigInt(allianceId).toString(16).padStart(64, "0")}${playerAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintStringTripleCall(ALLIANCE_SELECTORS.updateAllianceProfile, allianceId, [tag, name, description])
  });
}

export async function sendAcceptAllianceInviteTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintCall(ALLIANCE_SELECTORS.acceptInvite, allianceId)
  });
}

export async function sendAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintCall(ALLIANCE_SELECTORS.requestJoinAlliance, allianceId)
  });
}

export async function sendCancelAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintCall(ALLIANCE_SELECTORS.cancelJoinRequest, allianceId)
  });
}

export async function sendApproveAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintAddressCall(ALLIANCE_SELECTORS.approveJoinRequest, allianceId, playerAddress)
  });
}

export async function sendDismissAllianceJoinRequestTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintAddressCall(ALLIANCE_SELECTORS.dismissJoinRequest, allianceId, playerAddress)
  });
}

export async function sendAllianceKickTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  allianceId: string,
  playerAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintAddressCall(ALLIANCE_SELECTORS.kickMember, allianceId, playerAddress)
  });
}

export async function sendAllianceLeaveTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: ALLIANCE_SELECTORS.leaveAlliance
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
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeUintAddressUintCall(ALLIANCE_SELECTORS.setMemberRole, allianceId, playerAddress, role === "officer" ? 2 : 1)
  });
}

export async function sendStartBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  buildingId: number
): Promise<string> {
  const data = encodeGameCall(GAME_SELECTORS.startBuildingUpgrade, [planetId, buildingId]);
  const transaction: TransactionRequest = {
    from: account,
    to: contractAddress,
    data
  };

  const accountProbeReadyChecked = await prepareAccountProbeWalletForTransaction(provider, account);
  if (!accountProbeReadyChecked) await assertWalletUnlocked(provider);

  return sendWalletTransaction(provider, account, transaction, {
    accountProbeReadyChecked
  });
}

export async function sendRenamePlanetTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  name: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodePlanetNameCall(GAME_SELECTORS.renamePlanet, planetId, name)
  });
}

export async function sendAbandonPlanetTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.abandonPlanet, [planetId])
  });
}

export async function sendStartResearchTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  technologyId: number
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.startResearch, [planetId, technologyId])
  });
}

export async function sendFinishBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  const data = encodeGameCall(GAME_SELECTORS.finishBuildingUpgrade, [planetId]);
  const transaction: TransactionRequest = {
    from: account,
    to: contractAddress,
    data
  };

  const accountProbeReadyChecked = await prepareAccountProbeWalletForTransaction(provider, account);
  if (!accountProbeReadyChecked) {
    await assertWalletUnlocked(provider);
  }

  return sendWalletTransaction(provider, account, transaction, {
    accountProbeReadyChecked
  });
}

export async function sendStartMoonBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string,
  buildingId: number
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(MOON_SELECTORS.startMoonBuildingUpgrade, [planetId, buildingId])
  });
}

export async function sendFinishMoonBuildingUpgradeTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(MOON_SELECTORS.finishMoonBuildingUpgrade, [planetId])
  });
}

export async function sendJumpGateJumpTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  originMoonPlanetId: string,
  destinationMoonPlanetId: string,
  ships?: MissionShips
): Promise<string> {
  const selector = ships ? MOON_SELECTORS.jumpGateJumpShips : MOON_SELECTORS.jumpGateJump;
  const args = ships
    ? [
      originMoonPlanetId,
      destinationMoonPlanetId,
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
    ]
    : [originMoonPlanetId, destinationMoonPlanetId];
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(selector, args)
  });
}

export async function sendFinishResearchTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: GAME_SELECTORS.finishResearch
  });
}

export async function sendFinishShipProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.finishShipProduction, [planetId])
  });
}

export async function sendFinishDefenseProductionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  planetId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.finishDefenseProduction, [planetId])
  });
}

export async function sendLaunchFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeLaunchFleetMissionCall>[0]
): Promise<string> {
  const data = encodeLaunchFleetMissionCall(params);
  await assertFleetMissionCallSucceeds(provider, account, contractAddress, data, params);

  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data
  });
}

export async function sendJoinAttackMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeJoinAttackMissionCall>[0]
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeJoinAttackMissionCall(params)
  });
}

export async function sendLaunchInterplanetaryMissileAttackTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  params: Parameters<typeof encodeLaunchInterplanetaryMissileAttackCall>[0]
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeLaunchInterplanetaryMissileAttackCall(params)
  });
}

export async function sendRecallFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.recallFleetMission, [missionId])
  });
}

export async function sendResolveFleetMissionTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.resolveFleetMission, [missionId])
  });
}

export async function sendCompleteFleetMissionReturnTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  missionId: string
): Promise<string> {
  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data: encodeGameCall(GAME_SELECTORS.completeFleetMissionReturn, [missionId])
  });
}

export async function sendCreateColonyTransaction(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  originPlanetId: string,
  galaxy: number,
  system: number,
  position: number,
  speedPercent = 100
): Promise<string> {
  const params: Parameters<typeof encodeLaunchFleetMissionCall>[0] = {
    originPlanetId,
    targetPlanetId: encodeColonizationTargetId(galaxy, system, position),
    missionType: COLONIZE_MISSION_TYPE,
    ships: {
      smallCargo: 0,
      lightFighter: 0,
      recycler: 0,
      colonyShip: 1,
      largeCargo: 0,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      bomber: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
    },
    speedPercent,
  };
  const data = encodeLaunchFleetMissionCall(params);
  await assertFleetMissionCallSucceeds(provider, account, contractAddress, data, params);

  return sendWalletTransaction(provider, account, {
    from: account,
    to: contractAddress,
    data,
  });
}

export function planetFromTransaction(account: string, txHash: string): PlanetSummary {
  return {
    label: `Settled by ${shortAddress(account)}`,
    txHash,
    source: "transaction"
  };
}

async function readWalletRequest<T>(
  provider: Eip1193Provider,
  args: { method: string; params?: unknown[] },
  label: string,
  timeoutMs: number = WALLET_READ_TIMEOUT_MS
): Promise<T> {
  return timeoutPromise(provider.request<T>(args), timeoutMs, label);
}

async function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out reading ${label} from the wallet after ${Math.round(timeoutMs / 1_000)} seconds.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code: unknown }).code
    : undefined;
}

export function isTransientWalletBootstrapError(error: unknown): boolean {
  // User rejections and locked wallets are terminal: the player must act, so we
  // must not silently retry them.
  if (isUserRejected(error)) return false;
  const message = errorMessage(error);
  if (/wallet is locked|metamask is locked|unlock/i.test(message)) return false;

  const code = errorCode(error);
  if (code === -32603 || code === "-32603") return true;
  if (/internal json-rpc error/i.test(message)) return true;
  // Timeout wrappers for wallet and game-API reads.
  if (/timed out reading .* from the (wallet|game api)/i.test(message)) return true;
  // Transient transport failures.
  if (/failed to fetch|network ?error|load failed/i.test(message)) return true;
  return false;
}

function errorData(error: unknown): unknown {
  return nestedErrorData(error, new Set());
}

function nestedErrorData(value: unknown, seen: Set<object>): string | undefined {
  const direct = revertDataFromString(value);
  if (direct) return direct;

  if (typeof value !== "object" || value === null || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ["data", "error", "originalError", "cause", "message"]) {
    if (key in record) {
      const nested = nestedErrorData(record[key], seen);
      if (nested) return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = nestedErrorData(item, seen);
      if (nested) return nested;
    }
  }

  return undefined;
}

function revertDataFromString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();

  if (/^0x[a-fA-F0-9]{8}[a-fA-F0-9]*$/.test(trimmed)) {
    return trimmed;
  }

  if (/^[{[]/.test(trimmed)) {
    try {
      return nestedErrorData(JSON.parse(trimmed), new Set());
    } catch {
      return undefined;
    }
  }

  if (/revert/i.test(trimmed)) {
    const match = trimmed.match(/0x[a-fA-F0-9]{8}[a-fA-F0-9]*/);
    return match?.[0];
  }

  return undefined;
}

function decodeStandardRevertReason(data: string): string | undefined {
  const clean = data.replace(/^0x/, "");
  if (!clean.startsWith("08c379a0") || clean.length < 8 + 64 + 64) {
    return undefined;
  }

  try {
    const lengthOffset = 8 + 64;
    const byteLength = Number(BigInt(`0x${clean.slice(lengthOffset, lengthOffset + 64)}`));
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return undefined;
    const bodyOffset = lengthOffset + 64;
    const body = clean.slice(bodyOffset, bodyOffset + byteLength * 2);
    if (body.length !== byteLength * 2) return undefined;
    const bytes = new Uint8Array(body.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
    return new TextDecoder().decode(bytes).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function fetchWalletSettlement(apiUrl: string, wallet: string, options: WalletReadOptions = {}): Promise<WalletSettlementResponse> {
  return fetchWalletJson<WalletSettlementResponse>(apiUrl, wallet, withWalletReadOptions("settlement", undefined, options), "Settlement");
}

type SettlementFundingResponse = Omit<SettlementFundingState, "balanceWei" | "startPriceWei"> & {
  balanceWei: string | null;
  startPriceWei: string | null;
};

export async function fetchSettlementFundingState(apiUrl: string, wallet: string): Promise<SettlementFundingState> {
  const response = await fetchWalletJson<SettlementFundingResponse>(apiUrl, wallet, "settlement-funding", "Settlement funding");
  return {
    ...response,
    balanceWei: response.balanceWei === null ? null : BigInt(response.balanceWei),
    startPriceWei: response.startPriceWei === null ? null : BigInt(response.startPriceWei)
  };
}

export async function fetchWalletPlanets(apiUrl: string, wallet: string, options: WalletReadOptions = {}): Promise<WalletPlanetsResponse> {
  return fetchWalletJson<WalletPlanetsResponse>(apiUrl, wallet, withWalletReadOptions("planets", undefined, options), "Planets");
}

type WalletReadOptions = {
  source?: "indexed";
};

type FleetMissionVisibilityOptions = WalletReadOptions & {
  includeArchive?: boolean;
};

export async function fetchWalletQueues(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<PlayerQueuesResponse> {
  return fetchWalletJson<PlayerQueuesResponse>(apiUrl, wallet, withWalletReadOptions("queues", planetId, options), "Queues");
}

export async function fetchFleetMissionVisibility(apiUrl: string, wallet: string, options: FleetMissionVisibilityOptions = {}): Promise<FleetMissionVisibilityResponse> {
  const params = new URLSearchParams();
  if (options.includeArchive === false) params.set("archive", "none");
  return fetchWalletJson<FleetMissionVisibilityResponse>(
    apiUrl,
    wallet,
    withWalletReadOptions("fleet-visibility", undefined, options, params),
    "Fleet visibility"
  );
}

export async function fetchFleetMissionArchive(
  apiUrl: string,
  wallet: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<FleetMissionArchiveResponse> {
  const params = new URLSearchParams();
  params.set("status", "completed");
  params.set("page", String(options.page ?? 1));
  params.set("pageSize", String(options.pageSize ?? 25));
  return fetchWalletJson<FleetMissionArchiveResponse>(apiUrl, wallet, `missions?${params.toString()}`, "Mission archive");
}

export async function fetchMission(apiUrl: string, missionId: string): Promise<MissionDetailResponse> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/mission/${encodeURIComponent(missionId)}`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Mission"));
  return response.json() as Promise<MissionDetailResponse>;
}

export async function fetchBattleReport(apiUrl: string, missionId: string): Promise<BattleReport> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/battle-report/${encodeURIComponent(missionId)}`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Battle report"));
  return response.json() as Promise<BattleReport>;
}

export async function fetchBattleReports(apiUrl: string): Promise<BattleReport[]> {
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/battle-reports`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Battle reports"));
  return response.json() as Promise<BattleReport[]>;
}

export async function fetchInfrastructureState(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainInfrastructureState> {
  return fetchWalletJson<ChainInfrastructureState>(apiUrl, wallet, withWalletReadOptions("infrastructure", planetId, options), "Infrastructure");
}

export async function fetchMoonState(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainMoonState> {
  return fetchWalletJson<ChainMoonState>(apiUrl, wallet, withWalletReadOptions("moon", planetId, options), "Moon");
}

export async function fetchShipyardState(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainShipyardState> {
  return fetchWalletJson<ChainShipyardState>(apiUrl, wallet, withWalletReadOptions("shipyard", planetId, options), "Shipyard");
}

export async function fetchDefenseState(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainDefenseState> {
  return fetchWalletJson<ChainDefenseState>(apiUrl, wallet, withWalletReadOptions("defenses", planetId, options), "Defenses");
}

export async function fetchResearchState(apiUrl: string, wallet: string, planetId?: string, options: WalletReadOptions = {}): Promise<ChainResearchState> {
  return fetchWalletJson<ChainResearchState>(apiUrl, wallet, withWalletReadOptions("research", planetId, options), "Research");
}

export async function fetchRiftState(apiUrl: string, wallet: string, planetId?: string): Promise<ChainRiftState> {
  return fetchWalletJson<ChainRiftState>(apiUrl, wallet, withPlanetId("rift", planetId), "Rift");
}

export async function fetchAllianceState(apiUrl: string, wallet: string): Promise<ChainAllianceState> {
  return fetchWalletJson<ChainAllianceState>(apiUrl, wallet, "alliance", "Alliance");
}

export async function fetchPlayerProfile(apiUrl: string, wallet: string): Promise<PlayerProfile> {
  return fetchWalletJson<PlayerProfile>(apiUrl, wallet, "profile", "Player profile");
}

export async function updatePlayerDisplayName(
  apiUrl: string,
  provider: Eip1193Provider,
  account: string,
  displayName: string
): Promise<PlayerProfile> {
  const message = playerDisplayNameMessage(account, displayName);
  const signature = await provider.request<string>({
    method: "personal_sign",
    params: [message, account]
  });
  const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/wallet/${encodeURIComponent(account)}/profile/display-name`, {
    body: JSON.stringify({ displayName, signature }),
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Player profile"));
  }
  return response.json() as Promise<PlayerProfile>;
}

export async function confirmTransactionReceipt(
  provider: Eip1193Provider,
  transactionHash: string,
  {
    pollMs = TRANSACTION_RECEIPT_POLL_MS,
    timeoutMs = TRANSACTION_RECEIPT_TIMEOUT_MS,
  }: {
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<TransactionReceipt> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let receipt: TransactionReceipt | null;
    try {
      receipt = await provider.request<TransactionReceipt | null>({
        method: "eth_getTransactionReceipt",
        params: [transactionHash],
      });
    } catch {
      // The transaction was already submitted; the RPC node can still fail an
      // individual receipt read transiently (internal JSON-RPC error, timeout)
      // while the transaction is mining. Don't treat that as a launch failure —
      // keep polling until the receipt arrives or the overall timeout elapses.
      await delay(pollMs);
      continue;
    }
    if (receipt) {
      if (isRevertedReceiptStatus(receipt.status)) {
        throw new Error(TRANSACTION_REVERTED_MESSAGE);
      }
      return receipt;
    }
    await delay(pollMs);
  }

  throw new Error(TRANSACTION_RECEIPT_TIMEOUT_MESSAGE);
}

export type FetchHighscoreOptions = {
  category?: HighscoreCategory;
  currentWallet?: string;
  includeAttackProtection?: boolean;
  limit?: number;
  page?: number;
  pageSize?: number;
};

export async function fetchHighscores(
  apiUrl: string,
  options: FetchHighscoreOptions | number = 100
): Promise<HighscoreResponse> {
  const params = new URLSearchParams();
  if (typeof options === "number") {
    params.set("limit", String(options));
  } else {
    params.set("limit", String(options.limit ?? options.pageSize ?? 100));
    if (options.category !== undefined) params.set("category", options.category);
    if (options.currentWallet !== undefined) params.set("currentWallet", options.currentWallet);
    if (options.includeAttackProtection ?? Boolean(options.currentWallet)) params.set("includeAttackProtection", "true");
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
  }
  let response: Response;

  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, "")}/highscores?${params.toString()}`, {
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

  if (response.status === 503 && errorCode === "highscores_index_not_ready") {
    return "Rankings are warming from indexed game state. Retry in a moment.";
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Timed out reading ${label.toLowerCase()} from the game API after ${Math.round(WALLET_API_READ_TIMEOUT_MS / 1_000)} seconds.`));
  }, WALLET_API_READ_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, "")}/wallet/${encodeURIComponent(wallet)}/${path}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(`Timed out reading ${label.toLowerCase()} from the game API after ${Math.round(WALLET_API_READ_TIMEOUT_MS / 1_000)} seconds.`);
    }
    throw new Error(walletApiNetworkFailureMessage(label, error));
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, label));
  }
  return response.json() as Promise<T>;
}

function withPlanetId(path: string, planetId: string | undefined): string {
  return planetId && isContractPlanetId(planetId) ? `${path}?planetId=${encodeURIComponent(planetId)}` : path;
}

function withWalletReadOptions(path: string, planetId: string | undefined, options: WalletReadOptions, params = new URLSearchParams()): string {
  if (planetId && isContractPlanetId(planetId)) {
    params.set("planetId", planetId);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function isContractPlanetId(planetId: string): boolean {
  return /^[1-9][0-9]*$/.test(planetId);
}

async function apiErrorMessage(response: Response, label: string): Promise<string> {
  const fallback = `${label} API failed: ${response.status}`;
  try {
    const body = await response.clone().json() as { error?: unknown };
    const error = typeof body.error === "string" ? body.error.trim() : "";

    if (response.status === 503 && error === "backend_not_configured") {
      return `${label} API is temporarily unavailable. The app will retry instead of requiring a wallet reconnect.`;
    }

    if (response.status >= 500) {
      return error
        ? `${label} API is temporarily unavailable (${response.status}: ${error}). The app will retry.`
        : `${label} API is temporarily unavailable (${response.status}). The app will retry.`;
    }

    return error ? `${fallback}: ${error}` : fallback;
  } catch {
    if (response.status >= 500) {
      return `${label} API is temporarily unavailable (${response.status}). The app will retry.`;
    }

    return fallback;
  }
}

function isRevertedReceiptStatus(status: TransactionReceipt["status"]): boolean {
  if (typeof status === "bigint") return status === 0n;
  if (typeof status === "number") return status === 0;
  if (typeof status !== "string") return false;

  const normalized = status.trim().toLowerCase();
  return normalized === "0" || normalized === "0x0";
}

function walletApiNetworkFailureMessage(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|load failed|network|err_http2/i.test(message)) {
    return `${label} API could not be reached from this browser. Keeping the last known game state and retrying when the backend connection recovers.`;
  }

  return message || `${label} API could not be reached.`;
}
