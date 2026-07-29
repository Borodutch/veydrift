import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import combatCatalogArtifact from "../../../packages/contracts/combat-preview-catalog.json";

const BPS = 10_000n;
const BATTLE_MAX_ROUNDS = 6;
const MAX_RAPIDFIRE_CHAIN = 64;
const TARGET_LANE_STRIDE = 32n;
const TARGET_LANE_PLANET_SHIP = 0n;
const TARGET_LANE_DEFENSE = 64n;
const TARGET_LANE_COUNTERPLAY_SHIP = 128n;
const TARGET_LANE_ATTACKER_SHIP = 4_096n;
const COMBAT_STREAM_DOMAIN = keccak256(stringToHex("veydrift.classic-combat-random-stream.v1"));
const PREVIEW_SAMPLE_DOMAIN = keccak256(stringToHex("veydrift.attack-preview-sample.v1"));

export const CONTRACT_BATTLE_SAMPLE_COUNT = 128;

export type CombatTechnology = {
  weapons: number;
  shielding: number;
  armor: number;
};

export type CombatResources = {
  metal: number;
  crystal: number;
  deuterium: number;
};

export type BattleOutcome = "win" | "draw" | "defeat";

export type BattleFleetParticipant = {
  id: string;
  label: string;
  owner: string;
  laneGroup: number;
  ships: readonly number[];
  technology: CombatTechnology;
};

export type BattleDefenderInput = {
  id: string;
  label: string;
  owner: string;
  ships: readonly number[];
  defenses: readonly number[];
  technology: CombatTechnology;
  counterplay: readonly BattleFleetParticipant[];
};

export type ContractBattleInput = {
  attackers: readonly BattleFleetParticipant[];
  defender: BattleDefenderInput;
};

export type BattleCompositionRow = {
  id: number;
  label: string;
  count: number;
};

export type BattleParticipantReport = {
  id: string;
  label: string;
  owner: string;
  laneGroup?: number;
  technology: CombatTechnology;
  startingShips: BattleCompositionRow[];
  lostShips: BattleCompositionRow[];
  survivingShips: BattleCompositionRow[];
};

export type BattleDefenderReport = BattleParticipantReport & {
  startingDefenses: BattleCompositionRow[];
  lostDefenses: BattleCompositionRow[];
  survivingDefenses: BattleCompositionRow[];
  counterplay: BattleParticipantReport[];
};

export type BattleRoundReport = {
  round: number;
  attackerStartingUnits: number;
  defenderStartingUnits: number;
  attackerRapidfireExtraShots: number;
  defenderRapidfireExtraShots: number;
  attackers: BattleParticipantReport[];
  defender: BattleDefenderReport;
};

export type ContractBattleResult = {
  sampleId: number;
  randomWord: Hex;
  outcome: BattleOutcome;
  rounds: BattleRoundReport[];
  attackers: BattleParticipantReport[];
  defender: BattleDefenderReport;
  attackerLosses: CombatResources;
  defenderLosses: CombatResources;
  attackerSurvivors: number;
  defenderSurvivors: number;
  rapidfireExtraShots: {
    attacker: number;
    defender: number;
  };
};

export type ContractBattleForecast = {
  samples: ContractBattleResult[];
  sampleReport: ContractBattleResult;
  outcomeCounts: Record<BattleOutcome, number>;
  probableOutcome: BattleOutcome;
  attackerLosses: {
    average: CombatResources;
    best: CombatResources;
    worst: CombatResources;
  };
  attackerSurvivorRange: {
    min: number;
    max: number;
  };
};

export type ContractBattleForecastSummary = Omit<ContractBattleForecast, "samples"> & {
  sampleCount: number;
};

type CatalogUnit = (typeof combatCatalogArtifact.ships)[number];
type MutableFleet = Omit<BattleFleetParticipant, "ships" | "technology"> & {
  ships: number[];
  technology: CombatTechnology;
};
type MutableDefender = Omit<BattleDefenderInput, "ships" | "defenses" | "technology" | "counterplay"> & {
  ships: number[];
  defenses: number[];
  technology: CombatTechnology;
  counterplay: MutableFleet[];
};
type MutableBattle = {
  attackers: MutableFleet[];
  defender: MutableDefender;
};
type BigResources = {
  metal: bigint;
  crystal: bigint;
  deuterium: bigint;
};
type RoundLosses = {
  attackers: number[][];
  defenderShips: number[];
  defenderDefenses: number[];
  counterplay: number[][];
  attackerResources: BigResources;
  defenderResources: BigResources;
  attackerRapidfireExtraShots: bigint;
  defenderRapidfireExtraShots: bigint;
};

