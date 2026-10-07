# Staged engine protocol, no processrunner API edits

The earlier ENGINE-PLAN.md proposal for a new supervisor message/config descriptor is superseded by this implementation wholly inside runtime/. Existing processrunner transport remains unchanged: it returns unverified bytes, not an assertion of completed battle. Those bytes now encode EngineStageResult (schema veydrift-approved-engine-stage-v1) with identity/catalog/checkpoint SHA, Complete boolean, and optional final artifact.

StageRunner, used by prover-service, creates a fresh child/wall context for each invocation. Each invocation must persist a checkpoint through the current fenced service callback before its result is accepted. The result SHA must match that exact persisted raw checkpoint; nonfinal result cannot carry an artifact or repeat unchanged progress. Only Complete=true plus actual full ArtifactVerifier success returns a final proof from service.Runner.ProveContext. No stage receipt is served as a completed battle. Parent cancellation and lease continue across invocations; one child deadline does not become a many-hour whole-job deadline.

prover-engine calls the actual NewEngine/RestoreEngine/Advance library. It performs at most one approved proof operation, persists its public checkpoint, and returns a stage envelope. When Advance reports exhaustion, Result must independently authenticate the final proof/artifact before Complete is emitted. A final checkpoint may therefore take one extra terminal no-proof invocation to publish completion. Any error exits nonzero with no success output. Gnark logging is disabled in the CLI so stdout remains strict NDJSON.

## Trusted configuration without a transport change

The engine binary has two build-time linker string pins: main.configPath and main.configSHA256. No CLI flag, inherited environment or job supplies them. LoadEngineConfig uses a no-follow/nonblocking descriptor, requires a bounded regular file, verifies exact SHA before decoding, and binds release to catalog. Its public configuration contains independently approved catalog identity/read-only path, release identity and operational budgets. Build/review this configuration first; embed its SHA/path in the engine binary; then approve that binary SHA in processrunner.Manifest. Neither configuration nor catalog depends on the engine binary SHA, so no self-hash cycle. The final VK/deployed verifier still precedes frozen jobs per ENGINE-PLAN.md.

No production config/binary build, setup, PK persistence, promotion or service launch occurred. Public proving keys remain distinct from toxic ceremony randomness. Missing independently approved PK/CCS/VK assets fail closed. This is an implementation, not fresh production proof qualification.

## Tests

Under2CPU/soft2GiB, staged/wire/CLI regression PASS0.885s/0.589s. Tests cover two sequential child deadlines exceeding one deadline in total; exact saved-prefix resume; partial result never passed to final checker; final checker rejection; missing/wrong checkpoint, partial artifact and repeated progress rejection; canonical invocation identity, approved release, size bounds and config pin/symlink rejection. These stage transport tests use private doubles and do not replace real proof/frontier/native tests. Independent protocol review and subsequent fix re-review completed; identified issues and corrections are recorded below.

## Review corrections

Partial progress now retains a SHA history for the entire current job attempt (including its initial resume), rejecting alternating A/B/A cycles instead of merely unchanged adjacent checkpoints. History has an explicit host operational bound of MaxCheckpointBytes/64 entries; exhaustion fails, never reports completion. A new process attempt still revalidates cryptographic engine checkpoint/source state; this transient cycle detector is not an anti-rollback store or protocol fleet bound.

Concrete service construction now checks artifact presence/type/length once without reading large CCS/PK bytes. Per-stage Ready checks only already-authenticated immutable manifest identity. Every actual key file hash/decode remains mandatory in Catalog.Load/receipt verification inside the limited child. The bounded final VK is still loaded for independent host final verification. Regression distinguishes metadata admission from mandatory child-use content hashes and rejects missing assets at construction. Focused regression PASS1.635s under2CPU/soft2GiB; Re-review found no new P1/P2.

engine.example.json is a deliberately non-activating public configuration shape with required approval placeholders. After review, pin its exact SHA/path into the engine build, then independently approve the binary hash; no such build or launch is performed here.
