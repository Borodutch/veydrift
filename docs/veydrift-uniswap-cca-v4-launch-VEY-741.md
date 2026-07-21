# $VEYDRIFT Uniswap CCA and v4 launch path

Status: production-reviewable implementation and Base-mainnet-fork proof. No deployment, funding,
auction registration, reserve release, or liquidity creation is authorized by this document or
VEY-KANEO-741.

The conditional launch target is Tuesday 2026-07-28 at 19:00 UTC / 12:00 PDT. It remains conditional
on every owner gate below. The Base block corresponding to that timestamp must be recalculated and
approved shortly before execution; the repository does not pretend a future block number is known.

## Approved allocation and topology

`VeydriftToken` remains a fixed, non-upgradeable 1,000,000,000-token ERC-20 with no mint, tax,
max-wallet, pause, or owner surface. The complete allocation is:

| Purpose | VEYDRIFT | Percent |
| --- | ---: | ---: |
| 60-minute Uniswap CCA | 250,000,000 | 25% |
| Automatically migrated Uniswap v4 VEYDRIFT/WETH position | 250,000,000 | 25% |
| Three resource positions, 50M each | 150,000,000 | 15% |
| Development vesting | 150,000,000 | 15% |
| Contributor vesting | 100,000,000 | 10% |
| Ecosystem vesting | 100,000,000 | 10% |
| Total | 1,000,000,000 | 100% |

The only protocol-seeded market topology is one canonical VEYDRIFT/WETH v4 pool plus hookless,
full-range vMETAL/VEYDRIFT, vCRYSTAL/VEYDRIFT, and vDEUT/VEYDRIFT v4 pools. The resource inputs remain
`333_333_000`, `222_222_000`, and `133_333_000` raw 6-decimal units. No Aerodrome pool, duplicate
venue, resource/WETH pair, resource/stable pair, or new hook is in the approved bundle.

The approved whitepaper artifact is `apps/frontend/public/whitepaper.pdf`, SHA-256
`b220d34a8bf6edc769b77793345d0a802ef3633e041ded0443be03fe7bf81180`.

## Pinned official Base deployments

The executors fail closed on chain id, runtime codehash, and deployment wiring before moving tokens.

| Component | Version/address | Runtime codehash |
| --- | --- | --- |
| WETH | `0x4200000000000000000000000000000000000006` | `0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c` |
| CCA factory | v2.1.0, `0x000000001F26a0044BaA66024e7b6599c61963F8` | `0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa` |
| LBPStrategy | v3.1.0, `0x34385dD739FE5464892BF0bA4CC42492804dA000` | `0x74723f633d30e7ea54ebb2ad6a605965010ced6185cde8ac9dce8504c55787a5` |
| v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6` |
| v4 PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | `0x243f9e091ddf11c7c04e28059fdbbf1bab82b72d414fafb8e096c097aaeb622a` |
| v4 StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | `0xbbd5859677ef5491143133e8ed2b8faa0272f6fc2cbae94c53e79cc8c0538545` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0xa67739abc3ede9dbdc0491636c67d6a14ac07fab9030c3f509b1eb7b11dff8ed` |

CCA source and audited release: <https://github.com/Uniswap/continuous-clearing-auction>.
Liquidity Launcher deployment table and v3.1.0 source commit:
<https://github.com/Uniswap/liquidity-launcher>. Official v4 Base registry:
<https://developers.uniswap.org/docs/protocols/v4/deployments>.

The live wiring proof additionally requires a zero CCA protocol-fee controller, LBPStrategy's
initializer factory to equal the pinned CCA factory, and its PoolManager and PositionManager getters
to equal the pinned v4 deployments. PositionManager's Permit2 and PoolManager getters and StateView's
PoolManager getter are also checked.

## Contracts and trust boundaries

### `VeydriftUniswapCCALauncher`

The launch EOA is immutable and must be
`0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4`. The launcher:

1. validates the official deployment code and wiring, 18-decimal 1B token supply, recipients, absent
   hookless main pool, exact schedule, and v4 inputs;
