> **2026-10-06 update:** Complete two-sided finite-fixture raw-linked 22-public settlement proof, attack gate and final re-verification PASS. See [FULL-SETTLEMENT-EVIDENCE.md](FULL-SETTLEMENT-EVIDENCE.md) for current evidence and remaining production/D256 scope. Earlier incomplete-execution statements below are historical.

# Complete native-fixture phase runner (development only)

## Scope and evidence

TestSettlementPipelineStage in pipeline_stage_test.go implements all seven phase
roots of buildSettlement(t, false): the real three-unit, two-sided, pinned-catalog
fixture, including raw journal, linked qualification input and output leaves.
No empty-fixture or four-instruction attribution-program substitution is used.
The final adapters already exist in settlement.go; their proof runner is still
separate work (integration below). A phase root alone does not enforce phase
completion: CompleteClose, FamilyPhaseJoin, RawQualified and OutputPipeline
perform the relevant completion checks when consuming those roots.

Implementation was checked only with the cheap no-tests Go compilation command.
No setup, circuit compilation, solver run or proof was executed for this runner.
No full-phase runtime, full-catalog recursive size, or full settlement proof is
claimed. Existing raw-v1 receipts are intentionally NOT imported automatically.

## Explicit finite test heights and exact planned work

| PIPELINE_PHASE | Actual elementary edges | Approved kinds | Final root | Proofs per stage: leaf, 0..height | Total keys |
| --- | --- | --- | --- | --- | --- |
| prep | 17 | 5 | D5 | 17,17,17,9,5,3,2 | 16 |
| combat | 36 | 11 | D6 | 36,36,36,18,9,5,3,2 | 24 |
| attribution | 10 + 4, separate cohorts | 4 | D4 for BOTH | 14,14,14,7,4,3 | 13 |
| bridge | 11, including 2 CompleteClose | 5 | D4 | 11,11,11,6,3,2 | 14 |
| report | 3 | 2 | D2 | 3,3,3,2 | 7 |
| raw | 7 | 4 | D3 | 7,7,7,4,2 | 11 |
| output | 9 | 5 | D4 | 9,9,9,5,3,2 | 14 |

Total: 42 independently bounded test invocations, 99 in-memory family setups,
390 genuine proofs planned before final adapters. These are operation counts,
not measured timings. Root heights are explicitly finite fixture heights, NOT
D256, arbitrary-height production support or a per-roster circuit schedule.

Stage `leaf` (manifest Stage=-1) compiles/setups each approved elementary kind exactly once, including
unused kinds via LeafShape without IsSolved or a fake proof. Actual instructions
use setupFamily with a real positive witness; all matching edges across all
cohorts reuse that key. Its process ends after public leaf receipts and the full
key catalog are frozen. Stage 0 loads those receipts with pipelineLoadLeaves,
compiles/setups ONLY unary D0 once with the FULL phase catalog, and dispatches
every actual leaf. It never repeats elementary setup/proofs.
KeyCatalog.ForFamily checks schema/commitment-metadata compatibility before
recursive compilation. Any incompatibility or >4M circuit fails closed.

Stage h>0 compiles/setups B_h once against the fixed D_(h-1) key, proves every
actual adjacent pair, then compiles/setups D_h once selecting exactly
[B_h,D_(h-1)]. D_h wraps each pair or promotes the odd unpaired real child.
No replay, empty padding, unproved identity or witness-selected arbitrary VK.

Attribution runs BOTH groups in each invocation and uses ONE shared family key
per kind/stage across them. Widths are (10,4)->(5,2)->(3,1)->(2,1)->(1,1).
The short cohort is actually promoted through stages 3 and 4; both D4 roots have
the identical VK/CCS, checked again on reload. Bridge leaf stage requires those
completed manifests and proofs. Each actual Close uses CompleteClose with the
corresponding full attribution range and proof, under the shared D4 key; a bare
bridge Close never enters FamilyLeaf.

## Run one stage at a time, never concurrently

From packages/battle-prover, routine source-only check (2GiB soft):

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./composition -run='^$' -count=1 -timeout=60s

Only when an operator has explicitly selected an idle proof slot, run ONE stage:

    PIPELINE_RUN=reviewed-run-001 PIPELINE_PHASE=attribution PIPELINE_STAGE=leaf \
      GOMAXPROCS=2 GOMEMLIMIT=6GiB \
      go test ./composition -run='^TestSettlementPipelineStage$' -v -count=1 -timeout=60m

