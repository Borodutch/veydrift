import { expect, test } from "bun:test";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, type Hex } from "viem";
import { proofReadAbi, proofRecordParameters, proofRequestParameters, readProofProgress, proofAction, type ProofProgress } from "./proofProgress";
import { consumeProgress, guardAllows, progressAdvanced, progressAbi, readMissionProgress, type MissionProgress } from "./progress";
import { KeeperJournal } from "./journal";
import { BattleKeeper } from "./keeper";
import type { JsonRpcTransport } from "./transport";
const game = "0x1111111111111111111111111111111111111111";
const engine = "0x2222222222222222222222222222222222222222";
const hash = ("0x" + "a".repeat(64)) as Hex;
const zero = ("0x" + "0".repeat(64)) as Hex;
const tag = { blockHash: hash, requireCanonical: true as const };
const proof: ProofProgress = { identity: "frozen", version: 3, phase: 2, snapshot: hash, engine,
  requestId: "7", purpose: hash, fulfilledAt: "0", randomnessReady: false, verifierMatches: true,
  settlement: { phase: 0, nextIndex: "0", memberCount: "0", expectedDigest: zero } };
const initial: MissionProgress = { version: "reviewed-fixture", phase: 16, round: 0, workDone: "5",
  blockNumber: "100", blockHash: hash, proof, proofCapability: true };

test("same-block frozen engine/request reads, outage and binding failures never downgrade", async () => {
  let ready = false, outage = false, wrongOwner = false;
  const transport: JsonRpcTransport = { async request<T>(method: string, params: unknown[]): Promise<T> {
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash } as T;
    expect(params.at(-1)).toEqual(tag);
    if (method === "eth_getStorageAt") return zero as T;
    if (method === "eth_getCode") return "0x6000" as T;
    const call = params[0] as { to: Hex; data: Hex };
    let name: string;
    try { name = decodeFunctionData({ abi: proofReadAbi, data: call.data }).functionName; }
    catch { return encodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", result: [16, 0, 5n] }) as T; }
    if (name === "proofBattleRecord") {
      const decoded = decodeFunctionData({ abi: proofReadAbi, data: call.data });
      const kind = decoded.args[1];
      const record = kind === 0 ? encodeAbiParameters(proofRecordParameters, [
        { version: 3, rules: hash, catalog: hash, verifier: game, verifierCodehash: keccak256("0x6000") }, 2, hash, zero, 0n, 2n])
        : encodeAbiParameters(proofRequestParameters, [engine, 7n, hash]);
      return encodeFunctionResult({ abi: proofReadAbi, functionName: "proofBattleRecord", result: record }) as T;
    }
    if (name === "proofSettlementProgress") return encodeFunctionResult({ abi: proofReadAbi,
      functionName: "proofSettlementProgress", result: [0, 0n, 0n, zero] }) as T;
    expect(call.to).toBe(engine);
    if (outage) throw new Error("oracle RPC unavailable");
    if (name === "request") return encodeFunctionResult({ abi: proofReadAbi, functionName: "request", result: {
      requester: wrongOwner ? engine : game, purposeHash: hash, randomnessCommitment: hash,
      createdAt: 1n, fulfilledAt: ready ? 99n : 0n, randomWord: ready ? 42n : 0n } }) as T;
    return encodeFunctionResult({ abi: proofReadAbi, functionName: "battlePurposeContext", result: hash }) as T;
  } };
  const waiting = await readProofProgress(transport, game, 1n, tag);
  expect(waiting?.randomnessReady).toBe(false);
  ready = true;
  const fulfilled = await readProofProgress(transport, game, 1n, tag);
  expect(fulfilled?.randomnessReady).toBe(true);
  expect(fulfilled?.identity).toBe(waiting?.identity);
  // No production runtime is approved even when all getters succeed.
  const observed = await readMissionProgress(transport, game, "1");
  expect(observed.proofCapability).toBe(false);
  expect(guardAllows(undefined, observed)).toBe(false);
  outage = true;
  await expect(readProofProgress(transport, game, 1n, tag)).rejects.toThrow("unavailable");
  outage = false; wrongOwner = true;
  await expect(readProofProgress(transport, game, 1n, tag)).rejects.toThrow("binding mismatch");
});

