import { createHash, createHmac } from "node:crypto";

export type Address = string;

export type PrivateResources = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export type PlanetStatePreimage = {
  schema: "veydrift.planet-state.v1";
  planetId: string;
  owner: Address;
  epoch: number;
  salt: string;
  resources: PrivateResources;
  buildings: Record<string, number>;
  defenses: Record<string, number>;
  ships: Record<string, number>;
  research: Record<string, number>;
  sensitiveMissions: Record<string, unknown>;
};

export type PlayerStatePreimage = {
  schema: "veydrift.player-state.v1";
  owner: Address;
  epoch: number;
  salt: string;
  research: Record<string, number>;
  planetIds: string[];
};

export type PrivateStateSnapshot = {
  owner: Address;
  planetId: string;
  epoch: number;
  root: string;
  generatedAt: string;
  preimage: PlanetStatePreimage;
  signature: string;
};

export type PublicPlanetAnchor = {
  owner: Address;
  galaxy: number;
  system: number;
  position: number;
  planetStateRoot: string;
  epoch: number;
};

export class PrivateStateStore {
  private readonly planets = new Map<string, PlanetStatePreimage>();

  constructor(private readonly signingSecret = "veydrift-local-private-state") {}

  initializePlanet(preimage: PlanetStatePreimage): PublicPlanetAnchor {
    this.assertPlanetPreimage(preimage);
    this.planets.set(this.key(preimage.owner, preimage.planetId), structuredClone(preimage));
    return this.publicAnchor(preimage, {
      galaxy: 0,
      system: 0,
      position: 0
    });
  }

  updatePlanet(previousRoot: string, nextPreimage: PlanetStatePreimage): PublicPlanetAnchor {
    this.assertPlanetPreimage(nextPreimage);
    const key = this.key(nextPreimage.owner, nextPreimage.planetId);
    const current = this.planets.get(key);
    if (!current) throw new Error("private planet state not found");
    if (planetStateRoot(current) !== previousRoot) throw new Error("previous root mismatch");
    if (nextPreimage.epoch <= current.epoch) throw new Error("epoch must increase");
    this.planets.set(key, structuredClone(nextPreimage));
    return this.publicAnchor(nextPreimage, {
      galaxy: 0,
      system: 0,
      position: 0
    });
  }

  authorizedPlanetState(owner: Address, planetId: string): PlanetStatePreimage {
    const planet = this.planets.get(this.key(owner, planetId));
    if (!planet) throw new Error("private planet state not found");
    return structuredClone(planet);
  }

  exportSnapshot(owner: Address, planetId: string, now = new Date()): PrivateStateSnapshot {
    const preimage = this.authorizedPlanetState(owner, planetId);
    const root = planetStateRoot(preimage);
    const generatedAt = now.toISOString();
    const payload = JSON.stringify({ owner, planetId, epoch: preimage.epoch, root, generatedAt });
    return {
      owner,
      planetId,
      epoch: preimage.epoch,
      root,
      generatedAt,
      preimage,
      signature: createHmac("sha256", this.signingSecret).update(payload).digest("hex")
    };
  }

  private publicAnchor(
    preimage: PlanetStatePreimage,
    coordinates: Pick<PublicPlanetAnchor, "galaxy" | "system" | "position">
  ): PublicPlanetAnchor {
    return {
      owner: preimage.owner,
      ...coordinates,
      planetStateRoot: planetStateRoot(preimage),
      epoch: preimage.epoch
    };
  }

  private key(owner: Address, planetId: string): string {
    return owner.toLowerCase() + ":" + planetId;
  }

  private assertPlanetPreimage(preimage: PlanetStatePreimage): void {
    if (preimage.schema !== "veydrift.planet-state.v1") throw new Error("invalid planet schema");
    if (!/^0x[a-fA-F0-9]{40}$/.test(preimage.owner)) throw new Error("invalid owner");
    if (!preimage.salt) throw new Error("salt is required");
  }
}

export function planetStateRoot(preimage: PlanetStatePreimage): string {
  const leaves = [
    committedLeaf("resources", preimage.salt, preimage.resources),
    committedLeaf("buildings", preimage.salt, preimage.buildings),
    committedLeaf("defenses", preimage.salt, preimage.defenses),
    committedLeaf("ships", preimage.salt, preimage.ships),
    committedLeaf("research", preimage.salt, preimage.research),
    committedLeaf("sensitive-missions", preimage.salt, preimage.sensitiveMissions)
  ].sort();
  return hashHex(["veydrift.planet-root.v1", preimage.owner.toLowerCase(), preimage.planetId, String(preimage.epoch), ...leaves]);
}

export function playerStateRoot(preimage: PlayerStatePreimage): string {
  const leaves = [
    committedLeaf("research", preimage.salt, preimage.research),
    committedLeaf("planet-ids", preimage.salt, preimage.planetIds)
  ].sort();
  return hashHex(["veydrift.player-root.v1", preimage.owner.toLowerCase(), String(preimage.epoch), ...leaves]);
}

export function publicPlanetView(preimage: PlanetStatePreimage): Omit<PublicPlanetAnchor, "galaxy" | "system" | "position"> {
  return {
    owner: preimage.owner,
    planetStateRoot: planetStateRoot(preimage),
    epoch: preimage.epoch
  };
}

function committedLeaf(label: string, salt: string, value: unknown): string {
  return hashHex(["veydrift.private-leaf.v1", label, salt, canonicalJson(value)]);
}

function hashHex(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return "0x" + hash.digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => JSON.stringify(key) + ":" + canonicalJson(nested))
      .join(",") + "}";
  }
  return JSON.stringify(value);
}
