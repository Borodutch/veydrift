# #44 identity-correct two-job LOCAL fixture — code/plan only

## Parent coordination / approval requested

Proposed same-catalog jobs (please relay to runtime and3284 BEFORE setup/job freeze):

| job | distinct attacker/defender | attacking fleet | resident defender | committed seed |
|---|---|---|---|---|
| A | 0x440100 / 0x440101 |2 Destroyers |1 SmallCargo |1 |
| B | 0x440102 / 0x440103 |1 Destroyer |1 SmallCargo |2 |

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
7. bun scripts/ticket44-identity-fixture.ts settle reopens the same saved chain. If unaccepted it submits through the real Game fallback/module, demands one ProofBattleAccepted event and exactly workDone+1, authenticates the immutable accepted summary, resumes leaf delivery at chain nextIndex, then finishes economics(stage13) and normal returning fleets to terminal status. Actual execution must additionally receive independent review and negative/replay evidence before claiming complete acceptance coverage. No acceptance is claimed by the prepared code.

## Long-proof persistence / replay

Anvil is owned by each invocation, loopback-only, no attaching to an unrelated node. It uses --preserve-historical-states, periodic30-second state dumps and a graceful SIGTERM dump to node-state.json. The driver saves exact receipt files and an atomic-renamed RPC intent/result journal (not a claimed power-loss fsync guarantee). On resume it checks genesis SHA256, deployed verifier runtime, both original seal block hashes/logs and frozen getter bytes. Missing historical logs/state fails closed.

replay rebuilds from the unchanged genesis with journaled deterministic block timestamps, sender nonce, gas/price, commits, launches and all subsequent mutations. Every recorded RPC result must match, and original anchor hashes/frozen records must remain identical. It writes replayed-node-state.json without overwriting the saved original. A crash leaving an intent without result is a named reconciliation blocker, NEVER permission to blindly resend it or declare success. Snapshot/history replay remains UNEXECUTED pending the genuine key; do not infer Anvil receipt retention merely from its flags. Later execution must demonstrate a real stop/reopen and replay before starting the long proof, and preserve the successful frozen package.

Synthetic genesis includes fixture resource-token contracts and imported module state. It is not a deployment-gas test or production reserve/finality claim. The attack/preparation/oracle events after genesis must all be actual Anvil receipts. Current production contracts, Go sources, old proof receipts and prior evidence remain untouched.

## Validation this increment

Solidity exporter/provisioner compiled successfully; exporter intentionally skipped(0 executed positive jobs). Offline guards:2pass/0fail. TypeScript syntax bundle passed with viem external; no full TS typecheck, Anvil execution, Source read, fresh proof or positive submission is claimed. Fresh storage/size/build, formatter, live-upgrade policy and test-profile checks PASS; final gate neat-nexus collected exit0. Receipts are in /tmp/ticket44-identity-*.log. No production source/layout/bytecode changes were made.
