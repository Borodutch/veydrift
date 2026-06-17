import { createHmac, timingSafeEqual } from "node:crypto";
import { generateSystem } from "@veydrift/universe";
import { CachedChainReader } from "./cachedReader";
import { ChainSyncService } from "./chainSync";
import { loadBackendConfig, safeConfigSummary, type BackendConfig, type ConfigProblem } from "./config";
import {
  assertAddress,
  attackBlockReasonLabel,
  type AllianceIdentity,
  type AllianceState,
  type AttackBlockReason,
  type AttackProtectionStatus,
  type ChainReader,
  type DefenseState,
  type FleetMissionArchiveEntry,
  type FleetMissionArchiveResponse,
  type FleetMissionSummary,
  type FleetMissionVisibility,
  type GlobalActiveMissionsResponse,
  type GlobalMissionArchiveResponse,
  type InfrastructureState,
  type MoonChanceReportEvent,
  type MoonState,
  type ManagedPlanet,
  type PlanetState,
  type PlayerQueues,
  type ResearchState,
  type Resources,
  type RiftState,
  type RpcLog,
  type SettledPlanetEvent,
  type ShipyardState,
  type StationedDefenderSummary,
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
import { RandomnessCommitterService } from "./randomnessCommitter";
import {
  validatePlayerDisplayName,
  verifyPlayerDisplayNameSignature,
  type PlayerProfile
} from "./playerProfiles";
import { deriveInfrastructureFields, isCombatShipId } from "./readModels";
import { planetArchetypeForTemperature, planetMetadata, systemSnapshot, type PlanetMetadata } from "./universe";
import type { WorkerRole } from "./workerPool";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": process.env.VEYDRIFT_ALLOWED_ORIGIN ?? "https://test.veydrift.com",
  ...jsonHeaders
} as const;

const indexedSource = "contract-state-indexer" as const;

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
  randomnessCommitter?: RandomnessCommitterService;
  indexer?: SettlementIndexer;
  // Worker role in the multi-process pool (VEY-KANEO-466). "writer" (the default) owns chain-sync
  // ingestion, the cold-start rebuild, bounded reconciles, and the on-chain committers — those must
  // run on exactly one worker. "reader" workers skip every background loop and serve reads from the
  // shared WAL database. Explicitly injected services (tests) always take precedence over the role.
  role?: WorkerRole;
  // Test/operator seam for an explicit canonical rebuild. Production defaults to false: the normal
  // backend no longer self-heals from eth_call at boot. Chain-sync event replay is the automatic path.
  runStartupReconcile?: boolean;
};

const defaultUniverseSeed = "veydrift-mainnet-preview";

