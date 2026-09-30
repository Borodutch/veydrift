import { describe, expect, test } from "bun:test";
import { parseTransaction, toFunctionSelector } from "viem";

import { FleetMissionStatus, MissionType } from "./events";
import { BattleKeeper } from "./keeper";

import {
  completeFleetMissionReturnSelector,
  encodeCompleteFleetMissionReturnCall,
  encodeResolveFleetMissionCall,
  MissionNotResolvableError,
  resolveFleetMissionSelector,
  ViemMissionResolver
} from "./resolver";
import { RpcError, type JsonRpcTransport } from "./transport";

const testKey = ("0x" + "1".repeat(64)) as `0x${string}`;
const gameContract = "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2" as const;

type Responder = (method: string, params: unknown[]) => unknown;

class MockTransport implements JsonRpcTransport {
  calls: Array<{ method: string; params: unknown[] }> = [];
  constructor(private readonly responder: Responder) {}
  async request<T>(method: string, params: unknown[]): Promise<T> {
    this.calls.push({ method, params });
    const result = this.responder(method, params);
    if (result instanceof Error) {
      throw result;
    }
    return result as T;
  }
  methodCalls(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

describe("encodeResolveFleetMissionCall", () => {
  test("produces the 0xde09e7cf selector and abi-encoded missionId", () => {
    const data = encodeResolveFleetMissionCall(42n);
    expect(data.startsWith(resolveFleetMissionSelector)).toBe(true);
    expect(data).toBe(`${resolveFleetMissionSelector}${(42n).toString(16).padStart(64, "0")}`);
  });
});

describe("encodeCompleteFleetMissionReturnCall", () => {
  test("produces the 0xc2472852 selector and abi-encoded missionId", () => {
    const data = encodeCompleteFleetMissionReturnCall(42n);
    expect(data.startsWith(completeFleetMissionReturnSelector)).toBe(true);
    expect(data).toBe(
      `${completeFleetMissionReturnSelector}${(42n).toString(16).padStart(64, "0")}`
    );
  });
});

describe("ViemMissionResolver", () => {
  for (const leg of ["arrival", "return"] as const) {
    for (const proof of ["0x", "0x01", eligibilityProof(0n, 0n), eligibilityProof(1n, 0n), new RpcError("missing selector", 3, "0x")]) {
      test(`${leg} rejects unavailable ordering support ${String(proof)}`, async () => {
        const transport = new MockTransport(() => proof);
        const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
        await expect(resolver.resolveMission("42", leg)).rejects.toBeInstanceOf(MissionNotResolvableError);
        expect(transport.calls).toHaveLength(1);
        expect((transport.calls[0]!.params[0] as { data: string }).data).toBe("0xce02abe2" + 42n.toString(16).padStart(64, "0"));
      });
    }
  }
  for (const leg of ["arrival", "return"] as const) {
    for (const reason of ["EarlierMissionPending", "NoRandomnessCommitment"]) {
      test(`${leg} still simulates on-chain ${reason} guard when UI eligibility is false`, async () => {
        const transport = new MockTransport((method, params) => {
          if (method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xce02abe2")) {
            return eligibilityProof(0n, 1n);
          }
          return new RpcError(`execution reverted: ${reason}`, 3, "0x");
        });
        const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
        await expect(resolver.resolveMission("42", leg)).rejects.toBeInstanceOf(MissionNotResolvableError);
        expect(transport.calls.map(call => call.method)).toEqual(["eth_call", "eth_call"]);
        expect((transport.calls[1]!.params[0] as { data: string }).data).toBe(
          leg === "arrival" ? encodeResolveFleetMissionCall(42n) : encodeCompleteFleetMissionReturnCall(42n)
        );
      });
    }
  }
  test("simulate-revert surfaces as MissionNotResolvableError without sending a tx", async () => {
    const transport = new MockTransport((method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xce02abe2")) return eligibilityProof();
      if (method === "eth_call") {
        return new RpcError("execution reverted: NoRandomnessCommitment", 3, "0x");
      }
      return "0x0";
    });
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);

    await expect(resolver.resolveMission("1")).rejects.toBeInstanceOf(MissionNotResolvableError);
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
  });

  test("happy path signs and broadcasts via eth_sendRawTransaction", async () => {
    const transport = new MockTransport((method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xce02abe2")) return eligibilityProof();
      switch (method) {
        case "eth_call":
          return "0x";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_getBlockByNumber":
          return { baseFeePerGas: "0x3b9aca00" };
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_sendRawTransaction":
          return "0xdeadbeef";
        case "eth_getTransactionReceipt":
          return { status: "0x1" };
        default:
          return "0x0";
      }
    });
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);

    const hash = await resolver.resolveMission("1");
    expect(hash).toBe("0xdeadbeef");
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(1);

    // The broadcast payload is a signed raw tx string.
    const sendCall = transport.calls.find((c) => c.method === "eth_sendRawTransaction");
    expect(typeof (sendCall?.params[0] as string)).toBe("string");
    expect((sendCall?.params[0] as string).startsWith("0x02")).toBe(true); // EIP-1559 envelope
  });

  test("the return leg simulates and broadcasts completeFleetMissionReturn", async () => {
    let simulatedData: string | undefined;
    const transport = new MockTransport((method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xce02abe2")) return eligibilityProof();
      switch (method) {
        case "eth_call":
          simulatedData = (params[0] as { data: string }).data;
          return "0x";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_getBlockByNumber":
          return { baseFeePerGas: "0x3b9aca00" };
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_sendRawTransaction":
          return "0xdeadbeef";
        case "eth_getTransactionReceipt":
          return { status: "0x1" };
        default:
          return "0x0";
      }
    });
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);

    const hash = await resolver.resolveMission("1", "return");
    expect(hash).toBe("0xdeadbeef");
    // The simulated calldata targets completeFleetMissionReturn, not resolveFleetMission.
    expect(simulatedData?.startsWith(completeFleetMissionReturnSelector)).toBe(true);
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(1);
  });

