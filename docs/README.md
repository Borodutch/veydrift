# Documentation

These guides describe the current repository. They are not proof of what is
deployed: verify live configuration and health before operational changes.

## Development and architecture

- [Development](development.md) — local setup, validation, CI and explicit index repair.
- [Frontend state](frontend-data-store.md) — one store, independent queries, endpoint ownership and session-only actions.
- [Backend and indexer](backend-indexer.md) — event replay, projections, application status and worker boundaries.
- [Public onchain state](public-onchain-state-architecture.md) — gameplay authority and privacy constraints.
- [Combat reference](combat-reference.md) — contract/reference-simulator parity.
- [Randomness engine](randomness-engine.md) — trust model, fulfillment and operational configuration.
- [Player manual](../apps/frontend/src/docs/content/docs.md) — player-facing behavior, not developer architecture.

## Operations and safety

- [Application deployment](deployment.md)
- [Open-alpha state preservation](open-alpha-state-preservation.md)
- [Contract redeploy runbook](veydrift-contract-redeploy-runbook.md)
- [Resolver nonce recovery](resolver-nonce-recovery.md)
- [Referral code migration](referral-code-migration.md)
- [Synthetic stationed-defense QA](stationed-defense-qa.md) — isolated test rendering; deployment mode is not a chain sandbox.
- [Battle keeper](../apps/battle-keeper/README.md)
- [Chicken burn listener](../apps/chicken-burn-listener/README.md)

## Token contracts

- [Token supply, vesting and Uniswap CCA/v4 launch](token-launch.md)

Launch and migration documents require their own approval and verification;
their presence does not authorize a deployment.

## Maintenance

- Keep setup commands in Development and deploy procedures in Deployment/runbooks.
- Keep frontend query/action policy in Frontend state; backend read and commit policy in Backend and indexer.
- Keep environment variable inventories in the package `.env.example` files and build recipes in their committed configuration files.
- Update the player manual for gameplay changes; do not put implementation instructions there.
- Do not retain completed-task status logs, copied test totals or laptop-specific SSH details as architecture.
- Keep only current guides here. Git history provides previous audits, plans and incident records.
- Preserve migration, authorization, randomness and state-preservation safeguards when consolidating.
- Do not edit vendored dependency documentation as part of project documentation cleanup.
- Run `bun run check:docs` for player-copy restrictions and repository Markdown link checks.
  This does not verify remote URLs, deployment health, or the truth of prose; review those separately.
