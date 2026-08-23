# Veydrift Documentation

GitHub: https://github.com/Borodutch/veydrift

Use this guide in order if you are new: **Beginner Tutorial**, **Concepts And Mechanics**, **Action Mechanics**, then **Formulas**. The in-app catalogs remain the quickest source for your current levels, costs, prerequisites, and availability.

## Beginner Tutorial

### What Veydrift Is

Veydrift is an onchain space strategy game. You grow planets, manage resources, unlock research, build fleets and defenses, and use missions to expand, raid, defend, transport, deploy, harvest debris, and colonize.

Every important game action is a transaction. The frontend waits for the receipt and then for the exact indexed transaction or expected state change. Wait for the app to report success before sending another action that depends on the result.

### Connect And Settle

1. Open the app and connect a wallet on Base.
2. If the wallet has no planet, use the settlement flow to claim a home planet.
3. Wait for the app to show your planet coordinates, resources, and starting infrastructure.
4. Use the planet selector when you own multiple planets or switch between planet and moon bodies.

### Read Resources

Resources are Metal, Crystal, and Deuterium. The top bar and page panels show backend-indexed current values, including uncollected production when the backend can calculate it.

| Resource | Main use | Early priority |
| --- | --- | --- |
| Metal | Mines, ships, defenses, storage | High |
| Crystal | Research, ships, defenses, storage | High |
| Deuterium | Research, fleet fuel, advanced builds | Medium |

Energy is not a stored spendable resource. Mines need energy to operate at full output. If production needs more energy than you produce, mine output is scaled down.

### Data Freshness

The blockchain is authoritative, while the app reads a fast event-sourced index. A confirmed wallet receipt can appear before the corresponding indexed balance, queue, fleet, or report.

Veydrift routes backend reads through one shared game-state store and priority scheduler. It retains last-good indexed responses with freshness, revision, and last-update metadata; coalesces duplicate reads; cancels stale navigation/filter generations; and propagates shared refreshes to subscribed screens. The frontend is a light client: it reads indexed backend state and never asks the browser to reconcile chain state. The top bar, Overview, Mission Control, Rankings, Raid Finder, Galaxy, and planet/moon detail read the same stored responses; planet-section models are limited to derived universe render projections.

Resource-changing transactions include their final authoritative balances in contract events. This includes building and production spending, transport or deploy arrival, fleet-return cargo, raid loot, deposits, colonies, settlement, and Rift resource movement. When the backend indexes one of those events, the affected view projections refresh immediately; periodic polling remains a recovery path.

If a transaction is confirmed but the app still says it is indexing, do not assume the displayed old balance is spendable. Check the backend health or retry the refresh. The app deliberately does not invent optimistic resource balances.

### First Infrastructure

Build early mines and power in small steps:

1. Upgrade Metal Mine and Crystal Mine first.
2. Add Solar Plant when energy gets tight.
3. Add Deuterium Synthesizer when research and fleet fuel need it.
4. Build Robotics Factory to shorten construction time.
5. Build Research Lab and Shipyard when you are ready to unlock new actions.

Only one main production queue can run on a planet at a time for building and ship/defense production. Research uses its own research queue.

### Research, Ships, And Defenses

Research unlocks ships, defenses, drives, fleet slots, combat scaling, planet count, and advanced systems. Start with Energy, Combustion Drive, Computer Technology, and the combat technologies needed for your next hulls.

Shipyard builds ships and most defenses. Ships can move in missions. Defenses stay on the body where they are built. Missiles use Missile Silo capacity and follow missile-specific rules.

### First Missions

Open Galaxy or Raid Finder to choose a target. The mission composer previews route, speed, fuel, cargo, and blockers.

| Mission | What it changes |
| --- | --- |
| Attack | Sends combat ships to fight, grab loot, and create debris from destroyed units. |
| Transport | Moves resources to another owned or target planet without replacing your origin fleet. |
| Deploy | Moves ships and cargo to another owned planet. |
| Harvest | Sends recyclers to collect debris. |
| Colonize | Uses a colony ship to settle a new planet slot. |
| Missile | Fires interplanetary missiles at a target planet's defenses. |
| ACS Attack | Lets allied fleets join an attack group when available. |
| ACS Defend | Stations allied defense at a target until the hostile attack lands or the hold expires. |

