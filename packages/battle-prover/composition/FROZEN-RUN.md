# Active full settlement development run

Run namespace: full-20261005-v1. Source frozen before import and all proof stages. Do not edit any battle-prover Go file/go.mod/go.sum while this run is active; strict dependency/source approvals fail closed. Markdown/log updates and parent Solidity work do not change these circuits.

Audited import reuses14 real rawleaf/D0 proofs plus actual LinkedCircuit proof; each VK/CCS/proof/public identity independently pinned, all6 currentCCS recompilations must match before separate approvals are created. No SRS/PK/private-witness persistence.

Driver: PIPELINE_RUN=full-20261005-v1 sh composition/run-settlement-batch.sh <batch> from packages/battle-prover. Serialized batches: raw, attribution, prep, combat, bridge, report, output, final. No parallel heavy stages. Each phase split leaf,D0,B_h/D_h; every go test proofstage60min,<=4M constraints,2CPU,soft6GiB. Routine checks2GiB. First failure stops; no automatic retry/overwrite. Whole workflow is many hours, not a claim of a60min total proof. Public-only checkpoints permit review/resumption without retained proving secrets.

Progress: composition/pipeline-runs/full-20261005-v1/progress.txt and per-stage logs. Artifacts: composition/staged-public/settlement-phases-v2/full-20261005-v1. Independent development approvals: composition/stage-approvals/full-20261005-v1. Approvals are owned local setup receipts, NOT production promotion.

Final proof is a separate22-public Base BN254 Solidity-target proof with verifier/MarshalSolidity artifacts. Separate resumable attack gate checks all22 fields and swapped/omitted genuine bundles; task completion additionally requires that marker and final re-verification. Core final proof checkpoint is preserved before expensive attacks, addressing the independent review P2 resilience finding.

No activation/deploy/board changes by this subagent. Retain #44 ownership until terminal result; raw partial receipts alone are not closure.

Active raw batch: native process young-ember, PID80612, started1791261825802. Command above with batch=raw; outer watchdog16000s, individual proof stages remain60min. Completion collector5d5060ed owns notification, main composition agent owns original-handle collection and subsequent serialized batches. Success signal is BATCH COMPLETE raw plus approved rawD3 and raw-qualified adapter manifests. On recovery inspect progress/terminal logs first; never rerun or overwrite a started stage blindly.

Raw batch terminal PASS; young-ember collectedexit0. COMPLETE raw prefix + LinkedCircuit actual bundle proof SHA256413221c809be88d8eb6dd169b388f5cf6a427dbc71c56397ad23808424de401b;3,397,328 constraints. Raw multilevelB1..3/D1..3 and bundle allwithin60min/4M; maxRSS8,220,409,856B underunchangedsoft6GiB. No finalsettlementclaim.

Active attribution batch: process clear-gulf PID94606 started1791267154549, commanddriver attribution. Sixserializedleaf/D0/D1..4 stages, sharedkeysacrossboth actualcohorts. Outerwatchdog22500s; everyproofstage60min unchanged. Nextafterterminal: prep,combat,bridge,report,output,final. NoGoedits/sourcefreeze remainsactive.

Attribution terminal PASS; clear-gulf collectedexit0. BothactualcohortsD4 counts10/4 shareVK95cfdaf828032e30081b7da4cd3a93241f41a43c0a8cb9a166cafe77a1105f9c; proofscef3d96098dd79acf1de34b0d78f313778442f7fb41496d83ac0fb905a337f5f andb241c58ce5f472b0ccaa65e5ed4798d8b155788da9cb299e57d3a613bd356d1b. Allsixstages<=60min4M; maxRSS7,646,691,328B underunchangedsoft6GiB.

Active preparation batch: quick-haven PID30200 started1791274465347, outer26000s; sevenserializedleaf,D0..D5 stages. Nextafterterminal:combat,bridge,report,output,final. Sourcefreezeunchanged.

