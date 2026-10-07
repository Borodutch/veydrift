# Contextual checkpoint adoption

Runtime now implements service.ContextRunner.ProveContext from service commit c1559734c9793737f29e6f13dfea69ed64974db2. Its independently timed child context is created with configured WallLimit, supplied to the real supervisor, and passed to synchronous save(work, data). Early child errors also cancel that context. The supervisor is joined before return; no detached persistence callback. Legacy Prove wraps this method but legacy callbacks cannot observe context while blocked; service.RunOne chooses the contextual interface.

Actual-store regression: service.RunOne + Store.CheckpointContext + real POSIX blob-budget flock. First checkpoint persists; second remains blocked while only the child deadline expires (parent remains live). The call returns deadline exceeded, joins the transport, leaves the first prefix intact and no ready proof. Reopened store/runner executes another queued job using released capacity, explicitly retries the failed job with the saved prefix, and checks no late checkpoint writes. Transport/checker doubles isolate this orchestration test; it is not fresh Linux isolation or cryptographic proving evidence.

Terminal results, 2CPU/soft2GiB:
- go test ./runtime -run "TestProcessBridge|TestTrace" -count=1 -timeout=5m: PASS 11.286s. This also executes the previously unrun full two-document native Trace/replay tests.
- go test -race ./runtime -run TestProcessBridge -count=1 -timeout=3m: PASS 2.906s.
- go vet ./runtime/...: PASS.

Independent focused review completed: no confirmed P1/P2 in the scoped adoption and real-store regression. Kernel disk syscalls remain subject to service documented limitation; this fix cancels lock waits and checks contexts around writes, not an unsupported hard syscall-cancellation claim. Full engine/frontier implementation continues separately.
