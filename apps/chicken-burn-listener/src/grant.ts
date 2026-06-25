import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { ChickenBurnEvent } from "./events";

export const maxChickenBurnMoonsPerPlayer = 2;

export const moonGrantAbi = [
  {
    type: "function",
    name: "grantMoonFromChickenBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "burnId", type: "bytes32" },
      { name: "player", type: "address" },
      { name: "planetId", type: "uint256" }
    ],
    outputs: [
      {
        name: "createdMoon",
        type: "tuple",
        components: [
          { name: "exists", type: "bool" },
          { name: "planetId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "fields", type: "uint16" },
          { name: "diameterKm", type: "uint16" },
          { name: "createdAt", type: "uint64" },
          { name: "jumpGateReadyAt", type: "uint64" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "chickenBurnMoonGranted",
    stateMutability: "view",
    inputs: [{ name: "burnId", type: "bytes32" }],
    outputs: [{ name: "granted", type: "bool" }]
  },
  {
    type: "function",
    name: "chickenBurnMoonGrantCountOf",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "count", type: "uint8" }]
  },
  {
    type: "error",
    name: "ChickenBurnMoonLimitReached",
    inputs: [
      { name: "player", type: "address" },
      { name: "limit", type: "uint256" }
    ]
  }
] as const satisfies Abi;

export type MoonGrantClient = {
  grantMoon(event: ChickenBurnEvent): Promise<`0x${string}`>;
  chickenBurnMoonGrantCount(player: `0x${string}`): Promise<number>;
  isBurnGranted(burnId: `0x${string}`): Promise<boolean>;
  grantAddress(): string;
};

export class MoonGrantAlreadyProcessedError extends Error {
  constructor(readonly burnId: `0x${string}`) {
    super(`burn ${burnId} already granted on-chain`);
    this.name = "MoonGrantAlreadyProcessedError";
  }
}

export class MoonGrantLimitReachedError extends Error {
  constructor(
    readonly player: `0x${string}`,
    readonly limit = maxChickenBurnMoonsPerPlayer
  ) {
    super(`chicken burn moon limit reached for ${player} (${limit})`);
    this.name = "MoonGrantLimitReachedError";
  }
}

export class ViemMoonGrantClient implements MoonGrantClient {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: {
    id: number;
    name: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: { default: { http: string[] } };
  };
  private readonly publicClient: ReturnType<typeof createPublicClient>;
  private readonly walletClient: ReturnType<typeof createWalletClient>;

  constructor(
    private readonly rpcUrl: string,
    private readonly moonSystemAddress: `0x${string}`,
    private readonly privateKey: `0x${string}`,
    private readonly chainId: number
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.chain = {
      id: chainId,
      name: "Veydrift target chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    };
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(rpcUrl)
    });
  }

  grantAddress(): string {
    return this.account.address;
  }

  async isBurnGranted(burnId: `0x${string}`): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.moonSystemAddress,
      abi: moonGrantAbi,
      functionName: "chickenBurnMoonGranted",
      args: [burnId]
    });
  }

  async chickenBurnMoonGrantCount(player: `0x${string}`): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.moonSystemAddress,
      abi: moonGrantAbi,
      functionName: "chickenBurnMoonGrantCountOf",
      args: [player]
    });
    return Number(count);
  }

  async grantMoon(event: ChickenBurnEvent): Promise<`0x${string}`> {
    if (await this.isBurnGranted(event.burnId)) {
      throw new MoonGrantAlreadyProcessedError(event.burnId);
    }
    if (await this.chickenBurnMoonGrantCount(event.burner) >= maxChickenBurnMoonsPerPlayer) {
      throw new MoonGrantLimitReachedError(event.burner);
    }

    const args = [
      event.burnId,
      event.burner,
      BigInt(event.planetId)
    ] as const;
    const data = encodeFunctionData({
      abi: moonGrantAbi,
      functionName: "grantMoonFromChickenBurn",
      args
    });
    try {
      await this.publicClient.call({
        account: this.account.address,
        to: this.moonSystemAddress,
        data
      });
    } catch (error) {
      if (isChickenBurnMoonLimitReachedRevert(error)) {
        throw new MoonGrantLimitReachedError(event.burner);
      }
      throw error;
    }
    const hash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.moonSystemAddress,
      abi: moonGrantAbi,
      functionName: "grantMoonFromChickenBurn",
      args
    });
    const receipt = (await this.publicClient.waitForTransactionReceipt({
      hash
    })) as TransactionReceipt;
    if (receipt.status !== "success") {
      throw new Error(`moon grant transaction ${hash} reverted`);
    }
    return hash;
  }
}

function isChickenBurnMoonLimitReachedRevert(error: unknown): boolean {
  return String(error).includes("ChickenBurnMoonLimitReached");
}
