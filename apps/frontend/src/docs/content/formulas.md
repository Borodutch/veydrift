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
```

Battle resolution uses six rounds, unit-weighted target selection, refreshed shields, hull damage, explosion checks, rapidfire where cataloged, debris creation, and post-battle defense repair.

## Protection And Bashing

Protection score uses indexed score components from economy, research, fleet, and defense. New or low-score protection blocks attacks outside allowed score thresholds unless an explicit exception applies. The bashing window is evaluated by attacker, defender, and planet over 24 hours.

## Moon Chance And Jump Gates

```text
moon chance bps = min(floor((metal debris + crystal debris) / 100000) * 100, 2000)
moon destruction bps = min((100 - floor(sqrt(moon diameter km))) * floor(sqrt(dreadstars)) * 100, 10000)
dreadstar destruction bps = min(floor(sqrt(moon diameter km)) * 50, 10000)
```

Jump Gate transfers require both origin and destination moons to have a Jump Gate. A transfer moves ships only, carries no resources, and sets a cooldown on both gates.
