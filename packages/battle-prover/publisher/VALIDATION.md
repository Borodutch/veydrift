# Publisher validation status

## Review

Independent read-only Astra review6275f32d-597c-4130-9878-5ea7ad3ad4c7 (60a9173a) found no concrete P1/P2 by inspection. Execution subsequently found a real platform concurrency defect, corrected below; focused independent fix review413b6b76-ad64-4795-a8c9-11950bfac03f returned PASS, no P1/P2. Diagnostic reviewf7868a7f independently localized the failing operation; underlying Darwin/APFS kernel cause remains a hypothesis, not proven. Both reviews were read-only and did not independently rerun tests. Do not confuse initial inspection with tested correctness.

## Coordinated window and vector

Parent confirmed stages9..24 terminal exit0 and no active catalog-builder; stages25+ not authorized. This publisher-only validation uses GOMAXPROCS=2,GOMEMLIMIT=2GiB, serial package builds and explicit timeouts. No setup/proving, fresh keys/jobs, real RPC, signing, deployments or module changes.

Go independently computed releaseId0x5e9b91bfed181a6f776c1007673cb4204a49222b6d31b9a692c7b103cfdacc2e and basename3a814dbb9f06f663789f320ab0d37620a729bf174baa251f83e0f4200b43d643. Both exactly match the parent's existing-viem result /tmp/ticket44-vector-viem-result.json. Only after comparison were null expectations replaced. Initial vector test intentionally failed to display the computed values. Ethers calculator could not load its dependency; no ethers execution/agreement or dependency installation claimed.

## Recovered actual concurrency defect

Initial suite PASS4.498s and race PASS6.138s were insufficient: a subsequent full rerun failed TestConcurrentPublishers. Narrow reproduction failed9/30 iterations; error context localized the failure to nonexclusive openat(O_CREAT) of .publisher.lock, returning ENOENT on this Darwin host. No artifact/key/source trust check was relaxed.

Fix: create the stable lock inode with O_CREAT|O_EXCL; ONLY on EEXIST reopen without creation. NOFOLLOW/nonblocking/CLOEXEC/single-link checks and flock remain. No ENOENT retries, lock replacement or bypass. New TestConcurrentInitialLockCreation runs30 rounds of8 simultaneous creators, plus existing four actual publishers; both repeated10 times PASS2.554s. This is a reproduced supported-host behavior, not a claim that every filesystem behaves identically.

CLI test adds positive offline pinned-config validation and rejects job-key/action/positional/wrong-pin errors; no roots are created and unreachable RPC is never called. Historical cryptographic tests retain genuine old proof with synthetic local Source/catalog identity. Fault-injection tests simulate syscall-boundary failures and retry; they are NOT actual power-loss/process-kill tests.

Final terminal chain mild-ridge exited0: publisher tests2.409s, CLI tests0.809s; vetPASS; publisher race5.834s, CLI race2.084s; CGO0 -trimpath -buildvcs=false buildsPASS darwin/arm64,linux/amd64,linux/arm64. All85 frozen source entries rehashed UNCHANGED. Logs test-results.txt and race-results.txt supersede initial passes. Binaries are /private/tmp/ticket44-publisher-validated-20261006/proof-publisher-<target>. Separate publisher source/binary pins are recorded in source-manifest.json and pins.json; no actual deployment config exists or is silently approved. Production publication directory/config activation and identity-correct fresh proof acceptance remain parent-owned follow-up, not implied by these tests.
