import { createHmac, timingSafeEqual } from "node:crypto";
import { generateSystem } from "@veydrift/universe";
import { CachedChainReader } from "./cachedReader";
import { ChainSyncService } from "./chainSync";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import {
  assertAddress,
  attackBlockReasonLabel,
  type Address,
  type AllianceIdentity,
  type AllianceState,
  type AttackProtectionStatus,
  type ChainReader,
  type DefenseState,
  type FleetMissionVisibility,
  type InfrastructureState,
  type MoonChanceReportEvent,
  type MoonState,
  type PlanetState,
  type PlayerQueues,
  type ResearchState,
  type Resources,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  VeydriftGameReader
} from "./evm";
import { highscoreCategories, highscoreFormula, type HighscoreEntry, type ScoreBreakdown } from "./highscores";
import {
  SettlementIndexer,
  type IndexedDebrisFieldEvent,
  type IndexedMoonChanceReportEvent,
  type IndexedRpcLog,
  type IndexerSnapshot
} from "./indexer";
import { MissionResolutionService } from "./missionResolution";
import {
  validatePlayerDisplayName,
  verifyPlayerDisplayNameSignature,
  type PlayerProfile
} from "./playerProfiles";
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
      const chainSyncSnapshot = chainSync?.snapshot() ?? null;
      const missionResolutionSnapshot = missionResolver?.snapshot() ?? null;
      const indexerSnapshot = indexer?.snapshot() ?? null;
      return Response.json(
        {
          ok: true,
          service: "veydrift-backend",
          configured: loaded.problems.length === 0,
          chain: safeConfigSummary(loaded.config),
          readiness: backendReadiness(loaded.problems, chainSyncSnapshot, indexerSnapshot),
          chainSync: chainSyncSnapshot,
          missionResolution: missionResolutionSnapshot,
          indexer: indexerSnapshot,
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

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/profile$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return playerProfilesUnavailableResponse();
        return Response.json(indexer.playerProfile(wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "POST" && url.pathname.match(/^\/wallet\/[^/]+\/profile\/display-name$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!indexer) return playerProfilesUnavailableResponse();
        const body = await readJsonBody(request);
        const validation = validatePlayerDisplayName(body?.displayName);
        if (!validation.ok) {
          return Response.json({ error: "invalid_display_name", message: validation.error }, {
            headers: corsHeaders,
            status: 400
          });
        }

        const verified = await verifyPlayerDisplayNameSignature({
          displayName: validation.displayName,
          signature: body?.signature,
          wallet
        });
        if (!verified) {
          return Response.json({
            error: "invalid_signature",
            message: "Sign the Veydrift display-name message with the connected wallet."
          }, {
            headers: corsHeaders,
            status: 401
          });
        }

        return Response.json(indexer.upsertPlayerDisplayName(wallet, validation.displayName), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        if (!requestsLiveState(url) && hasWarmPlanetIndex(indexer)) {
          const snapshot = indexer.snapshot();
          const settlement = indexedWalletSettlement(indexer, wallet, undefined)?.settlement ?? indexer.walletSettlement(wallet);
          return Response.json({
            ...withPlayerProfile(settlement, indexer, wallet),
            indexer: snapshot,
            liveReadSkippedAt: new Date().toISOString(),
            source: "contract-state-indexer",
            stale: !snapshot.safeToServeIndexedState
          }, {
            headers: {
              ...corsHeaders,
              "x-veydrift-index-state": snapshot.safeToServeIndexedState ? "healthy" : "stale"
            }
          });
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(withPlayerProfile(await liveWalletRead(ready.getWalletSettlement(wallet), "wallet settlement"), indexer, wallet), {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement-funding$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(await liveWalletRead(ready.getSettlementFunding(wallet), "settlement funding"), {
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
        if (!requestsLiveState(url) && hasWarmPlanetIndex(indexer)) {
          return Response.json(withPlayerProfile(indexedWalletPlanets(indexer, wallet), indexer, wallet), {
            headers: corsHeaders
          });
        }
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(withPlayerProfile(await liveWalletRead(ready.getWalletPlanets(wallet), "wallet planets"), indexer, wallet), {
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

    if (request.method === "GET" && url.pathname.match(/^\/battle-report\/[^/]+$/)) {
      const missionId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        const report = await liveWalletRead(ready.getBattleReport(parseMissionId(missionId)), "battle report");
        if (!report) {
          return Response.json(
            { error: "Battle report not found." },
            { headers: corsHeaders, status: 404 }
          );
        }
        return Response.json(report, {
          headers: corsHeaders
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/battle-reports") {
      try {
        const ready = requireChainReader(createLiveChainReader(), loaded.problems);
        if (ready instanceof Response) return ready;
        return Response.json(await liveWalletRead(ready.listBattleReports(), "battle reports"), {
          headers: corsHeaders
        });
      } catch (error) {
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
        return Response.json(enrichAllianceState(await liveWalletRead(ready.getAllianceState(wallet), "alliance"), indexer), {
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
        const pagination = highscorePagination(url);
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

        const profiles = indexer?.playerProfiles(planetsByOwner.keys()) ?? new Map<string, PlayerProfile>();
        const allianceIntel = await allianceIntelForPlayers(entries.map((entry) => entry.wallet), chainReader);
        const totalEntries = entries.length;
        const totalPages = Math.max(1, Math.ceil(totalEntries / pagination.pageSize));
        const page = Math.min(pagination.page, totalPages);
        const offset = (page - 1) * pagination.pageSize;
        const rankedRows = highscoreRows(
          entries,
          planetsByOwner,
          profiles,
          allianceIntel
        );
        const rankings = highscoreRankings(
          entries,
          pagination.pageSize,
          offset,
          rankedRows
        );
        const protection = indexer
          ? rankedHighscoreIndexedProtectionLookup(
            highscoreRankingRows(rankings),
            entries,
            url.searchParams.get("currentWallet"),
            highscoreAttackProtectionRequested(url)
          )
          : await rankedHighscoreProtectionLookup(
            highscoreRankingRows(rankings),
            chainReader,
            url.searchParams.get("currentWallet"),
            highscoreAttackProtectionRequested(url)
          );
        const protectedRankings = highscoreRankingsWithProtection(rankings, protection);
        const currentPlayer = highscoreCurrentPlayerPages(entries, pagination.pageSize, url.searchParams.get("currentWallet"));

        return Response.json(
          {
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            formula: highscoreFormula,
            pagination: {
              page,
              pageSize: pagination.pageSize,
              totalEntries,
              totalPages,
              hasPreviousPage: page > 1,
              hasNextPage: page < totalPages
            },
            currentPlayer,
            rankings: protectedRankings,
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
      const allianceIntel = await allianceIntelForOccupiedPlanets(
        Array.from(occupied.values()),
        createLiveChainReader()
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
            occupiedBy: occupiedPlanetRef(occupied.get(planet.position), indexer, allianceIntel),
            publicState: publicPlanetStateRef(occupied.get(planet.position), indexer),
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
            systems: await Promise.all(Array.from({ length: to - from + 1 }, async (_, index) => {
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
              const allianceIntel = await allianceIntelForOccupiedPlanets(
                Array.from(occupied.values()),
                createLiveChainReader()
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
                  occupiedBy: occupiedPlanetRef(occupied.get(planet.position), indexer, allianceIntel),
                  publicState: publicPlanetStateRef(occupied.get(planet.position), indexer),
                  debrisField: debrisFieldRef(debris.get(planet.position)),
                  moonChance: moonChanceReportRef(moonChance.get(planet.position))
                }))
              };
            }))
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

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function playerProfilesUnavailableResponse(): Response {
  return Response.json(
    {
      error: "player_profiles_unavailable",
      message: "Player profiles are unavailable until the indexed backend database is configured."
    },
    {
      headers: corsHeaders,
      status: 503
    }
  );
}

function withPlayerProfile<T extends { wallet: `0x${string}` }>(
  body: T,
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}` = body.wallet
): T & { player: PlayerProfile } {
  return {
    ...body,
    player: indexer?.playerProfile(wallet) ?? fallbackPlayerProfile(wallet)
  };
}

function fallbackPlayerProfile(wallet: `0x${string}`): PlayerProfile {
  const normalizedWallet = wallet.toLowerCase() as `0x${string}`;
  return {
    wallet: normalizedWallet,
    displayName: null,
    fallbackName: `${normalizedWallet.slice(0, 6)}...${normalizedWallet.slice(-4)}`,
    updatedAt: null
  };
}

function enrichAllianceState(
  state: AllianceState,
  indexer: SettlementIndexer | undefined
): AllianceState {
  const dismissJoinRequestAvailable = process.env.VEYDRIFT_ALLIANCE_DISMISS_JOIN_REQUEST_ENABLED !== "false";
  if (!indexer) return { ...state, dismissJoinRequestAvailable };

  const displayNameField = <Key extends string>(key: Key, wallet: `0x${string}`): Record<Key, string> | Record<string, never> => {
    const displayName = indexer.playerProfile(wallet).displayName;
    return displayName ? { [key]: displayName } as Record<Key, string> : {};
  };

  return {
    ...state,
    dismissJoinRequestAvailable,
    profile: state.profile
      ? {
          ...state.profile,
          ...displayNameField("ownerDisplayName", state.profile.owner)
        }
      : null,
    directory: state.directory.map((alliance) => ({
      ...alliance,
      ...displayNameField("ownerDisplayName", alliance.owner)
    })),
    pendingInvites: state.pendingInvites.map((invite) => ({
      ...invite,
      ...displayNameField("inviterDisplayName", invite.inviter)
    })),
    pendingJoinRequests: state.pendingJoinRequests.map((request) => ({
      ...request,
      ...displayNameField("requesterDisplayName", request.requester)
    })),
    allianceJoinRequests: state.allianceJoinRequests.map((request) => ({
      ...request,
      ...displayNameField("requesterDisplayName", request.requester)
    })),
    members: state.members.map((member) => ({
      ...member,
      ...displayNameField("displayName", member.address)
    }))
  };
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
    const planet = accruedPlanetState(indexer, settlement.planet);
    return {
      settlement: {
        ...settlement,
        planet
      },
      planet
    };
  }

  const planet = accruedPlanetState(indexer, indexer.planet(selectedPlanetId.toString()));
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

function indexedWalletPlanets(
  indexer: SettlementIndexer,
  wallet: `0x${string}`
): ReturnType<SettlementIndexer["walletPlanets"]> {
  const response = indexer.walletPlanets(wallet);
  return {
    ...response,
    planets: response.planets.map((planet) => accruedPlanetState(indexer, planet))
  };
}

function accruedPlanetState<T extends PlanetState | null>(
  indexer: SettlementIndexer,
  planet: T
): T {
  if (!planet) return planet;

  const buildings = indexer.infrastructureRows(planet.planetId);
  const ships = indexer.shipRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const derived = deriveInfrastructureFields(planet, buildings, ships, technologyLevels);
  return {
    ...planet,
    resources: resourcesWithClaimableAccrual(planet.resources, derived.productionPerHour, derived.storageCaps, planet.lastSettledAt)
  };
}

function isDegradableReadError(error: unknown): boolean {
  return error instanceof Error
    && (error.message === "backend_not_configured" || isRpcTransportError(error));
}

function requestsLiveState(_url: URL): boolean {
  return false;
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
    planetId: planet?.planetId ?? settlement.homePlanetId,
    planetLastSettledAt: planet?.lastSettledAt ?? null,
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
    planetId: planet?.planetId ?? settlement.homePlanetId,
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
    naniteLevel: buildings.find((building) => building.id === 11)?.level ?? 0,
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
    && (value.blockTimestamp === undefined || typeof value.blockTimestamp === "string")
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

function occupiedPlanetRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined,
  allianceIntel: ReadonlyMap<string, AllianceIdentity> = new Map()
): { planetId: string; owner: string; ownerDisplayName: string | null; alliance: AllianceIdentity | null } | null {
  return planet
    ? {
        planetId: planet.planetId,
        owner: planet.owner,
        ownerDisplayName: indexer?.playerProfile(planet.owner).displayName ?? null,
        alliance: allianceIntel.get(planet.owner.toLowerCase()) ?? null
      }
    : null;
}

function publicPlanetStateRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined
): {
  resources: SettledPlanetEvent["resources"];
  buildings: Array<{ id: number; level: number }>;
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  research: Array<{ id: number; level: number }>;
  queues: {
    building: PlayerQueues["building"];
    defense: PlayerQueues["defense"];
    ship: PlayerQueues["ship"];
    research: PlayerQueues["research"];
  };
} | null {
  if (!planet || !indexer) return null;
  const buildings = indexer.infrastructureRows(planet.planetId);
  const ships = indexer.shipRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const derived = deriveInfrastructureFields(planet, buildings, ships, technologyLevels);

  return {
    resources: resourcesWithClaimableAccrual(planet.resources, derived.productionPerHour, derived.storageCaps, planet.lastSettledAt),
    buildings: buildings.map(({ id, level }) => ({ id, level })),
    fleet: ships.map(({ id, count }) => ({ id, count })),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })),
    research: indexer.technologyRows(planet.owner).map(({ id, level }) => ({ id, level })),
    queues: {
      building: indexer.planetQueue(planet.planetId, "building"),
      defense: indexer.planetQueue(planet.planetId, "defense"),
      ship: indexer.planetQueue(planet.planetId, "ship"),
      research: indexer.researchQueue(planet.owner)
    }
  };
}

function resourcesWithClaimableAccrual(
  current: Resources,
  productionPerHour: Resources | null,
  storageCaps: Resources | null,
  lastSettledAt: string,
  now = Date.now()
): Resources {
  if (!productionPerHour || !storageCaps) return current;

  const lastSettledAtSeconds = Number(lastSettledAt);
  if (!Number.isFinite(lastSettledAtSeconds) || lastSettledAtSeconds <= 0) return current;

  const elapsedSeconds = Math.max(0, Math.floor(now / 1_000) - lastSettledAtSeconds);
  return {
    metal: resourceWithClaimableAccrual(current.metal, productionPerHour.metal, storageCaps.metal, elapsedSeconds),
    crystal: resourceWithClaimableAccrual(current.crystal, productionPerHour.crystal, storageCaps.crystal, elapsedSeconds),
    deuterium: resourceWithClaimableAccrual(current.deuterium, productionPerHour.deuterium, storageCaps.deuterium, elapsedSeconds)
  };
}

function resourceWithClaimableAccrual(
  current: string,
  productionPerHour: string,
  storageCap: string,
  elapsedSeconds: number
): string {
  const currentValue = Number(current);
  const rate = Math.max(0, Number(productionPerHour));
  const cap = Number(storageCap);
  if (!Number.isFinite(currentValue) || !Number.isFinite(rate) || !Number.isFinite(cap)) return current;

  const produced = Math.floor((rate * elapsedSeconds) / 3_600);
  const remainingCapacity = Math.max(0, cap - currentValue);
  return Math.floor(currentValue + Math.min(produced, remainingCapacity)).toString();
}

async function allianceIntelForOccupiedPlanets(
  planets: readonly SettledPlanetEvent[],
  chainReader: ChainReader | undefined
): Promise<Map<string, AllianceIdentity>> {
  return allianceIntelForPlayers(planets.map((planet) => planet.owner), chainReader);
}

async function allianceIntelForPlayers(
  wallets: readonly string[],
  chainReader: ChainReader | undefined
): Promise<Map<string, AllianceIdentity>> {
  const result = new Map<string, AllianceIdentity>();
  if (!chainReader?.getAllianceIntelForPlayers || wallets.length === 0) return result;

  try {
    const owners = Array.from(new Set(wallets.map((wallet) => wallet.toLowerCase() as Address)));
    const intel = await chainReader.getAllianceIntelForPlayers(owners);
    for (const [owner, alliance] of intel) result.set(owner.toLowerCase(), alliance);
  } catch (error) {
    console.error("Alliance intel lookup failed", error);
  }

  return result;
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
  if (highscoreIndexCanServe(snapshot)) return null;

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

function highscoreIndexCanServe(snapshot: IndexerSnapshot): boolean {
  if (snapshot.indexedState === "healthy" && snapshot.lastRebuiltAt) return true;

  return Boolean(snapshot.lastRebuiltAt && snapshot.lastReconciledAt && snapshot.indexedPlanets > 0);
}

function isRpcTransportError(error: unknown): boolean {
  return error instanceof Error && (/^RPC(?: HTTP)?\b/.test(error.message) || isLiveWalletReadTimeout(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type RankedHighscoreEntry = HighscoreEntry & {
  alliance: AllianceIdentity | null;
  attackProtection: RankedHighscoreAttackProtection | null;
  displayName: string | null;
  homePlanet: RankedHighscorePlanet | null;
  planets: RankedHighscorePlanet[];
  rank: number;
};

type RankedHighscoreAttackProtection = Pick<AttackProtectionStatus, "allowed" | "blockedReason" | "blockedReasonLabel">;

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

type HighscoreCurrentPlayerPage = {
  rank: number;
  page: number;
};

function highscorePagination(url: URL): { page: number; pageSize: number } {
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? String(limit), 10) || limit;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), 250)
  };
}

function highscoreCurrentPlayerPages(
  entries: HighscoreEntry[],
  pageSize: number,
  wallet: string | null
): { wallet: string; rankings: Record<HighscoreCategory, HighscoreCurrentPlayerPage | null> } | undefined {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return undefined;

  const normalizedWallet = wallet.toLowerCase();
  const rankings = Object.fromEntries(
    highscoreCategories.map((category) => {
      const index = sortedHighscores(entries, category)
        .findIndex((entry) => entry.wallet.toLowerCase() === normalizedWallet);
      const rank = index === -1 ? null : index + 1;
      return [
        category,
        rank === null
          ? null
          : {
              rank,
              page: Math.max(1, Math.ceil(rank / pageSize))
            }
      ];
    })
  ) as Record<HighscoreCategory, HighscoreCurrentPlayerPage | null>;

  return {
    wallet: normalizedWallet,
    rankings
  };
}

function highscoreAttackProtectionRequested(url: URL): boolean {
  const value = url.searchParams.get("includeAttackProtection") ?? "";
  return /^(1|true|yes)$/i.test(value);
}

function highscoreRankings(
  entries: HighscoreEntry[],
  limit: number,
  offset: number,
  rows: Map<string, RankedHighscoreEntry>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      rankHighscores(entries, category, limit, offset, rows)
    ])
  ) as Record<HighscoreCategory, RankedHighscoreEntry[]>;
}

function highscoreRankingRows(rankings: Record<HighscoreCategory, RankedHighscoreEntry[]>): RankedHighscoreEntry[] {
  return Object.values(rankings).flat();
}

function highscoreRankingsWithProtection(
  rankings: Record<HighscoreCategory, RankedHighscoreEntry[]>,
  protection: ReadonlyMap<string, RankedHighscoreAttackProtection | null>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      rankings[category].map((row) => ({
        ...row,
        attackProtection: rankedHighscoreRowProtection(row, protection)
      }))
    ])
  ) as Record<HighscoreCategory, RankedHighscoreEntry[]>;
}

function rankedHighscoreRowProtection(
  row: RankedHighscoreEntry,
  protection: ReadonlyMap<string, RankedHighscoreAttackProtection | null>
): RankedHighscoreAttackProtection | null {
  const statuses = row.planets
    .map((planet) => protection.get(planet.planetId) ?? null)
    .filter((status): status is RankedHighscoreAttackProtection => Boolean(status));

  return statuses.find((status) => status.blockedReason === "score_protection")
    ?? statuses.find((status) => !status.allowed)
    ?? statuses[0]
    ?? null;
}

function highscoreRows(
  entries: HighscoreEntry[],
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>,
  profiles: ReadonlyMap<string, PlayerProfile> = new Map(),
  allianceIntel: ReadonlyMap<string, AllianceIdentity> = new Map()
): Map<string, RankedHighscoreEntry> {
  return new Map(
    entries.map((entry) => {
      const planets = rankedHighscorePlanets(entry, planetsByOwner);
      const homePlanet = rankedHighscoreHomePlanet(entry, planets);
      return [
        entry.wallet.toLowerCase(),
        {
          ...entry,
          alliance: allianceIntel.get(entry.wallet.toLowerCase()) ?? null,
          attackProtection: null,
          displayName: profiles.get(entry.wallet.toLowerCase())?.displayName ?? null,
          homePlanet,
          planets,
          rank: 0
        }
      ];
    })
  );
}

function rankHighscores(
  entries: HighscoreEntry[],
  category: HighscoreCategory,
  limit: number,
  offset: number,
  rows: ReadonlyMap<string, RankedHighscoreEntry>
): RankedHighscoreEntry[] {
  return sortedHighscores(entries, category)
    .slice(offset, offset + limit)
    .map((entry, index) => {
      const row = rows.get(entry.wallet.toLowerCase())!;
      return {
        ...row,
        rank: offset + index + 1
      };
    });
}

async function rankedHighscoreProtectionLookup(
  rows: Iterable<RankedHighscoreEntry>,
  chainReader: ChainReader | undefined,
  currentWallet: string | null | undefined,
  includeAttackProtection: boolean
): Promise<Map<string, RankedHighscoreAttackProtection | null>> {
  if (!includeAttackProtection) return new Map();

  const uniquePlanets = new Map<string, RankedHighscorePlanet>();
  for (const row of rows) {
    for (const planet of row.planets) {
      uniquePlanets.set(planet.planetId, planet);
    }
  }

  const statuses = await Promise.all(
    [...uniquePlanets.values()].map(async (planet) => [
      planet.planetId,
      await rankedHighscoreAttackProtection(chainReader, currentWallet, planet)
    ] as const)
  );

  return new Map(statuses);
}

function rankedHighscoreIndexedProtectionLookup(
  rows: Iterable<RankedHighscoreEntry>,
  entries: readonly HighscoreEntry[],
  currentWallet: string | null | undefined,
  includeAttackProtection: boolean
): Map<string, RankedHighscoreAttackProtection | null> {
  if (!includeAttackProtection || !currentWallet || !/^0x[a-fA-F0-9]{40}$/.test(currentWallet)) return new Map();

  const attacker = entries.find((entry) => entry.wallet.toLowerCase() === currentWallet.toLowerCase());
  if (!attacker) return new Map();

  const statuses = new Map<string, RankedHighscoreAttackProtection | null>();
  const attackerScore = BigInt(attacker.score.total);
  for (const row of rows) {
    const status = indexedScoreProtectionStatus(attackerScore, BigInt(row.score.total));
    for (const planet of row.planets) {
      statuses.set(planet.planetId, status);
    }
  }

  return statuses;
}

function indexedScoreProtectionStatus(
  attackerScore: bigint,
  defenderScore: bigint
): RankedHighscoreAttackProtection | null {
  if (!isIndexedScoreProtected(attackerScore, defenderScore)) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null
    };
  }

  return {
    allowed: false,
    blockedReason: "score_protection",
    blockedReasonLabel: attackBlockReasonLabel("score_protection")
  };
}

function isIndexedScoreProtected(attackerScore: bigint, defenderScore: bigint): boolean {
  const attackerRatio = indexedNewbieProtectionRatioBps(attackerScore);
  const defenderRatio = indexedNewbieProtectionRatioBps(defenderScore);
  if (attackerRatio === 0n && defenderRatio === 0n) return false;
  if (defenderRatio !== 0n && attackerScore * 10_000n > defenderScore * defenderRatio) return true;
  if (attackerRatio !== 0n && defenderScore * 10_000n > attackerScore * attackerRatio) return true;
  return false;
}

function indexedNewbieProtectionRatioBps(score: bigint): bigint {
  if (score < 50_000n) return 50_000n;
  if (score < 500_000n) return 100_000n;
  return 0n;
}

async function rankedHighscoreAttackProtection(
  chainReader: ChainReader | undefined,
  currentWallet: string | null | undefined,
  planet: RankedHighscorePlanet | null
): Promise<RankedHighscoreAttackProtection | null> {
  if (!chainReader || !planet || !currentWallet || !/^0x[a-fA-F0-9]{40}$/.test(currentWallet)) return null;

  try {
    const status = await chainReader.getAttackProtectionStatus(currentWallet as Address, BigInt(planet.planetId));
    return {
      allowed: status.allowed,
      blockedReason: status.blockedReason,
      blockedReasonLabel: status.blockedReasonLabel
    };
  } catch {
    return null;
  }
}

function sortedHighscores(entries: HighscoreEntry[], category: HighscoreCategory): HighscoreEntry[] {
  return [...entries].sort((left, right) => {
    const delta = BigInt(right.score[category]) - BigInt(left.score[category]);
    if (delta !== 0n) return delta > 0n ? 1 : -1;
    return left.wallet.localeCompare(right.wallet);
  });
}

function rankedHighscorePlanets(
  entry: HighscoreEntry,
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>
): RankedHighscorePlanet[] {
  return (planetsByOwner.get(entry.wallet.toLowerCase()) ?? []).map((planet) => ({
    planetId: planet.planetId,
    name: planet.name,
    coordinates: {
      galaxy: planet.galaxy,
      system: planet.system,
      position: planet.position
    },
    archetype: planetArchetypeForTemperature(planet.temperature)
  }));
}

function rankedHighscoreHomePlanet(
  entry: HighscoreEntry,
  planets: readonly RankedHighscorePlanet[]
): RankedHighscorePlanet | null {
  if (!entry.homePlanetId) return null;
  return planets.find((candidate) => candidate.planetId === entry.homePlanetId) ?? null;
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

function backendReadiness(
  problems: ConfigProblem[],
  chainSyncSnapshot: unknown,
  indexerSnapshot: unknown,
): {
  ready: boolean;
  configurationReady: boolean;
  chainSyncConnected: boolean | null;
  subscribedToHeads: boolean | null;
  subscribedToLogs: boolean | null;
  indexedState: string | null;
  safeToServeIndexedState: boolean | null;
} {
  const chainSyncConnected = booleanSnapshotField(chainSyncSnapshot, "connected");
  const subscribedToHeads = booleanSnapshotField(chainSyncSnapshot, "subscribedToHeads");
  const subscribedToLogs = booleanSnapshotField(chainSyncSnapshot, "subscribedToLogs");
  const indexedState = stringSnapshotField(indexerSnapshot, "indexedState");
  const safeToServeIndexedState = booleanSnapshotField(indexerSnapshot, "safeToServeIndexedState");
  const configurationReady = problems.length === 0;

  return {
    ready: configurationReady
      && chainSyncConnected !== false
      && subscribedToHeads !== false
      && subscribedToLogs !== false
      && safeToServeIndexedState !== false,
    configurationReady,
    chainSyncConnected,
    subscribedToHeads,
    subscribedToLogs,
    indexedState,
    safeToServeIndexedState,
  };
}

function booleanSnapshotField(snapshot: unknown, key: string): boolean | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

function stringSnapshotField(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
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

function parseMissionId(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("Mission id must be a positive integer.");
  }
  const missionId = BigInt(value);
  if (missionId === 0n) {
    throw new Error("Mission id must be a positive integer.");
  }
  return missionId;
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
