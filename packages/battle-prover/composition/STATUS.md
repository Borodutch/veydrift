# Composition status after recovery

## Real completed evidence

Eight genuine BN254 Groth16 proofs including final recursive proof generated and independently reloaded/verified. Source/evidence/receipts preserved. Final196B SHA256 `0aee8f36e0ef2ce890e71e8afdf79a0df30af4b65187a46dac1273f41e8df720`. Maximum circuit3,559,437 constraints. Final3,454,146 constraints,8 public fields. Runtime3811.17s. One-sided positive-row zero-shot only, external qualification unauthenticated.

Prior90min timeout was a deviation from parent-clarified60min authorization; actual run exceeded60min by211s. Future runner and log label restored60min. GOMAXPROCS2, soft6GiB unchanged; measured RSS10,691,805,184B (~9.96GiB), not6GiB hard memory. See RECOVERY.md.

Persisted genuine-proof attack suite PASS20.769s: eight receipt verifications; Close omission/context/result, bridge genesis/premature, wrong-key substitutions; final replay/context/result/omission rejected. Independent read-only Astra review found no P1/P2 bounded soundness issue.

## Added two-sided evidence (NOT proof)

Native two-row/two-unit fixture has10 prep transitions,24 combat transitions,9 bridge transitions (two Close),4+4 attribution steps,2 report rows; one round, two round-start-pool shots (one lethal, one zero damage), lost[0,1], survivors[1,0]. Elementary fixed-key family preflight passed with max1,053,142 constraints; nonzero report587,519. No full two-sided recursive final proof generated.

## Concrete remaining blocker

Existing one-sided finite DAG already exceeds60min setup+proof; fresh two-sided per-node setup entails more phase keys/joins. No repeat or knowingly infeasible longer proof run started. Fixed-family leaf sizes exist, but Pair pins descendant VKs and thus still creates level/schedule-specific setup keys. No arbitrary-height fixed-root construction, reusable approved key catalog/proving artifacts, or qualified two-sided final proof exists. `VARIABLE-LENGTH.md` states exact implementation plan/options; no hidden fleet cap or witness-key workaround.

`QualifiedFinal` source adapter authenticates both proof dependencies, but is not exercised by current receipts; on-chain qualification must remain an explicit unfulfilled obligation. Parent owns commits/deploy/board. All writes limited to composition.

## Continued fixed-family implementation (latest)

Previous “blocker” wording above describes unfinished engineering, not an external access/product blocker. Implemented normalized3-field family schema, standard gnark fixed-catalog key selection, uint256 work accounting, unary/binary nodes, Close dependency verifier, complete phase joins, strict catalog identity registry and O(256) numeric work planner. See FAMILY.md. Installed PLONK comparison checked (existing14.57M binary node measurement); no new-cryptography impossibility claim.

Family compile/solver reuse across1/2-unit inputs PASS, max1,062,077 constraints. Genuine nonzero Damage/Rapidfire subrange proofs now running under60min/4M caps with shared in-memory setup keys; this remains partial, NOT complete final battle proof. Check family-proof-evidence.txt for terminal status. Later source additions have separate manifests; old proof receipts untouched.

## Latest terminal outcome

Dispatch repair completed PASS31m54.90s with10 genuine nonzero subrange proofs; maxcircuit3,367,666, maxRSS7,739,801,600B under unchangedsoft6GiB. Direct4,360,473 pair failure retained. Normalized both-Close genuine-inner/outer-solver validation, all26ordinaryleafmetadata, fixedshapereuse, planner/catalog tests andvet passed. All processes/reviews collected. See HANDOFF.md for exact missing fullfinal/raw-linked-qualification/D256 and evidence paths. This is a completed bounded engineering batch, not production or full-task completion.
