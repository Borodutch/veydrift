import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, encodeAbiParameters, encodeFunctionResult, toHex, keccak256, type Hex } from "viem";
import { prepareRecoveryEnvelope } from "./missionLegacyRecovery";
import { verifyReviewedRecoveryManifest } from "./missionLegacyRecoveryCli";
import { missionBatchAbi, defaultMissionBatchPolicy } from "./missionBatch";

const actual = verifyReviewedRecoveryManifest(readFileSync(new URL("../../../docs/recovery-58-input.json", import.meta.url), "utf8"));
const hash = ("0x" + "aa".repeat(32)) as Hex, otherHash = ("0x" + "bb".repeat(32)) as Hex;
const abi = parseAbi(["function fleetMission(uint256) view returns (uint8,uint8,address,uint256,uint256,uint64,uint64,uint64,uint128,(uint128 metal,uint128 crystal,uint128 deuterium),uint256)"]);

for (const mode of ["base-paced", "reference", "implementation", "head", "canonical"] as const) {
  test("bounded recovery proof through real viem HTTP codecs: " + mode, async () => {
    const originalFetch = globalThis.fetch;
    const input = { ...actual, identities: actual.identities.map(identity => ({ ...identity, codeHash: keccak256("0x6000") })) };
    const mission = encodeFunctionResult({ abi, functionName: "fleetMission", result: [2, 0, input.mission.owner,
      BigInt(input.mission.origin), BigInt(input.mission.target), 1n, 2n, BigInt(input.mission.returnAt), 16n,
      { metal: 0n, crystal: 0n, deuterium: 0n }, 0n] });
    const base = BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [99306n, 24n])));
    let simulated = false, reads = 0, active = 0, peak = 0;
    const started = performance.now();
    // Real HTTP encoding/decoding with synthetic responses only, never real network/signing.
    globalThis.fetch = (async (url, init) => {
      expect(["https://local.invalid", new URL(input.referenceRpcUrl).origin]).toContain(new URL(String(url)).origin);
      const q = JSON.parse(init!.body as string);
      const reference = new URL(String(url)).origin === new URL(input.referenceRpcUrl).origin;
      reads++; active++; peak = Math.max(peak, active);
      try {
        if (mode === "base-paced") await new Promise(resolve => setTimeout(resolve, 40));
        let result: unknown;
        if (q.method === "eth_chainId") result = "0x2105";
        else if (q.method === "eth_getTransactionCount") {
          expect(q.params[1]).toBe("0x1");
          result = toHex(reference && simulated && mode === "reference" ? input.nonce + 1 : input.nonce);
        } else if (q.method === "eth_getBlockByNumber") {
          const moved = q.params[0] === "latest" && ((simulated && mode === "head") || (mode === "base-paced" && performance.now() - started >= 2000));
          result = { number: moved ? "0x2" : "0x1", hash: moved || (simulated && mode === "canonical") ? otherHash : hash,
            timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: "0x64", gasLimit: "0x1c9c380", transactions: [] };
        } else if (q.method === "eth_getStorageAt") {
          expect(q.params[2]).toBe("0x1");
          const slot = q.params[1];
          result = slot.startsWith("0x360894") ? toHex(BigInt(simulated && mode === "implementation" ? "0x99" : input.implementation), { size: 32 })
            : BigInt(slot) === base + 7n ? input.mission.shipsWords[0] : BigInt(slot) === base + 8n ? input.mission.shipsWords[1] : input.mission.bodyFlags;
        } else if (q.method === "eth_getCode") { expect(q.params[1]).toBe("0x1"); result = "0x6000"; }
        else if (q.method === "eth_getBalance") { expect(q.params[1]).toBe("0x1"); result = toHex(10n ** 18n); }
        else if (q.method === "eth_maxPriorityFeePerGas") result = "0xa";
        else if (q.method === "eth_call") {
          expect(q.params[1]).toBe("0x1");
          const data = q.params[0].data;
          if (data.startsWith("0xf158c946")) result = mission;
          else if (data.startsWith("0x5fca0af0")) {
            simulated = true;
            result = encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", result: [[0], 100000n] });
          } else result = toHex(100n, { size: 32 });
        } else throw new Error("unexpected RPC " + q.method);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }), { headers: { "content-type": "application/json" } });
      } finally { active--; }
    }) as typeof fetch;
    try {
      const client = createPublicClient({ transport: http("https://local.invalid", { retryCount: 0 }) });
      let charged = 0;
      const pass = { assertActive: () => { if (performance.now() - started >= 5000) throw new Error("deadline"); },
        read: async <T>(operation: () => Promise<T>) => { if (++charged > 128) throw new Error("budget"); return operation(); } };
      const proof = async () => {
        const prepared = await prepareRecoveryEnvelope(client, input, defaultMissionBatchPolicy, pass);
        await prepared.guard.finalCheck!(); prepared.guard();
      };
      if (mode === "base-paced") {
        await proof();
        expect(reads).toBe(63); expect(charged).toBe(63); expect(peak).toBe(8);
        expect(performance.now() - started).toBeLessThan(2000);
      } else await expect(proof()).rejects.toThrow(mode === "reference" ? "nonce disagreement" : mode === "implementation" ? "implementation changed" : mode === "canonical" ? "block changed" : "head moved");
      expect(active).toBe(0); expect(peak).toBeLessThanOrEqual(8);
    } finally { globalThis.fetch = originalFetch; }
  });
}