Mission arrivals and returns normally settle automatically. If a mission stays **Resolving** for at least 60 seconds, a **Resolve** button appears beside that status. Any connected player can submit this permissionless fallback, which keeps missions moving if the funded resolver wallet is unavailable. Combat missions waiting for randomness show **Awaiting randomness** instead and cannot be resolved yet.

### Common Mistakes

- Do not send all cargo capacity as resources. Fuel is deducted from available cargo.
- Do not start a dependent action until the app reports that the confirmed transaction is indexed.
- Do not build only mines without energy. Underpowered mines produce less.

## Concepts And Mechanics

### Planets And Coordinates

Planets live at `galaxy:system:position`. A settled player starts with a home planet and can add colonies through Colonize missions. Planet slots affect fields, temperature, and resource bias.

Fields limit how many building levels can fit on a body. Terraformer and Lunar Base add fields where applicable.

### Moons

Moons are separate bodies attached to planets. They have their own resources, ships, defenses, buildings, fields, and Jump Gate state. Moon fleets can use moon resources and moon ship inventory. Jump Gates move moon fleets only and do not carry resources.

Moons may also be granted by burning Burning Chicken NFTs through the Moon page. The UI verifies the typed Chicken ID is owned by the connected wallet on Base mainnet before opening the burn transaction. The app waits for indexed Veydrift state before showing the moon. Any Chicken NFT can be burned for a moon at any planet.

### Resources And Queues

Spending starts immediately when a build, defense, ship, or research transaction is indexed. Completion either finishes through the explicit action or through lazy settlement inside later relevant actions when the contract supports it.

| Queue | Scope | Examples |
| --- | --- | --- |
| Main production | Per planet or moon body | Buildings, ships, defenses |
| Research | Per player | Technologies |
| Missions | Fleet route | Attack, Transport, Deploy, Harvest, Colonize, Missile, ACS |

### Combat

Combat compares attacker ships, defender ships, stationed defenders, and static defenses. Battle reports show outcome, loot, losses, debris, and participants when known.

Combat uses attack, shield, and hull stats. Weapons Technology scales attack. Shielding Technology scales shields. Armor Technology scales hull. Shields refresh each round. Damaged hull can explode during battle. Some units have rapidfire where cataloged by the combat engine.

Destroyed ships create debris. Defense repair is applied after battle according to contract rules.

### Loot And Debris

Attack loot is capped by available cargo after fuel. The app previews lootable resources and lets you choose a metal/crystal/deuterium loot ratio. A practical raid needs enough cargo and fuel after the selected speed and route.

Harvest missions use recyclers to collect debris. Recycler cargo capacity and route fuel determine how much debris can be recovered.

### Protection, Bashing, And Inactive State

Attack protection prevents invalid or abusive launches. The backend reports protection status for the current target.

| Rule | Effect |
| --- | --- |
| New or low-score protection | Below 50,000 score, attacks are limited to a 1.5× gap. From 50,000 to 499,999, the limit is 10×. |
| Same alliance | Blocks hostile attacks against current allies. |
| Bashing window | Tracks repeated attacks by attacker, defender, and planet in the 24 hour window. |
| Inactive defender | May remove some protection gates when the indexed player activity marks the defender inactive. |

### Alliances And ACS Defend

Alliances support invitations, membership, and coordinated action. ACS Defend lets allied fleets station at a defended planet until a hostile attack arrives. Holding fuel is based on fleet composition and hold time. Alliance Depot support can cover part of that fuel from the defended planet's depot level.

### Rankings And Highscore

Rankings are indexed from public game state. Scores cover economy, research, fleet, defense, and protection-relevant totals. Rankings also surface attackability context such as protection and inactive state where available.

## Catalogs

All costs are base costs before level scaling unless noted.

### Infrastructure Buildings

