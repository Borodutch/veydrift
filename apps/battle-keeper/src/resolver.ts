import { encodeFunctionData, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { JsonRpcTransport } from "./transport";

/**
 * `resolveFleetMission(uint256)` — permissionless: any funded EOA can call it to settle an arrived
 * mission. Selector is 0xde09e7cf (matches the removed backend keeper). We keep the ABI inline so the
 * keeper has no build dependency on the contracts package.
 */
const resolveFleetMissionAbi = [
  {
    type: "function",
    name: "resolveFleetMission",
    stateMutability: "nonpayable",
    inputs: [{ name: "missionId", type: "uint256" }],
    outputs: []
  }
] as const satisfies Abi;

export const resolveFleetMissionSelector = "0xde09e7cf";

/** Raised when an attempted resolve reverts on simulation — almost always "randomness not committed
 * yet". The keeper catches this and retries on the next tick/event rather than crashing. */
export class MissionNotResolvableError extends Error {
  constructor(
    readonly missionId: string,
    readonly reason: unknown
  ) {
    super(`mission ${missionId} not resolvable yet: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = "MissionNotResolvableError";
  }
}

export type MissionResolver = {
  /** Submit resolveFleetMission(missionId). Resolves with the tx hash once mined successfully.
   * Throws {@link MissionNotResolvableError} when the call reverts (retry later) or any other error
   * on transport/timeout failure. */
  resolveMission(missionId: string): Promise<string>;
  keeperAddress(): string;
};

export function encodeResolveFleetMissionCall(missionId: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: resolveFleetMissionAbi,
    functionName: "resolveFleetMission",
    args: [missionId]
  });
}

type ViemResolverOptions = {
  /** Poll interval / attempts while waiting for the tx receipt. */
  receiptPollIntervalMs?: number;
  receiptMaxPolls?: number;
  /** Gas headroom multiplier applied to the estimate (percent). */
  gasLimitBufferPercent?: bigint;
};

/**
 * Signs and broadcasts resolveFleetMission via raw `eth_sendRawTransaction` (the approach reused from
 * the old backend keeper). Before sending, it `eth_call`-simulates so a not-yet-resolvable mission
 * never burns a nonce — the call reverts, we throw {@link MissionNotResolvableError}, and retry.
 */
export class ViemMissionResolver implements MissionResolver {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly to: `0x${string}`;
  private readonly chainId: number;

  constructor(
    private readonly transport: JsonRpcTransport,
    privateKey: `0x${string}`,
    gameContractAddress: `0x${string}`,
    chainId: number,
    private readonly options: ViemResolverOptions = {}
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.to = gameContractAddress;
    this.chainId = chainId;
  }

  keeperAddress(): string {
    return this.account.address;
  }

  async resolveMission(missionId: string): Promise<string> {
    const data = encodeResolveFleetMissionCall(BigInt(missionId));
    const from = this.account.address;

    // 1) Simulate. A revert here means the mission isn't resolvable yet (randomness not committed,
    //    not arrived, already resolved by someone else) — surface as retryable, don't send a tx.
    try {
      await this.transport.request<string>("eth_call", [{ from, to: this.to, data }, "latest"]);
    } catch (error) {
      throw new MissionNotResolvableError(missionId, error);
    }

    // 2) Build the EIP-1559 tx: nonce (pending), gas estimate + buffer, dynamic fees, chainId.
    const [nonceHex, gasHex, feeData] = await Promise.all([
      this.transport.request<string>("eth_getTransactionCount", [from, "pending"]),
      this.transport.request<string>("eth_estimateGas", [{ from, to: this.to, data }]),
      this.resolveFees()
    ]);

    const gas = applyBuffer(BigInt(gasHex), this.options.gasLimitBufferPercent ?? 20n);

    const signed = await this.account.signTransaction({
      to: this.to,
      data,
      nonce: Number(BigInt(nonceHex)),
      gas,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      chainId: this.chainId,
      type: "eip1559"
    });

    // 3) Broadcast raw + wait for a successful receipt.
    const hash = await this.transport.request<`0x${string}`>("eth_sendRawTransaction", [signed]);
    await this.waitForSuccessfulReceipt(hash, missionId);
    return hash;
  }

  private async resolveFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const block = await this.transport.request<{ baseFeePerGas?: string } | null>(
      "eth_getBlockByNumber",
      ["latest", false]
    );
    let priority: bigint;
    try {
      priority = BigInt(await this.transport.request<string>("eth_maxPriorityFeePerGas", []));
    } catch {
      priority = 1_000_000_000n; // 1 gwei fallback when the node lacks the method.
    }
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n;
    // Headroom of 2x base fee + priority so the tx stays includable across a few blocks.
    const maxFeePerGas = baseFee * 2n + priority;
    return { maxFeePerGas, maxPriorityFeePerGas: priority };
  }

  private async waitForSuccessfulReceipt(hash: `0x${string}`, missionId: string): Promise<void> {
    const interval = this.options.receiptPollIntervalMs ?? 1_500;
    const maxPolls = this.options.receiptMaxPolls ?? 40;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const receipt = await this.transport.request<{ status?: string } | null>(
        "eth_getTransactionReceipt",
        [hash]
      );
      if (receipt) {
        if (receipt.status === "0x1") {
          return;
        }
        // Mined but reverted (e.g. lost a race / randomness lapsed mid-flight) — retry later.
        throw new MissionNotResolvableError(missionId, new Error(`tx ${hash} reverted on-chain`));
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`timed out waiting for receipt of ${hash} (mission ${missionId})`);
  }
}

function applyBuffer(value: bigint, bufferPercent: bigint): bigint {
  return (value * (100n + bufferPercent)) / 100n;
}
