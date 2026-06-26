# Concepts And Mechanics

## Planets And Coordinates

Planets live at `galaxy:system:position`. A settled player starts with a home planet and can add colonies through Colonize missions. Planet slots affect fields, temperature, and resource bias.

Fields limit how many building levels can fit on a body. Terraformer and Lunar Base add fields where applicable.

## Moons

Moons are separate bodies attached to planets. They have their own resources, ships, defenses, buildings, fields, and Jump Gate state. Moon fleets can use moon resources and moon ship inventory. Jump Gates move moon fleets only and do not carry resources.

In the current testnet, moons may also be granted by burning eligible Burning Chicken NFTs through the Moon page. The UI verifies the typed Chicken ID is owned by the connected wallet on Base mainnet before opening the burn transaction. The app waits for indexed Veydrift state before showing the moon. Accounts are limited to two Chicken-granted moons.

## Resources And Queues

Spending starts immediately when a build, defense, ship, or research transaction is indexed. Completion either finishes through the explicit action or through lazy settlement inside later relevant actions when the contract supports it.

| Queue | Scope | Examples |
| --- | --- | --- |
| Main production | Per planet or moon body | Buildings, ships, defenses |
| Research | Per player | Technologies |
| Missions | Fleet route | Attack, Transport, Deploy, Harvest, Colonize, Missile, ACS |

## Combat

Combat compares attacker ships, defender ships, stationed defenders, and static defenses. Battle reports show outcome, loot, losses, debris, and participants when known.

Combat uses attack, shield, and hull stats. Weapons Technology scales attack. Shielding Technology scales shields. Armor Technology scales hull. Shields refresh each round. Damaged hull can explode during battle. Some units have rapidfire where cataloged by the combat engine.

Destroyed ships create debris. Defense repair is applied after battle according to contract rules.

## Loot And Debris

Attack loot is capped by available cargo after fuel. The app previews lootable resources and lets you choose a metal/crystal/deuterium loot ratio. A practical raid needs enough cargo and fuel after the selected speed and route.

Harvest missions use recyclers to collect debris. Recycler cargo capacity and route fuel determine how much debris can be recovered.

## Protection, Bashing, And Inactive State

Attack protection prevents invalid or abusive launches. The backend reports protection status for the current target.

| Rule | Effect |
| --- | --- |
| New or low-score protection | Blocks attacks when the score ratio is outside allowed bounds. |
| Same alliance | Blocks hostile attacks against current allies. |
| Bashing window | Tracks repeated attacks by attacker, defender, and planet in the 24 hour window. |
| Inactive defender | May remove some protection gates when the indexed player activity marks the defender inactive. |

## Alliances And ACS Defend

Alliances support invitations, membership, and coordinated action. ACS Defend lets allied fleets station at a defended planet until a hostile attack arrives. Holding fuel is based on fleet composition and hold time. Alliance Depot support can cover part of that fuel from the defended planet's depot level.

## Rankings And Highscore

Rankings are indexed from public game state. Scores cover economy, research, fleet, defense, and protection-relevant totals. Rankings also surface attackability context such as protection and inactive state where available.
