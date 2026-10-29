import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionResult, keccak256, TransactionNotFoundError, TransactionReceiptNotFoundError, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defaultMissionBatchPolicy, missionBatchAbi } from "./missionBatch";
import { ViemMissionResolutionChainClient } from "./missionResolution";
import { ResolverTransactionCoordinator } from "./resolverTransactions";

const account = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
const address = account.address;
const game = "0x2222222222222222222222222222222222222222" as const;
const blockHash = "0x" + "aa".repeat(32);
const base = 1_800_000_000;
const chain = { id: 8453, name: "inert", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://invalid.test"] } } };
let inertBytes: `0x${string}`; // fixture-only signed envelope; no network used

type Options = {
  blockAge?: number; exactDelayMs?: number; canonicalDelayMs?: number; signingDelayMs?: number;
  broadcastReadDelayMs?: number; mismatchQuote?: boolean; reorgAfterSign?: boolean;
  missingFee?: boolean; futureBlock?: boolean; ambiguous?: boolean;
  loseLeaseBeforeSign?: boolean; loseLeaseDuringSigning?: boolean; seedSuccessor?: boolean;
};
async function scenario(options: Options, check: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "batch-freshness-"));
  const originalNow = Date.now;
  let clock = base * 1000;
  Date.now = () => clock;
  try { await check(fixture(join(dir, "intents.sqlite"), options, (ms) => { clock += ms; }, () => clock)); }
  finally { Date.now = originalNow; rmSync(dir, { recursive: true, force: true }); }
}
function fixture(path: string, options: Options, advance: (ms: number) => void, now: () => number) {
  let signs = 0, sends = 0, blocks = 0, exactCalls = 0, mined = false;
  // Chain controls for retirement proofs; fresh blocks follow the fixture clock.
  const chainState: { latest?: number; pending?: number; seen?: boolean; readError?: boolean; onNonceRead?: () => void; fresh?: boolean } = {};

  const receipt = { status: "success", blockNumber: 1n, blockHash, gasUsed: 100_000n,
    effectiveGasPrice: 100n, l1Fee: 200n, operatorFee: 0n };
  const loseLease = () => {
    const db = new Database(path);
    db.query("UPDATE resolver_transaction_leases SET holder = 'successor'").run();
    if (options.seedSuccessor) db.query("UPDATE resolver_transaction_attempts SET nonce = 5, transaction_hash = ?, status = 'submitted'")
      .run("0x" + "bb".repeat(32));
    db.close();
  };
  const publicClient = {
    getStorageAt: async () => "0x00",
    getTransactionCount: async ({ blockTag }: { blockTag: "latest" | "pending" }) => {
      chainState.onNonceRead?.();
      if (chainState.readError) throw new Error("rpc unavailable");
      const nonce = mined ? 5 : 4;
      return blockTag === "pending" ? chainState.pending ?? nonce : chainState.latest ?? nonce;
    },
    getBlock: async () => {
      blocks++;
      // initial block, packing quote, prepare block, final quote, pre-sign canonical, pre-send canonical
      if (blocks === 5) {
        advance(options.canonicalDelayMs ?? 0);
        if (options.loseLeaseBeforeSign) loseLease();
      }
      if (blocks === 6) advance(options.broadcastReadDelayMs ?? 0);
      return { number: 1n, hash: (options.mismatchQuote && blocks === 4) || (options.reorgAfterSign && blocks === 6)
        ? "0x" + "bb".repeat(32) : blockHash,
        timestamp: chainState.fresh ? BigInt(Math.floor(now() / 1000) - 1)
          : BigInt(base - (options.blockAge ?? 29) + (options.futureBlock ? 100 : 0)), baseFeePerGas: 100n, gasLimit: 30_000_000n };
    },
    estimateMaxPriorityFeePerGas: async () => 10n,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals" || functionName === "latestRoundData") throw new Error("no USD dependency");
      if (options.missingFee && functionName === "getOperatorFee") throw new Error("operator fee unavailable");
      return functionName === "fleetMissionEligibility" ? [false, 9n, true] : 100n;
    },
    call: async () => {
      // Simulations alternate reference/exact: packing (1, 2), final leased quote (3, 4).
      if (++exactCalls === 4) advance(options.exactDelayMs ?? 0);
      return { data: encodeFunctionResult({ abi: missionBatchAbi, functionName: "resolveFleetMissionBatch", result: [[0], 100_000n] }) };
    },
    sendRawTransaction: async () => {
      sends++;
      if (options.ambiguous) throw new Error("connection lost after send");
      mined = true;
      return keccak256(inertBytes);
    },
    waitForTransactionReceipt: async () => receipt,
    getTransaction: async () => {
      if (chainState.seen) return { hash: keccak256(inertBytes), blockHash: null };
      throw new TransactionNotFoundError({});
    },
    getTransactionReceipt: async () => { if (!mined) throw new TransactionReceiptNotFoundError({ hash: keccak256(inertBytes) }); return { ...receipt, transactionHash: keccak256(inertBytes), from: address, to: game }; }
  };
  const sender = { address, signTransaction: async (tx: Parameters<typeof account.signTransaction>[0]) => {
    signs++;
    if (signs === 1) advance(options.signingDelayMs ?? 0);
    if (options.loseLeaseDuringSigning) loseLease();
    inertBytes = await account.signTransaction(tx);
    return inertBytes;
  } };
  const makeClient = () => new ViemMissionResolutionChainClient({
    listResolvableFleetMissions: async () => [], listReturnableFleetMissions: async () => [],
    isFleetChronologyOrderingReady: async () => true,
    getCanonicalFleetMission: async () => ({ status: "Outbound", arrivalAt: String(base - 5), returnAt: String(base + 5) }) as never
  }, game, sender as never, publicClient as unknown as PublicClient, undefined, chain, undefined,
  new ResolverTransactionCoordinator(path, { sleep: async (ms) => advance(ms) }), undefined, undefined,
  { ...defaultMissionBatchPolicy, enabled: true, maxItems: 2 });
  const rows = () => {
    const db = new Database(path);
    try { return db.query("SELECT nonce, transaction_hash AS hash, membership, status FROM resolver_prepared_intents").all(); }
    finally { db.close(); }
  };
  const signingRows = () => {
    const db = new Database(path);
    try { return db.query("SELECT r.nonce, r.membership, r.transferred, s.transaction_hash AS hash FROM resolver_signing_reservations r LEFT JOIN resolver_signing_results s ON s.reservation_id = r.id").all(); }
    finally { db.close(); }
  };
  const attempts = () => {
    const db = new Database(path);
    try { return db.query("SELECT nonce, transaction_hash AS hash, status FROM resolver_transaction_attempts").all(); }
    finally { db.close(); }
  };
  // Retirement evidence: retired identities, and every place the signed bytes could still live.
  const retirement = () => {
    const db = new Database(path);
    try {
      return {
        retired: db.query("SELECT nonce, transaction_hash AS hash, membership, json_extract(evidence,'$.reason') AS reason FROM resolver_retired_intents").all(),
        rawIntents: (db.query("SELECT count(*) AS n FROM resolver_prepared_intents WHERE serialized_transaction IS NOT NULL").get() as { n: number }).n,
        rawResults: (db.query("SELECT count(*) AS n FROM resolver_signing_results WHERE serialized_transaction IS NOT NULL").get() as { n: number }).n,
        audit: db.query("SELECT nonce, status FROM resolver_transaction_audit ORDER BY sequence").all()
      };
    } finally { db.close(); }
  };
  const write = (sql: string) => { const db = new Database(path); try { db.query(sql).run(); } finally { db.close(); } };
  return { client: makeClient(), restart: makeClient, rows, signingRows, attempts, retirement, write, chainState, loseLease, advance, counts: () => ({ signs, sends }),
    items: [{ missionId: "1", leg: "arrival" as const, dueAt: base - 5 }] };
}

