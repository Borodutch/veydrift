# @veydrift/contracts

Solidity contracts and Foundry tests for Veydrift on Base-compatible EVMs.

## Development

Run from `packages/contracts` with Foundry installed:

```sh
forge install
forge fmt --check
forge build
forge test
```

Root equivalents are `bun run check:contracts` and `bun run test:contracts`.
Compiler and build settings live in [foundry.toml](foundry.toml); dependencies in
[foundry.lock](foundry.lock). Local tests do not need production signing keys.
See [Development](../../docs/development.md#validation-and-ci) for workspace checks.

## Source map

Use source and generated ABIs for signatures, event schemas, enum IDs and constants.
Do not maintain copies of those tables here.

| Area | Entry point |
| --- | --- |
| Gameplay and public entrypoints | [VeydriftGame](src/VeydriftGame.sol), [gameplay module](src/VeydriftGameplayModule.sol) |
| Storage and migration | [Game storage](src/VeydriftGameStorage.sol), [migration module](src/VeydriftStateMigrationModule.sol) |
| IDs, costs and stats | [Types](src/libraries/VeydriftTypes.sol), [catalog](src/libraries/VeydriftCatalog.sol) |
| Public counterplay limits | [Anti-raid primitives](src/libraries/VeydriftAntiRaidPrimitives.sol) |
| Moons and alliances | [Moon system](src/VeydriftMoonSystem.sol), [alliance system](src/VeydriftAllianceSystem.sol) |
| Randomness | [RandomnessEngine](src/RandomnessEngine.sol), [operational guide](../../docs/randomness-engine.md) |
| Resource supply and backing | [Resource token](src/VeydriftResourceToken.sol), [reserve release](src/libraries/VeydriftReserveRelease.sol) |
| VEYDRIFT supply and vesting | [VeydriftToken](src/VeydriftToken.sol), [token guide](../../docs/token-launch.md#token-foundation) |
| Combat parity and reports | [Combat reference](../../docs/combat-reference.md) |

[The player manual](../../apps/frontend/src/docs/content/docs.md) describes gameplay.
[Public-state architecture](../../docs/public-onchain-state-architecture.md) defines
authority and product scope; previews never replace contract enforcement.

### Integration boundaries

- Settlement applies accrued production and ready queues; unfinished queues remain active.
  Keep explicit finish/resolve entrypoints and workers where deployed contracts need them.
  Ordinary API reads never submit settlement transactions.
- Resources are an internal ledger backed by game-held ERC-20 reserves. Collection
  does not transfer tokens to a wallet; spending consumes ledger balances, not reserve tokens.
  Fund new test deployments from initialized supply, never by resetting alpha balances.
- Planet and moon bodies, including moon generations, remain isolated. See
  [indexed read rules](../../docs/backend-indexer.md#efficient-read-models).
- Attack randomness must be fulfilled before resolution. Other mission paths retain
  their own timing, authorization and resource constraints.
- Reactive `AcsDefend`/`Intercept` target hostile mission IDs; `DefenseHold` stations
  at a planet. They are distinct paths, not interchangeable UI labels.
- `VeydriftSettlement` is the compact first-planet compatibility contract, not the
  full Game deployment path.

## Deployment

Veydrift is in open alpha as of 2026-05-29. Preserve existing player state.
Follow [state preservation](../../docs/open-alpha-state-preservation.md) and the
[contract runbook](../../docs/veydrift-contract-redeploy-runbook.md); neither authorizes a broadcast.

- Prefer a storage-compatible upgrade after verifying the live proxy and authority.
  The Game script uses Transparent proxy/ProxyAdmin; alliance and moon scripts use UUPS.
  [UpgradeGame.s.sol](script/UpgradeGame.s.sol) is the Game path; `Upgrade.s.sol` always reverts.
- Full redeploy requires evidenced `No alpha player state exists` or
  `Migration plan approved`. `VEYDRIFT_ALPHA_REDEPLOY_ACK` is a guard, not approval.
- Preserve storage, reserves, post-upgrade writes and before/after state parity.
  Never mint replacement resources or swap reserve-token addresses to repair backing.
- Follow the runbook's writer/keeper, confirmed upgrade boundary, replay/smoke and
  frontend ordering. Do not substitute a generic pause/restart.
- Only authorized operators should create an ignored `.env` from [.env.example](.env.example).
  Preserve existing configuration; keep signer keys and RPC credentials out of source.

Specialized operations:

- [Referral migration](../../docs/referral-code-migration.md): source freeze, receipt-backed
  import, ownership/redemption completeness, credits and rollback.
- [Token supply and launch](../../docs/token-launch.md): irreversible no-mint upgrade,
  reserve release, vesting, pinned Uniswap bundle and owner-gated recovery.
