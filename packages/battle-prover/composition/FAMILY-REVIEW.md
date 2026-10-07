# Independent normalized-family review and repair

Astra47b2295e read-only review: no confirmed P1/P2 soundness bug. Verified phase/schema/full256work commitments; constant gnark VK catalogs; adjacency+checked sum; genuine unary lifts; complete Close context/result authentication; root completion and CountPlan. Review identified missing production catalog provenance, incomplete metadata/cost measurements, unary/level2/overflow tests, and confounded negative cases. These remain explicit engineering coverage, not an external decision blocker.

Direct switched-key pair attempt stopped before setup:4,360,473 constraints >4M. Four genuine nonzero leaf proofs completed; total407.12s, RSS5,264,179,200B. Original family-proof-evidence.txt preserved; no limit raised.

Repair in progress: a unary dispatch selects ONE catalog key and emits the common3-field statement. Binary merge verifies two proofs under a SINGLE fixed dispatcher key. This separates variable-key verification overhead across circuits. New run run-family-dispatched.sh,60min ceiling, same4M guard and2CPU/soft6GiB. No unchanged failed-path retry.

New strict catalog registry enumerates a dispatch-first DAG: D0<-allphaseleaves; B_h<-D_(h-1); D_h<-[B_h,D_(h-1)]. This enables merge or authenticated unary carry without self-reference.513 node/dispatcher keys per phase;2565 across five phases, plus27 leaves and joins. Count bound is elementary work, NOT automatically every uint256 roster size; quadratic preparation/attribution work can exceed the domain.

Streaming ReduceFamily now uses O(height) proof storage and this DAG; prover callback must supply genuine proofs and can cache reusable setups in memory byFamilyID. Fixed catalogs and compiled root keys remain trusted audited setup outputs, never accepted from a prover. Full production instantiation not claimed.

## Dispatch/reducer independent follow-up

Astra0427fe7f bounded clean: no confirmed P1/P2. DAG acyclic; streaming stack finish preserves prefix/suffix order and work for odd counts/gaps; selectors consistent; capacity checks present. No proof of full setup provenance or fullcatalog cost. Requested obsolete graph comments corrected. Dispatched test exercises only2leafkeys, unaryselection andfixedbinarykey—not fullcatalog, D_h merge/promotion selector choices, whole streaming runtime, orD256 construction. Those remain explicitly unproven.