Repeat manually with stage0,1,2,3,4, collecting terminal exit status and logs after
each invocation. Do not launch a loop/background cascade without a watcher and
resource approval. The test rejects a missing or >60minute Go test deadline,
>2 GOMAXPROCS, or a missing/nonpositive/>6GiB soft memory limit. Every compile
uses the existing compile helper's 4,000,000-constraint ceiling. GOMEMLIMIT is
soft, not an RSS guarantee. Monitor memory externally; stop on envelope failure.

Use the SAME PIPELINE_RUN and unchanged source for all stages/phase roots.
Finish implementing the final adapter runner BEFORE freezing source for the first leaf stage;
adding another Go test file later also changes the source manifest.
Attribution leaf,0..4 must precede bridge leaf; all other phase roots are independent but
still run sequentially. Each phase's own stages must run in increasing order.
Finish all stages listed above before calling the final adapters. Do not run
this while the separately owned rawstage0 or any other heavy proof is active.

### Checkpoints and failures

Artifacts are under:

    composition/staged-public/settlement-phases-v2/<PIPELINE_RUN>/<phase>/stage-XX/

Leaf uses stage-leaf/; D stages use stage-00/ through stage-height/.
Each successful stage writes manifest.json after its artifacts, then writes an
independent owned-setup approval with O_EXCL outside the artifact tree:

    composition/stage-approvals/<PIPELINE_RUN>/<phase>/stage-leaf.json
    composition/stage-approvals/<PIPELINE_RUN>/<phase>/stage-00.json

Leaf receipt basenames are g00-leaf-000 (g01 for the second attribution group);
manifest Receipts maps these basenames to metadata SHA256. Manifest Keys maps
leaf-00 through leaf-(kind count - 1) to {VKHash, CCSHash}; corresponding public
key files are leaf-key-00.vk etc. There are no D receipts/keys in the leaf stage.
D0 contains only D-key.vk, Keys["D"], and actual D receipts. Receipts use
'g00-D-000' (and 'g01-D-000' for the second attribution root), with the existing
saveStage/loadStage .proof/.vk/.public/.json format. Elementary proofs stay in their leaf directory; intermediate B proofs stay in
their own h>0 stage directory. Extra key-only VK files plus CCS hashes document
ALL approved kinds, including unused kinds with no fabricated receipt.

Manifests contain version, exact heights/group sizes, hashes of all module Go
sources/go.mod/go.sum, dependency-manifest hashes, each receipt-metadata hash,
and public key/CCS hashes. Reads validate the acyclic manifest ancestry,
source identity, full catalog key files, shared D key across ALL groups, and
native Groth16 verification/public range binding via loadStage. Loaders require exact receipt and file sets, reject extra/missing files and
nonregular artifacts, compare leaf kinds and public ranges to the source-pinned
fixture, and validate the complete dependency graph (D0 -> leaf, bridge leaf ->
attribution D4). Each ancestor is checked against its separate approval.

Approval pins completed manifest SHA256, all source hashes, and key VK/CCS
hashes. Loaders only compare approval; they NEVER create/repair it from receipt
JSON. pipelineApproveStage(t, base, m) is solely for the owned setup path after
writing a completed manifest, or a separately audited pinned import. It checks
the supplied in-memory manifest equals disk and source remains unchanged, then
writes approval exclusively. pipelineApprovalPath(base, phase, stage) returns
its path; pipelineCheckApproval(t, base, m) verifies it. Approval files must be
controlled by the trusted local setup owner independently of artifact writers.
Control of both roots defeats this local trust model. These are owned setup
receipts, NOT signed production promotion or arbitrary-prover key approval.

No proving key, setup seed, toxic waste or private witness is persisted.
Only public proof/VK/public witness, endpoint/count openings and hashes cross
stage boundaries. The stage directory is created exclusively: both complete
and interrupted directories are refused, so reruns cannot silently mix fresh
random setup keys with old receipts. Resume at completed stage boundaries only.
If a stage fails, stop. After inspection, an operator may archive its incomplete
directory and rerun that ENTIRE stage with new ephemeral keys, provided no
completed downstream stage depends on it. Never keep a partial set of proofs
and regenerate its PK. Source changes require a fresh run namespace (or an
explicit audited migration, not supplied here). Preserve logs and artifacts.

### Budget estimates and known unmeasured gates

