# Additive authenticated settlement composition

Old QualifiedFinal remains OLD SHA schema. New adapters in settlement.go accept qualification.LinkedStatement only. They do not reuse the legacy seven-field interpretation.

1. RawQualified verifies normalized3-public raw prefix root and LinkedCircuit7-public proof under compile-time approved VKs, constrains raw genesis/terminal and q.RawResult equality, emits one MiMC commitment over rawFirst5,rawLast5,qualified7.
2. OutputPipeline verifies normalized3-public output root and complete upstream8-public pipeline proof, constrains output genesis/terminal, emits one MiMC commitment over outputFirst5,outputLast5,pipeline8.
3. SettlementFinal verifies BOTH one-public bundle proofs, opens their exact claims, calls outputbridge.AssertAuthenticated with authenticated claims, and emits EXACT Settlement22 ABI. Every raw/prep/combat/attribution/report/output dependency is reachable from the pinned final key. A helper-only claims harness exists for supplemental adversarial tests and is NOT a verifier.

RawJournal phase5 and SettlementOutput phase6 are additive normalized families; width5 each. Both retain every statement scalar, including raw.KindPublic. Ordinary fixed-key native steps wrap existing sibling gadgets, no custom crypto/hints. Link/Complete dispatches to sibling helpers only after proof authentication or inside a true transition circuit. Generic FamilyNode/dispatch-first DAG supports their prefixes without roster-dependent keys.

Raw proof stage checkpoint paths staged-public/raw-v1. Each stage generates actual proofs under fresh DEVELOPMENT setups kept IN MEMORY, stores only proof/VK/public witness/canonical endpoint openings/CCS hash and role. Save immediately reloads, checks hashes, verifies proof and binds claimed endpoint commitments to actual public values. Trusted local receipts are NOT a public key approval service or accepted prover-selected VK. Source+dependency manifests accompany stages; production key approval and ceremony remain unperformed.

Stage0 produces all7 actual raw leaves and a full4-key D0 dispatcher; stages1..3 produce actual B_h/D_h, including odd suffix promotion. RawQualified stage requires loadedD3, genuinely proves LinkedCircuit, then proves complete raw+qualification bundle. Each stage separately enforces60min/4M/2CPU/soft6GiB; no proving key persistence or promotion. A missing phase/final receipt means incomplete pipeline—not success.

Current full fixture: pinned catalog,3 units on2 sides,2 attacker owners,2 attributiongroups,3 complete allocation leaves including zero-loss members. Native raw7/prep17/combat36/bridge11/report3/output9. No empty substitution. Complete final proof is still pending; keep #44 ownership open. Contract work/activation remains parent-owned.