| Building | Base cost | Effect |
| --- | --- | --- |
| Metal Mine | 60 metal, 15 crystal | Produces metal. |
| Crystal Mine | 48 metal, 24 crystal | Produces crystal. |
| Deuterium Synth | 225 metal, 75 crystal | Produces deuterium, affected by planet temperature. |
| Solar Plant | 75 metal, 30 crystal | Produces energy. |
| Robotics Factory | 400 metal, 120 crystal, 200 deuterium | Speeds building construction. |
| Shipyard | 400 metal, 200 crystal, 100 deuterium | Builds ships and defenses. |
| Research Lab | 200 metal, 400 crystal, 200 deuterium | Unlocks and speeds research. |
| Metal Storage | 1,000 metal | Raises metal storage cap. |
| Crystal Storage | 1,000 metal, 500 crystal | Raises crystal storage cap. |
| Deuterium Tank | 1,000 metal, 1,000 crystal | Raises deuterium storage cap. |
| Fusion Reactor | 900 metal, 360 crystal, 180 deuterium | Produces energy and consumes deuterium production. |
| Nanite Factory | 1,000,000 metal, 500,000 crystal, 100,000 deuterium | Multiplies construction and production speed. |
| Terraformer | 50,000 crystal, 100,000 deuterium | Adds planet fields. |
| Alliance Depot | 20,000 metal, 40,000 crystal | Supports ACS Defend holding fuel. |
| Missile Silo | 20,000 metal, 20,000 crystal, 1,000 deuterium | Stores anti-ballistic and interplanetary missiles. |
| Rift Stabilizer | 8,000 metal, 8,000 crystal, 4,000 deuterium | Enables rift features where available. |

### Research

| Research | Base cost | Requirements | Effect |
| --- | --- | --- | --- |
| Energy Technology | 800 crystal, 400 deuterium | Research Lab 1 | Improves fusion energy and unlocks energy systems. |
| Laser Technology | 200 metal, 100 crystal | Research Lab 1, Energy 2 | Unlocks laser units and later tech. |
| Ion Technology | 1,000 metal, 300 crystal, 100 deuterium | Research Lab 4, Energy 4, Laser 5 | Unlocks ion systems. |
| Combustion Drive | 400 metal, 600 deuterium | Research Lab 1, Energy 1 | Speeds combustion ships. |
| Impulse Drive | 2,000 metal, 4,000 crystal, 600 deuterium | Research Lab 2, Energy 1 | Speeds impulse ships. |
| Hyperspace Drive | 10,000 metal, 20,000 crystal, 6,000 deuterium | Research Lab 7, Hyperspace 3 | Speeds hyperspace ships. |
| Computer Technology | 400 crystal, 600 deuterium | Research Lab 1 | Adds fleet slots. |
| Weapons Technology | 800 metal, 200 crystal | Research Lab 4 | Adds 10% attack per level. |
| Shielding Technology | 200 metal, 600 crystal | Research Lab 6, Energy 3 | Adds 10% shield per level. |
| Armor Technology | 1,000 metal | Research Lab 2 | Adds 10% hull per level. |
| Hyperspace Technology | 4,000 crystal, 2,000 deuterium | Research Lab 7, Energy 5, Shielding 5 | Unlocks advanced hulls and systems. |
| Plasma Technology | 2,000 metal, 4,000 crystal, 1,000 deuterium | Research Lab 4, Energy 8, Laser 10, Ion 5 | Unlocks plasma turrets and improves advanced economy. |
| Astrophysics | 4,000 metal, 8,000 crystal, 4,000 deuterium | Research Lab 3, Impulse Drive 3 | Raises colony capacity. |
| Intergalactic Research Network | 240,000 metal, 400,000 crystal, 160,000 deuterium | Research Lab 10, Computer 8, Hyperspace 8 | Links high-level labs for research speed. |
| Graviton Technology | No resource cost | Research Lab 12, 300,000 produced energy | Unlocks Dreadstar construction. |

### Ships

