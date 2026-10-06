#!/bin/sh
set -u
cd /Users/borodutch/code/veydrift-worktrees/ticket-44-6fbd/packages/battle-prover || exit 90
expected=$(ps -p 18746 -o lstart=)
n=0
while kill -0 18746 2>/dev/null; do
  current=$(ps -p 18746 -o lstart=)
  if [ "$current" != "$expected" ]; then echo "Proof PID identity changed; stopping fail closed"; exit 91; fi
  if [ "$n" -ge 130 ]; then echo "Bounded proof watch expired; validation not started"; exit 92; fi
  sleep 30
  n=$((n+1))
done
echo "Original proof process terminated"
date -u
cat composition/family-dispatched-evidence.txt
GOMAXPROCS=2 GOMEMLIMIT=6GiB RUN_FAMILY_CLOSE=1 go test ./composition -run TestFamilyCloseAuthentication -v -count=1 -timeout=10m > composition/family-close-evidence.txt 2>&1
close_exit=$?
echo "CLOSE_EXIT=$close_exit"
cat composition/family-close-evidence.txt
GOMAXPROCS=2 GOMEMLIMIT=6GiB go test ./composition -run "TestFamilyFixedShapes|TestFamilyUint256|TestProtocolWorkPlan|TestCatalogRoles|TestDispatchDAG" -v -count=1 -timeout=10m > composition/family-final-tests.txt 2>&1
final_exit=$?
echo "FINAL_TESTS_EXIT=$final_exit"
cat composition/family-final-tests.txt
GOMAXPROCS=2 go vet ./composition
vet_exit=$?
echo "VET_EXIT=$vet_exit"
printf "CLOSE_EXIT=%s\nFINAL_TESTS_EXIT=%s\nVET_EXIT=%s\n" "$close_exit" "$final_exit" "$vet_exit" > composition/family-validation-exits.txt
if [ "$close_exit" -ne 0 ] || [ "$final_exit" -ne 0 ] || [ "$vet_exit" -ne 0 ]; then exit 1; fi
