# Historical proof-bearing Engine restore evidence

Only `engine_frozen_restart_test.go` is executable test code. Its authority and VK pins are TEST LOCAL and unavailable to production binaries. No historical receipt, manifest, source pin, runtime implementation, or production catalog is modified.

The canonical Document reconstructs the historical full-20261005-v1 three-unit fixture from journal/ABI and qualification digest formulas: chain 8453, Game 1, battle 100, verifier 7, codehash 77, engine 88, request 4, random word 1. NewEngine/NewTrace perform their normal authority checks. The block anchor and manifest identifier are explicitly synthetic test authority, not chain acquisition evidence.

Coverage:
- Actual RestoreEngine with independently verified two-leaf D1 plus raw leaf: two proof-bearing segments.
- Raw/preparation boundary with three independently verified 4+2+1 streaming intervals and a pending preparation instruction.
- Terminal replay of 98 native events, all eight family roots (seven phases, two attribution groups), every seven-adapter prefix, and actual Engine.Result with its ArtifactVerifier: three allocation leaves, one round, final sides 2/0, outcome 1.
- Rejections for interval, group, endpoint, source, ordering, missing proofs/segments, early sealing, missing roots/adapter stages, and falsely marking the pending phase instruction proved.
- Different valid owner input with recomputed journal, randomness context, chain record, snapshot identity, trace digest and frontier binding still rejects the unchanged genuine receipts specifically at native range comparison.

Run from packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test -p 1 ./runtime -run TestEngineFrozen -count=1 -timeout=5m -v

This is historical cryptographic restart/terminal verification evidence. Checkpoints are assembled from stored genuine receipts; no Engine.Advance proving path, setup, new proof, PK/CCS loading, injected prover, production approval, current source-pin validation, or identity-correct onchain settlement is claimed.
