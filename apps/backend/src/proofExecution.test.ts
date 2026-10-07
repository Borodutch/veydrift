import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, keccak256, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import { proofSettlementWriteSignatures } from "../../../packages/chain-abi/src/proofSettlement";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { proofOperationIdentity, validateProofPlan, type ProofExecutionPlan, type ProofPlanProvider } from "./proofExecution";

const game = "0x2222222222222222222222222222222222222222" as const;
const address = "0x3333333333333333333333333333333333333333" as const;
const blockHash = toHex(10n, { size: 32 });
const abi = parseAbi(proofSettlementWriteSignatures);
const chain = { id: 8453, name: "mock", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://invalid.test"] } } };
function plan(cursor = "0"): ProofExecutionPlan {
  const data = encodeFunctionData({ abi, functionName: "applyProofBattleLeaves", args: [7n, []] });
  return Object.freeze({ ...proofOperationIdentity({ chainId: "8453", game, battleId: "7", binding: toHex(1n, { size: 32 }),
    release: toHex(2n, { size: 32 }), root: toHex(3n, { size: 32 }), cursor, cursorDigest: toHex(4n, { size: 32 }), action: "apply" }, data),
    to: game, data, blockHash, blockNumber: 10n, deliveryEnabled: false, gaps: Object.freeze([]) });
}
function fixture(databasePath = ":memory:") {
  const state = { signs: 0, sends: 0, nonceReads: 0, nonce: 4, mined: false, ambiguous: false, paused: false,
    oracleFail: false, expensive: false, simulationFail: false, reorg: false, stale: false, reverted: false, feeFork: false, latestReads: 0, badReceipt: false,
    finalized: 9n, onReceipt: () => {}, onSign: () => {}, onCall: () => {} };
  const envelopes: Array<Record<string, unknown>> = [];
  // Deliberately NOT a key/account cryptographic fixture. Signing returns inert bytes only.
  const account = { address, signTransaction: async (tx: Record<string, unknown>) => {
    state.signs++; envelopes.push(tx); state.onSign(); return toHex(state.signs, { size: 8 });
  } };
  const receipt = (transactionHash: Hex) => ({ transactionHash: state.badReceipt ? toHex(99n, { size: 32 }) : transactionHash, status: state.reverted ? "reverted" : "success", blockNumber: 10n, blockHash, logs: [] });
  const rpc = {
    getStorageAt: async () => state.paused ? "0x01" : "0x00",
    getTransactionCount: async () => { state.nonceReads++; return state.nonce; },
    getBlock: async ({ blockTag }: { blockTag?: string }) => {
      if (blockTag === "latest") state.latestReads++;
      return { number: blockTag === "finalized" ? state.finalized : 10n,
        hash: state.reorg || (state.feeFork && blockTag === "latest" && state.latestReads === 3) ? toHex(99n, { size: 32 }) : blockHash,
        timestamp: BigInt(Math.floor(Date.now() / 1000) - (state.stale ? 1000 : 0)), baseFeePerGas: 100n };
    },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async () => { if (state.oracleFail) throw new Error("oracle unavailable"); return state.expensive ? 200_000_000_000_000n : 100n; },
    call: async () => { state.onCall(); if (state.simulationFail) throw new Error("simulation failed"); return { data: "0x" }; },
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      state.sends++; if (state.ambiguous) throw new Error("connection lost"); state.mined = true; state.nonce++;
      return keccak256(serializedTransaction);
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => receipt(hash),
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => { if (!state.mined) throw new Error("receipt unknown"); state.onReceipt(); return receipt(hash); }
  };
  const coordinator = new ResolverTransactionCoordinator(databasePath);
  const client = new ViemMissionResolutionChainClient({ listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    getCanonicalFleetMission: async () => ({ status: "Returned" }) as never }, game, account as never,
    rpc as unknown as PublicClient, undefined, chain, undefined, coordinator);
  const internal = client as unknown as { executeProofOperation(provider: ProofPlanProvider): Promise<Hex | null> };
  const sibling = () => coordinator.submit({ chainId: 8453, address, operationId: "ordinary-sibling",
    getTransactionCount: rpc.getTransactionCount, submit: async () => { throw new Error("sibling allocation reached"); }, confirm: async () => {} });
  return { state, envelopes, coordinator, client, run: (provider: ProofPlanProvider = async () => plan()) => internal.executeProofOperation(provider), sibling };
}

for (const finalized of [false, true]) {
  test("confirmed proof callback reorg retains attempt without allocating: finalized=" + finalized, async () => {
    const f = fixture(); f.state.finalized = finalized ? 10n : 9n;
    await f.run();
    const nonceReads = f.state.nonceReads;
    // Stored inclusion reconciles first (or finalized intent is excluded). Only the
    // later isConfirmedCanonical receipt probe triggers the reorg in this fixture.
    f.state.onReceipt = () => { f.state.reorg = true; };
    await expect(f.run()).rejects.toThrow("proof confirmed receipt is not canonical; explicit recovery required");
    expect(f.state.signs).toBe(1); expect(f.state.sends).toBe(1); expect(f.state.nonceReads).toBe(nonceReads);
    const db = (f.coordinator as unknown as { database: import("bun:sqlite").Database }).database;
    const attempt = db.query("SELECT status FROM resolver_transaction_attempts WHERE operation_id = ?").get(plan().operationId) as { status: string };
    expect(attempt.status).toBe("confirmed");
  });
}
test("fee snapshot fork cannot hide between matching plan observations", async () => {
  const f = fixture(); f.state.feeFork = true;
  await expect(f.run()).rejects.toThrow("fee anchor changed");
  expect(f.state.signs + f.state.sends).toBe(0);
});
test("wrong receipt hash never releases an ambiguous proof intent", async () => {
  const f = fixture(); f.state.ambiguous = true;
  await expect(f.run()).rejects.toThrow("connection lost");
  f.state.mined = true; f.state.badReceipt = true;
  await expect(f.client.reconcileProofOperations()).rejects.toThrow("invalid proof receipt");
  expect(f.state.signs).toBe(1); expect(f.state.sends).toBe(1);
});
test("production hard gate precedes provider, nonce, signing and RPC", async () => {
  const f = fixture();
  expect(await f.client.resolveProofOperation(async () => { throw new Error("provider reached"); })).toMatchObject({ hash: null, deliveryEnabled: false });
  expect(f.state.signs + f.state.sends + f.state.nonceReads).toBe(0);
});
test("internal actual coordinator path signs exact capped envelope once, never duplicates a checkpoint", async () => {
  const f = fixture(); const hash = await f.run();
  expect(await f.run()).toBe(hash);
  expect(f.state.signs).toBe(1); expect(f.state.sends).toBe(1);
  expect(f.envelopes[0]).toMatchObject({ to: game, data: plan().data, nonce: 4, gas: 16_777_216n, value: 0n, maxFeePerGas: 210n });
});
test("ambiguous proof blocks shared ordinary nonce; receipt-only recovery never re-signs or resends", async () => {
  const f = fixture(); f.state.ambiguous = true;
  await expect(f.run()).rejects.toThrow("connection lost");
  await expect(f.run()).rejects.toThrow("receipt unknown");
  await expect(f.sibling()).rejects.toThrow("receipt unknown");
  f.state.mined = true; f.state.nonce++;
  // Competitor acceptance can remove the next plan; recovery still consumes retained receipt.
  expect(await f.run(async () => undefined)).toBeNull();
  expect(f.state.signs).toBe(1); expect(f.state.sends).toBe(1);
  f.state.reorg = true;
  await expect(f.client.reconcileProofOperations()).rejects.toThrow("not canonical");
  expect(f.state.sends).toBe(1);
});
for (const failure of ["paused", "oracleFail", "expensive", "simulationFail", "stale", "reorg"] as const) {
  test(failure + " prevents signing and send", async () => {
    const f = fixture(); f.state[failure] = true;
    await expect(f.run()).rejects.toThrow(); expect(f.state.signs).toBe(0); expect(f.state.sends).toBe(0);
  });
}
test("changed frozen identity before sign rejects; competitor after sign prevents broadcast", async () => {
  const f = fixture(); let reads = 0;
  await expect(f.run(async () => ++reads >= 3 ? plan("1") : plan())).rejects.toThrow("identity changed");
  expect(f.state.signs).toBe(0);
  const g = fixture(); let accepted = false; g.state.onSign = () => { accepted = true; };
  await expect(g.run(async () => accepted ? undefined : plan())).rejects.toThrow("changed or completed");
  expect(g.state.signs).toBe(1); expect(g.state.sends).toBe(0);
  await expect(g.client.reconcileProofOperations()).rejects.toThrow("explicit recovery"); expect(g.state.sends).toBe(0);
});
test("reorg after signing prevents initial send and retained hash never becomes replay permission", async () => {
  const f = fixture(); f.state.onSign = () => { f.state.reorg = true; };
  await expect(f.run()).rejects.toThrow("block changed");
  expect(f.state.signs).toBe(1); expect(f.state.sends).toBe(0);
  await expect(f.client.reconcileProofOperations()).rejects.toThrow("explicit recovery"); expect(f.state.sends).toBe(0);
});
test("strict proof identity disallows other selector, battle, hash, release and noncanonical memberships", () => {
  const original = plan();
  for (const change of [{ operationId: "mission:7" }, { data: "0xdeadbeef" }, { to: address }, { blockNumber: -1n },
    { membership: original.membership.replace('"battleId":"7"', '"battleId":"8"') },
    { membership: original.membership.replace('"release":', '"unknown":') }]) {
    expect(() => validateProofPlan({ ...original, ...change } as ProofExecutionPlan, 8453, game)).toThrow();
  }
  const fields = JSON.parse(original.membership);
  const otherData = encodeFunctionData({ abi, functionName: "applyProofBattleLeaves", args: [8n, []] });
  expect(() => validateProofPlan({ ...original, data: otherData, ...proofOperationIdentity(fields, otherData) }, 8453, game)).toThrow("battle mismatch");
});
test("restart recovers canonical proof receipt without artifact, signer or new nonce", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proof-adapter-"));
  try {
    const path = join(dir, "resolver.sqlite");
    const first = fixture(path); first.state.ambiguous = true;
    await expect(first.run()).rejects.toThrow("connection lost");
    const restarted = fixture(path); restarted.state.mined = true; restarted.state.nonce = 5;
    await restarted.client.reconcileProofOperations();
    expect(restarted.state.signs + restarted.state.sends + restarted.state.nonceReads).toBe(0);
    expect(await restarted.run(async () => undefined)).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("lease loss during exact simulation fences actual signer", async () => {
  const f = fixture();
  f.state.onCall = () => {
    const db = (f.coordinator as unknown as { database: import("bun:sqlite").Database }).database;
    db.query("UPDATE resolver_transaction_leases SET expires_at_ms = 0").run();
  };
  await expect(f.run()).rejects.toThrow("lease was lost");
  expect(f.state.signs + f.state.sends).toBe(0);
});
test("proof calldata retains full 384 bytes and rejects compressed proof or mismatched public binding", () => {
  const original = plan(); const fields = { ...JSON.parse(original.membership), action: "submit" };
  const inputs = Array.from({ length: 22 }, () => 0n); inputs[0] = 1n; inputs[4] = 3n;
  const make = (proof: Hex) => {
    const data = encodeFunctionData({ abi, functionName: "submitBattleProof", args: [7n, proof, inputs as never] });
    return { ...original, data, ...proofOperationIdentity(fields, data) };
  };
  const full = "0x" + "ab".repeat(384) as Hex;
  expect(validateProofPlan(make(full), 8453, game).data).toContain(full.slice(2));
  expect(() => validateProofPlan(make("0x1234"), 8453, game)).toThrow("submission");
  inputs[0] = 9n;
  expect(() => validateProofPlan(make(full), 8453, game)).toThrow("public identity");
});
test("application supports 32 leaves plus remainder and rejects 33", () => {
  const original = plan(); const fields = JSON.parse(original.membership);
  const leaf = { cohortId: 1n, owner: address, source: 1n, side: 0, unit: 1, enrolledCount: 2, lost: 0, survivors: 2, next: blockHash };
  for (const count of [32, 1, 33]) {
    const data = encodeFunctionData({ abi, functionName: "applyProofBattleLeaves", args: [7n, Array.from({ length: count }, () => leaf)] });
    const current = { ...original, data, ...proofOperationIdentity(fields, data) };
    if (count === 33) expect(() => validateProofPlan(current, 8453, game)).toThrow("application");
    else expect(validateProofPlan(current, 8453, game).data).toBe(data);
  }
});
test("reverted inclusion remains evidence only, not claimed battle success", async () => {
  const f = fixture(); f.state.reverted = true; const hash = await f.run();
  expect(await f.run()).toBe(hash);
  await f.client.reconcileProofOperations(); expect(f.state.sends).toBe(1);
});