2. requires an exact 500M authority allowance and consumes it completely;
3. sends a 250M auction allocation and 250M reserve to the official LBPStrategy in one transaction;
4. verifies the deployed auction token, WETH currency, recipients, timing, validation hook, tick
   spacing, and floor price, and commits all inputs including the required WETH threshold into
   `configurationHash`;
5. exposes a terminal pre-launch `abort(reasonHash)`; and
6. exposes permissionless, one-shot `finalizeAndMigrate()` after the approved migration block; and
7. lets only the immutable launch authority reconcile a direct official-strategy call with
   `reconcileMigration(positionTokenId, evidenceHash)`.

The official `LBPStrategy.migrate(initializer)` entrypoint is itself permissionless. A third party may
therefore consume its one-shot registration before the launcher wrapper runs. The launcher commits the
exact official migrator-parameter hash at registration. Contract state cannot distinguish a terminal
official recovery followed by an attacker-created matching pool/NFT from a successful official mint.
Reconciliation is therefore authority-only and requires a nonzero digest of the reviewed migration
receipt plus before/after VEYDRIFT/WETH balance-delta artifact. Reconciliation accepts success only
after the official hookless-pool registration is consumed, the stored initializer parameters still
match that commitment, exactly one approved hookless-or-strategy-hook pool is initialized, and the
supplied NFT is owned by the immutable lock, belongs to that exact VEYDRIFT/WETH pool, has the
configured fee/tick spacing, spans the full usable range, and has nonzero liquidity. An unrelated
locked NFT, an initialized candidate pool with a still-live registration, and mixed hookless/fallback
state all fail closed.
An untrusted caller cannot turn a terminal recovery plus canonical-looking spoof NFT into success.

CCA v2.1.0 stores the required-currency threshold immutably but does not expose a
`requiredCurrencyRaised()` getter. The CREATE2 prediction, emitted factory configuration, launcher
configuration hash, simulation trace, and approved manifest are therefore the verification evidence
for that input. Do not fabricate a getter or omit this limitation from the signed manifest.

The 60-minute window is exactly 1,800 Base block-numberish units. The packed issuance steps must also
sum to 1,800 blocks and 10,000,000 millionths. The floor price must be at least `(1 << 32) + 1` and
exactly divisible by the CCA tick spacing. `claimBlock` cannot precede `endBlock`; `migrationBlock`
must be later than `endBlock`.

The official LBPStrategy derives the clearing price, sweeps auction WETH, initializes v4, and creates
one full-range position because the custom position-definition array is empty. A zero configured hook
prefers the hookless pool. If someone initializes that exact pool after registration but before
migration, the audited strategy deliberately falls back to its own audited strategy hook. That is not
a new VEYDRIFT hook. Postflight must prove exactly one of the hookless and audited-fallback pool IDs was
initialized; both or neither is an abort/blocker.

### `VeydriftUniswapResourcePools`

This executor cannot run before the main launcher records a successfully minted position. It validates
the fixed resource addresses, exact 10B supplies and 6 decimals, exact 50M VEYDRIFT inputs, exact raw
resource inputs, absent hookless pools, and common position lock. All three pools initialize and mint
in one transaction or all revert.

Each manifest supplies `sqrtPriceX96`, fee, tick spacing, fixed liquidity, and currency-ordered maximum
and minimum amounts. Minimum use must be at least 99% of each maximum, bounding the owner-approved
resource safety margin to at most 1%. The contract never derives these values from an AMM spot price.
It uses the audited v4-periphery action sequence—pre-fund PositionManager, `MINT_POSITION`, two exact
maximum `SETTLE` actions, then `TAKE_PAIR`—and returns bounded unused inventory to the immutable
recovery recipient. It deliberately does not use the official whole-contract-balance sentinel because
the public PositionManager may already hold donated currency balances. No ERC-20 or Permit2 allowance
is left.

### `VeydriftV4PositionLock`

All four ERC-721 positions mint directly to one immutable lock. It has no owner, rescue method, or
early release. After the immutable Unix timestamp, anyone may call `approveBeneficiary`; that grants
only the immutable beneficiary operator approval in the official PositionManager. The beneficiary and
term must be approved before deployment because neither can be changed.

