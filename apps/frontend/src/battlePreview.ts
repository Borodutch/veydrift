import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import combatCatalogArtifact from "../../../packages/contracts/combat-preview-catalog.json";
import { advance, initialize, type Group, type State } from "../../../packages/battle-oracle/oracle";
import { catalog as refereeCatalog, rapidfire as refereeRapidfire } from "../../../packages/battle-oracle/catalog";
import { refereeRandom } from "./refereeRandom";

const BPS = 10_000n;
const BATTLE_MAX_ROUNDS = 6;
const MAX_RAPIDFIRE_CHAIN = 64;
const COMBAT_STREAM_DOMAIN = keccak256(stringToHex("veydrift.cohort-combat-random-stream.v1"));
const PREVIEW_SAMPLE_DOMAIN = keccak256(stringToHex("veydrift.attack-preview-sample.v1"));

export const CONTRACT_COMBAT_MODEL_VERSION = 2;
// Ticket #44: attacks launched while the trusted referee is active use classic per-shot combat rules.
export const REFEREE_COMBAT_MODEL_VERSION = 3;
// Host memory guard for one simulated battle (about 25 bytes per unit); not a gameplay cap.
const REFEREE_FORECAST_MAX_UNITS = 1_000_000;

export function isSupportedCombatModel(version: unknown): version is 2 | 3 {
  return version === CONTRACT_COMBAT_MODEL_VERSION || version === REFEREE_COMBAT_MODEL_VERSION;
}

// The backend-verified model for newly launched attacks; workers receive it with each request.
let activeModel: 2 | 3 = CONTRACT_COMBAT_MODEL_VERSION;
export function activeCombatModel(): 2 | 3 {
  return activeModel;
}
export function setActiveCombatModel(version: unknown): void {
  if (!isSupportedCombatModel(version)) throw new Error("This battle preview is out of date. Please refresh.");
  activeModel = version;
}

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
  /** Destroyed in battle, before repair. */
  lostDefenses: BattleCompositionRow[];
  /** Rebuilt after the battle (empty in round reports). */
  repairedDefenses: BattleCompositionRow[];
  /** After repair in the final report: start - lost + repaired. */
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
  roundCount: number;
  /** Debris before reserve limits; the contract may clip it to available reserves. */
  debris: { metal: number; crystal: number };
  moonChancePercent: number;
  rapidfireExtraShots: {
    attacker: number;
    defender: number;
  };
};

/** Contract debris: 30% of destroyed ships' metal and crystal (defenses leave none), and the
 * moon chance: 1% per full 100,000 debris, at most 20% (VeydriftMoonMath.chanceBps). */
export function debrisAndMoonChance(attackerLosses: BigResources, defenderLosses: BigResources) {
  const metal = (attackerLosses.metal + defenderLosses.metal) * 3_000n / 10_000n;
  const crystal = (attackerLosses.crystal + defenderLosses.crystal) * 3_000n / 10_000n;
  const percent = (metal + crystal) / 100_000n;
  return { debris: { metal: safeNumber(metal), crystal: safeNumber(crystal) }, moonChancePercent: Number(percent > 20n ? 20n : percent) };
}

/** `fast` samples come from the simulation draw source, not the referee's SHA-256 stream. */
export type ContractBattleReportSeed = Pick<ContractBattleResult, "sampleId" | "randomWord"> & { fast?: boolean };

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

