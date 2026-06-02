import { createHmac, timingSafeEqual } from "node:crypto";
import { generateSystem } from "@veydrift/universe";
import { CachedChainReader } from "./cachedReader";
import { ChainSyncService } from "./chainSync";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import {
  assertAddress,
  type ChainReader,
  type DefenseState,
  type FleetMissionVisibility,
  type InfrastructureState,
  type MoonChanceReportEvent,
  type MoonState,
  type PlayerQueues,
  type ResearchState,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  VeydriftGameReader
} from "./evm";
import { highscoreCategories, highscoreFormula, type HighscoreEntry, type ScoreBreakdown } from "./highscores";
import { SettlementIndexer, type IndexedDebrisFieldEvent, type IndexedMoonChanceReportEvent, type IndexedRpcLog } from "./indexer";
import { MissionResolutionService } from "./missionResolution";
import { deriveInfrastructureFields } from "./readModels";
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

const LIVE_WALLET_READ_TIMEOUT_MS = 6_000;

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
  featureSupport: {
    allianceConfigured: boolean;
    gameConfigured: boolean;
    highscoresEndpoint: boolean;
    moonConfigured: boolean;
    randomnessConfigured: boolean;
    researchEndpoint: boolean;
    resourceTokensConfigured: boolean;
    settlementConfigured: boolean;
  };
  gameContractAddress: string | null;
  graphqlUrl: string;
  moonContractAddress: string | null;
  network: string;
  randomnessEngineAddress: string | null;
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
  missionResolver?: MissionResolutionService;
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
  const indexerChainReader =
    dependencies.chainReader
      ? chainReader
      : loaded.problems.length === 0
        ? new VeydriftGameReader(loaded.config)
        : undefined;
  const createLiveChainReader = (): ChainReader | undefined =>
    dependencies.chainReader
      ? chainReader
      : loaded.problems.length === 0
        ? new VeydriftGameReader(loaded.config)
        : undefined;
  const indexer =
    dependencies.indexer ??
    (isIndexableChainReader(indexerChainReader) ? new SettlementIndexer(indexerChainReader, loaded.config.indexFromBlock, {
      databasePath: loaded.config.indexDbPath
    }) : undefined);
  const chainSync =
    dependencies.chainSync ??
    (loaded.problems.length === 0 ? new ChainSyncService(loaded.config, indexer) : undefined);
  const resolutionReader = rawChainReader?.listResolvableFleetMissions
    ? { listResolvableFleetMissions: rawChainReader.listResolvableFleetMissions.bind(rawChainReader) }
    : undefined;
  const missionResolver =
    dependencies.missionResolver ??
    (loaded.problems.length === 0 && resolutionReader
      ? new MissionResolutionService(loaded.config, resolutionReader)
      : undefined);

  chainSync?.start();
  missionResolver?.start();
  if (!dependencies.indexer && indexer && loaded.problems.length === 0) {
    void indexer.rebuild().catch((error) => {
      console.error("Veydrift index reconciliation failed", error);
    });
  }
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
          missionResolution: missionResolver?.snapshot() ?? null,
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
          indexer: indexer?.snapshot() ?? null,
          problems: loaded.problems
        },
        {
          headers: corsHeaders
        }
      );
    }

    if (request.method === "GET" && url.pathname === "/debug/indexer") {
      return Response.json(
        {
          indexer: indexer?.snapshot() ?? null,
          chainSync: chainSync?.snapshot() ?? null,
          rpc: chainReader?.rpcMetrics?.() ?? null
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
      try {
        assertAddress(wallet);
        if (hasWarmPlanetIndex(indexer)) {
          return Response.json(indexer.walletSettlement(wallet), {
            headers: corsHeaders
          });
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(await liveWalletRead(ready.getWalletSettlement(wallet), "wallet settlement"), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/planets$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (hasWarmPlanetIndex(indexer)) {
          return Response.json(indexer.walletPlanets(wallet), {
            headers: corsHeaders
          });
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(await liveWalletRead(ready.getWalletPlanets(wallet), "wallet planets"), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/queues$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "player queues", indexedPlayerQueues);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "player queues", new Error("backend_not_configured"), indexedPlayerQueues)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getPlayerQueues(wallet, planetId), "player queues"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "player queues", error, indexedPlayerQueues);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, undefined, "fleet visibility", indexedFleetVisibility);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, undefined, "fleet visibility", new Error("backend_not_configured"), indexedFleetVisibility)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getFleetMissionVisibility(wallet), "fleet visibility"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, undefined, "fleet visibility", error, indexedFleetVisibility);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/infrastructure$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "infrastructure", indexedInfrastructureState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "infrastructure", new Error("backend_not_configured"), indexedInfrastructureState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getInfrastructureState(wallet, planetId), "infrastructure"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "infrastructure", error, indexedInfrastructureState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/moon$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "moon", indexedMoonState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "moon", new Error("backend_not_configured"), indexedMoonState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getMoonState(wallet, planetId), "moon"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "moon", error, indexedMoonState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/shipyard$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "shipyard", indexedShipyardState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "shipyard", new Error("backend_not_configured"), indexedShipyardState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getShipyardState(wallet, planetId), "shipyard"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "shipyard", error, indexedShipyardState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/defenses$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "defenses", indexedDefenseState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "defenses", new Error("backend_not_configured"), indexedDefenseState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getDefenseState(wallet, planetId), "defenses"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "defenses", error, indexedDefenseState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/research$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "research", indexedResearchState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "research", new Error("backend_not_configured"), indexedResearchState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getResearchState(wallet, planetId), "research"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "research", error, indexedResearchState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/alliance$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(createLiveChainReader(), loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        return Response.json(await liveWalletRead(ready.getAllianceState(wallet), "alliance"), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/rift$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        if (!requestsLiveState(url)) {
          const indexed = await indexedWarmResponse(indexer, wallet, planetId, "rift", indexedRiftState);
          if (indexed) return indexed;
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) {
          return await indexedDegradedResponse(indexer, wallet, planetId, "rift", new Error("backend_not_configured"), indexedRiftState)
            ?? ready;
        }
        return Response.json(await liveWalletRead(ready.getRiftState(wallet, planetId), "rift"), {
          headers: corsHeaders
        });
      } catch (error) {
        const fallback = await indexedDegradedResponse(indexer, wallet as `0x${string}`, selectedPlanetIdOrUndefined(url), "rift", error, indexedRiftState);
        if (fallback) return fallback;
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/attack-protection$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const ready = requireChainReader(createLiveChainReader(), loaded.problems);
      if (ready instanceof Response) return ready;

      try {
        assertAddress(wallet);
        const targetPlanetId = positiveBigIntQuery(url, "targetPlanetId");
        return Response.json(await liveWalletRead(ready.getAttackProtectionStatus(wallet, targetPlanetId), "attack protection"), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/highscore$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");

      try {
        assertAddress(wallet);
        if (indexer) {
          await ensurePlanetIndex(indexer);
          const indexedPlanets = indexer.settledPlanetsByOwner().get(wallet.toLowerCase()) ?? [];
          return Response.json(
            {
              formula: highscoreFormula,
              entry: indexer.highscoreForWallet(wallet, indexedPlanets.map((planet) => planet.planetId)),
              source: "contract-state-indexer"
            },
            {
              headers: corsHeaders
            }
          );
        }

        const ready = requireHighscoreReader(chainReader, loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(
          {
            formula: highscoreFormula,
            entry: await ready.getHighscoreForWallet(wallet)
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return highscoreFailureResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/highscores") {
      const startedAt = Date.now();
      try {
        const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1), 250);
        let planetsByOwner: Map<string, SettledPlanetEvent[]>;
        let entries: HighscoreEntry[];
        let source: "contract-state-indexer" | "live-chain-reader";

        if (indexer) {
          const indexNotReady = highscoreIndexNotReadyResponse(indexer, startedAt);
          if (indexNotReady) return indexNotReady;
          planetsByOwner = indexer.settledPlanetsByOwner();
          entries = indexer.highscoreEntriesForOwners(planetsByOwner);
          source = "contract-state-indexer";
        } else {
          const ready = requireHighscoreReader(chainReader, loaded.problems);
          if (ready instanceof Response) return ready;
          planetsByOwner = new Map();
          entries = ready.getHighscoresForWallets
            ? await ready.getHighscoresForWallets(planetsByOwner)
            : await highscoreEntriesForOwners(ready, planetsByOwner);
          source = "live-chain-reader";
        }

        const rankings = highscoreRankings(entries, limit, planetsByOwner);

        return Response.json(
          {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            formula: highscoreFormula,
            rankings,
            source
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return highscoreFailureResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/planets\/[0-9]+$/)) {
      const planetId = BigInt(url.pathname.split("/")[2] ?? "0");
      if (indexer) {
        await ensurePlanetIndex(indexer);
        return Response.json(indexer.planet(planetId.toString()), {
          headers: corsHeaders
        });
      }
      const ready = requireChainReader(createLiveChainReader(), loaded.problems);
      if (ready instanceof Response) return ready;
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
      const debris = new Map(
        (indexer?.debrisFieldsInSystem(galaxy, system) ?? []).map((field) => [
          field.position,
          field
        ])
      );
      const moonChance = new Map(
        (indexer?.moonChanceReportsInSystem(galaxy, system) ?? []).map((report) => [
          report.position,
          report
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
            occupiedBy: occupiedPlanetRef(occupied.get(planet.position)),
            debrisField: debrisFieldRef(debris.get(planet.position)),
            moonChance: moonChanceReportRef(moonChance.get(planet.position))
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
              const debris = new Map(
                (indexer?.debrisFieldsInSystem(galaxy, system) ?? []).map((field) => [
                  field.position,
                  field
                ])
              );
              const moonChance = new Map(
                (indexer?.moonChanceReportsInSystem(galaxy, system) ?? []).map((report) => [
                  report.position,
                  report
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
                  occupiedBy: occupiedPlanetRef(occupied.get(planet.position)),
                  debrisField: debrisFieldRef(debris.get(planet.position)),
                  moonChance: moonChanceReportRef(moonChance.get(planet.position))
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

    if (request.method === "POST" && url.pathname === "/webhooks/alchemy") {
      if (!indexer) {
        return unavailableResponse(loaded.problems);
      }

      const rawBody = await request.text();
      const signatureFailure = verifyAlchemyWebhookSignature(rawBody, request.headers, loaded.config.alchemyWebhookSigningKey);
      if (signatureFailure) return signatureFailure;

      try {
        const payload = JSON.parse(rawBody) as unknown;
        const logs = alchemyWebhookLogs(payload);
        let applied = 0;
        let duplicates = 0;
        let ignored = 0;
        let removed = 0;
        for (const log of logs) {
          const result = indexer.applyLog(log);
          if (result.applied) applied += 1;
          if (result.duplicate) duplicates += 1;
          if (result.ignored) ignored += 1;
          if (result.removed) removed += 1;
        }

        return Response.json(
          {
            receivedLogs: logs.length,
            applied,
            duplicates,
            ignored,
            removed,
            indexer: indexer.snapshot()
          },
          {
            headers: corsHeaders
          }
        );
      } catch (error) {
        return errorResponse(error, 400);
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

function isIndexableChainReader(
  chainReader: ChainReader | undefined
): chainReader is ChainReader {
  return Boolean(
    chainReader
      && typeof chainReader.listDebrisFieldEvents === "function"
      && typeof chainReader.listMoonChanceReportEvents === "function"
      && typeof chainReader.listSettledPlanetEvents === "function"
  );
}

async function highscoreEntriesForOwners(
  reader: HighscoreReader,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>
): Promise<HighscoreEntry[]> {
  const entries = [];
  for (const [owner, planets] of planetsByOwner.entries()) {
    entries.push(await reader.getHighscoreForWallet(
      owner as `0x${string}`,
      planets.map((planet) => planet.planetId)
    ));
  }
  return entries;
}

async function ensurePlanetIndex(indexer: SettlementIndexer): Promise<void> {
  if (indexer.snapshot().indexedPlanets === 0) {
    await indexer.rebuildPlanets();
  }
}

function hasWarmPlanetIndex(indexer: SettlementIndexer | undefined): indexer is SettlementIndexer {
  if (!indexer) return false;
  return indexer.snapshot().indexedPlanets > 0;
}

type IndexedDegradedBody<T extends object> = T & {
  degraded: true;
  detail: string;
  indexer: ReturnType<SettlementIndexer["snapshot"]>;
  liveReadFailedAt: string;
  source: "contract-state-indexer";
  stale: true;
};

type IndexedWarmBody<T extends object> = T & {
  detail: string;
  indexer: ReturnType<SettlementIndexer["snapshot"]>;
  liveReadSkippedAt: string;
  source: "contract-state-indexer";
  stale: boolean;
};

async function indexedWarmResponse<T extends object>(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined,
  surface: string,
  build: (
    wallet: `0x${string}`,
    settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
    planet: SettledPlanetEvent | null,
    detail: string,
    indexer: SettlementIndexer
  ) => T
): Promise<Response | null> {
  if (!indexer) return null;

  if (!hasWarmPlanetIndex(indexer)) return null;
  const settlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
  if (!settlement?.planet) return null;

  const detail = `${surface} loaded from DB-indexed contract state before live RPC.`;
  const snapshot = indexer.snapshot();
  const body: IndexedWarmBody<T> = {
    ...build(wallet, settlement.settlement, settlement.planet, detail, indexer),
    detail,
    indexer: snapshot,
    liveReadSkippedAt: new Date().toISOString(),
    source: "contract-state-indexer",
    stale: !snapshot.safeToServeIndexedState
  };

  return Response.json(body, {
    headers: {
      ...corsHeaders,
      "x-veydrift-index-state": snapshot.safeToServeIndexedState ? "healthy" : "stale"
    }
  });
}

async function indexedDegradedResponse<T extends object>(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined,
  surface: string,
  error: unknown,
  build: (
    wallet: `0x${string}`,
    settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
    planet: SettledPlanetEvent | null,
    detail: string,
    indexer: SettlementIndexer
  ) => T
): Promise<Response | null> {
  if (!indexer || !isDegradableReadError(error)) return null;

  if (!hasWarmPlanetIndex(indexer)) return null;
  const settlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
  if (!settlement) return null;

  const detail = `${surface} live contract read failed; returning DB-indexed contract state.`;
  const body: IndexedDegradedBody<T> = {
    ...build(wallet, settlement.settlement, settlement.planet, detail, indexer),
    degraded: true,
    detail: error instanceof Error ? error.message : detail,
    indexer: indexer.snapshot(),
    liveReadFailedAt: new Date().toISOString(),
    source: "contract-state-indexer",
    stale: true
  };

  return Response.json(body, {
    headers: {
      ...corsHeaders,
      "x-veydrift-index-state": "stale"
    }
  });
}

function indexedWalletSettlement(
  indexer: SettlementIndexer,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): { settlement: ReturnType<SettlementIndexer["walletSettlement"]>; planet: SettledPlanetEvent | null } | null {
  const settlement = indexer.walletSettlement(wallet);
  if (!selectedPlanetId) {
    return { settlement, planet: settlement.planet };
  }

  const planet = indexer.planet(selectedPlanetId.toString());
  if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) {
    return null;
  }

  return {
    settlement: {
      ...settlement,
      homePlanetId: planet.planetId,
      planet
    },
    planet
  };
}

function isDegradableReadError(error: unknown): boolean {
  return error instanceof Error
    && (error.message === "backend_not_configured" || isRpcTransportError(error));
}

function requestsLiveState(url: URL): boolean {
  const source = url.searchParams.get("source") ?? url.searchParams.get("stateSource");
  return source === "live" || url.searchParams.get("live") === "1";
}

function selectedPlanetIdOrUndefined(url: URL): bigint | undefined {
  try {
    return selectedPlanetId(url);
  } catch {
    return undefined;
  }
}

function indexedPlayerQueues(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): PlayerQueues {
  return indexer.playerQueues(wallet, planet?.planetId ?? settlement.homePlanetId);
}

function indexedFleetVisibility(
  wallet: `0x${string}`,
  _settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  _planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): FleetMissionVisibility {
  return indexer.fleetMissionVisibility(wallet);
}

function indexedInfrastructureState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): InfrastructureState {
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];
  const ships = planet ? indexer.shipRows(planet.planetId) : [];
  const queue = planet ? indexer.planetQueue(planet.planetId, "building") : null;
  const technologyLevels = indexer.technologyLevels(wallet);
  const derived = planet
    ? deriveInfrastructureFields(planet, buildings, ships, technologyLevels)
    : {
      productionPerHour: null,
      energyBalance: null,
      storageCaps: null,
      protectedResources: null,
      raidableResources: null
    };

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    infrastructureAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    ...derived,
    technologyLevels,
    buildings,
    queue
  };
}

function indexedMoonState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): MoonState {
  return indexer.moonState(wallet, planet?.planetId ?? settlement.homePlanetId);
}

function indexedShipyardState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): ShipyardState {
  const shipyardLevel = planet ? indexer.infrastructureRows(planet.planetId).find((building) => building.id === 5)?.level ?? 0 : 0;
  const naniteLevel = planet ? indexer.infrastructureRows(planet.planetId).find((building) => building.id === 11)?.level ?? 0 : 0;

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    productionAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    fleetSlots: { active: 0, limit: 1 },
    shipyardLevel,
    naniteLevel,
    technologyLevels: indexer.technologyLevels(wallet),
    ships: planet ? indexer.shipRows(planet.planetId) : [],
    queue: planet ? indexer.planetQueue(planet.planetId, "ship") : null
  };
}

function indexedDefenseState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): DefenseState {
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    productionAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    shipyardLevel: buildings.find((building) => building.id === 5)?.level ?? 0,
    missileSiloLevel: buildings.find((building) => building.id === 14)?.level ?? 0,
    technologyLevels: indexer.technologyLevels(wallet),
    defenses: planet ? indexer.defenseRows(planet.planetId) : [],
    queue: planet ? indexer.planetQueue(planet.planetId, "defense") : null
  };
}

function indexedResearchState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): ResearchState {
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];

  return {
    wallet,
    homePlanetId: settlement.homePlanetId,
    researchAvailable: true,
    unavailableReason,
    resources: planet?.resources ?? null,
    researchLabLevel: buildings.find((building) => building.id === 6)?.level ?? 0,
    researchNetworkLabLevels: [],
    technologyLevels: indexer.technologyLevels(wallet),
    technologies: indexer.technologyRows(wallet),
    queue: indexer.researchQueue(wallet)
  };
}

function indexedRiftState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  _unavailableReason: string,
  indexer: SettlementIndexer
): RiftState {
  return indexer.riftState(wallet, planet?.planetId ?? settlement.homePlanetId);
}

function verifyAlchemyWebhookSignature(
  rawBody: string,
  headers: Headers,
  signingKey: string | undefined
): Response | null {
  if (!signingKey) return null;

  const signature = headers.get("x-alchemy-signature");
  if (!signature) {
    return Response.json(
      { error: "webhook_signature_required" },
      { headers: corsHeaders, status: 401 }
    );
  }

  const expected = createHmac("sha256", signingKey).update(rawBody).digest("hex");
  if (!constantTimeEqual(signature, expected)) {
    return Response.json(
      { error: "webhook_signature_invalid" },
      { headers: corsHeaders, status: 401 }
    );
  }

  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function alchemyWebhookLogs(payload: unknown): IndexedRpcLog[] {
  const logs: IndexedRpcLog[] = [];
  collectAlchemyLogs(payload, logs);
  return logs;
}

function collectAlchemyLogs(value: unknown, logs: IndexedRpcLog[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAlchemyLogs(item, logs);
    return;
  }
  if (!isRecord(value)) return;

  if (isWebhookLog(value)) {
    logs.push(value);
    return;
  }

  for (const child of Object.values(value)) {
    collectAlchemyLogs(child, logs);
  }
}

function isWebhookLog(value: Record<string, unknown>): value is IndexedRpcLog {
  return typeof value.blockNumber === "string"
    && typeof value.transactionHash === "string"
    && Array.isArray(value.topics)
    && value.topics.every((topic) => typeof topic === "string")
    && typeof value.data === "string"
    && (value.logIndex === undefined || typeof value.logIndex === "string")
    && (value.removed === undefined || typeof value.removed === "boolean");
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

function debrisFieldRef(field: IndexedDebrisFieldEvent | undefined): { metal: string; crystal: string } | null {
  return field ? field.resources : null;
}

function moonChanceReportRef(report: IndexedMoonChanceReportEvent | undefined): (MoonChanceReportEvent & { status: string }) | null {
  if (!report) return null;
  return {
    ...report,
    status: moonChanceStatus(report)
  };
}

function moonChanceStatus(report: MoonChanceReportEvent): string {
  if (report.eventName === "MoonChanceRequested") return "pending";
  if (report.eventName === "MoonDestructionRequested") return "moon_destruction_pending";
  if (report.eventName === "MoonDestructionFinalized") return report.moonDestroyed ? "moon_destroyed" : "moon_survived";
  if (report.eventName === "MoonChanceSkippedExistingMoon") return "existing_moon_skipped";
  return report.moonCreated ? "created" : "not_created";
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
  const randomnessEngineAddress = process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS ?? null;
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
    featureSupport: {
      allianceConfigured: Boolean(allianceContractAddress),
      gameConfigured: Boolean(gameContractAddress),
      highscoresEndpoint: true,
      moonConfigured: Boolean(moonContractAddress),
      randomnessConfigured: Boolean(randomnessEngineAddress),
      researchEndpoint: true,
      resourceTokensConfigured: Boolean(
        resourceTokenAddresses.metal
          && resourceTokenAddresses.crystal
          && resourceTokenAddresses.deuterium
      ),
      settlementConfigured: Boolean(contractAddress)
    },
    gameContractAddress,
    graphqlUrl,
    moonContractAddress,
    network: process.env.VEYDRIFT_NETWORK_NAME ?? "Base Sepolia",
    randomnessEngineAddress,
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

async function liveWalletRead<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out reading ${label} from live chain state after ${Math.round(LIVE_WALLET_READ_TIMEOUT_MS / 1_000)} seconds.`));
    }, LIVE_WALLET_READ_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

type HighscoreReader = ChainReader & Required<Pick<ChainReader, "getHighscoreForWallet">>;

function requireHighscoreReader(chainReader: ChainReader | undefined, problems: ConfigProblem[]): HighscoreReader | Response {
  const ready = requireChainReader(chainReader, problems);
  if (ready instanceof Response) return ready;
  if (!ready.getHighscoreForWallet) {
    return Response.json(
      {
        error: "highscores_not_supported"
      },
      {
        headers: corsHeaders,
        status: 503
      }
    );
  }

  return ready as HighscoreReader;
}

function highscoreFailureResponse(error: unknown): Response {
  if (isRpcTransportError(error)) {
    return Response.json(
      {
        error: "highscores_unavailable",
        detail: error instanceof Error ? error.message : "RPC request failed."
      },
      {
        headers: corsHeaders,
        status: 503
      }
    );
  }

  return errorResponse(error, 400);
}

function highscoreIndexNotReadyResponse(indexer: SettlementIndexer, startedAt: number): Response | null {
  const snapshot = indexer.snapshot();
  if (snapshot.indexedState === "healthy" && snapshot.lastRebuiltAt) return null;

  return Response.json(
    {
      error: "highscores_index_not_ready",
      detail: "Rankings are warming from indexed game state.",
      durationMs: Date.now() - startedAt,
      indexer: snapshot,
      retryable: true,
      source: "contract-state-indexer"
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function isRpcTransportError(error: unknown): boolean {
  return error instanceof Error && (/^RPC(?: HTTP)?\b/.test(error.message) || isLiveWalletReadTimeout(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type RankedHighscoreEntry = HighscoreEntry & {
  homePlanet: RankedHighscorePlanet | null;
  rank: number;
};

type RankedHighscorePlanet = {
  planetId: string;
  name: string | null;
  coordinates: {
    galaxy: number;
    system: number;
    position: number;
  };
  archetype: ReturnType<typeof planetArchetypeForTemperature>;
};

type HighscoreCategory = keyof ScoreBreakdown;

function highscoreRankings(
  entries: HighscoreEntry[],
  limit: number,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  return Object.fromEntries(
    highscoreCategories.map((category) => [category, rankHighscores(entries, category, limit, planetsByOwner)])
  ) as Record<HighscoreCategory, RankedHighscoreEntry[]>;
}

function rankHighscores(
  entries: HighscoreEntry[],
  category: HighscoreCategory,
  limit: number,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>
): RankedHighscoreEntry[] {
  return [...entries]
    .sort((left, right) => {
      const delta = BigInt(right.score[category]) - BigInt(left.score[category]);
      if (delta !== 0n) return delta > 0n ? 1 : -1;
      return left.wallet.localeCompare(right.wallet);
    })
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      homePlanet: rankedHighscoreHomePlanet(entry, planetsByOwner),
      rank: index + 1
    }));
}

function rankedHighscoreHomePlanet(
  entry: HighscoreEntry,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>
): RankedHighscorePlanet | null {
  if (!entry.homePlanetId) return null;

  const planet = planetsByOwner
    .get(entry.wallet.toLowerCase())
    ?.find((candidate) => candidate.planetId === entry.homePlanetId);

  if (!planet) return null;

  return {
    planetId: planet.planetId,
    name: planet.name,
    coordinates: {
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.position
    },
    archetype: planetArchetypeForTemperature(planet.temperature)
  };
}

function unavailableResponse(problems: ConfigProblem[]): Response {
  return Response.json(
    {
      error: "backend_not_configured",
      problems
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function errorResponse(error: unknown, status: number): Response {
  const responseStatus = statusForError(error, status);
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Request failed."
    },
    {
      headers: corsHeaders,
      status: responseStatus
    }
  );
}

function statusForError(error: unknown, fallback: number): number {
  if (!(error instanceof Error)) return fallback;

  if (isLiveWalletReadTimeout(error)) return 503;
  if (isRateLimitedRpcError(error)) return 503;
  if (isUpstreamRpcError(error)) return 502;

  return fallback;
}

function isLiveWalletReadTimeout(error: Error): boolean {
  return /^Timed out reading .+ from live chain state after \d+ seconds\.$/.test(error.message);
}

function isRateLimitedRpcError(error: Error): boolean {
  return /RPC HTTP (429|503)|over rate limit|rate limit|too many requests/i.test(error.message);
}

function isUpstreamRpcError(error: Error): boolean {
  return /^RPC (HTTP \d+|-?\d+:)/i.test(error.message);
}

function selectedPlanetId(url: URL): bigint | undefined {
  const value = url.searchParams.get("planetId");
  if (!value) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("planetId must be a positive integer.");
  }
  const planetId = BigInt(value);
  if (planetId === 0n) {
    throw new Error("planetId must be a positive integer.");
  }
  return planetId;
}

function positiveBigIntQuery(url: URL, name: string): bigint {
  const value = url.searchParams.get(name);
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
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
