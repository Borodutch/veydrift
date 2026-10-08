# Mission resolver confirmation and archival retention

## Ordinary admission versus finality

The private resolver SQLite journal separates active/unproven intents (32) from canonically confirmed retained intents (4096). This is not a larger pending nonce window: an unresolved receipt, unknown send, prevented broadcast, outstanding signing reservation, or nonce contradiction still holds the shared signer. Existing same-body chronology, fee caps, pre-sign readiness, identical-byte replay/backoff and cross-process send/lease fencing are unchanged.

Ordinary admission requires the original locally signed envelope and its durable reservation/result binding, the matching canonical receipt hash/from/to, canonical block identity, every member's block-pinned domain outcome, and a consumed signer nonce at that block bracketed by another canonical hash read. Existing signed but weakly hydrated rows must obtain that proof; old hash-only rows remain in the original bounded fail-closed path. A receipt can consume a nonce without completing a mission, including reverted and partial batches; admission never invents a terminal domain outcome.

The highest proven nonce's receipt is the durable canonical **frontier**. Every pass checks its containing hash and, until finalized, block-pinned consumed nonce. Before a successor is committed, the old frontier is checked again; the current frontier is checked at the end. Nonce/block ordering must be consistent. Thus a reorg of any historical ancestor necessarily changes the frontier hash, even if that ancestor is outside the current archive page. A crash cannot advance the persisted frontier before the old-anchor check. Once finalized, frontier checks need only the immutable header, not indefinitely retained historical state.

### Trust and reorg risk

This is a trusted, coherent canonical RPC model, not an independent-provider quorum or a claim of cryptographic ancestry proof from untrusted RPC responses. Canonical number-to-hash reads must represent one chain; locally signed transaction identity additionally binds chain and signer. A Byzantine RPC, corrupted trusted journal, or finalized-consensus violation is outside this model. A reorg immediately after a check remains possible, as for ordinary confirmed Ethereum submissions. Subsequent reconciliation fails closed before another allocation; signed bytes and outcomes remain retained until safe retirement. The indexer and canonical domain reads remain responsible for projection/reorg reconciliation; no balance credits are inferred from admission metadata.

Do not switch providers per request or select the highest reported finality. A replacement endpoint must preserve the frontier's chain/block identity. Automatic independent finality failover is deliberately not introduced: normal traffic no longer needs that liveness dependency, while receipt retirement still requires a coherent explicit finalized tag and matching canonical block hash. Node/reference disagreement belongs in the node monitor and release evidence. Multi-candidate legacy recovery is different: its original/alternative winner, reference verification and finality-based signer hold remain unchanged.

## Incremental archival work and storage

Each lease-fenced pass visits at most 32 active rows and eight retained confirmed rows, plus the constant-size frontier. A durable nonce cursor resumes archive pages after restart and wraps at the end. Partial-index scans and LIMIT bound loaded rows; the original 128 asynchronous-read / 5-second pass budget, late-result fencing and outstanding-read tracking still apply. Pages do not authorize admission. Normal empty-queue batch ticks also reconcile.

An unavailable finalized tag retains records without treating latest as finalized. A contradictory finalized hash fails closed. A hung read still reaches the bounded pass deadline and is actionable, not silently ignored; persistent RPC transport failure is not promised uninterrupted service. Legacy unproven history may need multiple bounded drain passes before admission.

At explicit canonical finality, an ordinary row's signed blob and its transferred signing-result copy are cleared in the same fenced transaction; hashes, nonce, membership, outcomes, attempts and audit evidence remain. Recovery-group signed evidence is excluded. SQLite reuses freed pages. There is no deletion of unfinalized intent evidence or automatic destructive VACUUM/reset. At 4096 retained confirmed intents, new prepared batches stop while reconciliation can drain them. At 240 MiB of database pages plus WAL, even new lease/cursor writes stop, reserving headroom for existing operations/late signer results. This is a safety ceiling, not unlimited lifetime storage: investigate pinned WAL readers/disk and plan reviewed private archival maintenance before reaching it. Never restore an old nonce journal or manually delete rows to clear admission.

## Health and operating targets

Writer mission-resolution health now includes admission active/retained counts and their limits, whether counts are capped, database-plus-WAL bytes, last canonical settlement time, and a fixed non-secret blocked reason. Admission blocking degrades health even when tick lastError or failure counters are zero. Existing due-arrival/return oldest ages, counts, completed legs and tick timings supply queue progress; public health does not contain signed bytes, memberships or upstream credential-bearing errors.

Targets for the existing deterministic monitor (no new model polling):

- Alert on any admission block persisting across two samples; dedupe by fixed reason and send a single recovery transition.
- Warn at 75% confirmed retention (3072) or 192 MiB journal+WAL, before the hard ceilings.
- Use existing mission promptness target for oldest due arrival/return. Escalate if a nonempty eligible queue makes no canonical settlement progress for 120 seconds, excluding documented game pause/dependency holds.
- Keep node latest/safe/finalized age and independent-reference disagreement separate from resolver health. A finality lag alone is not proof of a latest-head outage.
- Retain existing signer-balance/fee readiness alerts; no new signer, funding or fee-cap relaxation is introduced.

## Verification and release

The offline integration tests exercise 48 locally signed coordinator submissions and 40 full production batch selection/readiness/sign/send/receipt paths with finality frozen, including restart after 32. They assert bounded reconciliation reads, durable archive cursor movement, deep reorg and consumed-nonce failure, missing finality versus contradictory finality, retention admission stops and finality-safe compaction. Existing crash/persist/send, ambiguous transport, lease, two-second recovery readiness, chronology and domain accounting suites remain release gates. Synthetic keys and transports never send to a live chain.

Release must retain one writer and the same private journal through the managed stop-first rollout. Back up consistently, verify current recovery owner and running SHA, and never overlap an operator recovery with deployment. The schema is additive but an old binary does not understand admission separation and will conservatively see retained rows as a full window; use hold-sends/forward repair rather than assuming a transparent downgrade. Dedicated QA and the release owner still owe sustained live queue drainage, real traffic, node/reference advancement and asset-accounting proof; offline tests alone do not complete ticket #61.
