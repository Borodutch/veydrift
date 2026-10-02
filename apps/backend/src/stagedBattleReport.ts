import { keccak256, stringToHex } from "viem";
import type { Address, Resources, RpcLog } from "./evm";

export const stagedReportTopics = {
  snapshot: keccak256(stringToHex("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)")),
  losses: keccak256(stringToHex("CombatMissionLosses(uint256,uint256,address,uint8,uint8,uint32)")),
  repair: keccak256(stringToHex("CombatDefenseRepair(uint256,uint8,uint32)")),
  loot: keccak256(stringToHex("CombatMissionLoot(uint256,uint256,uint128,uint128,uint128)")),
  complete: keccak256(stringToHex("CombatEvidenceComplete(uint256,uint256,uint256,uint256,uint256)"))
} as const;
export const stagedReportTopicList = Object.values(stagedReportTopics);
export type StagedBattleMember = {
  missionId: string;
  owner: Address;
  side: 0 | 1;
  units: Array<{ unit: number; starting: number; destroyed: number; restored: number; remaining: number }>;
  loot: Resources;
};
export type StagedBattleEvidence = { members: StagedBattleMember[]; complete: boolean };
const zero = (): Resources => ({ metal: "0", crystal: "0", deuterium: "0" });
const number = (word: string | undefined) => BigInt("0x" + (word || "0"));

/** Immutable event arithmetic only. Never substitute current mission state or return cargo. */
export function decodeStagedBattleEvidence(logs: readonly RpcLog[], battleId: string): StagedBattleEvidence | undefined {
  const members = new Map<string, StagedBattleMember>();
  const snapshots = new Set<string>();
  const seen = new Set<string>();
  let found = false;
  let complete = true;
  let expected: bigint[] | undefined;
  const counts = [0n, 0n, 0n, 0n];
  const loot = new Map<string, Resources>();
  const repairs = new Map<number, number>();
  for (const log of logs) {
    if (log.removed || !stagedReportTopicList.includes(log.topics[0] as typeof stagedReportTopicList[number])) continue;
    if (BigInt(log.topics[1] ?? "0x0").toString() !== battleId) continue;
    const identity = log.transactionHash.toLowerCase() + ":" + (log.logIndex ?? "0x0");
    if (seen.has(identity)) continue;
    seen.add(identity);
    found = true;
    const words = log.data.slice(2).match(/.{64}/g) ?? [];
    const topic = log.topics[0];
    if (topic === stagedReportTopics.complete) {
      if (expected || words.length !== 4) complete = false;
      expected = words.map(number);
      continue;
    }
    const kindIndex = [stagedReportTopics.snapshot, stagedReportTopics.losses, stagedReportTopics.loot, stagedReportTopics.repair].indexOf(topic as never);
    if (kindIndex >= 0) counts[kindIndex] = (counts[kindIndex] ?? 0n) + 1n;
    if (topic === stagedReportTopics.loot) {
      if (words.length !== 3) { complete = false; continue; }
      const id = BigInt(log.topics[2] ?? "0x0").toString();
      if (loot.has(id)) complete = false;
      loot.set(id, { metal: number(words[0]).toString(), crystal: number(words[1]).toString(), deuterium: number(words[2]).toString() });
      continue;
    }
    if (topic === stagedReportTopics.repair) {
      const unit = Number(number(words[0]));
      const count = number(words[1]);
      if (words.length !== 2 || unit < 16 || unit > 23 || count > 0xffffffffn || repairs.has(unit)) { complete = false; continue; }
      repairs.set(unit, Number(count));
      continue;
    }
    const id = BigInt(log.topics[2] ?? "0x0").toString();
    const side = Number(number(words[0]));
    const unit = Number(number(words[1]));
    const count = number(words[2]);
    const ownerWord = log.topics[3];
    if (words.length !== 3 || !ownerWord || ![0, 1].includes(side) || unit > 23 || count > 0xffffffffn) { complete = false; continue; }
    const owner = ("0x" + ownerWord.slice(-40)).toLowerCase() as Address;
    const key = side + ":" + id;
    let member = members.get(key);
    if (!member) {
      member = { missionId: id, owner, side: side as 0 | 1, units: [], loot: zero() };
      members.set(key, member);
    }
    if (member.owner !== owner) complete = false;
    let row = member.units.find(row => row.unit === unit);
    if (!row) { row = { unit, starting: 0, destroyed: 0, restored: 0, remaining: 0 }; member.units.push(row); }
    const snapshotKey = key + ":" + unit;
    if (topic === stagedReportTopics.snapshot) {
      if (snapshots.has(snapshotKey)) complete = false;
      snapshots.add(snapshotKey);
      row.starting = Number(count);
    } else row.destroyed += Number(count);
  }
  if (!found) return undefined;
  if (!expected || expected.some((count, i) => count !== counts[i])) complete = false;
  for (const [key, member] of members) {
    member.loot = loot.get(member.missionId) ?? zero();
    for (const row of member.units) {
      if (!snapshots.has(key + ":" + row.unit)) complete = false;
      row.restored = member.missionId === "0" && member.side === 1 ? repairs.get(row.unit) ?? 0 : 0;
      if (row.destroyed > row.starting || row.restored > row.destroyed) complete = false;
      row.remaining = Math.max(0, row.starting - row.destroyed + row.restored);
    }
    member.units.sort((a, b) => a.unit - b.unit);
  }
  for (const id of loot.keys()) if (!members.has("0:" + id)) complete = false;
  for (const unit of repairs.keys()) if (!members.get("1:0")?.units.some(row => row.unit === unit)) complete = false;
  return { complete, members: [...members.values()].sort((a, b) => a.side - b.side || (BigInt(a.missionId) < BigInt(b.missionId) ? -1 : BigInt(a.missionId) > BigInt(b.missionId) ? 1 : 0)) };
}

const shipKeys = ["smallCargo", "lightFighter", "recycler", "colonyShip", "largeCargo", "heavyFighter", "cruiser", "battleship", "bomber", "solarSatellite", "destroyer", "deathstar", "battlecruiser", "reaper", "pathfinder", "crawler"];
export function stagedMemberShips(member: StagedBattleMember, field: "starting" | "destroyed" | "remaining"): Record<string, string> {
  return Object.fromEntries(member.units.filter(row => row.unit < 16 && row[field] > 0).map(row => [shipKeys[row.unit]!, String(row[field])]));
}
