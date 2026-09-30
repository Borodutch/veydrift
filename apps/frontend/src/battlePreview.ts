import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import combatCatalogArtifact from "../../../packages/contracts/combat-preview-catalog.json";

const BPS = 10_000n;
const BATTLE_MAX_ROUNDS = 6;
const MAX_RAPIDFIRE_CHAIN = 64;
const COMBAT_STREAM_DOMAIN = keccak256(stringToHex("veydrift.cohort-combat-random-stream.v1"));
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

export type ContractBattleReportSeed = Pick<ContractBattleResult, "sampleId" | "randomWord">;

export type ContractBattleForecastSummary = Omit<ContractBattleForecast, "samples" | "sampleReport"> & {
  sampleCount: number;
  sampleReport: ContractBattleReportSeed;
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
  includeRoundReports = true,
): ContractBattleForecast {
  const count = Math.max(1, Math.trunc(sampleCount));
  const samples = Array.from({ length: count }, (_, index) =>
    runContractBattle(input, deterministicBattleSampleWord(index), index + 1, includeRoundReports),
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
  const { samples: _samples, sampleReport, ...summary } = forecast;
  return {
    ...summary,
    sampleCount: forecast.samples.length,
    sampleReport: {
      sampleId: sampleReport.sampleId,
      randomWord: sampleReport.randomWord,
    },
  };
}

export function runContractBattle(
  input: ContractBattleInput,
  randomWord: Hex,
  sampleId = 1,
  includeRoundReports = true,
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
    if (includeRoundReports) rounds.push(roundReport(snapshot, battle, losses, round));
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
    defenderShips: zeroShipCounts(), defenderDefenses: zeroDefenseCounts(),
    counterplay: snapshot.defender.counterplay.map(() => zeroShipCounts()),
    attackerResources: zeroBigResources(), defenderResources: zeroBigResources(),
    attackerRapidfireExtraShots: 0n, defenderRapidfireExtraShots: 0n,
  };
  const attackers = combatCohorts(snapshot, true);
  const defenders = combatCohorts(snapshot, false);
  const attackLosses = cohortSideLosses(defenders, attackers, seed, round, 1);
  const defenseLosses = cohortSideLosses(attackers, defenders, seed, round, 4);
  losses.attackerRapidfireExtraShots = defenseLosses.extraShots;
  losses.defenderRapidfireExtraShots = attackLosses.extraShots;
  attributeCohortLosses(attackers, attackLosses.lost, snapshot, losses, true);
  attributeCohortLosses(defenders, defenseLosses.lost, snapshot, losses, false);
  return losses;
}

// Largest remainder apportionment preserves every casualty, independently of link order.
// Owner address then mission ID breaks equal remainders, never a combat/randomness lane.
function attributeCohortLosses(cohorts: CombatCohort[], lost: bigint[], snapshot: MutableBattle, losses: RoundLosses, attacking: boolean) {
  cohorts.forEach((cohort, index) => {
    const killed = lost[index] ?? 0n;
    const shares = cohort.members.map(member => ({ member, lost: killed * member.count / cohort.count, remainder: killed * member.count % cohort.count }));
    let left = killed - shares.reduce((sum, share) => sum + share.lost, 0n);
    const ranked = [...shares].sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      const ownerA = memberOwner(a.member, snapshot, attacking).toLowerCase();
      const ownerB = memberOwner(b.member, snapshot, attacking).toLowerCase();
      if (ownerA !== ownerB) return ownerA < ownerB ? -1 : 1;
      return compareMissionIdentity(a.member.identity, b.member.identity);
    });
    for (const share of ranked) {
      if (!left) break;
      if (share.remainder) { share.lost++; left--; }
    }
    for (const { member, lost: quantity } of shares) {
      const count = Number(quantity);
      if (!count) continue;
      if (attacking) {
        const fleet = snapshot.attackers[member.group]!;
        addShipLoss(losses.attackers[member.group]!, fleet.ships, member.unit, count, losses.attackerResources);
      } else if (member.group >= 0) {
        const fleet = snapshot.defender.counterplay[member.group]!;
        addShipLoss(losses.counterplay[member.group]!, fleet.ships, member.unit, count, losses.defenderResources);
      } else if (member.defense) {
        addUnitLoss(losses.defenderDefenses, snapshot.defender.defenses, member.unit, count);
      } else {
        addShipLoss(losses.defenderShips, snapshot.defender.ships, member.unit, count, losses.defenderResources);
      }
    }
  });
}

function memberOwner(member: CohortMember, snapshot: MutableBattle, attacking: boolean): string {
  return attacking ? snapshot.attackers[member.group]!.owner : member.group < 0 ? snapshot.defender.owner : snapshot.defender.counterplay[member.group]!.owner;
}

