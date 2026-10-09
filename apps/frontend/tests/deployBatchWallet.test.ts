import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters, toFunctionSelector } from "viem";
import {
  defaultVeydriftChainForLocation,
  BASE_MAINNET,
  configureWalletTransactionTransport,
  sendLaunchTransportBatchTransaction,
  encodeLaunchDeployBatchCall,
  encodeLaunchTransportBatchCall,
  sendLaunchDeployBatchTransaction,
  sendLaunchBodySupplyBatchTransaction,
  encodeLaunchBodyDeployBatchCall,
  encodeLaunchBodyTransportBatchCall,
  type BatchTransportOrder,
} from "../src/walletFlow";

const ships = {
  smallCargo: 0, lightFighter: 0, recycler: 0, colonyShip: 0, largeCargo: 0,
  heavyFighter: 0, cruiser: 0, battleship: 0, bomber: 0, destroyer: 0,
  deathstar: 0, battlecruiser: 0, reaper: 0, pathfinder: 0,
};
const orders: BatchTransportOrder[] = [
  { originPlanetId: "1", ships: { ...ships, smallCargo: 2, lightFighter: 3 }, cargo: { metal: 0, crystal: 0, deuterium: 0 }, speedPercent: 100 },
  { originPlanetId: "2", ships: { ...ships, recycler: 4, battleship: 5, pathfinder: 6 }, cargo: { metal: 7, crystal: 8, deuterium: 9 }, speedPercent: 70 },
];
const params = { targetPlanetId: "9", orders };
const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";

describe("atomic planet Deploy wallet calls", () => {
  test("simulates exact calldata then sends one transaction on the required chain", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const hash = await sendLaunchDeployBatchTransaction({ request: async <T>(call: { method: string; params?: unknown[] }) => {
      calls.push(call);
      if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
      if (call.method === "eth_call") return "0x" as T;
      if (call.method === "eth_estimateGas") return "0xf4240" as T;
      if (call.method === "eth_sendTransaction") return "0xfixture" as T;
      throw new Error(call.method);
    } }, account, contract, params);
    expect(hash).toBe("0xfixture");
    const simulations = calls.filter(call => call.method === "eth_call");
    const submissions = calls.filter(call => call.method === "eth_sendTransaction");
    expect(simulations).toHaveLength(1);
    expect(submissions).toHaveLength(1);
    const transaction = { from: account, to: contract, data: encodeLaunchDeployBatchCall(params) };
    expect(simulations[0]!.params).toEqual([transaction, "pending"]);
    expect(submissions[0]!.params).toEqual([{ ...transaction, gas: "0x124f80", chainId: defaultVeydriftChainForLocation().chainIdHex }]);
    const estimates = calls.filter(call => call.method === "eth_estimateGas");
    expect(estimates).toHaveLength(1);
    expect(estimates[0]!.params).toEqual([{ ...transaction, gas: "0x1000000" }]);
    expect(calls.indexOf(simulations[0]!)).toBeLessThan(calls.indexOf(estimates[0]!));
    expect(calls.indexOf(estimates[0]!)).toBeLessThan(calls.indexOf(submissions[0]!));
  });

  test("classifies batch deploy as fleet calldata and never submits a reverted simulation", async () => {
    let submissions = 0;
    await expect(sendLaunchDeployBatchTransaction({ request: async <T>(call: { method: string; params?: unknown[] }) => {
      if (call.method === "eth_chainId") return defaultVeydriftChainForLocation().chainIdHex as T;
      if (call.method === "eth_call") throw { code: 3, data: "0xdfa1a408", message: "execution reverted" };
      if (call.method === "eth_sendTransaction") submissions++;
      throw new Error(call.method);
    } }, account, contract, params)).rejects.toThrow("The selected mission or target no longer matches current chain state.");
    expect(submissions).toBe(0);
  });

  test("canonical selector and complete per-source tuples preserve zero cargo, mixed ships and speed", () => {
    const data = encodeLaunchDeployBatchCall(params);
    expect(data.slice(0, 10)).toBe(toFunctionSelector("launchDeployBatch(uint256,(uint256,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16)[])"));
    expect(data.slice(0, 10)).toBe("0xc47915ea");
    expect(data.slice(10)).toBe(encodeLaunchTransportBatchCall(params).slice(10));
    const words = decodeAbiParameters(parseAbiParameters("uint256[41]"), ("0x" + data.slice(10)) as `0x${string}`)[0];
    expect(words.slice(0, 3)).toEqual([9n, 64n, 2n]);
    for (const [i, order] of orders.entries()) {
      const offset = 3 + i * 19;
      expect(words[offset]).toBe(BigInt(order.originPlanetId));
      expect(words.slice(offset + 1, offset + 15)).toEqual(Object.values(order.ships).map(BigInt));
      expect(words.slice(offset + 15, offset + 19)).toEqual([...Object.values(order.cargo).map(BigInt), BigInt(order.speedPercent)]);
    }
  });
});