const shipsById = new Map(combatCatalogArtifact.ships.map((unit) => [unit.id, unit]));
const defensesById = new Map(combatCatalogArtifact.defenses.map((unit) => [unit.id, unit]));
const shipRapidfire = new Map(
  combatCatalogArtifact.shipRapidfire.map((rule) => [`${rule.attacker}:${rule.defender}`, rule.value]),
);
const defenseRapidfire = new Map(
  combatCatalogArtifact.defenseRapidfire.map((rule) => [`${rule.attacker}:${rule.defender}`, rule.value]),
);

export function contractCombatPower(
  kind: "ship" | "defense",
  id: number,
  technology: CombatTechnology,
): number {
  const stats = kind === "ship" ? shipStats(id) : defenseStats(id);
  return Number(
    combatScaled(stats.attack, technology.weapons)
      + combatScaled(stats.shield, technology.shielding)
      + combatScaled(stats.hull, technology.armor) / 10n,
  );
}

export function deterministicBattleSampleWord(index: number): Hex {
  const encoded = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [PREVIEW_SAMPLE_DOMAIN, BigInt(Math.max(0, Math.trunc(index)))],
  );
  return keccak256(encoded);
}

export function forecastContractBattle(
  input: ContractBattleInput,
  sampleCount = CONTRACT_BATTLE_SAMPLE_COUNT,
): ContractBattleForecast {
  const count = Math.max(1, Math.trunc(sampleCount));
  const samples = Array.from({ length: count }, (_, index) =>
    runContractBattle(input, deterministicBattleSampleWord(index), index + 1),
  );
  const outcomeCounts: Record<BattleOutcome, number> = { win: 0, draw: 0, defeat: 0 };
  for (const sample of samples) outcomeCounts[sample.outcome] += 1;
  const probableOutcome = (["win", "draw", "defeat"] as const).reduce((best, outcome) =>
    outcomeCounts[outcome] > outcomeCounts[best] ? outcome : best,
  );
  const losses = samples.map((sample) => sample.attackerLosses);
  const firstLoss = losses[0] ?? zeroResources();
  const sum = losses.reduce(addResources, zeroResources());
  const survivorCounts = samples.map((sample) => sample.attackerSurvivors);

  return {
    samples,
    sampleReport: selectIllustrativeSample(samples, probableOutcome),
    outcomeCounts,
    probableOutcome,
    attackerLosses: {
      average: {
        metal: Math.round(sum.metal / samples.length),
        crystal: Math.round(sum.crystal / samples.length),
        deuterium: Math.round(sum.deuterium / samples.length),
      },
      best: losses.reduce((best, value) => resourceValue(value) < resourceValue(best) ? value : best, firstLoss),
      worst: losses.reduce((worst, value) => resourceValue(value) > resourceValue(worst) ? value : worst, firstLoss),
    },
    attackerSurvivorRange: {
      min: Math.min(...survivorCounts),
      max: Math.max(...survivorCounts),
    },
  };
}

export function summarizeContractBattleForecast(
  forecast: ContractBattleForecast,
): ContractBattleForecastSummary {
  const { samples: _samples, ...summary } = forecast;
  return {
    ...summary,
    sampleCount: forecast.samples.length,
  };
}

