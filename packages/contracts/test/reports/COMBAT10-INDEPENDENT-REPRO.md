# Ticket #10 independent shot conservation evidence

Baseline: 33573875f9f68e8afcab3f33cdcc60a7a4dbfc2c. Corrected arithmetic retains domain v1 and lanes65536+shots/131072+shots; target allocation shares targetKey=0 offset in ascending cohort-key order; rapidfire uses ascending unit order.

## Independent validation

Small oracle physically assigns each shot round-robin to a unit, then sums its hits and damage. It does not derive quotient/remainder groups. It groups resulting explosion probability mass by observed hit count only to honor the specified aggregate stochastic model (not independent per-unit Bernoulli trials). An offset-grid enumerator counts each shot in half-open target intervals, rather than copying cumulative endpoint rounding.

Baseline production fails:100 shots,99 targets,attack41/shield10/hull100,seed1 round2 side4 firing37 target19 yields72 kills instead of enumerated32. Shield/hull boundary fails7 vs4; fuzz counterexample11 vs10. Candidate passes6 arithmetic tests including2048 fuzz runs,256 adjacent-count seeds, mixed-RF/key-order permutation parity and wide counts.

Only named preview change:seed404 MixedShipsAndDefenses repaired RocketLauncher survivors38→40. Independent round arithmetic agrees with candidate; all other named vectors unchanged. Preview9/9 passes.

## Reapers:seeds1 through256 inclusive

Each row is a conditional six-round sample, not a guarantee for all seeds or fleet compositions. No winner monotonicity claim. EqualZero means W/S/A=0/0/0 both; EqualTen=10/10/10 both. UnequalWSA attacker10/8/12 versus defender8/12/9; Reversed swaps them. AttackerTenDefenderZero and reverse use uniform10 versus uniform0.

The bounded Reaper-only independent simulator has no Reaper-on-Reaper rapidfire, defenses or extra owners:one cohort per side. An8-seed fixture cross-checks it against the full independent battle simulator. All30 cases retain256 seeds. Initial all-owner-slot reporting harness exhausted test-driver memory/gas; specializing the homogeneous report avoids that overhead without raising production gas limits or reducing seeds.

| Research | Initial A:D | A wins/D wins/draws | A survivors | D survivors |
|---|---:|---:|---:|---:|
| AttackerTenDefenderZero | 100:100 | 256/0/0 | 100–100 | 0–0 |
| AttackerTenDefenderZero | 100:101 | 256/0/0 | 100–100 | 0–0 |
| AttackerTenDefenderZero | 100:98 | 256/0/0 | 100–100 | 0–0 |
| AttackerTenDefenderZero | 100:99 | 256/0/0 | 100–100 | 0–0 |
| AttackerTenDefenderZero | 99:100 | 256/0/0 | 99–99 | 0–0 |
| AttackerZeroDefenderTen | 100:100 | 0/256/0 | 0–0 | 100–100 |
| AttackerZeroDefenderTen | 100:101 | 0/256/0 | 0–0 | 101–101 |
| AttackerZeroDefenderTen | 100:98 | 0/256/0 | 0–0 | 98–98 |
| AttackerZeroDefenderTen | 100:99 | 0/256/0 | 0–0 | 99–99 |
| AttackerZeroDefenderTen | 99:100 | 0/256/0 | 0–0 | 100–100 |
| EqualTen | 100:100 | 0/0/256 | 100–100 | 100–100 |
| EqualTen | 100:101 | 0/0/256 | 87–100 | 101–101 |
| EqualTen | 100:98 | 0/0/256 | 100–100 | 82–97 |
| EqualTen | 100:99 | 0/0/256 | 100–100 | 87–99 |
| EqualTen | 99:100 | 0/0/256 | 87–99 | 100–100 |
| EqualZero | 100:100 | 0/0/256 | 100–100 | 100–100 |
| EqualZero | 100:101 | 0/0/256 | 87–100 | 101–101 |
| EqualZero | 100:98 | 0/0/256 | 100–100 | 81–98 |
| EqualZero | 100:99 | 0/0/256 | 100–100 | 88–99 |
| EqualZero | 99:100 | 0/0/256 | 87–99 | 100–100 |
| UnequalWSAReversed | 100:100 | 0/0/256 | 100–100 | 100–100 |
| UnequalWSAReversed | 100:101 | 0/0/256 | 87–100 | 101–101 |
| UnequalWSAReversed | 100:98 | 0/0/256 | 100–100 | 98–98 |
| UnequalWSAReversed | 100:99 | 0/0/256 | 100–100 | 99–99 |
| UnequalWSAReversed | 99:100 | 0/0/256 | 86–99 | 100–100 |
| UnequalWSA | 100:100 | 0/0/256 | 100–100 | 100–100 |
| UnequalWSA | 100:101 | 0/0/256 | 100–100 | 101–101 |
| UnequalWSA | 100:98 | 0/0/256 | 100–100 | 80–96 |
| UnequalWSA | 100:99 | 0/0/256 | 100–100 | 86–99 |
| UnequalWSA | 99:100 | 0/0/256 | 99–99 | 100–100 |

## Reproduce (packages/contracts)

- `forge test --match-contract VeydriftIndependentShotOracleTest --fuzz-runs 2048 -vv`
- `forge test --match-contract VeydriftCombatPreviewFixturesTest -vv`
- `forge test --match-contract VeydriftReaperShotReproTest -vv`
- `forge test --match-contract VeydriftStagedCohortsTest -vv`

Tests require corrected production math when integrated. Oracle branch deliberately contains only tests/reference changes, not a standalone production fix.

## Full-roster validation gap

The full7owner all-mobile plus resident defenses fixture is preserved unchanged. Corrected staged execution completes595 bounded calls; maximum observed step3,546,233 gas under the unchanged15,000,000 cap. However the test driver then exhausts its1,073,720,760 gas/memory budget during whole-roster verification. The separate whole-roster independent-parity test also exceeds that driver budget. Five other staged lifecycle/chunk/parity tests pass. These two failures remain visible, not skipped or relaxed; they require integration follow-up and are not proof of live transaction-envelope readiness. Attempted comparator-frame isolation did not resolve total driver gas and was removed.

Candidate files tested: VeydriftCombatCohorts.sol SHA256 86e3e9f984c63a457f6ec5f8719f0a9916205523308143468541b563805fdcfc; staged source snapshot from contract worker during implementation. Parent must rerun at exact integrated head. No deployment, upgrade-boundary or live settlement validation is claimed here.
