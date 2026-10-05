# Independent EVM review

Preflight reviewer: openai/gpt-6-astra/high, run c650ada6-c03a-4f8c-83c8-16e2a8be6424, 2026-10-05.

Must-fix: gnark-crypto fr.Element.String() formats near-modulus small negatives as signed decimal. Replace export serialization with BigInt(...).String(), and regression-test 0, 1 and R-1. Not known to affect this fixture. Keep running proof source unchanged through source-manifest recheck; apply exporter-only correction afterward, retain exact pre-correction export source snapshot, prove actual fixture values/bytes equal canonical serialization, and record distinct final-source manifest. Do not silently attribute proof receipt to changed sources.

Other reviewed paths clean at preflight: public-only actual final proof linkage, seven-field order, MarshalSolidity commitment encoding, required negatives, separate gas labels, isolated config (0.8.28/optimizer200/Cancun/no RPC/FFI disabled).

## Resolution and final independent verdict

The serialization finding was fixed after terminal proof completion and the original 31-source recheck. Original exporter retained as evm/export-run-source.go.txt; corrected source has a separate final manifest. Regression tests cover 0, 1, R-1 and independently reconstruct every actual combat public scalar: all match the unchanged fixture and original serialization. Negative EVM calls additionally use a 1M gas cap and require explicit ProofInvalid(), not generic call failure.

Final reviewer: openai/gpt-6-astra/high, run 8a902a98-80ab-40cf-9611-8d7a1bd2036f, settled 2026-10-05. **Clean — no must-fixes within the EVM additions.** Independently checked original-snapshot/final-source/public-artifact hashes, genuine-proof terminal receipt linkage, canonical regressions, and reran isolated Forge: 5 passed/0 failed. Reproduced gas348,734 callee/351,722 call delta/406,586 whole test; separate deployment. Confirmed development-only/local-EVM scope and explicit exclusion of live Base fees/production readiness. No heavy proof rerun or evidence overwrites.

All review children settled and owned execution processes collected before handoff.
