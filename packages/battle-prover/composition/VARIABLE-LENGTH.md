# Variable-work key plan and present blocker

## Implemented boundary

Elementary phase instructions have roster-independent sizes/keys. `Chunk` can wrap one instruction; the two-sided preflight uses that family. A trace length changes the number of proofs, not the elementary circuit. `AuthenticatedClose` verifies complete attribution under a pinned approved key; `Pair` verifies two approved children and all adjacency. This eliminates unauthenticated helper-only composition, but does NOT eliminate recursive key growth.

## Why the existing finite DAG is not general

Groth16 VK contains setup-specific group constants. Every Pair pins child keys. A new child-key pair or tree level changes the parent circuit/setup. Selecting a witness VK would be unsound; hashing an arbitrary VK without authenticating membership is equally unsound. Compiling a new root from a roster-dependent schedule also fails the fixed-production-key requirement. Fixed test height is not arbitrary height. Current package deliberately does NOT claim otherwise.

## Concrete next production architecture

1. Approve a finite leaf instruction family (preparation5, combat11, attribution4, bridge nonClose4, report2). Keep protocol/phase domain in statement and bind exact public widths.
2. Normalize all leaf statements to an approved range schema, including bridge attribution obligations. No bare Close or unknown-phase node accepted.
3. Choose an established recursive/IVC implementation supporting authenticated universal relation or a documented curve cycle and fixed verification circuit. Do not invent a homegrown accumulator or self-referential VK fixed point. The currently installed gnark Groth16 gadget alone supplies proof verification, not an arbitrary-height fixed-key recursion construction.
4. If deploying a finite *explicitly versioned* level-key catalog instead, declare its exact capacity in protocol and settlement; that is bounded support and does not satisfy arbitrary-height requirement. No implicit cap.
5. Authenticate input qualification proof, chainSHA256 record and seed/RF provenance at outer settlement; combine with complete result allocation/report commitments.

## Resource feasibility

Existing one-sided full DAG took3811s despite only3 combat steps; three binary joins consumed ~38min of setup alone. Two-sided lethal-shot trace adds many combat steps, two Close obligations and more phase roots. Repeating per-node development Groth16 setup cannot responsibly be expected to meet60min total. Need reusable authenticated phase/node setup artifacts (approved source+schema+VK registry, not per-roster recompilation) and/or a measured established recursion backend before claiming the requested two-sided final proof within budget. No new over-budget setup was started at recovery.

Preflight measures actual elementary circuits under4M and solves native two-sided witness; it is NOT a proof receipt. Prior one-sided receipts remain separately preserved.