test("actual batch path accepts fresh29 and exact30 fee quote boundaries", async () => {
  for (const options of [{}, { exactDelayMs: 1000 }, { signingDelayMs: 1000 },
    { blockAge: 0, signingDelayMs: 30_000 }, { blockAge: 0, exactDelayMs: 30_000 }]) {
    await scenario(options, async (f) => {
      expect((await f.client.resolveMissionBatch(f.items)).hash).toBe(keccak256(inertBytes));
      expect(f.counts()).toEqual({ signs: 1, sends: 1 });
    });
  }
});

test("actual exact simulation and final canonical await cannot age a fee quote into signing", async () => {
  for (const options of [{ blockAge: 31 }, { exactDelayMs: 2000 }, { canonicalDelayMs: 2000 },
    { blockAge: 0, exactDelayMs: 30_001 }, { blockAge: 0, canonicalDelayMs: 30_001 },
    { mismatchQuote: true }, { missingFee: true }, { futureBlock: true }]) {
    await scenario(options, async (f) => {
      await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow();
      expect(f.counts()).toEqual({ signs: 0, sends: 0 });
      expect(f.rows()).toEqual([]);
    });
  }
});

test("signing/pre-send expiry prevents the send; restart retires the undispatched envelope and reuses its nonce", async () => {
  for (const options of [{ signingDelayMs: 2000 }, { signingDelayMs: 31_000 },
    { blockAge: 0, signingDelayMs: 30_001 }, { broadcastReadDelayMs: 2000 },
    { blockAge: 0, broadcastReadDelayMs: 30_001 }, { reorgAfterSign: true }]) {
    await scenario(options, async (f) => {
      await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow();
      expect(f.counts()).toEqual({ signs: 1, sends: 0 });
      const preventedHash = keccak256(inertBytes);
      const saved = [{ nonce: 4, hash: preventedHash, membership: JSON.stringify(f.items), status: "prevented" }];
      expect(f.rows()).toEqual(saved);
      // An empty pass (e.g. a sibling writer's reconciliation) retires it: no signature, no send.
      const restarted = f.restart();
      await restarted.resolveMissionBatch([]);
      expect(f.counts()).toEqual({ signs: 1, sends: 0 });
      expect(f.rows()).toEqual([]);
      const evidence = f.retirement();
      expect(evidence.retired).toEqual([{ nonce: 4, hash: preventedHash, membership: JSON.stringify(f.items), reason: "prevented-before-dispatch" }]);
      expect(evidence.rawIntents).toBe(0);
      expect(evidence.rawResults).toBe(0);
      expect(evidence.audit.map((row: any) => row.status)).toEqual(["allocating", "submitted", "prevented", "retired"]);
      expect(f.attempts()).toEqual([{ nonce: 4, hash: preventedHash, status: "retired" }]);
      // The same legs are then signed afresh at the unused nonce and sent once.
      f.chainState.fresh = true;
      // The fixture's fee inputs are unchanged, so the fresh signature reproduces the retired
      // hash: the retired evidence must not collide with the new intent row.
      expect((await restarted.resolveMissionBatch(f.items)).hash).toBe(preventedHash);
      expect(f.counts()).toEqual({ signs: 2, sends: 1 });
      expect(f.rows()).toEqual([{ nonce: 4, hash: keccak256(inertBytes), membership: JSON.stringify(f.items), status: "confirmed" }]);
    });
  }
});