export function runContractBattle(
  input: ContractBattleInput,
  randomWord: Hex,
  sampleId = 1,
): ContractBattleResult {
  const battle = mutableBattle(input);
  const initial = cloneBattle(battle);
  const seed = BigInt(randomWord);
  const rounds: BattleRoundReport[] = [];
  let attackerLosses = zeroBigResources();
  let defenderLosses = zeroBigResources();
  let attackerRapidfireExtraShots = 0n;
  let defenderRapidfireExtraShots = 0n;
  const destroyedDefenses = Array.from({ length: 8 }, () => 0);

  for (let round = 1; round <= BATTLE_MAX_ROUNDS; round += 1) {
    const snapshot = cloneBattle(battle);
    const attackerStartingUnits = attackerUnitTotal(snapshot.attackers);
    const defenderStartingUnits = defenderUnitTotal(snapshot.defender);
    if (attackerStartingUnits === 0 || defenderStartingUnits === 0) break;

    const losses = battleRoundLosses(snapshot, seed, round);
    applyRoundLosses(battle, losses);
    attackerLosses = addBigResources(attackerLosses, losses.attackerResources);
    defenderLosses = addBigResources(defenderLosses, losses.defenderResources);
    attackerRapidfireExtraShots += losses.attackerRapidfireExtraShots;
    defenderRapidfireExtraShots += losses.defenderRapidfireExtraShots;
    for (let id = 0; id < destroyedDefenses.length; id += 1) {
      destroyedDefenses[id] = Math.max(destroyedDefenses[id] ?? 0, (initial.defender.defenses[id] ?? 0) - (battle.defender.defenses[id] ?? 0));
    }
    rounds.push(roundReport(snapshot, battle, losses, round));
  }

  const attackerSurvivors = attackerUnitTotal(battle.attackers);
  const defenderSurvivorsBeforeRepair = defenderUnitTotal(battle.defender);
  const outcome: BattleOutcome = attackerSurvivors > 0 && defenderSurvivorsBeforeRepair === 0
    ? "win"
    : attackerSurvivors === 0 && defenderSurvivorsBeforeRepair > 0
      ? "defeat"
      : "draw";

  repairDefenses(battle.defender.defenses, destroyedDefenses, seed);
  if (outcome === "win") {
    const solarSatellites = battle.defender.ships[9] ?? 0;
    if (solarSatellites > 0) {
      defenderLosses.crystal += BigInt(solarSatellites) * 2_000n;
    }
    battle.defender.ships[9] = 0;
    battle.defender.ships[15] = 0;
  }

  return {
    sampleId,
    randomWord,
    outcome,
    rounds,
    attackers: battle.attackers.map((participant, index) =>
      participantReport(
        initial.attackers[index] ?? participant,
        participant,
        countDifferences(initial.attackers[index]?.ships ?? participant.ships, participant.ships),
      ),
    ),
    defender: defenderReport(
      initial.defender,
      battle.defender,
      countDifferences(initial.defender.ships, battle.defender.ships),
      destroyedDefenses,
      initial.defender.counterplay.map((participant, index) =>
        countDifferences(participant.ships, battle.defender.counterplay[index]?.ships ?? participant.ships),
      ),
    ),
    attackerLosses: resourcesToNumber(attackerLosses),
    defenderLosses: resourcesToNumber(defenderLosses),
    attackerSurvivors,
    defenderSurvivors: defenderUnitTotal(battle.defender),
    rapidfireExtraShots: {
      attacker: safeNumber(attackerRapidfireExtraShots),
      defender: safeNumber(defenderRapidfireExtraShots),
    },
  };
}

function battleRoundLosses(snapshot: MutableBattle, seed: bigint, round: number): RoundLosses {
  const losses: RoundLosses = {
    attackers: snapshot.attackers.map(() => zeroShipCounts()),
    defenderShips: zeroShipCounts(),
    defenderDefenses: zeroDefenseCounts(),
    counterplay: snapshot.defender.counterplay.map(() => zeroShipCounts()),
    attackerResources: zeroBigResources(),
    defenderResources: zeroBigResources(),
    attackerRapidfireExtraShots: 0n,
    defenderRapidfireExtraShots: 0n,
  };
  const attackerTotal = attackerUnitTotal(snapshot.attackers);

  for (let targetIndex = 0; targetIndex < snapshot.attackers.length; targetIndex += 1) {
    const target = snapshot.attackers[targetIndex];
    const targetLosses = losses.attackers[targetIndex];
    if (!target || !targetLosses) continue;

    for (let shipId = 0; shipId < 16; shipId += 1) {
      const count = snapshot.defender.ships[shipId] ?? 0;
      if (!isBodyCombatShip(shipId) || count === 0) continue;
      const extraShots = fleetExtraShots(snapshot.attackers, shipId, count, attackerTotal, seed, round, 1, shipId);
      losses.defenderRapidfireExtraShots += extraShots;
      fireShipAtFleetLosses(
        targetLosses,
        snapshot.attackers,
        target,
        attackerTotal,
        shipId,
        count,
        extraShots,
        snapshot.defender.technology,
        seed,
        round,
        1,
        shipId,
        losses.attackerResources,
      );
    }

    for (let defenseId = 0; defenseId < 8; defenseId += 1) {
      const count = snapshot.defender.defenses[defenseId] ?? 0;
      if (count === 0) continue;
      fireDefenseAtFleetLosses(
        targetLosses,
        target,
        attackerTotal,
        defenseId,
        count,
        snapshot.defender.technology,
        seed,
        round,
        2,
        defenseId,
        losses.attackerResources,
      );
    }

    for (const firingGroup of snapshot.defender.counterplay) {
      for (let shipId = 0; shipId <= 14; shipId += 1) {
        const count = firingGroup.ships[shipId] ?? 0;
        if (shipId === 9 || count === 0) continue;
        const extraShots = fleetExtraShots(snapshot.attackers, shipId, count, attackerTotal, seed, round, 3, shipId);
        losses.defenderRapidfireExtraShots += extraShots;
        fireShipAtFleetLosses(
          targetLosses,
          snapshot.attackers,
          target,
          attackerTotal,
          shipId,
          count,
          extraShots,
          firingGroup.technology,
          seed,
          round,
          3,
          shipId,
          losses.attackerResources,
        );
      }
    }
  }

  for (const attacker of snapshot.attackers) {
    for (let shipId = 0; shipId <= 14; shipId += 1) {
      const count = attacker.ships[shipId] ?? 0;
      if (shipId === 9 || count === 0) continue;
      const extraShots = defenderExtraShots(snapshot.defender, shipId, count, seed, round, 4, shipId);
      losses.attackerRapidfireExtraShots += extraShots;
      fireShipAtDefenderLosses(
        losses,
        snapshot.defender,
        shipId,
        count,
        extraShots,
        attacker.technology,
        seed,
        round,
        4,
        shipId,
      );
    }
  }
  return losses;
}

