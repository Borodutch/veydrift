/** Local EVM regression for the production batch fee estimator. No public RPC or runtime key.
 * Run with NO_PROXY=127.0.0.1,localhost: bun scripts/mission-batch-anvil-proof.ts
 * after compiling VeydriftMissionBatch.t.sol. Fee values are synthetic, not live Base prices.
 * Only fee-oracle responses are fixtures; settlement, gas estimation and simulation run in Anvil.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, custom, decodeFunctionData, decodeFunctionResult, defineChain,
  encodeFunctionResult, http, parseAbi, type Hex } from "viem";
import { batchCalldata, defaultMissionBatchPolicy } from "../apps/backend/src/missionBatch";
import { quoteMissionBatch } from "../apps/backend/src/missionBatchFees";

const port = 18518;
const url = "http://127.0.0.1:" + port;
const artifact = JSON.parse(readFileSync(new URL("../packages/contracts/out/VeydriftMissionBatch.t.sol/BatchResolutionHarness.json", import.meta.url), "utf8"));
const game = "0x1111111111111111111111111111111111111111" as const;
const oracle = "0x420000000000000000000000000000000000000f";
const oracleAbi = parseAbi([
  "function getL1Fee(bytes) view returns(uint256)",
  "function getL1FeeUpperBound(uint256) view returns(uint256)",
  "function getOperatorFee(uint256) view returns(uint256)"
]);
// Refuse to attach to an existing service: this test must own its isolated local node.
try { await fetch(url, { signal: AbortSignal.timeout(300) }); throw new Error("test port is already in use"); }
catch (e) { if (e instanceof Error && e.message === "test port is already in use") throw e; }
const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "8453", "--gas-limit", "30000000", "--base-fee", "100", "--silent"], { stdout: "ignore", stderr: "pipe" });
try {
  const raw = http(url, { retryCount: 0, timeout: 5000 })({ chain: undefined }).request;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { assert.equal(await raw({ method: "eth_chainId" }), "0x2105"); ready = true; break; }
    catch { await Bun.sleep(100); }
  }
  assert(ready, "owned local Anvil did not start");
  const [account] = await raw({ method: "eth_accounts" }) as Hex[];
  assert(account);
  const client = createPublicClient({ transport: custom({ async request(request) {
    if (request.method === "eth_maxPriorityFeePerGas") return "0x64"; // synthetic fee fixture; fixed ETH cap unchanged
    const params = request.params as [{ to?: string; data?: Hex }] | undefined;
    const call = params?.[0];
    if (request.method === "eth_call" && call?.to?.toLowerCase() === oracle) {
      const decoded = decodeFunctionData({ abi: oracleAbi, data: call!.data! });
      const result = decoded.functionName === "getOperatorFee" ? 0n : 1000n;
      return encodeFunctionResult({ abi: oracleAbi, functionName: decoded.functionName, result } as never);
    }
    return raw(request as never);
  } }) });
  const chain = defineChain({ id: 8453, name: "local batch fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const wallet = createWalletClient({ account, transport: http(url), chain });
  // Link the compiler-declared helper library rather than accepting placeholder bytecode.
  const library = "0x3333333333333333333333333333333333333333";
  const moonArtifact = JSON.parse(readFileSync(new URL("../packages/contracts/out/VeydriftMoonIncarnation.sol/VeydriftMoonIncarnation.json", import.meta.url), "utf8"));
  assert.match(moonArtifact.deployedBytecode.object, /^0x[0-9a-f]+$/i);
  await raw({ method: "anvil_setCode", params: [library, moonArtifact.deployedBytecode.object] } as never);
  let runtime = artifact.deployedBytecode.object as string;
  const links = artifact.deployedBytecode.linkReferences;
  assert.deepEqual(Object.keys(links), ["src/libraries/VeydriftMoonIncarnation.sol"]);
  for (const link of links["src/libraries/VeydriftMoonIncarnation.sol"].VeydriftMoonIncarnation) {
    assert.equal(link.length, 20);
    runtime = runtime.slice(0, 2 + link.start * 2) + library.slice(2) + runtime.slice(2 + (link.start + 20) * 2);
  }
  assert.match(runtime, /^0x[0-9a-f]+$/i);
  await raw({ method: "anvil_setCode", params: [game, runtime] } as never);
  const outcomes = (data: Hex): number[] => {
    const result = decodeFunctionResult({ abi: artifact.abi, functionName: "resolveFleetMissionBatch", data }) as unknown[];
    assert(Array.isArray(result));
    const values = Array.isArray(result[0]) ? result[0] : result;
    assert(values.every(x => Number.isInteger(x) && Number(x) >= 0 && Number(x) <= 7));
    return values as number[];
  };
  const rows = [];
  for (const count of [1, 8, 32]) {
    const snapshot = await raw({ method: "evm_snapshot" } as never);
    const now = Math.floor(Date.now() / 1000);
    for (let id = 1; id <= count; id++) {
      const hash = await wallet.writeContract({ address: game, abi: artifact.abi, functionName: "seed",
        args: [BigInt(id), 0, 2, BigInt(id * 2), BigInt(id * 2 + 1), now - 20, now - 10], chain });
      assert.equal((await client.waitForTransactionReceipt({ hash })).status, "success");
    }
    const items = Array.from({ length: count }, (_, i) => ({ missionId: String(i + 1), leg: "return" as const, dueAt: now - 10 }));
    const data = batchCalldata(items);
    const naive = await client.estimateGas({ account, to: game, data });
    const naiveCall = await client.call({ account, to: game, data, gas: (naive * 120n + 99n) / 100n });
    const naiveResult = outcomes(naiveCall.data!);
    assert(naiveResult.some(x => x !== 0), "fixture must reproduce successful no-op estimation");
    const quote = await quoteMissionBatch(client, { items, nonce: await client.getTransactionCount({ address: account }),
      account, game, chainId: 8453, policy: { ...defaultMissionBatchPolicy, enabled: true, maxItems: 32 } });
    const selected = await client.call({ account, to: game, data, gas: quote.gas });
    const result = outcomes(selected.data!);
    console.log(JSON.stringify({ count, naiveGas: naive.toString(), selectedGas: quote.gas.toString(), outcomes: result }));
    assert.deepEqual(result, Array(count).fill(0), "selected exact gas must settle every independent fixture return");
    assert(quote.totalWei <= 200_000_000_000_000n);
    const hash = await wallet.sendTransaction({ to: game, data, gas: quote.gas, maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas, chain });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    for (let id = 1; id <= count; id++) assert.equal(await client.readContract({ address: game, abi: artifact.abi,
      functionName: "status", args: [BigInt(id)] }), 4);
    rows.push({ count, naiveGas: naive.toString(), selectedGas: quote.gas.toString(), actualGas: receipt.gasUsed.toString(),
      maxTotalFeeWei: quote.totalWei.toString(), settledLegs: count });
    assert.equal(await raw({ method: "evm_revert", params: [snapshot] } as never), true);
  }
  console.log(JSON.stringify({ proof: "local synthetic chronology harness; oracle fees are fixtures, not live Base quotes", rows }, null, 2));
} finally {
  node.kill();
  await node.exited;
}
