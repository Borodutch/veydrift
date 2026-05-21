import { describe, expect, test } from "bun:test";
import { ChainSyncService } from "./chainSync";
import type { BackendConfig } from "./config";
import type { SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";

const player = "0x2222222222222222222222222222222222222222";
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const debrisFieldUpdatedTopic = "0x49f79a15c2a0409be62598b886efd90e25154bb9156b4bd64df41fd515aa4909";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexFromBlock: 100n,
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "custom-url",
  wsRpcUrl: "wss://example.invalid/ws"
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  sent: string[] = [];
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.onclose?.(new Event("close"));
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  message(payload: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

describe("ChainSyncService", () => {
  test("subscribes to logs and new heads, then applies settlement logs to the indexer", () => {
    MockWebSocket.instances = [];
    const indexer = new SettlementIndexer(
      {
        async listDebrisFieldEvents() { return []; },
        async listSettledPlanetEvents(): Promise<SettledPlanetEvent[]> { return []; }
      },
      100n
    );
    const service = new ChainSyncService(config, indexer, { WebSocketCtor: MockWebSocket });

    service.start();
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toBe(config.wsRpcUrl);
    socket?.open();

    expect(socket?.sent.map((item) => JSON.parse(item).params[0])).toEqual(["logs", "newHeads"]);
    socket?.message({ id: 1, result: "logs-sub" });
    socket?.message({ id: 2, result: "heads-sub" });
    expect(service.snapshot()).toMatchObject({
      connected: true,
      subscribedToHeads: true,
      subscribedToLogs: true
    });

    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "heads-sub",
        result: { number: "0x7b" }
      }
    });
    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7c",
          transactionHash: "0xabc",
          topics: [
            planetStartedTopic,
            `0x${player.slice(2).padStart(64, "0")}`,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(2n, 44n, 9n, 211n, 1n)
        }
      }
    });

    expect(service.snapshot()).toMatchObject({
      eventsReceived: 1,
      latestSyncedBlock: "124"
    });
    expect(indexer.settledPlanetsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        owner: player,
        planetId: "7",
        position: 9
      })
    ]);

    socket?.message({
      method: "eth_subscription",
      params: {
        subscription: "logs-sub",
        result: {
          blockNumber: "0x7d",
          transactionHash: "0xdef",
          topics: [
            debrisFieldUpdatedTopic,
            `0x${(7n).toString(16).padStart(64, "0")}`
          ],
          data: abiWords(27_000n, 9_000n)
        }
      }
    });

    expect(indexer.debrisFieldsInSystem(2, 44)).toEqual([
      expect.objectContaining({
        planetId: "7",
        position: 9,
        resources: {
          metal: "27000",
          crystal: "9000"
        }
      })
    ]);

    service.stop();
  });

  test("reconnects after websocket close", async () => {
    MockWebSocket.instances = [];
    const service = new ChainSyncService(config, undefined, {
      WebSocketCtor: MockWebSocket,
      reconnectBaseMs: 1
    });

    service.start();
    MockWebSocket.instances[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(MockWebSocket.instances).toHaveLength(2);
    service.stop();
  });
});

function abiWords(...values: bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}