| Ship | Base cost | Requirements | Cargo | Fuel | Combat |
| --- | --- | --- | ---: | ---: | --- |
| Small Cargo | 2,000 metal, 2,000 crystal | Shipyard 2, Combustion 2 | 5,000 | 10 | 5 attack, 10 shield, 400 hull |
| Light Fighter | 3,000 metal, 1,000 crystal | Shipyard 1, Combustion 1 | 50 | 20 | 50 attack, 10 shield, 400 hull |
| Recycler | 10,000 metal, 6,000 crystal, 2,000 deuterium | Shipyard 4, Combustion 6, Shielding 2 | 20,000 | 300 | 1 attack, 10 shield, 1,600 hull |
| Colony Ship | 10,000 metal, 20,000 crystal, 10,000 deuterium | Shipyard 4, Impulse 3 | 7,500 | 1,000 | 50 attack, 100 shield, 3,000 hull |
| Large Cargo | 6,000 metal, 6,000 crystal | Shipyard 4, Combustion 6 | 25,000 | 50 | 5 attack, 25 shield, 1,200 hull |
| Heavy Fighter | 6,000 metal, 4,000 crystal | Shipyard 3, Impulse 2, Armor 2 | 100 | 75 | 150 attack, 25 shield, 1,000 hull |
| Cruiser | 20,000 metal, 7,000 crystal, 2,000 deuterium | Shipyard 5, Impulse 4, Ion 2 | 800 | 300 | 400 attack, 50 shield, 2,700 hull |
| Battleship | 45,000 metal, 15,000 crystal | Shipyard 7, Hyperspace Drive 4 | 1,500 | 500 | 1,000 attack, 200 shield, 6,000 hull |
| Bomber | 50,000 metal, 25,000 crystal, 15,000 deuterium | Shipyard 8, Impulse 6, Plasma 5 | 500 | 1,000 | 1,000 attack, 500 shield, 7,500 hull |
| Solar Satellite | 2,000 crystal, 500 deuterium | Shipyard 1 | 0 | 0 | Fragile stationary energy unit |
| Destroyer | 60,000 metal, 50,000 crystal, 15,000 deuterium | Shipyard 9, Hyperspace Drive 6, Hyperspace 5 | 2,000 | 1,000 | 2,000 attack, 500 shield, 11,000 hull |
| Dreadstar | 5,000,000 metal, 4,000,000 crystal, 1,000,000 deuterium | Shipyard 12, Hyperspace Drive 7, Hyperspace 6, Graviton 1 | 1,000,000 | 1 | 200,000 attack, 50,000 shield, 900,000 hull |
| Battlecruiser | 30,000 metal, 40,000 crystal, 15,000 deuterium | Shipyard 8, Hyperspace Drive 5, Hyperspace 5, Laser 12 | 750 | 250 | 700 attack, 400 shield, 7,000 hull |
| Reaper | 85,000 metal, 55,000 crystal, 20,000 deuterium | Shipyard 10, Hyperspace Drive 7, Hyperspace 6, Shielding 6, Energy 5 | 7,000 | 1,000 | 2,800 attack, 700 shield, 14,000 hull |
| Crawler | 2,000 metal, 2,000 crystal, 1,000 deuterium | Shipyard 5, Combustion 4, Armor 4, Laser 4 | 0 | 0 | Stationary mine booster |

### Defenses And Missiles

| Defense | Base cost | Requirements | Notes |
| --- | --- | --- | --- |
| Rocket Launcher | 2,000 metal | Shipyard 1 | 80 attack, 20 shield, 200 hull |
| Light Laser | 1,500 metal, 500 crystal | Shipyard 2, Energy 1, Laser 3 | 100 attack, 25 shield, 200 hull |
| Heavy Laser | 6,000 metal, 2,000 crystal | Shipyard 4, Energy 3, Laser 6 | 250 attack, 100 shield, 800 hull |
| Small Shield Dome | 10,000 metal, 10,000 crystal | Shipyard 1, Shielding 2 | One per planet or moon body |
| Gauss Cannon | 20,000 metal, 15,000 crystal, 2,000 deuterium | Shipyard 6, Energy 6, Weapons 3, Shielding 1 | 1,100 attack, 200 shield, 3,500 hull |
| Ion Cannon | 2,000 metal, 6,000 crystal | Shipyard 4, Ion 4 | 150 attack, 500 shield, 800 hull |
| Plasma Turret | 50,000 metal, 50,000 crystal, 30,000 deuterium | Shipyard 8, Plasma 7 | 3,000 attack, 300 shield, 10,000 hull |
| Large Shield Dome | 50,000 metal, 50,000 crystal | Shipyard 6, Shielding 6 | One per planet or moon body |
| Anti-Ballistic Missile | 8,000 metal, 2,000 deuterium | Shipyard 1, Missile Silo 2 | Intercepts incoming missiles; uses one silo slot |
| Interplanetary Missile | 12,500 metal, 2,500 crystal, 10,000 deuterium | Shipyard 1, Missile Silo 4, Impulse 1 | Attacks target defenses; uses two silo slots |

### Moon Structures

| Moon structure | Base cost | Effect |
| --- | --- | --- |
| Lunar Base | 20,000 metal, 40,000 crystal, 20,000 deuterium | Adds 3 moon fields when completed. |
| Moon Robotics Factory | 400 metal, 120 crystal, 200 deuterium | Speeds moon construction. |
| Moon Shipyard | 400 metal, 200 crystal, 100 deuterium | Builds moon ships and defenses. |
| Jump Gate | 2,000,000 metal, 4,000,000 crystal, 2,000,000 deuterium | Moves ships between owned moons, subject to cooldown. |

