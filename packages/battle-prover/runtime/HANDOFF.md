# Runtime increment handoff — 2026-10-06

## Implemented (new runtime/ only)

- catalog.go: all-seven-phase dependency graph with configurable heights 0..256 and seven adapters; independently pinned immutable manifest, provenance/dependency hashes; contained bounded approved CCS/PK/VK loading. No Setup or automatic approval.
- witness.go: real chainsource.Document decode/binding, ABI/raw journal reconstruction, actual bounded native preparation transitions, dynamic uint256 work and checkpoint replay; raw/LinkedQualification advice. Varied small inputs, every preparation restart phase and uint32-max bounded prefix tested.
- artifact.go: real Solidity-target BN254 final proof verification, canonical 22-public fields, authoritative chain record and complete allocation suffix/root/count/tail/survivor totals. Frozen authentic final proof passes only with explicit test-local VK trust.
- runner.go/approved_runner.go: durable service-to-pinned-process adapter, concrete catalog/final verifier wiring, identity/anchor/manifest restart fencing, exact checkpoint acknowledgments, full result verification.
- prove.go: native approved-key Prove/Verify primitive for the killable engine; no compile/setup or Go-test runner. Actual future approved production-key success is not qualified because those assets do not exist here.
- cmd/prover-service: genuine queue/chainsource/runner host wiring with sequential workers and failure isolation. service.example.json contains invalid required approval placeholders, not deployable development keys.

## Terminal evidence

All commands used GOMAXPROCS=2 and GOMEMLIMIT=2GiB.

1. Existing service/processrunner regression: go test ./service ./processrunner -count=1 -timeout=3m — PASS 7.545s / 1.079s.
2. Integrated new package/executable: go test ./runtime/... -count=1 -timeout=5m — PASS 22.758s / 1.349s (wild-shell exit0 collected).
3. go vet ./runtime/... — PASS.
4. go test -race ./runtime -run TestProcessBridge -count=1 -timeout=3m — PASS 1.988s (tender-reef exit0 collected).
5. Independent catalog/witness/artifact/prove review found no new confirmed P1/P2 and reproduced focused tests 21.271s.

First independent bridge review found three P2 issues. Fixed/tested: full raw checkpoint budget now survives larger JSON/base64 envelope, with queue budgeting checks; ordinary durable Failed job no longer halts continuous unrelated work.

**One confirmed gate remains:** service.RunOne supplies non-contextual Store.Checkpoint, which can block on flock/filesystem operations after child cancellation and retain worker capacity. Parent coordination requested for existing service/ edits; none made here. Required actual-store cancellation/lock-contention test and context-aware fenced persistence, not a detached callback. New runtime is not release-ready until this is resolved.

## Exact remaining engineering (not ceremony excuses)

- Coordinated exported production composition witness constructors: current private wrappers/test helpers cannot be used from runtime without copying fixture/reflection.
- Generic native preparation-to-combat/groups/report/output stream driving; current lower-level constructors materialize full rosters/journals/reports and nested attribution, documented in witness_notes.md.
- Durable variable-height aggregation frontier executor: ReduceFamily stores private work/frontier inside a single call; no cryptographically verified restart import exists. Graph/CountPlan is not this executor and not a D256 proof.
- Reviewed engine approved-key asset route and stage/bounded-invocation completion protocol. Current supervisor stdin is input/checkpoint plus process pins, not a trusted key locator; checkpoint-only exit fails without final result.
- Actual approved key catalog/ceremony and pinned real engine release remain activation prerequisites; loader does not manufacture them.

No current processes/children awaiting collection. No git/board/deploy/production promotion. Original 4a2b2e79503d876ae096daac493566790c4f993a receipts and source pins untouched. This tested increment is a handoff for continuing #44, not completion of arbitrary chain-job runtime or the ticket.
