import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { advance, initialize, result, RULES, type Group, type State } from "@veydrift/battle-oracle";
import { catalog, rapidfire } from "@veydrift/battle-oracle/catalog";
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { BackendConfig } from "./config";
import { cancelResolverTransaction } from "./resolverCancellation";
import { resolverReplacementFees, resolverTransactionNeedsReplacement } from "./resolverReplacementFees";
import { ResolverTransactionCoordinator } from "./resolverTransactions";
import { safeDiagnosticText } from "./safeDiagnostics";

/**
 * Ticket #44 trusted battle referee. Attack battles launched under a nonzero referee version freeze
 * their roster and seed onchain (phase 16), wait for the revealed seed (phase 17), then this service
 * replays the published OGame combat rules, commits one immutable result and applies per-row
 * casualty leaves. Anyone can audit a result: the report served by hash replays from onchain
 * records + seed with packages/battle-oracle.
 */

// Ship costs are the contract's (losses and debris are priced onchain); combat values come from the
// referee's OGame catalog, whose exact bytes are pinned onchain as the battle's catalog hash.
const shipCosts = new Map<number, { metal: bigint; crystal: bigint }>(
  (JSON.parse(readFileSync(new URL("../../../packages/contracts/combat-preview-catalog.json", import.meta.url), "utf8")) as
    { ships: { id: number; metal: number; crystal: number }[] }).ships
    .map((ship) => [ship.id, { metal: BigInt(ship.metal), crystal: BigInt(ship.crystal) }])
);
export const refereeRulesHash = keccak256(stringToHex(RULES));
export const refereeCatalogHash = keccak256(
  readFileSync(new URL("../../../packages/battle-oracle/referee-catalog.json", import.meta.url))
);
const leafDomain = keccak256(stringToHex("veydrift.referee-battle.result-leaf.v1"));
const tailDomain = keccak256(stringToHex("veydrift.referee-battle.result-tail.v1"));
export const maxLeavesPerTransaction = 32;
// ponytail: whole battle replays in-process with periodic yields; move to a worker thread if
// multi-second replays start delaying the writer's chain sync.
const replayShotSlice = 20_000;
const maxExpandedUnits = 5_000_000;

export type RefereeVersion = { version: number; rules: Hex; catalog: Hex };
export type RefereeRow = {
  source: bigint; owner: Hex; count: number; side: number; unit: number;
  weapons: number; shielding: number; armor: number;
};
export type RefereeLeaf = {
  owner: Hex; source: bigint; side: number; unit: number;
  enrolledCount: number; lost: number; survivors: number; next: Hex;
};
export type RefereeBattleInput = {
  chainId: number; game: Hex; battleId: bigint; binding: Hex; seed: bigint;
  version: RefereeVersion; rows: RefereeRow[];
};
/** Mirrors staged combat's CombatRoundResolved: remaining units after the round, round ship losses. */
export type RefereeRoundSummary = {
  attackerUnits: bigint; defenderUnits: bigint;
  attackerLossMetal: bigint; attackerLossCrystal: bigint; defenderLossMetal: bigint; defenderLossCrystal: bigint;
};
export type RefereeResult = {
  report: string; reportHash: Hex; root: Hex; rounds: number; totals: [bigint, bigint]; leaves: RefereeLeaf[];
  summary: RefereeRoundSummary[];
};

export function leafHash(binding: Hex, index: bigint, leaf: RefereeLeaf): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,uint256,address,uint256,uint8,uint8,uint32,uint32,uint32,bytes32"),
    [leafDomain, binding, index, leaf.owner, leaf.source, leaf.side, leaf.unit,
      leaf.enrolledCount, leaf.lost, leaf.survivors, leaf.next]
  ));
}