## Action Mechanics

### Build Infrastructure

Starting a building upgrade spends the required resources, records the target level and ready time, and occupies the main queue. When the ready time has passed, the upgrade can be completed or lazily settled by a later relevant action.

### Start Research

Starting research spends resources from the active research planet context and occupies the research queue. The completed level affects every planet for that player.

### Build Ships And Defenses

Shipyard production spends resources, queues the quantity, and completes into the selected planet or moon inventory. Defenses stay on the body. Ships become available for missions from that body.

### Launch Attack

Attack debits ships and fuel from the origin, creates an outbound mission, resolves combat at arrival, records loot and debris, and returns survivors with cargo. The target state, protection gates, bashing window, fleet inventory, fuel, and cargo are checked before launch.

### Launch Transport

Transport debits selected resources and fuel from origin, sends ships to the target, credits resources on arrival, and returns ships to origin when the return leg completes.

### Launch Deploy

Deploy moves selected ships and cargo from one owned body to another. After arrival, the destination owns the fleet and cargo. Deploy is the normal way to reposition ships between owned planets or moons.

### Launch Harvest

Harvest sends recyclers to a debris field. On arrival, recyclers collect metal and crystal debris up to available cargo, then return with the collected resources.

### Launch Colonize

Colonize spends a colony ship and sends it to a target slot. If the slot is valid and the player has colony capacity, arrival creates a new planet and the colony ship is consumed.

### Launch Missile

Missile attacks are immediate contract actions, not fleet missions: they use no ships, fuel, fleet slot, travel time, or return flight. The origin and target must be in the same galaxy. With Impulse Drive level `d`, the exact maximum system distance is `5 × d − 1`; level 0 has no missile range.

Choose a normal defense as the primary target (Rocket Launcher through Large Shield Dome). Anti-Ballistic Missiles and Interplanetary Missiles cannot be selected as targets. The contract first consumes `min(target anti-ballistic missiles, missiles launched)` anti-ballistic missiles; each intercepts exactly one incoming missile. Every remaining hit removes one unit of the selected primary defense, capped by that defense's current count. Missile results are indexed immediately and appear in Mission Control's **Missile strikes** history.

### ACS Attack

ACS Attack lets additional allied fleets join an existing attack group when the join window and route rules allow it. Joined fleets resolve with the main attack and receive their share of outcome state.

### ACS Defend

ACS Defend stations an allied fleet at the defended planet until the hostile attack lands or the hold is otherwise reconciled. Holding fuel is computed from fleet fuel, hold time, and Alliance Depot support. Stationed defenders participate in combat while present.

### Moon Actions

Moon buildings and defenses use moon resources and moon queues. Jump Gate transfers move moon ships between owned moons after both gates are ready. For Chicken moon grants, the user types a Chicken ID, the app verifies ownership on Base mainnet, sends the burn, and waits for indexed moon state.

## Formulas

This page lists the formulas exposed by the app and backend. `floor` rounds down, `ceil` rounds up, and bps means basis points where `10,000 bps = 100%`.

### Cost Scaling

```text
building cost = base cost * building factor ^ current level
standard research cost = base cost * 2 ^ current level
advanced 1.75 research cost = round each resource to nearest 100 after base * 1.75 ^ current level
```

Binary buildings such as Rift Stabilizer use their base cost and do not scale past the enabled level.

### Production

Production is measured in whole resource units per hour. For a mine at level `L`,
the contract first calculates its raw per-level output and rounds down:

```text
scaled level value(base, L) = floor(base * L * 11 ^ L / 10 ^ L), or 0 at L = 0
raw metal per hour = floor(scaled level value(30, metal level) * metal multiplier bps / 10,000)
raw crystal per hour = floor(scaled level value(20, crystal level) * crystal multiplier bps / 10,000)
raw deuterium per hour = floor(scaled level value(10, deuterium level) * deuterium multiplier bps / 10,000)
metal multiplier bps = 10,000
crystal multiplier bps = 10,000
deuterium multiplier bps = max(0, 12,800 - 20 * planet maximum temperature in °C)
```

Mine level tables and building detail cards show these raw values. They do not
include crawlers, Fusion Reactor upkeep, energy shortage scaling, or Solar
Satellite effects.