test("prevented intent stays fenced unless the journal and chain prove it was never dispatched", async () => {
  const fence = "INSERT OR IGNORE INTO resolver_send_fences VALUES (8453, lower('" + address + "'), 't', 'h', 1, '0x00')";
  const cases: Array<[string, (f: any) => void, string]> = [
    ["nonce consumed", (f) => { f.chainState.latest = 5; f.chainState.pending = 5; }, "signer nonce is not exactly the prevented nonce"],
    ["pending ahead", (f) => { f.chainState.pending = 5; }, "signer nonce is not exactly the prevented nonce"],
    ["nonce behind", (f) => { f.chainState.latest = 3; f.chainState.pending = 3; }, "signer nonce is not exactly the prevented nonce"],
    ["hash known", (f) => { f.chainState.seen = true; }, "envelope visible on chain"],
    ["rpc down", (f) => { f.chainState.readError = true; }, "automatic retirement unavailable: rpc-unavailable"],
    ["send attempted", (f) => f.write("UPDATE resolver_prepared_intents SET send_attempts = 1"), "not provably undispatched"],
    ["validated", (f) => f.write("UPDATE resolver_prepared_intents SET replay_state = 'ready'"), "not provably undispatched"],
    ["no bytes", (f) => f.write("UPDATE resolver_prepared_intents SET serialized_transaction = NULL"), "not provably undispatched"],
    ["attempt moved", (f) => f.write("UPDATE resolver_transaction_attempts SET status = 'submitted'"), "attempt identity changed"],
    ["foreign send fence before lease", (f) => f.write(fence), "send still outstanding"],
    ["send fence during proof", (f) => { f.chainState.onNonceRead = () => f.write(fence); }, "automatic retirement unavailable: send outstanding"],
    ["concurrent intent change", (f) => { f.chainState.onNonceRead = () => f.write("UPDATE resolver_prepared_intents SET send_attempts = 1"); }, "automatic retirement unavailable: intent changed"],
    ["later journal nonce", (f) => f.write("INSERT INTO resolver_prepared_intents (chain_id,resolver_address,operation_id,nonce,transaction_hash,membership,status) VALUES (8453, lower('" + address + "'), 'later', 5, '0x" + "cc".repeat(32) + "', '[]', 'finalized')"), "automatic retirement unavailable: later journal nonce"],
    ["binding mismatch", (f) => f.write("UPDATE resolver_signing_reservations SET membership = 'changed'"), "automatic retirement unavailable: signed envelope binding mismatch"],
    ["lease lost mid-proof", (f) => { f.chainState.onNonceRead = () => f.loseLease(); }, "lease was lost"]
  ];
  for (const [name, arrange, reason] of cases) {
    await scenario({ signingDelayMs: 31_000 }, async (f) => {
      await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow();
      const saved = f.rows();
      expect(saved).toEqual([{ nonce: 4, hash: keccak256(inertBytes), membership: JSON.stringify(f.items), status: "prevented" }]);
      arrange(f);
      const attempt = f.restart().resolveMissionBatch(f.items);
      if (reason) await expect(attempt, name).rejects.toThrow(reason);
      else await expect(attempt, name).rejects.toThrow();
      expect(f.counts(), name).toEqual({ signs: 1, sends: 0 });
      expect(f.rows().filter((row: any) => row.nonce === 4), name).toEqual(saved);
      expect(f.retirement().retired, name).toEqual([]); // includes a rolled-back retirement transaction
      expect(f.retirement().rawResults, name).toBe(1);
    });
  }
});

