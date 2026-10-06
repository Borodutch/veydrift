# Protocol-wide circuit templates

`BuildCatalogTemplate(node, orderedDependencies...)` supplements `BuildCatalogGraph` with actual production `frontend.Circuit` relations. It takes only a node and public dependency CCS/VK objects, never a job, roster, battle fixture, proving key, deployment identity, or approval.

- Ordinary leaves use `composition.LeafShape`. Bridge Close uses typed `resultbridge.Shape(Close)` with canonical zero public statement slots, then `NewCloseWitness`; allocation completion/count are constructor-only witness values. It retains `CompleteClose` and its attribution proof obligation.
- D0, Bh and Dh use `FamilyNode`, dependency-order fixed VK catalogs, and CCS-derived `rec.PlaceholderProof` / `rec.PlaceholderWitness`. D0 normalizes Level to 1 as the production witness constructor does. Selectors are witness slots constrained by the fixed catalog, not witness-supplied keys.
- Adapters are `qualification.LinkedCircuit`, the two `FamilyPhaseJoin` modes, `Join` mode 2, `RawQualified`, `OutputPipeline`, and `SettlementFinal` (exact Solidity22 public layout).
- Node identity, dependency order/count, public widths, BN254 R1CS/VK types, commitment counts and exact committed-public layouts are checked. Selectable VKs must have compatible layouts. Metadata is copied rather than aliased. Individual root dependencies allow canonical D0..D256: the externally approved full graph pins each selected root height.

## Trust and activation gate

Schema compatibility cannot prove that a CCS/VK pair corresponds to the claimed node or ceremony. The external approval process must bind source, exact CCS/VK bytes, dependency order/key digests, full graph/root heights and setup provenance. This builder does not self-approve. Game/verifier/codehash remain witness fields; no deployment-specific value is baked into the final template, so final-VK construction does not depend on an actual job.

No setup, PK creation/persistence, approval creation, service/runner integration, deployment, or historical pin change is performed here. Production activation still requires independently approved protocol-wide setup artifacts, pinned manifest, and the existing release/readiness gates. A factory test is not a recursively proved catalog.

## Bounded checks

`GOMAXPROCS=2 GOMEMLIMIT=2GiB go test -p 1 ./runtime -run TestCatalogTemplate -count=1 -timeout=5m -v`

Tests validate topology/schema for all 3,634 full-height nodes; instantiate all role/kind variants, heterogeneous reduced heights and maximum-height node shapes; reject malformed schemas/dependencies and incompatible commitment layouts; check actual public-witness widths. Shape-only dependency keys use generator points and tiny dimension circuits, are not setup output, and never authenticate a proof. One actual attribution leaf is compiled with a 4,000,000-constraint ceiling. No recursive-heavy compilation, setup or proving is invoked.

Verified 2026-10-06: all four `TestCatalogTemplate*` tests passed (package time 1.063s); the selected attribution leaf compiled to 88,571 constraints and exactly three public inputs. Limits were two Go CPUs, soft 2 GiB Go memory and five-minute test timeout. Earlier test-only schema counting was corrected to use `frontend.NewWitness(..., frontend.PublicOnly())`: gnark `NewSchema` double-counts anonymous embedding, whereas the compiler/witness walker does not. No production relation was altered to satisfy a test.

## Independent review correction

Review identified an in-place compiler alias in the first factory implementation: repeated binary children reused private proof/witness placeholder slices. Before any recursive setup/proving or artifact generation, this was corrected so every child occurrence allocates fresh CCS-derived PlaceholderProof and PlaceholderWitness; only immutable fixed key constants are shared. The regression covers plain and commitment-bearing dependencies, distinct storage, and actual gnark schema.Walk unique assignments. All template tests PASS1.456s under2CPU/soft2GiB; no heavy recursion compile/setup. Independent fix re-review confirmed the P1 corrected with no further P1/P2; focused suite independently passed in 1.363s. Original historical receipts were unaffected because the new factory had generated no keys.
