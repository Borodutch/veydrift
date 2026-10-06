# Cancellation interface coordination

Service adds backward-compatible optional ContextRunner:

    ProveContext(context.Context, Snapshot, []byte, func(context.Context, []byte) error) ([]byte, error)

Existing Runner.Prove unchanged. RunOne selects ProveContext when implemented, combines checkpoint context with service cancellation, and uses Store.CheckpointContext. Legacy Prove gets parent/service cancellation only.

Runtime owner must implement ProveContext and pass its actual child wall-limit context into save(ctx, data). Supervisor timeout must cancel that context even while synchronous save waits. Do not detach save. Legacy Prove can wrap ProveContext for backward compatibility.

Until runtime does this, parent cancellation is fixed but child-only wall timeout remains P2. Service owner cannot edit runtime.

## Service implementation and terminal verification

- Store.CheckpointContext / RenewContext retain compatible legacy wrappers.
- Nonblocking flock retries honor cancellation; job/slot/blob-budget fencing stays held across writes. Transactions enforce the existing lease deadline even during blob-budget waits.
- RunOne uses contextual claim, renewal, checkpoint, reorg invalidation and completion. Heartbeat is canceled/joined; failure cleanup has a synchronous 100ms lock-wait budget. If cleanup cannot lock, durable reservation expires normally; execution locks are released.
- Actual flock regression covers cancellation waiting on job, slot and blob locks, no late writes, heartbeat shutdown, legacy and contextual callbacks, independent child deadline, unrelated checkpoint progress, execution-slot reuse, stale lease while waiting, and atomic write cancellation boundaries. Existing reorg/generation/ABA suites also pass.
- No detached persistence callback. Disk syscalls themselves remain non-interruptible; cancellation checks bracket operations and 64KiB write chunks. Already committed renames finish directory fsync synchronously. No cross-file transaction atomicity is claimed: orphan blobs or a slot reserved until expiry remain safe recovery states.

All commands used GOMAXPROCS=2 GOMEMLIMIT=2GiB from packages/battle-prover:

1. go test ./service ./processrunner ./runtime/... -count=1 -timeout=5m — PASS (service 11.716s, processrunner 0.837s, runtime 21.456s, runtime/cmd/prover-service 0.412s).
2. go test -race ./service ./processrunner -count=1 -timeout=3m — PASS (14.015s / 3.022s).
3. go test -race ./runtime -run TestProcessBridge -count=1 -timeout=3m — PASS (1.697s).
4. go vet ./service ./processrunner ./runtime/... — PASS.

Runtime/runner.go still does not implement ProveContext at this handoff. Parent must relay the optional signature above to its runtime owner. Existing plain Prove cannot convey a child-only timeout to synchronous Store save; that integration remains the actionable P2, not a filesystem cancellation claim.
