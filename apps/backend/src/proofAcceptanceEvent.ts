import { decodeEventLog, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { proofBattleAcceptedEventSignature } from "../../../packages/chain-abi/src/proofSettlement";
import type { ProofBattleAcceptance } from "../../../packages/api-types/src/index";
import type { RpcLog } from "./evm";
const abi = parseAbi([proofBattleAcceptedEventSignature]);
export const proofBattleAcceptedTopic = keccak256(stringToHex("ProofBattleAccepted(uint256,bytes32,bytes32,bytes32,uint256,uint8,uint256,uint256,uint8,uint32)"));
export const isProofBattleAcceptedLog = (log: RpcLog) => log.topics[0]?.toLowerCase() === proofBattleAcceptedTopic;
/** Observed canonical-ledger evidence only. Not runtime qualification, proof verification or terminal. */
export function decodeProofBattleAccepted(log: RpcLog & { logIndex?: string }): ProofBattleAcceptance {
  if (!/^0x[0-9a-f]{40}$/i.test(log.address ?? "") || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(log.logIndex ?? "")
    || log.topics.length !== 4 || !/^0x[0-9a-f]{448}$/i.test(log.data)
    || !/^0x[0-9a-f]{64}$/i.test(log.blockHash ?? "") || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash))
    throw new Error("malformed proof acceptance log");
  const { args } = decodeEventLog({ abi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
  const outcome = args.side0 > 0n && args.side1 === 0n ? 1 : args.side1 > 0n && args.side0 === 0n ? 2 : 0;
  if (args.rounds > 6 || args.outcome !== outcome || !args.version || BigInt(args.binding) === 0n || BigInt(args.releaseId) === 0n)
    throw new Error("invalid proof acceptance scalars");
  return { battleId: args.battleId.toString(), binding: args.binding, releaseId: args.releaseId, root: args.root,
    memberCount: args.memberCount.toString(), rounds: args.rounds, finalTotals: [args.side0.toString(), args.side1.toString()],
    outcome: args.outcome, version: args.version, address: log.address!, blockNumber: BigInt(log.blockNumber).toString(),
    blockHash: log.blockHash!, transactionHash: log.transactionHash, logIndex: BigInt(log.logIndex ?? "0x0").toString() };
}
