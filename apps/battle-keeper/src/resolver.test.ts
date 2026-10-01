import { describe, expect, test } from "bun:test";
import { parseTransaction } from "viem";

import {
  completeFleetMissionReturnSelector,
  encodeCompleteFleetMissionReturnCall,
  encodeResolveFleetMissionCall,
  MissionNotResolvableError,
  resolveFleetMissionSelector,
  settlementGasLimit,
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
  test("simulate-revert surfaces as MissionNotResolvableError without sending a tx", async () => {
    const transport = new MockTransport((method) => {
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
    const transport = new MockTransport((method) => {
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
    const transport = new MockTransport((method) => {
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

  test("keeperAddress derives the EOA from the key", () => {
    const transport = new MockTransport(() => "0x0");
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 84532);
    expect(resolver.keeperAddress().startsWith("0x")).toBe(true);
    expect(resolver.keeperAddress().length).toBe(42);
  });
});


describe("bounded staged settlement envelope", () => {
  function transportFor(overrides: Responder = () => undefined): MockTransport {
    return new MockTransport((method, params) => {
      const override = overrides(method, params);
      if (override !== undefined) return override;
      switch (method) {
        case "eth_call": return "0x";
        case "eth_estimateGas": return "0x5208";
        case "eth_getTransactionCount": return "0x0";
        case "eth_getBlockByNumber": return { baseFeePerGas: "0x1" };
        case "eth_maxPriorityFeePerGas": return "0x1";
        case "eth_sendRawTransaction": return "0xdeadbeef";
        case "eth_getTransactionReceipt": return { status: "0x1" };
        default: throw new Error(method);
      }
    });
  }

  for (const estimate of [21_000n, 14_900_000n, settlementGasLimit]) {
    test(`arrival estimate ${estimate} uses full safe budget and exact preflight`, async () => {
      const transport = transportFor((method) => method === "eth_estimateGas"
        ? `0x${estimate.toString(16)}` : undefined);
      await new ViemMissionResolver(transport, testKey, gameContract, 8453).resolveMission("1");
      const send = transport.calls.find((call) => call.method === "eth_sendRawTransaction")!;
      const signed = parseTransaction(send.params[0] as `0x${string}`);
      expect(signed.gas).toBe(settlementGasLimit);
      expect(signed.gas).toBeLessThan(16_777_216n);
      const calls = transport.calls.filter((call) => call.method === "eth_call");
      expect(calls).toHaveLength(2);
      const preflight = calls[1]!.params[0] as Record<string, string>;
      expect(BigInt(preflight.gas!)).toBe(signed.gas!);
      expect(preflight.data).toBe(signed.data!);
      expect(preflight.to?.toLowerCase()).toBe(signed.to?.toLowerCase());
      expect(BigInt(preflight.maxFeePerGas!)).toBe(signed.maxFeePerGas!);
      expect(BigInt(preflight.maxPriorityFeePerGas!)).toBe(signed.maxPriorityFeePerGas!);
      expect(Number(BigInt(preflight.nonce!))).toBe(signed.nonce!);
      const estimateCall = transport.calls.find((call) => call.method === "eth_estimateGas")!;
      expect(BigInt((estimateCall.params[0] as { gas: string }).gas)).toBe(settlementGasLimit);
    });
  }

  test("durable intent hook runs after exact preflight and blocks signing on failure", async () => {
    const transport = transportFor();
    const resolver = new ViemMissionResolver(transport, testKey, gameContract, 8453);
    await expect(resolver.resolveMission("1", "arrival", async () => {
      expect(transport.methodCalls("eth_call")).toBe(2);
      expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
      throw new Error("journal unavailable");
    })).rejects.toThrow("journal unavailable");
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
  });

  test("over-ceiling estimate never signs/broadcasts", async () => {
    const transport = transportFor((method) => method === "eth_estimateGas"
      ? `0x${(settlementGasLimit + 1n).toString(16)}` : undefined);
    await expect(new ViemMissionResolver(transport, testKey, gameContract, 8453)
      .resolveMission("1")).rejects.toBeInstanceOf(MissionNotResolvableError);
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
  });

  test("exact-envelope preflight failure never broadcasts", async () => {
    const transport = transportFor((method, params) => method === "eth_call"
      && "nonce" in (params[0] as object) ? new Error("out of gas") : undefined);
    await expect(new ViemMissionResolver(transport, testKey, gameContract, 8453)
      .resolveMission("1")).rejects.toBeInstanceOf(MissionNotResolvableError);
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
  });

  test("restart with pending keeper nonce never queues another stage", async () => {
    const transport = transportFor((method, params) => method === "eth_getTransactionCount"
      ? params[1] === "pending" ? "0x1" : "0x0" : undefined);
    await expect(new ViemMissionResolver(transport, testKey, gameContract, 8453)
      .resolveMission("1")).rejects.toThrow("keeper transaction still pending");
    expect(transport.methodCalls("eth_sendRawTransaction")).toBe(0);
  });

  test("return buffer is capped and preflighted rather than exceeding Base envelope", async () => {
    const transport = transportFor((method) => method === "eth_estimateGas" ? "0xe35fa0" : undefined);
    await new ViemMissionResolver(transport, testKey, gameContract, 8453).resolveMission("1", "return");
    const send = transport.calls.find((call) => call.method === "eth_sendRawTransaction")!;
    expect(parseTransaction(send.params[0] as `0x${string}`).gas).toBe(settlementGasLimit);
  });
});
