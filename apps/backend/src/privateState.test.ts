import { describe, expect, test } from "bun:test";
import { PrivateStateStore, planetStateRoot, publicPlanetView, type PlanetStatePreimage } from "./privateState";
import { createRequestHandler } from "./server";

const owner = "0x2222222222222222222222222222222222222222";

const preimage: PlanetStatePreimage = {
  schema: "veydrift.planet-state.v1",
  planetId: "7",
  owner,
  epoch: 1,
  salt: "planet-7-secret-salt",
  resources: {
    metal: "5000",
    crystal: "4000",
    deuterium: "3000"
  },
  buildings: {
    metalMine: 3
  },
  defenses: {
    rocketLauncher: 10
  },
  ships: {
    smallCargo: 2
  },
  research: {
    espionage: 1
  },
  sensitiveMissions: {
    outbound: [{ target: "hidden" }]
  }
};

describe("private committed game state", () => {
  test("builds stable roots while public view hides private fields", () => {
    const root = planetStateRoot(preimage);
    expect(root).toMatch(/^0x[a-f0-9]{64}$/);
    expect(planetStateRoot({ ...preimage, resources: { ...preimage.resources } })).toBe(root);

    const publicView = publicPlanetView(preimage);
    expect(publicView).toEqual({
      owner,
      planetStateRoot: root,
      epoch: 1
    });
    expect(JSON.stringify(publicView)).not.toContain("smallCargo");
    expect(JSON.stringify(publicView)).not.toContain("5000");
  });

  test("enforces epoch updates and exports signed snapshots", () => {
    const store = new PrivateStateStore("test-secret");
    const anchor = store.initializePlanet(preimage);
    const previousRoot = anchor.planetStateRoot;
    const nextPreimage = {
      ...preimage,
      epoch: 2,
      resources: {
        ...preimage.resources,
        metal: "5100"
      }
    };

    const nextAnchor = store.updatePlanet(previousRoot, nextPreimage);
    expect(nextAnchor.epoch).toBe(2);
    expect(nextAnchor.planetStateRoot).not.toBe(previousRoot);
    expect(() => store.updatePlanet(previousRoot, preimage)).toThrow("previous root mismatch");

    const snapshot = store.exportSnapshot(owner, "7", new Date("2026-05-21T16:00:00.000Z"));
    expect(snapshot.generatedAt).toBe("2026-05-21T16:00:00.000Z");
    expect(snapshot.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.preimage.resources.metal).toBe("5100");
  });

  test("private API requires wallet-scoped authorization", async () => {
    const store = new PrivateStateStore("test-secret");
    store.initializePlanet(preimage);
    const handler = createRequestHandler({
      config: {
        chainId: 84532,
        deploymentMode: "test",
        gameContractAddress: "0x3333333333333333333333333333333333333333",
        indexFromBlock: 0n,
        resourceTokenAddresses: {},
        rpcSource: "custom-url",
        rpcUrl: "https://example.invalid"
      },
      privateStateStore: store
    });

    const unauthenticated = await handler(new Request("http://localhost/private/wallet/" + owner + "/planets/7"));
    expect(unauthenticated.status).toBe(401);

    const authenticated = await handler(
      new Request("http://localhost/private/wallet/" + owner + "/planets/7", {
        headers: {
          authorization: "Bearer " + owner.toLowerCase()
        }
      })
    );
    expect(authenticated.status).toBe(200);
    const body = await authenticated.json();
    expect(body.resources.metal).toBe("5000");

    const snapshot = await handler(
      new Request("http://localhost/private/wallet/" + owner + "/planets/7/snapshot", {
        headers: {
          authorization: "Bearer " + owner.toLowerCase()
        }
      })
    );
    expect(snapshot.status).toBe(200);
    expect((await snapshot.json()).signature).toMatch(/^[a-f0-9]{64}$/);
  });
});
