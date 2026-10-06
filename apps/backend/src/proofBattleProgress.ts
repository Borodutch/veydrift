import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from "viem";

// Local read ABI only; shared public API/final acceptance ABI require coordinated release review.
const abi = parseAbi([
  "function proofBattleRecord(uint256 id,uint8 kind,uint256 index) view returns (bytes)",
  "function proofSettlementProgress(uint256 id) view returns (uint8 phase,uint256 nextIndex,uint256 memberCount,bytes32 expectedDigest)"
]);
const recordParameters = parseAbiParameters("(uint32 version,bytes32 rules,bytes32 catalog,address verifier,bytes32 verifierCodehash),uint8,bytes32,bytes32,uint256,uint256");
export type ProofBattleStatus = {
  state: "preparing" | "randomness-wait" | "proving" | "applying" | "economics" | "unavailable";
  stagedPhase: number;
  blockNumber?: string;
  blockHash?: string;
  nextIndex?: string;
  memberCount?: string;
};
export function parseProofBattleStatus(value: unknown): ProofBattleStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!["preparing", "randomness-wait", "proving", "applying", "economics", "unavailable"].includes(String(row.state))
    || !Number.isInteger(row.stagedPhase)) return undefined;
  return value as ProofBattleStatus;
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
}