test("readiness only unlocks once; durable restart, reorg, duplicate worker and runtime rollback retain high-water", async () => {
  const journal = new KeeperJournal(":memory:", "proof-test");
  let current = initial, sent = 0;
  const resolver = { keeperAddress: () => game, missionProgress: async () => current,
    missionStatus: async (missionId: string) => ({ missionId, status: 1, missionType: 3, arrivalAt: 1, returnAt: 2, randomnessRequestId: "7" }),
    resolveMission: async (_id: string, _leg: unknown, beforeSign?: () => Promise<unknown>) => { await beforeSign?.(); sent++; return hash; } };
  const make = () => new BattleKeeper(resolver, { journal, now: () => 1000, logger: { info() {}, warn() {}, error() {} } });
  try {
    let keeper = make(); keeper.recordLaunched({ missionId: "1", missionType: 3, arrivalAt: 1, returnAt: 2 });
    await keeper.tick(); await keeper.tick(); expect(sent).toBe(0);
    current = { ...initial, proof: { ...proof, randomnessReady: true, fulfilledAt: "99" } };
    await keeper.tick(); expect(sent).toBe(1);
    keeper = make(); await keeper.tick(); expect(sent).toBe(1);
    const duplicate = make(); await duplicate.tick(); expect(sent).toBe(1);
    current = { ...initial, blockNumber: "101", workDone: "6" };
    await keeper.tick(); expect(sent).toBe(1); // reorg removes readiness despite higher unrelated work
    current = { ...initial, version: "unknown", proofCapability: false, proof: { ...proof, randomnessReady: true } };
    await keeper.tick(); expect(sent).toBe(1);
    current = { ...initial, proof: { ...proof, randomnessReady: true } };
    await keeper.tick(); expect(sent).toBe(1);
  } finally { journal.close(); }
});

test("retained terminal proof record permits canonical return only, preserving runtime and paid retry guards", async () => {
  const terminal: MissionProgress = { ...initial, phase: 13, workDone: "20", proof: { ...proof, phase: 3,
    settlement: { phase: 2, nextIndex: "2", memberCount: "2", expectedDigest: hash } } };
  expect(guardAllows(undefined, terminal, "arrival")).toBe(false);
  expect(guardAllows(undefined, terminal, "return")).toBe(true);
  expect(guardAllows(undefined, { ...terminal, proofCapability: false }, "return")).toBe(false);
  expect(guardAllows(undefined, { ...terminal, proof: { ...terminal.proof!, verifierMatches: false } }, "return")).toBe(false);
  const paid = consumeProgress(undefined, terminal, "1", "return");
  expect(guardAllows(paid, terminal)).toBe(false);
  expect(guardAllows(paid, { ...terminal, blockNumber: "101" })).toBe(false);
  expect(guardAllows(paid, { ...terminal, workDone: "21" })).toBe(true);
  let sent = 0;
  const journal = new KeeperJournal(":memory:", "proof-return-test");
  const resolver = { keeperAddress: () => game, missionProgress: async () => terminal,
    missionStatus: async (missionId: string) => ({ missionId, status: 2, missionType: 3, arrivalAt: 1, returnAt: 2, randomnessRequestId: "7" }),
    resolveMission: async (_id: string, leg: string, beforeSign?: () => Promise<unknown>) => {
      expect(leg).toBe("return"); await beforeSign?.(); sent++; return hash;
    } };
  try {
    const make = () => new BattleKeeper(resolver, { journal, now: () => 1000, logger: { info() {}, warn() {}, error() {} } });
    const keeper = make();
    keeper.recordLaunched({ missionId: "1", missionType: 3, arrivalAt: 1, returnAt: 2 });
    keeper.reconcileMissionStatus(await resolver.missionStatus("1"));
    await keeper.tick(); expect(sent).toBe(1);
    await make().tick(); expect(sent).toBe(1); // same retained proof cannot buy another no-op after restart
  } finally { journal.close(); }
});

test("proof application waits never ordinary resolve; nonmonotonic 17->11 resumes economics, not terminal", () => {
  const applying = { ...initial, phase: 17, proof: { ...proof, phase: 3,
    settlement: { phase: 1, nextIndex: "1", memberCount: "2", expectedDigest: hash } } };
  expect(proofAction(17, applying.proof, true)).toBe("applying");
  expect(guardAllows(undefined, applying)).toBe(false);
  expect(proofAction(17, { ...proof, phase: 3 }, true)).toBe("proving");
  const economics = { ...applying, phase: 11, workDone: "6", proof: { ...applying.proof,
    settlement: { phase: 2, nextIndex: "2", memberCount: "2", expectedDigest: zero } } };
  expect(progressAdvanced(applying, economics)).toBe(true);
  expect(guardAllows(consumeProgress(undefined, applying, "1", "arrival"), economics)).toBe(true);
  expect(proofAction(12, economics.proof, true)).toBe("resolve");
  expect(guardAllows(undefined, { ...initial, phase: 17, proof: undefined } as unknown as MissionProgress)).toBe(false);
  expect(guardAllows(undefined, { version: "legacy", phase: 0, round: 0, workDone: "0", blockHash: hash, blockNumber: "100" })).toBe(true);
});
