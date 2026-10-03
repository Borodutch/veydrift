import { expect, test } from "bun:test";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import fixtures from "../../../packages/contracts/combat-shot-fixtures.json";
import { runContractBattle, type ContractBattleInput } from "./battlePreview";

type Tech = [number, number, number];
const zero: Tech = [0, 0, 0];
const ten: Tech = [10, 10, 10];
const mixedA: Tech = [10, 8, 12];
const mixedD: Tech = [8, 12, 9];
const research: [string, Tech, Tech][] = [
  ["equal zero", zero, zero], ["equal ten", ten, ten],
  ["mixed", mixedA, mixedD], ["mixed reversed", mixedD, mixedA],
  ["attacker ten", ten, zero], ["defender ten", zero, ten],
];
const counts = [[100, 99], [99, 100], [100, 100], [100, 98], [100, 101]] as const;
const ships = (count: number) => Array.from({ length: 16 }, (_, unit) => unit === 13 ? count : 0);
const technology = ([weapons, shielding, armor]: Tech) => ({ weapons, shielding, armor });

// Expected digests come from the independent Solidity reference, checked against
// production at EVERY round. This compares all 7,680 seed outcomes, not just totals/ranges.
for (const [name, at, dt] of research) for (const [a, d] of counts) {
  test("seeded Solidity/TS parity: " + name + " " + a + ":" + d, () => {
    const key = "case" + keccak256(encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint32" }, { type: "uint16[3]" }, { type: "uint16[3]" }],
      [a, d, at, dt],
    ));
    const input: ContractBattleInput = {
      attackers: [{ id: "1", owner: "0x1", label: "Attacker", laneGroup: 0, ships: ships(a), technology: technology(at) }],
      defender: { id: "0", owner: "0x2", label: "Defender", ships: ships(d), defenses: Array(8).fill(0), technology: technology(dt), counterplay: [] },
    };
    let digest: Hex = "0x" + "00".repeat(32) as Hex;
    for (let seed = fixtures.firstSeed; seed <= fixtures.lastSeed; seed++) {
      const result = runContractBattle(input, ("0x" + seed.toString(16).padStart(64, "0")) as Hex);
      digest = keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }],
        [digest, BigInt(seed), BigInt(result.attackerSurvivors), BigInt(result.defenderSurvivors), BigInt(result.rounds.length), result.outcome === "draw" ? 0 : result.outcome === "win" ? 1 : 2],
      ));
    }
    const expected = (fixtures.cases as Record<string, string>)[key];
    if (!expected) throw new Error("Missing independently reviewed fixture " + key);
    expect(String(digest)).toBe(expected);
  });
}