test("lease replaced during last canonical read prevents the actual signer and any signing reservation", async () => {
  await scenario({ loseLeaseBeforeSign: true, seedSuccessor: true }, async (f) => {
    await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("lease was lost");
    expect(f.counts()).toEqual({ signs: 0, sends: 0 });
    expect(f.signingRows()).toEqual([]);
    expect(f.rows()).toEqual([]);
    expect(f.attempts()).toEqual([{ nonce: 5, hash: "0x" + "bb".repeat(32), status: "submitted" }]);
  });
});

test("lease lost during async signing retains immutable original hash without touching successor or re-signing", async () => {
  for (const seedSuccessor of [false, true]) await scenario({ loseLeaseDuringSigning: true, seedSuccessor }, async (f) => {
    await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("lease was lost");
    const evidence = [{ nonce: 4, membership: JSON.stringify(f.items), hash: keccak256(inertBytes), transferred: 0 }];
    const attempts = seedSuccessor ? [{ nonce: 5, hash: "0x" + "bb".repeat(32), status: "submitted" }]
      : [{ nonce: 4, hash: null, status: "allocating" }];
    expect(f.signingRows()).toEqual(evidence);
    expect(f.rows()).toEqual([]);
    expect(f.attempts()).toEqual(attempts);
    f.advance(90_001); // successor lease expires; restart acquires a new fence, not the old holder
    await expect(f.restart().resolveMissionBatch(f.items)).rejects.toThrow("explicit fenced recovery");
    await expect(f.restart().resolveMissionBatch([])).rejects.toThrow("explicit fenced recovery");
    expect(f.counts()).toEqual({ signs: 1, sends: 0 });
    expect(f.signingRows()).toEqual(evidence);
    expect(f.attempts()).toEqual(attempts);
  });
});

test("ambiguous network submission stays pending and never becomes locally prevented on restart", async () => {
  await scenario({ ambiguous: true }, async (f) => {
    await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow("recoverable pending");
    f.advance(31_000);
    await expect(f.restart().resolveMissionBatch(f.items)).rejects.toThrow("cooling down");
    expect(f.counts()).toEqual({ signs: 1, sends: 3 });
    expect(f.rows()).toEqual([{ nonce: 4, hash: keccak256(inertBytes), membership: JSON.stringify(f.items), status: "pending" }]);
  });
});