The legacy `VeydriftLiquidityLauncher` is fallback-only. It is not deployed or called by any Uniswap
script and must not appear in the signed launch bundle.

## Dry-run manifest and automated evidence

The checked manifest is generated by the deterministic fork test, not maintained as a parallel
summary: `packages/contracts/manifests/vey-741-base-fork-dry-run.json`. It records the pinned Base
block/hash and source commit, reviewed VEYDRIFT runtime codehash, official deployment codehashes,
auction configuration/clearing/finalization outputs, exact main/resource pool keys and position
metadata, per-currency input/use/dust, live resource liabilities/balances/margins/releases, donated
PositionManager balances before/after, and explicit zero approval tuples. Generate and validate it
from `packages/contracts`:

```sh
BASE_MAINNET_RPC_URL=<public-or-redacted-rpc> bun run manifest:generate
VEYDRIFT_SOURCE_COMMIT=$(jq -r .sourceCommit manifests/vey-741-base-fork-dry-run.json) \
  node scripts/validate-veydrift-uniswap-launch-manifest.mjs
```

At the pinned block, the fork test uses the compiled non-upgradeable `VeydriftToken`, upgrades the live
resource/game proxies only inside the fork, proves the numeric reserve-release inequalities, and uses
the released live resource tokens. Against the official CCA/LBP/v4 deployments it creates the CCA,
submits a Permit2-funded WETH bid, checkpoints and graduates, reconciles a permissionless automatic
migration through the launch authority, records observed strategy/auction outflows and
PoolManager/recovery/PositionManager destination deltas, and creates the three resource pools. It also
proves that three unrelated lock NFTs and
pre-existing PositionManager balances cannot prove, subsidize, distort, or block the four canonical
positions. It never broadcasts.

Before a real transaction, replace fork-local outputs with a final signed mainnet manifest containing:

- reviewed commit, compiler/settings, bytecode and source-verification refs;
- latest Base block/time, target start/end/claim/migration blocks, and timestamp mapping;
- token, executor, lock, auction prediction, v4 pool IDs, recipients, beneficiary, and recovery address;
- exact WETH threshold/capital, valuation reference source/time/math, floor/tick/steps, fee/range,
  LP currency rate, resource prices/liquidity/minimum use, and unlock timestamp;
- resource liabilities, locked exits, live reserve balances, approved margins, release inputs, and
  post-release backing;
- calldata hashes, approval digest, final simulation hash, expected events/deltas, gas limits, and
  abort owner; and
- independent security reviewer identity/evidence and explicit Nikita approval.

Environment variable names are listed in `.env.example`. Values, private keys, authenticated RPC
URLs, secrets, and Vaultwarden material never belong in GitHub, Kaneo, logs, manifests, or chat.

## Owner-gated runbook

All commands run from `packages/contracts`. Omit `--broadcast` for simulation. OpenClaw is the only
deployment owner after the merged contract-upgrade handoff; Symphony must not perform these actions.

1. Reproduce `forge fmt --check`, `forge build --sizes`, full unit tests, the Base fork test, storage
   layout check, and manifest validation at the reviewed SHA.
2. Verify all official live codehashes/wiring and prove the hookless main/resource pool IDs and all four
   Aerodrome pairs are absent.
3. Prove resource reserve backing and simulate any resource/game upgrade and exact reserve release
   first. The irreversible no-mint resource upgrade still follows the VEY-KANEO-740 safeguards.
4. Simulate `DeployVeydriftUniswapLaunch.s.sol`. Verify immutable authority, recovery recipient,
   beneficiary, unlock timestamp, and executor bytecode before considering deployment.
5. Resolve the conditional target to Base blocks. Simulate the exact CCA config with
   `LaunchVeydriftUniswapCCA.s.sol`; compare predicted auction, configuration hash, pool ID, token
   deltas, and events with the signed manifest. Before execution, the launch EOA must grant the CCA
   launcher an exact 500M VEYDRIFT allowance; a larger or smaller allowance reverts.
6. Fund only the approved WETH bidder/capital path. CCA bidders use Permit2 and must receive normal
   user slippage/max-price disclosure. Monitor bids, checkpoints, demand, graduation, exits/refunds,
   and finalization readiness throughout the 1,800-block window.
