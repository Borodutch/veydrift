# Inactive proof consumer increment

No production proof submission or deployment is enabled. The standalone keeper's existing release guard remains unchanged. The reviewed proof-runtime list is intentionally empty; getter success and frozen verifier metadata do not qualify a release.

Implemented:
- Existing keeper progress reads recognize staged16/17, read frozen record kinds0/5, settlement cursor, verifier runtime and frozen-engine request/context at the SAME EIP-1898 canonical hash. RPC/decode/binding failure is not legacy fallback.
- Ordinary keeper resolution is suppressed for proof waits/applying/unqualified runtime. A qualified future planner distinguishes preparation, request-bound readiness, proving, application and nonmonotonic17->11/12 economics. Readiness and application cursor participate in the existing durable high-water guard; block/phase/time alone never count as progress.
- Backend ordinary single/replacement preflight and batch candidate refresh exclude16/17. No proof-wait timeout bypass; Transport/Deploy/returns use existing paths. Existing ETH fee caps, nonce coordinator and productive batch simulations remain unchanged.
- Backend canonical reads expose separate proofBattleProgress (no percent or synthetic round count). After positively identifying a proof job, an application-getter outage remains unavailable even at shared preparation/economics stages. Retained terminal proof records allow canonical return legs at13 only under the existing runtime and paid-progress guards. Existing staged events16/17 retain conservative wait/unknown status through duplicate delivery, restart and removed-log replay. Stage17 alone cannot distinguish proving from accepted application. Authoritative pinned record+application reads can.
- Pure output suffix planner checks supplied canonical accepted binding/root/count/totals against the entire persisted stream, validates every row including zero-loss members, tail/root/current cursor and duplicate source/unit, then slices at most32 leaves. It never signs/submits, persists an acceptance claim or treats economics as terminal.

Still required before activation:
- Approved final verifier/key/runtime/module provenance and canonical accepted-summary event/getter. Current proofSettlementProgress lacks immutable accepted root/binding; no production adapter can safely manufacture AcceptedProofManifest.
- Stable final submission ABI is still required; no speculative final ABI was added. Existing read schemas now live in dependency-free packages/chain-abi/src/proofBattle.ts; JSON ProofBattleProgress lives in packages/api-types and is wired through backend and frontend mission types. Client fetches preserve its optional fields; UI rendering/adoption beyond types remains separate.
- Durable prover job/artifact acquisition and authenticated manifest/report indexing. This increment does not synthesize per-round combat events from aggregate loss leaves.
- Integrate qualified proof signing/delivery with the fee-capped backend nonce coordinator, same-block exact-call simulation, durable acceptance receipts, upgrade/rollback handling and canonical artifact retrieval. The pure suffix helper is tested planning, not delivery completion.
- Keeper reads preparation/economics records automatically only for a reviewed future runtime; unknown16/17 are recognized but fail closed. Backend can project their records, but ordinary16 consumption remains disabled until a qualified proof-aware writer is available.

Tests are synthetic/local only; no wallet or network transactions.
