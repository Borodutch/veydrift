# Wallet delegate contract rollout

Wallet delegation adds a cross-contract dependency: Alliance, Moon and paid invites resolve a
transaction signer through the Game proxy. The Game implementation therefore **must be upgraded
first**. Never deploy a delegation-aware Alliance or Moon implementation against an older Game.
Game/ProxyAdmin, Alliance/legacy paid invites, and Moon have distinct live owners: recheck each
authority and use its own signer for that stage; a Game-owner key cannot run the paid-invite import.

## Guarded order

1. Confirm production remains on its current application bundle and capture proxy implementations,
   owners, signers, balances, nonces and the legacy paid-invite address.
2. Run `UpgradeGame.s.sol` without `--broadcast`, then broadcast the unchanged script and verify the
   Game proxy exposes `effectivePlayer(address)` while existing state and wiring remain unchanged.
3. Pause Game through its owner. Verify `gamePaused() == true`. The upgraded pause guards freeze
   paid-invite purchases/redemptions, production accrual (including Alliance membership-boundary
   settlement) and resource bonus withdrawals. Game owner `withdrawFees` remains callable while
   paused; prohibit owner fee withdrawals between the snapshot and pointer switch, and monitor the
   Game ETH balance against the manifest's expected balance before import and after switch.
4. Generate a paid-invite snapshot with
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
5. Dry-run and then broadcast `MigratePaidAllianceInvites.s.sol`. It commits the snapshot hash in a
   new UUPS proxy, imports exactly once, verifies every restored field and deliberately leaves the
   Alliance pointer on the frozen legacy contract.
6. Dry-run and then broadcast `UpgradeAllianceSystem.s.sol` with
   `MIGRATED_PAID_ALLIANCE_INVITE_ADDRESS`. The script refuses to proceed unless Game delegation is
   available, Game is paused, the migration is finalized and its source equals the current pointer.
   A configured legacy paid-invite pointer cannot be silently left in place by omitting the target.
   It upgrades Alliance and switches the pointer in that order. Re-verify the frozen source fields
   against the snapshot and the Game ETH balance immediately before switch; any source or owner
   balance drift halts the rollout while Game stays paused.
7. Update backend paid-invite address and index-from-block to the new proxy deployment block. Its
   canonical import events rebuild the projection from the new address without adding legacy rows
   twice. Verify outstanding invites, redeemed history, balances, pending balances and secret
   recovery before unpausing.
8. Unpause Game, then dry-run and broadcast `UpgradeMoonSystem.s.sol`. The Moon script also rejects
   an older Game without `effectivePlayer(address)`. Game accepts paid-invite fees only from the
   Alliance's current pointer, so stale clients cannot purchase orphaned invites at the old address.
9. Deploy backend/frontend, then prove main and delegate actions, main-only delegate replacement,
   two-party revocation, paid invites, Alliance, Moon, referral recipient safety and admin isolation.

## Failure recovery

- Before Game pause: keep the old application bundle and stop.
- After pause but before migration finalization: leave Game paused. The legacy paid-invite contract
  remains the active pointer and its state is frozen. Fix the manifest or resume with
  `PAID_ALLIANCE_INVITE_TARGET_ADDRESS`.
- After migration finalization but before Alliance switch: leave Game paused. The imported proxy is
  inert and the legacy pointer remains authoritative.
- After Alliance switch: do not point back to the mutable legacy contract. Keep Game paused, repair
  backend configuration/verification, then continue forward.
- Never unpause while backend/indexer configuration points at a different paid-invite contract than
  `Alliance.paidInviteSystem()`.
