export type RuntimeConfig = {
  allianceContractAddress: string | null;
  apiUrl: string;
  chainId: number;
  contractAddress: string | null;
  featureSupport?: {
    allianceConfigured: boolean;
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

export const playableApiUrl = import.meta.env.VITE_VEYDRIFT_API_URL ?? "https://api-test.veydrift.com";

export function runtimeConfigUrl(apiUrl = playableApiUrl): string {
  return `${apiUrl.replace(/\/+$/, "")}/runtime-config`;
}

export function gameContractAddress(config: RuntimeConfig): string | undefined {
  return config.gameContractAddress ?? config.contractAddress ?? undefined;
}

export function allianceContractAddress(config: RuntimeConfig): string | undefined {
  return config.allianceContractAddress ?? undefined;
}
