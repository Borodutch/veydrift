import { expect, test } from "bun:test";
import { encodeFunctionResult, parseTransaction, type PublicClient } from "viem";
import { batchCalldata, missionBatchAbi, defaultMissionBatchPolicy, BatchCapacityError, BatchWorkBudgetError, BatchWorkCeilingError } from "./missionBatch";
import { privateKeyToAccount } from "viem/accounts";
import { SupersessionUnavailableError } from "./resolverReplacementFees";
import { validateMissionBatchReplay, planMissionSupersession, BatchQuoteExpiredError, quoteMissionBatch, measuredBatchGas, rpcQuantity, quoteResolverGas, singleResolverMaxFeeWei, ResolverFeeCapError } from "./missionBatchFees";

const now = BigInt(Math.floor(Date.now() / 1000));
const input = { items: [{ missionId: "1", leg: "arrival" as const, dueAt: Number(now - 5n) }], nonce: 99,
  account: "0x1111111111111111111111111111111111111111" as const,
  game: "0x2222222222222222222222222222222222222222" as const, chainId: 8453,
  policy: { ...defaultMissionBatchPolicy } };
const signedGas = 16_777_216n;
const minimumGas = (measuredBatchGas(100_000n, batchCalldata(input.items), 1) * 120n + 99n) / 100n;
const block = (timestamp = now, baseFeePerGas = 100n) => ({ number: 10n, hash: "0x" + "aa".repeat(32), timestamp,
  baseFeePerGas, gasLimit: 30_000_000n });
