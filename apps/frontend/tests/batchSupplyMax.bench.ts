import { maximumBatchSupplyResource, type BatchSupplySource } from "../src/batchSupplyPlanner";
const targetCoordinates = { galaxy: 6, system: 9, position: 12 };
for (const count of [9, 15]) for (const fuelStarved of [false, true]) {
  const sources: BatchSupplySource[] = Array.from({ length: count }, (_, i) => ({
    planetId: String(i), label: String(i), coordinates: { galaxy: 6, system: 10 + i, position: 14 },
    resources: { metal: 250_000_000, crystal: 1_000_000, deuterium: fuelStarved ? 10 : 1_000_000 },
    ships: { largeCargo: fuelStarved ? 10_000 : 40, smallCargo: fuelStarved ? 0 : 20 }, driveLevels: {},
  }));
  const options = { targetCoordinates, sources, selectedPlanetIds: new Set(sources.map(s => s.planetId)), requested: { metal: 0, crystal: 0, deuterium: 0 }, maxOrders: 15 };
  const timings: number[] = [];
  let maximum = 0;
  for (let run = 0; run < 3; run++) {
    const start = performance.now(); maximum = maximumBatchSupplyResource(options, "metal"); timings.push(performance.now() - start);
  }
  console.log(JSON.stringify({ count, fuelStarved, maximum, milliseconds: timings }));
}
