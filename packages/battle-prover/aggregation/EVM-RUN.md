# Actual combat local-EVM run checkpoint

Started 2026-10-05 at approximately 22:45 UTC from source base 00916308.

Command: sh aggregation/run-evm-proof.sh from packages/battle-prover.
Process tool handle: salty-lagoon (pid 46675). Go timeout 60m; outer timeout 3700s. GOMAXPROCS=2, soft GOMEMLIMIT=6GiB; unchanged per-circuit ceiling 4,000,000. Serial heavy lane owned by this run.

Resume: collect terminal process result and aggregation/combat-evm-proof-evidence.txt. Require genuine final-proof PASS, exported evm/public/Verifier.sol + fixture.json and source hash recheck. Never restart solely because no log progress during setup. Then run isolated forge test --root aggregation/evm -vvvv, preserving the receipt and separate gas labels. Independent preflight review child c650ada6-c03a-4f8c-83c8-16e2a8be6424; final review must include actual terminal evidence.

No board/git/deploy mutations. Exports contain only generated public verifier, MarshalSolidity proof and seven public scalars. No production security or live-Base gas/fee claim.

Completed: original salty-lagoon collected exit0; genuine proof PASS2067.07s; source recheck all31 OK. Forge terminal5/5 PASS; scalar regressions PASS; aggregation short suite PASS. No active proof process remains. See evm/README.md for final evidence.