export function createRequestHandler(dependencies: ServerDependencies = {}): (request: Request) => Promise<Response> {
  // Only the writer worker runs the chain indexer ingestion + the on-chain committers; reader workers
  // serve from the shared WAL database and must not start any background loop (VEY-KANEO-466). Tests
  // that inject services bypass this entirely. Default is "writer" so single-process and test setups
  // keep their current behavior.
  const isWriter = (dependencies.role ?? "writer") !== "reader";
  const loaded = dependencies.config ? { config: dependencies.config, problems: dependencies.configProblems ?? [] } : loadBackendConfig();
  const rawChainReader =
    dependencies.chainReader ??
    (loaded.problems.length === 0 ? new VeydriftGameReader(loaded.config, undefined, { hydrateQueueStartedAt: false }) : undefined);
  const cacheReader = rawChainReader && !dependencies.chainReader ? new CachedChainReader(rawChainReader) : undefined;
  const chainReader = cacheReader ?? rawChainReader;
  const indexerChainReader =
    dependencies.chainReader
      ? chainReader
      : loaded.problems.length === 0
        ? new VeydriftGameReader(loaded.config)
        : undefined;
  const indexer =
    dependencies.indexer ??
    (isIndexableChainReader(indexerChainReader) ? new SettlementIndexer(indexerChainReader, loaded.config.indexFromBlock, {
      databasePath: loaded.config.indexDbPath,
      // VEY-KANEO-471: config already hard-gates this to non-production; pass it through so the
      // fleet-visibility read model can serve the synthetic stationed-defense payload for QA.
      qaSyntheticStationedDefenders: loaded.config.qaSyntheticStationedDefenders,
      // VEY-KANEO-479: when the randomness engine is configured, gate an arrived Attack's readiness on
      // its battle randomness being fulfilled (derived from ingested RandomnessFulfilled logs).
      randomnessEngineConfigured: Boolean(loaded.config.randomnessEngineAddress),
      // VEY-KANEO-485: bound the cold wipe->reindex chain reads so a stall surfaces a real error and the
      // boot-time recovery retries, instead of an indefinite silent reconciliation_in_progress.
      ...(loaded.config.rebuildDeadlineMs ? { rebuildDeadlineMs: loaded.config.rebuildDeadlineMs } : {})
    }) : undefined);
  const logBackfiller = deriveLogBackfiller(indexerChainReader);
  const chainSync =
    dependencies.chainSync ??
    (isWriter && loaded.problems.length === 0
      ? new ChainSyncService(loaded.config, indexer, logBackfiller ? { logBackfiller } : {})
      : undefined);
  const randomnessCommitter =
    dependencies.randomnessCommitter ??
    (isWriter && loaded.problems.length === 0 ? new RandomnessCommitterService(loaded.config) : undefined);

  chainSync?.start();
  randomnessCommitter?.start();
  const runStartupReconcile = dependencies.runStartupReconcile ?? false;
  if (isWriter && runStartupReconcile && indexer && loaded.problems.length === 0) {
    // Explicit operator/test rebuild only. This path performs canonical eth_call reads and therefore must
    // never run automatically for frontend/API serving; normal mutation comes from event replay/listeners.
    void indexer.rebuild().catch((error) => {
      console.error("Veydrift explicit index reconciliation failed", error);
    });
  }
  if (isWriter && loaded.config.currentStateHealRunId && indexer && loaded.problems.length === 0) {
    // Explicit operator heal only. This runs inside the single writer process after chain polling starts,
    // so event ingestion keeps moving while canonical state is healed planet-by-planet/section-by-section.
    void indexer
      .startCurrentStateHealOnce(loaded.config.currentStateHealRunId, {
        planetConcurrency: loaded.config.currentStateHealConcurrency ?? 25
      })
      .catch((error) => {
        console.error("Veydrift current-state heal failed", error);
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
      const indexerSnapshot = indexer?.snapshot() ?? null;
      return Response.json(
        {
          ok: true,
          service: "veydrift-backend",
          configured: loaded.problems.length === 0,
          chain: safeConfigSummary(loaded.config),
          readiness: backendReadiness(loaded.problems, chainSyncSnapshot, indexerSnapshot),
          chainSync: chainSyncSnapshot,
          missionResolution: null,
          randomnessCommitter: randomnessCommitter?.snapshot() ?? null,
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
          randomnessCommitter: randomnessCommitter?.snapshot() ?? null,
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

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/overview$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = indexedWalletOverviewWarmResponse(indexer, wallet, selectedPlanetId(url));
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("overview snapshot", indexer);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = indexedWalletSettlementWarmResponse(indexer, wallet);
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("wallet settlement", indexer);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/settlement-funding$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        return indexedSettlementFundingResponse(indexer, loaded.config);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/planets$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const indexed = indexedWalletPlanetsWarmResponse(indexer, wallet);
        if (indexed) return indexed;
        return indexedReadNotReadyResponse("wallet planets", indexer);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/queues$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "player queues", indexedPlayerQueues);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/fleet-visibility$/)) {
      try {
        const includeArchive = url.searchParams.get("archive") !== "none";
        return await indexedWalletStateResponse(url, indexer, "fleet visibility", (wallet, settlement, planet, detail, indexer) =>
          indexedFleetVisibility(wallet, settlement, planet, detail, indexer, { includeArchive }), {
          includeSelectedPlanet: false
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/missions$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "mission archive", (wallet, _settlement, _planet, _detail, indexer) =>
          indexedMissionArchive(wallet, url, indexer), {
          includeSelectedPlanet: false
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/missions") {
      try {
        if (!indexer) return indexedReadNotReadyResponse("missions", indexer);
        const snapshot = indexer.snapshot();
        const status = url.searchParams.get("status") ?? "active";
        if (status === "active") {
          return Response.json(
            { missions: indexer.allActiveFleetMissions() } satisfies GlobalActiveMissionsResponse,
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
          );
        }
        if (status === "completed") {
          return Response.json(
            globalMissionArchive(url, indexer),
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
          );
        }
        return errorResponse(new Error(`Unsupported missions status: ${status}`), 400);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/mission\/[^/]+$/)) {
      const missionId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        parseMissionId(missionId);
        if (!indexer) return indexedReadNotReadyResponse("mission", indexer);
        const snapshot = indexer.snapshot();
        const mission = indexer.fleetMission(missionId);
        if (!mission) {
          return Response.json(
            {
              error: "mission_not_found",
              detail: "That mission is not available in the indexed mission read model.",
              source: indexedSource
            },
            { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
          );
        }
        // A joined ACS fleet never emits its own battle report — the resolved combat is keyed to the
        // main attack mission. When this mission has no report of its own but belongs to an attack
        // group, fall back to the group's report so a joiner's mission detail still shows the shared
        // outcome and the per-participant loot split (VEY-KANEO-432).
        const battleReport =
          indexer.battleReport(missionId)
          ?? (mission.attackGroupId ? indexer.battleReport(mission.attackGroupId) : null);
        return Response.json(
          {
            mission,
            battleReport,
            targetCombatIntel: targetCombatIntelForMission(indexer, mission),
            // The defender's surviving fleet/defenses are not in the on-chain combat log, but the
            // indexer tracks the target planet's ship/defense composition (ShipCountChanged + defense
            // events), so the battle report can show real composition instead of a blanket caveat.
            // Null when the target planet is not charted in the indexed read model.
            defenderPlanetState: defenderPlanetStateForReport(
              indexer,
              battleReport,
              battleReport ? indexer.fleetMission(battleReport.missionId) : mission
            ),
            source: indexedSource
          },
          { headers: indexedStateHeaders(indexedStateLabel(snapshot)) }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/battle-report\/[^/]+$/)) {
      const missionId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        parseMissionId(missionId);
        if (!indexer) return indexedReadNotReadyResponse("battle report", indexer);
        const snapshot = indexer.snapshot();
        const report = indexer.battleReport(missionId);
        if (report) {
          return Response.json(report, {
            headers: indexedStateHeaders(indexedStateLabel(snapshot))
          });
        }
        return Response.json(
          {
            error: "battle_report_not_indexed",
            detail: "Battle reports are not available until the indexed battle report read model catches up.",
            source: indexedSource
          },
          { headers: indexedStateHeaders(indexedStateLabel(snapshot)), status: 404 }
        );
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname === "/battle-reports") {
      try {
        if (!indexer) return indexedReadNotReadyResponse("battle reports", indexer);
        const snapshot = indexer.snapshot();
        return Response.json(indexer.battleReports(), {
          headers: indexedStateHeaders(indexedStateLabel(snapshot))
        });
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/infrastructure$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "infrastructure", indexedInfrastructureState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/moon$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const readStartedAt = Date.now();
      try {
        assertAddress(wallet);
        const planetId = selectedPlanetId(url);
        const indexed = await indexedWarmResponse(indexer, wallet, planetId, "moon", indexedMoonState);
        if (indexed) {
          return moonTimedResponse(indexed, readStartedAt);
        }
        return moonTimedResponse(indexedMoonNotReadyResponse(indexer, wallet, planetId), readStartedAt);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/shipyard$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "shipyard", indexedShipyardState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/defenses$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "defenses", indexedDefenseState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/research$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "research", indexedResearchState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/alliance$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        return indexedAllianceResponse(wallet, indexer);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/rift$/)) {
      try {
        return await indexedWalletStateResponse(url, indexer, "rift", indexedRiftState);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/attack-protection$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      try {
        assertAddress(wallet);
        const targetPlanetId = positiveBigIntQuery(url, "targetPlanetId");
        return indexedAttackProtectionResponse(indexer, wallet, targetPlanetId);
      } catch (error) {
        return errorResponse(error, 400);
      }
    }

    if (request.method === "GET" && url.pathname.match(/^\/wallet\/[^/]+\/highscore$/)) {
      const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");

      try {
        assertAddress(wallet);
        if (hasWarmPlanetIndex(indexer)) {
          const indexedPlanets = indexer.settledPlanetsByOwner().get(wallet.toLowerCase()) ?? [];
          return Response.json(
            {
              formula: highscoreFormula,
              entry: indexer.highscoreForWallet(wallet, indexedPlanets.map((planet) => planet.planetId)),
              source: indexedSource
            },
            {
              headers: corsHeaders
            }
          );
        }
        return indexedReadNotReadyResponse("wallet highscore", indexer);
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
        const source = "contract-state-indexer";

        if (indexer) {
          const indexNotReady = highscoreIndexNotReadyResponse(indexer, startedAt);
          if (indexNotReady) return indexNotReady;
          // Memoized against the indexer state version: the full leaderboard is recomputed only
          // when integrated events change state, not on every request (VEY-KANEO-467).
          const leaderboard = indexer.highscoreLeaderboard();
          planetsByOwner = leaderboard.planetsByOwner;
          entries = leaderboard.entries;
        } else {
          return indexedReadNotReadyResponse("highscores", indexer);
        }

        const totalEntries = entries.length;
        const totalPages = Math.max(1, Math.ceil(totalEntries / pagination.pageSize));
        const page = Math.min(pagination.page, totalPages);
        const offset = (page - 1) * pagination.pageSize;
        const requestedCategories = highscoreRequestedCategories(url);
        const sortedRankings = sortedHighscoreRankings(entries, requestedCategories);
        const visibleEntries = highscoreVisibleEntries(sortedRankings, requestedCategories, pagination.pageSize, offset);
        const rankingWallets = highscoreRankingWallets(visibleEntries, url.searchParams.get("currentWallet"));
        const profiles = indexer?.playerProfiles(rankingWallets) ?? new Map<string, PlayerProfile>();
        const allianceIntel = allianceIntelForPlayers(rankingWallets, indexer);
        const rankedRows = highscoreRows(
          visibleEntries,
          planetsByOwner,
          profiles,
          allianceIntel,
          indexer
        );
        const rankings = highscoreRankings(
          sortedRankings,
          requestedCategories,
          pagination.pageSize,
          offset,
          rankedRows
        );
        const protection = rankedHighscoreIndexedProtectionLookup(
          highscoreRankingRows(rankings),
          entries,
          allianceIntel,
          url.searchParams.get("currentWallet"),
          highscoreAttackProtectionRequested(url),
          indexer
        );
        const protectedRankings = highscoreRankingsWithProtection(rankings, protection);
        const currentPlayer = highscoreCurrentPlayerPages(sortedRankings, requestedCategories, pagination.pageSize, url.searchParams.get("currentWallet"));

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
        if (indexer && hasWarmPlanetIndex(indexer)) {
        const planet = indexedCurrentPlanetState(indexer, indexer.planet(planetId.toString()), { allowPendingResources: true });
        return Response.json(planet, {
          headers: corsHeaders
        });
      }
      return indexedReadNotReadyResponse("planet detail", indexer);
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
        indexer
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
                indexer
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

    // The POST /index/rebuild and POST /index/verify/:planetId?heal=true routes have been REMOVED.
    // Both issued on-demand RPC reads from an HTTP request (rebuild re-read the whole universe; verify
    // re-read + healed a single planet). Under the canonical-mirror contract NO request handler may
    // trigger an RPC call: the indexed DB is reconciled from the contracts exactly once at startup and
    // mutated thereafter only by the websocket event listener. The HTTP API serves purely from the DB.

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

/**
 * Build the HTTP-poll log source the chain-sync ingester depends on. Returns undefined unless the
 * reader can both resolve the chain head (eth_blockNumber) and list raw contract logs; the production
 * reader (VeydriftGameReader) exposes both, so polling is wired by default. Exported so a test can
 * assert production construction enables ingestion and the wiring can't silently regress to a no-op.
 */
export function deriveLogBackfiller(
  reader: ChainReader | undefined
):
  | {
      getHeadBlock: () => Promise<bigint>;
      listContractLogs: (fromBlock: bigint, toBlock?: bigint | "latest") => Promise<RpcLog[]>;
    }
  | undefined {
  if (
    reader &&
    typeof reader.listContractLogs === "function" &&
    typeof reader.getBlockNumber === "function"
  ) {
    return {
      getHeadBlock: reader.getBlockNumber.bind(reader),
      listContractLogs: reader.listContractLogs.bind(reader)
    };
  }
  return undefined;
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

// Predicate kept for diagnostics/tests: true when a warm DB inherited a recorded reconcile failure
// (lastReconciliationError set, not currently reconciling). The backend no longer auto-runs canonical
// reconcile at startup; recovery is an explicit operator action or event-log replay.
export function shouldRecoverFailedReconciliation(
  snapshot: Pick<IndexerSnapshot, "lastReconciledAt" | "lastReconciliationError" | "reconciliationInProgress">
): boolean {
  return Boolean(snapshot.lastReconciledAt)
    && Boolean(snapshot.lastReconciliationError)
    && !snapshot.reconciliationInProgress;
}

function hasWarmPlanetIndex(indexer: SettlementIndexer | undefined): indexer is SettlementIndexer {
  if (!indexer) return false;
  return indexer.snapshot().indexedPlanets > 0;
}

function hasWarmAllianceIndex(indexer: SettlementIndexer | undefined): indexer is SettlementIndexer {
  if (!indexer) return false;
  return indexer.snapshot().safeToServeAllianceState;
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

function indexedWalletSettlementWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`
): Response | null {
  if (!indexer || !hasWarmPlanetIndex(indexer)) return null;

  const snapshot = indexer.snapshot();
  const settlement = indexedWalletSettlement(indexer, wallet, undefined)?.settlement ?? indexer.walletSettlement(wallet);
  return indexedWarmJsonResponse(withPlayerProfile(settlement, indexer, wallet), "wallet settlement", snapshot);
}

function indexedWalletPlanetsWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`
): Response | null {
  if (!indexer || !hasWarmPlanetIndex(indexer)) return null;

  const snapshot = indexer.snapshot();
  return indexedWarmJsonResponse(withPlayerProfile(indexedWalletPlanets(indexer, wallet), indexer, wallet), "wallet planets", snapshot);
}

function indexedWalletOverviewWarmResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): Response | null {
  if (!indexer || !hasWarmPlanetIndex(indexer)) return null;

  const snapshot = indexer.snapshot();
  const selectedSettlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
  const homeSettlement = selectedSettlement ?? indexedWalletSettlement(indexer, wallet, undefined);
  const settlement = homeSettlement?.settlement ?? indexer.walletSettlement(wallet);
  const queuePlanetId = homeSettlement?.planet?.planetId ?? settlement.homePlanetId;
  const planetsResponse = indexedWalletPlanets(indexer, wallet);
  const queues = indexer.playerQueues(wallet, queuePlanetId);
  const fleetVisibility = indexedFleetVisibility(
    wallet,
    settlement,
    homeSettlement?.planet ?? null,
    indexedWarmDetail("fleet visibility"),
    indexer,
    { includeArchive: false }
  );

  return indexedWarmJsonResponse({
    settlement: withPlayerProfile(settlement, indexer, wallet),
    planetsResponse: withPlayerProfile(planetsResponse, indexer, wallet),
    queues,
    fleetVisibility
  }, "overview snapshot", snapshot);
}

type IndexedMoonNotReadyBody = MoonState & {
  detail: string;
  indexedNotReady: true;
  indexedNotReadyAt: string;
  indexer: ReturnType<SettlementIndexer["snapshot"]> | null;
  source: typeof indexedSource;
  stale: true;
};

type IndexedWarmBuilder<T extends object> = (
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  detail: string,
  indexer: SettlementIndexer
) => T;

async function indexedWalletStateResponse<T extends object>(
  url: URL,
  indexer: SettlementIndexer | undefined,
  surface: string,
  build: IndexedWarmBuilder<T>,
  options: { includeSelectedPlanet?: boolean } = {}
): Promise<Response> {
  const wallet = walletAddressFromPath(url);
  const planetId = options.includeSelectedPlanet === false ? undefined : selectedPlanetId(url);
  const indexed = await indexedWarmResponse(indexer, wallet, planetId, surface, build);
  return indexed ?? indexedReadNotReadyResponse(surface, indexer);
}

function walletAddressFromPath(url: URL): `0x${string}` {
  const wallet = decodeURIComponent(url.pathname.split("/")[2] ?? "");
  assertAddress(wallet);
  return wallet;
}

async function indexedWarmResponse<T extends object>(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined,
  surface: string,
  build: IndexedWarmBuilder<T>
): Promise<Response | null> {
  if (!indexer) return null;

  if (!hasWarmPlanetIndex(indexer)) return null;
  const settlement = indexedWalletSettlement(indexer, wallet, selectedPlanetId);
  if (!settlement?.planet) return null;

  const detail = indexedWarmDetail(surface);
  return indexedWarmJsonResponse(
    build(wallet, settlement.settlement, settlement.planet, detail, indexer),
    surface,
    indexer.snapshot(),
    detail
  );
}

function indexedWarmJsonResponse<T extends object>(
  body: T,
  surface: string,
  snapshot: ReturnType<SettlementIndexer["snapshot"]>,
  detail = indexedWarmDetail(surface)
): Response {
  return indexedJsonResponse({
    ...body,
    detail,
    stale: !snapshot.safeToServeIndexedState
  }, snapshot);
}

function indexedWarmDetail(surface: string): string {
  return `${surface} loaded from DB-indexed contract state.`;
}

function indexedJsonResponse<T extends object>(
  body: T,
  snapshot: ReturnType<SettlementIndexer["snapshot"]>,
  indexState: string = indexedStateLabel(snapshot)
): Response {
  return Response.json({
    ...body,
    indexer: snapshot,
    source: indexedSource
  }, {
    headers: indexedStateHeaders(indexState)
  });
}

function indexedStateLabel(snapshot: ReturnType<SettlementIndexer["snapshot"]>): "healthy" | "stale" {
  return snapshot.safeToServeIndexedState ? "healthy" : "stale";
}

function indexedStateHeaders(indexState: string): HeadersInit {
  return {
    ...corsHeaders,
    "x-veydrift-index-state": indexState
  };
}

function indexedMoonNotReadyResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): Response {
  const homePlanetId = selectedPlanetId?.toString() ?? indexer?.walletSettlement(wallet).homePlanetId ?? null;
  const indexedState = indexer?.moonState(wallet, homePlanetId);
  const detail = indexer
    ? "Moon indexed state is still warming. Refresh shortly."
    : "Moon indexed state is not available from this backend yet. Refresh shortly.";
  const body: IndexedMoonNotReadyBody = {
    wallet,
    homePlanetId,
    moonAvailable: false,
    unavailableReason: detail,
    moon: null,
    buildings: indexedState?.buildings ?? [],
    queue: null,
    detail,
    indexedNotReady: true,
    indexedNotReadyAt: new Date().toISOString(),
    indexer: indexer?.snapshot() ?? null,
    source: indexedSource,
    stale: true
  };

  return Response.json(body, {
    headers: indexedStateHeaders("not-ready")
  });
}

function moonTimedResponse(response: Response, readStartedAt: number): Response {
  const elapsedMs = Date.now() - readStartedAt;
  response.headers.set("x-veydrift-moon-read-ms", String(elapsedMs));
  if (elapsedMs > 500) {
    console.warn("Slow Moon backend read", { elapsedMs });
  }
  return response;
}

function indexedWalletSettlement(
  indexer: SettlementIndexer,
  wallet: `0x${string}`,
  selectedPlanetId: bigint | undefined
): { settlement: ReturnType<SettlementIndexer["walletSettlement"]>; planet: SettledPlanetEvent | null } | null {
  const settlement = indexer.walletSettlement(wallet);
  if (!selectedPlanetId) {
    const planet = settlement.planet;
    return {
      settlement: {
        ...settlement,
        planet: indexedWalletSettlementPlanetState(indexer, planet)
      },
      planet
    };
  }

  const planet = indexer.planet(selectedPlanetId.toString());
  if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) {
    return null;
  }

  return {
    settlement: {
      ...settlement,
      homePlanetId: planet.planetId,
      planet: indexedWalletSettlementPlanetState(indexer, planet)
    },
    planet
  };
}

function indexedWalletSettlementPlanetState(
  indexer: SettlementIndexer,
  planet: SettledPlanetEvent | null
): SettledPlanetEvent | null {
  if (!planet) return null;
  return {
    ...planet,
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet, { allowPendingResources: true }) ?? planet.resources
  };
}

function indexedWalletPlanets(
  indexer: SettlementIndexer,
  wallet: `0x${string}`
): ReturnType<SettlementIndexer["walletPlanets"]> {
  const response = indexer.walletPlanets(wallet);
  return {
    ...response,
    planets: response.planets.map((planet) => indexedWalletPlanetState(indexer, planet))
  };
}

function indexedWalletPlanetState(indexer: SettlementIndexer, planet: ManagedPlanet): ManagedPlanet {
  const buildings = indexer.infrastructureRows(planet.planetId);
  const ships = indexer.shipRows(planet.planetId);
  const defenses = indexer.defenseRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const currentPlanet = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;

  // The planet roster is a settled-snapshot surface: the external contract<->DB watchdog
  // (and any consumer keyed on lastSettledAt) treats `resources` as the value settled at
  // `lastSettledAt`, so it must equal the chain's stored `planet().resources` at a matched
  // settle time. Keep `resources` canonical and expose the production-accrued "as of now"
  // balance separately as `resourcesAsOfNow` — the same split the infrastructure/shipyard/
  // research endpoints already use (VEY-KANEO-464/488). Tactical/raidable still derive from
  // the accrued state because plunderable loot reflects the live balance, not the snapshot.
  return {
    ...planet,
    resourcesAsOfNow: currentPlanet.resources,
    tactical: indexedPlanetTacticalSummary(currentPlanet, buildings, ships, defenses, technologyLevels)
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

// Single current-resource source of truth for wallet, public, and intel resource surfaces (VEY-KANEO-517):
// canonical settled `resources` projected forward to now at the planet's production rate,
// capped at storage. Every endpoint serving "current resources" should call this helper
// instead of re-running `resourcesWithClaimableAccrual` locally, so endpoint values cannot
// diverge or accidentally project an already-current balance a second time.
function indexedCurrentResourcesForPlanet(
  indexer: SettlementIndexer,
  planet: SettledPlanetEvent | null,
  options: { allowPendingResources?: boolean } = {}
): Resources | null {
  return indexedCurrentPlanetState(indexer, planet, options)?.resources ?? null;
}

function indexedCurrentPlanetState<T extends PlanetState>(
  indexer: SettlementIndexer,
  planet: T | null,
  options: { allowPendingResources?: boolean } = {}
): T | null {
  if (!planet) return null;
  if (!options.allowPendingResources && indexer.hasPendingPlanetResources(planet.planetId)) return null;
  return accruedPlanetState(indexer, planet);
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
  indexer: SettlementIndexer,
  options: { includeArchive?: boolean } = {}
): FleetMissionVisibility {
  const visibility = indexer.fleetMissionVisibility(wallet);
  if (options.includeArchive === false) {
    return {
      ...visibility,
      completedMissions: [],
      battleReports: activeMissionBattleReports(visibility)
    };
  }
  return visibility;
}

function activeMissionBattleReports(visibility: FleetMissionVisibility): FleetMissionVisibility["battleReports"] {
  const activeMissionIds = new Set(
    [
      ...visibility.incoming,
      ...visibility.outgoing,
      ...visibility.returning,
      ...visibility.joinableAttacks,
    ].map((mission) => mission.missionId)
  );
  if (activeMissionIds.size === 0) return [];

  return visibility.battleReports.filter((report) =>
    activeMissionIds.has(report.missionId)
      || (report.attackGroupId ? activeMissionIds.has(report.attackGroupId) : false)
      || report.participants.some((participant) => activeMissionIds.has(participant.missionId))
  );
}

function indexedMissionArchive(
  wallet: `0x${string}`,
  url: URL,
  indexer: SettlementIndexer
): FleetMissionArchiveResponse {
  const visibility = indexer.fleetMissionVisibility(wallet);
  const rows = chronologicalMissionArchiveRows(visibility.completedMissions, visibility.battleReports);
  const requested = missionArchivePagination(url);
  const totalEntries = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / requested.pageSize));
  const page = Math.min(requested.page, totalPages);
  const offset = (page - 1) * requested.pageSize;

  return {
    wallet,
    homePlanetId: visibility.homePlanetId,
    rows: rows.slice(offset, offset + requested.pageSize),
    pagination: {
      page,
      pageSize: requested.pageSize,
      totalEntries,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
}

function globalMissionArchive(url: URL, indexer: SettlementIndexer): GlobalMissionArchiveResponse {
  const rows = chronologicalMissionArchiveRows(indexer.allCompletedFleetMissions(), indexer.battleReports());
  const requested = missionArchivePagination(url);
  const totalEntries = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / requested.pageSize));
  const page = Math.min(requested.page, totalPages);
  const offset = (page - 1) * requested.pageSize;

  return {
    rows: rows.slice(offset, offset + requested.pageSize),
    pagination: {
      page,
      pageSize: requested.pageSize,
      totalEntries,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
}

function missionArchivePagination(url: URL): { page: number; pageSize: number } {
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25;
  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), 100)
  };
}

function chronologicalMissionArchiveRows(
  completedMissions: FleetMissionSummary[],
  battleReports: FleetMissionVisibility["battleReports"]
): FleetMissionArchiveEntry[] {
  return [
    ...completedMissions.map((mission): FleetMissionArchiveEntry => ({ kind: "mission", mission })),
    ...battleReports.map((report): FleetMissionArchiveEntry => ({ kind: "battleReport", report })),
  ].sort((left, right) => missionArchiveTimestamp(right) - missionArchiveTimestamp(left));
}

function missionArchiveTimestamp(row: FleetMissionArchiveEntry): number {
  if (row.kind === "battleReport") return Number(row.report.blockNumber || "0");
  const mission = row.mission;
  const rawTimestamp = mission.status === "Returned" ? mission.returnAt : mission.arrivalAt;
  const numericTimestamp = Number(rawTimestamp);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return numericTimestamp > 10_000_000_000 ? numericTimestamp : numericTimestamp * 1_000;
  }
  return Number(mission.blockNumber || "0");
}

function indexedInfrastructureState(
  wallet: `0x${string}`,
  settlement: ReturnType<SettlementIndexer["walletSettlement"]>,
  planet: SettledPlanetEvent | null,
  unavailableReason: string,
  indexer: SettlementIndexer
): InfrastructureState {
  const planetResourcesPending = planet ? indexer.hasPendingPlanetResources(planet.planetId) : false;
  const buildings = planet ? indexer.infrastructureRows(planet.planetId) : [];
  const ships = planet ? indexer.shipRows(planet.planetId) : [];
  const queue = planet ? indexer.planetQueue(planet.planetId, "building") : null;
  const technologyLevels = indexer.technologyLevels(wallet);
  const currentPlanet = indexedCurrentPlanetState(indexer, planet);
  const derived = currentPlanet
    ? deriveInfrastructureFields(currentPlanet, buildings, ships, technologyLevels)
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
    planetLastSettledAt: planetResourcesPending ? null : planet?.lastSettledAt ?? null,
    infrastructureAvailable: !planetResourcesPending,
    unavailableReason: planetResourcesPending
      ? "Infrastructure indexed resources for this planet are still warming. Refresh shortly."
      : unavailableReason,
    resources: planet && !planetResourcesPending ? planet.resources : null,
    resourcesAsOfNow: currentPlanet?.resources ?? null,
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
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    fleetSlots: indexer.fleetSlots(wallet),
    shipyardLevel,
    naniteLevel,
    technologyLevels: indexer.technologyLevels(wallet),
    // Launchable ships only: exclude fleets already away on missions so Mission Compose stops offering
    // phantom ships that revert at launch (VEY-KANEO-447).
    ships: planet ? indexer.availableShipRows(planet.planetId, { shipyardLevel, naniteLevel }) : [],
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
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    shipyardLevel: buildings.find((building) => building.id === 5)?.level ?? 0,
    naniteLevel: buildings.find((building) => building.id === 11)?.level ?? 0,
    missileSiloLevel: buildings.find((building) => building.id === 14)?.level ?? 0,
    technologyLevels: indexer.technologyLevels(wallet),
    defenses: planet
      ? indexer.defenseRows(planet.planetId, {
          shipyardLevel: buildings.find((building) => building.id === 5)?.level ?? 0,
          naniteLevel: buildings.find((building) => building.id === 11)?.level ?? 0
        })
      : [],
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
    resourcesAsOfNow: indexedCurrentResourcesForPlanet(indexer, planet),
    researchLabLevel: buildings.find((building) => building.id === 6)?.level ?? 0,
    researchNetworkLabLevels: [],
    technologyLevels: indexer.technologyLevels(wallet),
    technologies: indexer.technologyRows(wallet, buildings.find((building) => building.id === 6)?.level ?? 0),
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

// The defender side of a battle report: the target planet's current indexed ship/defense
// composition (the surviving force right after a freshly-resolved battle). Only zero-count rows
// are dropped so the frontend can show "None" when the planet had no fleet/defenses. Returns null
// when the target planet is not charted in the indexed read model, in which case the composition
// genuinely cannot be derived and the frontend keeps a precise caveat instead of fabricating data.
function defenderPlanetStateForReport(
  indexer: SettlementIndexer,
  report: ReturnType<SettlementIndexer["battleReport"]>,
  mission: FleetMissionSummary | null
): {
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  stationedDefenders: StationedDefenderSummary[];
} | null {
  if (!report) return null;
  const planet = indexer.planet(report.targetPlanetId);
  if (!planet) return null;
  return {
    fleet: indexer.shipRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0),
    stationedDefenders: indexer.stationedDefendersForBattle(mission, report)
  };
}

function targetCombatIntelForMission(
  indexer: SettlementIndexer,
  mission: FleetMissionSummary
): Pick<RankedHighscorePlanet["tactical"], "combatPower" | "combatShips" | "defenses"> & {
  planetId: string;
  activeMissions: FleetMissionSummary[];
  queues: {
    defense: PlayerQueues["defense"];
    ship: PlayerQueues["ship"];
  };
} | null {
  const planet = indexer.planet(mission.targetPlanetId);
  if (!planet) return null;

  const accrued = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;
  const tactical = indexedPlanetTacticalSummary(
    accrued,
    indexer.infrastructureRows(planet.planetId),
    indexer.shipRows(planet.planetId),
    indexer.defenseRows(planet.planetId),
    indexer.technologyLevels(planet.owner)
  );

  return {
    planetId: planet.planetId,
    activeMissions: indexer.allActiveFleetMissions().filter((entry) => entry.targetPlanetId === planet.planetId),
    combatPower: tactical.combatPower,
    combatShips: tactical.combatShips,
    defenses: tactical.defenses,
    queues: {
      defense: indexer.planetQueue(planet.planetId, "defense"),
      ship: indexer.planetQueue(planet.planetId, "ship")
    }
  };
}

function publicPlanetStateRef(
  planet: SettledPlanetEvent | undefined,
  indexer: SettlementIndexer | undefined
): {
  resources: SettledPlanetEvent["resources"];
  buildings: Array<{ id: number; level: number }>;
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
  stationedDefenders: StationedDefenderSummary[];
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
  const currentPlanet = indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet;

  return {
    resources: currentPlanet.resources,
    buildings: buildings.map(({ id, level }) => ({ id, level })),
    fleet: ships.map(({ id, count }) => ({ id, count })),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })),
    stationedDefenders: indexer.stationedDefendersForPlanet(planet.planetId),
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
  indexer: SettlementIndexer | undefined
): Promise<Map<string, AllianceIdentity>> {
  return allianceIntelForPlayers(planets.map((planet) => planet.owner), indexer);
}

function allianceIntelForPlayers(
  wallets: readonly string[],
  indexer: SettlementIndexer | undefined
): Map<string, AllianceIdentity> {
  if (!indexer || wallets.length === 0) return new Map();
  return indexer.allianceIntelForPlayers(wallets);
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
      source: indexedSource
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

type RankedHighscoreAttackProtection = Pick<AttackProtectionStatus, "allowed" | "blockedReason" | "blockedReasonLabel" | "defenderInactive">;

type RankedHighscorePlanet = {
  planetId: string;
  name: string | null;
  coordinates: {
    galaxy: number;
    system: number;
    position: number;
  };
  archetype: ReturnType<typeof planetArchetypeForTemperature>;
  tactical: {
    raidableResources: Resources;
    raidableResourceTotal: string;
    // Full production-accrued public resources (metal + crystal + deuterium) the planet
    // currently holds — the same figure the public universe/planet surface exposes. LOOT
    // (`raidableResourceTotal`) is the ~50% on-chain plunder of this base, so surfacing the
    // gross total lets the UI show why LOOT reads lower than the planet's full stockpile and
    // stops it from being misread as missing accrual. (VEY-KANEO-454)
    grossResourceTotal: string;
    ships: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    defenses: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    combatShips: {
      count: number;
      power: string;
      units: RankedTacticalUnitBreakdown[];
    };
    combatTechLevels: {
      weapons: number;
      shielding: number;
      armor: number;
    };
    combatPower: string;
  };
};

type RankedTacticalUnitBreakdown = {
  id: number;
  count: number;
  power: string;
};

type HighscoreCategory = keyof ScoreBreakdown;

type HighscoreCurrentPlayerPage = {
  rank: number;
  page: number;
};

type HighscoreRankingsByCategory = Record<HighscoreCategory, HighscoreEntry[]>;

function highscorePagination(url: URL): { page: number; pageSize: number } {
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;
  const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? String(limit), 10) || limit;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), 250)
  };
}

function highscoreRequestedCategories(url: URL): readonly HighscoreCategory[] {
  const requested = url.searchParams.get("category");
  if (!requested) return highscoreCategories;
  return highscoreCategories.includes(requested as HighscoreCategory) ? [requested as HighscoreCategory] : highscoreCategories;
}

function sortedHighscoreRankings(
  entries: HighscoreEntry[],
  categories: readonly HighscoreCategory[] = highscoreCategories
): HighscoreRankingsByCategory {
  const requested = new Set(categories);
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      requested.has(category) ? sortedHighscores(entries, category) : []
    ])
  ) as HighscoreRankingsByCategory;
}