7. After the end checkpoint and approved migration block, inspect the official strategy registration
   and PositionManager events, then simulate `FinalizeVeydriftUniswapCCA.s.sol`. Use the default wrapper
   only while the registration is live. If another address already called the official strategy, set
   `VEYDRIFT_RECONCILE_MIGRATION=true` and set `VEYDRIFT_UNISWAP_MAIN_POSITION_TOKEN_ID` to the exact NFT
   minted by that migration receipt. Produce a reviewed evidence artifact containing the receipt,
   emitted pool/NFT data, and observed VEYDRIFT/WETH before/after balances and deltas; set
   `VEYDRIFT_MIGRATION_EVIDENCE_DIGEST` to its nonzero digest. Reconciliation must be broadcast by the
   immutable launch authority and simulated before broadcast. Token id `0` is only
   for recording a proven terminal recovery branch with no initialized approved main pool; unrelated
   NFTs already held by the lock are ignored. A `false` result is terminal and is never permission to
   retry.
8. Derive resource initial prices from the approved post-discovery valuation policy—not an AMM spot
   read—then simulate all three configs atomically with `LaunchVeydriftUniswapResources.s.sol`. Recheck
   all three hookless pool IDs immediately before submission and use an owner-approved private
   transaction path where available. Any third-party initialization is an abort: do not add liquidity
   to it. A replacement fee/tick spacing/pool ID is a re-key that requires a new signed manifest,
   security review, simulation, and explicit owner approval. Before execution, grant the resource
   launcher exact allowances for 150M VEYDRIFT and the three fixed raw resource amounts; every
   allowance must be consumed to zero.
9. Run `VerifyVeydriftUniswapLaunch.s.sol` read-only. It verifies the four stored canonical position
   IDs independently (owner, exact pool key, full-range ticks, nonzero liquidity, and distinctness);
   unrelated permissionlessly transferred PositionManager NFTs in the immutable lock are ignored.
   Publish receipts/events, auction and pool IDs,
   NFT IDs/owner, lock terms, actual used/returned amounts, reserve backing, codehashes, and zero
   allowances from the signed manifest.

## Mandatory approvals

No launch step is ready until a UI-visible owner record approves all of:

- exact WETH capital, required raise, valuation policy/reference/time, floor, tick, issuance steps,
  claim and migration blocks, and auction recipients;
- launch EOA use, unsold-token recipient, recovery recipient, position beneficiary/custody, immutable
  unlock timestamp, and incident/abort owner;
- v4 main fee/range and LP WETH allocation rate;
- each resource initial price, fee, full-range ticks, liquidity, maximum inputs, minimum 99% use,
  returned-dust handling, and live reserve safety margin;
- no Aerodrome/duplicate/resource-WETH/resource-stable pools;
- independent audit/security review of source, compiled bytecode, official version/codehash pins,
  transaction calldata, and final Base simulation; and
- the final signed manifest and conditional launch timestamp/block mapping.

The launch scripts additionally require nonzero `VEYDRIFT_OWNER_APPROVAL_DIGEST` and
`VEYDRIFT_FINAL_SIMULATION_HASH`; those checks prevent accidental placeholders but do not substitute
for checking the referenced evidence.

## Security review

