# Independent bounded-proof review

2026-10-05, openai/gpt-6-astra high reasoning, read-only review (no tests run by reviewers).

Initial review: no soundness defect found in the 30-transition 15+15 construction. Confirmed real CommittedStep constraints, full-state/context/counter/terminal joins, compile-time pinned keys, RangePair terminal-identity suffix, RangeFinal genesis/start/nonempty/terminal guards, actual chunk/pair/final Prove calls, unchanged4M/two-thread/soft6GiB guards. Identified coverage confounding in negatives: mismatched public statements and heterogeneous-key replay could fail without isolating individual guards; outcome mutation without rehashing could fail solely on commitment mismatch.

Follow-up review of committed_attack_test.go and combat_multichunk_negative_test.go: prior isolation defects fixed, no blocking source-level issue. Genuine permissive-child proofs isolate bit100 state mismatch, counter/context/done joins and individually matched terminal suffix attacks, with accepted identity control. Genuine invalid-final child proofs isolate final guards. Actual combat result mutations recompute all commitments/endpoints. Same-key replay/reorder remain multi-invariant negatives, accurately understood. Tests must execute serially under bounded resources.

Both review children completed and their reports were collected. Reviews do not establish proof completion/resource results; see combat-multichunk.log and combat-multichunk-attacks.log for executable receipts.

Scope: fixed four-slot development fixture only; final public statement binds the full result commitment, not a separate outcome scalar. General variable-memory battle integration, arbitrary rosters/schedules/heights, production qualification/key lifecycle, EVM verification and settlement remain separate engineering gates.
