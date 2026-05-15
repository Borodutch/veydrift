import { generateSystem } from "@veydrift/universe";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import { assertAddress, type ChainReader, VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { planetMetadata, systemSnapshot, type PlanetMetadata } from "./universe";

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
  apiUrl: string;
  chainId: number;
  contractAddress: string | null;
  graphqlUrl: string;
  network: string;
  rpcProvider: "alchemy" | "unknown";
};

export type ServerDependencies = {
  config?: BackendConfig;
  configProblems?: ConfigProblem[];
  chainReader?: ChainReader;
  indexer?: SettlementIndexer;
};

const defaultUniverseSeed = "veydrift-mainnet-preview";

export function createRequestHandler(dependencies: ServerDependencies = {}): (request: Request) => Promise<Response> {
  const loaded = dependencies.config ? { config: dependencies.config, problems: dependencies.configProblems ?? [] } : loadBackendConfig();
  const chainReader =
    dependencies.chainReader ??
    (loaded.problems.length === 0 ? new VeydriftGameReader(loaded.config) : undefined);
  const indexer =
    dependencies.indexer ??
    (chainReader ? new SettlementIndexer(chainReader, loaded.config.indexFromBlock) : undefined);

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
          indexer: indexer?.snapshot() ?? null
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
          problems: loaded.problems
        },
        {
          headers: corsHeaders
        }
      );
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
          loaded.config.settlementContractAddress ?? "0x0000000000000000000000000000000000000000",
          galaxy,
          system
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
      const occupied = new Map(
        (indexer?.settledPlanetsInSystem(galaxy, system) ?? []).map((planet) => [
          planet.position,
          {
            planetId: planet.planetId,
            owner: planet.owner
          }
        ])
      );

      return Response.json(
        {
          ...baseSnapshot,
          planets: includeOccupiedPlanets(
            baseSnapshot.planets,
            occupied,
            loaded.config.chainId,
            loaded.config.settlementContractAddress ?? "0x0000000000000000000000000000000000000000",
            galaxy,
            system
          ).map((planet) => ({
            ...planet,
            occupiedBy: occupied.get(planet.position) ?? null
          }))
        },
        {
          headers: jsonHeaders
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
                  {
                    planetId: planet.planetId,
                    owner: planet.owner
                  }
                ])
              );
              const snapshot = systemSnapshot(
                loaded.config.chainId,
                loaded.config.settlementContractAddress ?? "0x0000000000000000000000000000000000000000",
                galaxy,
                system
              );

              return {
                ...snapshot,
                planets: includeOccupiedPlanets(
                  snapshot.planets,
                  occupied,
                  loaded.config.chainId,
                  loaded.config.settlementContractAddress ?? "0x0000000000000000000000000000000000000000",
                  galaxy,
                  system
                ).map((planet) => ({
                  ...planet,
                  occupiedBy: occupied.get(planet.position) ?? null
                }))
              };
            })
          },
          {
            headers: jsonHeaders
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
  occupied: ReadonlyMap<number, { planetId: string; owner: string }>,
  chainId: number,
  settlementContractAddress: string,
  galaxy: number,
  system: number
): PlanetMetadata[] {
  const byPosition = new Map(planets.map((planet) => [planet.position, planet]));

  for (const position of occupied.keys()) {
    if (!byPosition.has(position)) {
      byPosition.set(
        position,
        planetMetadata(chainId, settlementContractAddress, {
          galaxy,
          system,
          position
        })
      );
    }
  }

  return Array.from(byPosition.values()).sort((left, right) => left.position - right.position);
}

function getRuntimeConfig(): RuntimeConfig {
  const apiUrl = process.env.VEYDRIFT_PUBLIC_API_URL ?? "https://api-test.veydrift.com";
  const graphqlUrl = process.env.VEYDRIFT_PUBLIC_GRAPHQL_URL ?? `${apiUrl}/graphql`;
  const rpcUrl = process.env.VEYDRIFT_RPC_URL ?? "";
  const contractAddress =
    process.env.VEYDRIFT_CONTRACT_ADDRESS ??
    process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS ??
    null;

  return {
    apiUrl,
    chainId: Number.parseInt(process.env.VEYDRIFT_CHAIN_ID ?? "84532", 10),
    contractAddress,
    graphqlUrl,
    network: process.env.VEYDRIFT_NETWORK_NAME ?? "Base Sepolia",
    rpcProvider: rpcUrl.includes("alchemy") ? "alchemy" : "unknown"
  };
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
      headers: jsonHeaders
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
      headers: jsonHeaders,
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
