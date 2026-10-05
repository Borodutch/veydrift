# Stable preparation interface

Exports in types.go: Row.Values, KeyValues, MemberValues, CohortValues, MemberHash, CohortHash, MemberHashCircuit, CohortHashCircuit. ResultHashCircuit in circuit.go.

Members rolling hash starts zero: H440804(previous,owner4,source4,count4,side,type,weapons,shielding,armor,keySide,keyType,attack4,shield4,hull4,cohortID4). Positive rows only, canonical key then owner/source. Cohorts rolling hash starts zero: H440805(previous,keySide,keyType,attack4,shield4,hull4,cohortID4,mergedCount4). IDs contiguous zero. Member counts per cohort/global can be derived during downstream manifest reconstruction; not separate claimed counts. H(d,v)=MiMC(d,len(v),v...).

State.UnitRoot is exact memorybattle depth258/domain1 roster root (leaf440401/all36 LE limbs); State.Total uint256. Result H440808(context,members,cohorts,unitRoot,total4). Step public [ContextHash,BeforeHash,AfterHash,Result]. Context binds full identity, raw/catalog/tech roots and row count; seedPolicy separate, no seed choice. Identity includes explicit TargetIsMoon. Raw counts uint32; merged counts/cursors uint256.

Boot, Pair(all raw pairs), Member(visited-tree permutation), Expand(unit), Finish. Pair authenticates full source/type uniqueness and source/owner technology consistency. Member authenticates catalog and frozen owner-tech sparse keys, computes effective stats via protocol helpers. Downstream MUST reconstruct both manifests, link terminal preparation Result, and use UnitRoot/Total in combat Input. No recursive/EVM proof claim.

`AssertCombatInput` now enforces bridge snapshot convention: memorybattle Snapshot4 is canonical LE uint256 preparation ContextHash, less than BN254 scalar modulus, reconstructed equal. This ties full preparation identity to combat Input, not only roster root/count.