const result = (outcome: number, used = 100_000n) => ({ data: encodeFunctionResult({ abi: missionBatchAbi,
  functionName: "resolveFleetMissionBatch", result: [[outcome], used] }) });
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    getBlock: async () => block(),
    estimateGas: async () => { throw new Error("must not trust success-only estimateGas"); },
    call: async (args: Record<string, unknown>) => { calls.push(args); return result(0); },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async (args: { functionName: string; args?: unknown[] }) => {
      calls.push(args);
      if (args.functionName === "getL1Fee") {
        const tx = parseTransaction(args.args![0] as `0x${string}`);
        expect(tx.data).toBe(batchCalldata(input.items));
        expect(tx.nonce).toBe(99);
        expect(tx.gas).toBe(signedGas);
        expect(tx.maxFeePerGas).toBe(210n);
        return 1000n;
      }
      if (args.functionName === "getL1FeeUpperBound") return 1000n;
      if (args.functionName === "getOperatorFee") { expect(args.args).toEqual([signedGas]); return 100n; }
      throw new Error("unexpected RPC (including any ETH/USD dependency)");
    }, ...overrides
  };
  return { client: client as unknown as PublicClient, calls };
}
test("quotes actual nonce/calldata/gas/maxfee and Base fee oracles without any USD reads", async () => {
  const { client, calls } = fixture();
  const quote = await quoteMissionBatch(client, input);
  // Signed gas is the per-transaction work budget; L1/operator fees stay quoted at the cap.
  expect(quote.gas).toBe(2_500_000n);
  expect(quote.totalWei).toBe(2_500_000n * 210n + 2200n);
  expect(Object.isFrozen(quote)).toBe(true);
  expect(Object.isFrozen(quote.provenance)).toBe(true);
  expect(quote.provenance).toEqual({ blockNumber: 10n, blockHash: block().hash as `0x${string}`, blockTimestamp: now });
  expect(calls[0]?.data).toBe(batchCalldata(input.items));
});
test("quote snapshots ETH budget before asynchronous reads", async () => {
  const policy = { ...input.policy, maxFeeWei: 210_000_000n };
  const client = fixture({ getBlock: async () => { policy.maxFeeWei = 400_000_000_000_000n; return block(); },
    readContract: async () => 0n }).client;
  const quote = await quoteMissionBatch(client, { ...input, policy });
  expect(quote.gas).toBe(1_000_000n);
  expect(quote.totalWei).toBe(210_000_000n);
});
test("stale/missing fee block, measurement, L1/operator or fee spike fail closed", async () => {
  for (const overrides of [
    { getBlock: async () => block(now - 100n) },
    { getBlock: async () => block(now + 100n) },
    { getBlock: async () => ({ ...block(), hash: null }) },
    { call: async () => { throw new Error("measurement failed"); } },
    { readContract: async () => { throw new Error("Base fee RPC unavailable"); } },
    { readContract: async () => 200_000_000_000_000n },
    { getBlock: async () => block(now, 1_000_000_000_000n), readContract: async () => 0n }
  ]) await expect(quoteMissionBatch(fixture(overrides).client, input)).rejects.toThrow();
});
test("reference and exact-signed-gas no-progress never produce a quote", async () => {
  for (const outcome of [1, 2, 3, 4, 5, 6]) {
    await expect(quoteMissionBatch(fixture({ call: async () => result(outcome) }).client, input)).rejects.toThrow();
    let calls = 0;
    await expect(quoteMissionBatch(fixture({ call: async () => result(calls++ === 0 ? 0 : outcome) }).client, input)).rejects.toThrow();
  }
  expect((await quoteMissionBatch(fixture({ call: async () => result(7) }).client, input)).outcomes).toEqual([7]);
  let calls = 0;
  expect((await quoteMissionBatch(fixture({ call: async () => result(calls++ === 0 ? 0 : 7) }).client, input)).outcomes).toEqual([7]);
});
test("a staged battle measured near the gas cap is bounded by the work budget, not excluded (#397)", async () => {
  const signed: bigint[] = [];
  const quote = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return result(7, gas < 15_000_000n ? gas - gas / 10n : 15_000_000n); }, readContract: async () => 100n }).client, input);
  expect(quote.gas).toBe(2_500_000n);
  expect(signed).toEqual([16_777_216n, 2_500_000n]);
  expect(quote.outcomes).toEqual([7]);
  const wide = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas < 15_000_000n ? gas - gas / 10n : 15_000_000n),
    readContract: async () => 100n }).client, { ...input, policy: { ...input.policy, workGas: 4_000_000n, maxWorkGas: 4_000_000n } });
  expect(wide.gas).toBe(4_000_000n);
  // Never above the 4M ceiling, even for a policy built in code (#408).
  await expect(quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas - gas / 10n), readContract: async () => 100n }).client,
    { ...input, policy: { ...input.policy, workGas: 16_777_216n, maxWorkGas: 16_777_216n } })).rejects.toThrow("invalid batch");
});
test("a leg Settled at the cap with work above the budget is signed at the budget where it makes Progress (#397 review)", async () => {
  // The final segment of the prod battle: Settled at the cap with ~4.2M of work, Progress at the budget.
  const signed: bigint[] = [];
  const quote = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return gas >= 16_000_000n ? result(0, 4_200_000n) : result(7, gas / 2n); }, readContract: async () => 100n }).client, input);
  expect(quote.gas).toBe(2_500_000n);
  expect(quote.outcomes).toEqual([7]);
  expect(signed).toEqual([16_777_216n, 2_500_000n]);
});
test("a single staged leg whose first stage exceeds the work budget escalates, never above the hard work ceiling (#397 review)", async () => {
  const signed: bigint[] = [];
  const staged = (productiveFrom: bigint) => fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return result(gas < productiveFrom ? 5 : 7, gas / 2n); }, readContract: async () => 100n }).client;
  const quote = await quoteMissionBatch(staged(2_800_000n), input);
  expect(quote.gas).toBe(3_000_000n);
  expect(signed).toEqual([16_777_216n, 2_500_000n, 3_000_000n]);
  expect(quote.outcomes).toEqual([7]);
  // Unproductive at the ceiling: an indivisible blocker, never signed heavier.
  for (const productiveFrom of [3_000_001n, 12_000_000n]) {
    signed.length = 0;
    await expect(quoteMissionBatch(staged(productiveFrom), input)).rejects.toBeInstanceOf(BatchWorkCeilingError);
    expect(signed).toEqual([16_777_216n, 2_500_000n, 3_000_000n]);
  }
  // An explicitly raised ceiling escalates 2x, 4x, ... (and the measured need + 20%) up to it, never past it.
  signed.length = 0;
  const raised = { ...input, policy: { ...input.policy, workGas: 1_500_000n, maxWorkGas: 4_000_000n } };
  expect((await quoteMissionBatch(staged(3_000_000n), raised)).gas).toBe(3_000_000n);
  signed.length = 0;
  await expect(quoteMissionBatch(staged(12_000_000n), raised)).rejects.toBeInstanceOf(BatchWorkCeilingError);
  expect(signed).toEqual([16_777_216n, 1_500_000n, 3_000_000n, 4_000_000n]);
  expect(signed.every((gas, i) => i === 0 || gas <= 4_000_000n)).toBe(true);
  await expect(quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(gas < 16_777_216n ? 5 : 7, 1_000n), readContract: async () => 100n }).client,
    { ...input, items: [...input.items, { ...input.items[0]!, missionId: "8" }] })).rejects.toThrow();
});
test("a non-staged leg that needs more than the budget is signed at its measured need + 20% when that fits the ceiling", async () => {
  const signed: bigint[] = [];
  // Needs 2.2M of work: GasLimited/Failed below that, Settled from there.
  const need = 2_200_000n;
  const heavy = fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return gas < 2_700_000n ? result(5, gas / 2n) : result(0, need); }, readContract: async () => 100n }).client;
  const quote = await quoteMissionBatch(heavy, input);
  const minimum = (measuredBatchGas(need, batchCalldata(input.items), 1) * 120n + 99n) / 100n;
  expect(minimum).toBeLessThan(3_000_000n);
  expect(quote.gas).toBe(minimum);
  expect(signed).toEqual([16_777_216n, 2_500_000n, minimum]);
});
test("settling legs over the work budget are signed at the budget when productive there, else split; never above the ceiling", async () => {
  const items = [input.items[0]!, { ...input.items[0]!, missionId: "8" }];
  const batch = (outcomes: (gas: bigint) => number[]) => fixture({ call: async ({ gas }: { gas: bigint }) => ({ data: encodeFunctionResult({ abi: missionBatchAbi,
    functionName: "resolveFleetMissionBatch", result: [outcomes(gas), gas >= 16_000_000n ? 4_000_000n : outcomes(gas).every((o) => o === 0) ? 1_500_000n : gas - 100_000n] }) }), readContract: async () => 100n }).client;
  // Both legs still settle (or make Progress) at the budget: one transaction at the budget.
  expect((await quoteMissionBatch(batch(() => [0, 0]), { ...input, items })).gas).toBe(2_500_000n);
  expect((await quoteMissionBatch(batch((gas) => gas >= 16_000_000n ? [0, 0] : [0, 7]), { ...input, items })).outcomes).toEqual([0, 7]);
  // The second leg no longer fits at the budget: split by packing.
  await expect(quoteMissionBatch(batch((gas) => gas >= 16_000_000n ? [0, 0] : [0, 6]), { ...input, items })).rejects.toBeInstanceOf(BatchWorkBudgetError);
  // One indivisible settling leg is never signed above the hard ceiling.
  const single = fixture({ call: async ({ gas }: { gas: bigint }) => result(gas >= 16_000_000n ? 0 : 6, gas >= 16_000_000n ? 4_000_000n : gas - 100_000n),
    readContract: async () => 100n }).client;
  await expect(quoteMissionBatch(single, input)).rejects.toBeInstanceOf(BatchWorkCeilingError);
});
test("a Settled leg is never signed with under a 20% margin over its measured need: escalate or block (#408)", async () => {
  const data = batchCalldata(input.items);
  const withMargin = (work: bigint, count = 1, calldata = data) => (measuredBatchGas(work, calldata, count) * 120n + 99n) / 100n;
  const signed: bigint[] = [];
  // Non-staged settlement doing a fixed amount of work: Settled whenever it fits at all.
  const settles = (work: bigint) => fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return measuredBatchGas(work, data, 1) <= gas ? result(0, work) : result(6, gas - 1n); }, readContract: async () => 100n }).client;
  // ~2.3M of work fits the 2.5M budget with ~2% headroom: escalated to its need + 20%, within the ceiling.
  const work = 2_250_000n;
  expect(measuredBatchGas(work, data, 1)).toBeLessThan(2_500_000n);
  expect(withMargin(work)).toBeGreaterThan(2_500_000n);
  expect(withMargin(work)).toBeLessThan(3_000_000n);
  const quote = await quoteMissionBatch(settles(work), input);
  expect(quote.gas).toBe(withMargin(work));
  expect(signed).toEqual([16_777_216n, 2_500_000n, withMargin(work)]);
  expect(quote.outcomes).toEqual([0]);
  // Need + 20% above the ceiling: an alerted indivisible blocker, never signed thin at the ceiling.
  const heavy = 2_400_000n;
  expect(withMargin(heavy)).toBeGreaterThan(3_000_000n);
  signed.length = 0;
  await expect(quoteMissionBatch(settles(heavy), input)).rejects.toBeInstanceOf(BatchWorkCeilingError);
  expect(signed.every((gas, i) => i === 0 || gas <= 3_000_000n)).toBe(true);
  // A raised ceiling admits it at exactly its need + 20%.
  expect((await quoteMissionBatch(settles(heavy), { ...input, policy: { ...input.policy, maxWorkGas: 4_000_000n } })).gas).toBe(withMargin(heavy));
  // Settled at the budget, thin; Settled thin at the doubled candidate too: the need is learned and tried next.
  signed.length = 0;
  const raised = { ...input, policy: { ...input.policy, workGas: 1_500_000n, maxWorkGas: 4_000_000n } };
  const drifting = fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return result(0, gas >= 16_000_000n ? 1_000_000n : gas >= 3_000_000n ? 2_700_000n : gas - 200_000n); }, readContract: async () => 100n }).client;
  expect((await quoteMissionBatch(drifting, raised)).gas).toBe(withMargin(2_700_000n));
  expect(signed[signed.length - 1]).toBe(withMargin(2_700_000n));
  // Several settling legs without the margin are split by packing instead.
  const items = [input.items[0]!, { ...input.items[0]!, missionId: "8" }];
  const pair = fixture({ call: async () => ({ data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch",
    result: [[0, 0], 2_250_000n] }) }), readContract: async () => 100n }).client;
  await expect(quoteMissionBatch(pair, { ...input, items })).rejects.toBeInstanceOf(BatchWorkBudgetError);
  // A staged battle's final segment: Settles thin at the budget with a need + 20% above the ceiling, but
  // makes Progress (one stage fewer) below it. Signed lighter, never blocked and never heavier (#408 review).
  signed.length = 0;
  const finalSegment = fixture({ call: async ({ gas }: { gas: bigint }) => { signed.push(gas);
    return gas >= 2_500_000n ? result(0, 2_350_000n) : result(7, gas - 1n); }, readContract: async () => 100n }).client;
  expect(withMargin(2_350_000n)).toBeGreaterThan(3_000_000n);
  const lighter = await quoteMissionBatch(finalSegment, input);
  expect(lighter.outcomes).toEqual([7]);
  expect(lighter.gas).toBeLessThan(2_500_000n);
  expect(lighter.gas).toBeGreaterThanOrEqual(1_500_000n);
  expect(signed.every((gas, i) => i === 0 || gas <= 3_000_000n)).toBe(true);
  // Fee-limited below the budget: a capacity problem that clears with fees, not an indivisible work blocker.
  const feeLimited = fixture({ call: async ({ gas }: { gas: bigint }) => result(0, gas > 1_000_000n ? 1_000_000n : gas - 1n),
    readContract: async () => 0n }).client;
  const tight = { ...input, policy: { ...input.policy, maxFeeWei: 210n * 1_100_000n } };
  const thrown = await quoteMissionBatch(feeLimited, tight).catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(BatchCapacityError);
  expect(thrown).not.toBeInstanceOf(BatchWorkCeilingError);
  expect((thrown as Error).message).toContain("ETH cap affords");
  // A staged leg making Progress needs no margin: it uses whatever gas it gets.
  expect((await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas - 1n), readContract: async () => 100n }).client, input)).gas)
    .toBe(2_500_000n);
});
test("an unfinished battle shrinks gas to the ETH budget and stays productive", async () => {
  const policy = { ...input.policy, maxFeeWei: 100_000_000_000_000n };
  const quote = await quoteMissionBatch(fixture({ call: async ({ gas }: { gas: bigint }) => result(7, gas - gas / 10n),
    getBlock: async () => block(now, 10_000_000n), readContract: async () => 0n }).client, { ...input, policy });
  expect(quote.gas).toBeLessThan(16_777_216n);
  expect(quote.gas).toBeGreaterThan(1_000_000n);
  expect(quote.totalWei).toBeLessThanOrEqual(policy.maxFeeWei);
});
test("raw Base RPC receipt extensions normalize quantities without bigint/string concatenation", () => {
  expect(rpcQuantity("0x10")).toBe(16n);
  expect(rpcQuantity("0x00")).toBe(0n);
  expect(rpcQuantity(undefined)).toBeNull();
  expect(rpcQuantity("bad")).toBeNull();
  expect(100n + rpcQuantity("0x10")! + rpcQuantity("0x2")!).toBe(118n);
});
test("single quotes reserve L1/operator costs and cap at 0.0002 ETH independent of any USD price", async () => {
  const base = { chainId: 8453, dataBytes: 36, gas: signedGas };
  for (const ignoredPrice of [0n, 1000n, 2500n, 5000n]) {
    let priceReads = 0;
    const client = fixture({ getBlock: async () => block(now, 49_999_995n), readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals" || functionName === "latestRoundData") { priceReads++; throw new Error("missing/stale price " + ignoredPrice); }
      return functionName === "getL1FeeUpperBound" ? 1_000_000_000n : 2_000_000_000n;
    } }).client;
    const quote = await quoteResolverGas(client, base);
    expect(quote.gas).toBe((singleResolverMaxFeeWei - 6_000_000_000n) / quote.maxFeePerGas);
    expect(quote.gas * quote.maxFeePerGas + 6_000_000_000n).toBeLessThanOrEqual(singleResolverMaxFeeWei);
    expect(priceReads).toBe(0);
    expect((await quoteResolverGas(fixture().client, base)).gas).toBe(signedGas);
  }
  await expect(quoteResolverGas(fixture().client, { ...base, chainId: 31337 })).rejects.toThrow("requires Base");
  for (const timestamp of [0n, now - 100n, now + 100n])
    await expect(quoteResolverGas(fixture({ getBlock: async () => block(timestamp) }).client, base)).rejects.toThrow("expired");
  for (const expensive of ["getL1FeeUpperBound", "getOperatorFee"])
    await expect(quoteResolverGas(fixture({ readContract: async ({ functionName }: { functionName: string }) =>
      functionName === expensive ? 100_000_000_000_001n : 0n }).client, base)).rejects.toBeInstanceOf(ResolverFeeCapError);
});
test("a tight ETH budget cannot sign an unaffordable measured minimum", async () => {
  const client = fixture({ readContract: async () => 0n }).client;
  const quote = await quoteMissionBatch(client, { ...input, policy: { ...input.policy, maxFeeWei: 210n * 1_000_000n } });
  expect(quote.gas).toBeGreaterThanOrEqual(minimumGas);
  expect(quote.gas).toBeLessThan(16_777_216n);
  await expect(quoteMissionBatch(client, { ...input, policy: { ...input.policy, maxFeeWei: 100n } })).rejects.toThrow("ETH cap");
});
test("0.0004 ETH batch policy cannot exceed the 0.0002 ETH transaction ceiling", async () => {
  const quote = await quoteMissionBatch(fixture({ getBlock: async () => block(now, 50_000_000n), readContract: async () => 0n }).client, input);
  expect(quote.totalWei).toBeLessThanOrEqual(200_000_000_000_000n);
  expect(quote.gas).toBeLessThan(signedGas);
});