export function runContractBattle(
  input: ContractBattleInput,
  randomWord: Hex,
  sampleId = 1,
  includeRoundReports = true,
  fast = false,
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
  const refereeRounds = activeModel === REFEREE_COMBAT_MODEL_VERSION ? refereeRoundLosses(battle, randomWord, fast) : null;
  let roundCount = 0;

  for (let round = 1; round <= BATTLE_MAX_ROUNDS; round += 1) {
    const snapshot = cloneBattle(battle);
    const attackerStartingUnits = attackerUnitTotal(snapshot.attackers);
    const defenderStartingUnits = defenderUnitTotal(snapshot.defender);
    if (attackerStartingUnits === 0 || defenderStartingUnits === 0) break;
    if (refereeRounds && !refereeRounds[round - 1]) break;

    const losses = refereeRounds ? refereeRounds[round - 1]! : battleRoundLosses(snapshot, seed, round);
    roundCount = round;
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

  const repairedDefenses = repairDefenses(battle.defender.defenses, destroyedDefenses, seed);
  // Staged model 2 only: referee battles (model 3) lose exactly the units the combat destroyed.
  if (outcome === "win" && !refereeRounds) {
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
      repairedDefenses,
    ),
    attackerLosses: resourcesToNumber(attackerLosses),
    defenderLosses: resourcesToNumber(defenderLosses),
    ...debrisAndMoonChance(attackerLosses, defenderLosses),
    attackerSurvivors,
    defenderSurvivors: defenderUnitTotal(battle.defender),
    roundCount,
    rapidfireExtraShots: {
      attacker: safeNumber(attackerRapidfireExtraShots),
      defender: safeNumber(defenderRapidfireExtraShots),
    },
  };
}

type RefereeMember = { side: 0 | 1; group: number; unit: number; count: number };

/** One oracle replay of the whole battle (the backend referee's exact rules), split into the
 * per-round losses the shared report builder consumes. The engine tracks every unit per fleet, so
 * per-fleet losses are exact, as in the referee's final result. */