The resource top bar and its Resources popup show live effective production
from the backend's canonical contract-derived model. The contract applies the
live modifiers in this order, rounding down after every basis-point scaling:

```text
crawler boost bps = min(effective crawlers * 2, 5,000)
effective crawlers = min(crawler count, 8 * (metal level + crystal level + deuterium level))
boosted mine output = floor(raw mine output * (10,000 + crawler boost bps) / 10,000)
fusion deuterium upkeep = ceil(10 * fusion level * 11 ^ fusion level / 10 ^ fusion level)
post-upkeep deuterium = max(0, boosted deuterium - fusion deuterium upkeep)
live effective output = floor(post-boost output * energy scale bps / 10,000)
```

For Metal and Crystal, `post-boost output` is the boosted mine output. For
Deuterium it is the post-upkeep value. If energy production is sufficient, the
energy scale is 10,000 bps and output is not reduced.

### Energy

```text
metal mine demand = scaled level value(10, metal level)
crystal mine demand = scaled level value(10, crystal level)
deuterium synthesizer demand = scaled level value(20, deuterium level)
required energy = metal mine demand + crystal mine demand + deuterium synthesizer demand
solar plant energy = scaled level value(20, solar plant level)
fusion reactor energy = floor(30 * fusion level * (105 + Energy Technology level) ^ fusion level / 100 ^ fusion level)
Solar Satellite energy total = Solar Satellite count * energy per Satellite
produced energy = solar plant energy + fusion reactor energy + Solar Satellite energy total
energy scale bps = 10,000 when produced >= required, otherwise floor(produced * 10,000 / required)
Solar Satellite energy per Satellite = clamp(truncate-toward-zero((maximum temperature + 140) / 6), 1, 65)
```

Solar Satellites therefore change live resource production only by contributing
to the energy balance. They never change the raw mine values shown in building
details.

### Storage And Fields

Storage buildings increase their resource caps by level. If production would exceed a cap, settlement caps the resource at that cap. Buildings consume one field per level. Terraformer adds planet fields. Lunar Base adds 3 moon fields per completed level.

### Construction, Research, Ship, And Defense Time

```text
building seconds = max(min queue seconds, floor((metal + crystal) * 3600 / (2500 * (robotics + 1) * 2 ^ nanite * universe speed)))
research seconds = max(min queue seconds, floor((metal + crystal) * 3600 / (1000 * (research lab + 1) * universe speed)))
ship or defense seconds = max(min queue seconds, ceil((metal + crystal) * quantity * 3600 / (2500 * (shipyard + 1) * 2 ^ nanite * universe speed)))
```

Intergalactic Research Network links the highest eligible lab levels for research speed where backend state provides linked lab levels.

### Flight Distance, Speed, And Time

```text
same planet distance = 0 (except same-planet Harvest, which uses local distance 5)
same system distance = 1000 + 5 * position difference
same galaxy distance = 2700 + 95 * system difference
different galaxy distance = 20000 * galaxy difference
travel seconds = 10 + floor(floor(350 * sqrt(distance * 10 / slowest ship speed)) * 100 / (mission speed percent * universe speed))
```

Mission speed options are `100, 90, 80, 70, 60, 50, 40, 30, 20, 10`.

### Fuel And Cargo

```text
ship fuel term = quantity * ship fuel * distance * (1 + effective speed / 100) ^ 2
mission fuel = 1 + floor(sum(ship fuel terms) / 35000 + 0.5)
available cargo = total ship cargo - mission fuel
```

Attack loot is limited by available cargo and the target's plunderable resources. Harvest coverage is limited by recycler cargo after fuel.

### Combat

```text
effective attack = base attack * (1 + weapons level * 10%)
effective shield = base shield * (1 + shielding level * 10%)
effective hull = base hull * (1 + armor level * 10%)
combat preview power = effective attack + effective shield + floor(effective hull / 10)
rounds = at most 6
targeted units = min(target unit count, assigned shots)
shots per target = ceil(assigned shots / targeted units)
damage = effective attack * shots per target
no loss if effective attack <= effective shield / 100
no loss if damage <= effective shield
hull damage = damage - effective shield
destroyed immediately if hull damage >= effective hull
explosion chance bps = floor(hull damage * 10,000 / effective hull) when hull damage > 30% hull
normal defense repair = floor(destroyed defenses * 70 / 100)
small or large shield dome repair = 70% chance to repair one destroyed dome
debris metal = floor((attacker metal losses + defender metal losses) * 30 / 100)
debris crystal = floor((attacker crystal losses + defender crystal losses) * 30 / 100)
```