const replayAccount = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const replayRaw = await replayAccount.signTransaction({ type: "eip1559", chainId: input.chainId, nonce: 99,
  to: input.game, data: batchCalldata(input.items), gas: signedGas, maxFeePerGas: 210n, maxPriorityFeePerGas: 10n, value: 0n });
const replayPass = { read: async <T>(op: () => Promise<T>) => op(), assertActive: () => {} };
test("replay refreshes exact fixed envelope fee exposure, canonical block and synchronous freshness", async () => {
  const f = fixture();
  const guard = await validateMissionBatchReplay(f.client, replayRaw, input, replayPass);
  guard();
  const simulation = f.calls.find((call) => call.data);
  expect(simulation?.gas).toBe(signedGas); expect(simulation?.maxFeePerGas).toBe(210n);
  expect(simulation?.nonce).toBe(99);
  const old = Date.now;
  try { Date.now = () => Number(now + 31n) * 1000; expect(guard).toThrow("expired"); } finally { Date.now = old; }
});
test("replay never bypasses current Base fees, original budget, productivity or canonical freshness", async () => {
  // Derive skew when the RPC executes, not at module load before slower suites run.
  for (const overrides of [
    { getBlock: async () => block(BigInt(Math.floor(Date.now() / 1000)) - 31n) },
    { getBlock: async () => block(BigInt(Math.floor(Date.now() / 1000)) + 31n) },
    { getBlock: async () => block(now, 211n) },
    { readContract: async () => { throw new Error("oracle unavailable"); } },
    { readContract: async () => 200_000_000_000_000n },
    { call: async () => result(2) }, { call: async () => result(5) }
  ]) await expect(validateMissionBatchReplay(fixture(overrides).client, replayRaw, input, replayPass)).rejects.toThrow();
  await expect(validateMissionBatchReplay(fixture().client, replayRaw,
    { ...input, policy: { ...input.policy, maxFeeWei: 1000n } }, replayPass)).rejects.toThrow("cap");
  await expect(validateMissionBatchReplay(fixture().client, replayRaw,
    { ...input, items: [{ ...input.items[0]!, missionId: "2" }] }, replayPass)).rejects.toThrow("mismatch");
  let blocks = 0;
  await expect(validateMissionBatchReplay(fixture({ getBlock: async () => ({ ...block(), hash: blocks++ ? "0xdead" : block().hash }) }).client,
    replayRaw, input, replayPass)).rejects.toThrow("changed");
});

