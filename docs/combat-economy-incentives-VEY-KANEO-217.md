# VEY-KANEO-217 Combat Economy Incentives

Date: 2026-05-28

This decision note records the current Veydrift combat economy pass. The goal is
not exact classic OGame parity; the goal is a contract-enforced incentive model
that stays useful on public onchain state and testnet deployments.

## Selected Values

| Surface | Selected Veydrift value | Decision |
| --- | --- | --- |
| Fleet debris | 30% of destroyed metal and crystal value, no deuterium debris | Keep |
| Defense repair | 70% of destroyed battlefield defenses return after combat | Keep |
| Space Dock recovery | Level 1 starts at 21% repairable ships, +1 percentage point per level, capped at 50%; wreckage requires at least 150,000 destroyed ship value and expires after 3 days | Keep |
| Moon chance | 1% per 100,000 metal+crystal debris, capped at 20%; existing moons record a skip instead of rerolling | Keep |
| Raid loot | 50% normal, 75% honorable, 100% bandit, limited by committed cargo | Keep |
| Cargo-limited loot order | Metal first, then crystal, then deuterium | Keep for testnet |
| Bashing | 6 attacks per attacker/defender/planet per 24 hours; war and inactive defenders bypass the limit | Keep |
| Score protection | Low-score ratio gates block asymmetric attacks unless war/alliance or inactive exceptions apply | Keep |
| Fleet cost | Launch fuel is paid up front; recall pays an extra 25% of original launch fuel and does not refund launch fuel | Keep |
| ACS/intercept holding | Counterplay launches must arrive before the hostile attack and pay holding fuel, offset only by Alliance Depot support from the defended planet | Keep |

## Incentive Matrix

| Loop | Risk | Current control | Testnet decision |
| --- | --- | --- | --- |
| Self or same-owner farming | A player could recycle owned fleets into debris, moon chances, or Space Dock recovery. | Contract attack protection rejects attacks where the target planet owner is the attacker. Frontend also avoids exposing attack actions for owned occupied slots. | Mitigated. |
| Alt farming | Coordinated wallets can trade fleet losses for debris, moon chances, honor state, or reduced-risk testing. | Launch fuel, fleet travel time, bashing windows, score protection, cargo limits, Space Dock minimum wreckage, and Space Dock TTL all remain contract-side. | Accepted for testnet. Stronger identity or staking penalties would be a separate product layer. |
| Defense recycling | A defender could create cheap defenses to inflate attacker cost while most defense returns. | Defense repair is 70%, defenses do not create debris, missiles consume attacker inventory, and battle losses still expose the defender to loot if the attacker wins. | Accepted. The 70% repair rate preserves the intended defense role without making defense a resource farm. |
| Moon-shot farming | Players can coordinate large fleet losses to generate repeated moon rolls. | Chance is debris-proportional, capped at 20%, requires at least 100,000 debris, and existing moons cannot be rerolled. Self-attacks are blocked. | Accepted for testnet. Coordinated moon shots are expected gameplay, but not self-farmable through one wallet. |
| Space Dock and debris double recovery | Destroyed ships can create debris and also leave repairable Space Dock wreckage. | Debris returns only 30% metal/crystal, Space Dock returns ships rather than resources, Space Dock excludes Solar Satellites, requires 150,000 destroyed value, requires a Space Dock level, caps at 50%, and expires after 3 days. | Accepted. This intentionally softens defensive fleet losses while still leaving attacker recycler value. |
| Inactive farming | Inactive defenders bypass score protection and bashing limits. | Attackers still pay fuel/time, cargo caps still apply, and inactive status is based on contract activity age. | Accepted for testnet as a target-discovery and universe-cleanup incentive. |
| Player-protection abuse | Low-score players could shelter resources behind score gates. | Inactive defenders lose protection, war/alliance exceptions can opt into conflict, and public state makes resource concentration visible. | Accepted. This is the public-state substitute for hidden intel friction. |
| ACS griefing | Friendly defense could be stuffed into a battle at the last moment or made free. | ACS defend/intercept must arrive before the cutoff and pays travel plus holding fuel, with Alliance Depot support debited from the defended planet. | Mitigated. |

## Rationale

The selected values keep the classic combat anchors that matter for player
intuition: 30% debris, 70% defense repair, 20% maximum moon chance, and higher
loot against honorable or bandit targets. Veydrift then adds explicit public-state
counterweights where hidden espionage and uncertainty are not available:
contract-side score protection, bashing windows, public hostile mission state,
fuel/time commitment, and bounded Space Dock recovery.

No runtime constants were changed in this pass. The review found no single value
that was clearly exploitable after the same-owner attack block, bashing limits,
score protection, Space Dock eligibility gates, moon cap, and ACS holding fuel
were considered together. The remaining alt-farming and inactive-farming risks
are accepted for testnet and should be revisited only with a broader identity,
staking, or production anti-abuse design.
