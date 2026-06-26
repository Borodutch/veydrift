# Formulas

This page lists the formulas exposed by the app and backend. `floor` rounds down, `ceil` rounds up, and bps means basis points where `10,000 bps = 100%`.

## Cost Scaling

```text
building cost = base cost * building factor ^ current level
standard research cost = base cost * 2 ^ current level
advanced 1.75 research cost = round each resource to nearest 100 after base * 1.75 ^ current level
```

Binary buildings such as Rift Stabilizer use their base cost and do not scale past the enabled level.

## Production

```text
metal per hour = 30 * level * 1.1 ^ level * planet metal multiplier
crystal per hour = 20 * level * 1.1 ^ level * planet crystal multiplier
deuterium per hour = 10 * level * 1.1 ^ level * planet deuterium multiplier
crawler boost bps = min(effective crawlers * 2, 5,000)
effective crawlers = min(crawler count, 8 * (metal level + crystal level + deuterium level))
```

Fusion Reactor deuterium upkeep is subtracted from deuterium production. If required energy is greater than produced energy, all mine production is multiplied by `produced energy / required energy`.

## Energy

```text
required energy = metal mine demand + crystal mine demand + deuterium synthesizer demand
produced energy = solar plant energy + fusion reactor energy + solar satellite energy
energy scale bps = 10,000 when produced >= required, otherwise floor(produced * 10,000 / required)
solar satellite energy = floor((max temperature + 160) / 6)
```

## Storage And Fields

Storage buildings increase their resource caps by level. If production would exceed a cap, settlement caps the resource at that cap. Buildings consume one field per level. Terraformer adds planet fields. Lunar Base adds 3 moon fields per completed level.

## Construction, Research, Ship, And Defense Time

```text
building seconds = max(min queue seconds, floor((metal + crystal) * 3600 / (2500 * (robotics + 1) * 2 ^ nanite * universe speed)))
research seconds = max(min queue seconds, floor((metal + crystal) * 3600 / (1000 * (research lab + 1) * universe speed)))
ship or defense seconds = max(min queue seconds, ceil((metal + crystal) * quantity * 3600 / (2500 * (shipyard + 1) * 2 ^ nanite * universe speed)))
```

Intergalactic Research Network links the highest eligible lab levels for research speed where backend state provides linked lab levels.

## Flight Distance, Speed, And Time

```text
same planet distance = 0
same system distance = 1000 + 5 * position difference
same galaxy distance = 2700 + 95 * system difference
different galaxy distance = 20000 * galaxy difference
travel seconds = 10 + floor(floor(350 * sqrt(distance * 10 / slowest ship speed)) * 100 / (mission speed percent * universe speed))
```

Mission speed options are `100, 90, 80, 70, 60, 50, 40, 30, 20, 10`.

## Fuel And Cargo

```text
ship fuel term = quantity * ship fuel * distance * (1 + effective speed / 100) ^ 2
mission fuel = 1 + floor(sum(ship fuel terms) / 35000 + 0.5)
available cargo = total ship cargo - mission fuel
```

Attack loot is limited by available cargo and the target's plunderable resources. Harvest coverage is limited by recycler cargo after fuel.

## Combat

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

Rapidfire can create extra shots after the normal shot assignment. A rapidfire value of `N` gives each selected shot a `(N - 1) / N` chance to create another shot, chained up to the contract limit. For example, Cruiser rapidfire `10` against Rocket Launchers means each Cruiser shot that selects a Rocket Launcher has a 90% chance to generate one more shot against the defender pool.

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

## Protection And Bashing

Score uses the same contract formula for ranking and attack protection: economy, research, fleet, and defense components are indexed into one player score. New or low-score protection blocks attacks outside allowed score thresholds unless an explicit exception applies. The bashing window is evaluated by attacker, defender, and planet over 24 hours.

## Moon Chance And Jump Gates

```text
moon chance bps = min(floor((metal debris + crystal debris) / 100000) * 100, 2000)
moon destruction bps = min((100 - floor(sqrt(moon diameter km))) * floor(sqrt(dreadstars)) * 100, 10000)
dreadstar destruction bps = min(floor(sqrt(moon diameter km)) * 50, 10000)
```

Jump Gate transfers require both origin and destination moons to have a Jump Gate. A transfer moves ships only, carries no resources, and sets a cooldown on both gates.
