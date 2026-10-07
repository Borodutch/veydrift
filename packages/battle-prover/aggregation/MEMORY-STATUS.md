# Memory adapter receipt — 2026-10-05

Only new aggregation/memory_*.go and MEMORY-* / memory-* evidence files changed.
Existing committed.go and generated EVM artifacts unchanged by this worker.

- Adapter suite PASS: 37.140s. Genuine 8-constraint exact-statement and isolated
  claims child proofs; generated pair/final solvers. Pair 2,542,059 constraints;
  final 1,305,927. Includes modulus-minus-one Result, descending hash positions,
  rogue child/root keys and ignored witness key/genesis overrides, high-bit
  link attacks, replay/reorder, terminal padding, nonterminal result and final
  genesis/terminal attacks. See memory-recursive-evidence.txt.
- Actual full-width memorybattle tagged lane PASS: 55.933s. Empty-roster real
  Boot and Ready leaves: 112,751 and 119,552 constraints, genuine development
  Groth16 proofs verified natively and authenticated by generated MemoryPair
  solver (3,449,701 constraints). Leaf public order checked; actual result
  mutation/replay rejected. See memory-battle-evidence.txt.
- GOMAXPROCS=2; soft GOMEMLIMIT=4GiB; every circuit under 4M constraint cap;
  actual SMALL child Setup capped at 150,000 constraints. No outer Setup.
- go vet ./aggregation PASS. All three proof-probe process handles collected
  with exit 0. Two independent Astra/high read-only reviews found no blockers;
  suggested boundary/attack additions implemented and rerun; actual integration
  and strengthened tests independently approved in second review.

Not established: nonempty combat recursive proof, aggregate/root/final proof,
production ceremony, deployed key registry, updated EVM verifier or settlement.
The actual-leaf package was independently being migrated; its package built,
while its old package tests were not yet ported at integration start. This lane
compiles and proves the imported real circuit; it does not certify that broader
package test migration. No source modifications outside the assigned files.
