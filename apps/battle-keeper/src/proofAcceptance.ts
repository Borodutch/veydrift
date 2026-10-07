import { decodeAbiParameters, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, stringToHex, type Hex } from "viem";
import { proofBattleReadSignatures, proofBattleRecordSchema, proofBattleRequestSchema } from "../../../packages/chain-abi/src/proofBattle";
import type { JsonRpcTransport } from "./transport";
import type { AcceptedProofManifest } from "./proofLeaves";
import { reviewedProofProgressVersions } from "./proofProgress";

export const acceptanceReadAbi = parseAbi([...proofBattleReadSignatures,
  "function stagedBattleProgress(uint256 id) view returns (uint8,uint8,uint256)",
  "function fleetMissionEligibility(uint256 id) view returns (bool,uint256,bool)"]);
const versionSchema = parseAbiParameters("(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash)");
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export type AcceptedSummary = AcceptedProofManifest & { releaseId: Hex; version: number; rounds: number; outcome: number };
export type CanonicalAcceptance = {
  game: Hex; battleId: bigint; chainId: bigint; blockHash: Hex; blockNumber: bigint;
  stagedPhase: number; runtime: string; verifier: Hex; verifierCodehash: Hex;
  summary: AcceptedSummary; progress: { phase: number; nextIndex: bigint; memberCount: bigint; expectedDigest: Hex };
  // A valid observation/plan is NOT permission to send. No reviewed deployment exists.
  deliveryEnabled: false; gaps: readonly string[];
};
export type CanonicalProofJob = Omit<CanonicalAcceptance, "summary" | "progress"> & {
  binding: Hex; releaseId: Hex; memberCount: bigint; version: number;
  acceptance?: CanonicalAcceptance;
};
const isHash = (s: unknown): s is Hex => typeof s === "string" && /^0x[0-9a-f]{64}$/i.test(s);
const hasCode = (s: unknown): s is Hex => typeof s === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(s);

/** All state and code observations use the same canonical hash. Never read a server acceptance
 * claim or replay a receipt as authority. A removed anchor fails rather than falling back to latest. */