Preparation terminal PASS2h33m33s; quick-haven collectedexit0. D5 actualwork17 proof63c79f4b5fb50089bb6e46c98ac816e052d4bf181e389087737a620865bb1217, VKaf67a8a62b6bc8bca2a436cb4e93209a8ae719cc79b3d538641b9c9fec558359. All7stages<=60min4M; peakRSS8,386,691,072B underunchangedsoft6GiB.

Active combat batch: delta-cloud PID74180 started1791283772458, outer30000s; eightserializedleaf,D0..D6 stages over36actualcombattransitions. Nextafterterminal:bridge,report,output,final. Allsourcefrozen/noGoedits.

Combat terminal PASS3h38m52s; delta-cloud collectedexit0. D6actualwork36 proof054d349481af56a7bcf9cb652d7dcfb5fce3639df793d7c17c67c4c36f2eb7c1, VKb409b88470041e9d1c412e3d5c769d913a8ec2c113c79b1339398d4cb383ca93. All8stages<=60min4M;peakRSS8,418,787,328B underunchangedsoft6GiB.

Active bridge batch:vivid-ridge PID44345 started1791297013879 outer22500s; sixserializedleaf,D0..D4 stages over11actualtransitions, bothClose proofs consume verified sharedattributionD4 roots. Nextafterterminal:report,output,final. NoGoedits/sourcefreezeunchanged.

Bridge terminal PASS 2026-10-06T16:35:57Z; vivid-ridge collected exit0. D4 work11 proof 0f417a6c907f5ce9458acde46bfb71ce5622a3531ed188dd0faf644ebde7904e; VK ed61f3c8d44ca4d2531b58e8c67f8967bd8cbf76454941d7e5de24c41863406c. Both authenticated Close receipts005/009 proved; all six stages within4M/60min. PeakRSS8,341,504,000B exceeds unchangedsoft6GiB.

Active report batch grand-river PID92609 started1791304642934 outer15000s; serialized leaf,D0..D2. Next output,final. Source freeze unchanged.

Report terminal PASS 2026-10-06T17:38:10Z; grand-river collected exit0. D2 work3 proof8baf2687e1cef69362282563148eba13739b5f3d76b8fe8a34fc5f942c4efcec; VKaefdbb5ac57e12fceb350d62228be288147c9a0ddbd14521ba98ba01452e6e35. Fourstages4M/60min PASS, total60m47s. PeakRSS7.028GiB exceeds unchangedsoft6GiB.

Active output batch kind-summit PID11849 started1791308470019 outer22500s; sixserializedleaf,D0..D4. Next final adapters/proof/attacks/reverify. Sourcefreeze unchanged.

Output terminal PASS 2026-10-06T19:54:08Z; kind-summit collected exit0. D4work9 proof6d25eb05ed7cd0a406d4f26776e84cd67401ff67aa6d716528871fbf0c1f17a7; VK30521b11903c68d96662d5c38da9dd7dd2a4a1aaab806d7bd7cf6e88fd7bcc96. Sixstages4M/60min PASS; peakRSS8,131,198,976B exceededunchangedsoft6GiB. Allsevenphasefamilies complete finitefixture heights.

Active FINAL batch vivid-mist PID21597 started1791316526011 outer22500s: five sequential adapters prepared-combat,bridge-report,pipeline,output-pipeline,final each60min; separate final attacks10min2GiB and final reverification5min2GiB. Success requires BATCH COMPLETE final,22-public Solidity-target artifact,attacks.json,final-reverification PASS. Sourcefreeze unchanged; full completion not yet claimed.

FINAL COMPLETE 2026-10-06T21:10:26Z. vivid-mist collected exit0; all five final adapters, attack gate and re-verification PASS. Final proof SHA256 2f737b89540723d81292c78f2c196c883cb9ad6dcdb911c2ff549e6ba3a8888a. See FULL-SETTLEMENT-EVIDENCE.md. No active proof process. Source pins remain immutable; future Go changes require a new reviewed namespace, not replacement of receipts. Parent owns remaining integration/release.