function fireShipAtFleetLosses(
  losses: number[],
  targetPool: readonly MutableFleet[],
  target: MutableFleet,
  targetTotal: number,
  firingShip: number,
  firingCount: number,
  extraShots: bigint,
  firingTechnology: CombatTechnology,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
  resources: BigResources,
) {
  if (targetTotal === 0) return;
  const firingStats = shipStats(firingShip);
  const attack = combatScaled(firingStats.attack, firingTechnology.weapons);
  for (let targetShip = 0; targetShip <= 14; targetShip += 1) {
    const count = target.ships[targetShip] ?? 0;
    if (targetShip === 9 || count === 0) continue;
    const lane = targetLaneValue(TARGET_LANE_ATTACKER_SHIP, target.laneGroup, targetShip);
    const shots = distributedTargetShots(BigInt(firingCount), count, targetTotal, seed, round, side, firingUnit, lane)
      + distributedTargetShots(extraShots, count, targetTotal, seed, round, side, firingUnit, lane);
    const lost = shipLossCount(targetShip, count, shots, attack, target.technology, seed, round, side, lane);
    addShipLoss(losses, target.ships, targetShip, lost, resources);
  }
  void targetPool;
}

function fireDefenseAtFleetLosses(
  losses: number[],
  target: MutableFleet,
  targetTotal: number,
  firingDefense: number,
  firingCount: number,
  firingTechnology: CombatTechnology,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
  resources: BigResources,
) {
  if (targetTotal === 0) return;
  const attack = combatScaled(defenseStats(firingDefense).attack, firingTechnology.weapons);
  for (let targetShip = 0; targetShip <= 14; targetShip += 1) {
    const count = target.ships[targetShip] ?? 0;
    if (targetShip === 9 || count === 0) continue;
    const targetLane = targetLaneValue(TARGET_LANE_ATTACKER_SHIP, target.laneGroup, targetShip);
    const shots = distributedTargetShots(BigInt(firingCount), count, targetTotal, seed, round, side, firingUnit, targetLane);
    const lost = shipLossCount(targetShip, count, shots, attack, target.technology, seed, round, side, targetLane);
    addShipLoss(losses, target.ships, targetShip, lost, resources);
  }
}

function fireShipAtDefenderLosses(
  losses: RoundLosses,
  target: MutableDefender,
  firingShip: number,
  firingCount: number,
  extraShots: bigint,
  firingTechnology: CombatTechnology,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
) {
  const targetTotal = defenderUnitTotal(target);
  if (targetTotal === 0) return;
  const attack = combatScaled(shipStats(firingShip).attack, firingTechnology.weapons);

  for (let targetShip = 0; targetShip < 16; targetShip += 1) {
    const count = target.ships[targetShip] ?? 0;
    if (!isBodyCombatShip(targetShip) || count === 0) continue;
    const lane = targetLaneValue(TARGET_LANE_PLANET_SHIP, 0, targetShip);
    const shots = distributedTargetShots(BigInt(firingCount), count, targetTotal, seed, round, side, firingUnit, lane)
      + distributedTargetShots(extraShots, count, targetTotal, seed, round, side, firingUnit, lane);
    const lost = shipLossCount(targetShip, count, shots, attack, target.technology, seed, round, side, lane);
    addShipLoss(losses.defenderShips, target.ships, targetShip, lost, losses.defenderResources);
  }

  for (let defenseId = 0; defenseId < 8; defenseId += 1) {
    const count = target.defenses[defenseId] ?? 0;
    if (count === 0) continue;
    const lane = targetLaneValue(TARGET_LANE_DEFENSE, 0, defenseId);
    const shots = distributedTargetShots(BigInt(firingCount), count, targetTotal, seed, round, side, firingUnit, lane)
      + distributedTargetShots(extraShots, count, targetTotal, seed, round, side, firingUnit, lane);
    const lost = defenseLossCount(defenseId, count, shots, attack, target.technology, seed, round, side, lane);
    addUnitLoss(losses.defenderDefenses, target.defenses, defenseId, lost);
  }

  for (let groupIndex = 0; groupIndex < target.counterplay.length; groupIndex += 1) {
    const group = target.counterplay[groupIndex];
    const groupLosses = losses.counterplay[groupIndex];
    if (!group || !groupLosses) continue;
    for (let targetShip = 0; targetShip <= 14; targetShip += 1) {
      const count = group.ships[targetShip] ?? 0;
      if (targetShip === 9 || count === 0) continue;
      const lane = targetLaneValue(TARGET_LANE_COUNTERPLAY_SHIP, group.laneGroup, targetShip);
      const shots = distributedTargetShots(BigInt(firingCount), count, targetTotal, seed, round, side, firingUnit, lane)
        + distributedTargetShots(extraShots, count, targetTotal, seed, round, side, firingUnit, lane);
      const lost = shipLossCount(targetShip, count, shots, attack, group.technology, seed, round, side, lane);
      addShipLoss(groupLosses, group.ships, targetShip, lost, losses.defenderResources);
    }
  }
}

