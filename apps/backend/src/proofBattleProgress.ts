import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from "viem";

import { proofBattleReadSignatures, proofBattleRecordSchema } from "../../../packages/chain-abi/src/proofBattle";
import type { ProofBattleProgress } from "../../../packages/api-types/src/index";

const abi = parseAbi(proofBattleReadSignatures);
const recordParameters = parseAbiParameters(proofBattleRecordSchema);
export type ProofBattleStatus = ProofBattleProgress;
export function parseProofBattleStatus(value: unknown): ProofBattleStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.state !== "string" || !["preparing", "randomness-wait", "proving", "applying", "economics", "unavailable"].includes(row.state)
    || !Number.isInteger(row.stagedPhase) || Number(row.stagedPhase) < 0 || Number(row.stagedPhase) > 255) return undefined;
  const decimal = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
  if ((row.blockNumber !== undefined && !decimal(row.blockNumber))
    || (row.blockHash !== undefined && (typeof row.blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(row.blockHash)))
    || (row.nextIndex !== undefined && !decimal(row.nextIndex))
    || (row.memberCount !== undefined && !decimal(row.memberCount))) return undefined;
  if ((row.blockNumber === undefined) !== (row.blockHash === undefined)
    || (row.nextIndex === undefined) !== (row.memberCount === undefined)) return undefined;
  if (row.nextIndex !== undefined && (BigInt(row.nextIndex as string) > BigInt(row.memberCount as string)
    || (row.state !== "applying" && row.state !== "economics"))) return undefined;
  // Return only the public wire fields, never arbitrary persisted prover advice or pseudo-percentages.
  return { state: row.state as ProofBattleStatus["state"], stagedPhase: row.stagedPhase as number,
    ...(row.blockNumber === undefined ? {} : { blockNumber: row.blockNumber as string, blockHash: row.blockHash as string }),
    ...(row.nextIndex === undefined ? {} : { nextIndex: row.nextIndex as string, memberCount: row.memberCount as string }) };
}
export async function readProofBattleStatus(
  transport: { request<T>(method: string, params: unknown[]): Promise<T> }, game: Hex, id: bigint
): Promise<ProofBattleStatus | undefined> {
  const block = await transport.request<{ number: Hex; hash: Hex }>("eth_getBlockByNumber", ["latest", false]);
  if (!/^0x[0-9a-f]{64}$/i.test(block.hash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(block.number))
    throw new Error("canonical proof status block unavailable");
  const tag = { blockHash: block.hash, requireCanonical: true };
  const stagedAbi = parseAbi(["function stagedBattleProgress(uint256 id) view returns (uint8,uint8,uint256)"]);
  const [stagedPhase] = decodeFunctionResult({ abi: stagedAbi, functionName: "stagedBattleProgress",
    data: await transport.request<Hex>("eth_call", [{ to: game, data: encodeFunctionData({ abi: stagedAbi,
      functionName: "stagedBattleProgress", args: [id] }) }, tag]) });
  const record = decodeFunctionResult({ abi, functionName: "proofBattleRecord",
    data: await transport.request<Hex>("eth_call", [{ to: game, data: encodeFunctionData({ abi,
      functionName: "proofBattleRecord", args: [id, 0, 0n] }) }, tag]) });
  const [version, phase] = decodeAbiParameters(recordParameters, record);
  if (version.version === 0 || phase === 4 || stagedPhase === 13) return undefined;
  // A positively identified proof job must never fall back to legacy round estimates if
  // its application getter is unavailable (preparation/economics share legacy stage numbers).
  try {
    const [application, nextIndex, memberCount] = decodeFunctionResult({ abi, functionName: "proofSettlementProgress",
      data: await transport.request<Hex>("eth_call", [{ to: game, data: encodeFunctionData({ abi,
        functionName: "proofSettlementProgress", args: [id] }) }, tag]) });
    let state: ProofBattleStatus["state"] = "unavailable";
    if (phase === 1 && application === 0) state = "preparing";
    if (phase === 2 && stagedPhase === 16 && application === 0) state = "randomness-wait";
    if (phase === 3 && stagedPhase === 17 && application === 0) state = "proving";
    if (phase === 3 && stagedPhase === 17 && application === 1 && nextIndex <= memberCount) state = "applying";
    if (phase === 3 && (stagedPhase === 11 || stagedPhase === 12) && application === 2
      && nextIndex === memberCount) state = "economics";
    return { state, stagedPhase, blockHash: block.hash, blockNumber: BigInt(block.number).toString(),
      ...(state === "applying" || state === "economics" ? { nextIndex: nextIndex.toString(), memberCount: memberCount.toString() } : {}) };
  } catch {
    return { state: "unavailable", stagedPhase };
  }
}
