export type RuntimeConfig = {
  apiUrl: string;
  chainId: number;
  contractAddress: string | null;
  gameContractAddress: string | null;
  graphqlUrl: string;
  network: string;
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
