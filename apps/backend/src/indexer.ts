import type { ChainReader, SettledPlanetEvent } from "./evm";

export type IndexerSnapshot = {
  indexedPlanets: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
};

export class SettlementIndexer {
  private readonly planets = new Map<string, SettledPlanetEvent>();
  private lastRebuiltAt: string | null = null;

  constructor(
    private readonly chainReader: Pick<ChainReader, "listSettledPlanetEvents">,
    private readonly fromBlock: bigint
  ) {}

  snapshot(): IndexerSnapshot {
    return {
      indexedPlanets: this.planets.size,
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.lastRebuiltAt
    };
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    return [...this.planets.values()].filter((planet) => planet.galaxy === galaxy && planet.system === system);
  }

  applyEvent(event: SettledPlanetEvent): IndexerSnapshot {
    this.planets.set(event.planetId, event);
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }

  async rebuild(): Promise<IndexerSnapshot> {
    const events = await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    this.planets.clear();
    for (const event of events) {
      this.planets.set(event.planetId, event);
    }
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }
}
