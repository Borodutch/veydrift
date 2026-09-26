# VEY-KANEO-902 — 15-order build-plan implementation handoff

This PR is **code only**. Do not merge into auto-deploying main until the release owner has deployed and verified **both** upgraded contract runtimes. No signer use, broadcast, merge, proxy activation, migration, or live UI claim is part of the implementation worker.

## Boundaries and measured gas

- One typed atomic transaction per body; 15 rows count orders, not unit quantity. Planet Game embeds a new `VeydriftBatchTransportModule` address in its constructor; MoonSystem links a new `VeydriftMoonProductionBatch` library. The 16-entry **per-lane backlog cap remains unchanged**; active production is separate. A fresh body accepts 15 rows; preexisting backlog can reduce available slots. Child settlement occurs before the resulting-backlog check and a failing child rolls back the entire transaction.
- Foundry pinned `0.8.28`, optimizer 1, via IR, no CBOR metadata. Fresh planet heterogeneous 15-row success: 3,052,281 execution gas. Fresh moon 15-row success with fighters/rockets/dome and variable quantity: 2,999,547 execution gas. Planet and moon last-row overspend roll back atomically; 16 rows reject. Per-lane backlog 16 rejects overflow without changing paid queue state.
- Loaded settlement proof: 15 new mixed rows after 15+15 already-ready backlog entries of 100 units each: planet 4,294,683 execution / 4,340,323 conservative execution+intrinsic/calldata upper bound; moon 4,317,927 / 4,363,567. The upper bound uses 21,000 + 16 gas for **every** encoded calldata byte, deliberately overcounting zero bytes. Both remain below the existing 12,000,000 wallet preflight guard and Base's documented 16,777,216 per-transaction maximum (https://docs.base.org/specifications/transactions/throughput-and-limits).
- These are local eligibility/state probes, **not** keyless simulation against freshly read live state. The parent must perform that release gate before broadcasting or merging the frontend.

## Upgrade and state invariants

- Production source diff touches only two private constants (4 → 15). Existing ABI signatures, events, storage declarations, initializers, children, ownership/delegation, pause/combat guards, FIFO/timing, and backlog16 enforcement are unchanged. The caller-side encoder uses the same frontend cap as draft evaluation; the counter is immediately after the Build plan heading and reflects only draft rows.
- `bun run check:fast` confirms Game runtime 23,899 bytes (677 below EIP-170), initcode 36,004; Moon runtime 23,937 bytes (639 below EIP-170), initcode 24,510; BatchTransportModule runtime 10,890; MoonProductionBatch library runtime 1,380. `bun run check:storage` confirms Game inherited v1 + reviewed append; Moon inherited layout has 22 slots and six struct types, untouched by this constant-only diff. No initializer or reset is introduced.
- Parent must read fresh owners, proxy slots, module addresses and nonces. Game transparent ProxyAdmin and Moon UUPS have different owners. Build a **new** minimal upgrade graph and keyless fresh-fork/live-state proof; do not reuse prior VEY-897 nonces or the generic UpgradeGame script. Activate capability in both contracts before frontend15 rollout. Verify deployed source, implementation, embedded/linked library closure and receipts, then merged-main CI, managed Easypanel deployment and live planet/moon Shipyard/Defenses desktop/mobile QA with screenshot evidence. Preserve queues/resources/players and do not burn an NFT just for QA.

## Validation caveat

- The legacy VEY-741 Uniswap launch manifest at the fetched main baseline already pins sourceCommit `d7ee5def` while its validator derives `7e19e3be`. `manifest:check` and `manifest:test` fail on that unrelated stale historical artifact even before this PR; do not rewrite old fork proof to imply a fresh one. The scoped GitHub CI for contract files runs fast checks, test suites, and storage checks—not that legacy manifest validator. Review exact-head CI separately.
