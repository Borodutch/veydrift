import { generateSystem } from "@veydrift/universe";
import { CachedChainReader } from "./cachedReader";
import { ChainSyncService } from "./chainSync";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import { assertAddress, type ChainReader, type SettledPlanetEvent, VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { planetArchetypeForTemperature, planetMetadata, systemSnapshot, type PlanetMetadata } from "./universe";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": process.env.VEYDRIFT_ALLOWED_ORIGIN ?? "https://test.veydrift.com",
  ...jsonHeaders
} as const;

type GraphQLPayload = {
  query?: string;
};

type HealthPayload = {
  ok: true;
  service: "veydrift-backend";
  configured: boolean;
};

type RuntimeConfig = {
  allianceContractAddress: string | null;
  apiUrl: string;
  chainId: number;
  contractAddress: string | null;
  gameContractAddress: string | null;
  graphqlUrl: string;
  moonContractAddress: string | null;
  network: string;
  resourceTokenAddresses: {
    crystal: string | null;
    deuterium: string | null;
    metal: string | null;
  };
  rpcProvider: "alchemy" | "unknown";
};

export type ServerDependencies = {
  chainSync?: ChainSyncService;
  config?: BackendConfig;
  configProblems?: ConfigProblem[];
  chainReader?: ChainReader;
  indexer?: SettlementIndexer;
};

const defaultUniverseSeed = "veydrift-mainnet-preview";