function fleetExtraShots(
  targetPool: readonly MutableFleet[],
  firingShip: number,
  shots: number,
  targetTotal: number,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
): bigint {
  let incoming = BigInt(shots);
  let extraShots = 0n;
  for (let chain = 0; chain < MAX_RAPIDFIRE_CHAIN; chain += 1) {
    let generated = 0n;
    for (const group of targetPool) {
      generated += shipExtraShots(
        group.ships,
        TARGET_LANE_ATTACKER_SHIP,
        group.laneGroup,
        firingShip,
        incoming,
        targetTotal,
        seed,
        round,
        side,
        firingUnit,
        chain,
      );
    }
    if (generated === 0n) return extraShots;
    extraShots += generated;
    incoming = generated;
  }
  return extraShots;
}

function defenderExtraShots(
  target: MutableDefender,
  firingShip: number,
  shots: number,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
): bigint {
  const targetTotal = defenderUnitTotal(target);
  let incoming = BigInt(shots);
  let extraShots = 0n;
  for (let chain = 0; chain < MAX_RAPIDFIRE_CHAIN; chain += 1) {
    let generated = shipExtraShots(
      target.ships,
      TARGET_LANE_PLANET_SHIP,
      0,
      firingShip,
      incoming,
      targetTotal,
      seed,
      round,
      side,
      firingUnit,
      chain,
      true,
    );
    for (let defenseId = 0; defenseId < 8; defenseId += 1) {
      generated += unitExtraShots(
        target.defenses[defenseId] ?? 0,
        rapidfireAgainstDefense(firingShip, defenseId),
        incoming,
        targetTotal,
        seed,
        round,
        side,
        firingUnit,
        targetLaneValue(TARGET_LANE_DEFENSE, 0, defenseId),
        chain,
      );
    }
    for (const group of target.counterplay) {
      generated += shipExtraShots(
        group.ships,
        TARGET_LANE_COUNTERPLAY_SHIP,
        group.laneGroup,
        firingShip,
        incoming,
        targetTotal,
        seed,
        round,
        side,
        firingUnit,
        chain,
      );
    }
    if (generated === 0n) return extraShots;
    extraShots += generated;
    incoming = generated;
  }
  return extraShots;
}

function shipExtraShots(
  ships: readonly number[],
  laneBase: bigint,
  laneGroup: number,
  firingShip: number,
  incoming: bigint,
  targetTotal: number,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
  chain: number,
  bodyShips = false,
): bigint {
  let generated = 0n;
  for (let shipId = 0; shipId <= 14; shipId += 1) {
    if (shipId === 9 || (bodyShips && !isBodyCombatShip(shipId))) continue;
    generated += unitExtraShots(
      ships[shipId] ?? 0,
      rapidfireAgainstShip(firingShip, shipId),
      incoming,
      targetTotal,
      seed,
      round,
      side,
      firingUnit,
      targetLaneValue(laneBase, laneGroup, shipId),
      chain,
    );
  }
  return generated;
}

function unitExtraShots(
  count: number,
  rapidfire: number,
  incoming: bigint,
  targetTotal: number,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
  lane: bigint,
  chain: number,
): bigint {
  if (count === 0 || rapidfire <= 1) return 0n;
  const selected = distributedTargetShots(
    incoming,
    count,
    targetTotal,
    seed,
    round,
    side,
    firingUnit,
    lane + BigInt(chain + 1) * 8_192n,
  );
  return sampleChance(
    selected,
    (BigInt(rapidfire - 1) * BPS) / BigInt(rapidfire),
    seed,
    round,
    side,
    BigInt(firingUnit),
    lane,
    BigInt(30_000 + chain),
  );
}

