import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionResult, parseAbi, parseAbiParameters, toFunctionSelector, type Hex } from "viem";
import { VeydriftGameReader, type CanonicalFleetMissionSnapshot } from "./evm";
import { proofBattleReadSignatures, proofBattleRecordSchema } from "../../../packages/chain-abi/src/proofBattle";
const abi = parseAbi(proofBattleReadSignatures);
const hash = ("0x" + "a".repeat(64)) as Hex;
const game = "0x1111111111111111111111111111111111111111";
const words = (values: bigint[]) => "0x" + values.map(v => v.toString(16).padStart(64, "0")).join("");

for (const phase of [2, 11, 12, 16, 17]) {
  test("identified proof at stage " + phase + " remains unavailable on application getter outage, never legacy rounds", async () => {
    let batches = 0;
    let version = 3, bypass = false;
    const fake = { gameContractAddress: game,
      batchCallContract: async () => ++batches % 2 === 1 ? [words([phase === 2 ? 0n : 6n, 6n])] : [words([BigInt(phase), 6n, 42n])],
      transport: { async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_getBlockByNumber") return { number: "0x64", hash } as T;
        expect(params[1]).toEqual({ blockHash: hash, requireCanonical: true });
        const selector = (params[0] as { data: string }).data.slice(0, 10);
        if (selector === toFunctionSelector("stagedBattleProgress(uint256)")) return words([BigInt(phase), 6n, 42n]) as T;
        if (selector === toFunctionSelector("proofBattleRecord(uint256,uint8,uint256)")) return encodeFunctionResult({ abi,
          functionName: "proofBattleRecord", result: encodeAbiParameters(parseAbiParameters(proofBattleRecordSchema), [
            { version, rules: hash, catalog: hash, verifier: game, verifierCodehash: hash },
            bypass ? 4 : phase === 2 ? 1 : phase === 16 ? 2 : 3, hash, hash, 42n, 2n]) }) as T;
        throw new Error("settlement getter outage AFTER positive frozen record");
      } }
    };
    const enrich = (VeydriftGameReader.prototype as unknown as {
      withCanonicalCombatResolutionProgress(missions: CanonicalFleetMissionSnapshot[]): Promise<CanonicalFleetMissionSnapshot[]>;
    }).withCanonicalCombatResolutionProgress;
    const read = () => enrich.call(fake as unknown as VeydriftGameReader,
      [{ missionId: "1", status: "Outbound", missionType: "Attack" } as CanonicalFleetMissionSnapshot]);
    const result = (await read())[0]!;
    expect(result.proofBattleProgress).toEqual({ state: "unavailable", stagedPhase: phase });
    expect(result.combatResolutionProgress).toBeUndefined();
    if ([2, 11, 12].includes(phase)) {
      version = 0;
      expect((await read())[0]?.combatResolutionProgress).toEqual({ roundsCompleted: phase === 2 ? 0 : 6, totalRounds: 6 });
      version = 3; bypass = true;
      expect((await read())[0]?.proofBattleProgress).toBeUndefined();
      expect((await read())[0]?.combatResolutionProgress).toBeDefined();
    }
  });
}
