# Wallet delegate contract rollout

Wallet delegation adds a cross-contract dependency: Alliance, Moon and paid invites resolve a
transaction signer through the Game proxy. After the standalone referral source is frozen and
replaced, Game **must** be upgraded before Alliance or Moon; never deploy either delegation-aware
consumer against an older Game.
Game/ProxyAdmin/referral, Alliance/legacy paid invites, Moon, and the UUPS migration settlement
have distinct live authorities: recheck each signer separately. The currently deployed referral
system is standalone and lacks `effectivePlayer(address)`; **never** pass its address to
`UpgradeGame.s.sol` as the delegation-aware referral target.

## Guarded order

1. Confirm production remains on its current application bundle and capture proxy implementations,
   owners, signers, balances, nonces, legacy paid-invite address, the standalone referral source,
   its signer/claimed code/redemption/reward state, and the migration-settlement proxy.
2. Stage the **referral replacement first**, using the [referral migration procedure](referral-code-migration.md).
   Game owner pauses Game, referral owner freezes source `game` to zero, then takes a canonical
   receipt/log-backed snapshot from the frozen address including legacy hash-only ownership,
   activations, replay/quota, paid and later-claimed rewards, and source counters. Source ETH,
   outstanding credits and per-inviter claimable balances must all be zero; nonzero blocks cutover.
   Deploy a fresh delegation-aware standalone target with the same owner/signer, import the four
   committed code/hash-only/redemption/reward-stat classes in bounded batches, finalize, and verify
   every imported getter. Keep the target Game pointer unset until the Game upgrade. If any step
   fails, keep Game paused and the source frozen; only an authorized recovery may restore the source.
3. Game owner unpauses Game **only after** the replacement is fully verified. With source still
   frozen, Game upgrades are permitted by the live policy, but referral actions are temporarily
   unavailable until the implementation switch. Dry-run `UpgradeGame.s.sol` with both
   `VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS` (frozen old contract) and
   `VEYDRIFT_REFERRAL_SYSTEM_ADDRESS` (finalized new target), then broadcast only after exact
   signer/nonce/code checks. Verify the new Game embeds the replacement in its settlement/state
   modules, and direct main/delegate referral claims and safe withdrawal target the replacement.
   Freeze is a visible service interruption and requires the parent's explicit staged release plan.
4. Dry-run and upgrade the UUPS migration-settlement proxy with
   `UpgradeMigrationSettlement.s.sol` and `GAME_PROXY_ADDRESS` after Game delegation is live;
   require a nonzero, actually reserved `MIGRATION_TEST_PLAYER` for before/after reservation hashing.
   The script rejects the wrong owner, missing Game delegation, nonproxy implementation slot,
   changed Game/signer/owner or reservation, and missing delegated claim selector. Preserve
   the existing signed full-state payload and reservation. Until then, a reserved main's delegate **cannot** submit an
   ordinary first-planet start or a legacy `claim(msg.sender)` as a substitute; the client must
   fail closed. The new `claimForDelegate` and `claimWithReferralForDelegate` resolve the actor
   on-chain, retain the main's signed state and reservation, and reject revoked delegates.
5. Pause Game again through its owner. Verify `gamePaused() == true`. The upgraded pause guards freeze
   paid-invite purchases/redemptions, production accrual (including Alliance membership-boundary
   settlement) and resource bonus withdrawals. Game owner `withdrawFees` remains callable while
   paused; prohibit owner fee withdrawals between the snapshot and pointer switch, and monitor the
   Game ETH balance against the manifest's expected balance before import and after switch.