function distributedTargetShots(
  shots: bigint,
  targetCount: number,
  targetTotal: number,
  seed: bigint,
  round: number,
  side: number,
  firingUnit: number,
  targetUnit: bigint,
): bigint {
  if (shots === 0n || targetCount === 0 || targetTotal === 0) return 0n;
  const total = BigInt(targetTotal);
  const weightedShots = shots * BigInt(targetCount);
  let assigned = weightedShots / total;
  if (combatStream(seed, round, side, BigInt(firingUnit), targetUnit, 0n) % total < weightedShots % total) {
    assigned += 1n;
  }
  return assigned;
}

function shipLossCount(
  shipId: number,
  count: number,
  shots: bigint,
  attack: bigint,
  technology: CombatTechnology,
  seed: bigint,
  round: number,
  side: number,
  lane: bigint,
): number {
  const stats = shipStats(shipId);
  return deterministicLossCount(
    count,
    shots,
    attack,
    combatScaled(stats.shield, technology.shielding),
    combatScaled(stats.hull, technology.armor),
    seed,
    round,
    side,
    lane,
  );
}

function defenseLossCount(
  defenseId: number,
  count: number,
  shots: bigint,
  attack: bigint,
  technology: CombatTechnology,
  seed: bigint,
  round: number,
  side: number,
  lane: bigint,
): number {
  const stats = defenseStats(defenseId);
  return deterministicLossCount(
    count,
    shots,
    attack,
    combatScaled(stats.shield, technology.shielding),
    combatScaled(stats.hull, technology.armor),
    seed,
    round,
    side,
    lane,
  );
}

function deterministicLossCount(
  count: number,
  shots: bigint,
  attack: bigint,
  shield: bigint,
  hull: bigint,
  seed: bigint,
  round: number,
  side: number,
  unit: bigint,
): number {
  if (count === 0 || shots === 0n || attack === 0n || hull === 0n) return 0;
  const targeted = shots < BigInt(count) ? shots : BigInt(count);
  const shotsPerTarget = (shots + targeted - 1n) / targeted;
  const damage = attack * shotsPerTarget;
  if (attack <= shield / 100n || damage <= shield) return 0;
  const hullDamage = damage - shield;
  if (hullDamage >= hull) return Number(targeted);
  const damageBps = (hullDamage * BPS) / hull;
  if (damageBps <= 3_000n) return 0;
  const sampled = sampleChance(targeted, damageBps, seed, round, side, unit, 0n, shots);
  return Number(sampled > targeted ? targeted : sampled);
}

function sampleChance(
  trials: bigint,
  chanceBps: bigint,
  seed: bigint,
  round: number,
  side: number,
  unit: bigint,
  targetUnit: bigint,
  lane: bigint,
): bigint {
  if (trials === 0n || chanceBps === 0n) return 0n;
  if (chanceBps >= BPS) return trials;
  const scaled = trials * chanceBps;
  let sampled = scaled / BPS;
  if (combatStream(seed, round, side, unit, targetUnit, lane) % BPS < scaled % BPS) {
    sampled += 1n;
  }
  return sampled;
}

function combatStream(
  seed: bigint,
  round: number,
  side: number,
  firingUnit: bigint,
  targetUnit: bigint,
  stream: bigint,
): bigint {
  const encoded = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint8" },
      { type: "uint8" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [COMBAT_STREAM_DOMAIN, seed, round, side, firingUnit, targetUnit, stream],
  );
  return BigInt(keccak256(encoded));
}

function applyRoundLosses(battle: MutableBattle, losses: RoundLosses) {
  for (let groupIndex = 0; groupIndex < battle.attackers.length; groupIndex += 1) {
    applyShipLosses(battle.attackers[groupIndex]?.ships, losses.attackers[groupIndex]);
  }
  applyShipLosses(battle.defender.ships, losses.defenderShips);
  applyUnitLosses(battle.defender.defenses, losses.defenderDefenses);
  for (let groupIndex = 0; groupIndex < battle.defender.counterplay.length; groupIndex += 1) {
    applyShipLosses(battle.defender.counterplay[groupIndex]?.ships, losses.counterplay[groupIndex]);
  }
}

function applyShipLosses(ships: number[] | undefined, losses: number[] | undefined) {
  if (!ships || !losses) return;
  for (let id = 0; id < ships.length; id += 1) {
    ships[id] = Math.max(0, (ships[id] ?? 0) - (losses[id] ?? 0));
  }
}

function applyUnitLosses(units: number[] | undefined, losses: number[] | undefined) {
  applyShipLosses(units, losses);
}

