import { decodeFunctionResult, encodeFunctionData, encodeAbiParameters, keccak256, parseAbi, stringToHex, toHex, type Hex } from "viem";
import { proofAction, readProofProgress, reviewedProofProgressVersions, type ProofProgress } from "./proofProgress";
import type { JsonRpcTransport } from "./transport";

export const progressAbi = parseAbi([
  "function stagedBattleProgress(uint256 missionId) view returns (uint8 phase, uint8 round, uint256 workDone)",
  "function battleResolutionProgress(uint256 missionId) view returns (uint8 roundsCompleted, uint8 totalRounds)"
]);
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type MissionProgress = {
  blockNumber: string;
  blockHash: string;
  version: string;
  phase: number;
  round: number;
  workDone: string;
  proof?: ProofProgress;
  proofCapability?: boolean;
  queueProgress?: string;
  chronologyWorkDone?: string; // Per-mission monotonic scans, including nested returns.
  arrivalOrderCursor?: string; // Legacy zero-namespace deployments only.
  arrivalCapability?: boolean; // Exact implementation-address/runtime-hash deployment allowlist.
  arrivalGeneration?: string;
  arrivalWorkDone?: string;
};
export type ProgressGuard = { missionId: string; leg: "arrival" | "return"; before: MissionProgress; history?: MissionProgress[] };

/** Keep every implementation's high-water mark. Switching back to an observed implementation
 * never grants a fresh paid attempt at its old checkpoint. New versions get one probe only. */
export function guardAllows(guard: ProgressGuard | undefined, current: MissionProgress): boolean {
  // Storage/getter success is not code provenance. Only a deployment-reviewed runtime can
  // bootstrap zero counters; its paid checkpoint then enforces ordinary monotonic progress.
  if (current.arrivalCapability === false || (current.arrivalOrderCursor !== undefined && current.arrivalGeneration === undefined)) return false;
  if (proofAction(current.phase, current.proof, current.proofCapability === true) !== "resolve") return false;
  if (!guard) return true;
  if (BigInt(current.blockNumber) < BigInt(guard.before.blockNumber)) return false;
  const previous = [guard.before, ...(guard.history ?? [])].filter(p => p.version === current.version);
  return previous.length === 0 || previous.every(p => progressAdvanced(p, current));
}

export function consumeProgress(guard: ProgressGuard | undefined, before: MissionProgress,
  missionId: string, leg: "arrival" | "return"): ProgressGuard {
  // Retain observations, rather than replacing a watermark with a fork's lower dimension.
  const history = guard ? [guard.before, ...(guard.history ?? [])] : [];
  return { missionId, leg, before, history: history.filter(p =>
    p.version !== before.version || (progressKey(p) !== progressKey(before) && !progressAdvanced(p, before))) };
}

function progressKey(progress: MissionProgress): string {
  // Exclude observation block/hash: time passing is not permission to buy another attempt.
  const legacyKey = [progress.version, progress.workDone, progress.round, progress.queueProgress ?? "", progress.arrivalOrderCursor ?? "", progress.arrivalGeneration ?? "", progress.arrivalWorkDone ?? ""].join(":");
  // Preserve operation identities of already-persisted pre-chronology raw envelopes.
  const key = progress.chronologyWorkDone === undefined ? legacyKey : legacyKey + ":chronology:" + progress.chronologyWorkDone;
  return progress.proof ? key + ":proof:" + progress.proof.identity + ":" + progress.proof.randomnessReady + ":" + progress.proof.settlement.nextIndex : key;
}

/** workDone is cumulative across preparation, cohort math and settlement. Phases are NOT ordered:
 * protection phases 14/15 precede phase 1, and round math repeats phases 6–10. */
function queueAdvanced(before: string, after: string): boolean {
  const a = before.split(":").map(BigInt), b = after.split(":").map(BigInt);
  if (a.length !== 3 || b.length !== 3) return false;
  const stageA = a[0]! >> 128n, stageB = b[0]! >> 128n;
  if (stageB !== stageA) return stageB > stageA;
  // Packed consumed/copied counters only increase within a stage. Pop stages only shorten arrays.
  for (let offset = 0n; offset < 128n; offset += 32n) {
    const oldCursor = (a[0]! >> offset) & 0xffffffffn;
    const newCursor = (b[0]! >> offset) & 0xffffffffn;
    if (newCursor < oldCursor) return false;
  }
  return b[0]! > a[0]! || (stageA === 2n && b[2]! < a[2]!)
    || (stageA === 5n && b[1]! < a[1]!);
}

