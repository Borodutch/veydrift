import { describe, expect, test } from "bun:test";
import { decodeAbiParameters, parseAbiParameters, toFunctionSelector } from "viem";
import {
  defaultVeydriftChainForLocation,
  encodeLaunchDeployBatchCall,
  encodeLaunchTransportBatchCall,
  sendLaunchDeployBatchTransaction,
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
    expect(submissions[0]!.params).toEqual([{ ...transaction, chainId: defaultVeydriftChainForLocation().chainIdHex }]);
    expect(calls.indexOf(simulations[0]!)).toBeLessThan(calls.indexOf(submissions[0]!));
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