function addShipLoss(
  losses: number[],
  snapshot: readonly number[],
  shipId: number,
  requested: number,
  resources: BigResources,
) {
  const actual = addUnitLoss(losses, snapshot, shipId, requested);
  if (actual === 0) return;
  const stats = shipStats(shipId);
  resources.metal += BigInt(stats.metal) * BigInt(actual);
  resources.crystal += BigInt(stats.crystal) * BigInt(actual);
  resources.deuterium += BigInt(stats.deuterium) * BigInt(actual);
}

function addUnitLoss(losses: number[], snapshot: readonly number[], id: number, requested: number): number {
  if (requested <= 0) return 0;
  const available = snapshot[id] ?? 0;
  const alreadyLost = losses[id] ?? 0;
  const actual = Math.min(requested, Math.max(0, available - alreadyLost));
  losses[id] = alreadyLost + actual;
  return actual;
}

function roundReport(snapshot: MutableBattle, after: MutableBattle, losses: RoundLosses, round: number): BattleRoundReport {
  return {
    round,
    attackerStartingUnits: attackerUnitTotal(snapshot.attackers),
    defenderStartingUnits: defenderUnitTotal(snapshot.defender),
    attackerRapidfireExtraShots: safeNumber(losses.attackerRapidfireExtraShots),
    defenderRapidfireExtraShots: safeNumber(losses.defenderRapidfireExtraShots),
    attackers: snapshot.attackers.map((participant, index) =>
      participantReport(participant, after.attackers[index] ?? participant, losses.attackers[index] ?? zeroShipCounts()),
    ),
    defender: defenderReport(
      snapshot.defender,
      after.defender,
      losses.defenderShips,
      losses.defenderDefenses,
      losses.counterplay,
    ),
  };
}

function participantReport(start: MutableFleet, after: MutableFleet, losses: readonly number[]): BattleParticipantReport {
  return {
    id: start.id,
    label: start.label,
    owner: start.owner,
    laneGroup: start.laneGroup,
    technology: { ...start.technology },
    startingShips: shipRows(start.ships),
    lostShips: shipRows(losses),
    survivingShips: shipRows(after.ships),
  };
}

function defenderReport(
  start: MutableDefender,
  after: MutableDefender,
  shipLosses: readonly number[],
  defenseLosses: readonly number[],
  counterplayLosses: readonly number[][],
): BattleDefenderReport {
  return {
    id: start.id,
    label: start.label,
    owner: start.owner,
    technology: { ...start.technology },
    startingShips: shipRows(start.ships),
    lostShips: shipRows(shipLosses),
    survivingShips: shipRows(after.ships),
    startingDefenses: defenseRows(start.defenses),
    lostDefenses: defenseRows(defenseLosses),
    survivingDefenses: defenseRows(after.defenses),
    counterplay: start.counterplay.map((participant, index) =>
      participantReport(
        participant,
        after.counterplay[index] ?? participant,
        counterplayLosses[index] ?? zeroShipCounts(),
      ),
    ),
  };
}

function mutableBattle(input: ContractBattleInput): MutableBattle {
  return {
    attackers: input.attackers.map(mutableFleet),
    defender: {
      id: input.defender.id,
      label: input.defender.label,
      owner: input.defender.owner,
      ships: normalizedCounts(input.defender.ships, 16),
      defenses: normalizedCounts(input.defender.defenses, 8),
      technology: normalizeTechnology(input.defender.technology),
      counterplay: input.defender.counterplay.map(mutableFleet),
    },
  };
}

function mutableFleet(participant: BattleFleetParticipant): MutableFleet {
  return {
    id: participant.id,
    label: participant.label,
    owner: participant.owner,
    laneGroup: Math.max(0, Math.trunc(participant.laneGroup)),
    ships: normalizedCounts(participant.ships, 16),
    technology: normalizeTechnology(participant.technology),
  };
}

function cloneBattle(battle: MutableBattle): MutableBattle {
  return {
    attackers: battle.attackers.map((participant) => ({ ...participant, ships: [...participant.ships], technology: { ...participant.technology } })),
    defender: {
      ...battle.defender,
      ships: [...battle.defender.ships],
      defenses: [...battle.defender.defenses],
      technology: { ...battle.defender.technology },
      counterplay: battle.defender.counterplay.map((participant) => ({
        ...participant,
        ships: [...participant.ships],
        technology: { ...participant.technology },
      })),
    },
  };
}

function repairDefenses(defenses: number[], destroyed: readonly number[], seed: bigint) {
  for (let id = 0; id < 8; id += 1) {
    const count = destroyed[id] ?? 0;
    if (count === 0) continue;
    const repaired = count > 1 ? Math.floor((count * 7) / 10) : (seed + BigInt(id)) % 10n < 7n ? 1 : 0;
    defenses[id] = (defenses[id] ?? 0) + repaired;
  }
}

