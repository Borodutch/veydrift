# VEY-468 Deploy + Phase 4 Runbook (for supervised execution)

State as of 2026-06-11 23:32 PDT. Branch `veydrift/lazy-onchain-reconcile-468`, PR #828, worktree `/Users/borodutch/code/veydrift-vey468`.

## What's DONE + green (deploy-safe)
- **Contracts**: lazy on-chain reconciliation for research, ship, defense, building, moon-building, fleet arrivals (deterministic) + returns, combat arrivals (randomness-gated). `forge test` **267/267 pass**. Storage-layout preservation (`scripts/veydrift-alpha-state-preservation-check.mjs`) **passed**.
- **Backend**: `MissionResolutionService` keeper removed; `RandomnessCommitterService` KEPT; `settleQueueAsOfNow` projects elapsed levels/counts. `bun test` 284/284 + `bun run check` green (last verified prior wake).
- `finish*` functions (`finishBuildingUpgrade`, `finishShipProduction`, `finishDefenseProduction`, `finishResearch`, `finishMoonBuildingUpgrade`, `completeFleetMissionReturn`) are RETAINED as compatibility no-op paths — they no-op if the prologue already settled. **So the deploy does NOT break the existing frontend; finish buttons just become harmless no-ops.**

## Why not deployed/finished autonomously
- Deploy is a live-game proxy upgrade rewriting settlement on every mutating call → needs live QA + owner go-ahead, not a blind night push.
- Phase 4 frontend removal is decoupled UX cleanup (buttons no-op post-upgrade); no urgency, and blind edits to a 5,685-line file with no live render = silent regression risk. Better done supervised.

## DEPLOY steps (do with Nikita awake / live QA ready)
1. **Upgrade script is now written + verified**: `script/UpgradeGame.s.sol:UpgradeGame` (added this wake). It deploys a fresh module set + new `VeydriftGame` impl and calls `ProxyAdmin.upgradeAndCall(proxy, newImpl, "")` from the ProxyAdmin owner — the exact proven path (matches the 2026-06-11 manual upgrade tx `0xbf1890…`). VeydriftGame holds its modules as `immutable` (baked into bytecode) and stores moon/alliance/randomness/resource-token wiring in proxy storage via setters, so the upgrade preserves all state. The repo's old `script/Upgrade.s.sol` is the misleading revert stub — **do NOT use it**; use `UpgradeGame`.
   - **Live-fork verified** (this wake): `BASE_SEPOLIA_RPC=https://sepolia.base.org forge test --match-contract UpgradeGameFork -vv` forks live Base Sepolia, performs the upgrade as the real ProxyAdmin owner, and asserts the impl slot flips to the new code while `owner()` + a real planet's ship count are preserved. **PASSED.** Inert in the default suite (no RPC → skips).
   - Dry run before broadcast: `forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url <rpc>` (no `--broadcast`).
2. Env: `GAME_PROXY_ADDRESS=0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2`, `GAME_PROXY_ADMIN=0xef1570EC118de0c3dC2219C1ee3B731b46f6F54B`, `PRIVATE_KEY` from Vaultwarden 'Veydrift Base Sepolia deployer' (= ProxyAdmin owner `0xC2142A4918754abe5975ecD486A66DfeBA39A419`; script asserts `BROADCASTER_NOT_PROXY_ADMIN_OWNER` if the wrong key is used). RPC = self-hosted Base Sepolia node `http://178.63.102.149:8545` (or Alchemy if node not yet synced). Current live impl before upgrade: `0xe5b7664a9b00d7150e1a46a5049168c6a75dc421`.
3. Moon: `VeydriftMoonSystem` is **UUPS** — separate upgrade.
4. Deploy backend (swarm service `veydrift_backend-test` on 148.251.0.158, api-test.veydrift.com) + frontend (EasyPanel).
5. **Live verify**: start a building/ship/defense/research/moon upgrade, let it mature, then make ANY mutating call (or just read asOfNow) and confirm it completes WITHOUT a finish tx. Confirm fleet arrivals/returns settle lazily. Capture screenshots → Telegram + Kaneo VEY-468.

## PHASE 4 frontend removal (decoupled; can land after deploy)
Surfaces (remove finish/land buttons + wiring; KEEP rift `sendFinishResourceWithdrawalTransaction` and combat `sendResolveFleetMissionTransaction`):
- `apps/frontend/src/components/MoonPage.tsx`: `onFinishBuilding` prop + "Finish" button (~L212-219).
- `apps/frontend/src/components/OverviewPage.tsx` + `InfrastructurePage.tsx`: building/ship/defense/research finish actions.
- `apps/frontend/src/PlayableMvpApp.tsx`: ~147 finish/complete refs — the wiring that passes finish handlers down.
- `apps/frontend/src/walletFlow.ts`: `sendFinishMoonBuildingUpgradeTransaction` (L2154), `sendFinish*`/`sendComplete*` building/ship/defense/research senders. `Land` button + `sendCompleteFleetMissionReturnTransaction` already removed in PR #821 (now test-only ref).
- Update `walletFlow.test.ts` + finish tests (~4,156 lines reference manual completion).
- Keep typecheck + frontend tests green after each slice.

## Kaneo
VEY-468 (`lzxhpdbczu9ekgsedhjzc59v`) is parked in `in-review` to stop Symphony re-leasing. Move to `testing`/`done` ONLY after deploy + live verify. Do NOT move to in-progress/to-do/rework.