// No live RPC or wallet: both signing-provider fallback and configured app RPC.
for (const [mission, send, encode] of [
  ["deploy", sendLaunchDeployBatchTransaction, encodeLaunchDeployBatchCall],
  ["transport", sendLaunchTransportBatchTransaction, encodeLaunchTransportBatchCall],
  ["moon deploy", (p, a, c, args) => sendLaunchBodySupplyBatchTransaction(p, a, c, args, "deploy"), encodeLaunchBodyDeployBatchCall],
  ["moon transport", (p, a, c, args) => sendLaunchBodySupplyBatchTransaction(p, a, c, args, "transport"), encodeLaunchBodyTransportBatchCall],
] as const) {
  for (const appRpc of [false, true]) for (const gas of ["0x1000000", "0x1000001", "0x1249431", "0x", "0x0", "error"] as const) {
    test(mission + " gas admission " + gas + (appRpc ? " via app RPC" : " via provider"), async () => {
      const calls: Array<{ method: string; params?: unknown[] }> = [];
      const rpcCalls: Array<{ method: string; params?: unknown[] }> = [];
      const chain = appRpc ? BASE_MAINNET : defaultVeydriftChainForLocation();
      const readRpc = (call: { method: string; params?: unknown[] }) => {
        if (call.method === "eth_chainId") return chain.chainIdHex;
        if (call.method === "eth_call") return (call.params?.[0] as { data: string }).data === toFunctionSelector("moonSupplyBatchVersion()") ? "0x" + "0".repeat(63) + "1" : "0x";
        if (call.method === "eth_estimateGas") {
          if (gas === "error") throw new Error("gas required exceeds allowance (16777216)");
          return gas;
        }
        throw new Error(call.method);
      };
      const provider = { request: async <T>(call: { method: string; params?: unknown[] }) => {
        calls.push(call);
        if (call.method === "eth_sendTransaction") return "0xfixture" as T;
        if (appRpc && call.method !== "eth_chainId") throw new Error("Reads must use app RPC");
        return readRpc(call) as T;
      } };
      const originalFetch = globalThis.fetch;
      if (appRpc) {
        configureWalletTransactionTransport(provider, "injected", "https://batch-gas.example.test", chain);
        globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
          const call = JSON.parse(String(init?.body));
          rpcCalls.push(call);
          try { return Response.json({ result: readRpc(call) }); }
          catch (error) { return Response.json({ error: { code: -32000, message: (error as Error).message } }); }
        }) as typeof fetch;
      }
      try {
        const result = send(provider, account, contract, params);
        if (gas === "0x1000000") await expect(result).resolves.toBe("0xfixture");
        else await expect(result).rejects.toThrow("Reduce selected sources");
        const reads = appRpc ? rpcCalls : calls;
        expect(reads.filter(call => call.method === "eth_estimateGas").map(call => call.params)).toEqual([
          [{ from: account, to: contract, data: encode(params), gas: "0x1000000" }],
        ]);
        const submissions = calls.filter(call => call.method === "eth_sendTransaction");
        expect(submissions).toHaveLength(gas === "0x1000000" ? 1 : 0);
        if (submissions.length) expect(submissions[0]!.params).toEqual([
          { from: account, to: contract, data: encode(params), gas: "0x1000000", chainId: chain.chainIdHex },
        ]);
      } finally { globalThis.fetch = originalFetch; }
    });
  }
}
