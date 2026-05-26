# Public Onchain State Architecture

Veydrift gameplay state is public blockchain state. This is a final product
constraint, not a temporary MVP shortcut.

## Decision

- Gameplay state must be plainly readable from contracts, events, and ordinary
  indexers.
- Contracts are the source of truth for ownership, balances, progression,
  mission state, combat outcomes, and all game-rule enforcement.
- The backend, websocket sync, and frontend caches are convenience
  infrastructure. They may speed up reads, denormalize data, and improve UX, but
  they must not hold authoritative hidden game state.
- Veydrift will not build a privacy, zk, committed-root, private-preimage,
  hidden-state oracle, or fog-of-war roadmap for gameplay state.
- Veydrift scope excludes espionage. VEY-KANEO-196 formalizes this as a product
  decision rather than a temporary implementation gap. Espionage-named catalog
  items may remain as legacy IDs or research prerequisites, but there is no
  probe scan mechanic, hidden enemy-state reveal, or espionage report system to
  implement.

## Canonical Public State

The canonical game state includes all values needed to verify and render the
game without privileged backend access:

- Accounts, planet ownership, moon ownership, colony ownership, alliance
  membership, war state, and permissions.
- Galaxy coordinates, occupied coordinate keys, planet seeds, deterministic
  planet metadata, moon metadata, and colony metadata.
- Internal resource balances, reserve-backed token accounting, deposits,
  withdrawals, locked balances, production rates, storage caps, and fuel costs.
- Building, moon building, research, ship, defense, missile, and special
  structure levels or counts.
- Active and historical queues for buildings, moon buildings, research, ships,
  defenses, missiles, repairs, and withdrawals.
- Fleet missions, including mission type, origin, target, owner, ships, cargo,
  fuel, departure, arrival, return, recall, resolution, and randomness request
  references.
- Combat, raid, harvest, missile, ACS defend, intercept, and return-fleet
  results.
- Debris fields, wreckage fields, repairable ships, harvested resources, moon
  creation rolls, and battle or harvest reports.
- Ranking, score, bashing-limit counters, protected storage, loot caps, raid
  recovery state, and other anti-abuse counters.

If a mechanic affects gameplay validity, wallet actions, rankings, combat,
resource movement, or player risk, it belongs in contract-readable state or in
events that are reconstructable from the chain.

## Backend And Indexer Boundary

The backend may:

- Read contracts through HTTP RPC and websocket subscriptions.
- Cache chain reads with short TTLs.
- Index events for faster wallet, planet, galaxy, queue, report, ranking, and
  notification APIs.
- Rebuild its indexes from a configured block height.
- Provide denormalized API responses for the frontend.
- Surface operational health for RPC, websocket sync, and index freshness.

The backend must not:

- Decide whether a gameplay action is valid when the contract has not enforced
  the same rule.
- Store secret fleet intent, hidden enemy state, private preimages, committed
  roots, or hidden battle inputs.
- Resolve combat, loot, harvest, score, bashing, alliance, war, or moon outcomes
  as authoritative offchain state.
- Gate frontend-visible gameplay information behind privileged backend knowledge.
- Become required to reconstruct canonical state beyond ordinary chain replay
  and public index rebuilds.

## Contract Enforcement Boundary

Contracts must enforce:

- Ownership and authorization checks.
- Resource availability, reserve backing, internal balance debits/credits, cargo
  capacity, fuel costs, and withdrawal locks.
- Progression gates for buildings, research, ships, defenses, moons, missiles,
  colonies, alliances, ACS, and mission types.
- Queue exclusivity, queue readiness, timestamps, settlement order, recall
  windows, return timing, fleet slots, and active mission ownership.
- Combat, raid, harvest, missile, debris, wreckage, moon creation, protected
  storage, loot caps, bashing limits, score protection, and raid recovery rules.
- Randomness request/fulfillment boundaries for public outcomes that need random
  rolls.

Frontend and backend code may duplicate these rules for previews and better
messages, but duplicated logic is advisory only.

## No Espionage Or Hidden-State Replacement

Public state means attackers can inspect targets and in-flight missions. Veydrift
does not replace legacy espionage friction with hidden commitments. The risk model
is explicit public counterplay:

- VEY-KANEO-111 removes espionage from Veydrift scope.
- VEY-KANEO-112 and VEY-KANEO-118 define and implement public-state mission
  actions and fleet lifecycle.
- VEY-KANEO-119 implements public-state attack and raid battle resolution.
- VEY-KANEO-120 implements debris fields, recycler harvest, and Space Dock
  combat integration.
- VEY-KANEO-121 integrates moon creation chance with battle debris and
  randomness.
- VEY-KANEO-127 defines anti-raid balance primitives for public onchain state.
- VEY-KANEO-128 implements mission fuel, fleet slots, and in-flight accounting.
- VEY-KANEO-129 implements bashing limits and score protection.
- VEY-KANEO-130 implements protected storage, loot caps, and raid recovery.
- VEY-KANEO-131 implements ACS defend, alliance intercept, and hostile mission
  counterplay.
- VEY-KANEO-132 implements hostile mission visibility, recall limits, and
  return-fleet risk.
- VEY-KANEO-133 implements interplanetary missile attacks and missile silo
  mechanics.
- VEY-KANEO-196 records the explicit product decision to exclude classic
  espionage and hidden-intel parity.

Future fleet and combat work should extend these public mechanics instead of
adding private state.

## Documentation Implications

Any repo documentation, code comment, or implementation note that recommends
zk gameplay privacy, hidden-state commitments, private orderflow, committed
roots, private preimages, or an authoritative hidden-state backend is obsolete.
Circuit workspace files are retained only as inert historical scaffolding until a
cleanup task removes or repurposes the package.
