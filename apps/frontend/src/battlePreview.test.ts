import { describe, expect, test } from "bun:test";
import {
  CONTRACT_BATTLE_SAMPLE_COUNT,
  deterministicBattleSampleWord,
  forecastContractBattle,
  runContractBattle,
  type BattleFleetParticipant,
  type CombatTechnology,
  type ContractBattleInput,
} from "./battlePreview";

const ZERO_TECH: CombatTechnology = { weapons: 0, shielding: 0, armor: 0 };

describe("contract battle preview parity", () => {
  test("matches the Forge technology-disparity fixture", () => {
    const attacker = ships([10, 40]);
    const defender = ships([1, 40]);
    const result = runContractBattle(
      battle(attacker, defender, defenses(), {
        attacker: { weapons: 3, shielding: 2, armor: 4 },
        defender: { weapons: 1, shielding: 5, armor: 2 },
      }),
      seed(5),
    );

    expect(result).toMatchObject({
      outcome: "win",
      attackerSurvivors: 40,
      defenderSurvivors: 0,
      attackerLosses: { metal: 0, crystal: 0, deuterium: 0 },
      defenderLosses: { metal: 120_000, crystal: 40_000, deuterium: 0 },
    });
    expect(result.rounds).toHaveLength(1);
  });

  test("matches shield-gate and hull-explosion Forge fixtures", () => {
    const shieldGate = runContractBattle(
      battle(ships([0, 1]), ships(), defenses([7, 10])),
      seed(780),
    );
    expect(shieldGate).toMatchObject({
      outcome: "draw",
      attackerSurvivors: 1,
      defenderSurvivors: 10,
      attackerLosses: { metal: 0, crystal: 0, deuterium: 0 },
    });
    expect(shieldGate.rounds).toHaveLength(6);

    const explosionInput = battle(ships([0, 1]), ships([0, 27]), defenses());
    const stable = runContractBattle(explosionInput, seed(1));
    const exploded = runContractBattle(explosionInput, seed(2));
    expect(stable).toMatchObject({ outcome: "draw", attackerSurvivors: 1, defenderSurvivors: 27 });
    expect(exploded).toMatchObject({
      outcome: "defeat",
      attackerSurvivors: 0,
      defenderSurvivors: 27,
      attackerLosses: { metal: 2_000, crystal: 2_000, deuterium: 0 },
    });
    expect(exploded.rounds).toHaveLength(3);
  });

  test("matches rapidfire-heavy and mixed-unit Forge fixtures", () => {
    const rapidfire = runContractBattle(
      battle(ships([6, 1]), ships(), defenses([0, 50])),
      seed(101),
    );
    expect(rapidfire).toMatchObject({
      outcome: "defeat",
      attackerLosses: { metal: 20_000, crystal: 7_000, deuterium: 2_000 },
    });
    expect(rapidfire.rapidfireExtraShots.attacker).toBeGreaterThan(0);
    expect(rapidfire.defender.survivingDefenses).toEqual([
      { id: 0, label: "Rocket Launcher", count: 49 },
    ]);

    const mixed = runContractBattle(
      battle(ships([6, 1]), ships([1, 10]), defenses([0, 50])),
      seed(404),
    );
    expect(mixed).toMatchObject({
      outcome: "defeat",
      attackerLosses: { metal: 20_000, crystal: 7_000, deuterium: 2_000 },
      defenderLosses: { metal: 18_000, crystal: 6_000, deuterium: 0 },
    });
    expect(mixed.defender.survivingShips).toEqual([
      { id: 1, label: "Light Fighter", count: 4 },
    ]);
    expect(mixed.defender.survivingDefenses).toEqual([
      { id: 0, label: "Rocket Launcher", count: 40 },
    ]);
  });

  test("matches joined-attacker and participant-specific counterplay fixtures", () => {
    const joined = fleet("joined", 1, ships([7, 1_000]), ZERO_TECH);
    const joinedResult = runContractBattle(
      battle(ships([7, 1_000]), ships(), defenses([0, 500]), {}, [joined]),
      seed(104),
    );
    expect(joinedResult).toMatchObject({
      outcome: "win",
      attackerSurvivors: 2_000,
      defenderSurvivors: 350,
    });
    expect(joinedResult.attackers).toHaveLength(2);

    const counterShips = ships([0, 14]);
    const zeroTech = runContractBattle(
      battle(ships([0, 1]), ships(), defenses(), {}, [], [
        fleet("counter", 0, counterShips, ZERO_TECH),
      ]),
      seed(17),
    );
    const ownerTech = runContractBattle(
      battle(ships([0, 1]), ships(), defenses(), {}, [], [
        fleet("counter", 0, counterShips, { weapons: 10, shielding: 10, armor: 10 }),
      ]),
      seed(17),
    );
    expect(zeroTech.outcome).toBe("draw");
    expect(ownerTech).toMatchObject({
      outcome: "defeat",
      attackerLosses: { metal: 2_000, crystal: 2_000, deuterium: 0 },
      attackerSurvivors: 0,
      defenderSurvivors: 14,
    });
  });

  test("matches the Forge counterplay-lane-sensitive fixture", () => {
    const inputForLane = (laneGroup: number) =>
      battle(ships([6, 1]), ships(), defenses(), {}, [], [
        fleet("counter", laneGroup, ships([1, 10]), ZERO_TECH),
      ]);
    const laneZero = runContractBattle(inputForLane(0), seed(46));
    const laneTwo = runContractBattle(inputForLane(2), seed(46));

    expect(laneZero).toMatchObject({
      outcome: "win",
      defenderSurvivors: 0,
      defenderLosses: { metal: 30_000, crystal: 10_000, deuterium: 0 },
    });
    expect(laneTwo).toMatchObject({
      outcome: "draw",
      defenderSurvivors: 1,
      defenderLosses: { metal: 27_000, crystal: 9_000, deuterium: 0 },
    });
    expect(laneTwo.defender.counterplay[0]?.laneGroup).toBe(2);
  });

  test("uses reproducible 256-bit samples and reports probability/loss ranges", () => {
    const input = battle(ships([0, 1]), ships([0, 27]), defenses());
    const first = forecastContractBattle(input);
    const second = forecastContractBattle(input);

    expect(first.samples).toHaveLength(CONTRACT_BATTLE_SAMPLE_COUNT);
    expect(first.samples.map((sample) => sample.randomWord)).toEqual(
      second.samples.map((sample) => sample.randomWord),
    );
    expect(first.outcomeCounts).toEqual(second.outcomeCounts);
    expect(first.outcomeCounts.draw).toBeGreaterThan(0);
    expect(first.outcomeCounts.defeat).toBeGreaterThan(0);
    expect(first.attackerLosses.best).toEqual({ metal: 0, crystal: 0, deuterium: 0 });
    expect(first.attackerLosses.worst).toEqual({ metal: 2_000, crystal: 2_000, deuterium: 0 });
    expect(deterministicBattleSampleWord(0)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("records round starts, losses, survivors, Rapidfire, and participant technology", () => {
    const report = runContractBattle(
      battle(ships([6, 1]), ships([1, 10]), defenses([0, 50]), {
        attacker: { weapons: 2, shielding: 3, armor: 4 },
        defender: { weapons: 1, shielding: 0, armor: 5 },
      }),
      seed(404),
      7,
    );

    expect(report.sampleId).toBe(7);
    expect(report.randomWord).toBe(seed(404));
    expect(report.rounds[0]).toMatchObject({
      round: 1,
      attackerStartingUnits: 1,
      defenderStartingUnits: 60,
    });
    expect(report.rounds[0]?.attackerRapidfireExtraShots).toBeGreaterThan(0);
    expect(report.attackers[0]?.technology).toEqual({ weapons: 2, shielding: 3, armor: 4 });
    expect(report.defender.technology).toEqual({ weapons: 1, shielding: 0, armor: 5 });
    expect(report.attackers[0]?.startingShips).toEqual([
      { id: 6, label: "Cruiser", count: 1 },
    ]);
  });
});

function battle(
  attackerShips: number[],
  defenderShips: number[],
  defenderDefenses: number[],
  technology: { attacker?: CombatTechnology; defender?: CombatTechnology } = {},
  joinedAttackers: BattleFleetParticipant[] = [],
  counterplay: BattleFleetParticipant[] = [],
): ContractBattleInput {
  return {
    attackers: [
      fleet("attacker", 0, attackerShips, technology.attacker ?? ZERO_TECH),
      ...joinedAttackers,
    ],
    defender: {
      id: "defender",
      label: "Defender",
      owner: "0xdefender",
      ships: defenderShips,
      defenses: defenderDefenses,
      technology: technology.defender ?? ZERO_TECH,
      counterplay,
    },
  };
}

function fleet(
  id: string,
  laneGroup: number,
  shipCounts: number[],
  technology: CombatTechnology,
): BattleFleetParticipant {
  return {
    id,
    label: id,
    owner: `0x${id}`,
    laneGroup,
    ships: shipCounts,
    technology,
  };
}

function ships(...entries: Array<[number, number]>): number[] {
  const result = Array.from({ length: 16 }, () => 0);
  for (const [id, count] of entries) result[id] = count;
  return result;
}

function defenses(...entries: Array<[number, number]>): number[] {
  const result = Array.from({ length: 8 }, () => 0);
  for (const [id, count] of entries) result[id] = count;
  return result;
}

function seed(value: number): `0x${string}` {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
