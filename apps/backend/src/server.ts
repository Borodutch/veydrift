import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import { assertAddress, type ChainReader, VeydriftGameReader } from "./evm";
import { SettlementIndexer } from "./indexer";
import { systemSnapshot } from "./universe";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

type GraphQLPayload = {
  query?: string;
};

type HealthPayload = {
  ok: true;
  service: "veydrift-backend";
  configured: boolean;
};

export type ServerDependencies = {
  config?: BackendConfig;
  configProblems?: ConfigProblem[];
  chainReader?: ChainReader;
  indexer?: SettlementIndexer;
};

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
          headers: jsonHeaders
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/debug/config") {
      return Response.json(
        {
          configured: loaded.problems.length === 0,
          chain: safeConfigSummary(loaded.config),
          problems: loaded.problems
        },
        {
          headers: jsonHeaders
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
          headers: jsonHeaders
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
          headers: jsonHeaders
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
        headers: jsonHeaders
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
          planets: baseSnapshot.planets.map((planet) => ({
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
                planets: snapshot.planets.map((planet) => ({
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
              status: loaded.problems.length === 0 ? "ready" : "configuration-required"
            }
          }
        },
        {
          headers: jsonHeaders
        }
      );
    }

    return Response.json(
      {
        error: "not_found"
      },
      {
        headers: jsonHeaders,
        status: 404
      }
    );
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
        headers: jsonHeaders,
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
        headers: jsonHeaders,
        status: 400
      }
    );
  }

  return Response.json(
    {
      data: {
        service: {
          name: "Veydrift",
          status: "coming-soon"
        }
      }
    },
    {
      headers: jsonHeaders
    }
  );
}
