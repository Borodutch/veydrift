# #63 Supply preload evidence

Existing supply-sources already aggregates current resources and effective launchable ships in one lean request. No backend or endpoint changes. Payload is no-store and includes indexer projection block/timestamp and revision.

Preload now shares the canonical target-scoped query on Overview, Infrastructure, Research, Shipyard, Defenses and Moon. Other routes do not prefetch. Open modal overrides active target. Fresh (<5s) snapshots reuse immediately; in-flight requests coalesce; expired/failed opens retry. Existing active-only 10s timed refresh and event invalidation remain. Moon readiness shares one parent shipyard read, not a per-source waterfall. Different destinations retain different keys.

Open no longer forces fresh:true behind an in-flight readiness read. Confirmation still forces authoritative fresh:true past its commit barrier. Max performs zero API calls before and after; its separate CPU optimization is necessary. Draft freezing and effective production reconciliation are unchanged. Same-wallet chain changes now clear wallet snapshots; Supply reset also includes runtime chain identity.

## Live baseline
Oct8 ~19:52 PDT; macOS arm64, Node v26.8.2. Backend health SHA 420aaa8a51d4c416ed9401cac22135ebd2365ce0 matched origin/main. Read-only New Denver planet831 Supply GET: 200; nine sources; 5,126 JSON bytes; no-store; healthy projection block52362492/timestamp1791514331.
Three sequential samples (headers/full response milliseconds): first connection 1426.9/1429.1; warm 241.4/243.9; warm 312.3/314.2. Network measurements, not origin CPU/cold-cache/browser guarantees. No reason to add another endpoint.

## Reproducible local benchmark
From apps/frontend: bun tests/batchSupplyPreload.bench.ts
Real SettlementIndexer + HTTP handler + BackendDataStore in-process, Bun1.4.0; synthetic owners; no injected network delay.
|sources|first HTTP ms|warm HTTP ms|JSON bytes|ready cache lookup ms|extra open requests/bytes|
|---|---:|---|---:|---:|---:|
|9|11.139|0.580 / 0.410 / 0.705|5060|0.040|0/0|
|32|1.632|0.756 / 0.793 / 0.712|16467|0.005|0/0|
Nine-source first call includes process cold setup; 32-source first call is a new indexer but warm runtime. Before: one open request. After: one preload, zero additional fresh-open requests. Cold open joins pending preload; expired reopen still requests once. Max network calls zero both versions. No deployed-after/browser speed claim.

## Verification
From apps/frontend: bun test tests/batchSupplyPreload.test.ts tests/batchSupplyEffectiveInventory.test.ts src/backendDataStore.test.ts src/backendDataBoundary.test.ts — 71 passed, 462 assertions.
bunx tsc --project tsconfig.json --noEmit and git diff --check passed.
Coverage: relevant routes; fresh/in-flight reuse; loading/error/retry; 5s expiry; mandatory preflight revalidation; target identity; late wallet/chain responses. Existing inventory coverage retains due production, partial/final credit, launch debits, unsafe projections and both missions. No live wallet/manual browser QA.

## Full-shell regression correction
The full wallet shell passes chain IDs as hex while gameplay passes decimal. Raw string comparison falsely cleared the same-chain wallet bootstrap, producing Loading empire. Context now compares known chains using the existing numeric sameChainId helper, retains identity through unspecified bootstrap calls, and still wakes transaction recovery when the chain is first learned. Truly different known chains continue clearing old inventory. Added ready/pending preload regression for undefined → hex → decimal → undefined and real chain change. Before-fix focused shell bootstrap failed; after-fix bootstrap/repeated Build gestures passed (3 tests), and cold-bootstrap/manual-network-switch cases passed (14 tests). Preload/store units: 65 passed, 222 assertions. Browser commands used command-scoped NO_PROXY/no_proxy=127.0.0.1,localhost,::1.
