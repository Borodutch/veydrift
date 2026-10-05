# Proof-settled combat — ticket #44 release ledger

Status: **inactive development checkpoint, not release-ready**. No resolver, mission, contract, backend, frontend or deployed service behavior is changed by this checkpoint. The ticket remains the end-to-end owner; neither the reference oracle nor a recursion probe satisfies battle-proof acceptance.

## Inspected baseline (2026-10-05)

- Fetched `origin/main`: `4a017cc9772c1bd6bcba6bdad7b12221e71c63e9`. Isolated worktree; existing dirty primary checkout preserved.
- Easypanel read-only inspection: backend and frontend both report that revision, GitHub `main`, Nixpacks, one replica. Project services include `backend`, `frontend`, `mission-report-generator`, `chicken-burn-listener`, observability and statistics services. There is no separately named `indexer` or `prover` app in the inspected project. The backend-owned indexer and report generator are separate consumer concerns; do not invent an indexer app.
- Hetzner app host: x86_64, 12 logical CPUs, 257626 MiB RAM, 172349 MiB available at inspection, 115 GiB root filesystem available; load average 3.78/4.20/4.06. Backend sample: 6.209 GiB memory; this is a capacity snapshot, **not a prover benchmark or resource reservation**. No host/service mutations performed.
- Located mandatory operator runbook at `/Users/borodutch/.openclaw/workspace/CONTRACT_UPGRADES.md`; only its `scripts/veydrift-contract-upgrade.sh` may broadcast a release. No broadcasts performed.

## Recovery verification (2026-10-05)

- Oracle candidate-2 fixes independently cleared at `cb552dfb0926860d34d055b9a6f6cab27805b57b`: 32 tests / 421 assertions. Historical starts replay to draw (97808), attacker (97839), defender (97876), defender (97881); these are separate frozen starts, not sequential alternate history.
- Recovered four-slot battle circuit at `350d5fcb6abb8ed33e4719495ea4d4f8c884b387` passed independent limited-scope review, fresh short suite (19.667s) and go vet. It proves full initialization/shot/RNG/terminal transitions with state preimage commitments, but linear elementary proof verification is not recursion and full four-slot images are not variable authenticated memory.
- Source manifest and pinned Go modules verified. All original worktree artifacts preserved; continuation worktree is isolated.
- Original target-host arithmetic benchmark log ends before terminal PASS and the remote process is gone. Do not use it as completed host performance evidence. No host/service changes were made during recovery.
- Multi-chunk real-combat aggregation and variable-memory integration are still under development. No production setup, consumer integration, activation or QA completion is claimed.

## Activation prerequisites (all remain required)

1. A generated proof of a complete small battle, including initialization, authenticated per-unit memory, exact shot state transitions, result derivation and multi-chunk recursion. An arithmetic recursion example only establishes gadget plumbing.
2. Variable-length aggregation with fixed approved inner verification keys, contiguous continuation, first/last-state checks and a measured Base-compatible final verifier. No circuit-size/fleet cap disguised as variable support.
3. Reviewed setup/ceremony provenance for every production circuit; local development Setup is never production key material. Final circuits must be frozen before circuit-specific setup and verification-key approval. No applicable battle-specific ceremony artifacts were located in the inspected repository/workspace. Battle-specific soundness review and provenance remain release requirements, not established by upstream library audits or ordinary source review alone.
4. Exact oracle/circuit parity plus malicious-witness, arithmetic, chunk/restart, mixed-owner, historical and adversarial scaling tests.
5. Complete immutable onchain input and available witness data, frozen rules/verifier/catalog/seed and bounded preparation/output application; actual proxy/permissionless adversarial integration tests.
6. New randomness reveal policy bound to completed enrollment, not merely scheduled arrival. Legacy flight requests may already be public. Keep existing launched/started leaders on their original path; a prospective new launch-version boundary avoids changing those semantics. This policy is not activated in this checkpoint.
7. Bounded exactly-once settlement proving complete per-member coverage and casualty deltas, cargo/loot/debris/reserve/repair/moon/return/index conservation. No old survivor overwrite.
8. Audit all existing broad pending guards: production, research, launches, player actions, planet/moon lock sharing and later inventory events. Keep independent noncombat missions running, with Transport/Deploy remaining proof-free. Do not relax consistency merely to conceal proof latency.
9. Readiness-aware resolver/indexer/report/forecast/UI consumers; real phases only, no speculative victory or fake percentages.
10. Separate durable Easypanel Nixpacks prover, restart/reorg reconciliation, leases/cache/artifacts, signer separation, fee policy and resource-bounded target-host tests. Do not create an idle dummy service as delivery evidence.
11. Exact-head independent review, applicable green CI, production setup validation, consumer-before-activation rollout, runbook contract receipts, deployed identities/health, then dedicated QA-worker acceptance.

## Safety during development

Existing resolution must remain live throughout feasibility work. Do not install a mock verifier, add an accept-on-timeout fallback, reseed a failed job, change semantic version midway through a battle, migrate/reset player state, or claim this ledger is an implemented pipeline. Total preparation/data/application cost still scales with participants even if final proof verification is succinct. No measured full-battle proof cost, final verification gas or production readiness is claimed here.
