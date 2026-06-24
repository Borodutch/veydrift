export type RuntimeConfig = {
  allianceContractAddress: string | null;
  apiUrl: string;
  burningChicken?: {
    burnContractAddress: string | null;
    burnSelector: string | null;
    levelSelector: string | null;
    nftContractAddress: string | null;
    rpcUrl: string | null;
  };
  chainId: number;
  contractAddress: string | null;
  featureSupport?: {
    allianceConfigured: boolean;
    chickenBurnConfigured?: boolean;
    gameConfigured: boolean;
    highscoresEndpoint: boolean;
    moonConfigured: boolean;
    randomnessConfigured: boolean;
    researchEndpoint: boolean;
    resourceTokensConfigured: boolean;
    settlementConfigured: boolean;
  };
  gameContractAddress: string | null;
  graphqlUrl: string;
  moonContractAddress: string | null;
  network: string;
  resourceTokenAddresses: {
    crystal: string | null;
    deuterium: string | null;
    metal: string | null;
  };
  rpcProvider: "alchemy" | "unknown";
};

export type RuntimeConfigState =
  | { status: "loading" }
  | { status: "ready"; config: RuntimeConfig }
  | { status: "error" };

export const defaultPlayableApiUrl = "https://api-test.veydrift.com";
export const burningChickenCoordinateBurnSelector = "0x6364233d";

export function resolvePlayableApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : defaultPlayableApiUrl;
}

export const playableApiUrl = resolvePlayableApiUrl(import.meta.env.VITE_VEYDRIFT_API_URL);

export function runtimeConfigUrl(apiUrl = playableApiUrl): string {
  return `${apiUrl.replace(/\/+$/, "")}/runtime-config`;
}

export function gameContractAddress(config: RuntimeConfig): string | undefined {
  return config.gameContractAddress ?? config.contractAddress ?? undefined;
}

export function allianceContractAddress(config: RuntimeConfig): string | undefined {
  return config.allianceContractAddress ?? undefined;
}

export function moonContractAddress(config: RuntimeConfig): string | undefined {
  return config.moonContractAddress ?? undefined;
}

export type ConfiguredBurningChickenConfig = {
  burnContractAddress: string;
  burnSelector: string;
  levelSelector: string | null;
  nftContractAddress: string;
  rpcUrl: string | null;
};

export function burningChickenConfig(config: RuntimeConfig): ConfiguredBurningChickenConfig | undefined {
  const chicken = config.burningChicken;
  if (!chicken?.nftContractAddress || !chicken.burnContractAddress || !chicken.burnSelector) {
    return undefined;
  }
  if (chicken.burnSelector.toLowerCase() !== burningChickenCoordinateBurnSelector) {
    return undefined;
  }
  return {
    burnContractAddress: chicken.burnContractAddress,
    burnSelector: chicken.burnSelector,
    levelSelector: chicken.levelSelector,
    nftContractAddress: chicken.nftContractAddress,
    rpcUrl: chicken.rpcUrl,
  };
}