6. Generate a paid-invite snapshot with
   `scripts/generate-paid-alliance-invite-migration.mjs`. The generator requires a paused Game and
   reads all canonical purchase/redemption logs plus live invite, issuance, packed remainder,
   balance and pending-balance state at one block. `RPC_URL` is the authoritative frozen-state
   endpoint; `HISTORICAL_RPC_URL` may point to a separate archive provider for the bounded legacy
   log scan. Set `PAID_ALLIANCE_INVITE_INDEX_FROM_BLOCK` at or before the verified legacy deployment
   block: the generator proves the contract had no code at the preceding block, and rejects a
   mismatched snapshot block hash, nonzero ETH stranded at the legacy contract, or an unpaused Game.
   The default log range is 1,000 blocks (compatible with Base's public RPC); only raise
   `PAID_ALLIANCE_INVITE_LOG_CHUNK_SIZE` up to 50,000 if an archive provider supports larger ranges.
   Write `PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE` to
   `manifests/private-paid-invite-migration.json` from `packages/contracts`: Foundry permits script
   reads there, and Git ignores this exact file. Preserve it outside the PR, including the expected
   Game treasury balance, for the dry run and recovery. Measure import calldata bytes and gas
   against Base's transaction cap using this **exact frozen manifest**: public active-alliance
   counts omit historical inactive alliances and cannot prove the full import fits.
7. Dry-run and then broadcast `MigratePaidAllianceInvites.s.sol`. It commits the snapshot hash in a
   new UUPS proxy, imports exactly once, verifies every restored field and deliberately leaves the
   Alliance pointer on the frozen legacy contract.
8. Dry-run and then broadcast `UpgradeAllianceSystem.s.sol` with
   `MIGRATED_PAID_ALLIANCE_INVITE_ADDRESS`. The script refuses to proceed unless Game delegation is
   available, Game is paused, the migration is finalized and its source equals the current pointer.
   A configured legacy paid-invite pointer cannot be silently left in place by omitting the target.
   It upgrades Alliance and switches the pointer in that order. Re-verify the frozen source fields
   against the snapshot and the Game ETH balance immediately before switch; any source or owner
   balance drift halts the rollout while Game stays paused.
9. Update backend referral and paid-invite addresses/index-from-block to each replacement's
   deployment block, then verify historical replay, reward counters/quota, and paid-invite secret
   recovery. Paid-invite canonical import events rebuild the projection from the new address
   without adding legacy rows twice. Verify outstanding invites, redeemed history, balances and
   pending balances before unpausing.
10. Unpause Game, then dry-run and broadcast `UpgradeMoonSystem.s.sol`. The Moon script also rejects
   an older Game without `effectivePlayer(address)`. Game accepts paid-invite fees only from the
   Alliance's current pointer, so stale clients cannot purchase orphaned invites at the old address.
11. Deploy backend/frontend only after referral replacement and migration ABI gates, then prove
   main/delegate actions, both revocations, reserved-main settlement with/without referral, paid
   invites, Alliance, Moon, safe referral withdrawals and admin isolation.

## Failure recovery

- Before referral freeze: keep the old application bundle and stop.
- After referral freeze but before Game switch: keep Game paused during import; if later unpaused
  for the Game upgrade, source referral actions remain unavailable. Do not point the new Game at
  the frozen source. Revalidate the full manifest/reward balances; restoration of source `game`
  is an explicit owner-controlled rollback only before new-target activity. Once target activity
  begins, continue forward—restoring old source would reopen spent eligibility.
- If migration settlement is not upgraded, keep reserved delegates fail-closed in the client;
  existing main-only claims retain their prior path.
- After pause but before migration finalization: leave Game paused. The legacy paid-invite contract
  remains the active pointer and its state is frozen. Fix the manifest or resume with
  `PAID_ALLIANCE_INVITE_TARGET_ADDRESS`.
- After migration finalization but before Alliance switch: leave Game paused. The imported proxy is
  inert and the legacy pointer remains authoritative.
- After Alliance switch: do not point back to the mutable legacy contract. Keep Game paused, repair
  backend configuration/verification, then continue forward.
- Never unpause while backend/indexer configuration points at a different paid-invite contract than
  `Alliance.paidInviteSystem()`.
