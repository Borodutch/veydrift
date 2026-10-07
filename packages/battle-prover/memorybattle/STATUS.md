# Full-width integration — solver verified, not production ready

Final command: GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./memorybattle -count=1 -v -timeout=900s
PASS376.336s. go vet ./memorybattle PASS. All owned processes collected.
No setup, proving, board, git or deploy operations. Source receipts are in
source-sha256.txt; complete final log is solver-evidence.txt. verify.sh reproduces.

## Integrated guarantees

- Eleven fixed circuits; all478 transitions in6/10-unit battles solve under the
  same per-operation systems. Independent TypeScript oracle matches final units,
  every round shot/survivor report, rounds2/3 and RNG counters18/38.
- Full uint256 cells, indices, counts, cohorts, cursor/rank, steps/shots/RNG.
  Sparse key domain2||index256, standard MiMC/Merkle fold with canonical limb bits.
- protocol.Arithmetic integrated into controller and authenticated random draws;
  mathematical512-bit damage comparisons, checked actual uint256 arithmetic.
- Latest roots/write preservation, initialization ordering, scans/reports,
  seed/counter/rank, terminal and overflow refusals all adversarially tested.
- High-bit sparse checkpoints test actual Init/Damage/FindTarget/Scan/DrawTarget/
  Explosion transitions; max count/cursor/terminal, full sampler boundaries,
  noncanonical limbs, address-domain confusion, wrong phase key and zero-anchor
  forgery rejected. Independent stats-scaled2^220 battle oracle also matches.
- Exported bridge APIs and full terminal checkpoint binding in bridge.go;
  layout frozen in LAYOUT.md. Statement8 includes Input. Start/End commit full
  uint256 steps and reserve zero for initial step; no native-field truncation.

Resource note: first all11-R1CS-retained run was stopped at~4.4GiB RSS despite
soft2GiB; tests now retain one key at a time shared across both rosters. Final
observed RSS~2.12GiB, consistent with soft-limit rather than hard isolation.

## Remaining bridge

Prepared effective stats/counts are authenticated inputs here, not proof of raw
source IDs, owners, catalog/research or enrollment. preparation/ and resultbridge/
share exact roster/Input/result encoding, but complete verified composition of
preparation/combat/result/attribution proofs is still a separate obligation.
RF qualification, seed lifecycle, settlement economics/exactly-once application,
actual setup/proving/recursion/EVM activation are not solved by this package.