Each surviving unit fires once per round before round losses are applied. Shots are distributed across the opposing side by live unit counts. If 100 shots fire into a defender with 80 Rocket Launchers and 20 Light Lasers, about 80 shots target Rocket Launchers and 20 target Light Lasers, with deterministic randomness deciding the remainder. Shields refresh every round, so damage does not carry over between rounds unless it destroys a unit in that round.

### Rapidfire Reference

Rapidfire can create extra shots after the normal shot assignment. A rapidfire factor `R` is **not** a guaranteed `R` shots: every selected shot against an eligible target has a continue chance of `(R - 1) / R` and a stop chance of `1 / R`. An omitted attacker-to-target pair has factor `1` and creates no rapidfire shots. Only ships can generate rapidfire; defenses do not have rapidfire as firing units.

The onchain catalog follows Veydrift's full classic rapidfire matrix, with the Reaper, Pathfinder, and Crawler extensions. Veydrift does not have Espionage Probes, so their probe-only lanes are not represented. All omitted pairs are factor `1`.

| Attacker ship | Target ship | Factor `R` |
| --- | --- | ---: |
| Small Cargo, Light Fighter, Recycler, Colony Ship, Large Cargo, Heavy Fighter, Cruiser, Battleship, Bomber, Destroyer, Battlecruiser, Reaper, Pathfinder | Solar Satellite | 5 |
| Same mobile ships | Crawler | 5 |
| Heavy Fighter | Small Cargo | 3 |
| Cruiser | Light Fighter | 6 |
| Battleship | Pathfinder | 5 |
| Destroyer | Battlecruiser | 2 |
| Battlecruiser | Small Cargo, Large Cargo | 3 |
| Battlecruiser | Heavy Fighter, Cruiser | 4 |
| Battlecruiser | Battleship | 7 |
| Reaper | Battleship | 7 |
| Reaper | Bomber | 4 |
| Reaper | Destroyer | 3 |
| Pathfinder | Light Fighter, Cruiser | 3 |
| Pathfinder | Heavy Fighter | 2 |
| Dreadstar | Small Cargo, Large Cargo, Recycler, Colony Ship | 250 |
| Dreadstar | Light Fighter | 200 |
| Dreadstar | Heavy Fighter | 100 |
| Dreadstar | Cruiser | 33 |
| Dreadstar | Battleship | 30 |
| Dreadstar | Bomber | 25 |
| Dreadstar | Destroyer | 5 |
| Dreadstar | Battlecruiser | 15 |
| Dreadstar | Reaper | 10 |
| Dreadstar | Pathfinder | 30 |
| Dreadstar | Solar Satellite, Crawler | 1,250 |

| Attacker ship | Target defense | Factor `R` |
| --- | --- | ---: |
| Cruiser | Rocket Launcher | 10 |
| Bomber | Rocket Launcher, Light Laser | 20 |
| Bomber | Heavy Laser, Ion Cannon | 10 |
| Bomber | Gauss Cannon, Plasma Turret | 5 |
| Destroyer | Light Laser | 10 |
| Dreadstar | Rocket Launcher, Light Laser | 200 |
| Dreadstar | Heavy Laser, Ion Cannon | 100 |
| Dreadstar | Gauss Cannon | 50 |
| Reaper | Ion Cannon | 2 |

In particular, Solar Satellites and Crawlers are targetable, fragile production units rather than rapidfire-proof defensive screens: every mobile ship can chain through them at factor `5`, and a Dreadstar has factor `1,250`.

For an ideal chain that stays on eligible targets, the unbounded expected number of shots, including the original shot, is `R`. The contract limits rapidfire to 64 extra-shot chain steps, so that ideal capped expectation is `R * (1 - ((R - 1) / R)^65)`. In a real mixed defender pool, that expectation is not a promise: every chain step retargets by the live target counts and applies deterministic integer rounding.

#### Exact Onchain Rapidfire Math

The contract works in basis points (`BPS = 10,000`) and has `MAX_RAPIDFIRE_CHAIN = 64`. Let `I_k` be the incoming shots for chain step `k`, `n_t` the live count of target bucket `t`, and `N` the number of live target units in the full opposing pool. For every target bucket with factor `R > 1`:

