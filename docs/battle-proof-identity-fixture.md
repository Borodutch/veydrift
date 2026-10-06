# #44 identity-correct two-job LOCAL fixture — HOLD pending re-review

**Execution hold:** the three P2 fixture corrections below require independent re-review before ANY key/job/Anvil execution. Offline owned mock transport and pre-job Foundry accounting tests only have run.

## Parent coordination / approval requested

Proposed same-catalog jobs (please relay to runtime and3284 BEFORE setup/job freeze):

| job | distinct attacker/defender | attacking fleet | resident defender | committed seed |
|---|---|---|---|---|
| A | 0x440100 / 0x440101 |2 Destroyers |1 SmallCargo |1 |
| B | 0x440102 / 0x440103 |1 Destroyer |1 SmallCargo |2 |

Synthetic genesis sums all four planets into the global internal-resource counters (4,000,000 of EACH resource), checks the sum against storage and reserve-token backing both after seeding and immediately before export. The historical single-planet `_fundPlanet` reset is not used as the aggregate.

Each is a normal planet Attack with one attacking source, two raw rows, two cohorts; weapons/shield/armor research zero. Synthetic initial research IRN3000 avoids protection score skew; Computer10 supplies slots. Four distinct seeded planet locations/balances/fleet inventories avoid cross-job target locks. Both use the SAME final verifier address/codehash and approved release/key manifest. Runtime owner must confirm native trace work/root heights fit the proposed finite catalog **before keys are approved**. No fleet cap is added to gameplay; max8 export rows and bounded128 lifecycle calls are this tiny local fixture's operational checks, never truncation.

No key setup, proof generation, verifier substitution, job freeze or local node was run in this increment. There is no approved-key file or created identity-fixture artifact directory. Parent supplies actual final VK/export identity after3284's gate; do not fill it with the historical receipt or a dummy verifier.

## Files / boundary

- contracts/test/VeydriftIdentityGenesis.t.sol: opt-in PRE-JOB synthetic genesis exporter. Deploys supplied verifier creation bytecode using CREATE and checks actual nonempty ≤EIP170 runtime against the approved codehash; creates a real ERC1967 Game proxy. It initializes public resources/tokens and synthetic starting balances/research/ships/coordinates only, and exports every real linked/module runtime. No mission is launched in Foundry.
- contracts/test/support/IdentityReleaseProvisioner.sol: DEV-only temporary code injection that can provision prospective/approved release only when nextFleetId==1 and prospective version==0. It cannot seed jobs, requests, raw data, accepted roots, phases or outputs. Real proxy code is restored BEFORE export and every launch. Production registry has no new writer/setter and remains empty.
- scripts/ticket44-identity-fixture.ts: owned loopback Anvil lifecycle/export/persistence/replay/settlement driver; every real transaction has total gas limit15,000,000 and the local block limit is also15M. No fork, signer key, personal wallet, remote RPC, or production network is supported.
- scripts/ticket44-identity-fixture.test.ts: offline URL/DEV-identity guard tests, not EVM evidence.

## Final key input (not populated yet)

Parent-controlled path: packages/contracts/manifests/ticket44-identity/approved-key.json.
Required fields: developmentOnly=true, parentApproved=true, version=3, rules (0x32), catalog (0x32), manifestSHA256 (0x32), creationCode (0x bytes), runtimeCodehash (0x32). rules must be keccak256("veydrift-individual-shot-candidate-2"); protocol catalog is86290965991ad030826bb0ae7d65f767940d1cbf7c37f0f76fcaaf11309e8ae1. manifestSHA256 is the independently approved NEW development public-key/proof manifest identity expected by runtime, not a digest chosen from either job.

Creation bytecode and expected deployed runtime hash must come from the actual3284 export/compilation; no prediction, historical Game1/verifier7/hash77 replacement or reproving is performed by this helper. Verifier/Game addresses are obtained from real local constructor execution. All jobs are created only AFTER those addresses/codehash and registry provisioning exist.

## Execution AFTER key/catalog agreement

1. Ensure ordinary repository dependencies (viem) are installed through the normal project dependency process. This worktree currently lacks root node_modules, so the driver is only syntax-bundled with viem external; runtime module resolution has NOT been proved. Do not override NODE_PATH (host policy rejects it). No dependency installation/lockfile edits were performed here.
2. Parent creates the task directory and approved-key.json. Run from packages/contracts: VEY44_EXPORT_IDENTITY_GENESIS=true forge test --match-contract VeydriftIdentityGenesisTest --gas-limit 100000000000 -vv. Test-wide budget is setup only, not the subsequent Anvil transaction cap. Without opt-in this exporter deliberately SKIPS.
3. Repo root: bun scripts/ticket44-identity-fixture.ts prepare. Refuses a pre-existing task journal/state or occupied127.0.0.1:18444. Starts its own Anvil with chain31344, genesis time1800000000, imported unchanged addresses/storage/code. Each job does real oracle commit → normal launchBodyFleetMission Attack → arrival → bounded preparation/enrollment/seal(stage16) → real fulfillRandomness → consumption(stage17). No accepted-state injection or fake seal/reveal is possible in this path.
4. Mines128 local blocks, pins all reads to the same finalized head, exports both documents plus source-config.json and frozen.json. Every row/source event is compared with the real proofBattleRecord getter bytes; the raw keccak journal is reconstructed and must match the real sealed snapshot. ChainRecord is computed from the actual17-word authoritative state. The seal block/hash, not observation head, is the Anchor.
5. bun scripts/ticket44-identity-fixture.ts serve reopens saved state and serves the actual Source endpoint while runtime runs. Parent/runtime should use the real chainsource.Source with source-config.json and compare its canonical document/input SHA256 with each exported battle-N.document.json. The exporter is not a substitute for Source validation. Source/runtime's actual execution is not covered yet.
6. Parent supplies genuine per-job runtime result exports as battle-N.proof.json: chainRecord (unprefixed32-byte hex), manifestSHA256 (unprefixed), public (22 decimal strings), proof (384-byte0x bytes), leaves (canonical S.Leaf objects). This small local delivery wrapper is not a new production runtime wire protocol. No dummy receipts or synthetic acceptance are permitted.
7. bun scripts/ticket44-identity-fixture.ts settle reopens the same saved chain. If unaccepted it submits through the real Game fallback/module, demands one Game-emitted ProofBattleAccepted event with ALL fields bound to the proof publics/frozen release, validates historical workDone at receipt block−1/block (+1), authenticates ALL immutable summary fields, resumes leaf delivery at chain nextIndex, then finishes economics(stage13) and normal returning fleets to terminal status. Actual execution must additionally receive independent review and negative/replay evidence before claiming complete acceptance coverage. No acceptance is claimed by the prepared code.

