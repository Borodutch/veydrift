# $VEYDRIFT token foundation and Aerodrome contingency architecture

Status: the fixed-supply, vesting, resource-freeze, and reserve-release foundation remains current.
The Aerodrome classic launcher is fallback-only and is excluded from the approved launch bundle by
VEY-KANEO-741. The canonical approved path is documented in
`veydrift-uniswap-cca-v4-launch-VEY-741.md`. No transaction in this document is approved for Base
mainnet broadcast.

## Source parameters

The canonical `apps/frontend/public/whitepaper.pdf` was re-read and visually checked on 2026-07-21.
Sections 5.3, 6.2, 6.3, and 7 require:

- fixed 10,000,000,000-token supplies for vMETAL, vCRYSTAL, and vDEUT, with 6 decimals;
- no resource minting for liquidity; resource inventory comes from provable excess game reserves;
- exactly 1,000,000,000 VEYDRIFT at genesis, 18 decimals, and no inflation;
- 500M VEYDRIFT for the WETH-facing pool and 50M for each resource pool;
- 150M development tokens released linearly over five years;
- 100M contributor tokens vested over four years with a one-year cliff;
- 100M ecosystem tokens released linearly over six years;
- exactly four protocol-seeded routes: VEYDRIFT/WETH, vMETAL/VEYDRIFT,
  vCRYSTAL/VEYDRIFT, and vDEUT/VEYDRIFT; and
- user-defined slippage for swaps and time-weighted, never spot, prices for any protocol accounting.

The illustrative resource deposits are encoded in 6-decimal raw units: `333_333_000`,
`222_222_000`, and `133_333_000`. The illustrative WETH side is not encoded as a constant because
the paper specifies USD 5,000 at the contribution-time ETH/USD price. Nikita must approve the WETH
amount and implied opening valuation shortly before execution.

## Implemented architecture

### Resource supply and reserve release

`VeydriftResourceToken` has no `mint` function. Its no-mint implementation also rejects every future
UUPS upgrade. The existing live owner-upgradeable implementation can perform one final upgrade into
this implementation; after that, no owner can install a mint-capable implementation. The proxies and
their existing Ownable/ERC-20 storage remain unchanged.

`VeydriftGame.releaseExcessResourceReserves` delegates to the state-migration module and the linked
`VeydriftReserveRelease` library to keep every runtime below Base's EIP-170 size limit. It:

1. accepts an explicit treasury, release amount, and safety margin for each resource;
2. computes liabilities as total internal resources plus locked withdrawals;
3. requires the post-transfer game balance to cover liabilities plus the margin;
4. verifies the game lost and the treasury received exactly the requested amount;
5. applies all three resource releases atomically; and
6. emits `ExcessResourceReserveReleased` with amount, liability, margin, and remaining balance.

This is the only supported M/C/D path to the launch wallet. Do not mint inventory, impersonate the
game, transfer directly from the proxy by storage manipulation, or set a replacement reserve token.

### VEYDRIFT and releases

`VeydriftToken` is a non-upgradeable ERC-20 with no owner, minter, pauser, or proxy. Its constructor
mints the complete supply directly into two explicit liquidity recipients and three immutable release
wallets. Recipient addresses are deployment inputs; the repository supplies no beneficiary address.

The development and ecosystem wallets use fixed five- and six-year linear schedules. The contributor
wallet uses a four-year linear schedule with a one-year cliff (25% becomes vested at the cliff, then
vesting continues linearly). Beneficiaries cannot withdraw unvested tokens. OpenZeppelin vesting
wallet ownership remains transferable, so a beneficiary can transfer the economic right to future
releases; this does not accelerate or bypass the schedule and must be disclosed to reviewers.

### Classic volatile launch (fallback-only; excluded from the approved bundle)

`VeydriftLiquidityLauncher` creates all four pools in one transaction through Aerodrome's canonical
classic router. It supports volatile pools only, rejects any pre-existing canonical pair, verifies
token decimals and total supplies, pulls exact whitepaper amounts, sets exact minimum deposits,
revokes router approvals, and sends every LP token directly to an immutable `VeydriftLPLock`.
It cannot launch twice, add another pair, swap, rescue tokens, or change the lock.

Official discovery anchors as checked on 2026-07-21:

