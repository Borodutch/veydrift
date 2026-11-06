# Veydrift

Veydrift is an onchain space strategy game on Base that you play in the browser at
[veydrift.com](https://veydrift.com): you settle planets, grow mines and research, build
fleets, raid other players and fight in alliances, and every planet, fleet, resource and
battle outcome is public contract state on Base.

Under the hood, contracts enforce gameplay; the backend indexes public chain state into SQLite; the frontend renders
indexed state and submits user-authorized wallet actions.

## How onchain it is

Contracts on Base hold the game's state and enforce its rules: ownership, resources,
buildings, research, fleets, mission timing, combat losses, alliances and the
[contract and token addresses](https://veydrift.com/docs/contracts) are all public,
and the backend only indexes them. There is no fog of war or espionage: anyone can
inspect a planet or a fleet in flight, so defense is about timing, protection rules
and alliances rather than hiding.

It is onchain but not trustless. Battles are fought off-chain by a trusted referee
service that uses OGame's combat rules. The chain freezes each battle's
inputs and random seed first and accepts a single result that matches them, and
anyone can replay the battle from the public record ([Battle referee](docs/battle-referee.md)).
Randomness comes from a precommit/reveal oracle that the game runs
([Randomness engine](docs/randomness-engine.md)), and the game contract can be upgraded
by its owner. Fully onchain games such as Dark Forest keep all of their logic in contracts
and hide players' positions with zero-knowledge proofs; Veydrift chose fully public state
and a referee whose results can be checked.

## FAQ

**What do I need to play?** A wallet on Base with a little ETH for gas, since every game
action is a transaction. Connect it at [veydrift.com](https://veydrift.com) and claim a
home planet; an invite code is optional.

**Are the resources tokens?** Yes. Metal, Crystal and Deuterium are ERC-20 tokens
(vMETAL, vCRYSTAL and vDEUT), one token per in-game unit. The Rift moves them between
your planets and your wallet; an extraction spends 28 days locked on its planet, where
raiders can take it.

**Can an AI agent play for me?** Yes. A main wallet can name one delegate wallet, such as
an agent's, to play on its behalf without owning anything. Point the agent at the
[player manual](https://veydrift.com/docs) to learn the rules.

**Is it open source?** The source is public here, but it isn't under an open-source
license: all rights are reserved.

## Start here

- [Development](docs/development.md): installation, local frontend/backend, validation and index repair.
- [Documentation index](docs/README.md): current architecture, operations and safety guides.
- [Frontend state](docs/frontend-data-store.md): centralized state, parallel queries and session-only transactions.
- [Backend and indexer](docs/backend-indexer.md): event ingestion, projections, API boundaries and workers.
- [Deployment](docs/deployment.md): application builds, configuration and readiness gates.
- [Player manual](apps/frontend/src/docs/content/docs.md): gameplay documentation shipped with the app.

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/frontend` | Preact, TypeScript and Vite game UI |
| `apps/backend` | Bun API, SQLite indexer and configured writer services |
| `apps/battle-keeper` | Separate fleet-resolution service |
| `apps/chicken-burn-listener` | Cross-chain Chicken burn listener |
| `apps/stats` | [Isolated statistics service](docs/stats-service.md) |
| `packages/contracts` | Solidity contracts, deployment scripts and parity tests |
| `packages/universe` | Shared universe generation and types |

## Quick start

```sh
bun install
bun run dev:frontend
```

Open <http://localhost:5173>. The committed Vite default proxies the deployed
production API. For a fully local API/indexer, follow the
[local backend setup](docs/development.md#local-api-and-indexer).
A local page connected to mainnet still submits real mainnet transactions.

Package commands live in [package.json](package.json). Use focused tests while
iterating; `bun run check`, `bun run test`, and `bun run build` cover the workspace.

## Token and liquidity

All tokens are on Base and have fixed supplies with no owner, minter or proxy.

| What | Address |
| --- | --- |
| VEYDRIFT (1,000,000,000, 18 decimals) | `0x442E9Ba64899d6B0bD25DF2558d3E804427bF448` |
| vMETAL / vCRYSTAL / vDEUT (50,000,000,000 each, 0 decimals, 1 token = 1 in-game unit) | `0x078b4EC3E7681D1A658c32eb806872FBCD922CFc` / `0x045627dc0b1A10289B53E23a5045aF7D470EF50f` / `0x99FF0a1e24c3171132912D4703dF2c67b4Da6698` |
| Development / contributor / ecosystem vesting (250M / 200M / 200M VEYDRIFT) | `0xB2554e9e2B201F299d8f0fF8A522FAd3057E87A4` / `0x4A55cff3006e87360285969dD366acBd79445BeD` / `0x64C323e8ef7D6df9730E64627d7755c9A1050162` |
| Uniswap v4 position lock (`V4PositionLock`) | `0x490e1952310c49D865F04ae3B70B06FC004cFb36` |

The remaining 350,000,000 VEYDRIFT is liquidity in four hookless, full-range Uniswap v4 pools
(0.9% fee): 150M in VEYDRIFT/ETH and about 66.67M in each of the vMETAL, vCRYSTAL and vDEUT pools.
All four position NFTs are locked until 2027-11-06 20:00 UTC, and their trading fees go to
borodutch.eth. Pool ids, positions and lock terms are in [Token and liquidity](docs/token-launch.md).

## Safety and architecture

Veydrift is in open alpha as of 2026-05-29. Preserve existing player and indexed
state. Contract work must follow [open-alpha state preservation](docs/open-alpha-state-preservation.md)
and the [contract redeploy runbook](docs/veydrift-contract-redeploy-runbook.md).
Verify the deployed proxy type and authority; an old deployment note is not
permission to upgrade or redeploy.

Keep secrets, local databases and environment overrides out of Git. Do not copy
production signing keys into local development. Read requests must not trigger
canonical RPC repair, and frontend refresh failures must not become transaction
failures or application-wide locks.

[Public state and product scope](docs/public-onchain-state-architecture.md) is the
authority for the no-hidden-state/no-espionage boundary.
