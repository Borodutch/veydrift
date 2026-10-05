# Receipt — 2026-10-05

Owned changes: NEW resultbridge/ only. No sibling edits, board, git, deployment,
setup or proving commands. All worker-launched processes collected.

## Final verification

- GOMAXPROCS=2 GOMEMLIMIT=2GiB /usr/bin/time -l go test ./resultbridge -count=1 -v -timeout 300s: PASS.
- Final source run: 43.864s Go test, 44.72s measured wall time.
- Max RSS 2,981,429,248 bytes (~2.78 GiB); 2GiB was a Go SOFT memory target,
  not a hard RSS cap. Solver-only, no setup/prove.
- GOMAXPROCS=2 GOMEMLIMIT=2GiB go vet ./resultbridge: PASS.
- Evidence: final-evidence.txt; source-sha256.txt includes own and imported sibling
  source hashes at verification. Earlier incremental log failures are retained:
  corrected fixture field name, identical-leaf negative-test assumption and
  unkeyed external struct vet warnings. Final source suite/vet are green.

Actual preparation/memorybattle native fixtures compare exact roster roots,
preparation result, battle Input/Result and attribution Context/Result. All bridge
and attribution transitions solve; one-sided integration additionally solves all
preparation and combat transitions. No native-only mixed-battle execution is
misreported as verified combat proof.

Five fixed bridge shapes: Begin 107719; Members 130502; Units 320309;
Close 110787; Finish 84192 BN254 R1CS constraints. Two fixed report shapes
cover complete round/unit transcript projection and zero-round termination.

Coverage: multiple cohorts/members, a wiped cohort, mutual annihilation, empty
battle and either one-sided battle; six-round report; complete manifest/link
omission/duplication/reordering; wrong source/owner/tech/count; wrong unit
index/cohort/hull/sibling; arbitrary dead-stream/report/shot mutations; swapped
context/preparation/combat/attribution results; high 200-bit stats, 255-bit
source/address, 160-bit owner; +BN254-modulus snapshot alias rejection.

## Integration contract / missing glue

Snapshot4 MUST encode preparation.ContextHash canonically (little-endian limbs).
Native checked adapter: FromMachines. ReportWitnesses binds complete actual
memorybattle report rows; AssertCombinedResult binds both terminal projections.
Every Close exposes a REQUIRED complete attribution proof obligation.

README documents exact unimplemented acceptance work: authenticated recursive
key/proof composition with every dependency/adjacency; chain-qualified raw,
catalog and frozen-tech roots; RF/seed provenance; versioned public ABI and key
registry; downstream exactly-once settlement; security/release gates. Equality
helpers and host constructors are NOT verifiers. Per-round projection is complete
per-unit data, not an additional aggregated presentation format.