export async function readCanonicalProofJob(transport: JsonRpcTransport, game: Hex, battleId: bigint,
  expectedChainId: bigint): Promise<CanonicalProofJob | undefined> {
  const chainId = BigInt(await transport.request<Hex>("eth_chainId", []));
  if (chainId !== expectedChainId) throw new Error("proof chain identity mismatch");
  const block = await transport.request<{ number: Hex; hash: Hex } | null>("eth_getBlockByNumber", ["latest", false]);
  if (!block || !isHash(block.hash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number)) throw new Error("canonical proof anchor unavailable");
  const tag = { blockHash: block.hash, requireCanonical: true as const };
  const call = async (data: Hex) => transport.request<Hex>("eth_call", [{ to: game, data }, tag]);
  const record = async (kind: number) => decodeFunctionResult({ abi: acceptanceReadAbi, functionName: "proofBattleRecord",
    data: await call(encodeFunctionData({ abi: acceptanceReadAbi, functionName: "proofBattleRecord", args: [battleId, kind, 0n] })) });
  const [version, phase, snapshot, context, seed, rows] = decodeAbiParameters(parseAbiParameters(proofBattleRecordSchema), await record(0));
  if (!version.version || phase === 4) return undefined;
  const [engine, request, purpose] = decodeAbiParameters(parseAbiParameters(proofBattleRequestSchema), await record(5));
  if (phase !== 3 || BigInt(engine) === 0n || request === 0n) throw new Error("frozen proof job not awaiting result");
  const [summaryData, progressData, stagedData, implementation, verifierCode] = await Promise.all([
    call(encodeFunctionData({ abi: acceptanceReadAbi, functionName: "proofBattleAcceptedSummary", args: [battleId] })),
    call(encodeFunctionData({ abi: acceptanceReadAbi, functionName: "proofSettlementProgress", args: [battleId] })),
    call(encodeFunctionData({ abi: acceptanceReadAbi, functionName: "stagedBattleProgress", args: [battleId] })),
    transport.request<Hex>("eth_getStorageAt", [game, implementationSlot, tag]),
    transport.request<Hex>("eth_getCode", [version.verifier, tag]),
  ]);
  if (!hasCode(verifierCode) || keccak256(verifierCode) !== version.verifierCodehash) throw new Error("frozen verifier codehash mismatch");
  if (!/^0x0{24}[0-9a-f]{40}$/i.test(implementation)) throw new Error("invalid implementation identity");
  const codeAddress = BigInt(implementation) === 0n ? game : ("0x" + implementation.slice(-40)) as Hex;
  const runtimeCode = await transport.request<Hex>("eth_getCode", [codeAddress, tag]);
  if (!hasCode(runtimeCode)) throw new Error("proof runtime code unavailable");
  const runtime = codeAddress.toLowerCase() + ":" + keccak256(runtimeCode).toLowerCase();
  const [binding, releaseId, root, memberCount, rounds, finalTotals, outcome, acceptedVersion] = decodeFunctionResult({
    abi: acceptanceReadAbi, functionName: "proofBattleAcceptedSummary", data: summaryData });
  const [applicationPhase, nextIndex, applicationCount, expectedDigest] = decodeFunctionResult({
    abi: acceptanceReadAbi, functionName: "proofSettlementProgress", data: progressData });
  const [stagedPhase] = decodeFunctionResult({ abi: acceptanceReadAbi, functionName: "stagedBattleProgress", data: stagedData });
  const words = [BigInt(keccak256(stringToHex("veydrift.proof-battle.public-record.v1"))), chainId, BigInt(game), battleId,
    BigInt(version.version), BigInt(version.rules), BigInt(version.catalog), BigInt(version.verifier), BigInt(version.verifierCodehash),
    BigInt(engine), request, BigInt(purpose), BigInt(snapshot), BigInt(context), seed, rows, BigInt(phase)] as const;
  const expectedBinding = keccak256(encodeAbiParameters([{ type: "uint256[17]" }], [words]));
  const expectedRelease = keccak256(encodeAbiParameters(versionSchema, [version]));
  // Namespace declaration is source-stable, but a value cannot qualify unreviewed runtime/routing.
  const approvalSlot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256"),
    [expectedRelease, BigInt(keccak256(stringToHex("veydrift.storage.proof-settlement.v1"))) + 1n]));
  const approval = await transport.request<Hex>("eth_getStorageAt", [game, approvalSlot, tag]);
  if (!isHash(approval) || BigInt(approval) > 1n) throw new Error("invalid release approval storage");
  const gaps = ["proof-module-routing-provenance-unreviewed", "proof-production-delivery-disabled"];
  if (!reviewedProofProgressVersions.includes(runtime)) gaps.push("proof-runtime-unreviewed");
  if (BigInt(approval) !== 1n) gaps.push("release-registry-empty-or-unapproved");
  const job: CanonicalProofJob = { game, battleId, chainId, blockHash: block.hash, blockNumber: BigInt(block.number),
    stagedPhase, runtime, verifier: version.verifier, verifierCodehash: version.verifierCodehash,
    binding: expectedBinding, releaseId: expectedRelease, memberCount: rows, version: version.version,
    deliveryEnabled: false, gaps };
  if (applicationPhase === 0) {
    if ([binding, releaseId, root].some(v => BigInt(v) !== 0n) || memberCount || rounds || finalTotals.some(Boolean) || outcome || acceptedVersion || nextIndex || applicationCount || BigInt(expectedDigest))
      throw new Error("inconsistent unaccepted summary");
    // Preparation calls Proof.awaitProof: AwaitingRandomness(2)/stage16 advances atomically to
    // AwaitingProof(3)/stage17; submitBattleProof requires that same ready pair.
    if (stagedPhase !== 17) throw new Error("unaccepted proof job is not in proof wait");
    Object.freeze(job.gaps);
    return Object.freeze(job);
  }
  const expectedOutcome = finalTotals[0] > 0n && finalTotals[1] === 0n ? 1 : finalTotals[1] > 0n && finalTotals[0] === 0n ? 2 : 0;
  if (binding !== expectedBinding || releaseId !== expectedRelease || acceptedVersion !== version.version
    || memberCount !== rows || memberCount !== applicationCount || rounds > 6 || outcome !== expectedOutcome)
    throw new Error("accepted binding/release/count/scalars mismatch");
  if (nextIndex > memberCount || ![1, 2].includes(applicationPhase)
    || (applicationPhase === 1 && stagedPhase !== 17)
    || (applicationPhase === 2 && (![11,12,13].includes(stagedPhase) || nextIndex !== memberCount)))
    throw new Error("inconsistent accepted lifecycle/cursor");
  const acceptance: CanonicalAcceptance = { game, battleId, chainId, blockHash: block.hash, blockNumber: BigInt(block.number), stagedPhase, runtime,
    verifier: version.verifier, verifierCodehash: version.verifierCodehash,
    summary: { binding, releaseId, root, memberCount, rounds, finalTotals, outcome, version: acceptedVersion },
    progress: { phase: applicationPhase, nextIndex, memberCount: applicationCount, expectedDigest }, deliveryEnabled: false, gaps };
  Object.freeze(acceptance.summary.finalTotals); Object.freeze(acceptance.summary);
  Object.freeze(acceptance.progress); Object.freeze(acceptance.gaps); Object.freeze(acceptance);
  return Object.freeze({ ...job, acceptance });
}

/** Backwards-compatible accepted-only observation. */
export async function readCanonicalAcceptance(transport: JsonRpcTransport, game: Hex, battleId: bigint,
  chainId: bigint): Promise<CanonicalAcceptance | undefined> {
  return (await readCanonicalProofJob(transport, game, battleId, chainId))?.acceptance;
}
