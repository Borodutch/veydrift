import { describe, expect, test } from "bun:test";

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
