# VEY-KANEO-164 Production Combat And Missions QA Matrix

Date: 2026-05-22
Branch: `codex/vey-kaneo-164-qa-matrix`

This matrix is the production readiness gate for the combat and mission surface. It
separates green automated coverage from blocked or failed scenarios that need their
own Kaneo tickets.

## Automated Matrix

| Area | Scenario | Coverage | Status |
| --- | --- | --- | --- |
| Contracts | Direct calls cannot launch from another player's planet | `VeydriftGame.t.sol::testMissionEntrypointsRejectDirectBypassesForNonOwnerUnsupportedMissionAndRecallOwner` | Covered |
| Contracts | Generic fleet launch cannot spoof missile attacks | `VeydriftGame.t.sol::testMissionEntrypointsRejectDirectBypassesForNonOwnerUnsupportedMissionAndRecallOwner` | Covered |
| Contracts | Non-owner cannot recall another player's mission | `VeydriftGame.t.sol::testMissionEntrypointsRejectDirectBypassesForNonOwnerUnsupportedMissionAndRecallOwner` | Covered |
| Contracts | Permissionless keepers cannot complete a return before `returnAt` | `VeydriftGame.t.sol::testMissionReturnKeeperCannotCreditBeforeReturnAndCreditsOriginalOwner` | Covered |
| Contracts | Permissionless completion credits the original planet/owner after `returnAt` | `VeydriftGame.t.sol::testMissionReturnKeeperCannotCreditBeforeReturnAndCreditsOriginalOwner` | Covered |
| Contracts | Launch, recall, resolve, return, fleet slots, fuel debit, and in-flight ships | Existing `VeydriftGame.t.sol` mission tests | Covered |
| Contracts | Attack win/loss/draw, loot caps, debris creation, recycler harvest | Existing `VeydriftGame.t.sol` combat tests plus debris depletion assertion | Covered |
| Contracts | ACS defend/intercept and Alliance Depot fuel support | Existing `VeydriftGame.t.sol` and `VeydriftAllianceSystem.t.sol` tests | Covered |
| Contracts | Missile launch/interception/destruction and direct-call abuse attempts | Existing `VeydriftGame.t.sol`; deeper production verification is VEY-165 | Partial |
| Contracts | Moon chance request/finalization | Existing `VeydriftMoonSystem.t.sol` | Covered |
| Contracts | Stale resource settlement before mission debit/credit | Existing resource and mission tests | Covered |
| Backend/indexer | Debris field indexing and depletion | `chainSync.test.ts` | Covered |
| Backend/indexer | Moon chance event decoding | `evm.test.ts` | Covered |
| Backend/indexer | Mission visibility from fleet mission logs | Existing `server.test.ts` endpoint coverage; deeper Mission Control state is VEY-163 | Partial |
| Backend/indexer | Due mission detection and auto-resolution queue | Not implemented in `main`; owned by Mission Control work | Blocked by VEY-163 |
| Frontend | Mission launch ABI payload shape | `walletFlow.test.ts` | Covered |
| Frontend | Galaxy action availability avoids unsupported/fake actions | `universeDisplay.test.ts` | Covered |
| Frontend | Mission Control critical states | Mission Control is not present in `main`; owned by VEY-163 | Blocked by VEY-163 |

## Failed Or Blocked Scenarios

| Code | Scenario | Evidence | Disposition |
| --- | --- | --- | --- |
| VEY-164-F1 | A player can call `launchFleetMission(... Attack ...)` against their own non-origin planet. The current frontend only exposes Transport/Deploy for own occupied slots, so this is a direct contract bypass of UI mission restrictions and could enable self-farmed battle/debris/moon outcomes. | `VeydriftGameplayModule._launchFleetMission` rejects same planet but does not reject same owner on a different planet for `Attack`. `apps/frontend/src/galaxyActions.ts` only offers Transport/Deploy for own occupied targets. | Split to VEY-166. |
| VEY-164-B1 | Mission Control API/state shape, due mission detection, and auto-resolution queue are not testable on `main` yet. | VEY-163 is in progress and owns the Mission Control tab/API/state work. | Blocked by VEY-163; no duplicate fix ticket needed. |
| VEY-164-B2 | Live testnet QA cannot be completed from this branch before the Mission Control and missile verification work lands and deploys. | Core live paths require deployed Mission Control actions and controlled wallets. | Manual QA handoff remains required after deploy. |

## Required Local Validation

Run from the repository root unless noted:

```sh
cd packages/contracts && forge fmt --check && forge build --sizes && forge build && forge test
bun run test:backend
bun run build:backend
cd apps/frontend && bun run test
bun run check:frontend
```

## Live QA Handoff

After VEY-163 and VEY-165 are deployed to `test.veydrift.com`, run with controlled
Base Sepolia wallets and record non-secret wallet labels plus transaction hashes:

1. Attack flow: launch attack, wait for due arrival, resolve, complete return.
2. Defended attack: open/coordinate ACS defend or intercept, resolve hostile mission,
   complete returning fleets.
3. Transport/save: transport or deploy resources before hostile arrival, verify
   source debit and target credit.
4. Recycler harvest: create or find debris, launch recycler, verify debris decreases
   and returning cargo credits origin.
5. Missile flow: launch IPMs, verify ABM interception and target defense reduction.
6. Moon-chance battle: run only if practical; verify pending/finalized moon chance
   events and resulting moon state.

Do not mark this gate production-clean until every blocked row above is either fixed,
accepted as a documented product decision, or explicitly split into its own ticket.