export function createRequestHandler(dependencies: ServerDependencies = {}): (request: Request) => Promise<Response> {
  const loaded = dependencies.config ? { config: dependencies.config, problems: dependencies.configProblems ?? [] } : loadBackendConfig();
  const rawChainReader =
    dependencies.chainReader ??
    (loaded.problems.length === 0 ? new VeydriftGameReader(loaded.config) : undefined);
  const cacheReader = rawChainReader && !dependencies.chainReader ? new CachedChainReader(rawChainReader) : undefined;
  const chainReader = cacheReader ?? rawChainReader;
  const indexer =
    dependencies.indexer ??
    (chainReader ? new SettlementIndexer(chainReader, loaded.config.indexFromBlock) : undefined);
  const chainSync =
    dependencies.chainSync ??
    (loaded.problems.length === 0 ? new ChainSyncService(loaded.config, indexer) : undefined);

  chainSync?.start();
  if (cacheReader) {
    chainSync?.addListener((event) => {
      if (event.kind === "chain-event") {
        cacheReader.clear();
      }
    });
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "veydrift-backend",
          configured: loaded.problems.length === 0,
          chain: safeConfigSummary(loaded.config),
          chainSync: chainSync?.snapshot() ?? null,
          indexer: indexer?.snapshot() ?? null,
          rpc: chainReader?.rpcMetrics?.() ?? null
        } satisfies HealthPayload & Record<string, unknown>,
        {
          headers: corsHeaders
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/runtime-config") {
      return Response.json(getRuntimeConfig(), {
        headers: corsHeaders
      });
    }

    if (request.method === "GET" && url.pathname === "/debug/config") {
      return Response.json(
        {
          configured: loaded.problems.length === 0,
          chain: safeConfigSummary(loaded.config),
          chainSync: chainSync?.snapshot() ?? null,
          problems: loaded.problems
        },
        {
          headers: corsHeaders
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/chain/events") {
      if (!chainSync) {
        return unavailableResponse(loaded.problems);
      }

      return new Response(chainSync.eventStream(), {
        headers: {
          ...corsHeaders,
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getWalletSettlement(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/queues$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getPlayerQueues(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getFleetMissionVisibility(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/infrastructure$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getInfrastructureState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/moon$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getMoonState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/shipyard$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getShipyardState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/defenses$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getDefenseState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/research$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getResearchState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/alliance$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getAllianceState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/rift$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await ready.getRiftState(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/planets\/[0-9]+$/)) {
      const ready = requireChainReader(chainReader, loaded.problems);
      if (ready instanceof Response) return ready;

      const planetId = BigInt(url.pathname.split("/")[2] ?? "0");
      return Response.json(await ready.getPlanet(planetId), {
        headers: corsHeaders
      });
    }

    if (request.method === "GET" && url.pathname.match(/^\/universe\/galaxies\/[0-9]+\/systems\/[0-9]+$/)) {
      const parts = url.pathname.split("/");
      const galaxy = Number.parseInt(parts[3] ?? "", 10);
      const system = Number.parseInt(parts[5] ?? "", 10);
      let baseSnapshot;
      try {
        baseSnapshot = systemSnapshot(
          loaded.config.chainId,
          universeContractAddress(loaded.config),
          galaxy,
          system
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
      const occupied = new Map(
        (indexer?.settledPlanetsInSystem(galaxy, system) ?? []).map((planet) => [
          planet.position,
          planet
        ])
      );

      return Response.json(
        {
          ...baseSnapshot,
          planets: includeOccupiedPlanets(
            baseSnapshot.planets,
            occupied,
            loaded.config.chainId,
            universeContractAddress(loaded.config),
            galaxy,
            system
          ).map((planet) => ({
            ...planet,
            occupiedBy: occupiedPlanetRef(occupied.get(planet.position))
          }))
        },
        {
          headers: corsHeaders
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/universe/systems") {
      const galaxy = Number.parseInt(url.searchParams.get("galaxy") ?? "1", 10);
      const center = Number.parseInt(url.searchParams.get("center") ?? "1", 10);
      const radius = Math.min(Number.parseInt(url.searchParams.get("radius") ?? "1", 10), 10);
      const from = Math.max(center - radius, 1);
      const to = Math.min(center + radius, 499);

      try {
        return Response.json(
          {
            galaxy,
            center,
            radius,
            systems: Array.from({ length: to - from + 1 }, (_, index) => {
              const system = from + index;
              const occupied = new Map(
                (indexer?.settledPlanetsInSystem(galaxy, system) ?? []).map((planet) => [
                  planet.position,
                  planet
                ])
              );
              const snapshot = systemSnapshot(
                loaded.config.chainId,
                universeContractAddress(loaded.config),
                galaxy,
                system
              );

              return {
                ...snapshot,
                planets: includeOccupiedPlanets(
                  snapshot.planets,
                  occupied,
                  loaded.config.chainId,
                  universeContractAddress(loaded.config),
                  galaxy,
                  system
                ).map((planet) => ({
                  ...planet,
                  occupiedBy: occupiedPlanetRef(occupied.get(planet.position))
                }))
              };
            })
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/universe/system") {
      return handleUniverseSystemRequest(url);
    }

    if (request.method === "POST" && url.pathname === "/index/rebuild") {
      if (!indexer) {
        return unavailableResponse(loaded.problems);
      }

      try {
        return Response.json(await indexer.rebuild(), {
          headers: jsonHeaders
        });
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/graphql") {
      return handleGraphQLRequest(request);
    }

    if (request.method === "GET" && url.pathname === "/graphql") {
      return Response.json(
        {
          data: {
            service: {
              name: "Veydrift",
              status: loaded.problems.length === 0 ? "ready" : "configuration-required",
              runtime: getRuntimeConfig()
            }
          }
        },
        {
          headers: corsHeaders
        }
      );
    }

    return Response.json(
      {
        error: "not_found"
      },
      {
        headers: corsHeaders,
        status: 404
      }
    );
  };
}

function includeOccupiedPlanets(
  planets: readonly PlanetMetadata[],
  occupied: ReadonlyMap<number, SettledPlanetEvent>,
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): PlanetMetadata[] {
  const byPosition = new Map(planets.map((planet) => [planet.position, planet]));

  for (const planet of occupied.values()) {
    byPosition.set(planet.position, {
      ...planetMetadata(chainId, settlementContractAddress, {
        galaxy,
        system,
        position: planet.position
      }),
      fields: planet.fields,
      temperature: planet.temperature,
      metalMultiplierBps: planet.metalMultiplierBps,
      crystalMultiplierBps: planet.crystalMultiplierBps,
      deuteriumMultiplierBps: planet.deuteriumMultiplierBps,
      archetype: planetArchetypeForTemperature(planet.temperature)
    });
  }

  return Array.from(byPosition.values()).sort((left, right) => left.position - right.position);
}

function occupiedPlanetRef(planet: SettledPlanetEvent | undefined): { planetId: string; owner: string } | null {
  return planet ? { planetId: planet.planetId, owner: planet.owner } : null;
}

function getRuntimeConfig(): RuntimeConfig {
  const apiUrl = process.env.VEYDRIFT_PUBLIC_API_URL ?? "https://api-test.veydrift.com";
  const graphqlUrl = process.env.VEYDRIFT_PUBLIC_GRAPHQL_URL ?? `${apiUrl}/graphql`;
  const rpcUrl = process.env.VEYDRIFT_RPC_URL ?? "";
  const contractAddress =
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS ??
    process.env.VEYDRIFT_CONTRACT_ADDRESS ??
    null;
  const gameContractAddress =
    process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS ??
    process.env.VEYDRIFT_CONTRACT_ADDRESS ??
    null;
  const moonContractAddress = process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS ?? null;
  const allianceContractAddress = process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS ?? null;
  const resourceTokenAddresses = {
    crystal: process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS ?? null,
    deuterium: process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS ?? null,
    metal: process.env.VEYDRIFT_METAL_TOKEN_ADDRESS ?? null
  };

  return {
    allianceContractAddress,
    apiUrl,
    chainId: Number.parseInt(process.env.VEYDRIFT_CHAIN_ID ?? "84532", 10),
    contractAddress,
    gameContractAddress,
    graphqlUrl,
    moonContractAddress,
    network: process.env.VEYDRIFT_NETWORK_NAME ?? "Base Sepolia",
    resourceTokenAddresses,
    rpcProvider: rpcUrl.includes("alchemy") ? "alchemy" : "unknown"
  };
}

function universeContractAddress(config: BackendConfig): `0x${string}` {
  return (
    config.settlementContractAddress ?? config.gameContractAddress ?? "0x0000000000000000000000000000000000000000"
  );
}

function requireChainReader(chainReader: ChainReader | undefined, problems: ConfigProblem[]): ChainReader | Response {
  if (!chainReader) {
    return unavailableResponse(problems);
  }

  return chainReader;
}

function unavailableResponse(problems: ConfigProblem[]): Response {
  return Response.json(
    {
      error: "backend_not_configured",
      problems
    },
    {
      headers: jsonHeaders,
      status: 503
    }
  );
}

function errorResponse(error: unknown, status: number): Response {
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Request failed."
    },
    {
      headers: jsonHeaders,
      status
    }
  );
}

function handleUniverseSystemRequest(url: URL): Response {
  const galaxyId = parseIntegerQuery(url, "galaxyId", 0);
  const systemId = parseIntegerQuery(url, "systemId", 1);
  const seed = url.searchParams.get("seed") ?? defaultUniverseSeed;

  if (galaxyId === null || galaxyId < 0) {
    return badRequest("galaxyId must be a non-negative integer.");
  }

  if (systemId === null || systemId < 1) {
    return badRequest("systemId must be a positive integer.");
  }

  return Response.json(
    {
      data: {
        system: generateSystem({
          seed,
          galaxyId,
          systemId
        })
      }
    },
    {
      headers: corsHeaders
    }
  );
}

function parseIntegerQuery(
  url: URL,
  name: string,
  fallback: number
): number | null {
  const value = url.searchParams.get(name);

  if (value === null) {
    return fallback;
  }

  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
}

function badRequest(message: string): Response {
  return Response.json(
    {
      errors: [
        {
          message
        }
      ]
    },
    {
      headers: corsHeaders,
      status: 400
    }
  );
}

async function handleGraphQLRequest(request: Request): Promise<Response> {
  let payload: GraphQLPayload;

  try {
    payload = (await request.json()) as GraphQLPayload;
  } catch {
    return Response.json(
      {
        errors: [
          {
            message: "Request body must be valid JSON."
          }
        ]
      },
      {
        headers: corsHeaders,
        status: 400
      }
    );
  }

  if (!payload.query || !payload.query.trim()) {
    return Response.json(
      {
        errors: [
          {
            message: "GraphQL query is required."
          }
        ]
      },
      {
        headers: corsHeaders,
        status: 400
      }
    );
  }

  return Response.json(
    {
      data: {
        service: {
          name: "Veydrift",
          status: "playable-test",
          runtime: getRuntimeConfig()
        }
      }
    },
    {
      headers: corsHeaders
    }
  );
}
