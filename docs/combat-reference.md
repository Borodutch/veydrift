# Combat Reference Model

Veydrift combat is checked against the deterministic reference simulator in
`packages/contracts/test/support/VeydriftCombatReferenceSimulator.sol`.

The target model is OGame-style classic combat with Veydrift catalog values:

- Up to 6 rounds.
- Each round starts from a snapshot of attacker ships before defender fire.
- Shots are distributed by individual unit counts, not by unit type buckets. Corrected model 2 uses shared-draw cumulative intervals in canonical cohort order, conserving every ordinary and rapidfire shot. Within a target cohort, quotient/remainder allocation gives the extra hit only to the remainder subset; shields, hull thresholds and explosion sampling apply separately to the two hit groups.
- Shields absorb incoming damage before hull damage.
- A target only has explosion chance after hull damage exceeds 30% of hull.
- Weapons, shielding, and armor technologies scale combat stats by 10% per level.
- Rapidfire uses the same deterministic random stream as the contract. Small shot counts expand exact rapidfire chains; large shot counts use the same bounded deterministic sampling as the onchain implementation to stay gas-bounded.
- The catalog uses Veydrift's full classic rapidfire matrix with the Reaper, Pathfinder, and Crawler extensions. Solar Satellites and Crawlers are targetable combat units: every mobile Veydrift ship has RF x5 against each, and Dreadstars have RF x1,250 against each. Veydrift deliberately omits only Espionage Probe lanes because that ship does not exist in its roster. `VeydriftClassicRapidfireCatalog.t.sol` pins every remaining non-1 ship and defense lane, while `combat-preview-catalog.json` is tested against the same Solidity source for the frontend preview.
- ACS attackers form one side; resident ships/defenses and eligible reactive/stationed defenders form the other. Units with the same type and effective attack/shield/hull merge into canonical cohorts before rounding or sampling. Each owner supplies its own research; no leader or average research is substituted.
- Equal-tech mission partitions and link order do not change same-seed side totals. Casualties are attributed back proportionally by largest remainder, with owner address then mission ID breaking indivisible ties. Attribution identity never enters combat randomness.
- Rapidfire continuation pools targets by type; its maximum chain length remains 64. Cohort counts are wide enough for combined uint32 mission quantities. This avoids per-ship expansion but does **not** establish a gas bound for arbitrary numbers of distinct-tech owners.
- The independent reference fixtures use two owners per side, while cohort partition tests cover larger rosters. The [shot-conservation release checklist](combat-shot-conservation.md) documents the current model and cutover; the VEY-919 checkpoint is historical, not the current release status. New battles use model 2; already-started battles retain their stored historical model. Live forecasts require positive contract model verification and suppress started/past-impact battles instead of applying new math to historical work.
- OGame-style ACS Defend (the `DefenseHold` mission) stations a fleet at a planet for a chosen hold
  window. Distinct from the reactive `AcsDefend`/`Intercept` counterplay (which target one specific
  in-flight attack by mission id), a held fleet automatically defends *any* attack that lands while
  it is holding: at each attack's resolution every fleet stationed over that attack's arrival is
  linked into the attack's counterplay roster and fights as a defender ship group, then keeps holding
  until its window elapses (or returns home when sent back). Authorization (own planet or a
  same-alliance member) and holding fuel, offset by the defended planet's Alliance Depot, mirror the
  counterplay holding rules.
- Ship losses create 30% metal/crystal debris. Defense losses do not create debris and 70% of destroyed defenses are repaired after the battle.

The parity fixture suite compares onchain battle events, stored debris, ship
survivors, defense repairs, ACS joined/counterplay survivors, and the large-stack
rapidfire approximation against this model. When a fixture fails, the assertion
label identifies the drifted mechanic: outcome, rounds, losses, debris, or a
specific survivor inventory.

## Indexed battle reports

Resolve defender state at impact time, not at a late resolver's current time. Report snapshots and
losses must come from the combat transaction's ordered count events and immutable fleet snapshots,
never the target's current inventory.

- Keep planet/moon fleet losses, stationed-fleet losses and static-defense losses separate.
- `CombatLosses.defender*` measures fleet value, not static-defense costs. Show defense destruction,
  restoration and net loss separately; defense losses do not create fleet debris.
- Attribute stationed-fleet destroyed counts only when the event evidence uniquely identifies them.
  Unknown allocation is not zero loss. A wiped defender still needs its pre-battle snapshot.
