import { describe, expect, test } from "bun:test";
import { infrastructureActionNoticeFor, loadWalletPlanetSyncSnapshot, topBarEnergyFor } from "../src/PlayableMvpApp";
import { createInitialPlayableState } from "../src/playableMvp";
import type { ChainInfrastructureState } from "../src/walletFlow";

describe("Playable MVP app display helpers", () => {
  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("keeps loaded top bar energy available during infrastructure refresh", () => {
    const settledState = createInitialPlayableState();
    const infrastructureChainState = infrastructureState({
      energyBalance: {
        produced: "100",
        required: "40",
        scaleBps: "10000",
      },
    });

    expect(topBarEnergyFor({
      infrastructureChainState,
      isWalletConnected: true,
      settledState,
    })).toEqual({
      deuteriumConsumed: 0,
      produced: 100,
      required: 40,
      scaleBps: 10000,
    });
  });

  test("does not invent top bar energy when chain state is missing or errored", () => {
    const settledState = createInitialPlayableState();

    expect(topBarEnergyFor({
      infrastructureChainState: null,
      isWalletConnected: true,
      settledState,
    })).toBeUndefined();

    expect(topBarEnergyFor({
      infrastructureChainState: infrastructureState({ energyBalance: null }),
      infrastructureError: "Infrastructure state could not be loaded.",
      isWalletConnected: true,
      settledState,
    })).toBeUndefined();
  });

  test("hydrates indexed planet state before requesting live settlement state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/settlement")) {
        throw new Error("indexed state should hydrate before live settlement reads");
      }

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          planets: [indexedPlanet(wallet)],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement).toMatchObject({
        wallet,
        hasFirstPlanet: true,
        homePlanetId: "7",
        planet: {
          planetId: "7",
          resources: {
            metal: "5000",
            crystal: "4900",
            deuterium: "4800",
          },
        },
      });
      expect(snapshot.planetsResponse.planets).toHaveLength(1);
      expect(requestedPaths).toContain(`/wallet/${wallet}/planets`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/queues`);
      expect(requestedPaths).not.toContain(`/wallet/${wallet}/fleet-visibility`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not start a pending settlement read before showing indexed planet state", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/settlement")) {
        return new Promise<Response>(() => undefined);
      }

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          planets: [indexedPlanet(wallet)],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement.homePlanetId).toBe("7");
      expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
      expect(snapshot.planetsResponse.planets).toHaveLength(1);
      expect(requestedPaths).toEqual([`/wallet/${wallet}/planets`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to live settlement state when indexed planets are empty", async () => {
    const originalFetch = globalThis.fetch;
    const wallet = "0x2222222222222222222222222222222222222222";
    const requestedPaths: string[] = [];

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);

      if (url.pathname.endsWith("/planets")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: null,
          planets: [],
        }));
      }

      if (url.pathname.endsWith("/settlement")) {
        return Promise.resolve(Response.json({
          wallet,
          hasFirstPlanet: true,
          homePlanetId: "7",
          planet: indexedPlanet(wallet),
        }));
      }

      if (url.pathname.endsWith("/queues")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          building: null,
          defense: null,
          ship: null,
          research: null,
        }));
      }

      if (url.pathname.endsWith("/fleet-visibility")) {
        return Promise.resolve(Response.json({
          wallet,
          homePlanetId: "7",
          incoming: [],
          outgoing: [],
          returning: [],
          joinableAttacks: [],
        }));
      }

      return Promise.resolve(Response.json({ error: "unexpected endpoint" }, { status: 404 }));
    }) as typeof fetch;

    try {
      const snapshot = await loadWalletPlanetSyncSnapshot("https://api.test", wallet, undefined);

      expect(snapshot.settlement.homePlanetId).toBe("7");
      expect(snapshot.settlement.planet?.resources.metal).toBe("5000");
      expect(requestedPaths[0]).toBe(`/wallet/${wallet}/planets`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/settlement`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/queues`);
      expect(requestedPaths).toContain(`/wallet/${wallet}/fleet-visibility`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function infrastructureState({
  energyBalance,
}: Pick<ChainInfrastructureState, "energyBalance">): ChainInfrastructureState {
  return {
    wallet: "0x2222222222222222222222222222222222222222",
    homePlanetId: "7",
    infrastructureAvailable: true,
    resources: { metal: "500", crystal: "500", deuterium: "0" },
    productionPerHour: { metal: "60", crystal: "30", deuterium: "0" },
    energyBalance,
    storageCaps: { metal: "10000", crystal: "10000", deuterium: "10000" },
    buildings: [],
    queue: null,
  };
}

function indexedPlanet(wallet: string) {
  return {
    planetId: "7",
    owner: wallet,
    name: null,
    galaxy: 2,
    system: 44,
    position: 9,
    fields: 211,
    temperature: -8,
    metalMultiplierBps: 10_000,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    lastSettledAt: "1770000000",
    resources: {
      metal: "5000",
      crystal: "4900",
      deuterium: "4800",
    },
    coordinates: "2:44:9",
    fieldsUsed: 3,
    fieldsCapacity: 211,
    isHomePlanet: true,
    keyLevels: {
      metalMine: 1,
      crystalMine: 1,
      deuteriumSynthesizer: 0,
      solarPlant: 1,
      roboticsFactory: 0,
      shipyard: 0,
      researchLab: 0,
      terraformer: 0,
    },
    moon: null,
    queues: {
      building: null,
      defense: null,
      ship: null,
    },
  };
}
