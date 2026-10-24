# OGame battle rules (ticket #44)

These are the combat rules the trusted battle referee applies to Attack battles launched while
the referee is active (combat model 3). They follow the real OGame engine as closely as the
public evidence allows; every rule below lists its source. The implementation is
`packages/battle-oracle` (rules identifier `veydrift-classic-combat-1`). The backend referee, the
frontend model-3 forecast and any independent auditor run the same code. The lifecycle, trust
model and operations are in [battle-referee.md](battle-referee.md). Battles launched before
activation keep staged model 2.

Gameforge has never published the combat formula. The strongest evidence is in-game test
data: the German board study (thread 208454, 2019), whose 41 real combat-report data points
are vendored as `packages/battle-oracle/fixtures/real-shield-reports.json` (MIT, darksky1605),
the TrashSim author's write-up (board.en thread 771533, post #227, 2021) and the official
`serverData.xml` (s1-en, v13.0.1).

## Inputs

The oracle consumes the roster the contracts journaled onchain before the seed was revealed
(see [battle-referee.md](battle-referee.md)): per row side (0 attacker, 1 defender), owner,
source (0 = the resident body, otherwise a mission id), unit type, count and the owner's frozen
Weapons/Shielding/Armour levels. One source cannot change side, owner or technology, and one
owner cannot have two technology levels. Duplicate source/type rows are rejected.

Unit stats and rapidfire come from `packages/battle-oracle/referee-catalog.json`, the official
OGame values (keccak256 pinned onchain as the referee catalog hash). `catalog.test.ts` checks
every unit's stats against the contract catalog; the rapidfire table is OGame's (Ion Cannon →
Reaper ×2, no Reaper → Ion Cannon). Types 0–15 are ships (Solar Satellites included), 16–23
defenses (including shield domes). Missiles never fight.

## Stats

| Stat | Rule | Evidence |
|---|---|---|
| Attack | `floor(base × (1 + 0.1 × Weapons))` in double precision | Recyclers at W18 fire 2 (600 for 300), not 2.8; 6.5 → 6 |
| Shield | `ceil(base × (1 + 0.1 × Shielding))` in double precision | Solar Satellite 2.6 absorbs 3; Large Cargo at S14 behaves as 61 = ceil(60.00000000000001) |
| Hull | `(metal + crystal) / 10 × (10 + Armour) / 10`, exact | Unknown rounding; exact for every OGame hull |

Double precision matters: `base × (1 + 0.1 × level)` is computed exactly as the game does, so
values like 60.00000000000001 round up.

## Rounds

1. A battle has at most six rounds. Each round, every unit alive at round start fires once,
   plus rapidfire. All shields are restored to full at round start; hull never regenerates.
2. Attackers fire first, then defenders. Units destroyed this round still fire, so the order of
   the two sides does not matter. Within a side, participants fire in roster order (attacking
   fleets as journaled; the defending body, then defending fleets), and within a participant
   units fire by ascending OGame technical id (Small Cargo 202 … Large Shield Dome 408), as the
   game does.
3. Every shot, including each rapidfire shot, targets a uniformly random enemy unit alive at
   round start. Units destroyed earlier in the round stay targetable; a shot at one does nothing
   (no damage, no explosion roll) but still counts for rapidfire.

## One shot

Let `A` be the shooter's attack, `S` the target's full shield, `s` its current shield and `h` its
hull (full hull `H`).

- **Shield up (`s > 0`):**
  - `A ≤ 1% of S` (`100·A ≤ S`): the shot bounces. Exactly 1% bounces.
  - `A < s`: the shield holds. It is kept as a whole percentage of `S`, rounded up and computed
    in float32: `s = ceil(f32(f32(f32(s − A) / f32(S)) × 100)) × S / 100`. The hull is untouched.
  - otherwise the shield breaks: `s = 0` and the remaining `A − s` hits the hull on the same shot.
- **Shield down (`s = 0`, broken this round or a unit without shields):** the whole shot hits the
  hull. There is no bounce once the shield is down.
- If `h ≤ 0` the unit is destroyed. Otherwise, if `h ≤ 0.7·H` (inclusive, double precision) the
  unit explodes with probability `1 − h/H`. This roll happens after **every** hit on a living
  unit, including bounced and fully absorbed shots.