The full computation should be planned as many hours, not one 60minute run.
With 42 invocations the aggregate timeout allowance is 42 hours, not a runtime
prediction or permission to extend any stage. Existing project evidence says
recursive setup alone can take minutes to tens of minutes. The early combat
stage is especially uncertain: leaf needs 11 setups and 36 elementary proofs;
stage0 needs one full 11-kind recursive setup and 36 dispatch proofs; stage1
needs two recursive setups and 36 proofs. The old combined combat stage0 is
prohibited: its predicted runtime is near or beyond 60 minutes. The split is
not evidence that either new stage fits; estimate separately before execution. No evidence establishes that these
fit 60minutes. Full 11-kind dispatch and CompleteClose catalog compatibility
also remain runtime gates. Estimate each stage as sum of its setup times plus
actual proof counts times measured corresponding proof times; include compile,
solver and verification overhead. Stop on timeout/4M/memory incompatibility.
Do NOT raise limits, prune approved kinds, substitute dummy proofs, persist PKs,
or split one key family into independently setup edge batches to force a pass.
A timeout requires a separately reviewed staging/backend design before retry.

## Exact integration points for remaining final stages

Load roots using pipelineLoadLevel(t, base, phase, pipelineHeights[phase],
pipelineSources(t)); one receipt per group. It validates completed manifests,
source identity, public artifact hashes, and exact D key reuse. The base is
filepath.Join("staged-public", pipelineVersion, PIPELINE_RUN). Do not bypass it
with old receipts/ or staged-public/raw-v1 files. Any legacy raw import must
be separately pinned/audited, publish the exact v2 leaf + D0 manifests and
independent approvals, and preserve the already-genuine keys/proofs.

pipelineLoadLeaves(t, base, phase, sources) returns ([][]familyReceipt, []Key,
[][]int): actual grouped receipts, complete catalog in Dependencies selector
order, and per-edge kinds. pipelineLoadLevel accepts only D stages 0..height.
pipelineSources and pipelineStageDir retain their existing signatures.

For FamilyPhaseJoin, use receipt.auth as Children[i] and receipt.rangeValue as
Ranges[i]. Use the actual root VK constants, not root-height labels as approval.
For adapters accepting Auth instead of CatalogAuth, conversion is:

    Auth{Proof: r.auth.Proof, Witness: r.auth.Witness, Key: r.auth.Keys[0]}

Required remaining proof DAG (separate <=60minute invocations if necessary):

1. Prove f.qualified, the actual qualification.LinkedCircuit from
   buildSettlement(t,false), with seven public fields. Not legacy SHA-layout
   QualifiedFinal, not a fresh hand-written public-only qualification witness.
2. FamilyPhaseJoin Mode0 verifies prep D5 + combat D6 and emits eight fields.
   With a=prep.rangeValue, b=combat.rangeValue, public is
   [a.First[0],a.Last[3],b.First[0],b.Last[7],0,0,0,0].
3. FamilyPhaseJoin Mode1 verifies bridge D4 + report D2 and emits
   [0,a.Last[1],a.Last[2],a.Last[3],a.Last[0],a.Last[7],b.Last[6],
   f.m.Manifest.Pipeline[7]], where a=bridge range, b=report range.
   The relation checks completion and the combined result, not native advice.
4. Join Mode2 verifies both eight-public join proofs. ChildrenPublic are their
   exact arrays; Public is f.m.Manifest.Pipeline, with all unused Ranges fields
   represented consistently with the existing Join setup helpers.
5. RawQualified: Claims=claims(f)'s first return value; Raw/RawRange come from
   raw D3; Qualification is the genuine seven-public proof from step1.
   Digest=resultbridge.Hash(rawQualifiedDomain, Claims.values()...). Prove it,
   retaining its one public digest and the checked claims openings.
6. OutputPipeline: Claims=claims(f)'s second return value; Output/OutputRange
   come from output D4; Pipeline is step4's genuine eight-public proof.
   Digest=resultbridge.Hash(outputPipelineDomain, Claims.values()...). Prove it.
   This native domain/length MiMC hash matches rawbridge.Hash(api,...) used by
   both adapter circuits; rawbridge.Hash itself is a circuit helper.
7. SettlementFinal: Public=f.m.Manifest.Settlement() (EXACTLY22 public fields),
   Provenance=step5 Auth, Results=step6 Auth, RawQualified/OutputPipeline=the
   actual checked claims, Manifest=f.m.Manifest. Compile, solve, setup, prove
   and natively verify against the approved final VK, within the same limits.

Reuse native proof/VK/public helpers for the 7/8/1/22-public adapter receipts;
saveStage/loadStage themselves are intentionally THREE-public-family-only and
must NOT be used blindly for those schemas. Extend public-only versioned
adapter manifests to pin source, input manifest hashes, VK/CCS and exact public
schema. No helper-only equality test or native FromBridge result counts as a
proof obligation. Record final22 public witness and verified final proof hash.

Before any full-proof claim, execute the entire DAG and collect terminal proof
verification plus expected negative cases (wrong cohort/root/key, omission,
replay, premature completion, mutated public claim and final ABI). This runner
only supplies the phase-root path; no final proof execution or production
approval is implied by source compilation.
