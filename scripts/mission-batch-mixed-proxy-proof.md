# Local full-graph productive quote proof (VEY-KANEO-918)

Run with Forge 1.7.1, Solidity 0.8.28 and Bun 1.1.42, with the repository pinned submodules/dependencies:

```sh
(cd packages/contracts && VEY918_EXPORT_FIXTURE=true forge test --match-test testExportMixedProxyFixture -vv)
NO_PROXY=127.0.0.1,localhost bun scripts/mission-batch-mixed-proxy-proof.ts
(cd packages/contracts && forge test --match-contract "^(VeydriftCombatReferenceParityTest|VeydriftBatchFixtureExportTest)$")
```

The opt-in exporter reuses the counterplay reference fixture: 10 battlecruisers attack 100 heavy fighters plus one allied defending battleship; two unrelated recalled transports are due first. It constructs the actual compiled Game, modules and OpenZeppelin Transparent proxy, including native initializer and EIP-1967 wiring. Setup uses the existing test resource tokens and cheatcodes for resources, ships, technologies, coordinates, synthetic ownership, ETH balances and randomness fulfillment. No production source is substituted.

Foundry `vm.dumpState` outputs a genesis allocation map. A separate bounded marker runtime/storage test verified import format before building this fixture. Only journal-touched accounts are exported, so the exporter touches unchanged linked-library code and recursively enumerates actual CREATE children to retain unused modules. It neither invents pointers nor relocates code. The runner checks every runtime against compiled artifacts (masking only compiler-declared link/immutable ranges), checks linked dependencies exist, then checks imported runtime bytes and EIP-1967 implementation. The allocation and reference outputs are generated and ignored, never checked in as stale bytecode. The normal contract test command regenerates them and runs this proof once (CI shard 1). Standalone runs must execute the export command first.

The runner owns loopback Anvil only, refuses an occupied port, and kills/waits its child in `finally`. Genesis uses current wall time with unchanged synthetic mission deadlines (all overdue); there is no external RPC, credential, deployment or real spending. Block and transaction limit are 16,777,216. The production `packMissionBatch` and `quoteMissionBatch` run unchanged with the default $0.50 maximum. Real local EVM simulations, transactions, receipt outcomes, before/after canonical status, survivors, losses, stored debris, seed and four-round attacker victory are checked against the independent Solidity reference. Repeating the settled pack returns AlreadySettled for every leg.

## Validated result

- 51 allocation accounts, 44 compiled runtimes verified.
- Three quote attempts pack both cheap returns and combat; exact simulation and receipt outcomes `[Settled, Settled, Settled]`.
- Mixed selected gas **14,921,654**; actual receipt gas **11,780,261**. Attacker survivor return: selected **551,224**, actual **271,891**.
- Old success-only estimate **107,892**, even with 20% margin, produces `[GasLimited, GasLimited, GasLimited]`; regression asserts this failure.
- Reference survivors/losses/debris pass. Existing direct-Game and inherited proxy reference suites: **41 pass, 0 fail** (includes the opt-in exporter no-op in the ordinary run); opt-in exporter separately passes.

## Limits of this proof

Fee inputs are explicitly synthetic: base fee 100 wei, tip 100 wei, ETH/USD $3,000, L1 exact/upper 1,000/2,000 wei, operator 300 wei. Production headroom yields mixed maximum exposure 4,476,500,800 wei / 14 USD micros. These are **not live Base fee measurements or spending authorization**. No gas or fee guard is raised. Setup/export total gas includes deployment, cheatcodes and independent reference simulation, so is not a batch transaction bound. This case settles combat in one batch; it does not claim partial-round progress coverage (the existing constrained reference test covers that). Resource-token economics, all production workloads, maximum 32-leg mixed packs, live price-feed freshness and inclusion-time OP fee/USD uncertainty remain outside this local proof.
