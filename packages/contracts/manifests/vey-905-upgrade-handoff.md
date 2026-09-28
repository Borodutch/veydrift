# VEY-KANEO-905 contract handoff (keyless; no deployment authorization)

Game proxy: Base mainnet `0xf397910F005151b09644228573a4353818D3755d`.
ProxyAdmin: `0xc81609E77b5ea79d0CdA9794b75B65D567535cb9`.
Canonical script: `script/UpgradeGame.s.sol` (no broadcast without exact PR/head greenlight).

## Semantics

- An attack settles strictly earlier scheduled Returning/Recalled missions before combat; arrival wins a timestamp tie. Later returns stay in flight despite resolution delay.
- Attacks on the same planet/moon pair resolve in (arrivalAt, missionId) order, conservatively across bodies because their queue/ownership hooks are shared.
- Return completion can cross a later pending arrival, never an earlier/equal one. Earlier unresolved outbound round trips block impact until the result is known; no recursive resolution or invented survivors.
- The existing bounded hostile-arrival index and a new 12-entry return scan progress across resolver calls. Landing one return ends that preparatory call; swap-and-pop invalidates its cursor. A successful resolver tx may be progress, not terminal completion, as with existing gas-bounded battle rounds.
- Append-only Game storage: slot 77, `mapping(uint256 => uint256) _attackReturnScanCursor`. Existing storage unchanged. Recalled direct missions stay indexed until return completion.

## Rollout

Requires a new Game implementation (constructor embeds BatchTransport), PlanetManagement, Gameplay, and every module inheriting resolution-index invalidation. Use the canonical full module deployment in UpgradeGame, not mixed old/new index writers. DefenseHold replaces its mobile-ship quantity branch ladder with equivalent validated-calldata indexing (skipping Satellite/Crawler) to retain EIP-170 headroom. No Moon proxy or randomness upgrade and no ABI selector changes.

Order: exact-head independent review and greenlight in Veydrift upgrades topic; main-session keyless simulation/preflight; compatible keeper/backend first; Game proxy upgrade with empty calldata; config/manifest reconciliation and postdeploy smoke; frontend only if changed. Workers must not merge/deploy/sign/broadcast.

## Verification notes

- Upgrade size check passes: Game 23,913 bytes; Gameplay 24,554; PlanetManagement 23,640; DefenseHold 24,246.
- `bun run check:storage` passes (v1 prefix preserved; exactly reviewed slot-77 append).
- Deterministic scheduled-return regression: 15/15 pass. Game suite: 306/306 pass. Moon suites: 82/82 pass. Formatting, diff whitespace, and live-upgrade policy checks pass.
- Two older fixtures assumed the behavior being corrected: resolving a slower attack ahead of a faster one, and a fleet-save whose scheduled round trip actually ended before impact. They now resolve by impact order and explicitly assert the saving fleet stays away through impact.
- Keyless live-fork `BASE_MAINNET_RPC=https://mainnet.base.org forge test --match-path test/UpgradeGameFork.t.sol -vv` is blocked by the local RPC TLS trust chain (`UnknownIssuer`). One retry with `/etc/ssl/cert.pem` also fails; certificate verification was not disabled. This must be rerun in the authorized upgrade environment before rollout.
- The unrelated checked-in VEY-741 launch manifest is already stale against source commit `2b329fb161b921a46966576be4eecd10573c7bef` (manifest says `d7ee5def8ece13052d4a1b4bf7a1e335f39be479`); it was not relabeled as fresh evidence.

Regression: `forge test --match-path test/VeydriftScheduledReturns.t.sol -vv` replays IDs 93742/93790, returnAt 1790592545 and arrivalAt 1790592549 through the real Game/module stack: attack-first, planet/moon, later/equal returns, lazy settle, randomness delay, bounded scans, no double credit.
