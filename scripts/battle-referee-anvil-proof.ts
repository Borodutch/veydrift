/** LOCAL synthetic ticket #44 referee proof. First export with:
 * cd packages/contracts && VEY44_EXPORT_FIXTURE=true forge test --match-test testExportRefereeFixture
 * Then (repo root): NO_PROXY=127.0.0.1,localhost bun scripts/battle-referee-anvil-proof.ts
 * Drives the real backend referee (viem client, coordinator, report store) against the exported
 * proxy on Anvil: advance -> submit -> apply leaves -> ordinary economics -> casualties match report.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BattleRefereeWorker, BattleReportStore, ViemRefereeChain } from "../apps/backend/src/battleReferee";
import { ResolverTransactionCoordinator } from "../apps/backend/src/resolverTransactions";
import { decodeStagedBattleEvidence, stagedReportTopicList } from "../apps/backend/src/stagedBattleReport";
import { decodeBattleReportLogs, type RpcLog } from "../apps/backend/src/evm";

const root = new URL("../packages/contracts/", import.meta.url);
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const alloc = load("manifests/ticket44-referee-alloc.json");
const meta = load("manifests/ticket44-referee-meta.json");
const game = meta.game as Hex;
const battleId = BigInt(meta.battleId);
// Anvil development key #0 (public, local only); the exporter configured it as the referee.
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
assert.equal(account.address.toLowerCase(), String(meta.resolver).toLowerCase());

const directory = mkdtempSync(join(tmpdir(), "ticket44-referee-"));
const genesis = join(directory, "genesis.json");
writeFileSync(genesis, JSON.stringify({ config: { chainId: 8453 }, timestamp: toHex(Math.floor(Date.now() / 1000)), alloc }));
const url = "http://127.0.0.1:18519";
const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18519", "--init", genesis,
  "--chain-id", "8453", "--gas-limit", "16777216", "--base-fee", "100", "--silent"], { stdout: "ignore", stderr: "inherit" });
const chain = defineChain({ id: 8453, name: "anvil-8453", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
const transport = http(url, { retryCount: 0, timeout: 30_000 });
// No block-number cache: viem reuses a block number for 4s by default, so a tick right after the
// sealing transaction could scan logs only up to an earlier block and miss RefereeBattleSealed.
const publicClient = createPublicClient({ chain, transport, cacheTime: 0 });
const walletClient = createWalletClient({ account, chain, transport });
const randomnessAbi = parseAbi(["function fulfillRandomness(uint256 requestId, uint256 randomWord)"]);
const gameAbi = parseAbi([
  "function stagedBattleProgress(uint256) view returns (uint8 phase, uint8 round, uint256 workDone)",
  "function resolveFleetMission(uint256)",
  "function shipCount(uint256 planetId, uint8 ship) view returns (uint32)",
  "function debrisField(uint256 planetId) view returns (uint128 metal, uint128 crystal)",
  "function battleResultSummary(uint256 id) view returns (bytes32 binding, bytes32 reportHash, bytes32 root, uint256 members, uint8 rounds, uint256[2] totals, uint8 outcome, uint32 version)"
]);
const stringify = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x);
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await publicClient.getChainId()) === 8453; } catch { await Bun.sleep(100); }
  }
  assert(ready, "owned Anvil did not start");
  await publicClient.request({ method: "anvil_setBalance" as never, params: [account.address, toHex(10n ** 20n)] as never });
  const phase = async () => (await publicClient.readContract({ address: game, abi: gameAbi, functionName: "stagedBattleProgress", args: [battleId] }))[0];
  const resolve = async () => {
    const hash = await walletClient.writeContract({ address: game, abi: gameAbi, functionName: "resolveFleetMission", args: [battleId], gas: 15_000_000n });
    assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, "success");
  };
  // Ordinary keeper work: protection, production cutoff, roster journal and snapshot seal.
  for (let i = 0; i < 200 && await phase() !== 16; i++) await resolve();
  assert.equal(await phase(), 16, "roster sealed before reveal");

  const store = new BattleReportStore(join(directory, "referee.sqlite"));
  const coordinator = new ResolverTransactionCoordinator(join(directory, "tx.sqlite"));
  const refereeChain = new ViemRefereeChain(publicClient, walletClient, account, chain, game, coordinator);
  const referee = new BattleRefereeWorker(refereeChain, store, { fromBlock: 0n });
  await referee.tick();
  assert.deepEqual(store.pending(), [battleId], "sealed battle discovered from RefereeBattleSealed");
  assert.equal(await phase(), 16, "referee waits for the reveal");

  // The randomness fulfiller reveals only after the seal (impersonated fixture fulfiller).
  const { requestId, engine } = await refereeChain.status(battleId);
  await publicClient.request({ method: "anvil_impersonateAccount" as never, params: [meta.fulfiller] as never });
  await publicClient.request({ method: "anvil_setBalance" as never, params: [meta.fulfiller, toHex(10n ** 20n)] as never });
  const reveal = await walletClient.writeContract({ account: meta.fulfiller as Hex, address: engine, abi: randomnessAbi,
    functionName: "fulfillRandomness", args: [requestId, BigInt(meta.seed)], chain });
  assert.equal((await publicClient.waitForTransactionReceipt({ hash: reveal })).status, "success");

  const steps: number[] = [];
  for (let i = 0; i < 20 && store.pending().length; i++) {
    await referee.tick();
    assert.equal(referee.failures.size, 0, stringify(Object.fromEntries(referee.failures)));
    steps.push(await phase());
  }
  assert.equal(store.pending().length, 0, "referee did not finish its battle");
  const saved = store.reportForBattle(battleId.toString());
  assert(saved, "report stored");
  const summary = await publicClient.readContract({ address: game, abi: gameAbi, functionName: "battleResultSummary", args: [battleId] });
  assert.equal(summary[1].toLowerCase(), saved.reportHash, "onchain report hash");
  const report = JSON.parse(saved.report);

  const debrisBefore = await publicClient.readContract({ address: game, abi: gameAbi, functionName: "debrisField", args: [BigInt(meta.target)] });
  // Remaining loot/debris/repair/return phases use the ordinary permissionless path.
  for (let i = 0; i < 40 && await phase() !== 13; i++) await resolve();
  assert.equal(await phase(), 13, "economics reach terminal phase");
  // OGame debris: 30% of the destroyed ships' metal and crystal (both sides); defenses leave none.
  const costs = load("combat-preview-catalog.json").ships as { id: number; metal: number; crystal: number }[];
  let lostMetal = 0n, lostCrystal = 0n;
  for (const row of report.rows as { unit: number; lost: number }[]) {
    if (row.unit >= 16) continue;
    lostMetal += BigInt(costs[row.unit]!.metal) * BigInt(row.lost); lostCrystal += BigInt(costs[row.unit]!.crystal) * BigInt(row.lost);
  }
  const debrisAfter = await publicClient.readContract({ address: game, abi: gameAbi, functionName: "debrisField", args: [BigInt(meta.target)] });
  assert.equal(debrisAfter[0] - debrisBefore[0], lostMetal * 3_000n / 10_000n, "debris metal = 30% of destroyed ship metal");
  assert.equal(debrisAfter[1] - debrisBefore[1], lostCrystal * 3_000n / 10_000n, "debris crystal = 30% of destroyed ship crystal");
  // Resident ship lanes are debited by exactly the reported losses (defenses may be repaired).
  for (const row of report.rows.filter((r: { source: string; unit: number }) => r.source === "0" && r.unit < 16)) {
    const count = await publicClient.readContract({ address: game, abi: gameAbi, functionName: "shipCount", args: [BigInt(meta.target), row.unit] });
    assert.equal(count, row.survivors, `resident ship ${row.unit}`);
  }
  // Every battle-report event ran on Anvil: the ordinary decoder sees complete referee evidence.
  const logs = await publicClient.request({ method: "eth_getLogs", params: [{ address: game, fromBlock: "0x0", toBlock: "latest", topics: [[...stagedReportTopicList]] }] }) as RpcLog[];
  const evidence = decodeStagedBattleEvidence(logs, battleId.toString());
  assert(evidence?.complete, "complete battle evidence");
  for (const row of report.rows as { source: string; side: number; unit: number; count: number; lost: number }[]) {
    const unit = evidence.members.find(m => m.missionId === row.source && m.side === row.side)?.units.find(u => u.unit === row.unit);
    assert.equal(unit?.starting, row.count, `evidence start ${row.source}:${row.unit}`);
    assert.equal(unit?.destroyed, row.lost, `evidence losses ${row.source}:${row.unit}`);
  }
  // The ordinary battle report shows the referee's outcome and rounds.
  const allLogs = await publicClient.request({ method: "eth_getLogs", params: [{ address: game, fromBlock: "0x0", toBlock: "latest" }] }) as RpcLog[];
  const battleReport = decodeBattleReportLogs(allLogs, battleId.toString());
  assert(battleReport, "complete ordinary battle report");
  assert.equal(battleReport.roundReports.length, report.rounds.length, "per-round reports");
  assert.equal(battleReport.rounds, report.rounds.length, "report rounds");
  assert.equal(battleReport.outcome, { attacker: "AttackerWin", defender: "DefenderWin", draw: "Draw" }[report.outcome as string], "report outcome");
  assert.equal(BigInt(battleReport.randomSeed ?? "0"), BigInt(report.seed), "report seed");
  console.log(stringify({
    battleId, outcome: report.outcome, rounds: report.rounds.length, rows: report.rows.length, debris: [lostMetal * 3_000n / 10_000n, lostCrystal * 3_000n / 10_000n],
    phasesAfterTicks: steps, reportHash: saved.reportHash, totals: summary[5], refereeAnvilProof: "PASS"
  }));
} finally {
  node.kill();
  await node.exited;
  rmSync(directory, { recursive: true, force: true });
}