function highscoreVisibleEntries(
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  limit: number,
  offset: number
): HighscoreEntry[] {
  const rows = new Map<string, HighscoreEntry>();
  for (const category of categories) {
    for (const entry of sortedRankings[category].slice(offset, offset + limit)) {
      rows.set(entry.wallet.toLowerCase(), entry);
    }
  }
  return [...rows.values()];
}

function highscoreRankingWallets(entries: readonly HighscoreEntry[], currentWallet: string | null): string[] {
  const wallets = new Set(entries.map((entry) => entry.wallet.toLowerCase()));
  if (currentWallet && /^0x[a-fA-F0-9]{40}$/.test(currentWallet)) {
    wallets.add(currentWallet.toLowerCase());
  }
  return [...wallets];
}

function highscoreCurrentPlayerPages(
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  pageSize: number,
  wallet: string | null
): { wallet: string; rankings: Record<HighscoreCategory, HighscoreCurrentPlayerPage | null> } | undefined {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return undefined;

  const normalizedWallet = wallet.toLowerCase();
  const requested = new Set(categories);
  const rankings = Object.fromEntries(
    highscoreCategories.map((category) => {
      if (!requested.has(category)) return [category, null];
      const index = sortedRankings[category].findIndex((entry) => entry.wallet.toLowerCase() === normalizedWallet);
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
  sortedRankings: HighscoreRankingsByCategory,
  categories: readonly HighscoreCategory[],
  limit: number,
  offset: number,
  rows: Map<string, RankedHighscoreEntry>
): Record<HighscoreCategory, RankedHighscoreEntry[]> {
  const requested = new Set(categories);
  return Object.fromEntries(
    highscoreCategories.map((category) => [
      category,
      requested.has(category) ? rankHighscores(sortedRankings[category], limit, offset, rows) : []
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
  allianceIntel: ReadonlyMap<string, AllianceIdentity> = new Map(),
  indexer?: SettlementIndexer | undefined
): Map<string, RankedHighscoreEntry> {
  return new Map(
    entries.map((entry) => {
      const planets = rankedHighscorePlanets(entry, planetsByOwner, indexer);
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
  sortedEntries: HighscoreEntry[],
  limit: number,
  offset: number,
  rows: ReadonlyMap<string, RankedHighscoreEntry>
): RankedHighscoreEntry[] {
  return sortedEntries.slice(offset, offset + limit)
    .map((entry, index) => {
      const row = rows.get(entry.wallet.toLowerCase())!;
      return {
        ...row,
        rank: offset + index + 1
      };
    });
}

function rankedHighscoreIndexedProtectionLookup(
  rows: Iterable<RankedHighscoreEntry>,
  entries: readonly HighscoreEntry[],
  allianceIntel: ReadonlyMap<string, AllianceIdentity>,
  currentWallet: string | null | undefined,
  includeAttackProtection: boolean,
  indexer?: SettlementIndexer | undefined
): Map<string, RankedHighscoreAttackProtection | null> {
  if (!includeAttackProtection || !currentWallet || !/^0x[a-fA-F0-9]{40}$/.test(currentWallet)) return new Map();

  const normalizedCurrentWallet = currentWallet.toLowerCase();
  const attacker = entries.find((entry) => entry.wallet.toLowerCase() === normalizedCurrentWallet);
  if (!attacker) return new Map();

  const rankedRows = [...rows];
  const statuses = new Map<string, RankedHighscoreAttackProtection | null>();
  // VEY-KANEO-489 follow-up: score-protection must use the contract's _totalUserScore (cached on the
  // leaderboard entry), not the resource-based display total (which made everyone read as a newbie).
  const attackerScore = BigInt(attacker.totalUserScore);
  const attackerAlliance = allianceIntel.get(normalizedCurrentWallet) ?? null;
  // VEY-KANEO-489: the bashing window is per-(attacker, defender, planet), so it is evaluated per planet
  // rather than once per defender row. Alliance/score gates above are defender-level and short-circuit
  // first, matching the contract's precedence (same_alliance -> score_protection -> bashing_limit).
  const launchSecondsByTarget = indexer?.attackLaunchSecondsByTarget(normalizedCurrentWallet as `0x${string}`)
    ?? new Map<string, number[]>();
  const playerActivity = indexer?.playerLastActiveSeconds([...new Set(rankedRows.map((row) => row.wallet))])
    ?? new Map<string, number>();
  const nowSeconds = Math.floor(Date.now() / 1_000);
  for (const row of rankedRows) {
    const defenderInactive = indexedDefenderInactive(playerActivity.get(row.wallet.toLowerCase()), nowSeconds);
    const status = indexedScoreProtectionStatus(
      attackerScore,
      BigInt(row.totalUserScore),
      attackerAlliance,
      normalizedCurrentWallet,
      row,
      defenderInactive
    );
    for (const planet of row.planets) {
      const bashingLimited = status?.allowed
        && !defenderInactive
        && indexedBashingLimitReached(launchSecondsByTarget.get(planet.planetId) ?? [], nowSeconds);
      statuses.set(planet.planetId, bashingLimited
        ? {
            allowed: false,
            blockedReason: "bashing_limit",
            blockedReasonLabel: attackBlockReasonLabel("bashing_limit"),
            defenderInactive
          }
        : status);
    }
  }

  return statuses;
}

function indexedScoreProtectionStatus(
  attackerScore: bigint,
  defenderScore: bigint,
  attackerAlliance: AllianceIdentity | null,
  currentWallet: string,
  row: RankedHighscoreEntry,
  defenderInactive: boolean
): RankedHighscoreAttackProtection | null {
  if (row.wallet.toLowerCase() === currentWallet) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive
    };
  }

  const defenderAlliance = row.alliance ?? null;
  if (
    attackerAlliance
    && defenderAlliance
    && attackerAlliance.allianceId !== "0"
    && attackerAlliance.allianceId === defenderAlliance.allianceId
  ) {
    return {
      allowed: false,
      blockedReason: "same_alliance",
      blockedReasonLabel: attackBlockReasonLabel("same_alliance"),
      defenderInactive
    };
  }

  if (defenderInactive || !isIndexedScoreProtected(attackerScore, defenderScore)) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null,
      defenderInactive
    };
  }

  return {
    allowed: false,
    blockedReason: "score_protection",
    blockedReasonLabel: attackBlockReasonLabel("score_protection"),
    defenderInactive
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

// VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS (24h) / MAX_ATTACKS_PER_BASHING_WINDOW. Mirrored
// here so the indexed attack-protection preview reports bashing_limit the same way the contract gates
// it, without a live attackProtectionStatus read (VEY-KANEO-489).
const BASHING_WINDOW_SECONDS = 86_400;
const MAX_ATTACKS_PER_BASHING_WINDOW = 6;
const PLAYER_INACTIVE_SECONDS = 7 * 24 * 60 * 60;

// Mirror of VeydriftGameStorage._recordAttack + _currentAttackCount + isBashingLimitReached: replay the
// attacker's prior Attack launches against one (defender, planet) in block order to derive the live
// window count, then compare against the cap. The window is anchored at the first launch and re-anchors
// whenever a launch lands >= 24h after the current anchor (matching the contract's reset), and the count
// only stands while now is still inside that 24h window. `launchSeconds` must be ascending.
// The alliance-war bashing bypass is not modelled here because the indexed read model does not track
// war context yet. Callers pass inactive defenders around this helper so the contract's inactivity
// bypass still applies.
function indexedBashingLimitReached(launchSeconds: readonly number[], nowSeconds: number): boolean {
  let windowStartedAt = 0;
  let count = 0;
  for (const launchedAt of launchSeconds) {
    if (windowStartedAt === 0 || launchedAt >= windowStartedAt + BASHING_WINDOW_SECONDS) {
      windowStartedAt = launchedAt;
      count = 1;
    } else {
      count += 1;
    }
  }
  const windowActive = windowStartedAt !== 0 && nowSeconds < windowStartedAt + BASHING_WINDOW_SECONDS;
  const currentCount = windowActive ? count : 0;
  return currentCount >= MAX_ATTACKS_PER_BASHING_WINDOW;
}

function indexedDefenderInactive(lastActiveAt: number | undefined, nowSeconds: number): boolean {
  return lastActiveAt !== undefined
    && lastActiveAt > 0
    && nowSeconds >= lastActiveAt + PLAYER_INACTIVE_SECONDS;
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
  planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>,
  indexer?: SettlementIndexer | undefined
): RankedHighscorePlanet[] {
  const technologyLevels = indexer ? indexer.technologyLevels(entry.wallet) : {};
  return (planetsByOwner.get(entry.wallet.toLowerCase()) ?? []).map((planet) => {
    const ships = indexer?.shipRows(planet.planetId) ?? [];
    const defenses = indexer?.defenseRows(planet.planetId) ?? [];
    const buildings = indexer?.infrastructureRows(planet.planetId) ?? [];
    // Accrue production before computing raidable loot so the Raid Target Finder / Rankings
    // tactical intel matches the resources the public planet read (`GET /planets/{id}`) shows.
    // Without this the snapshot's stored resources under-report LOOT versus the planet's live,
    // accrued public resources. (VEY-KANEO-454)
    const accrued = indexer
      ? indexedCurrentPlanetState(indexer, planet, { allowPendingResources: true }) ?? planet
      : planet;
    const tactical = indexedPlanetTacticalSummary(accrued, buildings, ships, defenses, technologyLevels);

    return {
      planetId: planet.planetId,
      name: planet.name,
      coordinates: {
        galaxy: planet.galaxy,
        system: planet.system,
        position: planet.position
      },
      archetype: planetArchetypeForTemperature(planet.temperature),
      tactical
    };
  });
}

export function indexedPlanetTacticalSummary(
  planet: PlanetState,
  buildings: InfrastructureState["buildings"],
  ships: ShipyardState["ships"],
  defenses: DefenseState["defenses"],
  technologyLevels: Record<string, number>
): RankedHighscorePlanet["tactical"] {
  const fallbackResources = planet.resources ?? { metal: "0", crystal: "0", deuterium: "0" };
  const raidableResources = buildings.length > 0
    ? deriveInfrastructureFields(planet, buildings, ships, technologyLevels).raidableResources ?? fallbackResources
    : fallbackResources;
  const shipSummary = tacticalUnitSummary(ships);
  const defenseSummary = tacticalUnitSummary(defenses);
  // COMBAT is a fighting-strength figure, not an inventory value: non-combat ships
  // (Solar Satellites, cargo, recyclers, colony ships, crawlers) carry a build cost but
  // do not fight, so they are excluded from combat power even though they remain in the
  // ship totals above. This keeps satellite-only / undefended planets reading as soft
  // targets in the Raid Finder and Rankings COMBAT column. (VEY-KANEO-450)
  const combatShipSummary = tacticalUnitSummary(ships.filter((ship) => isCombatShipId(ship.id)));

  return {
    raidableResources,
    raidableResourceTotal: resourceTotal(raidableResources).toString(),
    // `planet` here is already production-accrued (see `accruedPlanetState` at the Finder/
    // Rankings call sites), so its resources match the public universe surface. This is the
    // full stockpile LOOT is plundered from at the ~50% on-chain rate. (VEY-KANEO-454)
    grossResourceTotal: resourceTotal(fallbackResources).toString(),
    ships: {
      ...shipSummary,
      units: tacticalUnitBreakdown(ships),
    },
    defenses: {
      ...defenseSummary,
      units: tacticalUnitBreakdown(defenses),
    },
    combatShips: {
      ...combatShipSummary,
      units: tacticalUnitBreakdown(ships.filter((ship) => isCombatShipId(ship.id))),
    },
    combatTechLevels: {
      weapons: Math.max(0, Math.trunc(technologyLevels["5"] ?? 0)),
      shielding: Math.max(0, Math.trunc(technologyLevels["6"] ?? 0)),
      armor: Math.max(0, Math.trunc(technologyLevels["7"] ?? 0))
    },
    combatPower: (BigInt(combatShipSummary.power) + BigInt(defenseSummary.power)).toString()
  };
}

function tacticalUnitSummary(units: Array<{ count: number; cost?: Resources | null | undefined }>): { count: number; power: string } {
  return units.reduce((summary, unit) => {
    const count = Math.max(0, unit.count);
    return {
      count: summary.count + count,
      power: (BigInt(summary.power) + resourceTotal(unit.cost ?? null) * BigInt(count)).toString()
    };
  }, { count: 0, power: "0" } as { count: number; power: string });
}

function tacticalUnitBreakdown(units: Array<{ id: number; count: number; cost?: Resources | null | undefined }>): RankedTacticalUnitBreakdown[] {
  return units
    .map((unit) => {
      const count = Math.max(0, unit.count);
      return {
        id: unit.id,
        count,
        power: (resourceTotal(unit.cost ?? null) * BigInt(count)).toString()
      };
    })
    .filter((unit) => unit.count > 0);
}

function resourceTotal(resources: Resources | null | undefined): bigint {
  if (!resources) return 0n;
  return safeBigInt(resources.metal) + safeBigInt(resources.crystal) + safeBigInt(resources.deuterium);
}

function safeBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function rankedHighscoreHomePlanet(
  entry: HighscoreEntry,
  planets: readonly RankedHighscorePlanet[]
): RankedHighscorePlanet | null {
  if (!entry.homePlanetId) return null;
  return planets.find((candidate) => candidate.planetId === entry.homePlanetId) ?? null;
}

function indexedReadNotReadyResponse(surface: string, indexer: SettlementIndexer | undefined): Response {
  const snapshot = indexer?.snapshot() ?? null;
  console.warn("Frontend indexed read is not ready", {
    surface,
    indexer: snapshot,
    source: indexedSource
  });

  return Response.json(
    {
      error: "indexed_read_not_ready",
      detail: `${surface} is not available from indexed contract state yet. Refresh shortly.`,
      indexer: snapshot,
      retryable: true,
      source: indexedSource
    },
    {
      headers: indexedStateHeaders(snapshot ? "not-ready" : "unavailable"),
      status: 503
    }
  );
}

function indexedSettlementFundingResponse(
  indexer: SettlementIndexer | undefined,
  config: BackendConfig
): Response {
  // VEY-KANEO-497: frontend API reads must not trigger backend RPC, including the
  // first-planet funding helper. The wallet-specific native ETH balance is left
  // to the wallet/chain at transaction submission time; the start price is served
  // only when operators provide static metadata that matches the deployment.
  if (!hasWarmPlanetIndex(indexer)) {
    return indexedReadNotReadyResponse("settlement funding", indexer);
  }

  const resourceTokensConfigured = Boolean(
    config.resourceTokenAddresses.metal
      && config.resourceTokenAddresses.crystal
      && config.resourceTokenAddresses.deuterium
  );
  const startPriceWei = config.settlementStartPriceWei ?? null;
  return indexedJsonResponse({
    affordable: Boolean(startPriceWei) && resourceTokensConfigured,
    balanceWei: null,
    contractKind: "game",
    startPriceWei,
    ...(resourceTokensConfigured
      ? {}
      : { unavailableReason: "Resource token reserves are not configured for this game deployment yet." }),
    ...(resourceTokensConfigured && !startPriceWei
      ? { unavailableReason: "Settlement start price is not configured for this game deployment yet." }
      : {})
  }, indexer.snapshot());
}

function indexedAllianceResponse(wallet: `0x${string}`, indexer: SettlementIndexer | undefined): Response {
  if (!hasWarmAllianceIndex(indexer)) {
    return indexedReadNotReadyResponse("alliance", indexer);
  }

  const snapshot = indexer.snapshot();
  return indexedJsonResponse(
    {
      ...indexer.allianceState(wallet),
      detail: indexedWarmDetail("Alliance state"),
      stale: !snapshot.safeToServeAllianceState || !snapshot.safeToServeIndexedState
    },
    snapshot,
    snapshot.safeToServeAllianceState
      ? (snapshot.safeToServeIndexedState ? "healthy" : "alliance-healthy")
      : "stale"
  );
}

function indexedAttackProtectionResponse(
  indexer: SettlementIndexer | undefined,
  wallet: `0x${string}`,
  targetPlanetId: bigint
): Response {
  if (!hasWarmPlanetIndex(indexer)) {
    return indexedReadNotReadyResponse("attack protection", indexer);
  }

  const target = indexer.planet(targetPlanetId.toString());
  if (!target) {
    return Response.json(
      {
        error: "target_planet_not_indexed",
        detail: "Attack protection target is not available from indexed contract state yet.",
        source: indexedSource
      },
      {
        headers: indexedStateHeaders("not-ready"),
        status: 404
      }
    );
  }

  const planetsByOwner = indexer.settledPlanetsByOwner();
  const attacker = indexer.highscoreForWallet(wallet, (planetsByOwner.get(wallet.toLowerCase()) ?? []).map((planet) => planet.planetId));
  const defender = indexer.highscoreForWallet(target.owner, (planetsByOwner.get(target.owner.toLowerCase()) ?? []).map((planet) => planet.planetId));
  const attackerScore = BigInt(attacker.score.total);
  const defenderScore = BigInt(defender.score.total);
  // VEY-KANEO-489 follow-up: the score-protection gate must use the contract's _totalUserScore
  // (HighscoreEntry.totalUserScore), NOT the resource-based display total above. The display total is
  // on a ~hundreds scale, so against the contract's 50k/500k thresholds every player read as a newbie
  // and the UI false-flagged score_protection. relation label keeps the display total.
  const attackerProtectionScore = BigInt(attacker.totalUserScore);
  const defenderProtectionScore = BigInt(defender.totalUserScore);
  const attackerKey = wallet.toLowerCase();
  const defenderKey = target.owner.toLowerCase();
  // VEY-KANEO-489: model the contract's same_alliance gate, the HIGHEST-precedence reason in
  // VeydriftGameStorage._attackProtectionStatus (SameAlliance -> ScoreProtection -> BashingLimit).
  // Without it this single-target endpoint never returned `same_alliance`, so the frontend — which
  // derives ally targets solely from this signal (galaxyActions.ts: isAllyTarget = blockedReason ===
  // "same_alliance") — left the attack button enabled for allies and the launch reverted on-chain.
  // allianceIntelForPlayers only returns members of *active* alliances, so a missing entry means "no
  // alliance"; self-targets (attacker == owner) are never treated as same-alliance.
  const allianceIntel = indexer.allianceIntelForPlayers([attackerKey, defenderKey]);
  const attackerAlliance = allianceIntel.get(attackerKey) ?? null;
  const defenderAlliance = allianceIntel.get(defenderKey) ?? null;
  const defenderInactive = indexedDefenderInactive(
    indexer.playerLastActiveSeconds([defenderKey]).get(defenderKey),
    Math.floor(Date.now() / 1_000)
  );
  const sameAlliance = attackerKey !== defenderKey
    && attackerAlliance !== null
    && defenderAlliance !== null
    && attackerAlliance.allianceId !== "0"
    && attackerAlliance.allianceId === defenderAlliance.allianceId;
  // VEY-KANEO-489: use the contract-faithful newbie/score-ratio gate (VeydriftAntiRaidPrimitives.
  // isScoreProtected) instead of a naive 5x-score heuristic. The old heuristic false-blocked any two
  // players whose scores differed >5x — including two veterans both past the newbie-protection ceiling,
  // who the contract never score-protects (both ratios are 0). Kept raw (not gated by sameAlliance) so
  // plunderBps below still reflects the score-protection state.
  const scoreProtected = !defenderInactive
    && isIndexedScoreProtected(attackerProtectionScore, defenderProtectionScore);
  // VEY-KANEO-489: also replay the per-(attacker, planet) bashing window the contract enforces. Self
  // attacks are rejected upstream by the contract and carry no window; a self-target read just returns
  // an empty launch history. same_alliance and score protection are checked first to match the
  // contract's precedence (VeydriftGameStorage._attackProtectionStatus: SameAlliance -> ScoreProtection
  // -> BashingLimit); skipping the launch-log replay when either short-circuits avoids needless work.
  const bashingLimited = !sameAlliance
    && !scoreProtected
    && !defenderInactive
    && wallet.toLowerCase() !== target.owner.toLowerCase()
    && indexedBashingLimitReached(
      indexer.attackLaunchSecondsByTarget(wallet).get(targetPlanetId.toString()) ?? [],
      Math.floor(Date.now() / 1_000)
    );
  const blockedReason: AttackBlockReason = sameAlliance
    ? "same_alliance"
    : scoreProtected
      ? "score_protection"
      : bashingLimited
        ? "bashing_limit"
        : "none";

  const body: AttackProtectionStatus & {
    source: typeof indexedSource;
  } = {
    wallet,
    targetPlanetId: targetPlanetId.toString(),
    allowed: blockedReason === "none",
    blockedReason,
    blockedReasonLabel: blockedReason === "none" ? null : attackBlockReasonLabel(blockedReason),
    relation: defenderScore > attackerScore ? "stronger" : defenderScore < attackerScore ? "weaker" : "peer",
    defenderHonorStatus: "neutral",
    plunderBps: scoreProtected ? 0 : 5000,
    defenderInactive,
    source: indexedSource
  };

  return Response.json(body, {
    headers: indexedStateHeaders(indexedStateLabel(indexer.snapshot()))
  });
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

function reasonText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
