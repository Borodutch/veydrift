# #63 exact Max performance

## Diagnosis and change

Baseline: main 420aaa8a. Max already consumes a loaded snapshot, with no resource API/RPC requests inside the worker. The exact interval search could visit thousands of fleet-count boundaries when high stocks and many ships cannot afford fuel.

The new upper bound sums selected, eligible source capacity/stock bounds, limited to the largest 15 contributions (one for moons), subtracting other requested cargo for the total-capacity bound. For homogeneous fleets only, dispatch fuel is monotone in ship count: binary-search an affordable relaxed upper-bound fleet. The exact traced planner still determines the answer. Mixed fleets retain conservative raw-capacity bounds because speed/fuel transitions are not monotone. No binary search of cargo feasibility, heuristic answer, automatic launch, or blocked-fleet relaxation was added.

Worker lifecycle remains one per click: terminate on cancellation, identity-guard stale callbacks, terminate on success. Measured bundled worker startup plus computation is already below target, so persistent/prewarmed worker lifecycle state was not warranted. Cold CDN/network latency is not represented by loopback measurements.

## Reproduce from apps/frontend

- CPU: `bun tests/batchSupplyMax.bench.ts`
- Browser: `node --test tests/batchSupplyMax.bench.mjs`
- Baseline: `SUPPLY_MAX_BASELINE=1 node --test tests/batchSupplyMax.bench.mjs`
- Tests: `bun test tests/batchSupplyMax.test.ts tests/batchSupplyFleets.test.ts src/batchSupplyPlanner.test.ts`

Browser harness bundles the actual worker with Vite/Rollup (only explicit baseline substitutes the base planner), serves over loopback, and uses fresh disposable headless Chrome. No wallet/live state. Each sample creates/terminates a worker as production does; first sample is cold process/module cache, subsequent samples are warm browser but fresh worker. App startup is not in the measured interval.

## Measured 2026-10-08

Apple M1 Max, macOS 27.0.1, Bun 1.4.0, Chrome 154.0.8037.98. Synthetic deterministic fixtures: 9/15 selected sources, target 6:9:12, sources 6:(10+i):14, 250m metal/source. Normal: 40 Large Cargo + 20 Small Cargo, 1m deuterium/source. Fuel-starved: 10,000 Large Cargo, 10 deuterium/source. Not actual owner inventories.

### Worker create → result, ms (first; warm; warm)

| Sources / fixture | Baseline | After |
|---|---|---|
| 9 normal | 28.8; 24.5; 21.9 | 28.1; 20.8; 21.8 |
| 9 fuel-starved | 8319.3; 8326.6; 8275.4 | 19.8; 19.1; 19.2 |
| 15 normal | 24.9; 22.8; 22.3 | 19.7; 21.2; 20.4 |
| 15 fuel-starved | 23119.2; 23078.3; 22900.0 | 20.3; 20.3; 19.3 |

Exact maxima unchanged: 9 normal 9,893,951 metal; 15 normal 16,489,013; both starved zero. Worker bytes: baseline 349,104; after 349,689 uncompressed, including preexisting galaxyActions → walletFlow dependency. Harness deliberately serves without HTTP caching: 12 worker-file requests/run, zero API requests. Snapshot payload/request/preload evidence is separate in board-63-preload.md.

### CPU-only, ms (first; warm; warm)

| Sources / fixture | Baseline | After |
|---|---|---|
| 9 normal | 3.253; 1.173; 1.142 | 2.063; 0.531; 0.393 |
| 9 fuel-starved | 5380.207; 5328.163; 5385.111 | 0.192; 0.165; 0.140 |
| 15 normal | 1.538; 1.140; 1.145 | 0.506; 0.419; 0.380 |
| 15 fuel-starved | 15060.406; 15212.597; 15405.329 | 0.233; 0.194; 0.194 |

## Verification and limits

42 focused tests / 794 assertions pass: exhaustive nonmonotone islands, mixed fleets, manual overrides, all resource orders, both modes, moon/fleet cap, exact calldata, new homogeneous fuel-bound exhaustive checks. New 9/15-source performance regression allows 1s CI ceiling for six maxima/fixture (all twelve measured 1.33ms). Desktop target is evidenced by separate benchmark rather than scheduling-sensitive test assertion. Frontend TypeScript passes.

Adversarial mixed-type fuel-starved inventories can still be expensive: the bound deliberately makes no monotone mixed-fleet assumption. Exact searches remain off the UI thread and cancellable. No universal <200ms claim. Live deployed UI and owner-inventory timing remain dedicated QA work.
