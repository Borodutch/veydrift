import type { ChainReader, DebrisFieldEvent, SettledPlanetEvent } from "./evm";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

export type IndexerSnapshot = {
  indexedDebrisFields: number;
  indexedPlanets: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
};

export class SettlementIndexer {
  private readonly debrisFields = new Map<string, DebrisFieldEvent>();
  private readonly planets = new Map<string, SettledPlanetEvent>();
  private lastRebuiltAt: string | null = null;

  constructor(
    private readonly chainReader: Pick<ChainReader, "listDebrisFieldEvents" | "listSettledPlanetEvents">,
    private readonly fromBlock: bigint
  ) {}

  snapshot(): IndexerSnapshot {
    return {
      indexedDebrisFields: this.debrisFields.size,
      indexedPlanets: this.planets.size,
      fromBlock: this.fromBlock.toString(),
      lastRebuiltAt: this.lastRebuiltAt
    };
  }

  settledPlanetsInSystem(galaxy: number, system: number): SettledPlanetEvent[] {
    return [...this.planets.values()].filter((planet) => planet.galaxy === galaxy && planet.system === system);
  }

  debrisFieldsInSystem(galaxy: number, system: number): IndexedDebrisFieldEvent[] {
    return [...this.debrisFields.values()].flatMap((field) => {
      const planet = this.planets.get(field.planetId);
      if (!planet || planet.galaxy !== galaxy || planet.system !== system) return [];
      return [{ ...field, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  applyEvent(event: SettledPlanetEvent): IndexerSnapshot {
    this.planets.set(event.planetId, event);
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }

  applyDebrisEvent(event: DebrisFieldEvent): IndexerSnapshot {
    if (event.resources.metal === "0" && event.resources.crystal === "0") {
      this.debrisFields.delete(event.planetId);
    } else {
      this.debrisFields.set(event.planetId, event);
    }
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }

  async rebuild(): Promise<IndexerSnapshot> {
    const [events, debrisEvents] = await Promise.all([
      this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest"),
      this.chainReader.listDebrisFieldEvents(this.fromBlock, "latest")
    ]);
    this.planets.clear();
    this.debrisFields.clear();
    for (const event of events) {
      this.planets.set(event.planetId, event);
    }
    for (const event of debrisEvents) {
      this.applyDebrisEvent(event);
    }
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }
}