- Base WETH9: `0x4200000000000000000000000000000000000006`
- Aerodrome classic Router: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- Aerodrome classic PoolFactory: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`

The launcher discovers WETH and the default factory from the router at construction instead of
trusting duplicated configuration. Deployment must still assert the discovered values against the
published addresses and verified code.

References:

- Base WETH address: https://docs.base.org/base-chain/network-information/base-contracts
- Aerodrome deployments and classic contracts: https://github.com/aerodrome-finance/contracts
- Aerodrome pool types, TWAP, and concentrated tick guidance:
  https://github.com/aerodrome-finance/docs/blob/main/content/liquidity.mdx
- Slipstream contracts: https://github.com/aerodrome-finance/slipstream

## Venue decision: classic volatile or Slipstream full-range

The repository retains classic volatile only as a reviewed contingency. It is not the preferred or
approved first-launch path after VEY-KANEO-741 and must not be deployed or called in the Uniswap bundle.

| Decision | Classic volatile (implemented) | Slipstream full-range (modeled, not implemented) |
| --- | --- | --- |
| Economic curve | Constant-product volatile pool, appropriate for uncorrelated assets | Concentrated-liquidity position spanning the usable tick range |
| Capital behavior | Full range by design | Full range deliberately gives up most concentrated capital efficiency |
| Fee/tick input | Pool fee is factory-managed; record `getFee` immediately before launch | Emerging-token guidance suggests tick spacing 2000; verify enabled spacing and current fee module onchain |
| LP custody | Fungible LP ERC-20s held by `VeydriftLPLock` | ERC-721 position NFTs require a separately audited NFT lock |
| Maintenance | No range rebalancing | Full range avoids routine range rebalancing, but fee collection and NFT custody remain more complex |
| Script status | Atomic four-pool launcher and simulation are included | Do not adapt the classic launcher; create and review a separate position-manager launcher if selected |

Classic volatile is the current recommendation because these are uncorrelated, thin launch pairs; a
full-range Slipstream position has little capital-efficiency advantage while adding tick initialization,
NFT custody, position-manager, fee-module, and verification risk. This is an engineering recommendation,
not approval to execute.

Do not seed classic and Slipstream simultaneously. Do not seed a second DEX. If Slipstream is chosen,
the owner must approve the enabled tick spacing and fee, initial `sqrtPriceX96` for all four pairs,
full-range usable ticks, position manager and factory addresses, NFT lock, and postflight tooling before
any broadcast.

## Mandatory owner decisions

Launch execution is blocked until one UI-visible approval record names:

- the exact WETH contribution and implied VEYDRIFT opening valuation;
- launch treasury Safe and all three vesting beneficiaries;
- classic volatile or Slipstream full-range;
- observed classic fee, or Slipstream tick spacing and fee module;
- LP beneficiary, lock duration, and exact unlock timestamp;
- per-resource operational safety margins above live liabilities;
- launch timestamp and abort window; and
- the independent security reviewer approving the final bytecode, storage layout, and transaction
  simulation.

No placeholder, deployer EOA, test address, or beneficiary inferred from git history is acceptable.

## Preflight

All commands run from `packages/contracts`. Never paste secret values into tickets, shell history, PRs,
or manifests.

1. Pin a reviewed commit and reproduce validation:

   ```sh
   forge fmt --check
   forge build --sizes
   forge build --force --extra-output storageLayout
   node scripts/check-storage-layout.mjs
   forge test
   VEYDRIFT_BASE_MAINNET_RPC_URL=<redacted-rpc> forge test \
     --match-contract VeydriftLaunchMainnetForkTest -vv
   ```

2. Record chain id `8453`, latest block, game proxy implementation/admin slots, proxy owners, resource
   proxy implementations/owners, token supplies, game balances, internal liabilities, locked exits,
   and the approved margins. The fork test must match the live addresses in the owner approval.
3. Verify all new source contracts and linked libraries on Basescan. Compare deployed bytecode and
   library links to the reviewed build. Do not use an unverified implementation or linked library.
4. Dry-run `UpgradeResourceTokens.s.sol` and `UpgradeGame.s.sol` against the same pinned fork. Confirm
   the three resource implementations have no mint selector and reject a second UUPS upgrade.
5. Dry-run `DeployVeydriftToken.s.sol`. Confirm supply and every allocation, beneficiary, start time,
   vesting end, and contributor cliff.
6. Dry-run `DeployVeydriftClassicLaunch.s.sol`. Confirm router discovery, factory, WETH, launch authority,
   LP beneficiary, and unlock timestamp.
7. Assert all four classic volatile pools are absent. Any existing canonical pool is an abort, not a
   prompt to deposit at a changed ratio.
8. Compute the approved WETH amount from a named reference price and timestamp. Record the arithmetic;
   do not read AMM spot price to choose the amount.
9. Simulate the exact Safe bundle or EOA transaction sequence, including linked-library deployment,
   proxy upgrades, reserve release, exact approvals, and the atomic launch. Require zero unexpected
   token deltas and no unapproved call target.
10. Configure monitoring for receipts, events, proxy slots, token balances, four pool addresses,
    approvals, and LP-lock balances before sending the first transaction.

## Execution order

Every broadcast is OpenClaw owner work under the contract-upgrade handoff. This ticket and PR do not
authorize a broadcast.

1. Deploy and verify the three release wallets and `VeydriftToken` using approved recipients and start.
2. Deploy and verify the LP lock and one-shot launcher using the approved authority and unlock time.
3. Deploy the linked game libraries/modules/implementation. Upgrade the game proxy and verify storage,
   owner, module links, resource-token wiring, liabilities, locked exits, and normal game reads.
4. Perform the final resource-proxy upgrades. Verify supplies are unchanged, mint calls fail, and all
   future UUPS upgrades revert. This step is intentionally irreversible.
5. Call `releaseExcessResourceReserves` from the game owner/Safe with the exact approved amounts and
   margins. Verify the event and both sides of every token delta.
6. Consolidate the 650M VEYDRIFT liquidity allocation, WETH, and released M/C/D in the approved launch
   authority. Approve the launcher for the exact amounts only.
7. Execute one `launch(...)` call with a short deadline. Safe authorities must use reviewed calldata;
   do not export a Safe key to the Forge script. Existing-pool checks make a front-run pool creation
   revert the entire launch; the four adds themselves are atomic. Expect backrunning once the transaction
   lands and do not promise an execution price to buyers.
8. Run `VerifyVeydriftLaunch.s.sol`, revoke any unexpected residual approval, publish verified addresses
   and receipts, and begin monitoring.

## Postflight assertions

- exactly 1B VEYDRIFT exists; 650M is in the four canonical pools;
- each resource remains at exactly 10B total supply and has no mint or future upgrade path;
- game reserve balance is at least internal liabilities plus locked exits plus the approved margin;
- pool balances equal 500M VEYDRIFT plus approved WETH, and the three exact resource ratios;
- no protocol-seeded resource/WETH, resource/stable, duplicate DEX, stable, or Slipstream pool exists;
- all four LP balances are in the verified immutable lock and its unlock timestamp/beneficiary match
  approval;
- authority-to-launcher and launcher-to-router allowances are zero;
- token, vesting, library, implementation, launcher, lock, pool, proxy, and receipt addresses are
  verified and published from one signed manifest;
- frontend/router quotes enforce user-selected slippage across both hops; and
- no protocol accounting path reads AMM spot price. Any future price-dependent protocol feature must
  use a reviewed TWAP/oracle design.

## Abort and rollback

- Before a broadcast: abort on any address, codehash, owner, supply, liability, margin, fee, tick,
  timestamp, simulation, audit, or approval mismatch.
- Game upgrade before reserve release: upgrade back to the recorded previous implementation and module
  set with the same ProxyAdmin, then re-run storage and game-read checks.
- VEYDRIFT/vesting deployment before liquidity: publish the abandoned addresses and do not reuse them;
  deploy corrected contracts only after a new review.
- Resource no-mint upgrade: no rollback exists by design. Do it only after audit and fork proof.
- Reserve release before pool creation: the approved treasury may approve the game and call
  `depositResourceReserves` to return exact inventory; re-check backing before continuing.
- Atomic liquidity launch: no rollback exists. LP tokens are locked and cannot be withdrawn early.
  A failed launch transaction changes nothing; a successful launch is irreversible market creation.
- Never attempt rollback by replacing resource-token addresses, changing proxy storage directly,
  unlocking LPs, minting, or seeding compensating duplicate pools.

## Security review checklist

| Risk | Control and evidence |
| --- | --- |
| Mint authority | No mint ABI; final no-mint UUPS implementation rejects all later upgrades; supply tests and live-fork proof |
| Upgrade authority | Game remains ProxyAdmin-controlled with storage guard and rollback; resource upgrade is intentionally final |
| Reserve insolvency | Atomic liabilities + locked exits + explicit margin check; exact recipient delivery; fork test with live proxies |
| Decimal confusion | Launcher enforces 18 decimals for VEYDRIFT and 6 for M/C/D; raw amounts are constants and tested |
| LP rug/withdrawal | LPs mint directly to immutable time lock; no launcher rescue; beneficiary and term require approval |
| MEV/sniping | Four adds are atomic, pre-existing pool aborts, exact minima and short deadline; public trading after inclusion remains snip/backrun-exposed |
| Price manipulation | Sparse topology only; no protocol spot-price reads; user slippage and future TWAP/oracle review required |
| Vesting bypass | Fixed immutable schedules, tests before cliff and at completion, no admin acceleration; transferable beneficiary right is disclosed |
| Partial launch | One transaction creates all four pools or reverts; postflight requires all four canonical addresses |
| Contract size/linking | `forge build --sizes` keeps deployables under EIP-170; linked library addresses and bytecode must be verified |

## Timing recommendation

Do not encode or announce a timestamp until approvals, independent review, verified deployments, a
pinned fork simulation, monitoring, and launch communications are ready. After those gates, prefer a
weekday 14:00-17:00 UTC window with the full owner/security team online, at least 48 hours after
publishing verified contract addresses and risk disclosures. Avoid weekends, major Base/Aerodrome
maintenance, known chain incidents, and periods when signers or rollback operators are unavailable.
Re-check Base status, gas, ETH/USD reference input, Aerodrome addresses/fees, and sequencer health on
the launch day. The final timestamp remains Nikita's explicit decision, not an automated selection.