function refereeRoundLosses(initial: MutableBattle, randomWord: Hex, fast: boolean): RoundLosses[] {
  const members = new Map<string, RefereeMember>();
  const groups: Group[] = [];
  const add = (side: 0 | 1, group: number, source: number, unit: number, count: number, technology: CombatTechnology) => {
    if (count <= 0) return;
    members.set(`${source}:${unit}`, { side, group, unit, count });
    // Synthetic owners keep each preview fleet independent of real addresses.
    groups.push({ side, owner: `0x${source.toString(16).padStart(40, "0")}`, source: String(source), type: unit, count, technology });
  };
  initial.attackers.forEach((fleet, group) => {
    for (let unit = 0; unit <= 14; unit++) if (unit !== 9) add(0, group, group + 1, unit, fleet.ships[unit] ?? 0, fleet.technology);
  });
  for (let unit = 0; unit < 16; unit++) add(1, -1, 0, unit, initial.defender.ships[unit] ?? 0, initial.defender.technology);
  for (let unit = 0; unit < 8; unit++) add(1, -1, 0, unit + 16, initial.defender.defenses[unit] ?? 0, initial.defender.technology);
  initial.defender.counterplay.forEach((fleet, group) => {
    const source = initial.attackers.length + 1 + group;
    for (let unit = 0; unit <= 14; unit++) if (unit !== 9) add(1, group, source, unit, fleet.ships[unit] ?? 0, fleet.technology);
  });
  let state: State;
  try {
    state = initialize({ seed: randomWord, catalog: refereeCatalog, rapidfire: refereeRapidfire, groups }, REFEREE_FORECAST_MAX_UNITS);
  } catch {
    throw new Error("This battle is too large to estimate here.");
  }
  // Either way the oracle's draw source is replaced: refereeRandom is its exact stream, only faster.
  state.random = fast ? fastRandom(randomWord) : refereeRandom(randomWord);
  while (!state.done) advance(state, 100_000);

  // The engine tracks every unit per fleet, so each round's per-fleet losses are exact.
  let before = state.groups.map((group) => group.count);
  return state.rounds.map((round) => {
    const lost = new Map<string, number>();
    state.groups.forEach((group, index) => lost.set(`${group.source}:${group.type}`, (before[index] ?? 0) - (round.survivors[index] ?? 0)));
    const losses: RoundLosses = {
      attackers: initial.attackers.map(() => zeroShipCounts()),
      defenderShips: zeroShipCounts(), defenderDefenses: zeroDefenseCounts(),
      counterplay: initial.defender.counterplay.map(() => zeroShipCounts()),
      attackerResources: zeroBigResources(), defenderResources: zeroBigResources(),
      attackerRapidfireExtraShots: 0n, defenderRapidfireExtraShots: 0n,
    };
    const startingUnits = [0n, 0n];
    state.groups.forEach((group, index) => { startingUnits[group.side]! += BigInt(before[index] ?? 0); });
    losses.attackerRapidfireExtraShots = round.shots[0] - startingUnits[0]!;
    losses.defenderRapidfireExtraShots = round.shots[1] - startingUnits[1]!;
    for (const [key, member] of members) {
      const count = lost.get(key) ?? 0;
      if (count <= 0) continue;
      if (member.side === 0) {
        addShipLoss(losses.attackers[member.group]!, initial.attackers[member.group]!.ships, member.unit, count, losses.attackerResources);
      } else if (member.group >= 0) {
        addShipLoss(losses.counterplay[member.group]!, initial.defender.counterplay[member.group]!.ships, member.unit, count, losses.defenderResources);
      } else if (member.unit >= 16) {
        addUnitLoss(losses.defenderDefenses, initial.defender.defenses, member.unit - 16, count);
      } else {
        addShipLoss(losses.defenderShips, initial.defender.ships, member.unit, count, losses.defenderResources);
      }
    }
    before = round.survivors;
    return losses;
  });
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

export function conservedShotAllocation(shots: bigint, count: bigint, prefix: bigint, total: bigint, draw: bigint): bigint {
  if (!shots || !count || !total) return 0n;
  // One shared draw over cumulative canonical intervals. Adjacent boundaries
  // cancel, so all targets together receive exactly the assigned shots.
  const boundary = (units: bigint) => {
    const weighted = shots * units;
    return weighted / total + (draw % total < weighted % total ? 1n : 0n);
  };
  return boundary(prefix + count) - boundary(prefix);
}

function cohortDistributed(shots: bigint, count: bigint, prefix: bigint, total: bigint, seed: bigint, round: number, side: number, firingKey: bigint, lane: bigint): bigint {
  return conservedShotAllocation(shots, count, prefix, total, combatStream(seed, round, side, firingKey, 0n, lane));
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
    let prefix = 0n;
    for (const target of typePool) {
      const start = prefix;
      prefix += target.count;
      const rapidfire = target.unit < 16 ? rapidfireAgainstShip(shooter.unit, target.unit) : rapidfireAgainstDefense(shooter.unit, target.unit - 16);
      if (rapidfire <= 1) continue;
      const selected = cohortDistributed(incoming, target.count, start, total, seed, round, side, shooter.key, 1n + BigInt(chain));
      generated += sampleChance(selected, BigInt(rapidfire - 1) * BPS / BigInt(rapidfire), seed, round, side, shooter.key, target.key, 30_000n + BigInt(chain));
    }
    if (!generated) break;
    extra += generated;
    incoming = generated;
  }
  return extra;
}

export function shotHitGroups(shots: bigint, count: bigint): { hits: bigint; count: bigint }[] {
  if (!shots || !count) return [];
  const targeted = shots < count ? shots : count;
  const hits = shots / targeted;
  const high = shots % targeted;
  return [{ hits, count: targeted - high }, { hits: hits + 1n, count: high }];
}

