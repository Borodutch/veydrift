import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
  type Account
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { OracleConfig } from "./config";
import type { RandomnessChain, RequestState } from "./oracle";

// Only the slice of RandomnessEngine the oracle needs.
export const randomnessEngineAbi = [
  {
    type: "function",
    name: "nextRequestId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "fulfiller",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "precommitRequired",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "request",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "requester", type: "address" },
          { name: "purposeHash", type: "bytes32" },
          { name: "randomnessCommitment", type: "bytes32" },
          { name: "createdAt", type: "uint64" },
          { name: "fulfilledAt", type: "uint64" },
          { name: "randomWord", type: "uint256" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "fulfillRandomness",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "randomWord", type: "uint256" }
    ],
    outputs: []
  }
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class EngineClient implements RandomnessChain {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  readonly account: Account;
  private readonly address: `0x${string}`;

  constructor(config: OracleConfig) {
    const chain = defineChain({
      id: config.chainId,
      name: `chain-${config.chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } }
    });
    this.account = privateKeyToAccount(config.fulfillerPrivateKey);
    this.address = config.randomnessEngineAddress;
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl)
    });
  }

  async nextRequestId(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.address,
      abi: randomnessEngineAbi,
      functionName: "nextRequestId"
    })) as bigint;
  }

  async getRequest(requestId: bigint): Promise<RequestState> {
    const result = (await this.publicClient.readContract({
      address: this.address,
      abi: randomnessEngineAbi,
      functionName: "request",
      args: [requestId]
    })) as {
      requester: `0x${string}`;
      fulfilledAt: bigint;
      createdAt: bigint;
    };
    return {
      exists: result.requester.toLowerCase() !== ZERO_ADDRESS,
      fulfilled: result.fulfilledAt !== 0n,
      createdAt: Number(result.createdAt)
    };
  }

  async fulfill(requestId: bigint, randomWord: bigint): Promise<string> {
    try {
      const { request } = await this.publicClient.simulateContract({
        address: this.address,
        abi: randomnessEngineAbi,
        functionName: "fulfillRandomness",
        args: [requestId, randomWord],
        account: this.account
      });
      const hash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`fulfillRandomness reverted for request ${requestId} (tx ${hash})`);
      }
      return hash;
    } catch (error) {
      // Another tick, another instance, or a prior run may have already
      // fulfilled this request. That's a success from our perspective.
      const message = error instanceof Error ? error.message : String(error);
      if (/AlreadyFulfilled/i.test(message)) return "already-fulfilled";
      throw error;
    }
  }

  // --- diagnostics used at startup / health ---

  async fulfiller(): Promise<`0x${string}`> {
    return (await this.publicClient.readContract({
      address: this.address,
      abi: randomnessEngineAbi,
      functionName: "fulfiller"
    })) as `0x${string}`;
  }

  async precommitRequired(): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.address,
      abi: randomnessEngineAbi,
      functionName: "precommitRequired"
    })) as boolean;
  }

  async fulfillerBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address });
  }
}
