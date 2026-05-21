export type DeploymentMode = "local" | "test" | "staging" | "production";

export type BackendConfig = {
  chainId: number;
  deploymentMode: DeploymentMode;
  gameContractAddress?: `0x${string}`;
  indexFromBlock: bigint;
  moonContractAddress?: `0x${string}`;
  resourceTokenAddresses: ResourceTokenAddresses;
  rpcUrl?: string;
  rpcSource: "alchemy-key" | "alchemy-url" | "custom-url" | "missing";
  settlementContractAddress?: `0x${string}`;
};

export type ResourceTokenAddresses = {
  crystal?: `0x${string}`;
  deuterium?: `0x${string}`;
  metal?: `0x${string}`;
};

export type ConfigProblem = {
  field: string;
  message: string;
};

export type ConfigResult = {
  config: BackendConfig;
  problems: ConfigProblem[];
};

export type SafeConfigSummary = {
  chainId: number;
  deploymentMode: DeploymentMode;
  gameContractConfigured: boolean;
  hasRpcUrl: boolean;
  moonContractConfigured: boolean;
  resourceTokensConfigured: {
    crystal: boolean;
    deuterium: boolean;
    metal: boolean;
  };
  rpcSource: BackendConfig["rpcSource"];
  resourceTokenAddressesConfigured: boolean;
  settlementContractConfigured: boolean;
  indexFromBlock: string;
};

const defaultChainId = 84532;
const defaultDeploymentMode: DeploymentMode = "local";
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const deploymentModes = new Set<DeploymentMode>(["local", "test", "staging", "production"]);

export function loadBackendConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const problems: ConfigProblem[] = [];
  const deploymentMode = parseDeploymentMode(env.VEYDRIFT_DEPLOYMENT_MODE, problems);
  const chainId = parsePositiveInteger(env.VEYDRIFT_CHAIN_ID, "VEYDRIFT_CHAIN_ID", problems) ?? defaultChainId;
  const indexFromBlock = parseBigInt(env.VEYDRIFT_INDEX_FROM_BLOCK, "VEYDRIFT_INDEX_FROM_BLOCK", problems) ?? 0n;
  const { rpcUrl, rpcSource } = resolveRpcUrl(env);
  const gameContractAddress = parseAddress(
    env.VEYDRIFT_GAME_CONTRACT_ADDRESS ?? env.VEYDRIFT_CONTRACT_ADDRESS,
    env.VEYDRIFT_GAME_CONTRACT_ADDRESS ? "VEYDRIFT_GAME_CONTRACT_ADDRESS" : "VEYDRIFT_CONTRACT_ADDRESS",
    problems
  );
  const settlementContractAddress = parseAddress(
    env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS,
    "VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS",
    problems
  );
  const moonContractAddress = parseAddress(
    env.VEYDRIFT_MOON_CONTRACT_ADDRESS,
    "VEYDRIFT_MOON_CONTRACT_ADDRESS",
    problems
  );
  const metalTokenAddress = parseAddress(env.VEYDRIFT_METAL_TOKEN_ADDRESS, "VEYDRIFT_METAL_TOKEN_ADDRESS", problems);
  const crystalTokenAddress = parseAddress(
    env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS,
    "VEYDRIFT_CRYSTAL_TOKEN_ADDRESS",
    problems
  );
  const deuteriumTokenAddress = parseAddress(
    env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS,
    "VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS",
    problems
  );
  const resourceTokenAddresses = {
    ...(metalTokenAddress ? { metal: metalTokenAddress } : {}),
    ...(crystalTokenAddress ? { crystal: crystalTokenAddress } : {}),
    ...(deuteriumTokenAddress ? { deuterium: deuteriumTokenAddress } : {})
  };

  if (!rpcUrl) {
    problems.push({
      field: "RPC_URL",
      message:
        "Set VEYDRIFT_RPC_URL, BASE_SEPOLIA_RPC_URL, ALCHEMY_BASE_SEPOLIA_RPC_URL, or ALCHEMY_BASE_SEPOLIA_API_KEY."
    });
  }

  if (!gameContractAddress) {
    problems.push({
      field: "VEYDRIFT_GAME_CONTRACT_ADDRESS",
      message: "Set the deployed VeydriftGame proxy address."
    });
  }

  return {
    config: {
      chainId,
      deploymentMode,
      ...(gameContractAddress ? { gameContractAddress } : {}),
      indexFromBlock,
      ...(moonContractAddress ? { moonContractAddress } : {}),
      resourceTokenAddresses,
      rpcSource,
      ...(rpcUrl ? { rpcUrl } : {}),
      ...(settlementContractAddress ? { settlementContractAddress } : {})
    },
    problems
  };
}