function compareMissionIdentity(a: string, b: string): number {
  // UI defender IDs are prefixed for report keys; numeric onchain identity remains the suffix.
  const numeric = (id: string) => /^(?:stationed-)?([0-9]+)$/.exec(id)?.[1];
  const left = numeric(a), right = numeric(b);
  if (left !== undefined && right !== undefined) return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
  // A not-yet-launched joining fleet has the next (largest) mission ID.
  if (a === "selected-attacker") return b === a ? 0 : 1;
  if (b === "selected-attacker") return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

type CohortMember = { count: bigint; group: number; unit: number; defense: boolean; identity: string };
type CombatCohort = { key: bigint; count: bigint; attack: bigint; shield: bigint; hull: bigint; unit: number; members: CohortMember[] };

function combatCohorts(snapshot: MutableBattle, attacking: boolean): CombatCohort[] {
  const cohorts = new Map<bigint, CombatCohort>();
  const add = (unit: number, count: number, technology: CombatTechnology, group: number, identity: string) => {
    if (!count) return;
    const stats = unit < 16 ? shipStats(unit) : defenseStats(unit - 16);
    const attack = combatScaled(stats.attack, technology.weapons);
    const shield = combatScaled(stats.shield, technology.shielding);
    const hull = combatScaled(stats.hull, technology.armor);
    const key = BigInt(keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [unit, attack, shield, hull])));
    const cohort = cohorts.get(key) ?? { key, count: 0n, attack, shield, hull, unit, members: [] };
    cohort.count += BigInt(count);
    cohort.members.push({ count: BigInt(count), group, unit: unit < 16 ? unit : unit - 16, defense: unit >= 16, identity });
    cohorts.set(key, cohort);
  };
  const fleet = (participant: MutableFleet, group: number) => {
    for (let unit = 0; unit <= 14; unit++) {
      if (unit !== 9) add(unit, participant.ships[unit] ?? 0, participant.technology, group, participant.id);
    }
  };
  if (attacking) snapshot.attackers.forEach(fleet);
  else {
    for (let unit = 0; unit < 16; unit++) add(unit, snapshot.defender.ships[unit] ?? 0, snapshot.defender.technology, -1, "0");
    for (let unit = 0; unit < 8; unit++) add(unit + 16, snapshot.defender.defenses[unit] ?? 0, snapshot.defender.technology, -1, "0");
    snapshot.defender.counterplay.forEach(fleet);
  }
  return [...cohorts.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function cohortDistributed(shots: bigint, count: bigint, total: bigint, seed: bigint, round: number, side: number, firingKey: bigint, targetKey: bigint, lane: bigint): bigint {
  if (!shots || !count || !total) return 0n;
  const weighted = shots * count;
  return weighted / total + (combatStream(seed, round, side, firingKey, targetKey, lane) % total < weighted % total ? 1n : 0n);
}

function cohortExtraShots(shooter: CombatCohort, targets: CombatCohort[], total: bigint, seed: bigint, round: number, side: number): bigint {
  if (shooter.unit >= 16) return 0n;
  // Rapidfire depends only on unit type, not target-owner technology.
  const typeCounts = Array<bigint>(24).fill(0n);
  for (const target of targets) typeCounts[target.unit] = (typeCounts[target.unit] ?? 0n) + target.count;
  const typePool = typeCounts.flatMap((count, unit) => count ? [{ count, unit, key: BigInt(unit) }] : []);
  let incoming = shooter.count;
  let extra = 0n;
  for (let chain = 0; chain < MAX_RAPIDFIRE_CHAIN; chain++) {
    let generated = 0n;
    for (const target of typePool) {
      const rapidfire = target.unit < 16 ? rapidfireAgainstShip(shooter.unit, target.unit) : rapidfireAgainstDefense(shooter.unit, target.unit - 16);
      if (rapidfire <= 1) continue;
      const selected = cohortDistributed(incoming, target.count, total, seed, round, side, shooter.key, target.key, 1n + BigInt(chain));
      generated += sampleChance(selected, BigInt(rapidfire - 1) * BPS / BigInt(rapidfire), seed, round, side, shooter.key, target.key, 30_000n + BigInt(chain));
    }
    if (!generated) break;
    extra += generated;
    incoming = generated;
  }
  return extra;
}

function cohortLossCount(target: CombatCohort, shots: bigint, shooter: CombatCohort, seed: bigint, round: number, side: number): bigint {
  if (!shots || !target.count || !shooter.attack || !target.hull) return 0n;
  const targeted = shots < target.count ? shots : target.count;
  const damage = shooter.attack * ((shots + targeted - 1n) / targeted);
  if (shooter.attack <= target.shield / 100n || damage <= target.shield) return 0n;
  const hullDamage = damage - target.shield;
  if (hullDamage >= target.hull) return targeted;
  const chance = hullDamage * BPS / target.hull;
  if (chance <= 3_000n) return 0n;
  return sampleChance(targeted, chance, seed, round, side, shooter.key, target.key, 65_536n + shots);
}

function cohortSideLosses(firing: CombatCohort[], targets: CombatCohort[], seed: bigint, round: number, side: number): { lost: bigint[]; extraShots: bigint } {
  const lost = targets.map(() => 0n);
  const total = targets.reduce((sum, target) => sum + target.count, 0n);
  let extraShots = 0n;
  if (!total) return { lost, extraShots };
  for (const shooter of firing) {
    if (!shooter.attack) continue;
    const extra = cohortExtraShots(shooter, targets, total, seed, round, side);
    extraShots += extra;
    targets.forEach((target, index) => {
      const shots = cohortDistributed(shooter.count, target.count, total, seed, round, side, shooter.key, target.key, 0n)
        + cohortDistributed(extra, target.count, total, seed, round, side, shooter.key, target.key, 0n);
      const killed = (lost[index] ?? 0n) + cohortLossCount(target, shots, shooter, seed, round, side);
      lost[index] = killed < target.count ? killed : target.count;
    });
  }
  return { lost, extraShots };
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
    if (isBodyCombatTarget(id)) total += ships[id] ?? 0;
  }
  return total;
}

function isBodyCombatTarget(id: number): boolean {
  return id >= 0 && id < 16;
}

function combatScaled(value: number, technologyLevel: number): bigint {
  return (BigInt(value) * (BPS + BigInt(Math.max(0, Math.trunc(technologyLevel))) * 1_000n)) / BPS;
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