test("every fee-age failure is typed for shared repacking, including oracle-await expiration", async () => {
  await expect(quoteMissionBatch(fixture({ getBlock: async () => block(now - 31n) }).client, input)).rejects.toBeInstanceOf(BatchQuoteExpiredError);
  const originalNow = Date.now;
  let clock = Number(now) * 1000;
  Date.now = () => clock;
  try {
    const client = fixture({ readContract: async () => { clock = Number(now + 31n) * 1000; return 100n; } }).client;
    await expect(quoteMissionBatch(client, input)).rejects.toBeInstanceOf(BatchQuoteExpiredError);
  } finally { Date.now = originalNow; }
});

test("same-nonce supersession plan: lighter gas, >=10% less simulated work, both fees bumped >=25% and to the current quote (#397)", async () => {
  const signer = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`); // fixture only
  const original = await signer.signTransaction({ type: "eip1559", chainId: 8453, nonce: 99, to: input.game, data: batchCalldata(input.items),
    value: 0n, gas: 16_777_216n, maxFeePerGas: 210n, maxPriorityFeePerGas: 10n });
  const pass = { read: <T>(operation: () => Promise<T>) => operation(), assertActive: () => {} };
  const simulated: Array<[bigint, bigint]> = [];
  const staged = (failBelow: bigint, work = (gas: bigint) => gas / 4n) => fixture({ readContract: async () => 100n,
    call: async ({ gas, nonce, maxFeePerGas }: { gas: bigint; nonce: number; maxFeePerGas: bigint }) => {
      simulated.push([gas, maxFeePerGas]); expect(nonce).toBe(99);
      return result(gas < failBelow ? 5 : 7, work(gas));
    } }).client;
  const plan = await planMissionSupersession(staged(0n), original, input, pass);
  expect({ gas: plan.gas, maxFeePerGas: plan.maxFeePerGas, maxPriorityFeePerGas: plan.maxPriorityFeePerGas })
    .toEqual({ gas: 2_500_000n, maxFeePerGas: 263n, maxPriorityFeePerGas: 13n });
  expect({ lighter: plan.executionGasUsed, original: plan.originalExecutionGasUsed }).toEqual({ lighter: 625_000n, original: 4_194_304n });
  // The lighter exact envelope at bumped fees, then the original's own envelope at the same block.
  expect(simulated).toEqual([[2_500_000n, 263n], [16_777_216n, undefined as unknown as bigint]]);
  const unsigned = parseTransaction(plan.unsigned);
  expect(unsigned).toMatchObject({ nonce: 99, to: input.game, data: batchCalldata(input.items), gas: 2_500_000n });
  expect(unsigned.r).toBeUndefined();
  // No alternative that cannot do less work: never spend it on an envelope Base would refuse again.
  await expect(planMissionSupersession(staged(3_000_000n), original, input, pass)).rejects.toBeInstanceOf(SupersessionUnavailableError);
  await expect(planMissionSupersession(staged(0n, () => 1_000_000n), original, input, pass)).rejects.toThrow("10% less work");
  const light = await signer.signTransaction({ type: "eip1559", chainId: 8453, nonce: 99, to: input.game, data: batchCalldata(input.items),
    value: 0n, gas: 2_500_000n, maxFeePerGas: 210n, maxPriorityFeePerGas: 10n });
  await expect(planMissionSupersession(staged(0n), light, input, pass)).rejects.toThrow("already within the work budget");
  // Caps, transport and envelope identity stay fatal (not "unavailable").
  await expect(planMissionSupersession(staged(0n), original, { ...input, policy: { ...input.policy, maxFeeWei: 1_000_000n } }, pass)).rejects.toThrow("ETH cap");
  await expect(planMissionSupersession(fixture({ readContract: async () => 100n, call: async () => { throw new Error("rpc down"); } }).client, original, input, pass)).rejects.toThrow("rpc down");
  await expect(planMissionSupersession(staged(0n), original, { ...input, items: [{ ...input.items[0]!, missionId: "2" }] }, pass)).rejects.toThrow("original envelope mismatch");
});
