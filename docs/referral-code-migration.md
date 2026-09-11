# Referral code ownership migration

The replacement `VeydriftReferralSystem` starts with public code claims disabled. The authorized
deployment owner must migrate the complete source code inventory and explicitly finalize migration before
the game/runtime pointer is switched.

The data-preservation requirements below remain mandatory. Migration must respect the current
live-upgrade policy; see [Cutover and rollback](#cutover-and-rollback)
before using any migration script. This document does not authorize a new replacement.

## Build the migration manifest

1. Use the backend recovery store only as a candidate transaction/code inventory. For every row
   with a transaction hash, fetch the receipt, require status `1`, and decode the historical claim
   event from the emitting legacy referral contract. Derive the owner, code hash/commitment, and
   activation block timestamp from that receipt/event. JSON timestamps and owners are not
   authoritative.
2. Exclude rows without a successful receipt or matching decoded claim event. Regenerate the complete
   inventory from the reviewed frozen source for every replacement; never reuse an old count or
   manifest. JSON-only rows are never migration entries.
3. Preserve the exact decoded source commitment. The original legacy claim events used
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

Before importing, audit every source redemption's `paid` / `credited` event values and the source
contract's balance, `claimableReferralRewards`, and per-redemption credit state. The current replay
migration preserves eligibility and quota state, not escrowed ETH or credit accounting. If any
outstanding credit or unexplained contract balance exists, stop the rollout and add a separately
audited credit migration; never strand funds by switching the game/runtime pointer.

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
migrateReferralRedemptions(
  address[] inviters,
  address[] invitees,
  bytes32[] commitments,
  uint64[] redeemedAts
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
Compare all four expected/imported count/digest getters before calling:

```text
finalizeReferralCodeMigration()
```

Also compare `referralMigrationExpectedRedemptionHash/Count` with
`referralMigrationImportedRedemptionHash/Count`, verify every imported invitee through both replay
getters, and compare each active commitment's `referralRedemptionQuota` with the source contract.
Finalization requires an explicit redemption migration configuration and exact redemption
count/digest equality in addition to the valid and hash-only code manifests.

Finalization is one-way and contract-enforced: it reverts unless all three configured count/digest
pairs exactly match their imports. Use the complete current receipt-backed inventory, including
all public claims and redemptions. Confirm `referralMigrationFinalized() == true`; the post-deploy smoke
script also enforces this gate and `REFERRAL_CODE_MAX_LENGTH() == 24`.

## Cutover and rollback

Both current Game and Moon upgrade scripts enforce
[VeydriftLiveUpgradePolicy](../packages/contracts/src/libraries/VeydriftLiveUpgradePolicy.sol).
They reject a paused Game. The Game upgrade additionally requires prior live moon-parity and
temperature-migration readiness. Do not pause gameplay or remove these checks. Concurrent source writes can invalidate a migration
manifest, so the plan must explicitly control them without assuming a paused Game.

A future referral replacement needs an explicitly approved, simulated live-compatible cutover
plan before any freeze, deployment or pointer change. It must cover:

1. A stable source boundary and all writes during cutover. `FreezeReferralSystem.s.sol`
   clears the source's Game pointer and blocks claims/top-ups/redemptions; that has user-visible
   consequences even while the Game is unpaused. The plan must explicitly approve the freeze
   behavior and restoration path rather than assuming it is transparent.
2. A freshly generated `veydrift-referral-migration-manifest.mjs` artifact from a caught-up index at
   that reviewed boundary, with every receipt/log, canonical hash, commitment, balance and credit
   reverified. Earlier candidate manifests are evidence only, not broadcast inputs.
3. The replacement's Game pointer remaining zero during import. `MigrateReferralSystem.s.sol`
   consumes the final mode-0600 manifest, imports bounded batches, verifies all three count/digest
   pairs and finalizes before claims/redemptions are enabled.
4. Exact live-upgrade preconditions, storage layout, proxy/module wiring, Game/referral owners,
   start price, moon-generation compatibility and resource invariants. Mixed versions must remain
   safe for in-flight gameplay; this document does not supply a new live state-migration design.
5. Backend referral-history replay, permanent ownership, latest top-up timestamps and capacity
   parity, followed by matching frontend validation before declaring the cutover complete.
6. Before-switch restoration of the source pointer if a freeze was performed. After a switch,
   account for every new claim, redemption and credit before approving rollback: simply restoring
   an old module can lose state or reopen already-consumed eligibility. Do not mutate application
   pointers until the corresponding on-chain path is verified.

Use the [contract deployment runbook](veydrift-contract-redeploy-runbook.md) and
[state-preservation policy](open-alpha-state-preservation.md) for the approval and evidence gates.

## Referral history indexing

Set `VEYDRIFT_REFERRAL_INDEX_FROM_BLOCK` on the Easypanel-managed backend service to the
replacement referral deployment block (or another reviewed safe boundary at or before its first
canonical event). Do not reuse a boundary from another address or migration. On the writer's first
successful poll,
the backend scans only the configured referral address and only `ReferralInviteWindowActivated`,
`ReferralInviteRedeemed`, and `ReferralRewardClaimed` topics through the current head. It persists an
address/boundary completion marker after every log is applied; the marker makes restarts cheap, while
an address or boundary change deliberately reruns the idempotent scan. Inspect
`chainSync.referralHistoryBackfill` on `/health` for the completed range or a readiness-blocking error.
Do not delete or rebuild the shared index database for this repair.

If verification fails, stop the cutover and preserve the manifest, receipts and before/after evidence.
Do not delete state, discard an active deployment or improvise an on-chain rollback.
