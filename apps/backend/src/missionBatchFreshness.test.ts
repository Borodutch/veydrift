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
  try { await check(fixture(join(dir, "intents.sqlite"), options, (ms) => { clock += ms; })); }
  finally { Date.now = originalNow; rmSync(dir, { recursive: true, force: true }); }
}
function fixture(path: string, options: Options, advance: (ms: number) => void) {
  let signs = 0, sends = 0, blocks = 0, exactCalls = 0, mined = false;

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
    getTransactionCount: async () => mined ? 5 : 4,
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
        timestamp: BigInt(base - (options.blockAge ?? 29) + (options.futureBlock ? 100 : 0)), baseFeePerGas: 100n, gasLimit: 30_000_000n };
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
    getTransaction: async () => { throw new TransactionNotFoundError({}); },
    getTransactionReceipt: async () => { if (!mined) throw new TransactionReceiptNotFoundError({ hash: keccak256(inertBytes) }); return { ...receipt, transactionHash: keccak256(inertBytes), from: address, to: game }; }
  };
  const sender = { address, signTransaction: async (tx: Parameters<typeof account.signTransaction>[0]) => {
    signs++;
    advance(options.signingDelayMs ?? 0);
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
  return { client: makeClient(), restart: makeClient, rows, signingRows, attempts, advance, counts: () => ({ signs, sends }),
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

test("signing/pre-send awaits expiring fee quote preserve locally prevented intent across restart", async () => {
  for (const options of [{ signingDelayMs: 2000 }, { signingDelayMs: 31_000 },
    { blockAge: 0, signingDelayMs: 30_001 }, { broadcastReadDelayMs: 2000 },
    { blockAge: 0, broadcastReadDelayMs: 30_001 }, { reorgAfterSign: true }]) {
    await scenario(options, async (f) => {
      await expect(f.client.resolveMissionBatch(f.items)).rejects.toThrow();
      expect(f.counts()).toEqual({ signs: 1, sends: 0 });
      const saved = [{ nonce: 4, hash: keccak256(inertBytes), membership: JSON.stringify(f.items), status: "prevented" }];
      expect(f.rows()).toEqual(saved);
      const restarted = f.restart();
      await expect(restarted.resolveMissionBatch(f.items)).rejects.toThrow("locally prevented");
      await expect(restarted.resolveMissionBatch([])).rejects.toThrow("locally prevented");
      expect(f.counts()).toEqual({ signs: 1, sends: 0 });
      expect(f.rows()).toEqual(saved);
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