function attackerUnitTotal(attackers: readonly MutableFleet[]): number {
  return attackers.reduce((total, participant) => total + missionShipTotal(participant.ships), 0);
}

function defenderUnitTotal(defender: MutableDefender): number {
  return bodyShipTotal(defender.ships)
    + defender.defenses.reduce((total, count) => total + count, 0)
    + defender.counterplay.reduce((total, participant) => total + missionShipTotal(participant.ships), 0);
}

function missionShipTotal(ships: readonly number[]): number {
  let total = 0;
  for (let id = 0; id <= 14; id += 1) {
    if (id !== 9) total += ships[id] ?? 0;
  }
  return total;
}

function bodyShipTotal(ships: readonly number[]): number {
  let total = 0;
  for (let id = 0; id < 16; id += 1) {
    if (isBodyCombatShip(id)) total += ships[id] ?? 0;
  }
  return total;
}

function isBodyCombatShip(id: number): boolean {
  return id <= 14 && id !== 9;
}

function combatScaled(value: number, technologyLevel: number): bigint {
  return (BigInt(value) * (BPS + BigInt(Math.max(0, Math.trunc(technologyLevel))) * 1_000n)) / BPS;
}

function targetLaneValue(base: bigint, group: number, unit: number): bigint {
  return base + BigInt(Math.max(0, Math.trunc(group))) * TARGET_LANE_STRIDE + BigInt(unit);
}

function rapidfireAgainstShip(attacker: number, defender: number): number {
  return shipRapidfire.get(`${attacker}:${defender}`) ?? 1;
}

function rapidfireAgainstDefense(attacker: number, defender: number): number {
  return defenseRapidfire.get(`${attacker}:${defender}`) ?? 1;
}

function shipStats(id: number): CatalogUnit {
  const unit = shipsById.get(id);
  if (!unit) throw new Error(`Unknown ship id ${id}`);
  return unit;
}

function defenseStats(id: number): (typeof combatCatalogArtifact.defenses)[number] {
  const unit = defensesById.get(id);
  if (!unit) throw new Error(`Unknown defense id ${id}`);
  return unit;
}

function shipRows(counts: readonly number[]): BattleCompositionRow[] {
  return counts.flatMap((count, id) => {
    const unit = shipsById.get(id);
    return count > 0 && unit ? [{ id, label: unit.label, count }] : [];
  });
}

function defenseRows(counts: readonly number[]): BattleCompositionRow[] {
  return counts.flatMap((count, id) => {
    const unit = defensesById.get(id);
    return count > 0 && unit ? [{ id, label: unit.label, count }] : [];
  });
}

function normalizedCounts(counts: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, index) => {
    const count = counts[index] ?? 0;
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  });
}

function countDifferences(starting: readonly number[], surviving: readonly number[]): number[] {
  return starting.map((count, index) => Math.max(0, count - (surviving[index] ?? 0)));
}

function normalizeTechnology(technology: CombatTechnology): CombatTechnology {
  return {
    weapons: Math.max(0, Math.trunc(technology.weapons)),
    shielding: Math.max(0, Math.trunc(technology.shielding)),
    armor: Math.max(0, Math.trunc(technology.armor)),
  };
}

function zeroShipCounts(): number[] {
  return Array.from({ length: 16 }, () => 0);
}

function zeroDefenseCounts(): number[] {
  return Array.from({ length: 8 }, () => 0);
}

function zeroBigResources(): BigResources {
  return { metal: 0n, crystal: 0n, deuterium: 0n };
}

function zeroResources(): CombatResources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

function addBigResources(left: BigResources, right: BigResources): BigResources {
  return {
    metal: left.metal + right.metal,
    crystal: left.crystal + right.crystal,
    deuterium: left.deuterium + right.deuterium,
  };
}

function addResources(left: CombatResources, right: CombatResources): CombatResources {
  return {
    metal: left.metal + right.metal,
    crystal: left.crystal + right.crystal,
    deuterium: left.deuterium + right.deuterium,
  };
}

function resourcesToNumber(resources: BigResources): CombatResources {
  return {
    metal: safeNumber(resources.metal),
    crystal: safeNumber(resources.crystal),
    deuterium: safeNumber(resources.deuterium),
  };
}

function safeNumber(value: bigint): number {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER;
}

function resourceValue(resources: CombatResources): number {
  return resources.metal + resources.crystal + resources.deuterium;
}

function selectIllustrativeSample(samples: readonly ContractBattleResult[], probableOutcome: BattleOutcome): ContractBattleResult {
  return samples.find((sample) => sample.outcome === probableOutcome) ?? samples[0]!;
}
