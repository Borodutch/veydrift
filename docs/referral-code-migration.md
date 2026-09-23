# Referral code ownership migration

The replacement `VeydriftReferralSystem` starts with public code claims disabled. The authorized
deployment owner must migrate the complete source code inventory and explicitly finalize migration before
the game/runtime pointer is switched.

The data-preservation requirements below remain mandatory. Migration must respect the current
live-upgrade policy; see [Cutover and rollback](#cutover-and-rollback)
before using any migration script. This document does not authorize a new replacement.

## Build the migration manifest

1. Pause Game, then freeze the standalone source with `FreezeReferralSystem.s.sol` while paused.
   Keep Game paused during snapshot/import; the source `game()` must remain zero. Pass a caught-up
   backend index inventory with `indexFromBlock` at or before the verified source deployment,
   `indexCursorBlock` at or beyond the frozen `snapshotBlock`, and exact `snapshotBlockHash` to
   `scripts/veydrift-referral-migration-manifest.mjs`. The generator proves no code existed at
   `indexFromBlock - 1`, scans all canonical source logs to the pinned block in bounded chunks
   (`--historical-rpc-url` and `--log-chunk-size` when the verified archive provider supports it),
   and compares the candidate claim/redemption/reward-claim references to the source inventory.
   No unindexed event may be omitted. For each source event, fetch the status-1 receipt and require
   matching contract, log index, block hash, and event fields. JSON-only timestamps/owners are not
   authoritative. Generate only a mode-0600 private manifest under `packages/contracts/manifests`;
   never include credentials or signing material.
2. Exclude rows without a successful receipt or matching decoded claim event. Regenerate the complete
   inventory from the reviewed frozen source for every replacement; never reuse an old count or
   manifest. JSON-only rows are never migration entries.
3. Preserve the exact decoded source commitment. Every current-source
   `ReferralLegacyCodeOwnershipImported` event must have one 43-character preimage candidate;
   require that candidate's `importTxHash` match the source event's successful receipt and that
   its normalized hash, owner and raw-code commitment match. If a preimage is missing, stop—do
   not substitute a backend JSON row or silently drop hash-only ownership. The original legacy
   claim events used
   `keccak256(originalCaseSensitiveCodeBytes)`; replacement referral contracts use the canonical
   `keccak256(abi.encode(inviter, normalizedCodeHash))` commitment. The importer accepts only those
   two receipt-verifiable shapes. Separately normalize the code to lowercase and derive the
   canonical ownership hash. Values in `[A-Za-z0-9_-]` with 1–24 characters are valid-code entries.
   Receipt-confirmed 43-character values are hash-only entries; invalid characters,
   other overlength sizes, or any receipt/owner/code/commitment mismatch stop the rollout.
4. Group rows by normalized code hash. A hash with multiple distinct wallets is a pre-upgrade
   collision. Stop the rollout and record an explicit canonical owner decision for every collision.
   Never let list order choose the owner.
5. Collapse repeated claims by the same owner/code to the latest authoritative activation
   timestamp. Preserve all distinct code ownership, but only the wallet's latest activation is its
   permanent usable code. That timestamp is the latest manual top-up boundary, not an expiry.
6. Archive the reviewed manifest, receipt/event evidence, and its SHA-256 hash as deployment
   evidence. The manifest contains public codes/addresses/timestamps only; it must not contain keys,
   tokens, or RPC credentials.

## Commit the reviewed manifest on chain

Each unique row contributes one domain-separated leaf. The valid leaf is:

```text
keccak256(abi.encode(uint8(1), owner, normalizedCodeHash, legacyCommitment, activatedAt))
```

The hash-only leaf is:

```text
keccak256(abi.encode(uint8(2), owner, legacyCodeHash, legacyCommitment))
```

XOR the unique leaves within each class. XOR is intentional so bounded batches can arrive in any
order; the contract separately rejects a second import of the same code hash and enforces the exact
reviewed count. Before importing any row, commit both reviewed count/digest pairs exactly once:

```text
configureReferralCodeMigration(validDigest, validCount, hashOnlyDigest, hashOnlyCount)
```

Configuration rejects zero/non-zero digest/count mismatches and cannot be replaced. A wrong owner,
code hash, commitment, timestamp, missing row, duplicate row, or extra row leaves the imported
count/digest pair unequal to the reviewed pair, so finalization fails closed.

For every replacement after referrals have gone live, build a third receipt/event-backed manifest
from every successful `ReferralInviteRedeemed` emitted by the current canonical referral contract.
Do not use backend JSON alone. Require the exact emitting address, a status-1 receipt, and decoded
`inviter`, `invitee`, `commitment`, and `redeemedAt` values. The redemption leaf is:

```text
keccak256(abi.encode(uint8(3), inviter, invitee, commitment, redeemedAt))
```

XOR all unique redemption leaves and explicitly commit the count/digest pair, including an explicit
zero/zero configuration when the source contract has no redemptions:

```text
configureReferralRedemptionMigration(redemptionDigest, redemptionCount)
```

Before importing, audit *all* current-source redemption events (including earlier
`ReferralRedemptionImported` rows) and reward-claim receipts, every `paid`/`credited` outcome,
source `referralRewardCredits(commitment,invitee)`, per-inviter
`claimableReferralRewards`/`totalReferralRewardsAccrued`/`Paid`/`Claimed`, and ETH balance at the
frozen block. The replacement commits full redemption metadata and re-emits canonical historical
redemption and settled-claim events so an address-scoped backend rebuild retains history.
Historical reward counters have their own committed importer; credited redemptions with later
matching paid claims are supported. Outstanding credit, claimable balance, inconsistent totals or
unexplained ETH **block** release. Source balance zero by itself is not proof of zero liabilities.
The reviewed reward-stat leaf is
`keccak256(abi.encode(uint8(4),inviter,accrued,paid,claimed))`; the claim-history leaf uses
`uint8(5),inviter,invitee,commitment,recipient,amount,claimedAt`; full redemption history uses
`uint8(6),inviter,invitee,commitment,redeemedAt,rewardAmount,paid,credited`. Commit all three
count/digest pairs exactly once, including explicit zero/zero where applicable. Do not submit an
old three-class manifest to the five-class replacement.

## Import and verify

Submit bounded valid-code batches, passing each decoded legacy commitment as the fourth array:

```text
migrateReferralCodes(
  address[] inviters,
  string[] codes,
  uint64[] activatedAts,
  bytes32[] legacyCommitments
)
```

The contract lowercases and validates every valid code again, requires `legacyCommitment` to equal
either the original raw-code commitment or the source replacement's canonical owner-bound
commitment, and reverts the entire batch with
`ReferralCodeAlreadyOwned(codeHash, owner)` if a normalized code is assigned to another wallet.
The committed manifest leaf binds that receipt-proven value to the reviewed owner, normalized code
hash, and activation timestamp. Altering an owner or timestamp changes the imported digest and makes
finalization revert. That makes an unresolved collision or altered receipt row non-deployable. The
new active invite commitment is still derived separately as
`keccak256(abi.encode(inviter, normalizedCodeHash))`; public claim and redemption binding never use
the legacy raw-hash rule.

Import only receipt-confirmed overlength claims in the reviewed hash-only manifest through this path:

```text
migrateLegacyReferralCodeOwnership(
  address[] inviters,
  string[] legacyCodes,
  bytes32[] legacyCommitments
)
```

This path accepts only the reviewed 43-character URL-safe shape, verifies the historical commitment
as the raw `keccak256` of the original case-sensitive bytes, permanently sets ownership of the
canonical lowercase hash, and emits `ReferralLegacyCodeOwnershipImported`. It does not create a new
commitment, invite record, activation timestamp, active window, or redemption surface. The normal
public validator remains 1–24 characters, and hash-only migration entries are also explicitly barred
from public activation. Never pass an unconfirmed JSON-only row to either import function.

After all valid code activations have been imported, import the audited redemption rows in bounded
batches:

```text
migrateReferralRedemptionsWithHistory(
  address[] inviters,
  address[] invitees,
  bytes32[] commitments,
  uint64[] redeemedAts,
  uint256[] rewardAmounts,
  bool[] paid,
  bool[] credited
)
```

Each row must reference an already imported canonical commitment and matching inviter, contain a
nonzero invitee and nonfuture timestamp, and be unique globally and for that commitment. Import sets
both `referralInviteeRedeemed(invitee)` and `referralRedemptions(commitment, invitee)` so a wallet
cannot receive a second referral after replacement. A timestamp consumes capacity only when it is
at or after the commitment's latest imported activation/top-up. Older rows still preserve replay
protection but do not consume the current top-up's capacity. Capacity never refills with elapsed
time; more than three current-epoch timestamps for one commitment fail closed.

For every manifest row, verify `referralCodeOwner(codeHash)` and
`referralCodeMigrationKind(codeHash)`. For each valid-code row, verify the emitted
`ReferralCodeOwnershipClaimed` / `ReferralInviteWindowActivated` values and the wallet's latest
activation through `referralInviteState(wallet)`. For every hash-only row, verify the dedicated
`ReferralLegacyCodeOwnershipImported` event and confirm `referralCommitmentOf(owner)`,
`referralClaimedAt(commitment)`, and `referralInvites(commitment)` were not populated by that row.
Compare valid/hash-only/redemption/reward-claim/reward-stat expected/imported digests and counts,
then verify historic receipts, active quotas, imported balances (zero escrow), emitted redemption
and reward-claim history, and `totalReferralRewards*` counters before calling:

```text
finalizeReferralCodeMigration()
```

Verify each source-imported invitee through both replay getters, each active commitment's
`referralRedemptionQuota`, every source `referralRewardCredits` zero, and exact
`totalReferralRewardsAccrued/Paid/Claimed` parity. Require explicit code, redemption, settled
reward-claim history and reward-stat configuration/import count+digest equality before finalization.

Finalization is one-way and contract-enforced: it reverts unless all five configured count/digest
pairs exactly match their imports. Use the complete current receipt-backed inventory, including
all public claims and redemptions. Confirm `referralMigrationFinalized() == true`; the post-deploy smoke
script also enforces this gate and `REFERRAL_CODE_MAX_LENGTH() == 24`.

## Cutover and rollback

The Game upgrade script enforces
[VeydriftLiveUpgradePolicy](../packages/contracts/src/libraries/VeydriftLiveUpgradePolicy.sol):
it rejects a paused Game and requires live moon-parity/temperature readiness. The authorized
staged order is **pause Game → freeze source `game` pointer → snapshot and import into an inert new
standalone referral → verify all five committed classes and zero outstanding escrow → unpause
Game while source remains frozen → upgrade Game with distinct source/target addresses**. Never
remove the live policy guard to fit the freeze; between unpause and Game upgrade, referral actions
remain unavailable while other gameplay continues. This visible interruption requires parent
rollout approval and a bounded recovery checkpoint.

`UpgradeGame.s.sol` refuses the old standalone address as target and requires a frozen source,
matching owners/signers, zero source ETH, finalized target and committed reward/history classes.
It embeds the **new** referral address in both Game settlement/state-migration modules. Before the
Game switch, only an authorized owner may restore source `game` if a rollback is chosen and no
replacement activity occurred. After target starts receiving claims/redemptions, never switch Game
back to the frozen source without a separately audited reverse state migration: it would reopen
eligibility or strand credits. The full Game→referral→Alliance→Moon order is in
[Wallet delegate contract rollout](wallet-delegate-rollout.md).

After cutover, set backend `VEYDRIFT_REFERRAL_SYSTEM_ADDRESS` and
`VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK` to the replacement's address and safe deployment boundary.
The importer emits canonical historical claim, redemption and settled reward-claim events. The
writer replaces old-address referral projections only after the new backfill has been applied,
then records the address/boundary marker. Confirm a restart with an interrupted marker does not
double-count rows. Verify the backend's configured private referral signer resolves to the **same**
address as source and replacement `referralSigner()`; signatures remain bound to the unchanged
Game proxy and chain ID. Preserve the existing recovery/index database and check code-preimage
ownership, main/delegate claim, payout recipient restriction, revocation, quotas and public
history before enabling the new frontend.

Use the [contract deployment runbook](veydrift-contract-redeploy-runbook.md) and
[state-preservation policy](open-alpha-state-preservation.md) for the approval and evidence gates.

## Referral history indexing

Set `VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK` on the Easypanel-managed backend service to the
replacement referral deployment block (or another reviewed safe boundary at or before its first
canonical event). Do not reuse a boundary from another address or migration. On the writer's first successful poll, the backend scans only the configured referral address
and the `ReferralInviteWindowActivated`, `ReferralInviteRedeemed`, and `ReferralRewardClaimed`
topics (including the replacement's historic re-emissions) through the current head. It persists an
address/boundary completion marker after every log is applied; the marker makes restarts cheap, while
an address or boundary change deliberately reruns the idempotent scan. Inspect
`chainSync.referralHistoryBackfill` on `/health` for the completed range or a readiness-blocking error.
Do not delete or rebuild the shared index database for this repair.

If verification fails, stop the cutover and preserve the manifest, receipts and before/after evidence.
Do not delete state, discard an active deployment or improvise an on-chain rollback.