| Risk | Control and required evidence |
| --- | --- |
| Auction misconfiguration | Exact 250M allocation; 1,800-block and step-sum checks; tick-boundary and floor checks; CREATE2 prediction; config hash; factory event and signed manifest |
| Bidder/refund edge cases | Official audited CCA v2.1.0; Permit2 flow covered on Base fork; monitor checkpoints; disclose max-price/slippage; test exits, partial exits, claims, unsold sweep, and under-graduation before approval |
| MEV and price manipulation | Continuous auction instead of first-block AMM price; no promise of fill price; public bid/backrun risk disclosed; resource prices come from approved valuation policy; protocol accounting never reads AMM spot |
| Finalization failure | Permissionless one-shot wrapper after migration block; official strategy catches failure and returns WETH/reserve tokens to recovery; false migration result is terminal and blocks resource pools |
| Permissionless migration race | Official migration remains permissionless, but reconciliation is restricted to the immutable launch authority and binds a nonzero reviewed receipt/balance-delta evidence digest on-chain. It also verifies committed initializer parameters, consumed registration, exclusive pool topology, exact locked full-range NFT metadata, and nonzero liquidity. Direct failure reconciliation requires no initialized approved main pool and ignores unrelated lock NFTs; an untrusted caller cannot bless a post-recovery spoof NFT |
| Main/resource pool initialization front-run | Main and all three resource preflights reject existing approved pool IDs; recheck immediately before private submission. Any resource-pool squatting aborts the bundle. Re-keying fee/tick/pool IDs requires a new signed manifest, simulation, security review, and explicit owner approval; never deposit into the squatted pool by weakening checks |
| Position custody | Four NFTs mint directly to one immutable, no-rescue time lock; beneficiary and timestamp fixed; Base fork verifies ownership |
| Decimal/ratio error | 18-decimal 1B VEYDRIFT and 6-decimal 10B resources asserted; exact raw inputs; currency sorting; minimum 99% use; fork uses real PositionManager actions |
| Mint/upgrade authority and token identity | Preflight, resource launch, postflight, fork artifact, and validator pin the reviewed `VeydriftToken` runtime codehash; wrong and mintable 1B lookalikes fail. VEYDRIFT has no owner/minter/proxy; resource no-mint upgrade and reserve release remain governed by the numeric VEY-KANEO-740 proof |
| Token/approval leakage | Exact authority allowances; launcher-to-LBP approval zeroed; resource path pre-funds only approved maxima and settles those exact amounts; all launcher balances returned/zero; the generated manifest enumerates fourteen zero owner/token/spender tuples |
| PositionManager balance contamination | Resource settlement never uses the whole-contract-balance sentinel. Unit and pinned Base-fork tests donate all four currencies first and prove identical balances remain afterward while canonical use/dust stays within the signed maxima/minima |
| Unauthorized hook/venue | CCA validation hook zero; resource hooks zero; no custom hook bytecode; Aerodrome launcher fallback-only and excluded; postflight rejects all four Aerodrome pools |
| Recovery abuse | Recovery recipient immutable; receives only official failure recovery or bounded unused resource input; no arbitrary rescue/admin function; all boundaries require owner approval |
| Accounting contamination | Contracts expose no pricing oracle and use no pool spot read for game/accounting; future price-dependent features require a separate reviewed TWAP/oracle design |

## Abort and recovery boundaries

- Before CCA registration, the authority may call terminal `abort(reasonHash)`. Abort on any codehash,
  wiring, supply, recipient, timing, valuation, pool-presence, reserve, audit, or simulation mismatch.
- A reverted registration or resource transaction is atomic and moves nothing.
- After successful CCA registration there is no cancellation or parameter edit. Follow the audited CCA
  bid/exit/claim/sweep lifecycle; do not deploy a replacement auction or duplicate pool.
- If the CCA does not graduate or migration fails, official LBPStrategy sweeps available WETH and the
  250M reserve to the immutable recovery recipient and emits recovery/failure events. The launcher
  records migration failure and resource creation remains permanently blocked. Never auto-retry.
- If the official strategy registration is already zero, do not call the wrapper again. Resolve the
  direct migration receipt, NFT id, and before/after VEYDRIFT/WETH balance deltas; hash that reviewed
  artifact and use the authority-only reconciliation mode. Unrelated NFTs,
  candidate-only initialization, or both main-pool variants are blockers, not evidence to override.
- Successful v4 pool creation is irreversible market state. The immutable lock cannot release early.
- Resource dust within the approved maximum/minimum envelope returns to recovery. A minimum-use breach
  reverts all three pools. Recompute configs and obtain a new approval rather than weakening limits.
- If any hookless resource pool ID is initialized before atomic creation, abort. A private relay is an
  exposure reduction, not a substitute for the immediate preflight. Never reuse the squatted pool or
  silently select a new fee/tick spacing; an owner-approved re-key starts from a new manifest and
  simulation.
- Aerodrome classic is contingency design only. Activating it requires a new explicit owner decision,
  security review, manifest, and ticket; it is never an automatic fallback for a failed Uniswap launch.
