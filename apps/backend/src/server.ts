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
import { RandomnessCommitterService } from "./randomnessCommitter";
import {
  validatePlayerDisplayName,
  verifyPlayerDisplayNameSignature,
  type PlayerProfile
} from "./playerProfiles";
import { deriveInfrastructureFields, isCombatShipId } from "./readModels";
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
  missionResolver?: MissionResolutionService;
  randomnessCommitter?: RandomnessCommitterService;
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
  const indexer =
    dependencies.indexer ??
    (isIndexableChainReader(indexerChainReader) ? new SettlementIndexer(indexerChainReader, loaded.config.indexFromBlock, {
      databasePath: loaded.config.indexDbPath
    }) : undefined);
  const logBackfiller = deriveLogBackfiller(indexerChainReader);
  const chainSync =
    dependencies.chainSync ??
    (loaded.problems.length === 0
      ? new ChainSyncService(loaded.config, indexer, logBackfiller ? { logBackfiller } : {})
      : undefined);
  const resolutionReader = rawChainReader?.listResolvableFleetMissions
    ? {
        listResolvableFleetMissions: rawChainReader.listResolvableFleetMissions.bind(rawChainReader),
        ...(rawChainReader.listReturnableFleetMissions
          ? { listReturnableFleetMissions: rawChainReader.listReturnableFleetMissions.bind(rawChainReader) }
          : {})
      }
    : undefined;
  const missionResolver =
    dependencies.missionResolver ??
    (loaded.problems.length === 0 && resolutionReader
      ? new MissionResolutionService(loaded.config, resolutionReader)
      : undefined);

  const randomnessCommitter =
    dependencies.randomnessCommitter ??
    (loaded.problems.length === 0 ? new RandomnessCommitterService(loaded.config) : undefined);

  chainSync?.start();
  missionResolver?.start();
  randomnessCommitter?.start();
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
        return indexedSettlementFundingUnavailableResponse(indexer);
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
            // The defender's surviving fleet/defenses are not in the on-chain combat log, but the
            // indexer tracks the target planet's ship/defense composition (ShipCountChanged + defense
            // events), so the battle report can show real composition instead of a blanket caveat.
            // Null when the target planet is not charted in the indexed read model.
            defenderPlanetState: defenderPlanetStateForReport(indexer, battleReport),
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
          planetsByOwner = indexer.settledPlanetsByOwner();
          entries = indexer.highscoreEntriesForOwners(planetsByOwner);
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
          highscoreAttackProtectionRequested(url)
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
        return Response.json(accruedPlanetState(indexer, indexer.planet(planetId.toString())), {
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

/**
 * Build the incremental log backfiller the chain-sync self-heal and gap recovery depend on.
 * Returns undefined only when the reader cannot list raw contract logs; the production
 * reader (VeydriftGameReader) exposes a public `listContractLogs`, so self-heal is wired
 * by default. Exported so a test can assert production construction enables self-heal and
 * the wiring can't silently regress to a no-op.
 */
export function deriveLogBackfiller(
  reader: ChainReader | undefined
): { listContractLogs: (fromBlock: bigint, toBlock?: bigint | "latest") => Promise<RpcLog[]> } | undefined {
  if (reader && typeof reader.listContractLogs === "function") {
    return { listContractLogs: reader.listContractLogs.bind(reader) };
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
    planets: response.planets.map((planet) => indexedWalletPlanetState(indexer, planet))
  };
}

function indexedWalletPlanetState(indexer: SettlementIndexer, planet: ManagedPlanet): ManagedPlanet {
  const buildings = indexer.infrastructureRows(planet.planetId);
  const ships = indexer.shipRows(planet.planetId);
  const defenses = indexer.defenseRows(planet.planetId);
  const technologyLevels = indexer.technologyLevels(planet.owner);
  const accrued = accruedPlanetState(indexer, planet);

  return {
    ...accrued,
    tactical: indexedPlanetTacticalSummary(accrued, buildings, ships, defenses, technologyLevels)
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
      battleReports: []
    };
  }
  return visibility;
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
  const derived = planet && !planetResourcesPending
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
    planetLastSettledAt: planetResourcesPending ? null : planet?.lastSettledAt ?? null,
    infrastructureAvailable: !planetResourcesPending,
    unavailableReason: planetResourcesPending
      ? "Infrastructure indexed resources for this planet are still warming. Refresh shortly."
      : unavailableReason,
    resources: planet && !planetResourcesPending ? planet.resources : null,
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
    // Launchable ships only: exclude fleets already away on missions so Mission Compose stops offering
    // phantom ships that revert at launch (VEY-KANEO-447).
    ships: planet ? indexer.availableShipRows(planet.planetId) : [],
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

// The defender side of a battle report: the target planet's current indexed ship/defense
// composition (the surviving force right after a freshly-resolved battle). Only zero-count rows
// are dropped so the frontend can show "None" when the planet had no fleet/defenses. Returns null
// when the target planet is not charted in the indexed read model, in which case the composition
// genuinely cannot be derived and the frontend keeps a precise caveat instead of fabricating data.
function defenderPlanetStateForReport(
  indexer: SettlementIndexer,
  report: ReturnType<SettlementIndexer["battleReport"]>
): { fleet: Array<{ id: number; count: number }>; defenses: Array<{ id: number; count: number }> } | null {
  if (!report) return null;
  const planet = indexer.planet(report.targetPlanetId);
  if (!planet) return null;
  return {
    fleet: indexer.shipRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0),
    defenses: indexer.defenseRows(planet.planetId).map(({ id, count }) => ({ id, count })).filter((row) => row.count > 0)
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
  tactical: {
    raidableResources: Resources;
    raidableResourceTotal: string;
    ships: {
      count: number;
      power: string;
    };
    defenses: {
      count: number;
      power: string;
    };
    combatPower: string;
  };
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
  includeAttackProtection: boolean
): Map<string, RankedHighscoreAttackProtection | null> {
  if (!includeAttackProtection || !currentWallet || !/^0x[a-fA-F0-9]{40}$/.test(currentWallet)) return new Map();

  const normalizedCurrentWallet = currentWallet.toLowerCase();
  const attacker = entries.find((entry) => entry.wallet.toLowerCase() === normalizedCurrentWallet);
  if (!attacker) return new Map();

  const statuses = new Map<string, RankedHighscoreAttackProtection | null>();
  const attackerScore = BigInt(attacker.score.total);
  const attackerAlliance = allianceIntel.get(normalizedCurrentWallet) ?? null;
  for (const row of rows) {
    const status = indexedScoreProtectionStatus(
      attackerScore,
      BigInt(row.score.total),
      attackerAlliance,
      normalizedCurrentWallet,
      row
    );
    for (const planet of row.planets) {
      statuses.set(planet.planetId, status);
    }
  }

  return statuses;
}

function indexedScoreProtectionStatus(
  attackerScore: bigint,
  defenderScore: bigint,
  attackerAlliance: AllianceIdentity | null,
  currentWallet: string,
  row: RankedHighscoreEntry
): RankedHighscoreAttackProtection | null {
  if (row.wallet.toLowerCase() === currentWallet) {
    return {
      allowed: true,
      blockedReason: "none",
      blockedReasonLabel: null
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
      blockedReasonLabel: attackBlockReasonLabel("same_alliance")
    };
  }

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
    const tactical = indexedPlanetTacticalSummary(planet, buildings, ships, defenses, technologyLevels);

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
  // The COMBAT metric is a fighting-strength proxy, so non-combat ships (Solar
  // Satellites, Crawlers) must not contribute their build cost to it. (VEY-KANEO-450)
  const combatShips = ships.filter((ship) => isCombatShipId(ship.id));
  const shipSummary = tacticalUnitSummary(combatShips);
  const defenseSummary = tacticalUnitSummary(defenses);

  return {
    raidableResources,
    raidableResourceTotal: resourceTotal(raidableResources).toString(),
    ships: shipSummary,
    defenses: defenseSummary,
    combatPower: (BigInt(shipSummary.power) + BigInt(defenseSummary.power)).toString()
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

function indexedSettlementFundingUnavailableResponse(indexer: SettlementIndexer | undefined): Response {
  const snapshot = indexer?.snapshot() ?? null;
  console.warn("Frontend indexed read is not ready", {
    surface: "settlement funding",
    indexer: snapshot,
    source: indexedSource
  });

  return Response.json(
    {
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: null,
      unavailableReason: "Settlement funding requires indexed funding state.",
      indexer: snapshot,
      source: indexedSource,
      stale: true
    },
    {
      headers: indexedStateHeaders(snapshot ? "not-ready" : "unavailable")
    }
  );
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
  const scoreProtected = attackerScore > 0n && (defenderScore < attackerScore / 5n || defenderScore > attackerScore * 5n);

  const body: AttackProtectionStatus & {
    source: typeof indexedSource;
  } = {
    wallet,
    targetPlanetId: targetPlanetId.toString(),
    allowed: !scoreProtected,
    blockedReason: scoreProtected ? "score_protection" : "none",
    blockedReasonLabel: scoreProtected ? attackBlockReasonLabel("score_protection") : null,
    relation: defenderScore > attackerScore ? "stronger" : defenderScore < attackerScore ? "weaker" : "peer",
    defenderHonorStatus: "neutral",
    plunderBps: scoreProtected ? 0 : 5000,
    defenderInactive: false,
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