export function progressAdvanced(before: MissionProgress, after: MissionProgress): boolean {
  if (BigInt(after.blockNumber) < BigInt(before.blockNumber)) return false;
  if (after.version !== before.version) return true; // guardAllows checks previously seen versions.
  if (BigInt(after.workDone) < BigInt(before.workDone) || after.round < before.round) return false;
  let advanced = BigInt(after.workDone) > BigInt(before.workDone) || after.round > before.round;
  if (before.proof) {
    if (!after.proof || before.proof.identity !== after.proof.identity) return false;
    const a = before.proof, b = after.proof;
    // A reveal is an independent, request-bound one-time checkpoint. Stage numbers are not ordered.
    if (a.phase === 2 && b.phase === 2 && a.randomnessReady && !b.randomnessReady) return false;
    if (BigInt(b.settlement.nextIndex) < BigInt(a.settlement.nextIndex)
      || b.settlement.phase < a.settlement.phase) return false;
    advanced ||= (!a.randomnessReady && b.randomnessReady)
      || BigInt(b.settlement.nextIndex) > BigInt(a.settlement.nextIndex);
  }
  if (before.arrivalGeneration !== undefined) {
    if (after.arrivalGeneration === undefined || after.arrivalWorkDone === undefined
      || BigInt(after.arrivalGeneration) < BigInt(before.arrivalGeneration)
      || BigInt(after.arrivalWorkDone) < BigInt(before.arrivalWorkDone!)) return false;
    advanced ||= BigInt(after.arrivalGeneration) > BigInt(before.arrivalGeneration)
      || BigInt(after.arrivalWorkDone) > BigInt(before.arrivalWorkDone!);
  } else if (after.arrivalGeneration !== undefined) {
    // First nonzero namespace observation proves activation. Never compare the resettable raw
    // cursor across this boundary; later namespace disappearance is a regression, not fallback.
    advanced = true;
  } else if (before.arrivalOrderCursor !== undefined) {
    if (after.arrivalOrderCursor === undefined || BigInt(after.arrivalOrderCursor) < BigInt(before.arrivalOrderCursor)) return false;
    advanced ||= BigInt(after.arrivalOrderCursor) > BigInt(before.arrivalOrderCursor);
  }
  if (before.chronologyWorkDone !== undefined) {
    if (after.chronologyWorkDone === undefined || BigInt(after.chronologyWorkDone) < BigInt(before.chronologyWorkDone)) return false;
    advanced ||= BigInt(after.chronologyWorkDone) > BigInt(before.chronologyWorkDone);
  } else if (after.chronologyWorkDone !== undefined && BigInt(after.chronologyWorkDone) > 0n) {
    advanced = true;
  }
  if (before.queueProgress !== undefined) {
    if (after.queueProgress === undefined) return false;
    if (before.queueProgress !== after.queueProgress) {
      if (!queueAdvanced(before.queueProgress, after.queueProgress)) return false;
      advanced = true;
    }
  }
  return advanced;
}

/** Deployment-reviewed implementation address : keccak256(deployed runtime), never a selector probe. */
export function parseArrivalProgressVersions(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const versions = raw.split(",").map(value => value.trim().toLowerCase());
  if (versions.some(value => !/^0x[0-9a-f]{40}:0x[0-9a-f]{64}$/.test(value))) {
    throw new Error("arrival progress versions must be implementation-address:runtime-code-hash pairs");
  }
  return [...new Set(versions)];
}

