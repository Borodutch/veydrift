import { decodeFunctionResult, encodeFunctionData, parseTransaction, toHex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { JsonRpcTransport } from "./transport";
import { readAndPlanProofDelivery, type ProofDeliveryPlan } from "./proofDelivery";
import { readMissionProgress, type MissionProgress } from "./progress";
import { assertSignedTarget, signedAttempt, resumeSignedAttempt, PreBroadcastError, type AttemptStore } from "./transaction";

/**
 * Permissionless settlement entrypoints — any funded EOA can call them. We keep the ABIs inline so
 * the keeper has no build dependency on the contracts package.
 *  - `resolveFleetMission(uint256)` — selector 0xde09e7cf — settles the ARRIVAL leg (all outbound
 *    mission types). Afterwards the mission is either terminal (Deploy/Colonize/…) or Returning.
 *  - `completeFleetMissionReturn(uint256)` — selector 0xc2472852 — settles the RETURN leg once a
 *    Returning/Recalled mission's returnAt has passed.
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

const completeFleetMissionReturnAbi = [
  {
    type: "function",
    name: "completeFleetMissionReturn",
    stateMutability: "nonpayable",
    inputs: [{ name: "missionId", type: "uint256" }],
    outputs: []
  }
] as const satisfies Abi;

// Conservative transaction-envelope ceiling, below Base's 2^24 gas maximum.
// https://docs.base.org/specifications/transactions/troubleshooting-transactions
export const settlementGasLimit = 15_000_000n;
const fleetMissionEligibilityAbi = [{
  type: "function", name: "fleetMissionEligibility", stateMutability: "view",
  inputs: [{ name: "missionId", type: "uint256" }],
  outputs: [{ type: "bool" }, { type: "uint256" }, { type: "bool" }]
}] as const satisfies Abi;

export const resolveFleetMissionSelector = "0xde09e7cf";
export const completeFleetMissionReturnSelector = "0xc2472852";

/** Which leg of a mission's lifecycle a resolve targets. */
export type MissionLeg = "arrival" | "return";

export type CanonicalMissionStatus = {
  missionId: string;
  status: number;
  missionType: number;
  arrivalAt: number;
  returnAt: number;
  randomnessRequestId: string;
  targetPlanetId?: string;
};

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
  /** Submit the leg's settlement call (resolveFleetMission for "arrival",
   * completeFleetMissionReturn for "return"). Resolves with the tx hash once mined successfully.
   * Throws {@link MissionNotResolvableError} when the call reverts (retry later) or any other error
   * on transport/timeout failure. */
  resolveMission(missionId: string, leg: MissionLeg, beforeSign?: () => Promise<MissionProgress | void>): Promise<string>;
  bindAttemptStore?(store: AttemptStore): void;
  pendingProgress?(missionId: string, leg: MissionLeg): MissionProgress | undefined;
  hasSignedAttempt?(missionId: string, leg: MissionLeg): boolean;
  acknowledgeReceipt?(missionId: string, leg: MissionLeg): void;
  missionProgress?(missionId: string): Promise<MissionProgress>;
  /** Read-only preview. Never authorizes signing or consumes an ordinary mission checkpoint. */
  planProofDelivery?(missionId: string, artifactJson: string, limits: { maxArtifactBytes: number; maxLeaves: number; batchSize?: number }): Promise<ProofDeliveryPlan>;
  /** Canonical post-receipt state; combat and missile settlement can require several receipts. */
  missionStatus?(missionId: string): Promise<CanonicalMissionStatus>;
  keeperAddress(): string;
};

const fleetMissionStatusAbi = [
  {
    type: "function",
    name: "fleetMission",
    stateMutability: "view",
    inputs: [{ name: "missionId", type: "uint256" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "missionType", type: "uint8" },
      { name: "owner", type: "address" },
      { name: "originPlanetId", type: "uint256" },
      { name: "targetPlanetId", type: "uint256" },
      { name: "departureAt", type: "uint64" },
      { name: "arrivalAt", type: "uint64" },
      { name: "returnAt", type: "uint64" },
      { name: "fuelCost", type: "uint128" },
      {
        name: "cargo",
        type: "tuple",
        components: [
          { name: "metal", type: "uint128" },
          { name: "crystal", type: "uint128" },
          { name: "deuterium", type: "uint128" }
        ]
      },
      { name: "randomnessRequestId", type: "uint256" }
    ]
  }
] as const satisfies Abi;

export function encodeResolveFleetMissionCall(missionId: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: resolveFleetMissionAbi,
    functionName: "resolveFleetMission",
    args: [missionId]
  });
}

