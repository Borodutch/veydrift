# Disabled proof settlement checkpoint

Production acceptance and activation remain unavailable. Game.submitBattleProof always reverts.
No production caller invokes VeydriftProofSettlement.accept; the test-only optimized harness
is temporarily etched into a synthetic proxy, then removed before exercising actual routes.
A trusted fixture is not a verifier or evidence of an accepted cryptographic proof.

## Application API

The existing Game -> StateMigration -> CombatRaid fallback routing exposes:
- applyProofBattleLeaves(uint256, (uint256,address,uint256,uint8,uint8,uint32,uint32,uint32,bytes32)[])
- proofSettlementProgress(uint256) -> (Phase,nextIndex,memberCount,expectedDigest)

These selectors live on VeydriftProofSettlementModule's ABI. Game and Gameplay bytecode are
unchanged. CombatRaid constructs the application module; deployment tooling must include that
constructor child/code identity when a future release is actually authorized.

Namespace: keccak256("veydrift.storage.proof-settlement.v1"). Neither raw journal encoding nor
existing Game/staged layouts change. Phase Unaccepted=0, Applying=1, Economics=2. Completion
remains the authoritative existing staged phase13 and mission status; Economics is never a
claim of terminal settlement. Ordinary permissionless resolvers and lazy continuation keep
using staged phase11/12 once every leaf has been authenticated and applied.

Acceptance freezes ChainRecord/root/count/round/final totals once. The only current caller is
TEST CODE. A future final-verifier adapter must authenticate all22 outputbridge public fields,
canonical LE64 limbs, pinned release/key/codehash, complete recursive dependency traces, and
compare independently recomputed ChainRecord. Never expose accept as a permissioned shortcut.

Each transaction accepts at most32 leaves (operational bound, not roster cap). Exact outputbridge
v1 suffix/node ABI verifies before a casualty mutation; cursor, unique(source,unit), counts,
loss+survivor checks include zero-loss rows. Final suffix and accumulated side survivor totals
must match. Invalid batches roll back atomically. Repeated leaves and replacement roots fail.
Loss is a debit from CURRENT inventory, not a frozen-survivor assignment. Insufficient inventory
fails closed, including Moon defenses. Newer credits survive. Nonzero ship resource losses and
packed defense destruction feed existing economics and score-aware body setters.

The existing b.missions order, zero-ship sources, frozen plunder rate, live cargo/fuel/ratios,
raid ordering, return epoch/index/hold cleanup, defense repair, reserve-limited live debris,
liability accounting and best-effort Moon chance remain authoritative. Locks release only in
existing terminal finalization. Direct revealed seed and authenticated rounds/totals are copied
before phase11; no legacy rehash. Defense repair widens destroyed*7 to uint256 and intentionally
wraps seed+lane modulo2^256; no count cap is introduced.

## Explicit Moon/header finding

Current raw header journals PLANET resources even for Moon attacks, and omits lastSettledAt.
This was assessed and is NOT silently changed here. Reused Moon raids read/debit live
_moonResources, not that incorrectly labeled historical pool. Thus this application checkpoint
must NOT be advertised as a complete offchain proof of economic resources. Before such a claim,
coordinate/version the body-specific pool header, rawbridge Header16/ABI fixtures and all pinned
release proofs with their owners. Return Moon generation/hold timestamps remain authoritative
external mappings; no offchain eligibility reexecution is claimed.

Other remaining release gates: approved recursive composition/final verifier and chain adapter,
release registration/metadata/codehash provenance, consumer/prover/keeper integration, full
production release review. Activation remains OFF.

## Local verification receipt

2026-10-05 synthetic Game proxy/module fixtures, no broadcast or live effects. Thirteen focused
settlement tests pass: suffix alteration/replay/zero-loss skipping/root replacement rejection,
atomic insufficient-inventory rollback, newer ship/debris/liability credits, direct and real
renamePlanet lazy economics, Moon pool/repair separation, partial cargo preservation, wiped cargo
release before live reserve clipping, held survivor/wipe cleanup, and independent uint32 repair /
uint256 wrapping seed boundaries. A pinned Go outputbridge static ABI leaf/root/tail vector matches.

Cold checks use Foundry transaction isolation plus a clean-SSTORE/transient-store boundary probe,
not merely cooled accounts. Real application/economic child calls remain capped below15M. The
aggregate test-driver gas allowance is100B only to construct and traverse a33-member fixture;
it is not a raised production transaction limit. Optimized focused run: full32-leaf batch gross
1,771,207 gas; two-leaf batch400,191; its terminal economy continuation694,521. These are measured
fixtures, not a proof of a maximum aggregate roster or worst-case economic work. The module's
32-leaf bound and existing persistent economics cursors remain the actual bounds.

The settlement test is intentionally left on the optimized default compiler profile together
with its storage-derived trusted harness. Production acceptance is still absent; tests substitute
trusted accepted output only, never report proof verification. Held-roster/accounting injections
are synthetic setup; launches, qualification, application and economic routes run real modules.

Final focused regression:157 PASS across13 suites; isolated staged gas suite10 PASS; isolated
upgrade cutover4 PASS. Cutover layout88 old fields/26 recursive types unchanged. Earlier test
fixture/optimizer-profile failures were corrected; these are terminal rerun results.