/** Pin every read to one canonical block hash (EIP-1898), never combine RPC failover heads. */
export async function readMissionProgress(
  transport: JsonRpcTransport, address: Hex, missionId: string, targetPlanetId?: string, missile = false, arrivalProgressVersions: readonly string[] = []
): Promise<MissionProgress> {
  const block = await transport.request<{ number: Hex; hash: Hex } | null>("eth_getBlockByNumber", ["latest", false]);
  if (typeof block?.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(block.hash)
    || typeof block.number !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number)) {
    throw new Error("canonical progress block unavailable or malformed; signing disabled");
  }
  const tag = { blockHash: block.hash, requireCanonical: true as const };
  const implementation = await transport.request<Hex>("eth_getStorageAt", [address, implementationSlot, tag]);
  if (!/^0x0{24}[0-9a-f]{40}$/i.test(implementation)) throw new Error("invalid implementation version");
  const codeAddress = BigInt(implementation) === 0n ? address : `0x${implementation.slice(-40)}` as Hex;
  const code = await transport.request<Hex>("eth_getCode", [codeAddress, tag]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw new Error("implementation code unavailable or malformed; signing disabled");
  const codeHash = keccak256(code);
  const capable = arrivalProgressVersions.includes(`${codeAddress.toLowerCase()}:${codeHash.toLowerCase()}`);
  const chronologySlot = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }],
    [BigInt(missionId), BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1"))) + 1n]));
  const chronology = await transport.request<Hex>("eth_getStorageAt", [address, chronologySlot, tag]);
  if (!/^0x[0-9a-f]{64}$/i.test(chronology)) throw new Error("invalid chronology progress namespace");
  const call = (functionName: "stagedBattleProgress" | "battleResolutionProgress") =>
    transport.request<Hex>("eth_call", [{ to: address, data: encodeFunctionData({
      abi: progressAbi, functionName, args: [BigInt(missionId)]
    }) }, tag]);
  let phase = 0, round = 0, workDone = "0";
  try {
    const encoded = await call("stagedBattleProgress");
    const values = decodeFunctionResult({ abi: progressAbi, functionName: "stagedBattleProgress", data: encoded });
    [phase, round] = values;
    workDone = values[2].toString();
  } catch (error) {
    // Only an explicit empty-data EVM revert proves an old implementation lacks this selector.
    // Timeouts, malformed ABI data and arbitrary contract reverts must never downgrade the guard.
    if (!(error && typeof error === "object" && "data" in error && error.data === "0x"
      && "message" in error && /revert/i.test(String(error.message)))) throw error;
    const values = decodeFunctionResult({ abi: progressAbi, functionName: "battleResolutionProgress",
      data: await call("battleResolutionProgress") });
    round = values[0];
  }
  const proofCapability = reviewedProofProgressVersions.includes(
    `${codeAddress.toLowerCase()}:${codeHash.toLowerCase()}`);
  // Unknown runtimes still recognize the exclusive wait stages, but can never authorize a write.
  // Reviewed future runtimes read all records, including preparation/economics and legacy bypass.
  const proof = phase === 16 || phase === 17 || proofCapability
    ? await readProofProgress(transport, address, BigInt(missionId), tag) : undefined;
  // Missile preparation predates the public staged getter. Its append-only layout is pinned in
  // contracts/scripts/check-storage-layout.mjs: slot 73 packed cursors plus backlog lengths 44/45.
  // Compaction pop chunks emit no events and change only array length, so all three are required.
  let queueProgress: string | undefined;
  let arrivalOrderCursor: string | undefined;
  let arrivalGeneration: string | undefined, arrivalWorkDone: string | undefined;
  if (targetPlanetId !== undefined) {
    const slot = (key: string, base: bigint) => keccak256(encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }], [BigInt(key), base]));
    const base = BigInt(slot(targetPlanetId, BigInt(keccak256(stringToHex("veydrift.storage.arrival-progress.v1")))));
    const serial = await Promise.all([base, base + 1n].map(key =>
      transport.request<Hex>("eth_getStorageAt", [address, toHex(key, { size: 32 }), tag])));
    if (serial.some(value => !/^0x[0-9a-f]{64}$/i.test(value))) throw new Error("invalid arrival progress namespace");
    if (capable || serial.some(value => BigInt(value) !== 0n)) {
      arrivalGeneration = BigInt(serial[0]!).toString();
      arrivalWorkDone = BigInt(serial[1]!).toString();
    } else {
      // Unknown zero-state runtime: legacy cursor is diagnostic only, capability remains false.
      // Verified runtimes use cumulative zero counters above, never a resettable-cursor bypass.
      const order = await transport.request<Hex>("eth_getStorageAt", [address, slot(targetPlanetId, 74n), tag]);
      if (!/^0x[0-9a-f]{64}$/i.test(order)) throw new Error("invalid arrival ordering state");
      arrivalOrderCursor = (BigInt(order) & ((1n << 64n) - 1n)).toString();
    }
    if (missile) {
      const values = await Promise.all([
        slot(missionId, 73n), slot(targetPlanetId, 44n), slot(targetPlanetId, 45n)
      ].map(key => transport.request<Hex>("eth_getStorageAt", [address, key, tag])));
      if (values.some(value => !/^0x[0-9a-f]{64}$/i.test(value))) throw new Error("invalid missile preparation state");
      queueProgress = values.join(":");
    }
  }
  return {
    ...(proof ? { proof, proofCapability } : {}),
    arrivalCapability: capable,
    chronologyWorkDone: BigInt(chronology).toString(),
    ...(arrivalOrderCursor === undefined ? {} : { arrivalOrderCursor }),
    ...(arrivalGeneration === undefined ? {} : { arrivalGeneration, arrivalWorkDone: arrivalWorkDone! }),
    ...(queueProgress === undefined ? {} : { queueProgress }),
    blockNumber: BigInt(block.number).toString(), blockHash: block.hash,
    version: implementation + ":" + codeHash, phase, round, workDone
  };
}