export function tailHash(binding: Hex, count: bigint): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint256"), [tailDomain, binding, count]));
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Deterministic replay of one frozen battle into its report, leaf chain and declared totals. */
export async function refereeBattle(input: RefereeBattleInput): Promise<RefereeResult> {
  if (input.version.rules.toLowerCase() !== refereeRulesHash || input.version.catalog.toLowerCase() !== refereeCatalogHash) {
    throw new Error(`battle ${input.battleId} froze unsupported referee rules/catalog`);
  }
  // Journal row order is the canonical roster: resident first, then leader, joiners, defenders.
  const groups: Group[] = input.rows.map((row) => ({
    side: row.side === 0 ? 0 : 1,
    owner: row.owner.toLowerCase(),
    source: row.source.toString(),
    type: row.unit,
    count: row.count,
    technology: { weapons: row.weapons, shielding: row.shielding, armor: row.armor }
  }));
  const state: State = initialize(
    { seed: `0x${input.seed.toString(16).padStart(64, "0")}`, catalog, rapidfire, groups },
    maxExpandedUnits
  );
  while (!state.done) {
    advance(state, replayShotSlice);
    await yieldToEventLoop();
  }
  const outcome = result(state);
  const lostBySourceUnit = new Map(outcome.allocation.map((entry) => [`${entry.source}:${entry.type}`, entry.lost]));

  const leaves: RefereeLeaf[] = input.rows.map((row) => {
    const lost = lostBySourceUnit.get(`${row.source}:${row.unit}`);
    if (lost === undefined) throw new Error(`battle ${input.battleId} replay is missing row ${row.source}:${row.unit}`);
    return {
      owner: row.owner, source: row.source, side: row.side, unit: row.unit,
      enrolledCount: row.count, lost, survivors: row.count - lost, next: "0x"
    };
  });
  let root = tailHash(input.binding, BigInt(leaves.length));
  const totals: [bigint, bigint] = [0n, 0n];
  for (let index = leaves.length - 1; index >= 0; index -= 1) {
    const leaf = leaves[index]!;
    leaf.next = root;
    root = leafHash(input.binding, BigInt(index), leaf);
    totals[leaf.side === 0 ? 0 : 1] += BigInt(leaf.survivors);
  }

  const unitsBySideType = (counts: number[]) => {
    const merged = new Map<string, { side: number; unit: number; count: number }>();
    state.groups.forEach((group, index) => {
      const key = `${group.side}:${group.type}`;
      const entry = merged.get(key) ?? { side: group.side, unit: group.type, count: 0 };
      entry.count += counts[index] ?? 0;
      merged.set(key, entry);
    });
    return [...merged.values()];
  };
  let before = state.groups.map((group) => group.count);
  const summary = outcome.rounds.map((round) => {
    const entry: RefereeRoundSummary = {
      attackerUnits: 0n, defenderUnits: 0n,
      attackerLossMetal: 0n, attackerLossCrystal: 0n, defenderLossMetal: 0n, defenderLossCrystal: 0n
    };
    state.groups.forEach((group, index) => {
      const after = round.survivors[index] ?? 0;
      if (group.side === 0) entry.attackerUnits += BigInt(after);
      else entry.defenderUnits += BigInt(after);
      const cost = shipCosts.get(group.type);
      if (!cost || group.type >= 16) return;
      const destroyed = BigInt((before[index] ?? 0) - after);
      if (group.side === 0) {
        entry.attackerLossMetal += cost.metal * destroyed;
        entry.attackerLossCrystal += cost.crystal * destroyed;
      } else {
        entry.defenderLossMetal += cost.metal * destroyed;
        entry.defenderLossCrystal += cost.crystal * destroyed;
      }
    });
    before = round.survivors;
    return entry;
  });
  const report = JSON.stringify({
    format: "veydrift.referee-battle.report.v1",
    chainId: input.chainId,
    game: input.game.toLowerCase(),
    battleId: input.battleId.toString(),
    binding: input.binding,
    rules: RULES,
    rulesHash: refereeRulesHash,
    catalogHash: refereeCatalogHash,
    version: input.version.version,
    seed: `0x${input.seed.toString(16).padStart(64, "0")}`,
    outcome: outcome.outcome,
    rounds: outcome.rounds.map((round) => ({
      round: round.round,
      shots: round.shots.map(String),
      survivors: unitsBySideType(round.survivors)
    })),
    rows: leaves.map((leaf) => ({
      source: leaf.source.toString(), owner: leaf.owner.toLowerCase(), side: leaf.side, unit: leaf.unit,
      count: leaf.enrolledCount, lost: leaf.lost, survivors: leaf.survivors
    })),
    root
  });
  return {
    report,
    reportHash: keccak256(stringToHex(report)),
    root,
    rounds: outcome.rounds.length,
    totals,
    leaves,
    summary
  };
}

/** Durable reports by hash. Readers open it read-only; only the writer's referee inserts. */
export class BattleReportStore {
  private readonly database: Database;

