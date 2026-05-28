# Combat Reference Model

Veydrift combat is checked against the deterministic reference simulator in
`packages/contracts/test/support/VeydriftCombatReferenceSimulator.sol`.

The target model is OGame-style classic combat with Veydrift catalog values:

- Up to 6 rounds.
- Each round starts from a snapshot of attacker ships before defender fire.
- Shots are distributed by individual unit counts, not by unit type buckets.
- Shields absorb incoming damage before hull damage.
- A target only has explosion chance after hull damage exceeds 30% of hull.
- Weapons, shielding, and armor technologies scale combat stats by 10% per level.
- Rapidfire uses the same deterministic random stream as the contract. Small shot counts expand exact rapidfire chains; large shot counts use the same bounded deterministic sampling as the onchain implementation to stay gas-bounded.
- ACS attack is represented by the primary attack group plus one joined attack group.
- ACS defend and intercept are represented by one counterplay ship group on the defender side.
- Ship losses create 30% metal/crystal debris. Defense losses do not create debris and 70% of destroyed defenses are repaired after the battle.

The parity fixture suite compares onchain battle events, stored debris, ship
survivors, defense repairs, ACS joined/counterplay survivors, and the large-stack
rapidfire approximation against this model. When a fixture fails, the assertion
label identifies the drifted mechanic: outcome, rounds, losses, debris, or a
specific survivor inventory.