export function safeConfigSummary(config: BackendConfig): SafeConfigSummary {
  return {
    chainId: config.chainId,
    deploymentMode: config.deploymentMode,
    gameContractConfigured: Boolean(config.gameContractAddress),
    hasRpcUrl: Boolean(config.rpcUrl),
    moonContractConfigured: Boolean(config.moonContractAddress),
    resourceTokensConfigured: {
      crystal: Boolean(config.resourceTokenAddresses.crystal),
      deuterium: Boolean(config.resourceTokenAddresses.deuterium),
      metal: Boolean(config.resourceTokenAddresses.metal)
    },
    rpcSource: config.rpcSource,
    resourceTokenAddressesConfigured: Boolean(
      config.resourceTokenAddresses?.metal
        && config.resourceTokenAddresses.crystal
        && config.resourceTokenAddresses.deuterium
    ),
    settlementContractConfigured: Boolean(config.settlementContractAddress),
    indexFromBlock: config.indexFromBlock.toString()
  };
}

export function requireConfigured(result: ConfigResult): BackendConfig {
  if (result.problems.length > 0) {
    throw new Error(result.problems.map((problem) => `${problem.field}: ${problem.message}`).join("; "));
  }

  return result.config;
}

function parseDeploymentMode(value: string | undefined, problems: ConfigProblem[]): DeploymentMode {
  if (!value) {
    return defaultDeploymentMode;
  }

  if (deploymentModes.has(value as DeploymentMode)) {
    return value as DeploymentMode;
  }

  problems.push({
    field: "VEYDRIFT_DEPLOYMENT_MODE",
    message: "Expected one of local, test, staging, production."
  });
  return defaultDeploymentMode;
}

function parsePositiveInteger(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed.toString() !== value) {
    problems.push({
      field,
      message: "Expected a positive safe integer."
    });
    return undefined;
  }

  return parsed;
}

function parseBigInt(value: string | undefined, field: string, problems: ConfigProblem[]): bigint | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error("negative");
    }
    return parsed;
  } catch {
    problems.push({
      field,
      message: "Expected a non-negative integer."
    });
    return undefined;
  }
}

function parseAddress(
  value: string | undefined,
  field: string,
  problems: ConfigProblem[]
): `0x${string}` | undefined {
  if (!value) {
    return undefined;
  }

  if (!addressPattern.test(value)) {
    problems.push({
      field,
      message: "Expected a 0x-prefixed 20-byte EVM address."
    });
    return undefined;
  }

  return value as `0x${string}`;
}

function resolveRpcUrl(env: Record<string, string | undefined>): Pick<BackendConfig, "rpcUrl" | "rpcSource"> {
  if (env.VEYDRIFT_RPC_URL) {
    return { rpcUrl: env.VEYDRIFT_RPC_URL, rpcSource: "custom-url" };
  }

  if (env.BASE_SEPOLIA_RPC_URL) {
    return { rpcUrl: env.BASE_SEPOLIA_RPC_URL, rpcSource: "custom-url" };
  }

  if (env.ALCHEMY_BASE_SEPOLIA_RPC_URL) {
    return { rpcUrl: env.ALCHEMY_BASE_SEPOLIA_RPC_URL, rpcSource: "alchemy-url" };
  }

  if (env.ALCHEMY_BASE_SEPOLIA_API_KEY) {
    return {
      rpcUrl: `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_BASE_SEPOLIA_API_KEY}`,
      rpcSource: "alchemy-key"
    };
  }

  return { rpcSource: "missing" };
}
