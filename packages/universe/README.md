# Veydrift Universe Generation

`@veydrift/universe` is the shared deterministic generator for Veydrift
galaxies, systems, and planet slots. It is pure TypeScript with no runtime
dependencies, so the backend can serve canonical metadata and the frontend can
render the same coordinates without duplicating formulas.

## Coordinate Identity

Planet identity is:

```text
galaxyId:systemId:slot
```

- `galaxyId` is a non-negative integer.
- `systemId` is a positive integer within that galaxy.
- `slot` is the OGame-style planet position from `1` through `15`.

IDs are generated from domain-separated strings:

```text
veydrift:v1:<domain>:<seed>:galaxy:<galaxyId>:system:<systemId>:slot:<slot>
```

Every galaxy, system, planet, and random field uses its own domain label. Adding
`galaxyId = N + 1` never changes `0..N` because no generation step samples from a
global list or mutable counter.

## Determinism

Canonical values are derived with a 64-bit FNV-1a hash implemented with
JavaScript `BigInt`. Ranges are selected with integer modulo math. OGame's
deuterium formula is represented in basis points:

```text
deuteriumFormulaBps = 12800 - 20 * maxTemperatureC
```

That is the integer form of `10 * L * 1.1^L * (-0.002 * T + 1.28)` for the
temperature-dependent multiplier, excluding the mine-level term.

## OGame Approximations

The field and temperature ranges use the OGame Wiki Colonization table for slots
1-15. That table gives minimum, average, and maximum fields plus the minimum,
average, and maximum upper temperature for each slot. Veydrift chooses values in
those ranges with a deterministic centered roll around the listed average.

The generated `minTemperatureC` is always `maxTemperatureC - 40`, matching the
wiki note that the displayed planet temperature range spans 40 degrees.

Position bonuses follow the wiki values:

- slots 1, 2, and 3 receive `40%`, `30%`, and `20%` crystal bonuses.
- slots 6, 7, 8, 9, and 10 receive `17%`, `23%`, `35%`, `23%`, and `17%` metal
  bonuses.
- colder outer planets get higher `deuteriumFormulaBps`.

Planet biomes use the OGame Position page's redesigned-universe slot pattern:
odd and even systems have predictable slot-to-type mappings for desert, dry,
normal, jungle, water, ice, and gas planets.

These are close OGame-style approximations, not a claim of exact server parity.
The original game can apply class, alliance, and universe-setting bonuses after
colonization; Veydrift keeps the base deterministic metadata canonical and can
layer game-specific modifiers separately.

## Sources

- OGame Wiki Colonization:
  https://ogame.fandom.com/wiki/Colonization
- OGame Wiki Position:
  https://ogame.fandom.com/wiki/Position
- OGame Wiki Temperature:
  https://ogame.fandom.com/wiki/Temperature
