# Veydrift

Veydrift is an onchain space strategy project targeting Base.

The repository is intentionally quiet for now: the public site should only signal
that something is coming, without committing to specific gameplay, visual
mechanics, economy details, or release promises before those systems are ready.

## Planned Repository Shape

```text
apps/
  backend/       Bun + TypeScript GraphQL API
  frontend/      Preact + TypeScript + Tailwind public web app
packages/
  contracts/     EVM smart contracts targeting Base
  circuits/      Zero-knowledge circuit boilerplate and proof tooling
```

The first implementation slice should keep each part minimal and independently
buildable:

- `apps/backend`: Bun service with a health endpoint and GraphQL entrypoint.
- `apps/frontend`: lightweight Preact/Tailwind coming-soon page for
  `https://veydrift.com`.
- `packages/contracts`: Base-oriented Solidity or Foundry boilerplate with
  placeholder contracts and local checks.
- `packages/circuits`: zk circuit workspace with placeholder inputs, proving
  notes, and an explicit decision log for the eventual proving stack.

## Deployment

The initial production target is the existing Hetzner Easypanel instance. The
frontend placeholder should be published first and mapped to:

- `https://veydrift.com`

Backend, contracts, circuits, indexing, and game-specific systems should remain
undeployed until their scopes are defined in Kaneo and validated.

## Operating Rules

- Keep public copy non-specific until the game direction is approved.
- Avoid committing secrets, private strategy, credentials, generated proving
  artifacts, or deployment tokens.
- Prefer small, reviewable pull requests with clear validation notes.
- Track implementation through the Veydrift Kaneo project and Symphony.

## Status

Coming soon.
