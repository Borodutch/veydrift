/** LOCAL synthetic full-Game/proxy proof. First export with:
 * cd packages/contracts && VEY918_EXPORT_FIXTURE=true forge test --match-test testExportMixedProxyFixture
 * Then (repo root): NO_PROXY=127.0.0.1,localhost bun scripts/mission-batch-mixed-proxy-proof.ts
 * No public RPC, keys, runtime code relocation, production signing, or raised batch/fee caps.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, custom, decodeFunctionData, decodeFunctionResult,
  decodeAbiParameters, decodeEventLog, defineChain, encodeFunctionResult, http, keccak256, parseAbi,
  parseAbiParameters, toHex, type Hex } from "viem";
import { batchCalldata, defaultMissionBatchPolicy, missionBatchAbi, packMissionBatch, type BatchLeg } from "../apps/backend/src/missionBatch";
import { quoteMissionBatch } from "../apps/backend/src/missionBatchFees";

assert.equal(Bun.version, "1.1.42", "use revision-pinned Bun");
const root = new URL("../packages/contracts/", import.meta.url);
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const alloc = load("manifests/vey918-mixed-alloc.json");
const meta = load("manifests/vey918-mixed-meta.json");
const artifact = load("out/VeydriftGame.sol/VeydriftGame.json");
const batchArtifact = load("out/VeydriftBatchTransportModule.sol/VeydriftBatchTransportModule.json");
const game = meta.game as Hex;
const implementationSlot = toHex(BigInt(keccak256(toHex("eip1967.proxy.implementation"))) - 1n, { size: 32 });
assert.equal(alloc[game.toLowerCase()].storage[implementationSlot].slice(-40), meta.implementation.slice(2).toLowerCase());
assert(alloc[meta.implementation.toLowerCase()].code.length > 40_000);
// Verify compiled runtime correspondence while masking ONLY compiler-declared link/immutable
// ranges. Every linked address must itself exist in this exact exported allocation.
const runtimeArtifacts: any[] = [];
for (const directory of readdirSync(new URL("out/", root))) {
  if (!directory.endsWith(".sol")) continue;
  for (const file of readdirSync(new URL("out/" + directory + "/", root))) {
    if (file.endsWith(".json")) runtimeArtifacts.push(load("out/" + directory + "/" + file));
  }
}
for (const [address, state] of Object.entries(alloc) as [string, { code: Hex }][]) {
  if (state.code === "0x") continue;
  assert(runtimeArtifacts.some(a => {
    let compiled = a.deployedBytecode?.object;
    if (!compiled || compiled.length !== state.code.length) return false;
    let actual: string = state.code;
    const links = Object.values(a.deployedBytecode.linkReferences ?? {}).flatMap((v: any) => Object.values(v).flat()) as {start: number; length: number}[];
    if (links.some(x => !alloc[("0x" + actual.slice(2 + x.start * 2, 2 + (x.start + x.length) * 2)).toLowerCase()]?.code?.match(/^0x[0-9a-f]+$/))) return false;
    const ranges = [...links, ...Object.values(a.deployedBytecode.immutableReferences ?? {}).flat()] as {start: number; length: number}[];
    for (const x of ranges) {
      const begin = 2 + x.start * 2, end = begin + x.length * 2;
      compiled = compiled.slice(0, begin) + "0".repeat(x.length * 2) + compiled.slice(end);
      actual = actual.slice(0, begin) + "0".repeat(x.length * 2) + actual.slice(end);
    }
    return actual.toLowerCase() === compiled.toLowerCase();
  }), "unmatched compiled runtime or missing linked dependency: " + address);
}
const directory = mkdtempSync(join(tmpdir(), "vey918-mixed-"));
const genesis = join(directory, "genesis.json");
// vm.dumpState is documented as genesis allocs; preserve every address, bytecode and storage word.
// Only the genesis clock advances to wall time: all synthetic legs are overdue, fee freshness is real.
writeFileSync(genesis, JSON.stringify({ config: { chainId: 8453 }, timestamp: toHex(Math.floor(Date.now() / 1000)), alloc }));
const url = "http://127.0.0.1:18518";
assert.equal(new URL(url).hostname, "127.0.0.1");
assert.equal(new URL(url).protocol, "http:");
try { await fetch(url, { signal: AbortSignal.timeout(300) }); throw new Error("test port occupied"); }
catch (e) { if (e instanceof Error && e.message === "test port occupied") throw e; }
const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18518", "--init", genesis,
  "--chain-id", "8453", "--gas-limit", "16777216", "--base-fee", "100", "--silent"], { stdout: "ignore", stderr: "inherit" });
const stringify = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x, 2);
try {
  const raw = http(url, { retryCount: 0, timeout: 10_000 })({ chain: undefined }).request;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { assert.equal(await raw({ method: "eth_chainId" }), "0x2105"); ready = true; break; }
    catch { await Bun.sleep(100); }
  }
  assert(ready, "owned Anvil did not start");
  const [account] = await raw({ method: "eth_accounts" }) as Hex[];
  const feed = "0x2222222222222222222222222222222222222222" as Hex;
  const oracle = "0x420000000000000000000000000000000000000f";
  const oracleAbi = parseAbi(["function decimals() view returns(uint8)",
    "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
    "function getL1Fee(bytes) view returns(uint256)", "function getL1FeeUpperBound(uint256) view returns(uint256)",
    "function getOperatorFee(uint256) view returns(uint256)"]);
  const syntheticInputs = { ethUsd: 3000_00000000n, decimals: 8, l1ExactWei: 1000n, l1UpperWei: 2000n, operatorWei: 300n, tipWei: 100n };
  const client = createPublicClient({ transport: custom({ async request(request) {
    if (request.method === "eth_maxPriorityFeePerGas") return toHex(syntheticInputs.tipWei);
    const call = (request.params as [{ to?: string; data?: Hex }] | undefined)?.[0];
    if (request.method === "eth_call" && [feed, oracle].includes(call?.to?.toLowerCase() ?? "")) {
      const { functionName } = decodeFunctionData({ abi: oracleAbi, data: call!.data! });
      const now = BigInt(Math.floor(Date.now() / 1000));
      const result = functionName === "decimals" ? syntheticInputs.decimals
        : functionName === "latestRoundData" ? [1n, syntheticInputs.ethUsd, now, now, 1n]
        : functionName === "getOperatorFee" ? syntheticInputs.operatorWei
        : functionName === "getL1FeeUpperBound" ? syntheticInputs.l1UpperWei : syntheticInputs.l1ExactWei;
      return encodeFunctionResult({ abi: oracleAbi, functionName, result } as never);
    }
    return raw(request as never);
  } }) });
  const chain = defineChain({ id: 8453, name: "synthetic owned local fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const wallet = createWalletClient({ account, transport: http(url), chain });
  // Exact dump import checks include compiled proxy runtime and linked/immutable module runtimes.
  for (const [address, state] of Object.entries(alloc) as [Hex, { code?: Hex }][]) {
    if (state.code && state.code !== "0x") assert.equal(await client.getCode({ address }), state.code);
  }
  assert.equal((await client.getStorageAt({ address: game, slot: implementationSlot }))?.slice(-40), meta.implementation.slice(2).toLowerCase());
  const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: game, abi: artifact.abi, functionName, args } as never) as Promise<any>;
  const mission = (id: number) => read("fleetMission", [BigInt(id)]);
  const state = async () => ({ missions: await Promise.all([meta.battleId, meta.counterplayId, ...meta.returnIds].map(async (id: number) => ({ id, values: await mission(id) }))), progress: await read("battleResolutionProgress", [BigInt(meta.battleId)]) });
  const before = await state();
  const initialBlock = await client.getBlock();
  assert.equal(initialBlock.gasLimit, 16_777_216n);
  assert.equal(before.missions[0].values[0], 1);
  assert(before.missions.slice(2).every(x => x.values[0] === 5));
  const items: BatchLeg[] = [];
  for (const id of meta.returnIds) items.push({ missionId: String(id), leg: "return", dueAt: Number((await mission(id))[7]) });
  items.push({ missionId: String(meta.battleId), leg: "arrival", dueAt: Number((await mission(meta.battleId))[6]) });
  const policy = { ...defaultMissionBatchPolicy, enabled: true, priceFeed: feed };
  const nonce = await client.getTransactionCount({ address: account });
  const packed = await packMissionBatch(items, policy.maxItems, selected => quoteMissionBatch(client, { items: selected, nonce, account, game, chainId: chain.id, policy }), () => {});
  assert.equal(packed.items.length, 3, stringify(packed.exclusions));
  assert.equal(packed.exclusions.length, 0);
  assert(packed.quote);
  assert.deepEqual(packed.quote.outcomes, [0, 0, 0]);
  const data = batchCalldata(packed.items);
  const naiveGas = await client.estimateGas({ account, to: game, data });
  const naive = await client.call({ account, to: game, data, gas: (naiveGas * 120n + 99n) / 100n });
  const [naiveOutcomes] = decodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", data: naive.data! });
  assert(naiveOutcomes.some(x => x !== 0 && x !== 7), "fixture must expose old success-only estimator");
  const rows: unknown[] = [];
  const allLogs: any[] = [];
  async function send(selected: BatchLeg[], quote: Awaited<ReturnType<typeof quoteMissionBatch>>) {
    assert(quote.gas <= 16_777_216n && quote.usdMicros <= 500_000n);
    const before = await state();
    const data = batchCalldata(selected);
    const hash = await wallet.sendTransaction({ to: game, data, gas: quote.gas, maxFeePerGas: quote.maxFeePerGas, maxPriorityFeePerGas: quote.maxPriorityFeePerGas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    assert(receipt.gasUsed <= quote.gas);
    const after = await state();
    const events: any[] = [];
    for (const log of receipt.logs) {
      try { events.push(decodeEventLog({ abi: [...artifact.abi, ...batchArtifact.abi], data: log.data, topics: log.topics })); } catch {}
    }
    allLogs.push(...events);
    const outcomes = events.filter(x => x.eventName === "FleetMissionBatchItem").map(x => Number(x.args.outcome));
    assert.deepEqual(outcomes, quote.outcomes, "receipt outcomes must match productive quote");
    rows.push({ items: selected, quote, receiptOutcomes: outcomes, hash, actualGas: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, before, after });
    return after;
  }
  let after = await send(packed.items, packed.quote);
  assert(after.missions.slice(2).every(x => x.values[0] === 4), "cheap returns settled");
  for (let i = 0; i < 10 && after.missions[0].values[0] === 1; i++) {
    const selected = [items[2]!];
    const quote = await quoteMissionBatch(client, { items: selected, nonce: await client.getTransactionCount({ address: account }), account, game, chainId: chain.id, policy });
    after = await send(selected, quote);
  }
  assert.notEqual(after.missions[0].values[0], 1, "battle bounded completion");
  const battle = allLogs.find(x => x.eventName === "AttackBattleResolved" && x.args.missionId === BigInt(meta.battleId));
  assert(battle, "real receipt battle event");
  assert.equal(Number(battle.args.outcome), meta.outcome);
  assert.equal(Number(battle.args.rounds), meta.rounds);
  assert.equal(battle.args.randomSeed, BigInt(meta.seed));
  const [expected] = decodeAbiParameters(parseAbiParameters("(uint8 outcome,uint8 rounds,uint32[16] attackerShips,uint32[16] joinedAttackerShips,uint32[16] defenderShips,uint32[16] counterplayShips,uint32[8] defenderDefenses,(uint128 metal,uint128 crystal,uint128 deuterium) attackerLosses,(uint128 metal,uint128 crystal,uint128 deuterium) defenderLosses,(uint128 metal,uint128 crystal,uint128 deuterium) debris)"), meta.expectedBattle);
  const losses = allLogs.find(x => x.eventName === "CombatLosses" && x.args.missionId === BigInt(meta.battleId));
  assert(losses);
  for (const side of ["attacker", "defender"] as const) for (const resource of ["Metal", "Crystal", "Deuterium"] as const)
    assert.equal(losses.args[side + resource], expected[side + "Losses"][resource.toLowerCase()]);
  assert.deepEqual(await read("debrisField", [BigInt(meta.target)]), [expected.debris.metal, expected.debris.crystal]);
  // Finish survivors' scheduled returns, still through the production capped quote helper.
  for (const id of [meta.battleId, meta.counterplayId]) {
    const m = await mission(id);
    if (m[0] !== 2) continue;
    assert(Number(m[7]) <= Math.floor(Date.now() / 1000), "synthetic deadlines must already be due");
    const selected: BatchLeg[] = [{ missionId: String(id), leg: "return", dueAt: Number(m[7]) }];
    await send(selected, await quoteMissionBatch(client, { items: selected, nonce: await client.getTransactionCount({ address: account }), account, game, chainId: chain.id, policy }));
    assert.equal((await mission(id))[0], 4);
  }
  for (const [planet, ships] of [[meta.origin, expected.attackerShips], [meta.target, expected.defenderShips], [meta.counterplayOrigin, expected.counterplayShips]] as const)
    for (let i = 0; i < 16; i++) assert.equal(await read("shipCount", [BigInt(planet), i]), ships[i]);
  for (const id of meta.homeIds) assert.equal(await read("shipCount", [BigInt(id), 0]), 1);
  const repeat = await client.call({ account, to: game, data: batchCalldata(items), gas: 16_777_216n });
  assert.deepEqual(decodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", data: repeat.data! })[0], [2, 2, 2], "settled legs cannot double-credit");
  console.log(stringify({ proof: meta.scope, initialBlock: { number: initialBlock.number, hash: initialBlock.hash, timestamp: initialBlock.timestamp, baseFeePerGas: initialBlock.baseFeePerGas, gasLimit: initialBlock.gasLimit }, syntheticInputs, limits: { transactionGas: 16_777_216, maxUsdMicros: 500_000 }, game, implementation: meta.implementation, allocationAccountsVerified: Object.keys(alloc).length, compiledRuntimeAccountsVerified: Object.values(alloc).filter((x: any) => x.code !== "0x").length, naiveGas, naiveOutcomes, packEstimates: packed.estimates, before, rows, referenceSurvivorsLossesDebris: "PASS" }));
} finally {
  node.kill();
  await node.exited;
  rmSync(directory, { recursive: true, force: true });
}
