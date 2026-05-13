# Proving Stack Decision Log

Veydrift will use zk selectively, but the first concrete proof use case is not
settled yet. This package exists to keep circuit experiments isolated until the
initial architecture is approved.

## Current Position

- Do not commit to a proving system, circuit DSL, or proof verification path yet.
- Keep examples small, local, and free of gameplay-specific assumptions.
- Prefer reproducible scripts and tiny fixtures once the first proof target is
  selected.

## Open Decisions

- Proving stack: Circom/snarkjs, Noir, Halo2, or another toolchain.
- Verification target: server-side validation, onchain verifier, or both.
- Trusted setup requirements and artifact storage.
- Fixture policy for public repository examples.

## Placeholder Check

`bun run check` currently verifies that the expected workspace placeholders are
present. Replace this with real compilation/proving checks once the stack is
chosen.
