import type { ChainReader, DebrisFieldEvent, MoonChanceReportEvent, SettledPlanetEvent } from "./evm";

export type IndexedDebrisFieldEvent = DebrisFieldEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;
export type IndexedMoonChanceReportEvent = MoonChanceReportEvent & Pick<SettledPlanetEvent, "galaxy" | "system" | "position">;

export type IndexerSnapshot = {
  indexedDebrisFields: number;
  indexedMoonChanceReports: number;
  indexedPlanets: number;
  fromBlock: string;
  lastRebuiltAt: string | null;
};

export class SettlementIndexer {
  private readonly debrisFields = new Map<string, DebrisFieldEvent>();
  private readonly moonChanceReports = new Map<string, MoonChanceReportEvent>();
  private readonly planets = new Map<string, SettledPlanetEvent>();
  private lastRebuiltAt: string | null = null;
  private planetRebuildPromise: Promise<IndexerSnapshot> | null = null;
  private rebuildPromise: Promise<IndexerSnapshot> | null = null;

  constructor(
    private readonly chainReader: Pick<
      ChainReader,
      "listDebrisFieldEvents" | "listMoonChanceReportEvents" | "listSettledPlanetEvents"
    > & Pick<Partial<ChainReader>, "listCurrentPlanets">,
    private readonly fromBlock: bigint
  ) {}

  snapshot(): IndexerSnapshot {
    return {
      indexedDebrisFields: this.debrisFields.size,
      indexedMoonChanceReports: this.moonChanceReports.size,
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

  moonChanceReportsInSystem(galaxy: number, system: number): IndexedMoonChanceReportEvent[] {
    return [...this.moonChanceReports.values()].flatMap((report) => {
      const planet = this.planets.get(report.targetPlanetId);
      if (!planet || planet.galaxy !== galaxy || planet.system !== system) return [];
      return [{ ...report, galaxy: planet.galaxy, system: planet.system, position: planet.position }];
    });
  }

  settledPlanets(): SettledPlanetEvent[] {
    return [...this.planets.values()];
  }

  settledPlanetsByOwner(): Map<string, SettledPlanetEvent[]> {
    const planetsByOwner = new Map<string, SettledPlanetEvent[]>();
    for (const planet of this.planets.values()) {
      const owner = planet.owner.toLowerCase();
      planetsByOwner.set(owner, [...(planetsByOwner.get(owner) ?? []), planet]);
    }
    return planetsByOwner;
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

  applyMoonChanceEvent(event: MoonChanceReportEvent): IndexerSnapshot {
    this.moonChanceReports.set(moonChanceReportKey(event), event);
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }

  async rebuild(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }

    this.rebuildPromise = this.rebuildUncached().finally(() => {
      this.rebuildPromise = null;
      this.planetRebuildPromise = null;
    });
    this.planetRebuildPromise = this.rebuildPromise;
    return this.rebuildPromise;
  }

  async rebuildPlanets(): Promise<IndexerSnapshot> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    if (this.planetRebuildPromise) {
      return this.planetRebuildPromise;
    }

    this.planetRebuildPromise = this.rebuildPlanetsUncached().finally(() => {
      this.planetRebuildPromise = null;
    });
    return this.planetRebuildPromise;
  }

  private async rebuildUncached(): Promise<IndexerSnapshot> {
    const events = await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    const debrisEvents = await this.chainReader.listDebrisFieldEvents(this.fromBlock, "latest");
    const moonChanceEvents = await this.chainReader.listMoonChanceReportEvents(this.fromBlock, "latest");
    this.planets.clear();
    this.debrisFields.clear();
    this.moonChanceReports.clear();
    for (const event of events) {
      this.planets.set(event.planetId, event);
    }
    for (const event of debrisEvents) {
      this.applyDebrisEvent(event);
    }
    for (const event of moonChanceEvents) {
      this.applyMoonChanceEvent(event);
    }
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }

  private async rebuildPlanetsUncached(): Promise<IndexerSnapshot> {
    const events = this.chainReader.listCurrentPlanets
      ? await this.chainReader.listCurrentPlanets()
      : await this.chainReader.listSettledPlanetEvents(this.fromBlock, "latest");
    this.planets.clear();
    for (const event of events) {
      this.planets.set(event.planetId, event);
    }
    this.lastRebuiltAt = new Date().toISOString();
    return this.snapshot();
  }
}

function moonChanceReportKey(event: MoonChanceReportEvent): string {
  return event.outcomeId ? `outcome:${event.outcomeId}` : `battle:${event.battleId}:${event.targetPlanetId}`;
}
