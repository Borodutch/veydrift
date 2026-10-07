> Current implementation and terminal evidence: [ENGINE-HANDOFF.md](ENGINE-HANDOFF.md). Earlier increment-only gaps below are historical where superseded. Fresh approved-PK proving/onchain acceptance is still unqualified.

# Approved battle proof runtime

## Implemented path

Authoritative chainsource snapshot → generic native Trace → typed composition witnesses → catalog-approved leaf/Close proofs → one-operation durable Frontier → qualification and all final adapters → verified 22-public FinalArtifact and allocation suffix.

- **Catalog:** independently SHA-pinned complete seven-phase dependency DAG and artifact provenance; bounded contained CCS/PK/VK loading. No Setup or automatic development-key approval.
- **Trace:** actual dynamic preparation/combat/attribution/bridge/report/raw/output events and linked qualification, full-width identities/work, separate attribution groups, exact manifest/leaves. Native checkpoint replay is deterministic and context checked, not proof authority.
- **Composition constructors:** additive production APIs reuse existing private wrappers and exact relations. Bare Close is rejected; authenticated Close consumes the correct cohort proof.
- **Frontier:** canonical public proof receipts; every restored proof verified under externally approved VK and exact public range; ordered uint256 coverage; D0/B_h/D_h with unary promotion. At most one actual proof per Advance.
- **Engine:** all generic leaf/Close/qualification/adapters implemented. Restore replays the source and matches every frontier interval/endpoints/kind; final Result is separately cryptographically verified. No fixture, reflection or Go-test proxy.
- **StageRunner / prover-engine / prover-service:** real pinned process isolation, per-invocation wall deadline, durable fenced checkpoints before stage acceptance, final verification before service completion. No processrunner transport API edits. See STAGE-PROTOCOL.md.
- **Cancellation:** optional service.ContextRunner is adopted. Independent child deadline reaches synchronous Store.CheckpointContext; supervisor teardown is joined. Actual store/flock/restart/capacity and race regressions pass. See CONTEXT-CHECKPOINT.md.

## Identity and setup chronology

Build the fixed dependency catalog/final VK before exporting/deploying the verifier and freezing jobs. Game/verifier address/codehash are witness values, not self-referential setup constants. Historical Game=1/verifier=7/codehash=77 fixture is not contract-acceptance evidence. Public Groth16 PK bytes are distinct from toxic ceremony randomness; only independently approved public CCS/PK/VK artifacts may enter the read-only catalog. No new setup, key persistence, ceremony, promotion or activation has occurred. See ENGINE-PLAN.md.

Engine config path and SHA are pinned into the reviewed binary; that binary SHA is pinned in processrunner.Manifest. Jobs cannot supply configuration paths or inherit a secret environment. The service example intentionally contains invalid approval placeholders; it is not deployable. Durations are nanoseconds. Its small example memory reservation is not claimed sufficient for real proving, and RLIMIT_AS is virtual address space, not RSS/GOMEMLIMIT.

## Honest resource and qualification boundaries

All engine branches are implemented, but **fresh complete proving with a prebuilt approved production CCS/PK/VK bundle has not been executed**: that bundle is not supplied. Existing saved genuine proofs qualify verification/serialization/frontier transitions with explicit test-local trust, not production promotion. Native two-document tests qualify dynamic trace/claims, not fresh end-to-end proofs. Graph capacity through height256 is not an instantiated or proved D256 catalog.

Native initialization still materializes bounded document rows/raw journal, expanded combat roster, cohort sorting and output leaves. Replay is O(native prefix), currently synchronous but context checked inside the killable process; it is not constant-space arbitrary-size execution. Operational input/row/leaf/checkpoint budgets fail closed, not truncate. A sufficiently large legitimate job may need a future storage-backed native driver/replay strategy; no hidden gameplay fleet cap or universal throughput claim is made.

Catalog readiness/final verification have host overhead outside child limits. gnark Prove itself is not cooperatively cancellable: real calls belong inside the pinned killable engine. Noninterruptible disk syscalls retain the documented service limitation; lock waits are cancellation-aware and fenced writes are checked synchronously.

## Evidence

- engine-validation.txt: integrated runtime/executables/service/processrunner tests, production constructor tests and vet.
- engine-race-validation.txt: selected runtime/service checkpoint/stage race regressions.
- engine_notes.md, frontier_notes.md, trace_notes.md, artifact_notes.md: API and exact test scope.
- HANDOFF.md records the earlier increment and its former missing-engine/callback gate; it is historical, superseded by these implementations.

Historical 4a2b2e79503d876ae096daac493566790c4f993a proof receipts/source pins and 925db95170c2ed89121fa6116da352b5a6949ebb increment remain preserved. New constructors/runtime require a new source identity; old approval maps are never rewritten.
