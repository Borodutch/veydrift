import { describe, expect, test } from "bun:test";
import { applyMissionEligibility, missionEligibilityPath } from "./missionEligibility";
import { VeydriftGameReader, type FleetMissionSummary, type HttpJsonRpcTransport } from "./evm";
import type { BackendConfig } from "./config";

function mission(missionId: string, overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary {
  return { missionId, status: "Outbound", missionType: "Transport", arrivalAt: "100", returnAt: "200",
    needsResolution: true, ...overrides } as FleetMissionSummary;
}

describe("authoritative mission eligibility", () => {
  test("uses the exact permissionless entrypoint and never sends a transaction", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const transport = { async request(method: string, params: unknown[]) {
      calls.push([method, params]); return "0x";
    } } as Pick<HttpJsonRpcTransport, "request">;
    const config: BackendConfig = {
      chainId: 84532, deploymentMode: "test", qaSyntheticStationedDefenders: false,
      gameContractAddress: "0x1111111111111111111111111111111111111111", indexDbPath: ":memory:",
      randomnessCommitmentStorePath: ".data/test-randomness.json", indexFromBlock: 0n,
      missionResolutionEnabled: false, resourceTokenAddresses: {}, rpcSource: "custom-url",
      rpcUrl: "https://rpc.invalid", wsRpcSource: "missing"
    };
    const reader = new VeydriftGameReader(config, transport);
    expect(await reader.canResolveFleetMission(93790n, "arrival")).toBe(true);
    expect(await reader.canResolveFleetMission(93742n, "return")).toBe(true);
    expect(calls).toEqual([
      ["eth_call", [{ to: "0x1111111111111111111111111111111111111111", data: "0xde09e7cf" + 93790n.toString(16).padStart(64, "0") }, "latest"]],
      ["eth_call", [{ to: "0x1111111111111111111111111111111111111111", data: "0xc2472852" + 93742n.toString(16).padStart(64, "0") }, "latest"]]
    ]);
  });

  test("reverted earlier-event dependencies, unknown readers and transport errors fail closed", async () => {
    for (const reader of [undefined, {}, { async canResolveFleetMission() { return false; } },
      { async canResolveFleetMission() { throw new Error("FleetMissionNotResolved"); } }]) {
      const arrival = mission("93790");
      const returning = mission("93742", { status: "Returning" });
      await applyMissionEligibility({ outgoing: [arrival], returning: [returning] }, reader, 300);
      expect(arrival).toMatchObject({ needsResolution: false, resolutionEligible: false });
      expect(returning).toMatchObject({ status: "Returning", needsResolution: false, resolutionEligible: false });
    }
  });

  test("private earlier dependencies and moon/planet identity are decided by the contract, not the visible list", async () => {
    const later = mission("1", { targetPlanetId: "164", targetIsMoon: true });
    const independent = mission("2", { targetPlanetId: "164", targetIsMoon: false });
    const returning = mission("93742", { status: "Recalled", returnAt: "1790592545" });
    const calls: string[] = [];
    await applyMissionEligibility({ fleetVisibility: { outgoing: [later, independent], returning: [returning] } }, {
      async canResolveFleetMission(id, leg) { calls.push(id + ":" + leg); return id !== 1n; }
    }, 1790592555);
    expect(later.needsResolution).toBe(false);
    expect(independent.needsResolution).toBe(true);
    expect(returning).toMatchObject({ status: "Recalled", resolutionEligible: true, needsResolution: false });
    expect(calls).toEqual(["1:arrival", "2:arrival", "93742:return"]);
  });

  test("honors hold due times, omits future/terminal legs and deduplicates repeated feed entries", async () => {
    const hold = mission("1", { missionType: "DefenseHold", defenseHoldUntil: "400" });
    const future = mission("2", { arrivalAt: "400" });
    const terminal = mission("3", { status: "Returned" });
    const ready = mission("4");
    const duplicate = { ...ready };
    const calls: bigint[] = [];
    await applyMissionEligibility({ mission: ready, outgoing: [hold, future, terminal], rows: [{ mission: duplicate }] }, {
      async canResolveFleetMission(id) { calls.push(id); return true; }
    }, 300);
    expect(calls).toEqual([4n]);
    expect(duplicate.resolutionEligible).toBe(true);
    expect(hold.resolutionEligible).toBe(false);
    expect(future.resolutionEligible).toBe(false);
    expect(terminal.resolutionEligible).toBe(false);
  });

  test("bounds the RPC fan-out and keeps overflow ineligible", async () => {
    let active = 0, maxActive = 0, total = 0;
    const missions = Array.from({ length: 100 }, (_, i) => mission(String(i + 1)));
    await applyMissionEligibility({ missions }, { async canResolveFleetMission() {
      total++; active++; maxActive = Math.max(active, maxActive);
      await Promise.resolve(); active--; return true;
    } }, 300);
    expect(total).toBe(64);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(missions.filter(m => m.resolutionEligible)).toHaveLength(64);
    expect(missions[99]!.needsResolution).toBe(false);
  });

  test("slow RPC fails closed within the response deadline without late mutations", async () => {
    let release!: (value: boolean) => void;
    const blocked = mission("1");
    await applyMissionEligibility({ mission: blocked }, { canResolveFleetMission() {
      return new Promise<boolean>(resolve => { release = resolve; });
    } }, 300, 5);
    expect(blocked.resolutionEligible).toBe(false);
    release(true);
    await Promise.resolve();
    expect(blocked.resolutionEligible).toBe(false);
  });

  test("covers every public mission-bearing endpoint", () => {
    for (const path of ["/missions", "/mission/93742", "/wallet/0x123/fleet-visibility", "/wallet/0x123/overview", "/wallet/0x123/missions"]) expect(missionEligibilityPath(path)).toBe(true);
    expect(missionEligibilityPath("/wallet/0x123/queues")).toBe(false);
  });
});