export function encodeCompleteFleetMissionReturnCall(missionId: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: completeFleetMissionReturnAbi,
    functionName: "completeFleetMissionReturn",
    args: [missionId]
  });
}

/** Calldata for the given leg's permissionless settlement call. */
export function encodeMissionCall(missionId: bigint, leg: MissionLeg): `0x${string}` {
  return leg === "return"
    ? encodeCompleteFleetMissionReturnCall(missionId)
    : encodeResolveFleetMissionCall(missionId);
}

type ViemResolverOptions = {
  arrivalProgressVersions?: readonly string[];
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
  private attemptStore: AttemptStore | undefined;
  bindAttemptStore(store: AttemptStore): void { this.attemptStore = store; }
  hasSignedAttempt(id: string, leg: MissionLeg): boolean { return !!this.attemptStore?.getAttempt(id + ":" + leg); }
  pendingProgress(id: string, leg: MissionLeg): MissionProgress | undefined {
    return this.attemptStore?.getAttempt(id + ":" + leg)?.progress;
  }
  acknowledgeReceipt(id: string, leg: MissionLeg): void { this.attemptStore?.removeAttempt(id + ":" + leg); }

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

  planProofDelivery(missionId: string, artifactJson: string, limits: { maxArtifactBytes: number; maxLeaves: number; batchSize?: number }): Promise<ProofDeliveryPlan> {
    return readAndPlanProofDelivery(this.transport, this.to, BigInt(missionId), BigInt(this.chainId), artifactJson, limits);
  }

  async missionProgress(missionId: string): Promise<MissionProgress> {
    const mission = await this.missionStatus(missionId);
    return readMissionProgress(this.transport, this.to, missionId,
      mission.status === 1 ? mission.targetPlanetId : undefined,
      mission.missionType === 7, this.options.arrivalProgressVersions);
  }

  async resolveMission(missionId: string, leg: MissionLeg = "arrival", beforeSign?: () => Promise<MissionProgress | void>): Promise<string> {
    const pending = this.attemptStore?.getAttempt(missionId + ":" + leg);
    if (pending) return this.resume(missionId, leg);
    if (this.attemptStore?.attemptKeys().length) throw new Error("another durable signed transaction owns the keeper nonce");
    const data = encodeMissionCall(BigInt(missionId), leg);
    const from = this.account.address;

    // 1) Simulate. A revert here means this leg isn't resolvable yet (arrival: randomness not
    //    committed / not arrived / already resolved; return: not due / wrong status / already
    //    returned) — surface as retryable, don't send a tx.
    try {
      const proof = await this.transport.request<`0x${string}`>("eth_call", [{
        to: this.to,
        data: encodeFunctionData({ abi: fleetMissionEligibilityAbi, functionName: "fleetMissionEligibility", args: [BigInt(missionId)] })
      }, "latest"]);
      const [, , orderingReady] = decodeFunctionResult({
        abi: fleetMissionEligibilityAbi, functionName: "fleetMissionEligibility", data: proof
      });
      // The first bool is strict player-facing settlement eligibility: it remains false while
      // body scans need bounded preparation. The third bool confirms ordering support for both
      // legacy and new missions without backfill. Simulate the exact existing entrypoint so
      // progress-only calls can run without bypassing its chronology/randomness guards.
      if (!orderingReady) throw new Error("fleet chronology ordering support unavailable");
await this.transport.request<string>("eth_call", [{ from, to: this.to, data, gas: `0x${settlementGasLimit.toString(16)}` }, "latest"]);
    } catch (error) {
      throw new MissionNotResolvableError(missionId, error);
    }

    // 2) Build the EIP-1559 tx: nonce (pending), gas estimate + buffer, dynamic fees, chainId.
    const [nonceHex, latestNonceHex, gasHex, feeData] = await Promise.all([
      this.transport.request<string>("eth_getTransactionCount", [from, "pending"]),
      this.transport.request<string>("eth_getTransactionCount", [from, "latest"]),
      this.transport.request<string>("eth_estimateGas", [{
        from, to: this.to, data, gas: `0x${settlementGasLimit.toString(16)}`
      }]),
      this.resolveFees()
    ]);

    // A previous send may have timed out or the keeper may have restarted while it was pending.
    // Do not enqueue a second stage behind an unknown receipt (or reuse its nonce).
    if (BigInt(nonceHex) !== BigInt(latestNonceHex)) {
      throw new MissionNotResolvableError(missionId, new Error("keeper transaction still pending"));
    }
    const estimate = BigInt(gasHex);
    if (estimate > settlementGasLimit) {
      throw new MissionNotResolvableError(missionId, new Error("settlement exceeds gas ceiling"));
    }
    const buffered = applyBuffer(estimate, this.options.gasLimitBufferPercent ?? 20n);
    // Arrival computation may stop at a gasleft checkpoint. A minimum-success estimate can
    // otherwise select a receipt that makes little/no progress. Give it the unchanged full budget.
    const gas = leg === "arrival" || buffered > settlementGasLimit
      ? settlementGasLimit : buffered;
    // Preflight the exact envelope we will sign, not an unlimited eth_call or an oversized buffer.
    try {
      await this.transport.request<string>("eth_call", [{
        from, to: this.to, data, gas: `0x${gas.toString(16)}`,
        maxFeePerGas: `0x${feeData.maxFeePerGas.toString(16)}`,
        maxPriorityFeePerGas: `0x${feeData.maxPriorityFeePerGas.toString(16)}`,
        nonce: nonceHex, type: "0x2"
      }, "latest"]);
    } catch (error) {
      throw new MissionNotResolvableError(missionId, error);
    }

    // The durable progress intent commits after read-only preflight and before signing/broadcast.
    const progress = await beforeSign?.();
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

    // Persistence is the only gateway to dispatch. A crash before this write is safe to rebuild;
    // after it, restart can only resend these exact bytes, never allocate a replacement nonce.
    if (this.attemptStore) {
      this.attemptStore.putAttempt(missionId + ":" + leg, signedAttempt(signed, Number(BigInt(nonceHex)), progress || undefined));
      return this.resume(missionId, leg);
    }
    // Legacy standalone adapters have no durable owner. Production always binds the keeper journal.
    const hash = await this.transport.request<`0x${string}`>("eth_sendRawTransaction", [signed]);
    await this.waitForSuccessfulReceipt(hash, missionId);
    return hash;
  }

  private async resume(missionId: string, leg: MissionLeg): Promise<string> {
    const attempt = this.attemptStore!.getAttempt(missionId + ":" + leg)!;
    await assertSignedTarget(attempt, { from: this.account.address, to: this.to,
      data: encodeMissionCall(BigInt(missionId), leg), chainId: this.chainId, maxGas: settlementGasLimit });
    // Paid reverts retain their envelope until the keeper durably consumes the checkpoint.
    const transport: JsonRpcTransport = { request: async <T>(method: string, params: unknown[]): Promise<T> => {
      if (method === "eth_sendRawTransaction") {
        try {
          const proof = await this.transport.request<`0x${string}`>("eth_call", [{ to: this.to,
            data: encodeFunctionData({ abi: fleetMissionEligibilityAbi, functionName: "fleetMissionEligibility", args: [BigInt(missionId)] }) }, "latest"]);
          const [, , ready] = decodeFunctionResult({ abi: fleetMissionEligibilityAbi, functionName: "fleetMissionEligibility", data: proof });
          if (!ready) throw new Error("fleet chronology ordering support unavailable");
          const tx = parseTransaction(attempt.raw);
          await this.transport.request("eth_call", [{ from: this.account.address, to: this.to, data: tx.data,
            nonce: toHex(tx.nonce!), gas: toHex(tx.gas!), value: toHex(tx.value ?? 0n),
            ...(tx.maxFeePerGas === undefined ? {} : { maxFeePerGas: toHex(tx.maxFeePerGas) }),
            ...(tx.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: toHex(tx.maxPriorityFeePerGas) }) }, "latest"]);
        } catch (error) { throw new PreBroadcastError(error); }
      }
      return this.transport.request<T>(method, params);
    } };
    return resumeSignedAttempt(transport, attempt, {
      polls: this.options.receiptMaxPolls ?? 40, intervalMs: this.options.receiptPollIntervalMs ?? 1500
    });
  }

  async missionStatus(missionId: string): Promise<CanonicalMissionStatus> {
    const data = encodeFunctionData({
      abi: fleetMissionStatusAbi,
      functionName: "fleetMission",
      args: [BigInt(missionId)]
    });
    const encoded = await this.transport.request<`0x${string}`>("eth_call", [
      { to: this.to, data },
      "latest"
    ]);
    const decoded = decodeFunctionResult({
      abi: fleetMissionStatusAbi,
      functionName: "fleetMission",
      data: encoded
    });
    return {
      missionId,
      status: Number(decoded[0]),
      missionType: Number(decoded[1]),
      arrivalAt: Number(decoded[6]),
      returnAt: Number(decoded[7]),
      randomnessRequestId: decoded[10].toString(),
      targetPlanetId: decoded[4].toString()
    };
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
