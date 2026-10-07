import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, stringToHex, toHex, type Hex, type PublicClient } from "viem";
import { proofSettlementWriteSignatures } from "../../../packages/chain-abi/src/proofSettlement";
import type { PreparedReceipt, PreparedReconciliationPass } from "./resolverTransactions";

export type ProofExecutionPlan = Readonly<{
  operationId: string; membership: string; to: Hex; data: Hex; blockHash: Hex; blockNumber: bigint;
  deliveryEnabled: false; gaps: readonly string[];
}>;
/** Trusted keeper boundary: reacquire immutable artifact and hash-pinned canonical job/cursor each call. */
export type ProofPlanProvider = () => Promise<ProofExecutionPlan | undefined>;
export type ProofMembership = Readonly<{
  kind: "proof-v1"; chainId: string; game: Hex; battleId: string; binding: Hex; release: Hex;
  root: Hex; cursor: string; cursorDigest: Hex; action: "submit" | "apply"; dataHash: Hex;
}>;
const abi = parseAbi(proofSettlementWriteSignatures);
const keys = "kind,chainId,game,battleId,binding,release,root,cursor,cursorDigest,action,dataHash";
const bytes32 = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
const decimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
  && value.length <= 78 && BigInt(value) < 1n << 256n;

/** Deliberately empty and immutable; no environment flag or injected production approval. */
const reviewedProofRuntimes: readonly string[] = Object.freeze([]);
export function proofExecutionCapability(): Readonly<{ deliveryEnabled: false; gaps: readonly string[] }> {
  void reviewedProofRuntimes;
  return Object.freeze({ deliveryEnabled: false, gaps: Object.freeze(["reviewed-proof-runtime-allowlist-empty", "proof-release-registry-disabled"]) });
}

export function parseProofMembership(serialized: string, chainId: number, game: Hex): ProofMembership {
  if (serialized.length > 2048) throw new Error("invalid proof membership");
  const m = JSON.parse(serialized) as ProofMembership;
  if (!m || Array.isArray(m) || Object.keys(m).join(",") !== keys || JSON.stringify(m) !== serialized
    || m.kind !== "proof-v1" || m.chainId !== String(chainId) || m.game !== game.toLowerCase()
    || !/^0x[0-9a-f]{40}$/.test(m.game) || !decimal(m.battleId) || !decimal(m.cursor)
    || ![m.binding, m.release, m.root, m.cursorDigest, m.dataHash].every(bytes32)
    || !["submit", "apply"].includes(m.action)) throw new Error("invalid proof membership identity");
  return Object.freeze(m);
}

export function proofOperationIdentity(fields: Omit<ProofMembership, "kind" | "dataHash">, data: Hex) {
  const membership = JSON.stringify({ kind: "proof-v1", chainId: fields.chainId, game: fields.game,
    battleId: fields.battleId, binding: fields.binding, release: fields.release, root: fields.root,
    cursor: fields.cursor, cursorDigest: fields.cursorDigest, action: fields.action, dataHash: keccak256(data) });
  return Object.freeze({ membership, operationId: "proof-v1:" + keccak256(stringToHex(membership)) });
}

export function validateProofPlan(plan: ProofExecutionPlan, chainId: number, game: Hex): ProofExecutionPlan {
  const m = parseProofMembership(plan.membership, chainId, game);
  if (plan.to !== m.game || !bytes32(plan.blockHash) || typeof plan.blockNumber !== "bigint" || plan.blockNumber < 0n
    || plan.deliveryEnabled !== false || !Array.isArray(plan.gaps) || !plan.gaps.every(gap => typeof gap === "string")
    || !/^0x(?:[0-9a-f]{2})+$/.test(plan.data) || plan.data.length > 32_000
    || keccak256(plan.data) !== m.dataHash || plan.operationId !== "proof-v1:" + keccak256(stringToHex(plan.membership)))
    throw new Error("invalid proof plan identity");
  const call = decodeFunctionData({ abi, data: plan.data });
  if (call.args[0] !== BigInt(m.battleId) || encodeFunctionData({ abi, ...call }) !== plan.data)
    throw new Error("noncanonical proof call or battle mismatch");
  if (call.functionName === "submitBattleProof") {
    if (m.action !== "submit" || m.cursor !== "0" || !/^0x[0-9a-f]{768}$/.test(call.args[1]))
      throw new Error("invalid proof submission");
    const inputs = call.args[2];
    if (inputs.some(n => n < 0n || n >= 1n << 64n)) throw new Error("invalid proof public limb");
    const word = (start: number) => toHex(inputs.slice(start, start + 4).reduce((n, v, i) => n | v << BigInt(64 * i), 0n), { size: 32 });
    if (word(0) !== m.binding || word(4) !== m.root) throw new Error("proof public identity mismatch");
  } else if (m.action !== "apply" || call.args[1].length > 32) throw new Error("invalid proof application");
  return Object.freeze({ ...plan, gaps: Object.freeze([...plan.gaps]) });
}

/** Inclusion evidence only: neither accepted proof nor paid checkpoint means battle completion.
 * No artifact, fee oracle, signer or broadcast is consulted during receipt-only recovery. */
export async function reconcileProofReceipt(client: PublicClient, hash: Hex, membership: string,
  stored: PreparedReceipt | undefined, pass: PreparedReconciliationPass, chainId: number, game: Hex): Promise<PreparedReceipt> {
  const identity = parseProofMembership(membership, chainId, game);
  const finalized = await (pass.finalizedHead ??= pass.read(async () => {
    const block = await client.getBlock({ blockTag: "finalized" });
    if (block.number === null) throw new Error("explicit finalized block unavailable");
    return block.number;
  }));
  const receipt = stored ? undefined : await pass.read(() => client.getTransactionReceipt({ hash }));
  if (receipt && (receipt.transactionHash !== hash || !["success", "reverted"].includes(receipt.status)
    || typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n || !bytes32(receipt.blockHash)))
    throw new Error("invalid proof receipt evidence");
  const blockNumber = stored ? BigInt(stored.blockNumber) : receipt!.blockNumber;
  const blockHash = stored ? stored.blockHash : receipt!.blockHash;
  const block = await pass.read(() => client.getBlock({ blockNumber }));
  if (!block.hash || block.hash !== blockHash) throw new Error("proof receipt is not canonical");
  pass.assertActive();
  return { blockNumber: blockNumber.toString(), blockHash, finalized: blockNumber <= finalized,
    outcomes: stored?.outcomes ?? JSON.stringify({ kind: "proof-v1", battleId: identity.battleId,
      action: identity.action, status: receipt!.status, battleComplete: false }) };
}