```text
I_0 = normal shots assigned to the firing ship

weighted_t = I_k * n_t
assigned_t = floor(weighted_t / N)
           + 1 when combatHash(seed, round, side, firing unit, target lane + (k + 1) * 8192) mod N
             < weighted_t mod N

continueBps = floor((R - 1) * 10,000 / R)
scaled_t = assigned_t * continueBps
extra_t = floor(scaled_t / 10,000)
        + 1 when combatHash(seed, round, side, firing unit, target lane, 30,000 + k) mod 10,000
          < scaled_t mod 10,000

I_(k + 1) = sum(extra_t for every live eligible target bucket)
total extra shots = sum(I_(k + 1)) for k = 0..63
```

`combatHash(seed, round, side, firing unit, target lane, stream)` is exactly `uint256(keccak256(abi.encode(keccak256("veydrift.classic-combat-random-stream.v1"), seed, round, side, firing unit, target lane, stream)))`.

The battle engine then applies each generated shot with the same attack, shield, hull, and explosion rules as normal shots. A bucket with no live units, no incoming shots, or factor `1` produces zero extra shots. The deterministic combat hash means the same indexed battle seed and state produce the same rapidfire result; it is not wallet- or UI-generated randomness.

Combat example:

```text
Attacker: 1 Cruiser, Weapons 0
Defender: 10 Rocket Launchers, Shielding 0, Armor 0

Cruiser attack = 400
Rocket Launcher shield = 20
Rocket Launcher hull = (2,000 metal + 0 crystal) / 10 = 200

Round 1 normal shots:
1 Cruiser fires 1 shot.
All 10 defender units are Rocket Launchers, so the shot targets a Rocket Launcher.
damage = 400
damage > shield, hull damage = 400 - 20 = 380
380 >= 200 hull, so 1 Rocket Launcher is destroyed.

Rapidfire:
Cruiser has rapidfire 10 against Rocket Launcher.
The selected shot has a 90% chance to add another shot.
If that extra shot occurs, it can destroy another Rocket Launcher using the same damage math.

Defender fire:
The round snapshot fires before losses are applied, so all 10 Rocket Launchers still fire in round 1.
Each Rocket Launcher has attack 80. Their assigned shots target the Cruiser.
Cruiser shield = 50; Cruiser hull = (20,000 metal + 7,000 crystal) / 10 = 2,700.
Each launcher shot deals 80, so each shot passes shield but only deals 30 hull damage.
30 is below 30% of Cruiser hull, so no explosion check happens from a single launcher shot.

After the round:
Destroyed Rocket Launchers are removed, then 70% of destroyed normal defenses repair after battle.
If 2 Rocket Launchers were destroyed and the defender does not win earlier, floor(2 * 70 / 100) = 1 repairs.
```

### Protection, Bashing, And Alliance Wars

Score uses the same contract formula for ranking and attack protection: economy, research, fleet, and defense components are indexed into one player score. Below 50,000 score, players are protected from opponents more than 1.5× stronger or weaker. From 50,000 through 499,999, the limit is 10×; at 500,000 and above, score protection does not apply. The bashing window is evaluated by attacker, defender, and planet over 24 hours.

When an alliance declares war, the contract snapshots both alliance total scores and both rosters. Only members in those original rosters receive war exceptions; leaving removes the exception while outside the alliance, and rejoining that same original alliance restores it. If the declaring alliance was weaker or equal at declaration, both original rosters bypass score protection and bashing limits. If it was stronger but no more than 1.5× the declared-on alliance, both original rosters also bypass both limits. If it was more than 1.5× stronger, only original members of the declared-on alliance can bypass score protection and bashing limits when attacking the declaring alliance. An active-war target is marked for verification in target lists; before Confirm is enabled, the mission screen checks the selected attacker, target, frozen roster, and direction against the live war snapshot and explains when normal protection still applies.

### Moon Chance And Jump Gates

```text
moon chance bps = min(floor((metal debris + crystal debris) / 100000) * 100, 2000)
moon destruction bps = min((100 - floor(sqrt(moon diameter km))) * floor(sqrt(dreadstars)) * 100, 10000)
dreadstar destruction bps = min(floor(sqrt(moon diameter km)) * 50, 10000)
```

Jump Gate transfers require both origin and destination moons to have a Jump Gate. A transfer moves ships only, carries no resources, and sets a cooldown on both gates.
