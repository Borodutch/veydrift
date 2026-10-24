# Atomic moon Supply (#66)

The Game facade routes three additive selectors to its immutable batch module (selectors: version `0x8ae329df`, Transport `0x22ce1326`, Deploy `0x0803d47e`):

- `moonSupplyBatchVersion() external pure returns (uint256)`: returns 1 through the deployed Game proxy. Read this on-chain, fail closed on a revert/missing value, and never enable from environment metadata.
- `launchBodyTransportBatch(uint256 targetPlanetId, TransportBatchOrder[] orders) returns (uint256[])`
- `launchBodyDeployBatch(uint256 targetPlanetId, TransportBatchOrder[] orders) returns (uint256[])`

Both write selectors always target the owned **moon** of targetPlanetId, and accept 1–15 distinct owned **planet** origins. TransportBatchOrder is unchanged: originPlanetId, existing 14-field MissionShips tuple, Resources cargo, uint16 speedPercent. The parent planet is a valid source for its moon. Moon origins are not supported. Results preserve input ordering.

Each order delegatecalls the existing Game launchBodyFleetMission facade with originIsMoon=false, targetIsMoon=true. The original sender/delegator, pause gate, chronological fleet reconciliation, production settlement, owned moon existence, incarnation pinning, resource/fuel debit, slot guard, events, and lifecycle are inherited rather than duplicated. Any failed order rolls back the entire transaction, including earlier reconciliation and launch events. Moon batches use each canonical child slot check **after** lazy fleet reconciliation, not the legacy stale aggregate precheck; the 15-order bound still applies. Legacy planet batch behavior, single-body launch behavior, storage, and existing selectors are unchanged.

Transport unloads cargo and returns ships. Deploy lands ships and cargo. Destruction/replacement of the destination before arrival preserves canonical return-with-cargo fallback and never credits a replacement moon.

## Verification and rollout

Run `forge test --match-path test/VeydriftMoonSupplyBatch.t.sol -vv`, existing planet batch and moon tests, storage-layout checks, and production compiler size checks. Tests retain the canonical bounded chronology progress protocol; a keeper may need multiple resolution calls for a large shared target inventory.

Gas/size fixtures must use the optimized production Game artifact explicitly (`VeydriftGame.sol:VeydriftGame:0.8.28:default`), not the ambiguous name-only lookup when the unoptimized `.tests` artifact is also cached. The entire Game and moon Supply test suites must also stay in the optimized profile: selecting the Game artifact alone does not pin its dynamically linked library graph. A clean Supply → MoonSystem → Game build previously selected unoptimized Formulas/FleetFuel/Catalog/AntiRaidPrimitives/ScoreSnapshot library runtimes for Game tests and inflated the same 15-order launch from 14,509,415 to 16,169,620 gas. Running the whole Game suite with its production profile lowers that fixture to 10,611,903 gas and checks the deployed runtime lengths of all five affected libraries. The profile guard rejects re-adding these gas suites to the unoptimized list; no gas ceiling is relaxed. The prior 15-mixed-order over-cap fixture also depended on unoptimized libraries: it now includes already-supported matured production settlement, so it tests a genuinely expensive canonical workload under the same Base cap rather than asserting an inflated cost (17,760,516 gas with due settlement, and an atomic revert at the unchanged 16,777,216 cap).

Production runtime sizes: Game 24,203 bytes (373 bytes EIP-170 headroom), batch module 21,018 bytes.

A source count is **not** a gas guarantee. Committed-storage tests cover 15 small-cargo orders below Base's 16,777,216 cap, heterogeneous 15-order manifests above the cap, and total rollback when those are capped. Always estimate the exact atomic calldata and preserve existing gas and USD fee ceilings. Never split or retry an oversized batch automatically.

Release only via workspace CONTRACT_UPGRADES.md / scripts/veydrift-contract-upgrade.sh. Upgrade Game (which deploys/links its new batch module) before enabling dependent frontend calls. There is no MoonSystem code or storage change in this patch. Verify deployed version=1 through Game before enabling. No #44 dependency is introduced; if #44 merges first, review/retest the combined facade/module composition instead of dropping its changes.
