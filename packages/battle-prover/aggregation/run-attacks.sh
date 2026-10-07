#!/bin/sh
set -eu
export GOMAXPROCS=2 GOMEMLIMIT=4GiB
shasum -a 256 aggregation/committed_attack_test.go aggregation/combat_multichunk_negative_test.go > aggregation/combat-multichunk-attacks-sha256.txt
go test ./aggregation -run 'TestCommittedRangeAuthenticatedAttacks|TestCombatChunkRejectsConsistentResultForgery' -count=1 -v -timeout=3m > aggregation/combat-multichunk-attacks.log 2>&1