  test("a mined-but-reverted receipt is retryable (MissionNotResolvableError)", async () => {
    const transport = new MockTransport((method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xce02abe2")) return eligibilityProof();
      switch (method) {
        case "eth_call":
          return "0x";
        case "eth_getTransactionCount":
          return "0x1";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_getBlockByNumber":
          return { baseFeePerGas: "0x3b9aca00" };
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_sendRawTransaction":
          return "0xabc123";
        case "eth_getTransactionReceipt":
          return { status: "0x0" }; // reverted on-chain
        default:
          return "0x0";
      }
    });
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
    await expect(resolver.resolveMission("1")).rejects.toBeInstanceOf(MissionNotResolvableError);
  });

  for (const newLaunch of [false, true]) {
    test(`both legs finish a bounded body scan without backfill${newLaunch ? " after a new launch" : ""}`, async () => {
      const bodyEntries = newLaunch ? 25 : 24;
      const pageSize = 12;
      let status: number = FleetMissionStatus.Outbound;
      let scanned = 0;
      let receipts = 0;
      let canonicalReads = 0;
      const eligibilitySeen: bigint[] = [];
      const statusSelector = toFunctionSelector("fleetMission(uint256)");
      const transport = new MockTransport((method, params) => {
        if (method === "eth_call") {
          const data = (params[0] as { data: string }).data;
          if (data.startsWith("0xce02abe2")) {
            const eligible = scanned === bodyEntries ? 1n : 0n;
            eligibilitySeen.push(eligible);
            // New launches register atomically: body work never requires historical inventory sync.
            return eligibilityProof(eligible, 1n);
          }
          if (data.startsWith(statusSelector)) {
            canonicalReads += 1;
            // fleetMission's static ABI tuple, including its three-word cargo tuple.
            return "0x" + [status, MissionType.Transport, 0, 1, 2, 700, 800, 900, 0, 0, 0, 0, 0]
              .map(value => BigInt(value).toString(16).padStart(64, "0")).join("");
          }
          expect(data).toBe(status === FleetMissionStatus.Outbound
            ? encodeResolveFleetMissionCall(42n) : encodeCompleteFleetMissionReturnCall(42n));
          return "0x"; // Progress-only simulation succeeds without persisting its scan.
        }
        switch (method) {
          case "eth_getTransactionCount":
            expect(params[1]).toBe("pending");
            return "0x" + receipts.toString(16);
          case "eth_estimateGas": return "0x5208";
          case "eth_getBlockByNumber": return { baseFeePerGas: "0x3b9aca00" };
          case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
          case "eth_sendRawTransaction": {
            const tx = parseTransaction(params[0] as `0x${string}`);
            expect(tx.nonce).toBe(receipts);
            expect(tx.gas).toBe(25_200n); // Retain the estimate + 20% buffer.
            expect(tx.maxFeePerGas).toBe(3_000_000_000n);
            expect(tx.maxPriorityFeePerGas).toBe(1_000_000_000n);
            expect(tx.data).toBe(status === FleetMissionStatus.Outbound
              ? encodeResolveFleetMissionCall(42n) : encodeCompleteFleetMissionReturnCall(42n));
            return "0xdeadbeef";
          }
          case "eth_getTransactionReceipt":
            receipts += 1;
            if (scanned < bodyEntries) {
              scanned = Math.min(bodyEntries, scanned + pageSize);
            } else {
              status = status === FleetMissionStatus.Outbound
                ? FleetMissionStatus.Returning : FleetMissionStatus.Returned;
              scanned = 0; // The next leg scans its own body.
            }
            return { status: "0x1" };
          default: throw new Error("unexpected mock RPC: " + method);
        }
      });
      const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
      const keeper = new BattleKeeper(resolver, {
        now: () => 1_000,
        logger: { info: () => {}, warn: () => {}, error: () => {} }
      });
      keeper.recordLaunched({ missionId: "42", missionType: MissionType.Transport, arrivalAt: 800, returnAt: 900 });
      for (const leg of ["arrival", "return"] as const) {
        const preparationReceipts = Math.ceil(bodyEntries / pageSize);
        for (let page = 0; page < preparationReceipts; page += 1) {
          const before = receipts;
          await keeper.tick();
          expect(receipts).toBe(before + 1);
          expect(canonicalReads).toBe(receipts);
          expect(keeper.pendingMissions()).toEqual([expect.objectContaining({ missionId: "42", leg })]);
        }
        await keeper.tick();
        expect(canonicalReads).toBe(receipts);
        if (leg === "arrival") {
          expect(keeper.pendingMissions()).toEqual([expect.objectContaining({ missionId: "42", leg: "return" })]);
        } else {
          expect(keeper.snapshot().pendingCount).toBe(0);
        }
      }
      expect(receipts).toBe(2 * (Math.ceil(bodyEntries / pageSize) + 1));
      expect(transport.methodCalls("eth_sendRawTransaction")).toBe(receipts);
      expect(eligibilitySeen.filter(value => value === 0n)).toHaveLength(receipts - 2);
      expect(eligibilitySeen.filter(value => value === 1n)).toHaveLength(2);
      expect(keeper.snapshot().submitFailureCount).toBe(0);
    });
  }

  test("keeperAddress derives the EOA from the key", () => {
    const transport = new MockTransport(() => "0x0");
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
    expect(resolver.keeperAddress().startsWith("0x")).toBe(true);
    expect(resolver.keeperAddress().length).toBe(42);
  });
});

function eligibilityProof(eligible = 1n, orderingReady = 1n): string {
  return "0x" + [eligible, 0n, orderingReady].map(n => n.toString(16).padStart(64, "0")).join("");
}
