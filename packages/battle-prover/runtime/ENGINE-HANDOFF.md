# Complete engine implementation handoff — 2026-10-06

## Delivered implementation

- Additive composition/runtime_api.go: typed production leaf/Close/node constructors, canonical ranges and exact adapter digests, reusing existing relations rather than test helpers.
- Generic runtime Trace: authoritative document → raw/preparation/qualification/combat/interleaved attribution/bridge/report/output, dynamic uint256 work, native replay and final manifest/leaves.
- Actual durable Frontier: approved-key verification of every canonical proof receipt, ordered coverage, D0/B_h/D_h and unary promotion, one proof per Advance, cryptographically verified restore.
- Complete Engine: every native event and leaf/Close proof branch, all seven adapter roles, exact native-source checks for all restored intervals, ordered adapter verification and separately verified final Result. No fixture, reflection or Go-test proxy in production.
- Protocol-wide BuildCatalogTemplate: roster-independent shapes for all graph roles, prior public CCS/VK dependencies and exact schemas. Full height256 topology is 3,634 nodes; no claim those keys/proofs were generated.
- Real prover-engine and prover-service entrypoints plus StageRunner: existing processrunner transport unchanged; runtime stage payloads cannot mark a battle complete without final ArtifactVerifier. Each invocation has a fresh wall deadline, durably acknowledged checkpoint and exact progress hash. Engine configuration is pinned by hash/path into the independently pinned binary, not chosen by a job.
- ContextRunner adoption: actual child deadline reaches synchronous Store.CheckpointContext; joined teardown, no detached persistence. No service/ edits from this worker.

## Final terminal verification

All commands used GOMAXPROCS=2, GOMEMLIMIT=2GiB and serial package execution where applicable. sharp-willow collected exit0.

| Check | Result |
|---|---|
| Entire runtime suite | PASS 59.649s |
| Service executable tests | PASS 1.074s |
| Existing service suite | PASS 12.207s |
| Existing processrunner suite | PASS 0.881s |
| Production composition constructor tests | PASS 1.966s |
| go vet runtime/service/processrunner | PASS |
| Runtime checkpoint/stage race selection | PASS 3.121s |
| Service checkpoint/context race selection | PASS 1.741s |
| Static Linux amd64 + arm64 runtime cross-build | PASS |

Logs: engine-final-validation.txt and engine-final-race.txt. The race command also compiled processrunner, but its selected regexp matched no tests there; do not claim a new processrunner race run from that entry. Prior full processrunner/service race evidence remains separately recorded by their owner.

## Genuine evidence, not substituted claims

- Two distinct valid documents exercise full generic native traces/claims/output and chunk restart.
- Frozen real frontier receipts: 20 verified result transitions, 28 restart boundaries, negative corruption/order/omission checks.
- Actual proof-bearing RestoreEngine: two-segment prefixes, phase boundaries, terminal checkpoint with **98 native events, 8 family roots and 7 adapters**, plus successful Engine.Result. Fully rebound different-input replay still rejects. See engine_frozen_restart_notes.md.
- Real Store + flock contention: only child deadline expires while parent stays live; first checkpoint retained, no late write, supervisor joined, capacity reused by another job, reopened store/runner resumes explicit retry. Transport/checker doubles are explicitly orchestration-only.
- All seven frozen adapter proofs verified and mutation-tested. Historical test VK/identity pins are test-local; Game1/verifier7/codehash77 is not promoted into chain acceptance.

## Independent reviews and fixes

Reviewed catalog/witness/artifact, trace/frontier/constructors, engine replay/adapters, contextual persistence, stage protocol and setup templates. All confirmed findings fixed and re-reviewed:

1. service callback cancellation adopted through ContextRunner + actual-store regression.
2. Raw checkpoint and JSON/base64 envelope budgets separated.
3. Ordinary durable failed job no longer stops unrelated continuous work.
4. Alternating partial checkpoint cycles rejected using bounded per-attempt history; not an anti-rollback-store claim.
5. Large CCS/PK reads removed from host per-stage admission; startup checks metadata only, actual hashes/decode mandatory in limited child. Only bounded final VK remains host-loaded.
6. Setup-template repeated-child alias corrected with fresh proof/witness placeholders per child occurrence. Plain and committed dependency regression uses actual gnark compiler schema walking. Independent fix review confirmed no remaining P1/P2. No keys had been generated using the defective draft.

## Still unqualified / next coordinated execution

**No fresh successful Engine.Advance proving with a prebuilt approved CCS/PK/VK catalog has been performed.** No PK setup/persistence, ceremony, current-source complete proof, or identity-correct onchain settlement is claimed. Existing receipts prove crypto verification/restart behavior, not new proving success. Recursive factory CCS byte parity has not been exhaustively compiled under all keys/heights.

ENGINE-PLAN.md gives the concrete next validation: agree a new development-only public-key persistence namespace/source/finite heights; prebuild and independently pin the whole required dependency DAG/final VK BEFORE jobs; obtain an actual isolated verifier address/codehash; then freeze two different jobs, reuse the same catalog/VK, execute the real staged engine with restart and require actual contract acceptance. Public PK bytes are not toxic ceremony randomness. Production promotion remains a separate approval. No cryptographic key cycle was found because deployment identity is witness data, not a setup constant.

Native document/roster/cohort/output materialization and synchronous O(prefix) restore remain explicit resource limits; no constant-space or universal arbitrary-size liveness claim. Current finite resource budgets fail closed, never truncate or silently cap gameplay.

No git/board/deploy/activation actions. No processrunner API edits. Historical4a2b2e79503d876ae096daac493566790c4f993a and925db95170c2ed89121fa6116da352b5a6949ebb artifacts/source pins preserved. Parent owns review/commit/release and next coordinated proving; #44 remains open.
