import { expect, test } from "bun:test";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, parseAbi, parseAbiParameters, toHex } from "viem";
import { proofBattleReadSignatures, proofRandomnessReadSignatures, proofBattleRecordSchema,
  proofBattleRequestSchema, proofBattleRowSchema } from "../../../packages/chain-abi/src/proofBattle";
import type { ProofBattleProgress } from "../../../packages/api-types/src/index";
import type { FleetMissionSummary as ServerMission } from "./evm";
import { parseProofBattleStatus } from "./proofBattleProgress";

const address = "0x1111111111111111111111111111111111111111" as const;
const word = (n: bigint) => toHex(n, { size: 32 }).slice(2);
test("shared reads retain exact contract tuple widths/order without exposing transaction selectors", () => {
  const abi = parseAbi([...proofBattleReadSignatures, ...proofRandomnessReadSignatures]);
  expect(abi.every(item => item.type === "function" && item.stateMutability === "view")).toBe(true);
  expect(abi.map(item => item.name)).toEqual(["proofBattleRecord", "proofSettlementProgress", "request", "battlePurposeContext"]);
  for (const kind of [0, 1, 2, 3, 4, 5]) {
    const data = encodeFunctionData({ abi, functionName: "proofBattleRecord", args: [7n, kind, 8n] });
    expect(decodeFunctionData({ abi, data }).args).toEqual([7n, kind, 8n]);
  }
  // Independent Solidity static-word fixtures, not encode/decode with the same schema.
  const raw = ("0x" + [3n, 1n, 2n, BigInt(address), 4n, 3n, 5n, 6n, (1n << 255n), 9n].map(word).join("")) as `0x${string}`;
  const decoded = decodeAbiParameters(parseAbiParameters(proofBattleRecordSchema), raw);
  expect(decoded[0]).toEqual({ version: 3, rules: toHex(1n, { size: 32 }), catalog: toHex(2n, { size: 32 }),
    verifier: address, verifierCodehash: toHex(4n, { size: 32 }) });
  expect(decoded.slice(1)).toEqual([3, toHex(5n, { size: 32 }), toHex(6n, { size: 32 }), 1n << 255n, 9n]);
  const request = ("0x" + [BigInt(address), 1n << 200n, 7n].map(word).join("")) as `0x${string}`;
  expect(decodeAbiParameters(parseAbiParameters(proofBattleRequestSchema), request)).toEqual([address, 1n << 200n, toHex(7n, { size: 32 })]);
  const row = ("0x" + [1n << 200n, BigInt(address), 0xffffffffn, 1n, 23n, 65535n, 65534n, 65533n].map(word).join("")) as `0x${string}`;
  expect(decodeAbiParameters(parseAbiParameters(proofBattleRowSchema), row)[0]).toEqual({ source: 1n << 200n,
    owner: address, count: 0xffffffff, side: 1, unit: 23, weapons: 65535, shielding: 65534, armor: 65533 });
});

test("public status shares backend/client types and decimal precision, legacy omission remains valid", () => {
  const status: ProofBattleProgress = { state: "applying", stagedPhase: 17, nextIndex: "9007199254740993", memberCount: "9007199254740994" };
  const server: Pick<ServerMission, "proofBattleProgress"> = { proofBattleProgress: status };
  const client: { proofBattleProgress?: ProofBattleProgress } = server;
  expect(JSON.parse(JSON.stringify(client))).toEqual(server);
  const legacy: { proofBattleProgress?: ProofBattleProgress } = {};
  expect(legacy.proofBattleProgress).toBeUndefined();
  expect(parseProofBattleStatus({ ...status, percent: 100, acceptedRoot: "invented" })).toEqual(status);
  expect(parseProofBattleStatus({ state: "unavailable", stagedPhase: 17 })).toEqual({ state: "unavailable", stagedPhase: 17 });
  for (const invalid of [
    { ...status, nextIndex: 9007199254740993 }, { ...status, nextIndex: "-1" }, { ...status, nextIndex: "01" },
    { ...status, nextIndex: "9007199254740995" }, { ...status, memberCount: undefined },
    { ...status, blockNumber: "1" }, { ...status, blockHash: "0x01", blockNumber: "1" },
    { ...status, stagedPhase: 256 }, { ...status, state: "complete" }, { ...status, state: "proving" }
  ]) expect(parseProofBattleStatus(invalid)).toBeUndefined();
});