  constructor(path: string, readonly = false) {
    this.database = readonly ? new Database(path, { readonly: true }) : new Database(path, { create: true });
    if (!readonly) {
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec(`CREATE TABLE IF NOT EXISTS battle_reports (
        report_hash TEXT PRIMARY KEY, battle_id TEXT NOT NULL, report TEXT NOT NULL, created_at TEXT NOT NULL)`);
      this.database.exec("CREATE INDEX IF NOT EXISTS battle_reports_battle ON battle_reports (battle_id)");
      this.database.exec("CREATE TABLE IF NOT EXISTS referee_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      this.database.exec("CREATE TABLE IF NOT EXISTS referee_pending (battle_id TEXT PRIMARY KEY)");
    }
  }

  saveReport(battleId: bigint, reportHash: Hex, report: string): void {
    this.database.query(
      "INSERT OR IGNORE INTO battle_reports (report_hash, battle_id, report, created_at) VALUES (?, ?, ?, ?)"
    ).run(reportHash.toLowerCase(), battleId.toString(), report, new Date().toISOString());
  }

  report(reportHash: string): string | null {
    const row = this.database.query("SELECT report FROM battle_reports WHERE report_hash = ?")
      .get(reportHash.toLowerCase()) as { report: string } | null;
    return row?.report ?? null;
  }

  reportForBattle(battleId: string): { reportHash: string; report: string } | null {
    const row = this.database.query("SELECT report_hash, report FROM battle_reports WHERE battle_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(battleId) as { report_hash: string; report: string } | null;
    return row ? { reportHash: row.report_hash, report: row.report } : null;
  }

  cursor(): bigint | null {
    const row = this.database.query("SELECT value FROM referee_state WHERE key = 'cursor'").get() as { value: string } | null;
    return row ? BigInt(row.value) : null;
  }

  saveDiscovery(cursor: bigint, battleIds: bigint[]): void {
    this.database.transaction(() => {
      for (const id of battleIds) {
        this.database.query("INSERT OR IGNORE INTO referee_pending (battle_id) VALUES (?)").run(id.toString());
      }
      this.database.query("INSERT OR REPLACE INTO referee_state (key, value) VALUES ('cursor', ?)").run(cursor.toString());
    })();
  }

  pending(): bigint[] {
    return (this.database.query("SELECT battle_id FROM referee_pending").all() as { battle_id: string }[])
      .map((row) => BigInt(row.battle_id))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  finish(battleId: bigint): void {
    this.database.query("DELETE FROM referee_pending WHERE battle_id = ?").run(battleId.toString());
  }
}

// Referee.Phase and Settlement.Phase enums from the contracts.
export const RefereePhase = { Legacy: 0, Preparing: 1, AwaitingRandomness: 2, AwaitingResult: 3, Bypassed: 4 } as const;
export const SettlementPhase = { Unaccepted: 0, Applying: 1, Economics: 2 } as const;

export type RefereeBattleStatus = {
  version: RefereeVersion; phase: number; seed: bigint; rowCount: number;
  engine: Hex; requestId: bigint;
};

export interface RefereeChain {
  readonly chainId: number;
  readonly game: Hex;
  latestBlock(): Promise<bigint>;
  sealedBattles(fromBlock: bigint, toBlock: bigint): Promise<bigint[]>;
  status(battleId: bigint): Promise<RefereeBattleStatus>;
  rows(battleId: bigint, count: number): Promise<RefereeRow[]>;
  randomnessRevealed(engine: Hex, requestId: bigint): Promise<boolean>;
  binding(battleId: bigint): Promise<Hex>;
  progress(battleId: bigint): Promise<{ phase: number; nextIndex: number }>;
  acceptedRoot(battleId: bigint): Promise<Hex>;
  advance(battleId: bigint): Promise<Hex>;
  submit(battleId: bigint, result: RefereeResult): Promise<Hex>;
  apply(battleId: bigint, nextIndex: number, leaves: RefereeLeaf[]): Promise<Hex>;
}

export type BattleRefereeSnapshot = {
  enabled: boolean;
  resolver: string | null;
  rulesHash: Hex;
  catalogHash: Hex;
  pending: number;
  lastRunAt: string | null;
  lastError: string | null;
  failures: Record<string, string>;
};

/** One tick: discover sealed battles, then advance each pending battle by at most one transaction. */
export class BattleRefereeWorker {
  private readonly results = new Map<string, RefereeResult>();
  readonly failures = new Map<string, string>();

  constructor(
    private readonly chain: RefereeChain,
    private readonly store: BattleReportStore,
    private readonly options: { fromBlock?: bigint; logChunkSpan?: bigint } = {}
  ) {}

  async tick(): Promise<void> {
    await this.discover();
    for (const battleId of this.store.pending()) {
      try {
        await this.step(battleId);
        this.failures.delete(battleId.toString());
      } catch (error) {
        this.failures.set(battleId.toString(), safeDiagnosticText(error));
      }
    }
  }

  private async discover(): Promise<void> {
    const latest = await this.chain.latestBlock();
    let from = (this.store.cursor() ?? (this.options.fromBlock ?? latest) - 1n) + 1n;
    const span = this.options.logChunkSpan ?? 5_000n;
    while (from <= latest) {
      const to = from + span - 1n < latest ? from + span - 1n : latest;
      this.store.saveDiscovery(to, await this.chain.sealedBattles(from, to));
      from = to + 1n;
    }
  }

  private async replay(battleId: bigint, status: RefereeBattleStatus): Promise<RefereeResult> {
    const key = battleId.toString();
    const cached = this.results.get(key);
    if (cached) return cached;
    const computed = await refereeBattle({
      chainId: this.chain.chainId,
      game: this.chain.game,
      battleId,
      binding: await this.chain.binding(battleId),
      seed: status.seed,
      version: status.version,
      rows: await this.chain.rows(battleId, status.rowCount)
    });
    this.store.saveReport(battleId, computed.reportHash, computed.report);
    this.results.set(key, computed);
    return computed;
  }

  private done(battleId: bigint): void {
    this.store.finish(battleId);
    this.results.delete(battleId.toString());
  }

  async step(battleId: bigint): Promise<void> {
    const status = await this.chain.status(battleId);
    if (status.phase === RefereePhase.Legacy || status.phase === RefereePhase.Bypassed) {
      this.done(battleId);
      return;
    }
    if (status.phase === RefereePhase.AwaitingRandomness) {
      // Reveal timing belongs to the randomness fulfiller; consuming it is permissionless.
      if (await this.chain.randomnessRevealed(status.engine, status.requestId)) await this.chain.advance(battleId);
      return;
    }
    if (status.phase !== RefereePhase.AwaitingResult) return;

    const progress = await this.chain.progress(battleId);
    if (progress.phase === SettlementPhase.Economics) {
      // Remaining loot/debris/return phases continue through ordinary resolveFleetMission calls.
      this.done(battleId);
      return;
    }
    const computed = await this.replay(battleId, status);
    if (progress.phase === SettlementPhase.Unaccepted) {
      await this.chain.submit(battleId, computed);
      return;
    }
    const accepted = await this.chain.acceptedRoot(battleId);
    if (accepted.toLowerCase() !== computed.root.toLowerCase()) {
      throw new Error(`battle ${battleId} accepted root ${accepted} differs from local replay ${computed.root}`);
    }
    const batch = computed.leaves.slice(progress.nextIndex, progress.nextIndex + maxLeavesPerTransaction);
    await this.chain.apply(battleId, progress.nextIndex, batch);
  }
}

const gameAbi = parseAbi([
  "function refereeBattleRecord(uint256 id, uint8 kind, uint256 index) view returns (bytes)",
  "function battleResultBinding(uint256 id) view returns (bytes32)",
  "function battleResultProgress(uint256 id) view returns (uint8 phase, uint256 nextIndex, uint256 memberCount, bytes32 expectedDigest)",
  "function battleResultSummary(uint256 id) view returns (bytes32 binding, bytes32 reportHash, bytes32 root, uint256 members, uint8 rounds, uint256[2] totals, uint8 outcome, uint32 version)",
  "function submitBattleResult(uint256 id, bytes32 root, uint256[2] totals, bytes32 reportHash, (uint256 attackerUnits, uint256 defenderUnits, uint128 attackerLossMetal, uint128 attackerLossCrystal, uint128 defenderLossMetal, uint128 defenderLossCrystal)[] summary)",
  "function applyBattleResultLeaves(uint256 id, (address owner, uint256 source, uint8 side, uint8 unit, uint32 enrolledCount, uint32 lost, uint32 survivors, bytes32 next)[] leaves)",
  "function resolveFleetMission(uint256 missionId)",
  "event RefereeBattleSealed(uint256 indexed battleId, bytes32 snapshot, uint256 rows)"
]);
const randomnessAbi = parseAbi([
  "function request(uint256 requestId) view returns ((address requester, bytes32 purposeHash, bytes32 randomnessCommitment, uint64 createdAt, uint64 fulfilledAt, uint256 randomWord))"
]);
// Generous fixed envelope below Base's per-transaction cap; 32 cold leaves measured ~1.8M gas.
const refereeGasLimit = 6_000_000n;

export class ViemRefereeChain implements RefereeChain {
  readonly chainId: number;

  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly account: ReturnType<typeof privateKeyToAccount>,
    private readonly chain: ReturnType<typeof defineChain>,
    readonly game: Hex,
    private readonly coordinator: ResolverTransactionCoordinator
  ) {
    this.chainId = chain.id;
  }

  latestBlock(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async sealedBattles(fromBlock: bigint, toBlock: bigint): Promise<bigint[]> {
    const logs = await this.publicClient.getLogs({
      address: this.game,
      event: gameAbi.find((item) => item.type === "event" && item.name === "RefereeBattleSealed")!,
      fromBlock,
      toBlock
    });
    return logs.map((log) => log.args.battleId!).filter((id): id is bigint => id !== undefined);
  }

  private record(battleId: bigint, kind: number, index = 0n): Promise<Hex> {
    return this.publicClient.readContract({
      address: this.game, abi: gameAbi, functionName: "refereeBattleRecord", args: [battleId, kind, index]
    });
  }

  async status(battleId: bigint): Promise<RefereeBattleStatus> {
    const [version, phase, , , seed, rows] = decodeAbiParameters(
      parseAbiParameters("(uint32 version, bytes32 rules, bytes32 catalog), uint8, bytes32, bytes32, uint256, uint256"),
      await this.record(battleId, 0)
    );
    const [engine, requestId] = decodeAbiParameters(
      parseAbiParameters("address, uint256, bytes32"),
      await this.record(battleId, 5)
    );
    return { version, phase, seed, rowCount: Number(rows), engine, requestId };
  }

  async rows(battleId: bigint, count: number): Promise<RefereeRow[]> {
    const rows: RefereeRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const [row] = decodeAbiParameters(
        parseAbiParameters("(uint256 source, address owner, uint32 count, uint8 side, uint8 unit, uint16 weapons, uint16 shielding, uint16 armor)"),
        await this.record(battleId, 2, BigInt(index))
      );
      rows.push(row);
    }
    return rows;
  }

  async randomnessRevealed(engine: Hex, requestId: bigint): Promise<boolean> {
    const request = await this.publicClient.readContract({
      address: engine, abi: randomnessAbi, functionName: "request", args: [requestId]
    });
    return request.fulfilledAt !== 0n;
  }

  binding(battleId: bigint): Promise<Hex> {
    return this.publicClient.readContract({
      address: this.game, abi: gameAbi, functionName: "battleResultBinding", args: [battleId]
    });
  }

  async progress(battleId: bigint): Promise<{ phase: number; nextIndex: number }> {
    const [phase, nextIndex] = await this.publicClient.readContract({
      address: this.game, abi: gameAbi, functionName: "battleResultProgress", args: [battleId]
    });
    return { phase, nextIndex: Number(nextIndex) };
  }

  async acceptedRoot(battleId: bigint): Promise<Hex> {
    const summary = await this.publicClient.readContract({
      address: this.game, abi: gameAbi, functionName: "battleResultSummary", args: [battleId]
    });
    return summary[2];
  }

  advance(battleId: bigint): Promise<Hex> {
    return this.send(`referee:advance:${battleId}`, "resolveFleetMission", [battleId],
      async () => (await this.status(battleId)).phase !== RefereePhase.AwaitingRandomness);
  }

  submit(battleId: bigint, result: RefereeResult): Promise<Hex> {
    return this.send(`referee:submit:${battleId}`, "submitBattleResult",
      [battleId, result.root, result.totals, result.reportHash, result.summary],
      async () => (await this.progress(battleId)).phase !== SettlementPhase.Unaccepted);
  }

  apply(battleId: bigint, nextIndex: number, leaves: RefereeLeaf[]): Promise<Hex> {
    return this.send(`referee:apply:${battleId}:${nextIndex}`, "applyBattleResultLeaves", [battleId, leaves],
      async () => {
        const progress = await this.progress(battleId);
        return progress.phase !== SettlementPhase.Applying || progress.nextIndex > nextIndex;
      });
  }

  private send(
    operationId: string,
    functionName: "resolveFleetMission" | "submitBattleResult" | "applyBattleResultLeaves",
    args: readonly unknown[],
    isOperationComplete: () => Promise<boolean>
  ): Promise<Hex> {
    const write = (nonce: number, fees: object = {}) => this.walletClient.writeContract({
      abi: gameAbi, account: this.account, address: this.game, chain: this.chain,
      functionName, args, nonce, gas: refereeGasLimit, ...fees
    } as Parameters<WalletClient["writeContract"]>[0]);
    return this.coordinator.submit({
      chainId: this.chainId,
      address: this.account.address,
      operationId,
      isOperationComplete,
      getTransactionCount: (blockTag) => this.publicClient.getTransactionCount({ address: this.account.address, blockTag }),
      submit: async (nonce) => {
        // Simulate first so a stale/raced step never burns gas on a known revert.
        await this.publicClient.simulateContract({
          abi: gameAbi, account: this.account, address: this.game, functionName, args
        } as Parameters<PublicClient["simulateContract"]>[0]);
        return write(nonce);
      },
      shouldReplace: (hash) => resolverTransactionNeedsReplacement(this.publicClient, hash),
      replace: async (nonce, previousHash) => write(nonce, await resolverReplacementFees(this.publicClient, previousHash)),
      cancelStale: (nonce, previousHash, assertLease) => cancelResolverTransaction({
        client: this.publicClient, wallet: this.walletClient, account: this.account, chain: this.chain,
        nonce, previousHash, assertLease
      }),
      confirm: async (hash) => {
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
      }
    });
  }
}

export class BattleRefereeService {
  private readonly worker: BattleRefereeWorker | undefined;
  private readonly resolver: string | null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private pendingCount = 0;

  constructor(
    config: BackendConfig,
    options: { chain?: RefereeChain; store?: BattleReportStore; transactionCoordinator?: ResolverTransactionCoordinator; intervalMs?: number } = {}
  ) {
    this.intervalMs = options.intervalMs ?? 5_000;
    let chain = options.chain;
    let resolver: string | null = null;
    if (!chain && config.battleRefereePrivateKey && config.rpcUrl && config.gameContractAddress) {
      const definedChain = defineChain({
        id: config.chainId,
        name: `veydrift-${config.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } }
      });
      const account = privateKeyToAccount(config.battleRefereePrivateKey);
      const transport = http(config.rpcUrl, { timeout: 10_000 });
      resolver = account.address;
      chain = new ViemRefereeChain(
        createPublicClient({ chain: definedChain, transport }),
        createWalletClient({ account, chain: definedChain, transport }),
        account,
        definedChain,
        config.gameContractAddress,
        options.transactionCoordinator ?? new ResolverTransactionCoordinator(
          config.resolverTransactionStorePath ?? ".data/resolver-transactions.sqlite"
        )
      );
    }
    this.resolver = resolver;
    this.store = options.store ?? (chain && config.battleRefereeStorePath ? new BattleReportStore(config.battleRefereeStorePath) : undefined);
    this.worker = chain && this.store
      ? new BattleRefereeWorker(chain, this.store, {
        ...(config.battleRefereeFromBlock !== undefined ? { fromBlock: config.battleRefereeFromBlock } : {}),
        ...(config.logChunkSpan ? { logChunkSpan: config.logChunkSpan } : {})
      })
      : undefined;
  }

  private readonly intervalMs: number;
  private readonly store: BattleReportStore | undefined;

  start(): void {
    if (!this.worker || this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (!this.worker || this.inFlight) return;
    this.inFlight = true;
    try {
      await this.worker.tick();
      this.lastError = null;
    } catch (error) {
      this.lastError = safeDiagnosticText(error);
      console.error("Veydrift battle referee tick failed", this.lastError);
    } finally {
      this.pendingCount = this.store?.pending().length ?? 0;
      this.lastRunAt = new Date().toISOString();
      this.inFlight = false;
    }
  }

  snapshot(): BattleRefereeSnapshot {
    return {
      enabled: Boolean(this.worker),
      resolver: this.resolver,
      rulesHash: refereeRulesHash,
      catalogHash: refereeCatalogHash,
      pending: this.pendingCount,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      failures: Object.fromEntries(this.worker?.failures ?? [])
    };
  }
}
