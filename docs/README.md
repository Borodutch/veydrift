# Veydrift repository documentation

This directory contains current architecture, operating runbooks, implementation decisions, and historical audits. Start with the short guides below; use issue-specific documents when you need the reasoning or evidence behind a particular change.

The player-facing manual is maintained separately in `apps/frontend/src/docs/content/docs.md` and published at [veydrift.com/docs](https://veydrift.com/docs).

## Start here

- [Development](development.md) — install, run, validate, and troubleshoot locally.
- [Frontend data store](frontend-data-store.md) — the single frontend backend-read boundary and refresh rules.
- [Public onchain state](public-onchain-state-architecture.md) — source-of-truth and privacy decisions.
- [Event-sourced indexer](event-sourced-indexer-VEY-KANEO-475.md) — event coverage and indexed read-model design.
- [Combat reference](combat-reference.md) — current combat terminology and behavior.
- [Randomness engine](randomness-engine.md) — request, fulfillment, and resolution flow.
- [Open-alpha state preservation](open-alpha-state-preservation.md) — mandatory safety rules for contract changes.
- [Contract redeploy runbook](veydrift-contract-redeploy-runbook.md) — controlled replacement and migration procedure.

## Current feature and migration references

- [Referral code migration](referral-code-migration-VEY-KANEO-714.md)
- [Selectable moon bodies](selectable-moon-bodies-VEY-KANEO-639.md)
- [Token launch](veydrift-token-launch-VEY-740.md)
- [Uniswap CCA v4 launch](veydrift-uniswap-cca-v4-launch-VEY-741.md)
- [Production combat QA matrix](production-combat-missions-qa-matrix-VEY-KANEO-164.md)

## Historical decisions and audits

Files with an issue identifier in their name usually capture the code, assumptions, and evidence at one point in time. They remain useful context, but their line references, contract sizes, deployed addresses, and conclusions may be stale. Revalidate them against the current commit and live network before making operational or security decisions.

- `anti-raid-public-state-*`
- `attack-flow-audit-*`
- `catalog-audit-*` and `catalog-re-audit-*`
- `combat-economy-incentives-*`
- `defender-loss-audit-*`
- `espionage-hidden-intel-decision-*`
- `highscore-ranking-*`
- `lazy-onchain-reconciliation-*`
- `ogame-parity-scope-*`
- `veydriftgame-replacement-plan-*`

`ci-speed-draft.md` is a draft proposal, not a runbook.

## Documentation rules

- Update the root `README.md` when setup, package layout, or primary commands change.
- Update `development.md` when local or validation workflows change.
- Update `frontend-data-store.md` when a backend read, refresh trigger, or cache ownership rule changes.
- Update the player manual when gameplay or player-visible transaction behavior changes.
- Mark time-sensitive audit evidence clearly and never treat an old deployment snapshot as current proof.
