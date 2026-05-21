# Retired Proving Stack Decision Log

Veydrift gameplay state is public onchain state. There is no privacy, zk,
hidden-state, committed-root, or private-preimage gameplay roadmap. See
`../../../docs/public-onchain-state-architecture.md`.

This package now exists only as inert historical scaffolding so workspace scripts
continue to pass until a cleanup task removes or repurposes it.

## Current Position

- Do not add gameplay circuits, proof verifiers, hidden commitments, or zk
  product guidance here.
- Keep placeholders small, local, and free of gameplay-specific assumptions.
- Remove or repurpose this package in a dedicated cleanup task if it becomes
  distracting.

## Closed Decisions

- Proving stack: none for gameplay.
- Verification target: public contract state and public events.
- Trusted setup: not applicable for gameplay.
- Fixture policy: no checked-in proving artifacts.

## Placeholder Check

`bun run check` currently verifies that the expected workspace placeholders are
present. Do not replace this with gameplay proving checks.