Evidence: this shield model reproduces all 41 real combat-report data points, including the 13
exact-percentage cases the plain whole-percent model gets wrong (`oracle.test.ts`). 100
Battleships against a Deathstar shield of 160,000 absorbed 298,600 (99 × 3,000 + 1,600), which
shows the same-shot spill and rules out TrashSim's carry into the next hit. 49,866 Cruiser shots
of 1,400 against a 140,000 shield were all absorbed (exactly 1% bounces). An in-game test of a
Large Cargo at exactly 70% hull being destroyed shows the inclusive threshold; the OWiki says
the roll follows "jedem (!) Treffer" (every hit).

## Rapidfire

After a shot at a type the shooter has rapidfire `r > 1` against, it fires again at a new
random target with probability `1 − 1/r`. This includes bounced shots and shots at wrecks. There
is no chain cap.

## Battle end

The battle ends when a side has no units at round start or after round 6. A sole surviving side
wins; both sides surviving is a draw. Both sides destroyed in the same round is also a draw
(unverified in OGame; there is no loot either way).

## After the battle (contracts)

The referee's result is exact per-row losses; the contracts apply them and run the existing
staged economics:

- **Debris:** 30% of the metal and crystal of every destroyed ship, Solar Satellites included;
  destroyed defenses and deuterium leave none (`serverData.xml`: `debrisFactor` 0.3,
  `debrisFactorDef` 0, `deuteriumInDebris` off). Ship costs are the official ones. Debris is also
  capped by Veydrift's resource reserves, which OGame has no equivalent of.
- **Moon chance:** `min(20, floor(debris / 100,000))` percent of this battle's debris (OWiki,
  TrashSim).
- **Defense repair:** 70% of destroyed defenses (`repairFactor` 0.7): one destroyed unit of a type
  is repaired with a 70% chance, more units by `floor(0.7·n)`. OGame's exact distribution is
  not documented (sources disagree between a per-unit 70% roll and 60–80% per type).
- **Loot:** unchanged staged rules.

## Random stream

`word = SHA256(UTF8("veydrift-classic-combat-1:random:") || seed32 || counter32BE)`. The counter
starts at zero and increments for every word, including rejected ones. A draw below bound `n`
rejects `word ≥ 2^256 − (2^256 mod n)` and returns `word mod n`. Per shot the draw order is
target, then the explosion roll (only when it applies, bound 2^23: explode iff
`draw ≥ 2^23 · h/H`), then the rapidfire roll (only when `r > 1`, bound `r`: continue iff `draw ≠ 0`).

`advance(state, shotBudget)` resumes at physical-shot boundaries; `result(state)` refuses an
unfinished battle.

## Verification

- `bun test packages/battle-oracle`: unit rules, the 41 real reports, rapidfire, chunked replay,
  the random stream and the four planet-1 replays below.
- 863 real Veydrift battles were simulated with this engine and with TrashSim
  (klaasvp/trashsim-public @6358da5) patched to the same rules (an independent implementation),
  and with stock TrashSim. Results: `docs/battle-referee.md`.

## Known gaps

The weakest parts of the evidence: participant order inside ACS battles (we use roster order),
hull rounding, whether the explosion chance is continuous (we use a continuous chance), the
outcome when both sides die in the same round, and how repairs are distributed. OGame v7+
class bonuses, lifeform bonuses and Reaper debris harvesting are not part of classic combat
and are not applied. Unit costs, cargo capacities and fuel use match current OGame (Ion Cannon
5,000/3,000, Reaper and Pathfinder cargo 10,000, Bomber fuel 700, Reaper fuel 1,100).

## Four historical planet-1 replays

`fixtures/planet1.json` holds four real planet-1 battles imported offline from the
planet1-audit-22492 artifacts with their onchain frozen research and historical seeds
(`import-historical.ts` validates the rosters both ways). Each replays its own historical
starting state under these rules with the new random stream; they are one-seed scenarios,
not odds. Full output is `fixtures/planet1-results.json`, tested as an exact golden.

| Battle | Result | Rounds | Attacker start → survivors | Defender start → survivors | Physical shots |
|---|---|---:|---:|---:|---:|
| 97808 | Draw | 6 | 319 → 112 | 2373 → 201 | 9925 |
| 97839 | Attacker | 4 | 319 → 284 | 1580 → 0 | 6010 |
| 97876 | Defender | 3 | 50 → 0 | 1089 → 392 | 3075 |
| 97881 | Defender | 3 | 30 → 0 | 759 → 189 | 2226 |
