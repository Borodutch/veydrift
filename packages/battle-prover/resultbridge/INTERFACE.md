# Result bridge integration contract

Implementation is in types.go / circuit.go / machine.go / report.go / adapter.go.
See README for exact remaining proof-authentication and chain-binding obligations.

- Imports preparation.MemberHashCircuit / CohortHashCircuit (native helpers too).
- Prepared.Commitment is EXACT preparation.ResultDomain(context,members,cohorts,
  unitRoot,total4); no disconnected manifest. Complete scans derive count limits.
- Snapshot convention: memorybattle Snapshot4 is canonical little-endian uint256
  encoding of preparation.ContextHash. Strict field-modulus bound prevents aliases.
- Bridge statement: Context, PreparedResult, BattleInput, BattleResult, Before,
  After, Finished, Result, AttributionContext, AttributionResult. Every Close has
  a REQUIRED complete verified attribution obligation; no fake verifier supplied.
- Report statement: Context, BattleInput, BattleResult, Before, After, Finished,
  Result. All original report rows in round/index order reconstruct exact 440404
  commitment; final hull authenticates final-round alive; depth258 final memory
  authenticates every row's key/cohort. Projection preserves every per-unit row.
- Combined result: H440713(Context, allocationBridgeResult, reportProjectionResult).
- FromMachines checks actual preparation / memorybattle native roots and result
  encodings before creating witnesses; constructors are not proof verifiers.
- Existing complete tests use real sibling machines and imported manifest helpers,
  not invented matching roots. One-sided test also solves all prep/combat steps;
  mixed/empty/full-width fixtures solve bridge and attribution, with native combat.

RF root/seed provenance and chain qualification remain external authenticated
inputs. Full proof recursion/key pinning and settlement are not implemented here.
