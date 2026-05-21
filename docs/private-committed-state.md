# Privacy-First Committed State

VEY-126 introduces a backend-authoritative committed-state runtime for Veydrift v1.

Private gameplay facts such as resources, ships, defenses, buildings, research, and sensitive
mission details stay in backend/oracle preimages. Onchain contracts store public ownership,
coordinates, roots, epochs, transition hashes, and randomness references.

## Trust Model

This v1 is centralized. The Veydrift backend/oracle is authoritative for state transitions,
espionage reports, production, construction, fleet movement, and battles. Users can export signed
preimage snapshots for backup and audit records. Later zk circuits should prove transition,
report, and battle correctness while preserving the same root/epoch contract boundary.

## Contract Anchor

PrivateStateAnchor enforces:

- oracle-only root initialization and mutation;
- monotonic epochs;
- previous-root matching;
- replay rejection through transition hashes;
- randomness-blocking for transitions that depend on a pending randomness request;
- public anchors without private getters.

## Backend Runtime

apps/backend/src/privateState.ts defines PlanetState and PlayerState preimage schemas with
domain-separated salted leaves and deterministic roots. The private API requires wallet-scoped
authorization and exposes hidden fields only to that wallet. Snapshot export returns the preimage,
root, epoch, generation time, and backend signature.