## Long-proof persistence / replay

The driver inspects kernel listener PIDs with bounded lsof, not HTTP probes. Only an unambiguous empty listing permits spawning; errors, malformed output, timeouts or any occupied port fail closed. After spawn it requires the listening PID to equal the live child PID and monitors child exit. Every driver RPC then uses that child's random socket inside a private0700 temporary directory, NEVER the ambient HTTP endpoint. Anvil's HTTP endpoint remains read-only-by-convention for the separately run Source; child exit terminates serve instead of silently accepting a replacement listener. Offline tests use an owned ephemeral mock listener/socket, not Anvil or an unrelated endpoint.

All resumed modes (serve/settle/replay) perform disk admission BEFORE spawn/RPC. Every intent must have a result/head; every transaction must have its exact hash-bound receipt at the correct journal position. checkpoint.json(v2) binds the journal length+SHA256, snapshot SHA256 and exact final block hash/number. Behind/ahead snapshots, missing/uncertain tails, mismatched receipts or legacy/no checkpoint are **manual reconciliation blockers**, not automatic retry paths. Resumed serve/settle also read the loaded chain head and every receipt/transaction calldata, sender, nonce and gas fields before allowing any mutation. Settle preflights ALL already-accepted jobs against their unique journaled submission receipt and full historical event/summary/+1 evidence before even impersonation; no acceptance assertion is skipped on resume.

Only a wholly successful invocation followed by clean child shutdown can publish a new checkpoint. Periodic30-second and final dumps go to pending-node-state.json; failed invocation state is retained there for inspection, never promoted over the last clean node-state.json. Publishing the new snapshot/checkpoint is fail-closed, not a multi-file atomic/power-loss durability guarantee: a crash between writes will produce a mismatch and require reconciliation. Atomic-renamed journal writes preserve completed intents but are not an fsync claim. Do not edit/drop uncertain journal entries or fabricate a checkpoint to unblock the tool.

replay is allowed only from a fully reconciled clean checkpoint, not as an automatic recovery of an uncertain transaction. It reconstructs the exact journal from unchanged genesis (timestamps, nonce, gas/price and commands), requires identical RPC results, then compares all receipt/transaction identities, head, frozen getter bytes and original seal anchors. It writes replayed-node-state.json/replayed-checkpoint.json without overwriting the original clean state. Preserved-history Anvil snapshot/replay and actual Source are still UNEXECUTED pending the genuine key and re-review. Later execution must demonstrate a stop/reopen/replay before starting the long proof. A crash or missing historical event/state remains a named blocker, not permission to re-prove/rebind or claim acceptance.

Synthetic genesis includes fixture resource-token contracts and imported module state. It is not a deployment-gas test or production reserve/finality claim. The attack/preparation/oracle events after genesis must all be actual Anvil receipts. Current production contracts, Go sources, old proof receipts and prior evidence remain untouched.

## Validation this increment

Latest correction gates: **12 offline TypeScript tests PASS** (80 assertions), including the owned mock kernel-listener/private-IPC transport; the real-proxy four-planet Foundry backing regression PASS and key-dependent exporter SKIP. Solidity build/output guards, storage, EIP170 sizes, formatter, live-upgrade policy and test-profile checks PASS (keen-valley exit0). Final TypeScript syntax bundle passed with viem external; no full TS typecheck, Anvil execution, Source read, fresh proof or positive submission is claimed. Receipts: /tmp/ticket44-identity-safety-tests.log, /tmp/ticket44-identity-liability-fixed.log and /tmp/ticket44-identity-review-{build,sizes,storage}.log. Production source/layout/bytecode remains unchanged.

## P2 correction evidence

- Actual pre-fix four-planet proxy regression FAILED: metal liability conservation1,000,000 !=4,000,000 (/tmp/ticket44-identity-liability-baseline.log). The corrected real-proxy pre-job fixture test passes for all three resources/backing; no Attack or verifier fixture runs in this test.
- Three offline source-excerpt baseline reproductions FAIL (uncertain settle tail, timeout-as-vacant, incomplete event assertion). These are explicitly modeled old guard behavior, not execution of the full old driver: /tmp/ticket44-identity-guards-baseline.log.
- Focused fixed tests exercise snapshot/journal positions, absent receipt/results, live transaction/receipt mismatches, listener ambiguity, exited/wrong child, actual owned mock kernel PID+privateIPC and zero dispatch after exit, all10 acceptance-event fields and all8 summary fields (both totals), and historical delta checks. These are not proof acceptance or Anvil receipts.
- Production source/setters are unchanged. Genuine key setup, local jobs/Anvil, accepted-state injection, deployment and git operations remain prohibited in this correction task. Await parent re-review and catalog-bound agreement.
