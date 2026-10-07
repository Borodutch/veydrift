import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionResult, parseAbi, parseAbiParameters, toFunctionSelector, type Hex } from "viem";
import { readProofBattleStatus } from "./proofBattleProgress";
import { applyMissionEligibility } from "./missionEligibility";
import type { FleetMissionSummary } from "./evm";
const game = "0x1111111111111111111111111111111111111111";
const hash = ("0x" + "a".repeat(64)) as Hex;
const abi = parseAbi(["function proofBattleRecord(uint256,uint8,uint256) view returns (bytes)"]);
const params = parseAbiParameters("(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash),uint8,bytes32,bytes32,uint256,uint256");
test("pinned proof status separates preparation, waits, applying and unfinished economics without synthetic rounds", async () => {
  let staged = 2, phase = 1, application = 0, cursor = 0n, outage = false;
  const transport = { async request<T>(method: string, args: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash } as T;
    expect(args[1]).toEqual({ blockHash: hash, requireCanonical: true });
    if (outage) throw new Error("canonical block removed");
    const selector = (args[0] as { data: string }).data.slice(0, 10);
    if (selector === toFunctionSelector("stagedBattleProgress(uint256)"))
      return encodeAbiParameters(parseAbiParameters("uint8,uint8,uint256"), [staged, 0, 1n]) as T;
    if (selector === toFunctionSelector("proofSettlementProgress(uint256)"))
      return encodeAbiParameters(parseAbiParameters("uint8,uint256,uint256,bytes32"), [application, cursor, 2n, hash]) as T;
    return encodeFunctionResult({ abi, functionName: "proofBattleRecord", result: encodeAbiParameters(params,
      [{ version: 3, rules: hash, catalog: hash, verifier: game, verifierCodehash: hash }, phase, hash, hash, 1n, 2n]) }) as T;
  } };
  const read = () => readProofBattleStatus(transport, game, 1n);
  expect((await read())?.state).toBe("preparing");
  staged = 16; phase = 2; expect((await read())?.state).toBe("randomness-wait");
  staged = 17; phase = 3; expect((await read())?.state).toBe("proving");
  application = 1; cursor = 1n;
  expect(await read()).toEqual({ state: "applying", stagedPhase: 17, blockNumber: "100", blockHash: hash, nextIndex: "1", memberCount: "2" });
  staged = 11; application = 2; cursor = 2n; expect((await read())?.state).toBe("economics");
  staged = 12; expect((await read())?.state).toBe("economics");
  staged = 13; expect(await read()).toBeUndefined();
  staged = 17; application = 1; cursor = 1n; expect((await read())?.state).toBe("applying"); // rollback, not max(stage)
  outage = true; await expect(read()).rejects.toThrow("removed");
});
test("proof waits do not advertise manual resolve; independent transport/deploy and returns still check eligibility", async () => {
  let calls = 0;
  const missions = ["randomness-wait", "proving", "applying", "unavailable"].map((state, i) => ({
    missionId: String(i + 1), missionType: "Attack", status: "Outbound", arrivalAt: "1", returnAt: "2",
    proofBattleProgress: { state, stagedPhase: 17 } } as FleetMissionSummary));
  missions.push(...["Transport", "Deploy"].map((missionType, i) => ({ missionId: String(i + 10), missionType,
    status: "Outbound", arrivalAt: "1", returnAt: "2" } as FleetMissionSummary)));
  await applyMissionEligibility({ missions }, { canResolveFleetMission: async () => { calls++; return true; } }, 100);
  expect(calls).toBe(2);
  expect(missions.slice(0, 4).every(m => !m.needsResolution)).toBe(true);
  expect(missions.slice(4).every(m => m.needsResolution)).toBe(true);
});
