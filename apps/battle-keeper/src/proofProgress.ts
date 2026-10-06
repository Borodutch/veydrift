import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, type Hex } from "viem";
import type { JsonRpcTransport } from "./transport";

import { proofBattleReadSignatures, proofRandomnessReadSignatures, proofBattleRecordSchema,
  proofBattleRequestSchema } from "../../../packages/chain-abi/src/proofBattle";

export const proofReadAbi = parseAbi([...proofBattleReadSignatures, ...proofRandomnessReadSignatures]);
export const proofRecordParameters = parseAbiParameters(proofBattleRecordSchema);
export const proofRequestParameters = parseAbiParameters(proofBattleRequestSchema);
export type ProofProgress = {
  identity: string; version: number; phase: number; snapshot: Hex;
  engine: Hex; requestId: string; purpose: Hex; fulfilledAt: string;
  randomnessReady: boolean; verifierMatches: boolean;
  settlement: { phase: number; nextIndex: string; memberCount: string; expectedDigest: Hex };
};

/** Caller supplies the SAME EIP-1898 canonical tag as staged progress and runtime reads.
 * No selector fallback or mutable Game randomness engine lookup is permitted here. */
export async function readProofProgress(transport: JsonRpcTransport, address: Hex, id: bigint,
  tag: { blockHash: Hex; requireCanonical: true }): Promise<ProofProgress | undefined> {
  const record = async (kind: number) => decodeFunctionResult({ abi: proofReadAbi, functionName: "proofBattleRecord",
    data: await transport.request<Hex>("eth_call", [{ to: address, data: encodeFunctionData({ abi: proofReadAbi,
      functionName: "proofBattleRecord", args: [id, kind, 0n] }) }, tag]) });
  const encoded = await record(0);
  const [version, phase, snapshot] = decodeAbiParameters(proofRecordParameters, encoded);
  if (version.version === 0 || phase === 4) return undefined; // Legacy/bypassed arrivals remain ordinary work.
  if (phase < 1 || phase > 3) throw new Error("invalid frozen proof lifecycle");
  const requestRecord = await record(5);
  const [engine, requestId, purpose] = decodeAbiParameters(proofRequestParameters, requestRecord);
  if (BigInt(engine) === 0n || requestId === 0n) throw new Error("invalid frozen proof request");
  const [settlementData, verifierCode] = await Promise.all([
    transport.request<Hex>("eth_call", [{ to: address, data: encodeFunctionData({ abi: proofReadAbi,
      functionName: "proofSettlementProgress", args: [id] }) }, tag]),
    transport.request<Hex>("eth_getCode", [version.verifier, tag])
  ]);
  const [settlementPhase, nextIndex, memberCount, expectedDigest] = decodeFunctionResult({ abi: proofReadAbi,
    functionName: "proofSettlementProgress", data: settlementData });
  if (settlementPhase > 2 || nextIndex > memberCount) throw new Error("invalid proof settlement cursor");
  let fulfilledAt = 0n, randomnessReady = false;
  if (phase === 2) {
    const request = decodeFunctionResult({ abi: proofReadAbi, functionName: "request",
      data: await transport.request<Hex>("eth_call", [{ to: engine, data: encodeFunctionData({ abi: proofReadAbi,
        functionName: "request", args: [requestId] }) }, tag]) });
    if (request.requester.toLowerCase() !== address.toLowerCase() || request.purposeHash !== purpose)
      throw new Error("frozen proof request binding mismatch");
    fulfilledAt = request.fulfilledAt;
    const context = decodeFunctionResult({ abi: proofReadAbi, functionName: "battlePurposeContext",
      data: await transport.request<Hex>("eth_call", [{ to: engine, data: encodeFunctionData({ abi: proofReadAbi,
        functionName: "battlePurposeContext", args: [requestId] }) }, tag]) });
    randomnessReady = fulfilledAt > 0n && BigInt(context) !== 0n && BigInt(snapshot) !== 0n;
  }
  // Stable across readiness/settlement changes; never use an observed timestamp as a new request.
  // First five static words are Version (exclude mutable phase, seed and row count).
  const identity = keccak256((encoded.slice(0, 2 + 5 * 64) + requestRecord.slice(2)) as Hex);
  return { identity, version: version.version, phase, snapshot, engine, requestId: requestId.toString(), purpose,
    fulfilledAt: fulfilledAt.toString(), randomnessReady,
    verifierMatches: verifierCode !== "0x" && keccak256(verifierCode) === version.verifierCodehash,
    settlement: { phase: settlementPhase, nextIndex: nextIndex.toString(), memberCount: memberCount.toString(), expectedDigest } };
}

/** Production release is not qualified yet. Read recognition is NOT runtime authorization. */
export const reviewedProofProgressVersions: readonly string[] = [];
export type ProofAction = "resolve" | "randomness-wait" | "proving" | "applying" | "unavailable";
export function proofAction(phase: number, proof: ProofProgress | undefined, capable: boolean, leg: "arrival" | "return" = "arrival"): ProofAction {
  if (!proof) return phase === 16 || phase === 17 ? "unavailable" : "resolve";
  if (!capable || !proof.verifierMatches) return "unavailable";
  if (phase === 16 && proof.phase === 2 && proof.settlement.phase === 0)
    return proof.randomnessReady ? "resolve" : "randomness-wait";
  if (phase === 17 && proof.phase === 3) {
    if (proof.settlement.phase === 0) return "proving";
    if (proof.settlement.phase === 1) return "applying";
  }
  // Arrival completion retains the frozen proof job. A canonical RETURN leg at13 must
  // keep using ordinary chronology/fee/nonce guards, not get stuck awaiting another proof.
  if ((phase === 11 || phase === 12 || (phase === 13 && leg === "return")) && proof.phase === 3 && proof.settlement.phase === 2
    && proof.settlement.nextIndex === proof.settlement.memberCount) return "resolve";
  if (proof.phase === 1 && phase !== 16 && phase !== 17) return "resolve";
  return "unavailable";
}
