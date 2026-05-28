# VEY-KANEO-196 Espionage And Hidden-Intel Decision

Date: 2026-05-26

## Decision

Veydrift remains public-state by design and does not implement classic
espionage or hidden-intel parity.

There is no espionage probe unit, espionage report inbox, scan transaction,
hidden target-state reveal, or gameplay backend that withholds canonical enemy
state from ordinary contract/indexer reads. Enemy planets, fleets, resources,
defenses, debris, attack windows, protection counters, and mission state should
be readable from contracts, public events, or rebuildable indexes whenever those
values affect gameplay decisions.

## Rationale

Classic hidden-intel espionage conflicts with Veydrift's onchain source of
truth. If combat, raiding, fleet hunting, noob protection, or debris setup
depends on information asymmetry, the game would need one of these hidden
authorities:

- private backend state that controls what each wallet may know;
- commit-reveal or private-preimage state for target data;
- zk/privacy circuits for selective reveal;
- an offchain report system that becomes required for rule enforcement.

Those are outside the selected architecture. Veydrift instead balances public
intel with contract-enforced opportunity costs and counterplay: fleet slots,
fuel, travel time, recall windows, inbound hostile visibility, ACS defend,
intercept, bashing limits, score protection, loot caps, protected storage,
wreck fields, repair recovery, missiles, and moon/debris public reports.

## Product Surface

- Galaxy target actions must not include Spy, Espionage, Probe, or Scan
  missions.
- Mission Control should present hostile visibility and counterplay as
  public contract/indexer data, not as scan results.
- Catalog docs may keep espionage-named entries only as historical notes or
  reserved legacy IDs.
- Any future long-range reconnaissance feature must be
  explicitly public-state unless a new product decision replaces this one.

## Implementation Consequence

This task chooses the exclusion branch of the acceptance criteria. Contract,
backend, and frontend code should not add espionage probes/reports or hidden
state. The required implementation is documentation and UI clarity so reviewers
and players can see the non-parity deviation without inferring it from missing
buttons.