function cohortLossCount(target: CombatCohort, shots: bigint, shooter: CombatCohort, seed: bigint, round: number, side: number): bigint {
  if (!shots || !target.count || !shooter.attack || !target.hull || shooter.attack <= target.shield / 100n) return 0n;
  return shotHitGroups(shots, target.count).reduce((lost, group, index) => {
    const damage = shooter.attack * group.hits;
    if (!group.count || damage <= target.shield) return lost;
    const hullDamage = damage - target.shield;
    if (hullDamage >= target.hull) return lost + group.count;
    const chance = hullDamage * BPS / target.hull;
    if (chance <= 3_000n) return lost;
    return lost + sampleChance(group.count, chance, seed, round, side, shooter.key, target.key, (index === 0 ? 65_536n : 131_072n) + shots);
  }, 0n);
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
    let prefix = 0n;
    targets.forEach((target, index) => {
      const shots = cohortDistributed(shooter.count, target.count, prefix, total, seed, round, side, shooter.key, 0n)
        + cohortDistributed(extra, target.count, prefix, total, seed, round, side, shooter.key, 0n);
      prefix += target.count;
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
  repairedDefenses: readonly number[] = [],
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
    repairedDefenses: defenseRows(repairedDefenses),
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

/** VeydriftCatalog.repairedDefenseCounts: floor(70%) of each destroyed defense type is rebuilt; a single
 * destroyed unit (always the case for shield domes) comes back on a 70% seed roll. Returns the counts. */
function repairDefenses(defenses: number[], destroyed: readonly number[], seed: bigint): number[] {
  const repairedCounts = zeroDefenseCounts();
  for (let id = 0; id < 8; id += 1) {
    const count = destroyed[id] ?? 0;
    if (count === 0) continue;
    const repaired = count > 1 ? Math.floor((count * 7) / 10) : (seed + BigInt(id)) % 10n < 7n ? 1 : 0;
    defenses[id] = (defenses[id] ?? 0) + repaired;
    repairedCounts[id] = repaired;
  }
  return repairedCounts;
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

/** Seeded sfc32 draws uniform over [0, bound): the same rules as the referee, ~30x faster than its
 * SHA-256 stream, so simulations get many runs. A fast run is not the referee's replay of `word`. */
export function fastRandom(word: Hex): (bound: number) => number {
  const hex = word.slice(2).padStart(64, "0");
  let a = parseInt(hex.slice(0, 8), 16) | 0, b = parseInt(hex.slice(8, 16), 16) | 0;
  let c = parseInt(hex.slice(16, 24), 16) | 0, d = parseInt(hex.slice(24, 32), 16) | 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  return (bound) => Math.floor((next() / 4_294_967_296) * bound);
}

/** Totals over `runs` simulated battles; divide by `runs` for averages. Survivors are per unit id. */
export type BattleStats = {
  runs: number;
  /** Every run used the referee's exact draw stream (false: the fast simulation stream). */
  exact: boolean;
  /** Stopped at the hard time limit before reaching the minimum number of runs. */
  timeLimited: boolean;
  outcomes: Record<BattleOutcome, number>;
  rounds: number;
  attackerLosses: CombatResources;
  /** Destroyed ships plus defenses that were not rebuilt. */
  defenderLosses: CombatResources;
  /** Destroyed ships only: defenses never leave debris, repaired or not (_battleDebris). */
  debris: { metal: number; crystal: number };
  moonChance: number;
  attackers: number[][];
  defenderShips: number[];
  /** Defenses left after repair; per run, start - destroyed + repaired. */
  defenderDefenses: number[];
  defenderDefensesDestroyed: number[];
  defenderDefensesRepaired: number[];
  counterplay: number[][];
  samples: Partial<Record<BattleOutcome, ContractBattleReportSeed>>;
};

export function emptyBattleStats(input: ContractBattleInput, fast: boolean): BattleStats {
  return {
    runs: 0, exact: !fast, timeLimited: false, outcomes: { win: 0, draw: 0, defeat: 0 }, rounds: 0,
    attackerLosses: zeroResources(), defenderLosses: zeroResources(), debris: { metal: 0, crystal: 0 }, moonChance: 0,
    attackers: input.attackers.map(zeroShipCounts), defenderShips: zeroShipCounts(), defenderDefenses: zeroDefenseCounts(),
    defenderDefensesDestroyed: zeroDefenseCounts(), defenderDefensesRepaired: zeroDefenseCounts(),
    counterplay: input.defender.counterplay.map(zeroShipCounts), samples: {},
  };
}

/** `run` must come from the draw stream `stats` was created for. */
export function addBattleRun(stats: BattleStats, run: ContractBattleResult): void {
  const add = (totals: number[], rows: readonly BattleCompositionRow[]) => { for (const row of rows) totals[row.id] = (totals[row.id] ?? 0) + row.count; };
  stats.runs += 1;
  stats.outcomes[run.outcome] += 1;
  stats.rounds += run.roundCount;
  stats.attackerLosses = addResources(stats.attackerLosses, run.attackerLosses);
  const defenses = run.defender.startingDefenses.reduce((total, row) => {
    const lost = row.count - (run.defender.survivingDefenses.find((survivor) => survivor.id === row.id)?.count ?? 0);
    const unit = defenseStats(row.id);
    return lost > 0 ? addResources(total, { metal: unit.metal * lost, crystal: unit.crystal * lost, deuterium: unit.deuterium * lost }) : total;
  }, zeroResources());
  stats.defenderLosses = addResources(stats.defenderLosses, addResources(run.defenderLosses, defenses));
  stats.debris.metal += run.debris.metal;
  stats.debris.crystal += run.debris.crystal;
  stats.moonChance += run.moonChancePercent;
  run.attackers.forEach((fleet, index) => add(stats.attackers[index]!, fleet.survivingShips));
  add(stats.defenderShips, run.defender.survivingShips);
  add(stats.defenderDefenses, run.defender.survivingDefenses);
  add(stats.defenderDefensesDestroyed, run.defender.lostDefenses);
  add(stats.defenderDefensesRepaired, run.defender.repairedDefenses);
  run.defender.counterplay.forEach((fleet, index) => add(stats.counterplay[index]!, fleet.survivingShips));
  stats.samples[run.outcome] ??= { sampleId: run.sampleId, randomWord: run.randomWord, fast: !stats.exact };
}

/** The most frequent outcome, ties broken in attacker-win, draw, defeat order. */
export function likeliestOutcome(stats: Pick<BattleStats, "outcomes">): BattleOutcome {
  return (["win", "draw", "defeat"] as const).reduce((best, outcome) => stats.outcomes[outcome] > stats.outcomes[best] ? outcome : best);
}

/** Identifies one preview input under the active combat model (report and simulation keys). */
export function battlePreviewInputKey(input: ContractBattleInput): string {
  return JSON.stringify({ model: activeModel, input });
}

/** `fast`: the seeded sfc32 stream instead of the referee's exact SHA-256 draws (same rules). */
export type BattleSimulationLimits = { runs: number; minRuns: number; budgetMs: number; maxMs: number; fast: boolean };

/** Runs fixed seeds in order, so the first N runs are identical everywhere; only the run count can
 * differ. Stops after `runs`, after `budgetMs` once `minRuns` are done, and after `maxMs` regardless,
 * so huge battles never hold a (mobile) CPU for minutes just to reach `minRuns` (`timeLimited`). */
export function runBattleSimulation(
  input: ContractBattleInput,
  limits: BattleSimulationLimits,
  onProgress: (stats: BattleStats) => void = () => undefined,
  now: () => number = () => performance.now(),
): BattleStats {
  const stats = emptyBattleStats(input, limits.fast);
  const started = now();
  let posted = started;
  for (let index = 0; index < limits.runs; index++) {
    addBattleRun(stats, runContractBattle(input, deterministicBattleSampleWord(index), index + 1, false, limits.fast));
    const at = now(), elapsed = at - started;
    if (elapsed > limits.maxMs && stats.runs < limits.runs) {
      stats.timeLimited = stats.runs < limits.minRuns;
      break;
    }
    if (stats.runs >= limits.minRuns && elapsed > limits.budgetMs) break;
    if (at - posted > 200) {
      onProgress(stats);
      posted = at;
    }
  }
  return stats;
}

/** Synchronous `runs` fast simulations (tests and tiny inputs); UIs use battleSimulation.worker. */
export function simulateBattleStats(input: ContractBattleInput, runs: number): BattleStats {
  const stats = emptyBattleStats(input, true);
  for (let index = 0; index < runs; index++) {
    addBattleRun(stats, runContractBattle(input, deterministicBattleSampleWord(index), index + 1, false, true));
  }
  return stats;
}
