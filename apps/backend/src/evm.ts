import { solarSatelliteEnergy } from "@veydrift/universe";
import { encodeAbiParameters, keccak256 } from "viem";
import type { BackendConfig } from "./config";
import { calculateHighscore, type HighscoreEntry } from "./highscores";
import { deriveDefenseRows, deriveShipRows, usedFieldsFromBuildingRows } from "./readModels";
import type { Coordinates, PlanetArchetype } from "./universe";
import { planetMetadata, planetMultipliers } from "./universe";

export type Address = `0x${string}`;

export type Resources = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export type ResourceSnapshotMetadata = {
  planetId: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  lastSettledAt: string | null;
  resources: Resources | null;
};

export type OrbitBodyKind = "planet" | "moon";

export type EnergyBalance = {
  produced: string;
  required: string;
  scaleBps: string;
  sources?: {
    solarPlant: string;
    fusionReactor: string;
    fusionReactorDeuteriumConsumed: string;
    solarSatellites: string;
    solarSatelliteCount: number;
    solarSatelliteEnergy: string;
  };
};

export type PlanetState = Coordinates & {
  planetId: string;
  owner: Address;
  name: string | null;
  fields: number;
  temperature: number;
  metalMultiplierBps: number;
  crystalMultiplierBps: number;
  deuteriumMultiplierBps: number;
  lastSettledAt: string;
  resources: Resources;
  // Live, settled-to-now balance (canonical `resources` projected forward at the
  // production rate, capped at storage — the chain's `previewResources`). Optional
  // because the canonical settled snapshot is the load-bearing value; serializers
  // that expose a live balance populate it alongside `resources` rather than
  // overwriting the settled snapshot (VEY-KANEO-488).
  resourcesAsOfNow?: Resources;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
};

export type ManagedPlanet = PlanetState & {
  bodyKind: "planet";
  coordinates: string;
  isHomePlanet: boolean;
  fieldsUsed: number;
  fieldsCapacity: number;
  keyLevels: {
    metalMine: number;
    crystalMine: number;
    deuteriumSynthesizer: number;
    solarPlant: number;
    roboticsFactory: number;
    shipyard: number;
    researchLab: number;
    terraformer: number;
  };
  queues: {
    building: QueueState | null;
    defense: QueueState | null;
    ship: QueueState | null;
  };
  moon: {
    bodyKind: "moon";
    exists: boolean;
    parentPlanetId: string;
    planetId: string;
    coordinates: string;
    resources: Resources;
    resourcesAsOfNow?: Resources;
    ships: ShipyardState["ships"];
    defenses: DefenseState["defenses"];
  } | null;
  tactical?: {
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
  } | undefined;
};

export type WalletPlanets = {
  wallet: Address;
  homePlanetId: string | null;
  queues?: {
    research: QueueState | null;
  };
  planets: ManagedPlanet[];
};

export type CanonicalPlanetChainState = {
  planetId: string;
  resources: Resources;
  buildings: InfrastructureState["buildings"];
  defenses: DefenseState["defenses"];
  ships: ShipyardState["ships"];
  queues: Pick<PlayerQueues, "building" | "defense" | "ship">;
};

export type WalletSettlement = {
  wallet: Address;
  hasFirstPlanet: boolean;
  homePlanetId: string | null;
  planet: PlanetState | null;
  contractKind?: "game" | "settlement";
};

export type SettlementFundingState = {
  affordable: boolean;
  balanceWei: string | null;
  contractKind: "game" | "legacy";
  startPriceWei: string | null;
  unavailableReason?: string;
};

// Derived as-of-now state shapes (VEY-KANEO-464). Defined here next to the
// canonical read-model types they augment; the derivation logic lives in
// ./asOfNow.
export type QueueAsOfNow = {
  // Whole seconds until the active item finishes; 0 once it is due (or unknown).
  secondsRemaining: number;
  // Whether the active item is due as of now (its `readyAt` has passed).
  complete: boolean;
};

export type MissionAsOfNow = {
  // Whole seconds until the fleet reaches its target; 0 once it has arrived.
  secondsUntilArrival: number;
  // Whole seconds until the fleet is back at its origin; 0 once it has returned.
  secondsUntilReturn: number;
  // Whether the outbound leg's arrival time has passed as of now. An arrived but
  // still-`Outbound` mission is one awaiting resolution (see `needsResolution`).
  arrived: boolean;
  // Whether the return leg's arrival time has passed as of now.
  returned: boolean;
};

export type QueueState = {
  active: boolean;
  kind: string | null;
  itemId?: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string | null;
  startedAt?: string | null;
  cost: Resources;
  backlog?: QueueState[];
  // Derived as-of-now state (VEY-KANEO-464): seconds left / whether the active
  // item is due, computed server-side at request time from `readyAt`. Optional so
  // persisted/event-derived queue rows stay valid; the read-model getters always
  // populate it before serving.
  asOfNow?: QueueAsOfNow;
};

export type PlayerQueues = {
  wallet: Address;
  homePlanetId: string | null;
  building: QueueState | null;
  defense: QueueState | null;
  ship: QueueState | null;
  research: QueueState | null;
};

export type IndexedQueueStartedEvent = {
  eventName: "BuildingStarted" | "DefenseQueued" | "ShipQueued" | "ResearchQueued" | "MoonBuildingStarted" | "MoonDefenseQueued";
  transactionHash: string;
  blockNumber: string;
  queueKind: "building" | "defense" | "ship" | "research" | "moon-building" | "moon-defense";
  planetId?: string;
  owner?: Address;
  itemId: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string;
  startedAt?: string;
  cost: Resources;
};

export type IndexedQueueCompletedEvent = {
  eventName: "BuildingCompleted" | "DefenseCompleted" | "ShipCompleted" | "ResearchCompleted" | "MoonBuildingCompleted" | "MoonDefenseCompleted";
  transactionHash: string;
  blockNumber: string;
  queueKind: "building" | "defense" | "ship" | "research" | "moon-building" | "moon-defense";
  planetId?: string;
  owner?: Address;
  itemId: number;
  level?: number;
  quantity?: number;
  total?: number;
};

export type IndexedMoonCreatedEvent = {
  eventName: "MoonCreated";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  galaxy: number;
  system: number;
  position: number;
  fields: number;
  diameterKm: number;
  createdAt: string;
  jumpGateReadyAt?: string;
};

export type IndexedMoonJumpGateEvent = {
  eventName: "JumpGateJumped";
  transactionHash: string;
  blockNumber: string;
  player: Address;
  originMoonPlanetId: string;
  destinationMoonPlanetId: string;
  nextReadyAt: string;
};

export type IndexedRiftResourceEvent = {
  eventName: "MarketResourceDeposited" | "MarketResourceWithdrawalRequested" | "MarketResourceWithdrawalFinished";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  resourceId: number;
  amount: string;
  unlocksAt?: string;
};

export type IndexedShipCountChangedEvent = {
  eventName: "PlanetShipCountChanged" | "MoonShipCountChanged";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  shipId: number;
  total: number;
};

export type IndexedMoonResourcesChangedEvent = {
  eventName: "MoonResourcesChanged";
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  planetId: string;
  resources: Resources;
};

export type IndexedDefenseCountChangedEvent = {
  eventName: "PlanetDefenseCountChanged";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  defenseId: number;
  total: number;
};

export type IndexedMoonShipCountChangedEvent = {
  eventName: "MoonShipCountChanged";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  shipId: number;
  total: number;
};

export type IndexedMoonDefenseCountChangedEvent = {
  eventName: "MoonDefenseCountChanged";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  defenseId: number;
  total: number;
};

export type InterplanetaryMissileAttackEvent = {
  eventName: "InterplanetaryMissileAttack";
  transactionHash: string;
  blockNumber: string;
  attacker: Address;
  originPlanetId: string;
  targetPlanetId: string;
  primaryTargetDefenseId: number;
  launched: number;
  intercepted: number;
  hits: number;
  destroyedPrimary: number;
};

export type IndexedAllianceEvent =
  | {
      eventName: "AllianceCreated";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      owner: Address;
      tag: string;
      name: string;
      createdAt: string;
    }
  | {
      eventName: "AllianceProfileUpdated";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      tag: string;
      name: string;
      description: string;
    }
  | {
      eventName: "AllianceInviteCreated";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      inviter: Address;
      player: Address;
      invitedAt: string;
    }
  | {
      eventName: "AllianceInviteCancelled" | "AllianceJoinRequestCancelled";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      player: Address;
    }
  | {
      eventName: "AllianceJoinRequested";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      requester: Address;
      requestedAt: string;
    }
  | {
      eventName: "AllianceJoinRequestDismissed" | "AllianceJoinRequestApproved";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      manager: Address;
      requester: Address;
    }
  | {
      eventName: "AllianceJoined";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      player: Address;
      role: AllianceRoleName;
      roleId: number;
      joinedAt: string;
    }
  | {
      eventName: "AllianceLeft";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      player: Address;
    }
  | {
      eventName: "AllianceRoleUpdated";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      player: Address;
      role: AllianceRoleName;
      roleId: number;
    }
  | {
      eventName: "AllianceOwnershipTransferred";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      previousOwner: Address;
      newOwner: Address;
    }
  | {
      eventName: "AllianceDiplomacyUpdated";
      transactionHash: string;
      blockNumber: string;
      allianceId: string;
      otherAllianceId: string;
      statusId: number;
    };

export type FleetMissionVisibility = {
  wallet: Address;
  homePlanetId: string | null;
  incoming: FleetMissionSummary[];
  outgoing: FleetMissionSummary[];
  returning: FleetMissionSummary[];
  joinableAttacks: FleetMissionSummary[];
  completedMissions: FleetMissionSummary[];
  battleReports: BattleReport[];
};

export type FleetMissionArchiveEntry =
  | { kind: "mission"; mission: FleetMissionSummary; report?: BattleReport | undefined }
  | { kind: "battleReport"; report: BattleReport };

export type FleetMissionArchiveResponse = {
  wallet: Address;
  homePlanetId: string | null;
  rows: FleetMissionArchiveEntry[];
  pagination: {
    page: number;
    pageSize: number;
    totalEntries: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

// Universe-wide (no wallet scope) active missions feed for the Mission Control "All" tab.
export type GlobalActiveMissionsResponse = {
  missions: FleetMissionSummary[];
};

// Universe-wide completed mission archive for the Mission Control past "All" tab. Mirrors the
// per-wallet archive pagination contract but carries no wallet scope.
export type GlobalMissionArchiveResponse = {
  rows: FleetMissionArchiveEntry[];
  pagination: FleetMissionArchiveResponse["pagination"];
};

// VEY-KANEO-456/498: a single allied fleet stationed to defend a planet. Reactive AcsDefend rows are
// resolved from an attack's `counterplayDefenderMissionIds`; proactive DefenseHold rows are resolved
// from their target planet and `defenseHoldUntil` window. Both are public chain state, so the read model
// surfaces the compact composition public intel needs without a live chain read.
export type StationedDefenderSummary = {
  missionId: string;
  defender: Address;
  defenderDisplayName: string | null;
  ships: Record<string, string>;
  holdUntil: string;
  allianceDepotLevel: number;
};

export type FleetMissionSummary = {
  missionId: string;
  status: string;
  missionType: string;
  owner: Address;
  originPlanetId: string;
  targetPlanetId: string;
  originIsMoon?: boolean;
  targetIsMoon?: boolean;
  originPlanet?: FleetMissionPlanetReference | null;
  targetPlanet?: FleetMissionPlanetReference | null;
  arrivalAt: string;
  returnAt: string;
  fuelCost: string;
  recallCost: string | null;
  attackGroupId: string | null;
  joinedAttackMissionIds: string[];
  // VEY-KANEO-442: ACS Defend stationed-defense links. For an AcsDefend mission, `defendsMissionId`
  // is the hostile attack mission it stations to defend against; that attack's target planet is this
  // mission's `targetPlanetId`. On the attack mission, `counterplayDefenderMissionIds` lists every
  // AcsDefend fleet stationed to defend it, so the read model can serve "who is defending attack X"
  // and (filtering AcsDefend missions by targetPlanetId) "stationed defenders at planet Y".
  defendsMissionId: string | null;
  counterplayDefenderMissionIds: string[];
  // VEY-KANEO-456: present only on an incoming hostile attack in a wallet's visibility feed. The read
  // model resolves `counterplayDefenderMissionIds` into the allied fleets currently stationed to defend
  // it, after lazy as-of-now reconciliation (defenders whose hold has elapsed or whose mission left
  // Outbound are dropped). Absent on raw decoded summaries; the Stationed defenses panel renders from it.
  stationedDefenders?: StationedDefenderSummary[];
  cargo: Resources;
  // Resulting return-leg cargo from FleetMissionReturnExposed (the contract folds looted resources
  // into mission.cargo before emitting it). Kept separate from `cargo` (which stays the authoritative
  // outbound launch value, VEY-404) so the ACS battle report can surface each joiner's loot share.
  // Null until the fleet's return leg is exposed (e.g. still outbound, or fully wiped at the target).
  returnCargo: Resources | null;
  ships: Record<string, string>;
  transactionHash: string;
  blockNumber: string;
  // Block of the FleetMissionLaunched event specifically, i.e. when the contract debited these ships
  // from the origin planet (VeydriftGameplayModule._debitMissionShips). `blockNumber` tracks the LAST
  // event for the mission (recall/resolve/return) and so drifts forward over the fleet's life; the
  // ship-count read model needs the immutable launch block to tell whether a still-away fleet's debit
  // has already been absorbed by the canonical reconcile baseline (VEY-KANEO-447). Defaults to "0" for
  // missions reconstructed without a launch event.
  launchBlockNumber: string;
  needsResolution: boolean;
  // VEY-KANEO-479: the RandomnessEngine request id an Attack battle consumes at resolution, captured
  // from FleetMissionLaunched word 4 (VeydriftGameplayModule._requestAttackBattleRandomness). Present
  // and non-zero only for Attack missions; "0"/undefined for every other type (Harvest and the rest
  // carry no battle randomness). The read model gates `needsResolution` on this request being
  // fulfilled so Mission Control never shows a phantom "Ready to resolve" before the keeper can settle.
  randomnessRequestId?: string;
  // Arrived combat can be blocked by missing external randomness. Keep the canonical status intact,
  // but surface why the mission is not actually resolvable/reportable.
  resolutionBlocker?: "randomness_pending";
  resolutionBlockerDetail?: string;
  // VEY-KANEO-498: DefenseHold-specific hold expiry from DefenseHoldStationed. A DefenseHold can defend
  // attacks whose arrival is inside [arrivalAt, defenseHoldUntil]; returnAt includes the flight home and
  // is therefore too broad for public attack-risk intel.
  defenseHoldUntil?: string;
  // Derived as-of-now state (VEY-KANEO-464): arrival/return ETA in seconds and
  // whether each leg is due, computed server-side at request time from
  // `arrivalAt` / `returnAt`. Optional so internally-constructed summaries stay
  // valid; the read model populates it before serving on every mission endpoint.
  asOfNow?: MissionAsOfNow;
};

export type CanonicalFleetMissionSnapshot = {
  missionId: string;
  statusId: number;
  missionTypeId: number;
  status: string;
  missionType: string;
  owner: Address;
  originPlanetId: string;
  targetPlanetId: string;
  departureAt: string;
  arrivalAt: string;
  returnAt: string;
  fuelCost: string;
  cargo: Resources;
  randomnessRequestId: string | null;
};

export type CanonicalFleetMissionDetails = CanonicalFleetMissionSnapshot & {
  ships: Record<string, string>;
  originIsMoon: boolean;
  targetIsMoon: boolean;
};

type FleetMissionSupplement = {
  ships: Record<string, string>;
  originIsMoon: boolean;
  targetIsMoon: boolean;
};

export type FleetMissionPlanetReference = {
  planetId: string;
  owner: Address;
  ownerDisplayName?: string | null;
  name: string | null;
  galaxy: number;
  system: number;
  position: number;
  coordinates: string;
  hasMoon?: boolean | undefined;
  // Real planet archetype (derived from the indexed temperature) so Mission Control can render the
  // same planet art the Galaxy view uses for thumbnails (VEY-403 / VEY-67), not a generic icon.
  archetype: PlanetArchetype;
  // VEY-KANEO-440: Alliance Depot building level (id 13). On a hostile attack's target planet this is
  // the depot that subsidizes ACS Defend holding fuel, letting the compose UX preview depot support.
  allianceDepotLevel: number;
};

export type ResolvableFleetMission = Pick<
  FleetMissionSummary,
  "arrivalAt" | "missionId" | "missionType" | "originPlanetId" | "targetPlanetId"
>;

export type ReturnableFleetMission = Pick<
  FleetMissionSummary,
  "missionId" | "missionType" | "originPlanetId" | "returnAt" | "targetPlanetId"
>;

export type BattleOutcomeName = "Draw" | "AttackerWin" | "DefenderWin";

export type CombatRoundReport = {
  round: number;
  attackerUnits: string;
  defenderUnits: string;
  attackerLosses: Resources;
  defenderLosses: Resources;
};

// One member of an ACS (Alliance Combat System) attack group: the main attacker plus any fleets that
// joined the same attack. `loot` is the resources this fleet personally hauled away — `report.loot`
// (the AttackBattleResolved snapshot) for the main attacker, and the joiner's resulting return-leg
// cargo for each joined fleet. Per-participant losses are not emitted on-chain (CombatLosses is a
// single combined figure keyed by the main mission), so only loot is broken out per participant.
export type BattleReportParticipant = {
  missionId: string;
  address: Address;
  isMainAttacker: boolean;
  ships: Record<string, string>;
  loot: Resources;
};

export type BattleReportDefenderSnapshot = {
  fleet: Array<{ id: number; count: number }>;
  defenses: Array<{ id: number; count: number }>;
};

export type BattleReport = {
  missionId: string;
  attacker: Address;
  targetPlanetId: string;
  originIsMoon?: boolean;
  targetIsMoon?: boolean;
  outcome: BattleOutcomeName;
  rounds: number;
  randomSeed: string;
  loot: Resources;
  attackerLosses: Resources;
  defenderLosses: Resources;
  debris: {
    metal: string;
    crystal: string;
  };
  roundReports: CombatRoundReport[];
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  defenderSnapshot: BattleReportDefenderSnapshot | null;
  // ACS attack group: the main attack mission id for a grouped attack (null for a solo attack), and
  // every participant (main attacker + joiners) with their individual loot share. A solo attack still
  // populates `participants` with the single main attacker so the frontend can render uniformly.
  attackGroupId: string | null;
  participants: BattleReportParticipant[];
};

export type ShipyardState = {
  wallet: Address;
  homePlanetId: string | null;
  planetId: string | null;
  productionAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  // Canonical `resources` projected forward to now at the planet's production rate
  // (capped at storage), so callers get accrued resources without re-deriving them
  // (VEY-KANEO-464). Null when the planet/derivation is unavailable.
  resourcesAsOfNow?: Resources | null;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
  fleetSlots: {
    active: number;
    limit: number;
  };
  fleetLaunchAvailable?: boolean;
  fleetLaunchUnavailableReason?: string;
  stale?: boolean;
  shipyardLevel: number;
  naniteLevel: number;
  technologyLevels: Record<string, number>;
  ships: Array<{
    id: number;
    count: number;
    cost: Resources;
    energyPerUnit?: string;
    // Predicted per-unit build time for the next batch (VEY-KANEO-472); present on the
    // Shipyard detail payload, omitted on count-only projections.
    durationSeconds?: number;
  }>;
  queue: QueueState | null;
};

export type CrawlerProductionEffect = {
  total: number;
  effective: number;
  maxEffective: number;
  boostBps: string;
  capped: boolean;
  productionIncreasePerHour: Resources;
};

export type DefenseState = {
  wallet: Address;
  homePlanetId: string | null;
  productionAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  // Accrued-to-now projection of `resources` (VEY-KANEO-464).
  resourcesAsOfNow?: Resources | null;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
  shipyardLevel: number;
  naniteLevel: number;
  missileSiloLevel: number;
  technologyLevels: Record<string, number>;
  defenses: Array<{
    id: number;
    count: number;
    cost: Resources;
    // Predicted per-unit build time for the next batch (VEY-KANEO-472); present on the
    // Defense detail payload, omitted on count-only projections.
    durationSeconds?: number;
  }>;
  queue: QueueState | null;
};

export type InfrastructureState = {
  wallet: Address;
  homePlanetId: string | null;
  planetId?: string | null;
  planetLastSettledAt?: string | null;
  infrastructureAvailable: boolean;
  unavailableReason?: string;
  actionBlocker?: {
    kind: "mission_resolution_pending";
    detail: string;
    missionIds: string[];
    earliestArrivalAt: string;
  };
  resources: Resources | null;
  // Accrued-to-now projection of `resources` (VEY-KANEO-464).
  resourcesAsOfNow?: Resources | null;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
  productionPerHour: Resources | null;
  crawlerProduction?: CrawlerProductionEffect | null;
  energyBalance: EnergyBalance | null;
  storageCaps: Resources | null;
  protectedResources: Resources | null;
  raidableResources: Resources | null;
  technologyLevels: Record<string, number>;
  buildings: Array<{
    id: number;
    level: number;
    cost: Resources;
    // Predicted next-upgrade build time (VEY-KANEO-472), computed server-side from the
    // planet's Robotics/Nanite Factory levels and the next-level cost.
    durationSeconds?: number;
  }>;
  queue: QueueState | null;
};

export type MoonState = {
  wallet: Address;
  bodyKind: "moon";
  homePlanetId: string | null;
  parentPlanetId: string | null;
  moonAvailable: boolean;
  unavailableReason?: string;
  resources: Resources;
  resourcesAsOfNow?: Resources;
  ships: ShipyardState["ships"];
  defenses: DefenseState["defenses"];
  moon: {
    exists: boolean;
    planetId: string;
    owner: Address;
    fields: number;
    diameterKm: number;
    createdAt: string;
    jumpGateReadyAt: string;
  } | null;
  fleet: Array<{
    id: number;
    count: number;
    cost: Resources;
    energyPerUnit?: string;
    durationSeconds?: number;
  }>;
  buildings: Array<{
    id: number;
    key: string;
    label: string;
    level: number;
    cost: Resources;
  }>;
  queue: QueueState | null;
  technologyLevels: Record<string, number>;
  defenseQueue: QueueState | null;
  jumpGateDestinations?: Array<{
    planetId: string;
    label?: string | null;
    coordinates?: string | null;
    jumpGateReadyAt?: string | null;
  }>;
};

export type ResearchState = {
  wallet: Address;
  homePlanetId: string | null;
  planetId?: string | null;
  researchAvailable: boolean;
  unavailableReason?: string;
  resources: Resources | null;
  // Accrued-to-now projection of `resources` (VEY-KANEO-464).
  resourcesAsOfNow?: Resources | null;
  resourceSnapshot?: ResourceSnapshotMetadata | null;
  researchLabLevel: number;
  researchNetworkLabLevels: number[];
  technologyLevels: Record<string, number>;
  technologies: Array<{
    id: number;
    level: number;
    cost: Resources;
    // Predicted next-level research time (VEY-KANEO-472); present on the Research detail
    // payload, computed server-side from the effective Research Lab level.
    durationSeconds?: number;
  }>;
  queue: QueueState | null;
};

export type RiftResourceKey = "metal" | "crystal" | "deuterium";

export type RiftRequirement = {
  kind: "building" | "technology";
  key: string;
  label: string;
  currentLevel: number | null;
  requiredLevel: number;
  binary?: boolean;
  built?: boolean | null;
};

export type RiftResourceState = {
  key: RiftResourceKey;
  label: string;
  resourceId: number;
  tokenAddress: Address | null;
  walletBalance: string | null;
  allowance: string | null;
  inGameBalance: string;
  lockedBalance: string;
};

export type PendingWithdrawal = {
  id: string;
  resource: RiftResourceKey;
  amount: string;
  requestedAt: string;
  unlocksAt: string;
  ready: boolean;
};

export type RiftState = {
  wallet: Address;
  homePlanetId: string | null;
  riftAvailable: boolean;
  unlocked: boolean;
  unavailableReason?: string;
  withdrawalDelaySeconds: string;
  requirements: RiftRequirement[];
  resources: RiftResourceState[];
  pendingWithdrawals: PendingWithdrawal[];
};

export type AllianceState = {
  wallet: Address;
  allianceAvailable: boolean;
  dismissJoinRequestAvailable?: boolean;
  unavailableReason?: string;
  membership: {
    allianceId: string;
    role: AllianceRoleName;
    joinedAt: string;
  };
  profile: {
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: Address;
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
    totalMemberScore?: string;
  } | null;
  directory: Array<{
    allianceId: string;
    active: boolean;
    tag: string;
    name: string;
    description: string;
    owner: Address;
    ownerDisplayName?: string | null;
    createdAt: string;
    memberCount: number;
    totalMemberScore?: string;
    members?: Array<{
      address: Address;
      displayName?: string | null;
      role: AllianceRoleName;
      joinedAt: string;
      totalScore?: string;
    }>;
  }>;
  pendingInvites: Array<{
    allianceId: string;
    inviter: Address;
    inviterDisplayName?: string | null;
    invitedAt: string;
  }>;
  pendingJoinRequests: Array<{
    allianceId: string;
    requester: Address;
    requesterDisplayName?: string | null;
    requestedAt: string;
  }>;
  allianceJoinRequests: Array<{
    allianceId: string;
    requester: Address;
    requesterDisplayName?: string | null;
    requesterTotalScore?: string;
    requesterMembership?: {
      allianceId: string;
      role: AllianceRoleName;
      joinedAt: string;
    };
    requestedAt: string;
  }>;
  diplomacy: AllianceDiplomacyEntry[];
  activeWars: AllianceDiplomacyEntry[];
  members: Array<{
    address: Address;
    displayName?: string | null;
    role: AllianceRoleName;
    joinedAt: string;
    totalScore?: string;
  }>;
};

export type AllianceRoleName = "none" | "member" | "officer" | "owner";
export type AllianceDiplomacyStatusName = "none" | "ally" | "non_aggression_pact" | "war";
export type AllianceDiplomacyEntry = {
  allianceId: string;
  otherAllianceId: string;
  status: AllianceDiplomacyStatusName;
  statusId: number;
  updatedAt: string | null;
  initiatedByAllianceId: string | null;
  alliance: AllianceState["directory"][number] | null;
};

// Canonical-mirror seed shapes for the alliance sub-states that have no on-chain enumeration getter
// covered by the directory snapshot. Read from contract getters during explicit rebuild and used
// to DELETE+replace the corresponding indexed tables (see SettlementIndexer.rebuildUncached).
export type AllianceJoinRequestSnapshot = {
  allianceId: string;
  requester: Address;
  requestedAt: string;
};

export type AllianceInviteSnapshot = {
  allianceId: string;
  player: Address;
  inviter: Address;
  invitedAt: string;
};

export type AllianceDiplomacySnapshot = {
  allianceId: string;
  otherAllianceId: string;
  statusId: number;
};

export type AttackBlockReason = "none" | "bashing_limit" | "score_protection" | "same_alliance";
export type TransportBlockReason = "none" | "own_planet" | "same_alliance" | "not_allied";
export type AttackRelation = "peer" | "stronger" | "weaker";
export type HonorStatus = "neutral" | "honorable" | "bandit";

export type AttackProtectionScoreComparison = {
  scoreType: "contract_total_user_score";
  attackerScore: string;
  defenderScore: string;
  attackerVisibleScore: string;
  defenderVisibleScore: string;
  protected: boolean;
};

export type AttackProtectionStatus = {
  wallet: Address;
  targetPlanetId: string;
  allowed: boolean;
  blockedReason: AttackBlockReason;
  blockedReasonLabel: string | null;
  relation: AttackRelation;
  defenderHonorStatus: HonorStatus;
  plunderBps: number;
  defenderInactive: boolean;
  transportAllowed?: boolean;
  transportBlockReason?: TransportBlockReason;
  transportBlockReasonLabel?: string | null;
  scoreComparison?: AttackProtectionScoreComparison;
  atWar?: boolean;
  targetAlliance?: AllianceIdentity | null;
};

export type AllianceIdentity = {
  allianceId: string;
  tag: string;
  name: string;
};

export type SettledPlanetEvent = PlanetState & {
  eventName: "PlanetStarted" | "ColonyCreated";
  transactionHash: string;
  blockNumber: string;
};

export type PlanetSettledEvent = {
  eventName: "PlanetSettled";
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  planetId: string;
  lastSettledAt: string;
  resources: Resources;
};

export type MoonResourcesSettledEvent = {
  eventName: "MoonResourcesSettled";
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  planetId: string;
  lastSettledAt: string;
  resources: Resources;
};

export type PlanetRenamedEvent = {
  eventName: "PlanetRenamed";
  transactionHash: string;
  blockNumber: string;
  owner: Address;
  planetId: string;
  name: string;
};

export type IndexedReferralClaimEvent = {
  eventName: "ReferralCodeClaimed";
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  inviter: Address;
  commitment: `0x${string}`;
  claimedAt: string;
};

export type IndexedReferralRedemptionEvent = {
  eventName: "ReferralInviteRedeemed";
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  inviter: Address;
  invitee: Address;
  commitment: `0x${string}`;
  redeemedAt: string;
};

export type MoonChanceReportEvent = {
  eventName:
    | "MoonChanceRequested"
    | "MoonChanceFinalized"
    | "MoonChanceSkippedExistingMoon"
    | "MoonDestructionRequested"
    | "MoonDestructionFinalized";
  transactionHash: string;
  blockNumber: string;
  battleId: string;
  targetPlanetId: string;
  outcomeId?: string;
  defender?: Address;
  attacker?: Address;
  metalDebris?: string;
  crystalDebris?: string;
  chanceBps?: number;
  deathstars?: number;
  moonDestructionChanceBps?: number;
  deathstarDestructionChanceBps?: number;
  randomnessRequestId?: string;
  purposeHash?: string;
  moonCreated?: boolean;
  moonDestroyed?: boolean;
  deathstarsDestroyed?: boolean;
  randomWord?: string;
  moonFields?: number;
  moonDiameterKm?: number;
};

export type DebrisFieldEvent = {
  eventName: "DebrisFieldUpdated";
  transactionHash: string;
  blockNumber: string;
  planetId: string;
  resources: {
    metal: string;
    crystal: string;
  };
};

export interface ChainReader {
  getWalletSettlement(wallet: Address): Promise<WalletSettlement>;
  getSettlementFunding(wallet: Address): Promise<SettlementFundingState>;
  getWalletPlanets(wallet: Address): Promise<WalletPlanets>;
  getPlanet(planetId: bigint): Promise<PlanetState | null>;
  getPlayerQueues(wallet: Address, planetId?: bigint): Promise<PlayerQueues>;
  getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility>;
  listBattleReports(): Promise<BattleReport[]>;
  getBattleReport(missionId: bigint): Promise<BattleReport | null>;
  getInfrastructureAuthoritativeFields?(planetId: bigint): Promise<Partial<Pick<InfrastructureState, "buildings" | "resources">>>;
  getInfrastructureState(wallet: Address, planetId?: bigint): Promise<InfrastructureState>;
  getMoonState(wallet: Address, planetId?: bigint): Promise<MoonState>;
  getDefenseState(wallet: Address, planetId?: bigint): Promise<DefenseState>;
  getShipyardAuthoritativeFields?(
    planetId: bigint,
    maxTemperature?: number
  ): Promise<Partial<Pick<ShipyardState, "naniteLevel" | "resources" | "ships" | "shipyardLevel">>>;
  getShipyardState(wallet: Address, planetId?: bigint): Promise<ShipyardState>;
  getResearchState(wallet: Address, planetId?: bigint): Promise<ResearchState>;
  getRiftState(wallet: Address, planetId?: bigint): Promise<RiftState>;
  getAllianceState(wallet: Address): Promise<AllianceState>;
  getAllianceIntelForPlayers?(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>>;
  getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus>;
  getHighscoreForWallet?(wallet: Address, planetIds?: string[]): Promise<HighscoreEntry>;
  getHighscoresForWallets?(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): Promise<HighscoreEntry[]>;
  listAllianceDirectoryState?(): Promise<AllianceState["directory"]>;
  listAllianceJoinRequestState?(): Promise<AllianceJoinRequestSnapshot[]>;
  listAllianceInviteState?(candidateWallets: readonly Address[]): Promise<AllianceInviteSnapshot[]>;
  listAllianceDiplomacyState?(): Promise<AllianceDiplomacySnapshot[]>;
  getCanonicalFleetMission?(missionId: bigint): Promise<CanonicalFleetMissionSnapshot | null>;
  listCanonicalFleetMissions?(): Promise<CanonicalFleetMissionSnapshot[]>;
  listCanonicalFleetMissionDetails?(): Promise<CanonicalFleetMissionDetails[]>;
  listFleetMissionSummaries?(): Promise<FleetMissionSummary[]>;
  listCurrentPlanets?(): Promise<SettledPlanetEvent[]>;
  getCanonicalPlanetState?(planetId: bigint): Promise<CanonicalPlanetChainState>;
  listCanonicalPlanetStatesForIds?(planetIds: bigint[]): Promise<CanonicalPlanetChainState[]>;
  listResolvableFleetMissions?(): Promise<ResolvableFleetMission[]>;
  listReturnableFleetMissions?(): Promise<ReturnableFleetMission[]>;
  listSettledPlanetEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<SettledPlanetEvent[]>;
  listMoonChanceReportEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<MoonChanceReportEvent[]>;
  listDebrisFieldEvents(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<DebrisFieldEvent[]>;
  listAllianceLogs?(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]>;
  listContractLogs?(fromBlock: bigint, toBlock?: bigint | "latest"): Promise<RpcLog[]>;
  failoverRpc?(reason: string): boolean;
  getBlockNumber?(): Promise<bigint>;
  rpcMetrics?(): RpcMetrics;
}

export type RpcMetrics = {
  activeRpcUrl: string | null;
  batchRequests: number;
  callsByMethod: Record<string, number>;
  failoverCount: number;
  httpRequests: number;
  lastFailoverReason: string | null;
  rpcUrls: string[];
  // Count of upstream RPC fetches aborted for exceeding the per-request deadline. Surfaced on /health
  // and /health so an RPC live-read timeout storm is visible before it escalates to a crash
  // (VEY-KANEO-459).
  timeouts: number;
};

export type VeydriftGameReaderOptions = {
  cacheTtlMs?: number;
  hydrateQueueStartedAt?: boolean;
  minRequestIntervalMs?: number;
  requestTimeoutMs?: number;
};

type RpcCacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

export type RpcLog = {
  address?: string;
  blockNumber: string;
  blockTimestamp?: string;
  logIndex?: string;
  removed?: boolean;
  transactionHash: string;
  topics: string[];
  data: string;
};

type RpcLogFilter = {
  address: Address | Address[];
  fromBlock: string;
  toBlock: string;
  topics: Array<string | string[] | null>;
};

export type RpcBlock = {
  timestamp: string;
};

export class HttpJsonRpcTransport {
  private readonly metrics: RpcMetrics = {
    activeRpcUrl: null,
    batchRequests: 0,
    callsByMethod: {},
    failoverCount: 0,
    httpRequests: 0,
    lastFailoverReason: null,
    rpcUrls: [],
    timeouts: 0
  };
  private readonly cache = new Map<string, RpcCacheEntry<unknown>>();
  private readonly cacheTtlMs: number;
  private readonly minRequestIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private readonly rpcUrls: string[];
  private activeRpcIndex = 0;

  constructor(
    rpcUrl: string | readonly string[],
    options: { cacheTtlMs?: number; minRequestIntervalMs?: number; requestTimeoutMs?: number } = {}
  ) {
    this.rpcUrls = (Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl]).filter((url) => url.trim().length > 0);
    if (this.rpcUrls.length === 0) {
      throw new Error("RPC URL is required.");
    }
    this.metrics.activeRpcUrl = this.activeRpcUrl();
    this.metrics.rpcUrls = [...this.rpcUrls];
    this.cacheTtlMs = options.cacheTtlMs ?? 2_000;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 300;
    this.requestTimeoutMs = options.requestTimeoutMs ?? defaultRpcRequestTimeoutMs();
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    this.countRpc(method);
    const cacheKey = this.cacheKey(method, params);
    if (cacheKey) {
      return this.cached(cacheKey, () => this.requestUncached<T>(method, params));
    }

    return this.requestUncached<T>(method, params);
  }

  private async requestUncached<T>(method: string, params: unknown[]): Promise<T> {
    endpointLoop: for (let endpointAttempt = 0; endpointAttempt < this.rpcUrls.length; endpointAttempt += 1) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        this.metrics.httpRequests += 1;
        let response: Response;
        try {
          response = await this.fetchRpc({
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params
            })
          });
        } catch (error) {
          if (isRetryableTransportError(error) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (isRetryableTransportError(error) && this.failoverRpc("transport_error")) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw error;
        }

        if (!response.ok) {
          if (isRetryableRpcHttpStatus(response.status) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (isRetryableRpcHttpStatus(response.status) && this.failoverRpc(`http_${response.status}`)) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw new Error(`RPC HTTP ${response.status}`);
        }

        let body: JsonRpcResponse<T>;
        try {
          body = await readRpcJson<JsonRpcResponse<T>>(response);
        } catch (error) {
          // A truncated/empty body (e.g. the node cutting the stream short) is transient — retry.
          if (error instanceof RpcResponseParseError && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (error instanceof RpcResponseParseError && this.failoverRpc("rpc_response_parse_error")) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw error;
        }
        if (body.error) {
          if (isRetryableRpcError(body.error) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (isRetryableRpcError(body.error) && this.failoverRpc(`rpc_${body.error.code}`)) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
        }

        if (body.result === undefined) {
          throw new Error("RPC response missing result.");
        }

        return body.result;
      }
    }

    throw new Error("RPC request failed after retries.");
  }

  async requestBatch<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (requests.length === 0) {
      return [];
    }

    for (const request of requests) {
      this.countRpc(request.method);
    }
    const cacheMisses = new Map<string, {
      deferred: Deferred<T>;
      request: { method: string; params: unknown[] };
    }>();
    const resultPromises = requests.map((request) => {
      const cacheKey = this.cacheKey(request.method, request.params);
      if (!cacheKey) return null;

      const cached = this.cachedValue<T>(cacheKey);
      if (cached) return cached;

      const existingMiss = cacheMisses.get(cacheKey);
      if (existingMiss) return existingMiss.deferred.promise;

      const deferred = createDeferred<T>();
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        value: deferred.promise
      });
      cacheMisses.set(cacheKey, { deferred, request });
      return deferred.promise;
    });
    const uncachedRequests = requests
      .map((request, index) => ({ index, request }))
      .filter(({ index }) => resultPromises[index] === null);

    if (cacheMisses.size > 0) {
      const misses = [...cacheMisses.entries()];
      this.requestBatchUncached<T>(misses.map(([, miss]) => miss.request))
        .then((results) => {
          results.forEach((result, index) => {
            misses[index]?.[1].deferred.resolve(result);
          });
        })
        .catch((error) => {
          for (const [cacheKey, miss] of misses) {
            this.cache.delete(cacheKey);
            miss.deferred.reject(error);
          }
        });
    }

    if (uncachedRequests.length > 0) {
      const uncachedPromise = this.requestBatchUncached<T>(uncachedRequests.map(({ request }) => request));
      uncachedRequests.forEach(({ index }, resultIndex) => {
        resultPromises[index] = uncachedPromise.then((results) => {
          const result = results[resultIndex];
          if (result === undefined) {
            throw new Error("RPC batch response missing item.");
          }
          return result;
        });
      });
    }

    return Promise.all(resultPromises as Array<Promise<T>>);
  }

  private async requestBatchUncached<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    endpointLoop: for (let endpointAttempt = 0; endpointAttempt < this.rpcUrls.length; endpointAttempt += 1) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        this.metrics.batchRequests += 1;
        this.metrics.httpRequests += 1;

        let response: Response;
        try {
          response = await this.fetchRpc({
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(requests.map((request, index) => ({
              jsonrpc: "2.0",
              id: index + 1,
              method: request.method,
              params: request.params
            })))
          });
        } catch (error) {
          if (isRetryableTransportError(error) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (isRetryableTransportError(error) && this.failoverRpc("transport_error")) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw error;
        }

        if (!response.ok) {
          if (isRetryableRpcHttpStatus(response.status) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (isRetryableRpcHttpStatus(response.status) && this.failoverRpc(`http_${response.status}`)) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw new Error(`RPC HTTP ${response.status}`);
        }

        let body: JsonRpcResponse<T> | Array<JsonRpcResponse<T> & { id?: number }>;
        try {
          body = await readRpcJson<JsonRpcResponse<T> | Array<JsonRpcResponse<T> & { id?: number }>>(response);
        } catch (error) {
          // An oversized batch response truncated mid-stream throws "Unexpected end of JSON input" here.
          // Retry the batch; if it keeps failing the typed error makes batchCallContract fall back to
          // sequential single calls, whose small responses never truncate (VEY-KANEO-461).
          if (error instanceof RpcResponseParseError && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (error instanceof RpcResponseParseError && this.failoverRpc("rpc_response_parse_error")) {
            await retryDelay(0);
            continue endpointLoop;
          }
          throw error;
        }
        if (!Array.isArray(body)) {
          if (body.error && isRetryableRpcError(body.error) && attempt < 2) {
            await retryDelay(attempt);
            continue;
          }
          if (body.error && isRetryableRpcError(body.error) && this.failoverRpc(`rpc_${body.error.code}`)) {
            await retryDelay(0);
            continue endpointLoop;
          }
          if (body.error) {
            throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
          }
          throw new Error("RPC batch response missing items.");
        }

        const bodies = body;
        const retryableError = bodies.find((body) => body.error && isRetryableRpcError(body.error));
        if (retryableError?.error && attempt < 2) {
          await retryDelay(attempt);
          continue;
        }
        if (retryableError?.error && this.failoverRpc(`rpc_${retryableError.error.code}`)) {
          await retryDelay(0);
          continue endpointLoop;
        }
        const byId = new Map(bodies.map((body) => [body.id, body]));

        return requests.map((_, index) => {
          const body = byId.get(index + 1);
          if (!body) {
            throw new Error("RPC batch response missing item.");
          }
          if (body.error) {
            throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
          }
          if (body.result === undefined) {
            throw new Error("RPC response missing result.");
          }
          return body.result;
        });
      }
    }

    throw new Error("RPC batch request failed after retries.");
  }

  snapshot(): RpcMetrics {
    return {
      activeRpcUrl: this.activeRpcUrl(),
      batchRequests: this.metrics.batchRequests,
      callsByMethod: { ...this.metrics.callsByMethod },
      failoverCount: this.metrics.failoverCount,
      httpRequests: this.metrics.httpRequests,
      lastFailoverReason: this.metrics.lastFailoverReason,
      rpcUrls: [...this.rpcUrls],
      timeouts: this.metrics.timeouts
    };
  }

  failoverRpc(reason: string): boolean {
    if (this.rpcUrls.length <= 1) return false;
    this.activeRpcIndex = (this.activeRpcIndex + 1) % this.rpcUrls.length;
    this.cache.clear();
    this.metrics.failoverCount += 1;
    this.metrics.lastFailoverReason = reason;
    this.metrics.activeRpcUrl = this.activeRpcUrl();
    return true;
  }

  private countRpc(method: string): void {
    this.metrics.callsByMethod[method] = (this.metrics.callsByMethod[method] ?? 0) + 1;
  }

  private fetchRpc(init: RequestInit): Promise<Response> {
    const scheduled = this.requestQueue.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs > 0) {
        await retryDelayMs(waitMs);
      }
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs;
      return this.fetchWithTimeout(init);
    });
    this.requestQueue = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }

  // Bound every upstream RPC fetch with an AbortController-backed deadline. Without this, a slow or
  // hung Alchemy connection during a live-read timeout storm keeps its socket and promise alive
  // indefinitely; the server-side withTimeout only stops *awaiting* the read, leaving the underlying
  // fetch orphaned. Under a sustained storm those orphans accumulate without bound (sockets, file
  // descriptors, buffered response bodies) until the Bun runtime crashes with SIGSEGV (139). Aborting
  // at the deadline frees the socket promptly and surfaces a retryable timeout error (VEY-KANEO-459).
  private async fetchWithTimeout(init: RequestInit): Promise<Response> {
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      return fetch(this.activeRpcUrl(), init);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      return await fetch(this.activeRpcUrl(), { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        this.metrics.timeouts += 1;
        throw new RpcRequestTimeoutError(this.requestTimeoutMs);
      }
      // Wrap raw network failures (connection reset, DNS, TLS) so the retry loop treats them as the
      // transient transport faults they are instead of letting them escape as opaque fetch errors.
      throw new RpcTransportError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.cachedValue<T>(key);
    if (current) return current;

    const value = load().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value
    });
    return value;
  }

  private cachedValue<T>(key: string): Promise<T> | null {
    const current = this.cache.get(key);
    if (!current) return null;
    if (current.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return current.value as Promise<T>;
  }

  private cacheKey(method: string, params: unknown[]): string | null {
    if (!isCacheableRpcMethod(method)) return null;
    return `${method}:${JSON.stringify(params)}`;
  }

  private activeRpcUrl(): string {
    return this.rpcUrls[this.activeRpcIndex] ?? this.rpcUrls[0]!;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function isCacheableRpcMethod(method: string): boolean {
  return method === "eth_call"
    || method === "eth_getLogs"
    || method === "eth_blockNumber"
    || method === "eth_getBlockByNumber";
}

export class VeydriftGameReader implements ChainReader {
  private readonly transport: Pick<HttpJsonRpcTransport, "request"> & Partial<Pick<HttpJsonRpcTransport, "failoverRpc" | "requestBatch" | "snapshot">>;
  private readonly gameContractAddress: Address;
  private readonly allianceContractAddress: Address | undefined;
  private readonly moonContractAddress: Address | undefined;
  private readonly chainId: number;
  private readonly indexFromBlock: bigint;
  private readonly logChunkSpan: bigint;
  private readonly resourceTokenAddresses: Partial<Record<RiftResourceKey, Address>>;
  private readonly settlementContractAddress: Address | undefined;
  private readonly randomnessEngineAddress: Address | undefined;
  private readonly referralSystemAddress: Address | undefined;
  private readonly hydrateQueueStartedAt: boolean;
  // The first-planet start price is an immutable game constant. Memoize the first chain
  // read so serving settlement funding never reissues a per-request game-state eth_call
  // (VEY-KANEO-478 / #606); only the wallet balance is read fresh on each request.
  private startPriceRead: Promise<bigint | undefined> | undefined;

  constructor(
    config: BackendConfig,
    transport?: Pick<HttpJsonRpcTransport, "request"> & Partial<Pick<HttpJsonRpcTransport, "failoverRpc" | "requestBatch" | "snapshot">>,
    options: VeydriftGameReaderOptions = {}
  ) {
    if (!config.rpcUrl) {
      throw new Error("RPC URL is required.");
    }
    if (!config.gameContractAddress) {
      throw new Error("VeydriftGame contract address is required.");
    }

    const transportOptions: {
      cacheTtlMs?: number;
      minRequestIntervalMs?: number;
      requestTimeoutMs?: number;
    } = {};
    if (options.cacheTtlMs !== undefined) transportOptions.cacheTtlMs = options.cacheTtlMs;
    if (options.minRequestIntervalMs !== undefined) {
      transportOptions.minRequestIntervalMs = options.minRequestIntervalMs;
    }
    if (options.requestTimeoutMs !== undefined) {
      transportOptions.requestTimeoutMs = options.requestTimeoutMs;
    }

    this.transport = transport ?? new HttpJsonRpcTransport([
      config.rpcUrl,
      ...(config.rpcFallbackUrls ?? [])
    ], transportOptions);
    this.allianceContractAddress = config.allianceContractAddress;
    this.gameContractAddress = config.gameContractAddress;
    this.moonContractAddress = config.moonContractAddress;
    this.chainId = config.chainId;
    this.indexFromBlock = config.indexFromBlock;
    this.logChunkSpan = config.logChunkSpan && config.logChunkSpan > 0n ? config.logChunkSpan : 90_000n;
    this.resourceTokenAddresses = config.resourceTokenAddresses ?? {};
    this.settlementContractAddress = config.settlementContractAddress;
    this.randomnessEngineAddress = config.randomnessEngineAddress;
    this.referralSystemAddress = config.referralSystemAddress;
    this.hydrateQueueStartedAt = options.hydrateQueueStartedAt ?? true;
  }

  rpcMetrics(): RpcMetrics {
    return this.transport.snapshot?.() ?? {
      batchRequests: 0,
      callsByMethod: {},
      activeRpcUrl: null,
      failoverCount: 0,
      httpRequests: 0,
      lastFailoverReason: null,
      rpcUrls: [],
      timeouts: 0
    };
  }

  failoverRpc(reason: string): boolean {
    return this.transport.failoverRpc?.(reason) ?? false;
  }

  async getWalletSettlement(wallet: Address): Promise<WalletSettlement> {
    assertAddress(wallet);
    try {
      return await this.getGameSettlement(wallet);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return this.getCompactSettlement(wallet);
    }
  }

  async getSettlementFunding(wallet: Address): Promise<SettlementFundingState> {
    assertAddress(wallet);
    const startPrice = await this.readStartPrice();
    if (startPrice === undefined) {
      return {
        affordable: true,
        balanceWei: null,
        contractKind: "legacy",
        startPriceWei: null
      };
    }

    if (!this.resourceTokensConfigured()) {
      return {
        affordable: false,
        balanceWei: null,
        contractKind: "game",
        startPriceWei: startPrice.toString(),
        unavailableReason: "Resource token reserves are not configured for this game deployment yet."
      };
    }

    const balance = await this.readNativeBalance(wallet);
    return {
      affordable: balance >= startPrice,
      balanceWei: balance.toString(),
      contractKind: "game",
      startPriceWei: startPrice.toString()
    };
  }

  async getPlanet(planetId: bigint): Promise<PlanetState | null> {
    const words = splitWords(await this.call("0x181c1bc4", [encodeUint(planetId)]));
    const owner = decodeAddressWord(wordAt(words, 0));
    if (owner === zeroAddress) {
      return null;
    }
    const [name, resources] = await Promise.all([
      this.readPlanetName(planetId),
      this.readResources("0x0adbf924", planetId)
    ]);

    return {
      planetId: planetId.toString(),
      owner,
      name,
      galaxy: Number(decodeUintWord(wordAt(words, 1))),
      system: Number(decodeUintWord(wordAt(words, 2))),
      position: Number(decodeUintWord(wordAt(words, 3))),
      fields: Number(decodeUintWord(wordAt(words, 4))),
      temperature: Number(decodeSignedWord(wordAt(words, 5))),
      metalMultiplierBps: Number(decodeUintWord(wordAt(words, 6))),
      crystalMultiplierBps: Number(decodeUintWord(wordAt(words, 7))),
      deuteriumMultiplierBps: Number(decodeUintWord(wordAt(words, 8))),
      lastSettledAt: decodeUintWord(wordAt(words, 9)).toString(),
      resources
    };
  }

  async getWalletPlanets(wallet: Address): Promise<WalletPlanets> {
    assertAddress(wallet);
    const settlement = await this.getGameSettlement(wallet);
    const events = await this.listSettledPlanetEvents(this.indexFromBlock, "latest");
    const ids = new Set<string>();
    if (settlement.homePlanetId) ids.add(settlement.homePlanetId);
    for (const event of events) {
      if (event.owner.toLowerCase() === wallet.toLowerCase()) ids.add(event.planetId);
    }

    const planets = (await Promise.all(
      [...ids].map(async (id) => {
        const planet = await this.getPlanet(BigInt(id));
        if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) return null;
        return this.readManagedPlanet(planet, settlement.homePlanetId);
      })
    )).filter((planet): planet is ManagedPlanet => planet !== null);

    planets.sort((left, right) => {
      if (left.isHomePlanet !== right.isHomePlanet) return left.isHomePlanet ? -1 : 1;
      return Number(BigInt(left.planetId) - BigInt(right.planetId));
    });

    const research = await this.readResearchQueue(wallet);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      queues: { research },
      planets
    };
  }

  async getPlayerQueues(wallet: Address, selectedPlanetId?: bigint): Promise<PlayerQueues> {
    const settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        building: null,
        defense: null,
        ship: null,
        research: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [building, defense, ship, research] = await Promise.all([
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readDefenseQueue(planetId),
      this.readShipQueue(planetId),
      this.readResearchQueue(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      building,
      defense,
      ship,
      research
    };
  }

  async getFleetMissionVisibility(wallet: Address): Promise<FleetMissionVisibility> {
    const planets = await this.getWalletPlanets(wallet);
    if (!planets.homePlanetId) {
      return { wallet, homePlanetId: null, incoming: [], outgoing: [], returning: [], joinableAttacks: [], completedMissions: [], battleReports: [] };
    }

    const walletLower = wallet.toLowerCase();
    const ownedPlanetIds = new Set(planets.planets.map((planet) => planet.planetId));
    const [summaries, battleReports] = await Promise.all([
      this.readFleetMissionSummaries(),
      this.readBattleReports()
    ]);

    return {
      wallet,
      homePlanetId: planets.homePlanetId,
      incoming: summaries.filter((mission) =>
        mission.owner.toLowerCase() !== walletLower
          && ownedPlanetIds.has(mission.targetPlanetId)
          && ["Attack", "AcsAttack", "MissileAttack"].includes(mission.missionType)
          && mission.status === "Outbound"
      ),
      outgoing: summaries.filter((mission) =>
        mission.owner.toLowerCase() === walletLower && mission.status === "Outbound"
      ),
      returning: summaries.filter((mission) =>
        mission.owner.toLowerCase() === walletLower
          && (mission.status === "Returning" || mission.status === "Recalled")
      ),
      joinableAttacks: summaries.filter((mission) =>
        mission.owner.toLowerCase() !== walletLower
          && !ownedPlanetIds.has(mission.targetPlanetId)
          && mission.missionType === "Attack"
          && mission.status === "Outbound"
      ),
      completedMissions: summaries
        .filter((mission) => isVisibleCompletedMission(mission, walletLower, ownedPlanetIds))
        .sort(compareFleetMissionsNewestFirst),
      battleReports: battleReports.filter((report) =>
        report.attacker.toLowerCase() === walletLower || ownedPlanetIds.has(report.targetPlanetId)
      )
    };
  }

  async getBattleReport(missionId: bigint): Promise<BattleReport | null> {
    const logs = await this.getLogs({
      address: this.gameContractAddress,
      fromBlock: toQuantity(this.indexFromBlock),
      toBlock: "latest",
      topics: [[
        attackBattleResolvedTopic,
        combatRoundResolvedTopic,
        combatLossesTopic,
        combatDebrisSignaledTopic
      ], toTopic(missionId)]
    });

    return decodeBattleReportLogs(logs, missionId.toString());
  }

  async listBattleReports(): Promise<BattleReport[]> {
    return this.readBattleReports();
  }

  async listResolvableFleetMissions(): Promise<ResolvableFleetMission[]> {
    const summaries = await this.readFleetMissionSummaries();
    return summaries
      .filter((mission) =>
        mission.needsResolution
          && (
            mission.missionType === "Attack"
              || mission.missionType === "Harvest"
              || mission.missionType === "Colonize"
              || mission.missionType === "Transport"
              || mission.missionType === "Deploy"
              || mission.missionType === "DefenseHold"
          )
      )
      .map(({ arrivalAt, missionId, missionType, originPlanetId, targetPlanetId }) => ({
        arrivalAt,
        missionId,
        missionType,
        originPlanetId,
        targetPlanetId
      }));
  }

  async listReturnableFleetMissions(): Promise<ReturnableFleetMission[]> {
    const summaries = await this.readFleetMissionSummaries();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    return summaries
      .filter((mission) =>
        (mission.status === "Returning" || mission.status === "Recalled")
          && Number(mission.returnAt) > 0
          && Number(mission.returnAt) <= nowSeconds
      )
      .sort((left, right) => Number(right.returnAt) - Number(left.returnAt))
      .map(({ missionId, missionType, originPlanetId, returnAt, targetPlanetId }) => ({
        missionId,
        missionType,
        originPlanetId,
        returnAt,
        targetPlanetId
      }));
  }

  async listCanonicalFleetMissions(): Promise<CanonicalFleetMissionSnapshot[]> {
    const nextFleetId = await this.readOptionalUintCall("0x80198ce1", []);
    if (!nextFleetId || nextFleetId <= 1n) return [];

    const calls: Array<{ selector: string; args: string[] }> = [];
    for (let missionId = 1n; missionId < nextFleetId; missionId += 1n) {
      calls.push({ selector: "0xf158c946", args: [encodeUint(missionId)] });
    }

    const results = await this.batchCallContract(this.gameContractAddress, calls);
    return results
      .map((result, index) => this.decodeCanonicalFleetMission(BigInt(index + 1), result))
      .filter((mission): mission is CanonicalFleetMissionSnapshot => mission !== null);
  }

  async listCanonicalFleetMissionDetails(): Promise<CanonicalFleetMissionDetails[]> {
    const missions = await this.listCanonicalFleetMissions();
    const activeMissions = missions.filter(isActiveCanonicalMission);
    return this.hydrateCanonicalFleetMissionDetails(activeMissions);
  }

  async listCanonicalFleetMissionDetailsForIds(missionIds: bigint[]): Promise<CanonicalFleetMissionDetails[]> {
    if (missionIds.length === 0) return [];
    const calls = missionIds.map((missionId) => ({
      selector: "0xf158c946",
      args: [encodeUint(missionId)]
    }));
    const results = await this.batchCallContract(this.gameContractAddress, calls);
    const missions = results
      .map((result, index) => this.decodeCanonicalFleetMission(missionIds[index] ?? 0n, result))
      .filter((mission): mission is CanonicalFleetMissionSnapshot => mission !== null)
      .filter(isActiveCanonicalMission);
    return this.hydrateCanonicalFleetMissionDetails(missions);
  }

  private async hydrateCanonicalFleetMissionDetails(
    activeMissions: CanonicalFleetMissionSnapshot[]
  ): Promise<CanonicalFleetMissionDetails[]> {
    const supplements = await this.readFleetMissionStorageSupplements(
      activeMissions.map((mission) => BigInt(mission.missionId))
    );

    return activeMissions.map((mission) => ({
      ...mission,
      ...(supplements.get(mission.missionId) ?? emptyFleetMissionSupplement())
    }));
  }

  async listFleetMissionSummaries(): Promise<FleetMissionSummary[]> {
    return this.readFleetMissionSummaries();
  }

  async getCanonicalFleetMission(missionId: bigint): Promise<CanonicalFleetMissionSnapshot | null> {
    const [result] = await this.batchCallContract(this.gameContractAddress, [{
      selector: "0xf158c946",
      args: [encodeUint(missionId)]
    }]);
    if (result === undefined) return null;
    return this.decodeCanonicalFleetMission(missionId, result);
  }

  async getInfrastructureState(wallet: Address, selectedPlanetId?: bigint): Promise<InfrastructureState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        infrastructureAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Infrastructure upgrades are not available on this deployment yet.",
        resources: null,
        productionPerHour: null,
        energyBalance: null,
        storageCaps: null,
        protectedResources: null,
        raidableResources: null,
        technologyLevels: {},
        buildings: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        infrastructureAvailable: true,
        resources: null,
        productionPerHour: null,
        energyBalance: null,
        storageCaps: null,
        protectedResources: null,
        raidableResources: null,
        technologyLevels: {},
        buildings: Array.from({ length: buildingCount }, (_, id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [
      resources,
      productionPerHour,
      energyBalance,
      storageCaps,
      protectedResources,
      raidableResources,
      queue,
      buildings,
      technologyLevels
    ] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readResources("0x9ec5e0d5", planetId),
      this.readEnergyBalance(planetId),
      this.readResources("0x6db0ecd7", planetId),
      this.readOptionalResources("0x222a58f5", planetId),
      this.readOptionalResources("0x1da1f692", planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readBuildingRows(planetId),
      this.readTechnologyLevels(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      infrastructureAvailable: true,
      resources,
      productionPerHour,
      energyBalance,
      storageCaps,
      protectedResources,
      raidableResources,
      technologyLevels,
      buildings,
      queue
    };
  }

  async getInfrastructureAuthoritativeFields(planetId: bigint): Promise<Partial<Pick<InfrastructureState, "buildings" | "resources">>> {
    return {
      resources: await this.readResources("0x0adbf924", planetId)
    };
  }

  async getMoonState(wallet: Address, selectedPlanetId?: bigint): Promise<MoonState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return emptyMoonState(
        wallet,
        null,
        "The deployed contract only supports first-planet settlement. Moon systems are not available on this deployment yet."
      );
    }

    if (!settlement.homePlanetId) {
      return emptyMoonState(wallet, null, "Settle a home planet before using moon systems.");
    }

    const planetId = BigInt(settlement.homePlanetId);
    try {
      const moon = await this.readMoon(planetId);
      if (!moon.exists) {
        return {
          ...emptyMoonState(wallet, settlement.homePlanetId, "No moon exists for this home planet yet."),
          moonAvailable: true
        };
      }

      const [resources, ships, defenses, buildings, queue, defenseQueue, technologyLevels] = await Promise.all([
        this.readMoonResourcesCall("0x1f20b321", [encodeUint(planetId)]),
        this.readMoonShipRows(planetId),
        this.readMoonDefenseRows(planetId),
        this.readMoonBuildingRows(planetId),
        this.readMoonQueue(planetId),
        this.readMoonDefenseQueue(planetId),
        this.readTechnologyLevels(wallet)
      ]);

      return {
        wallet,
        bodyKind: "moon",
        homePlanetId: settlement.homePlanetId,
        parentPlanetId: settlement.homePlanetId,
        moonAvailable: true,
        resources,
        resourcesAsOfNow: resources,
        ships,
        defenses,
        moon,
        fleet: ships,
        buildings,
        queue,
        technologyLevels,
        defenseQueue
      };
    } catch (error) {
      if (isRpcRevert(error)) {
        return emptyMoonState(
          wallet,
          settlement.homePlanetId,
          "This deployment does not expose Veydrift moon systems yet."
        );
      }

      throw error;
    }
  }

  async getShipyardState(wallet: Address, selectedPlanetId?: bigint): Promise<ShipyardState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        planetId: null,
        productionAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Ship production is not available on this deployment yet.",
        resources: null,
        fleetSlots: { active: 0, limit: 1 },
        shipyardLevel: 0,
        naniteLevel: 0,
        technologyLevels: {},
        ships: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        planetId: null,
        productionAvailable: true,
        resources: null,
        fleetSlots: { active: 0, limit: 1 },
        shipyardLevel: 0,
        naniteLevel: 0,
        technologyLevels: {},
        ships: supportedShipIds.map((id) => ({
          id,
          count: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, shipyardLevel, naniteLevel, queue, technologyLevels, ships, activeFleetMissions] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(11n)]),
      this.readShipQueue(planetId),
      this.readTechnologyLevels(wallet),
      this.readShipRows(planetId, settlement.planet?.temperature),
      this.readOptionalUintCall("0x423f9f10", [encodeAddress(wallet)])
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      planetId: settlement.homePlanetId,
      productionAvailable: true,
      resources,
      fleetSlots: {
        active: Number(activeFleetMissions ?? 0n),
        limit: 1 + (technologyLevels["4"] ?? 0)
      },
      shipyardLevel: Number(shipyardLevel),
      naniteLevel: Number(naniteLevel),
      technologyLevels,
      ships,
      queue
    };
  }

  async getShipyardAuthoritativeFields(
    planetId: bigint,
    maxTemperature?: number
  ): Promise<Partial<Pick<ShipyardState, "naniteLevel" | "resources" | "ships" | "shipyardLevel">>> {
    const [resources, shipyardLevel, naniteLevel, ships] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(11n)]),
      this.readShipRows(planetId, maxTemperature)
    ]);

    return {
      resources,
      shipyardLevel: Number(shipyardLevel),
      naniteLevel: Number(naniteLevel),
      ships
    };
  }

  async getDefenseState(wallet: Address, selectedPlanetId?: bigint): Promise<DefenseState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        productionAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Defense production is not available on this deployment yet.",
        resources: null,
        shipyardLevel: 0,
        naniteLevel: 0,
        missileSiloLevel: 0,
        technologyLevels: {},
        defenses: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        productionAvailable: true,
        resources: null,
        shipyardLevel: 0,
        naniteLevel: 0,
        missileSiloLevel: 0,
        technologyLevels: {},
        defenses: Array.from({ length: defenseCount }, (_, id) => ({
          id,
          count: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, shipyardLevel, naniteLevel, missileSiloLevel, queue, technologyLevels, defenses] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(5n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(11n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(14n)]),
      this.readPlanetQueue("0x5758361d", planetId, "defense"),
      this.readTechnologyLevels(wallet),
      this.readDefenseRows(planetId)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      productionAvailable: true,
      resources,
      shipyardLevel: Number(shipyardLevel),
      naniteLevel: Number(naniteLevel),
      missileSiloLevel: Number(missileSiloLevel),
      technologyLevels,
      defenses,
      queue
    };
  }

  async getResearchState(wallet: Address, selectedPlanetId?: bigint): Promise<ResearchState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return {
        wallet,
        homePlanetId: null,
        researchAvailable: false,
        unavailableReason:
          "The deployed contract only supports first-planet settlement. Research is not available on this deployment yet.",
        resources: null,
        researchLabLevel: 0,
        researchNetworkLabLevels: [],
        technologyLevels: {},
        technologies: [],
        queue: null
      };
    }

    if (!settlement.homePlanetId) {
      return {
        wallet,
        homePlanetId: null,
        researchAvailable: true,
        resources: null,
        researchLabLevel: 0,
        researchNetworkLabLevels: [],
        technologyLevels: {},
        technologies: supportedTechnologyIds.map((id) => ({
          id,
          level: 0,
          cost: zeroResources()
        })),
        queue: null
      };
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [resources, researchLabLevel, researchNetworkLabLevels, queue, technologyLevels, technologies] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(6n)]),
      this.hydrateQueueStartedAt ? this.readResearchNetworkLabLevels(wallet, planetId) : Promise.resolve([]),
      this.readResearchQueue(wallet),
      this.readTechnologyLevels(wallet),
      this.readTechnologyRows(wallet)
    ]);

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      researchAvailable: true,
      resources,
      researchLabLevel: Number(researchLabLevel),
      researchNetworkLabLevels,
      technologyLevels,
      technologies,
      queue
    };
  }

  async getRiftState(wallet: Address, selectedPlanetId?: bigint): Promise<RiftState> {
    let settlement: WalletSettlement;
    try {
      settlement = await this.resolveWalletPlanet(wallet, selectedPlanetId);
    } catch (error) {
      if (!isRpcRevert(error) || !this.settlementContractAddress) {
        throw error;
      }

      return emptyRiftState(
        wallet,
        null,
        "The deployed contract only supports first-planet settlement. The Rift Stabilizer is not available on this deployment yet."
      );
    }

    if (!settlement.homePlanetId || !settlement.planet) {
      return emptyRiftState(wallet, null, "Settle a home planet before using the Rift Stabilizer.");
    }

    const planetId = BigInt(settlement.homePlanetId);
    const [riftLevel, roboticsLevel, researchLabLevel, technologyLevels] = await Promise.all([
      this.readOptionalUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(BigInt(riftBuildingId))]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(4n)]),
      this.readUintCall("0xd9b24865", [encodeUint(planetId), encodeUint(6n)]),
      this.readTechnologyLevels(wallet)
    ]);

    const bridgeBuilt = riftLevel === null ? null : riftLevel > 0n;
    const requirements = riftRequirements(
      bridgeBuilt,
      Number(roboticsLevel),
      Number(researchLabLevel),
      technologyLevels
    );
    const unlocked = bridgeBuilt === true;
    const tokenAddressesConfigured = riftResourceCatalog.every((resource) => this.resourceTokenAddresses[resource.key]);
    const pendingWithdrawals = await this.readRiftWithdrawals(wallet);
    const resources = await this.readRiftResources(wallet, settlement.planet.resources, pendingWithdrawals);
    const unavailableReason = riftLevel === null
      ? "This deployment does not expose the Rift Stabilizer building yet."
      : !unlocked
        ? "Build the Rift Stabilizer on this planet to unlock resource bridging."
        : !tokenAddressesConfigured
          ? "Resource token addresses are not configured for this deployment yet."
          : undefined;

    return {
      wallet,
      homePlanetId: settlement.homePlanetId,
      riftAvailable: unlocked && tokenAddressesConfigured,
      unlocked,
      ...(unavailableReason ? { unavailableReason } : {}),
      withdrawalDelaySeconds: riftWithdrawalDelaySeconds.toString(),
      requirements,
      resources,
      pendingWithdrawals
    };
  }

  async getAllianceState(wallet: Address): Promise<AllianceState> {
    assertAddress(wallet);
    const unavailable = (reason: string): AllianceState => ({
      wallet,
      allianceAvailable: false,
      unavailableReason: reason,
      membership: { allianceId: "0", role: "none", joinedAt: "0" },
      profile: null,
      directory: [],
      pendingInvites: [],
      pendingJoinRequests: [],
      allianceJoinRequests: [],
      diplomacy: [],
      activeWars: [],
      members: []
    });

    if (!this.allianceContractAddress) {
      return unavailable("Alliance contract is not configured for this deployment yet.");
    }

    const membershipWords = splitWords(
      await this.callContract(this.allianceContractAddress, "0xad642b52", [encodeAddress(wallet)])
    );
    const allianceId = decodeUintWord(wordAt(membershipWords, 0));
    const role = allianceRoleName(Number(decodeUintWord(wordAt(membershipWords, 1))));
    const joinedAt = decodeUintWord(wordAt(membershipWords, 2)).toString();
    const allianceIds = await this.listAllianceIds();
    const directoryWithMembers = await this.allianceDirectoryState(allianceIds);
    const [inviteResults, walletJoinRequestResults] = await Promise.all([
      this.batchCallContract(
        this.allianceContractAddress,
        allianceIds.map((id) => ({ selector: "0xf4d46b3b", args: [encodeAddress(wallet), encodeUint(id)] }))
      ),
      this.batchCallContract(
        this.allianceContractAddress,
        allianceIds.map((id) => ({ selector: "0xdb132ffb", args: [encodeAddress(wallet), encodeUint(id)] }))
      )
    ]);
    const pendingInvites = allianceIds.flatMap((id, index) => {
      const words = splitWords(inviteResults[index] ?? "0x");
      return decodeBoolWord(wordAt(words, 0))
        ? [{
          allianceId: id.toString(),
          inviter: decodeAddressWord(wordAt(words, 2)),
          invitedAt: decodeUintWord(wordAt(words, 3)).toString()
        }]
        : [];
    });
    const pendingJoinRequests = allianceIds.flatMap((id, index) => {
      const words = splitWords(walletJoinRequestResults[index] ?? "0x");
      return decodeBoolWord(wordAt(words, 0))
        ? [{
          allianceId: id.toString(),
          requester: decodeAddressWord(wordAt(words, 2)),
          requestedAt: decodeUintWord(wordAt(words, 3)).toString()
        }]
        : [];
    });
    const directoryMemberAddresses = new Map<string, Address[]>(
      directoryWithMembers.map((alliance) => [
        alliance.allianceId,
        (alliance.members ?? []).map((member) => member.address)
      ])
    );

    if (allianceId === 0n) {
      return {
        wallet,
        allianceAvailable: true,
        membership: { allianceId: "0", role, joinedAt },
        profile: null,
        directory: directoryWithMembers,
        pendingInvites,
        pendingJoinRequests,
        allianceJoinRequests: [],
        diplomacy: [],
        activeWars: [],
        members: []
      };
    }

    const profile = directoryWithMembers.find((entry) => entry.allianceId === allianceId.toString()) ?? null;
    const memberAddresses = directoryMemberAddresses.get(allianceId.toString()) ?? [];
    const joinRequestAddresses = decodeAddressArray(
      await this.callContract(this.allianceContractAddress, "0x2953e5ce", [encodeUint(allianceId)])
    );
    const [memberMemberships, joinRequestResults, joinRequestMemberships] = await Promise.all([
      this.batchCallContract(
        this.allianceContractAddress,
        memberAddresses.map((address) => ({ selector: "0xad642b52", args: [encodeAddress(address)] }))
      ),
      this.batchCallContract(
        this.allianceContractAddress,
        joinRequestAddresses.map((address) => ({ selector: "0xdb132ffb", args: [encodeAddress(address), encodeUint(allianceId)] }))
      ),
      this.batchCallContract(
        this.allianceContractAddress,
        joinRequestAddresses.map((address) => ({ selector: "0xad642b52", args: [encodeAddress(address)] }))
      )
    ]);
    const allianceJoinRequests = joinRequestAddresses.flatMap((address, index) => {
      const words = splitWords(joinRequestResults[index] ?? "0x");
      if (!decodeBoolWord(wordAt(words, 0))) return [];

      const membershipWords = splitWords(joinRequestMemberships[index] ?? "0x");
      const requesterAllianceId = decodeUintWord(wordAt(membershipWords, 0));
      if (requesterAllianceId !== 0n) return [];

      return [{
        allianceId: allianceId.toString(),
        requester: address,
        requesterMembership: {
          allianceId: requesterAllianceId.toString(),
          role: allianceRoleName(Number(decodeUintWord(wordAt(membershipWords, 1)))),
          joinedAt: decodeUintWord(wordAt(membershipWords, 2)).toString()
        },
        requestedAt: decodeUintWord(wordAt(words, 3)).toString()
      }];
    });

    return {
      wallet,
      allianceAvailable: true,
      membership: { allianceId: allianceId.toString(), role, joinedAt },
      profile: profile ? {
        active: profile.active,
        tag: profile.tag,
        name: profile.name,
        description: profile.description,
        owner: profile.owner,
        createdAt: profile.createdAt,
        memberCount: profile.memberCount
      } : null,
      directory: directoryWithMembers,
      pendingInvites,
      pendingJoinRequests,
      allianceJoinRequests,
      diplomacy: [],
      activeWars: [],
      members: memberAddresses.map((address, index) => {
        const words = splitWords(memberMemberships[index] ?? "0x");
        return {
          address,
          role: allianceRoleName(Number(decodeUintWord(wordAt(words, 1)))),
          joinedAt: decodeUintWord(wordAt(words, 2)).toString()
        };
      })
    };
  }

  async listAllianceDirectoryState(): Promise<AllianceState["directory"]> {
    if (!this.allianceContractAddress) return [];

    const allianceIds = await this.listAllianceIds();
    return this.allianceDirectoryState(allianceIds);
  }

  // Canonical-mirror seed: every alliance's pending join requests, read from the contract so eventless
  // migrations (importAllianceSnapshot) are reflected. allianceJoinRequests(uint256) enumerates the
  // requester addresses per alliance; allianceJoinRequest(address,uint256) supplies the requestedAt.
  async listAllianceJoinRequestState(): Promise<AllianceJoinRequestSnapshot[]> {
    if (!this.allianceContractAddress) return [];

    const allianceIds = await this.listAllianceIds();
    if (allianceIds.length === 0) return [];

    const requesterListResults = await this.batchCallContract(
      this.allianceContractAddress,
      allianceIds.map((id) => ({ selector: "0x2953e5ce", args: [encodeUint(id)] }))
    );
    const pairs = allianceIds.flatMap((id, index) =>
      decodeAddressArray(requesterListResults[index] ?? "0x").map((requester) => ({ allianceId: id, requester }))
    );
    if (pairs.length === 0) return [];

    const detailResults = await this.batchCallContract(
      this.allianceContractAddress,
      pairs.map((pair) => ({ selector: "0xdb132ffb", args: [encodeAddress(pair.requester), encodeUint(pair.allianceId)] }))
    );
    return pairs.flatMap((pair, index) => {
      const words = splitWords(detailResults[index] ?? "0x");
      if (!decodeBoolWord(wordAt(words, 0))) return [];
      return [{
        allianceId: pair.allianceId.toString(),
        requester: pair.requester,
        requestedAt: decodeUintWord(wordAt(words, 3)).toString()
      }];
    });
  }

  // Canonical-mirror seed: pending alliance invites. The contract has no per-alliance enumeration getter,
  // so iterate the candidate-wallet set (known players) × allianceIds and keep the invites the contract
  // reports as active. Bounded in alpha; runs only during explicit rebuild, never per request.
  async listAllianceInviteState(candidateWallets: readonly Address[]): Promise<AllianceInviteSnapshot[]> {
    if (!this.allianceContractAddress) return [];

    const allianceIds = await this.listAllianceIds();
    if (allianceIds.length === 0) return [];
    const wallets = Array.from(new Set(candidateWallets.map((wallet) => wallet.toLowerCase() as Address)));
    if (wallets.length === 0) return [];

    const pairs = wallets.flatMap((player) => allianceIds.map((allianceId) => ({ player, allianceId })));
    const inviteResults = await this.batchCallContract(
      this.allianceContractAddress,
      pairs.map((pair) => ({ selector: "0xf4d46b3b", args: [encodeAddress(pair.player), encodeUint(pair.allianceId)] }))
    );
    return pairs.flatMap((pair, index) => {
      const words = splitWords(inviteResults[index] ?? "0x");
      if (!decodeBoolWord(wordAt(words, 0))) return [];
      return [{
        allianceId: pair.allianceId.toString(),
        player: pair.player,
        inviter: decodeAddressWord(wordAt(words, 2)),
        invitedAt: decodeUintWord(wordAt(words, 3)).toString()
      }];
    });
  }

  // Canonical-mirror seed: alliance diplomacy. diplomacyStatus(uint256,uint256) is read for every
  // ordered allianceId pair (skipping self-pairs); each non-None status yields one directed row. War rows
  // are directional on newer AllianceSystem deployments, so the row allianceId is the declaring alliance.
  async listAllianceDiplomacyState(): Promise<AllianceDiplomacySnapshot[]> {
    if (!this.allianceContractAddress) return [];

    const allianceIds = await this.listAllianceIds();
    if (allianceIds.length === 0) return [];

    const pairs = allianceIds.flatMap((allianceId) =>
      allianceIds
        .filter((otherAllianceId) => otherAllianceId !== allianceId)
        .map((otherAllianceId) => ({ allianceId, otherAllianceId }))
    );
    if (pairs.length === 0) return [];

    const statusResults = await this.batchCallContract(
      this.allianceContractAddress,
      pairs.map((pair) => ({ selector: "0xbeddf2fb", args: [encodeUint(pair.allianceId), encodeUint(pair.otherAllianceId)] }))
    );
    return pairs.flatMap((pair, index) => {
      const statusId = Number(decodeUintWord(wordAt(splitWords(statusResults[index] ?? "0x"), 0)));
      if (statusId === 0) return [];
      return [{
        allianceId: pair.allianceId.toString(),
        otherAllianceId: pair.otherAllianceId.toString(),
        statusId
      }];
    });
  }

  private async allianceDirectoryState(allianceIds: readonly bigint[]): Promise<AllianceState["directory"]> {
    if (!this.allianceContractAddress) return [];

    const profileResults = await this.batchCallContract(
      this.allianceContractAddress,
      allianceIds.map((id) => ({ selector: "0x79c76adf", args: [encodeUint(id)] }))
    );
    const directory = allianceIds.map((id, index) => decodeAllianceDirectoryEntry(id, splitWords(profileResults[index] ?? "0x")))
      .filter((entry) => entry.active);
    const directoryMemberAddressResults = await this.batchCallContract(
      this.allianceContractAddress,
      directory.map((alliance) => ({ selector: "0x2a1ef311", args: [encodeUint(BigInt(alliance.allianceId))] }))
    );
    const directoryMemberAddresses = new Map<string, Address[]>(
      directory.map((alliance, index) => [
        alliance.allianceId,
        decodeAddressArray(directoryMemberAddressResults[index] ?? "0x")
      ])
    );
    const uniqueDirectoryMembers = Array.from(new Set(
      [...directoryMemberAddresses.values()].flat().map((address) => address.toLowerCase() as Address)
    ));
    const directoryMemberMembershipResults = await this.batchCallContract(
      this.allianceContractAddress,
      uniqueDirectoryMembers.map((address) => ({ selector: "0xad642b52", args: [encodeAddress(address)] }))
    );
    const directoryMemberMemberships = new Map<string, { role: AllianceRoleName; joinedAt: string }>(
      uniqueDirectoryMembers.map((address, index) => {
        const words = splitWords(directoryMemberMembershipResults[index] ?? "0x");
        return [address, {
          role: allianceRoleName(Number(decodeUintWord(wordAt(words, 1)))),
          joinedAt: decodeUintWord(wordAt(words, 2)).toString()
        }];
      })
    );

    return directory.map((alliance) => ({
      ...alliance,
      members: (directoryMemberAddresses.get(alliance.allianceId) ?? []).map((address) => {
        const membership = directoryMemberMemberships.get(address.toLowerCase());
        return {
          address,
          role: membership?.role ?? "member",
          joinedAt: membership?.joinedAt ?? "0"
        };
      })
    }));
  }

  private async listAllianceIds(): Promise<bigint[]> {
    if (!this.allianceContractAddress) return [];
    return decodeUintArray(await this.callContract(this.allianceContractAddress, "0xf0bab901", []));
  }

  async getAllianceIntelForPlayers(wallets: readonly Address[]): Promise<Map<Address, AllianceIdentity>> {
    const result = new Map<Address, AllianceIdentity>();
    if (!this.allianceContractAddress || wallets.length === 0) return result;

    const uniqueWallets = Array.from(new Set(wallets.map((wallet) => wallet.toLowerCase() as Address)));
    const membershipResults = await this.batchCallContract(
      this.allianceContractAddress,
      uniqueWallets.map((wallet) => ({ selector: "0xad642b52", args: [encodeAddress(wallet)] }))
    );
    const memberships = uniqueWallets.map((wallet, index) => {
      const words = splitWords(membershipResults[index] ?? "0x");
      return {
        wallet,
        allianceId: decodeUintWord(wordAt(words, 0))
      };
    }).filter((membership) => membership.allianceId !== 0n);
    const uniqueAllianceIds = Array.from(new Set(memberships.map((membership) => membership.allianceId.toString())))
      .map((allianceId) => BigInt(allianceId));

    if (uniqueAllianceIds.length === 0) return result;

    const profileResults = await this.batchCallContract(
      this.allianceContractAddress,
      uniqueAllianceIds.map((allianceId) => ({ selector: "0x79c76adf", args: [encodeUint(allianceId)] }))
    );
    const profiles = new Map(
      uniqueAllianceIds.flatMap((allianceId, index) => {
        const profile = decodeAllianceDirectoryEntry(allianceId, splitWords(profileResults[index] ?? "0x"));
        return profile.active
          ? [[allianceId.toString(), { allianceId: allianceId.toString(), tag: profile.tag, name: profile.name }]]
          : [];
      })
    );

    for (const membership of memberships) {
      const profile = profiles.get(membership.allianceId.toString());
      if (profile) result.set(membership.wallet, profile);
    }

    return result;
  }

  async getAttackProtectionStatus(wallet: Address, targetPlanetId: bigint): Promise<AttackProtectionStatus> {
    assertAddress(wallet);
    const words = splitWords(await this.call("0x8a6b2246", [encodeAddress(wallet), encodeUint(targetPlanetId)]));
    const blockedReason = decodeAttackBlockReason(Number(decodeUintWord(wordAt(words, 0))));
    const flags = words.length > 1 ? Number(decodeUintWord(wordAt(words, 1))) : 0;
    const plunderBps = words.length > 2 ? Number(decodeUintWord(wordAt(words, 2))) : 5000;

    return {
      wallet,
      targetPlanetId: targetPlanetId.toString(),
      allowed: blockedReason === "none",
      blockedReason,
      blockedReasonLabel: attackBlockReasonLabel(blockedReason),
      relation: decodeAttackRelation(flags),
      defenderHonorStatus: decodeHonorStatus(flags),
      plunderBps,
      defenderInactive: (flags & 16) !== 0
    };
  }

  async getHighscoreForWallet(wallet: Address, planetIds?: string[]): Promise<HighscoreEntry> {
    assertAddress(wallet);
    const settlement = await this.getWalletSettlement(wallet);
    const candidatePlanetIds = planetIds?.length
      ? planetIds
      : settlement.homePlanetId
        ? [settlement.homePlanetId]
        : [];

    const planetStates = await Promise.all(
      candidatePlanetIds.map(async (planetId) => {
        const planet = await this.getPlanet(BigInt(planetId));
        return planet?.owner.toLowerCase() === wallet.toLowerCase() ? planet : null;
      })
    );
    const ownedPlanets = planetStates.filter((planet): planet is PlanetState => planet !== null);
    const planetScores = await Promise.all(
      ownedPlanets.map(async (planet) => {
        const planetId = BigInt(planet.planetId);
        const [buildings, defenses, ships, moonBuildings] = await Promise.all([
          this.readBuildingRows(planetId),
          this.readDefenseRows(planetId),
          this.readShipRows(planetId),
          this.readMoonBuildingHighscoreRows(planetId, wallet)
        ]);
        return { buildings, moonBuildings, defenses, ships };
      })
    );
    const technologies = await this.readTechnologyRows(wallet);

    return calculateHighscore({
      wallet,
      homePlanetId: settlement.homePlanetId,
      planetCount: ownedPlanets.length,
      planets: planetScores,
      technologies
    });
  }

  async getHighscoresForWallets(planetsByOwner: ReadonlyMap<string, SettledPlanetEvent[]>): Promise<HighscoreEntry[]> {
    const owners = [...planetsByOwner.keys()].map((owner) => {
      assertAddress(owner);
      return owner as Address;
    });
    if (owners.length === 0) return [];

    const planetIds = [...new Set([...planetsByOwner.values()].flat().map((planet) => planet.planetId))]
      .sort((left, right) => Number(BigInt(left) - BigInt(right)));

    const calls = [
      ...owners.map((owner) => ({
        selector: "0x0ff79fa5",
        args: [encodeAddress(owner)]
      })),
      ...owners.flatMap((owner) => supportedTechnologyIds.map((id) => ({
        selector: "0xe512884c",
        args: [encodeAddress(owner), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => Array.from({ length: buildingCount }, (_, id) => ({
        selector: "0xd9b24865",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => Array.from({ length: defenseCount }, (_, id) => ({
        selector: "0x836e3a32",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      }))),
      ...planetIds.flatMap((planetId) => supportedShipIds.map((id) => ({
        selector: "0x57686701",
        args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(id))]
      })))
    ];
    const results = await this.batchCallContract(this.gameContractAddress, calls);
    let cursor = 0;

    const homePlanetByOwner = new Map(
      owners.map((owner) => {
        const homePlanetId = decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0));
        return [owner.toLowerCase(), homePlanetId === 0n ? null : homePlanetId.toString()] as const;
      })
    );
    const technologiesByOwner = new Map<string, Array<{ id: number; level: number }>>();
    for (const owner of owners) {
      technologiesByOwner.set(owner.toLowerCase(), supportedTechnologyIds.map((id) => ({
        id,
        level: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      })));
    }

    const planetScores = new Map<string, {
      buildings: Array<{ id: number; level: number }>;
      defenses: Array<{ id: number; count: number }>;
      ships: Array<{ id: number; count: number }>;
    }>();
    for (const planetId of planetIds) {
      planetScores.set(planetId, {
        buildings: Array.from({ length: buildingCount }, (_, id) => ({
          id,
          level: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
        })),
        defenses: [],
        ships: []
      });
    }
    for (const planetId of planetIds) {
      const score = planetScores.get(planetId);
      if (!score) continue;
      score.defenses = Array.from({ length: defenseCount }, (_, id) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      }));
    }
    for (const planetId of planetIds) {
      const score = planetScores.get(planetId);
      if (!score) continue;
      score.ships = supportedShipIds.map((id) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[cursor++] ?? "0x"), 0)))
      }));
    }

    const moonBuildingsByPlanet = await this.readMoonBuildingHighscoreRowsForPlanets(planetIds);

    return owners.map((owner) => {
      const ownerKey = owner.toLowerCase();
      const planets = planetsByOwner.get(ownerKey) ?? [];
      return calculateHighscore({
        wallet: owner,
        homePlanetId: homePlanetByOwner.get(ownerKey) ?? null,
        planetCount: planets.length,
        planets: planets.flatMap((planet) => {
          const score = planetScores.get(planet.planetId);
          return score
            ? [{ ...score, moonBuildings: moonBuildingsByPlanet.get(planet.planetId) ?? [] }]
            : [];
        }),
        technologies: technologiesByOwner.get(ownerKey) ?? []
      });
    });
  }

  async listSettledPlanetEvents(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<SettledPlanetEvent[]> {
    const logs = await this.getLogs(
      {
        address: this.gameContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[planetStartedTopic, colonyCreatedTopic]]
      }
    );

    return logs.map((log) => decodeSettledPlanetLog(log));
  }

  async listCurrentPlanets(): Promise<SettledPlanetEvent[]> {
    const nextPlanetId = await this.readUintCall("0xc16bedad", []);
    if (nextPlanetId <= 1n) return [];

    const planetIds = Array.from({ length: Number(nextPlanetId - 1n) }, (_, index) => BigInt(index + 1));
    const results = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.flatMap((planetId) => ([
        {
          selector: "0x181c1bc4",
          args: [encodeUint(planetId)]
        },
        {
          selector: "0xec16d865",
          args: [encodeUint(planetId)]
        }
      ]))
    );

    return planetIds.flatMap((planetId, index) => {
      const result = results[index * 2] ?? "0x";
      const nameResult = results[index * 2 + 1] ?? "0x";
      const words = splitWords(result);
      const owner = decodeAddressWord(wordAt(words, 0));
      if (owner === zeroAddress) return [];

      return [{
        eventName: "PlanetStarted",
        transactionHash: "0x",
        blockNumber: "0",
        owner,
        planetId: planetId.toString(),
        name: decodeNullableStringResult(nameResult),
        galaxy: Number(decodeUintWord(wordAt(words, 1))),
        system: Number(decodeUintWord(wordAt(words, 2))),
        position: Number(decodeUintWord(wordAt(words, 3))),
        fields: Number(decodeUintWord(wordAt(words, 4))),
        temperature: Number(decodeSignedWord(wordAt(words, 5))),
        metalMultiplierBps: Number(decodeUintWord(wordAt(words, 6))),
        crystalMultiplierBps: Number(decodeUintWord(wordAt(words, 7))),
        deuteriumMultiplierBps: Number(decodeUintWord(wordAt(words, 8))),
        lastSettledAt: decodeUintWord(wordAt(words, 9)).toString(),
        resources: decodeResources(words.slice(10, 13))
      } satisfies SettledPlanetEvent];
    });
  }

  async getCanonicalPlanetState(planetId: bigint): Promise<CanonicalPlanetChainState> {
    const [
      resources,
      buildings,
      defenses,
      ships,
      building,
      defense,
      ship
    ] = await Promise.all([
      this.readResources("0x0adbf924", planetId),
      this.readBuildingRows(planetId),
      this.readDefenseRows(planetId),
      this.readShipRows(planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readDefenseQueue(planetId),
      this.readShipQueue(planetId)
    ]);

    return {
      planetId: planetId.toString(),
      resources,
      buildings,
      defenses,
      ships,
      queues: { building, defense, ship }
    };
  }

  async listCanonicalPlanetStatesForIds(planetIds: bigint[]): Promise<CanonicalPlanetChainState[]> {
    if (planetIds.length === 0) return [];

    const progress = (label: string): void => {
      if (process.env.VEYDRIFT_MIGRATION_SNAPSHOT_VERBOSE === "1") {
        console.info(`[migration:snapshot] bulk canonical ${label}`);
      }
    };

    progress(`resources for ${planetIds.length} planets`);
    const resourceResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0x0adbf924",
        args: [encodeUint(planetId)]
      }))
    );

    progress("building levels/costs");
    const buildingResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.flatMap((planetId) =>
        Array.from({ length: buildingCount }, (_, id) => ([
          {
            selector: "0xd9b24865",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          },
          {
            selector: "0x291ee1b5",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          }
        ])).flat()
      )
    );

    progress("defense counts/costs");
    const defenseResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.flatMap((planetId) =>
        Array.from({ length: defenseCount }, (_, id) => ([
          {
            selector: "0x836e3a32",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          },
          {
            selector: "0x9b906295",
            args: [encodeUint(BigInt(id))]
          }
        ])).flat()
      )
    );

    progress("ship counts/costs");
    const shipResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.flatMap((planetId) =>
        supportedShipIds.flatMap((id) => ([
          {
            selector: "0x57686701",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          },
          {
            selector: "0xc4222030",
            args: [encodeUint(BigInt(id))]
          }
        ]))
      )
    );

    progress("building queues");
    const buildingQueueResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0xb8e835ab",
        args: [encodeUint(planetId)]
      }))
    );

    progress("defense queues");
    const defenseQueueResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0x5758361d",
        args: [encodeUint(planetId)]
      }))
    );

    progress("defense queue backlogs");
    const defenseBacklogResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0x4f5ed437",
        args: [encodeUint(planetId)]
      }))
    );

    progress("ship queues");
    const shipQueueResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0xb6f4b7b7",
        args: [encodeUint(planetId)]
      }))
    );

    progress("ship queue backlogs");
    const shipBacklogResults = await this.batchCallContract(
      this.gameContractAddress,
      planetIds.map((planetId) => ({
        selector: "0x52b55205",
        args: [encodeUint(planetId)]
      }))
    );
    progress("decoded chain responses");

    return planetIds.map((planetId, planetIndex) => {
      const buildingOffset = planetIndex * buildingCount * 2;
      const defenseOffset = planetIndex * defenseCount * 2;
      const shipOffset = planetIndex * supportedShipIds.length * 2;
      const buildingQueue = this.decodePlanetQueueResult(buildingQueueResults[planetIndex] ?? "0x", "building");
      const defenseQueue = this.decodePlanetQueueResult(defenseQueueResults[planetIndex] ?? "0x", "defense");
      const defenseBacklog = this.decodeProductionQueueBacklogResult(defenseBacklogResults[planetIndex] ?? "0x", "defense");
      if (defenseBacklog.length > 0) defenseQueue.backlog = defenseBacklog;
      const shipQueue = this.decodePlanetQueueResult(shipQueueResults[planetIndex] ?? "0x", "ship");
      const shipBacklog = this.decodeProductionQueueBacklogResult(shipBacklogResults[planetIndex] ?? "0x", "ship");
      if (shipBacklog.length > 0) shipQueue.backlog = shipBacklog;

      return {
        planetId: planetId.toString(),
        resources: decodeResources(splitWords(resourceResults[planetIndex] ?? "0x")),
        buildings: Array.from({ length: buildingCount }, (_, id) => {
          const levelResult = buildingResults[buildingOffset + id * 2];
          const costResult = buildingResults[buildingOffset + id * 2 + 1];
          if (!levelResult || !costResult) {
            throw new Error("RPC batch response missing building row.");
          }
          return {
            id,
            level: Number(decodeUintWord(wordAt(splitWords(levelResult), 0))),
            cost: decodeResources(splitWords(costResult))
          };
        }),
        defenses: Array.from({ length: defenseCount }, (_, id) => ({
          id,
          count: Number(decodeUintWord(wordAt(splitWords(defenseResults[defenseOffset + id * 2] ?? "0x"), 0))),
          cost: decodeResources(splitWords(defenseResults[defenseOffset + id * 2 + 1] ?? "0x"))
        })),
        ships: supportedShipIds.map((id, index) => ({
          id,
          count: Number(decodeUintWord(wordAt(splitWords(shipResults[shipOffset + index * 2] ?? "0x"), 0))),
          cost: decodeResources(splitWords(shipResults[shipOffset + index * 2 + 1] ?? "0x"))
        })),
        queues: { building: buildingQueue, defense: defenseQueue, ship: shipQueue }
      };
    });
  }

  async listMoonChanceReportEvents(
    fromBlock: bigint,
    toBlock: bigint | "latest" = "latest"
  ): Promise<MoonChanceReportEvent[]> {
    if (!this.moonContractAddress) return [];

    const logs = await this.getLogs(
      {
        address: this.moonContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[
          moonChanceRequestedTopic,
          moonChanceFinalizedTopic,
          moonChanceSkippedExistingMoonTopic,
          moonDestructionRequestedTopic,
          moonDestructionFinalizedTopic
        ]]
      }
    );

    return logs.map((log) => decodeMoonChanceReportLog(log));
  }

  async listDebrisFieldEvents(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<DebrisFieldEvent[]> {
    const logs = await this.getLogs(
      {
        address: this.gameContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[debrisFieldUpdatedTopic]]
      }
    );

    return logs.map((log) => decodeDebrisFieldLog(log));
  }

  async listAllianceLogs(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    if (!this.allianceContractAddress) return [];

    return this.getLogs(
      {
        address: this.allianceContractAddress,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: [[
          allianceCreatedTopic,
          allianceProfileUpdatedTopic,
          allianceInviteCreatedTopic,
          allianceInviteCancelledTopic,
          allianceJoinRequestedTopic,
          allianceJoinRequestCancelledTopic,
          allianceJoinRequestDismissedTopic,
          allianceJoinRequestApprovedTopic,
          allianceJoinedTopic,
          allianceLeftTopic,
          allianceRoleUpdatedTopic,
          allianceOwnershipTransferredTopic,
          allianceDiplomacyUpdatedTopic
        ]]
      }
    );
  }

  /**
   * Raw logs for every indexed contract address over a block range, with no topic
   * filter. Mirrors the websocket `logs` subscription so chain-sync gap recovery can
   * backfill ONLY the missed range incrementally instead of triggering a full rebuild.
   */
  /** Current chain head (eth_blockNumber). Drives the chain-sync poll cursor. */
  async getBlockNumber(): Promise<bigint> {
    return decodeUint(await this.transport.request<string>("eth_blockNumber", []));
  }

  async listContractLogs(fromBlock: bigint, toBlock: bigint | "latest" = "latest"): Promise<RpcLog[]> {
    const addresses = this.indexedContractAddresses();
    if (addresses.length === 0) return [];

    return this.getLogs(
      {
        address: addresses.length === 1 ? addresses[0]! : addresses,
        fromBlock: toQuantity(fromBlock),
        toBlock: toBlock === "latest" ? "latest" : toQuantity(toBlock),
        topics: []
      }
    );
  }

  private indexedContractAddresses(): Address[] {
    return [
      this.gameContractAddress,
      this.moonContractAddress,
      this.allianceContractAddress,
      this.resourceTokenAddresses.metal,
      this.resourceTokenAddresses.crystal,
      this.resourceTokenAddresses.deuterium,
      // VEY-KANEO-479: include the RandomnessEngine so RandomnessFulfilled logs are backfilled/ingested,
      // letting the read model gate an arrived Attack's readiness on its battle randomness.
      this.randomnessEngineAddress,
      this.referralSystemAddress
    ].filter((address): address is Address => Boolean(address));
  }

  private async getGameSettlement(wallet: Address): Promise<WalletSettlement> {
    const homePlanetId = decodeUint(await this.call("0x0ff79fa5", [encodeAddress(wallet)]));
    const planet = homePlanetId === 0n ? null : await this.getPlanet(homePlanetId);

    return {
      wallet,
      hasFirstPlanet: homePlanetId !== 0n,
      homePlanetId: homePlanetId === 0n ? null : homePlanetId.toString(),
      planet,
      contractKind: "game"
    };
  }

  private async readPlanetQueue(selector: string, planetId: bigint, kind: "building" | "defense" | "ship"): Promise<QueueState> {
    const queue = this.decodePlanetQueueResult(await this.call(selector, [encodeUint(planetId)]), kind);

    if (!this.hydrateQueueStartedAt || !queue.active) {
      return queue;
    }

    if (kind === "building") {
      queue.startedAt = await this.readBuildingStartedAt(planetId, queue);
    } else if (kind === "defense") {
      queue.startedAt = await this.readDefenseStartedAt(planetId, queue);
    } else if (kind === "ship") {
      queue.startedAt = await this.readShipStartedAt(planetId, queue);
    }

    return queue;
  }

  private decodePlanetQueueResult(result: string, kind: "building" | "defense" | "ship"): QueueState {
    const words = splitWords(result);
    const active = decodeBoolWord(wordAt(words, 0));
    return {
      active,
      kind: active ? kind : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      ...(kind === "building"
        ? { targetLevel: Number(decodeUintWord(wordAt(words, 2))) }
        : { quantity: Number(decodeUintWord(wordAt(words, 2))) }),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
  }

  private async readDefenseQueue(planetId: bigint): Promise<QueueState> {
    const queue = await this.readPlanetQueue("0x5758361d", planetId, "defense");
    const backlog = await this.readProductionQueueBacklog("0x4f5ed437", planetId, "defense");
    if (backlog.length > 0) {
      queue.backlog = backlog;
    }
    return queue;
  }

  private async readShipQueue(planetId: bigint): Promise<QueueState> {
    const queue = await this.readPlanetQueue("0xb6f4b7b7", planetId, "ship");
    const backlog = await this.readProductionQueueBacklog("0x52b55205", planetId, "ship");
    if (backlog.length > 0) {
      queue.backlog = backlog;
    }
    return queue;
  }

  private async readProductionQueueBacklog(
    selector: string,
    planetId: bigint,
    kind: "defense" | "ship"
  ): Promise<QueueState[]> {
    try {
      return this.decodeProductionQueueBacklogResult(await this.call(selector, [encodeUint(planetId)]), kind);
    } catch (error) {
      if (isRpcRevert(error)) return [];
      throw error;
    }
  }

  private decodeProductionQueueBacklogResult(result: string, kind: "defense" | "ship"): QueueState[] {
    const words = splitWords(result);
    const length = Number(decodeUintWord(wordAt(words, 1)));
    const backlog: QueueState[] = [];
    for (let index = 0; index < length; index += 1) {
      const offset = 2 + index * 7;
      const active = decodeBoolWord(wordAt(words, offset));
      backlog.push({
        active,
        kind: active ? kind : null,
        ...(active ? { itemId: Number(decodeUintWord(wordAt(words, offset + 1))) } : {}),
        quantity: Number(decodeUintWord(wordAt(words, offset + 2))),
        readyAt: active ? decodeUintWord(wordAt(words, offset + 3)).toString() : null,
        cost: decodeResources(words.slice(offset + 4, offset + 7))
      });
    }
    return backlog;
  }

  private async readMoonQueue(planetId: bigint): Promise<QueueState> {
    const words = splitWords(await this.moonCall("0x2216f950", [encodeUint(planetId)]));
    const active = decodeBoolWord(wordAt(words, 0));
    return {
      active,
      kind: active ? "moon-building" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      targetLevel: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
  }

  private async readMoonDefenseQueue(planetId: bigint): Promise<QueueState> {
    const words = splitWords(await this.moonCall("0x5171acb6", [encodeUint(planetId)]));
    const active = decodeBoolWord(wordAt(words, 0));
    return {
      active,
      kind: active ? "moon-defense" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      quantity: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };
  }

  private async readMoonDefenseRows(planetId: bigint): Promise<MoonState["defenses"]> {
    const shipyardLevel = Number(
      await this.readMoonUintCall("0x4e6a984f", [encodeUint(planetId), encodeUint(3n)])
    );
    const rows = await Promise.all(
      deriveDefenseRows(() => 0, { shipyardLevel, naniteLevel: 0 })
        .filter((defense) => defense.id <= 7)
        .map(async (defense) => ({
          ...defense,
          count: Number(
            await this.readMoonUintCall("0x58221551", [
              encodeUint(planetId),
              encodeUint(BigInt(defense.id))
            ])
          )
        }))
    );
    return rows;
  }

  private async readBuildingStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.targetLevel === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            buildingStartedTopic,
            toTopic(planetId),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingBuildingStartedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async readDefenseStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.quantity === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            defenseQueuedTopic,
            toTopic(planetId),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingDefenseQueuedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async readShipStartedAt(planetId: bigint, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.quantity === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            shipQueuedTopic,
            toTopic(planetId),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingShipQueuedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async getLogs(filter: RpcLogFilter): Promise<RpcLog[]> {
    // VEY-KANEO-485: page deploy->head proactively in <=logChunkSpan windows rather than first issuing
    // a full-range eth_getLogs that a range-capped node is guaranteed to reject. Our self-hosted node
    // (now the ONLY RPC — Alchemy is permanently dead) caps eth_getLogs at 100k blocks; the old
    // "try the unbounded range, fail, then chunk" path wasted a failing round-trip on every cold-rebuild
    // and full-history serving read and, with the previous 2k span, never finished the cold reindex.
    // Resolve the head once and chunk immediately. getLogsRange still halves any individual chunk a node
    // rejects or truncates, so an over-cap or oversized-response chunk is always recovered.
    const fromBlock = decodeUint(filter.fromBlock);
    const toBlock = filter.toBlock === "latest"
      ? decodeUint(await this.transport.request<string>("eth_blockNumber", []))
      : decodeUint(filter.toBlock);
    if (toBlock < fromBlock) return [];

    if (toBlock - fromBlock > this.logChunkSpan) {
      return this.getLogsInChunks(filter, fromBlock, toBlock, this.logChunkSpan);
    }

    return this.getLogsRange(filter, fromBlock, toBlock);
  }

  private async getLogsInChunks(
    filter: RpcLogFilter,
    fromBlock: bigint,
    toBlock: bigint,
    maxChunkSpan: bigint
  ): Promise<RpcLog[]> {
    const logs: RpcLog[] = [];
    for (let start = fromBlock; start <= toBlock; start += maxChunkSpan + 1n) {
      const end = start + maxChunkSpan > toBlock ? toBlock : start + maxChunkSpan;
      logs.push(...await this.getLogsRange(filter, start, end));
    }
    return logs;
  }

  private async getLogsRange(filter: RpcLogFilter, fromBlock: bigint, toBlock: bigint): Promise<RpcLog[]> {
    try {
      return await this.transport.request<RpcLog[]>("eth_getLogs", [{
        ...filter,
        fromBlock: toQuantity(fromBlock),
        toBlock: toQuantity(toBlock)
      }]);
    } catch (error) {
      if (!shouldChunkLogQuery(error) || fromBlock >= toBlock) {
        throw error;
      }
    }

    const midpoint = fromBlock + ((toBlock - fromBlock) / 2n);
    const left = await this.getLogsRange(filter, fromBlock, midpoint);
    const right = await this.getLogsRange(filter, midpoint + 1n, toBlock);
    return [...left, ...right];
  }

  private async readResearchQueue(wallet: Address): Promise<QueueState> {
    const words = splitWords(await this.call("0xd0b044c5", [encodeAddress(wallet)]));
    const active = decodeBoolWord(wordAt(words, 0));
    const queue: QueueState = {
      active,
      kind: active ? "research" : null,
      ...(active ? { itemId: Number(decodeUintWord(wordAt(words, 1))) } : {}),
      targetLevel: Number(decodeUintWord(wordAt(words, 2))),
      readyAt: active ? decodeUintWord(wordAt(words, 3)).toString() : null,
      cost: decodeResources(words.slice(4, 7))
    };

    if (this.hydrateQueueStartedAt && active) {
      queue.startedAt = await this.readResearchStartedAt(wallet, queue);
    }

    return queue;
  }

  private async readResearchStartedAt(wallet: Address, queue: QueueState): Promise<string | null> {
    if (!queue.active || queue.itemId === undefined || queue.targetLevel === undefined || !queue.readyAt) {
      return null;
    }

    try {
      const logs = await this.getLogs(
        {
          address: this.gameContractAddress,
          fromBlock: toQuantity(this.indexFromBlock),
          toBlock: "latest",
          topics: [
            researchQueuedTopic,
            toAddressTopic(wallet),
            toTopic(BigInt(queue.itemId))
          ]
        }
      );
      const matchingLog = logs
        .slice()
        .reverse()
        .find((log) => isMatchingResearchQueuedLog(log, queue));
      if (!matchingLog) return null;

      const block = await this.transport.request<RpcBlock>("eth_getBlockByNumber", [
        matchingLog.blockNumber,
        false
      ]);
      return decodeUint(block.timestamp).toString();
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async readTechnologyLevels(wallet: Address): Promise<Record<string, number>> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      supportedTechnologyIds.map((id) => ({
        selector: "0xe512884c",
        args: [encodeAddress(wallet), encodeUint(BigInt(id))]
      }))
    );
    const entries = supportedTechnologyIds.map((id, index) => [
      id.toString(),
      Number(decodeUintWord(wordAt(splitWords(results[index] ?? "0x"), 0)))
    ] as const);

    return Object.fromEntries(entries);
  }

  private async readShipRows(planetId: bigint, maxTemperature?: number): Promise<ShipyardState["ships"]> {
    const solarSatelliteEnergyPerUnit = maxTemperature === undefined ? undefined : solarSatelliteEnergy(maxTemperature).toString();

    try {
      const results = await this.batchCallContract(
        this.gameContractAddress,
        supportedShipIds.flatMap((id) => ([
          {
            selector: "0x57686701",
            args: [encodeUint(planetId), encodeUint(BigInt(id))]
          },
          {
            selector: "0xc4222030",
            args: [encodeUint(BigInt(id))]
          }
        ]))
      );

      return supportedShipIds.map((id, index) => ({
        id,
        count: Number(decodeUintWord(wordAt(splitWords(results[index * 2] ?? "0x"), 0))),
        cost: decodeResources(splitWords(results[index * 2 + 1] ?? "0x")),
        ...(id === 9 && solarSatelliteEnergyPerUnit ? { energyPerUnit: solarSatelliteEnergyPerUnit } : {})
      }));
    } catch (error) {
      if (!isRpcRevert(error)) {
        throw error;
      }
    }

    const rows: Array<ShipyardState["ships"][number] | null> = [];
    for (const id of supportedShipIds) {
      rows.push(await this.readShipRow(planetId, id, solarSatelliteEnergyPerUnit));
    }

    return rows.filter((row): row is ShipyardState["ships"][number] => row !== null);
  }

  private async readShipRow(planetId: bigint, id: number, solarSatelliteEnergyPerUnit?: string): Promise<ShipyardState["ships"][number] | null> {
    try {
      const [count, cost] = await Promise.all([
        this.readUintCall("0x57686701", [encodeUint(planetId), encodeUint(BigInt(id))]),
        this.readResources("0xc4222030", BigInt(id))
      ]);

      return {
        id,
        count: Number(count),
        cost,
        ...(id === 9 && solarSatelliteEnergyPerUnit ? { energyPerUnit: solarSatelliteEnergyPerUnit } : {})
      };
    } catch (error) {
      if (isRpcRevert(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readDefenseRows(planetId: bigint): Promise<DefenseState["defenses"]> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      Array.from({ length: defenseCount }, (_, id) => ([
        {
          selector: "0x836e3a32",
          args: [encodeUint(planetId), encodeUint(BigInt(id))]
        },
        {
          selector: "0x9b906295",
          args: [encodeUint(BigInt(id))]
        }
      ])).flat()
    );

    return Array.from({ length: defenseCount }, (_, id) => ({
      id,
      count: Number(decodeUintWord(wordAt(splitWords(results[id * 2] ?? "0x"), 0))),
      cost: decodeResources(splitWords(results[id * 2 + 1] ?? "0x"))
    })
    );
  }

  private async readBuildingRows(planetId: bigint): Promise<InfrastructureState["buildings"]> {
    const calls = Array.from({ length: buildingCount }, (_, id) => ([
      {
        selector: "0xd9b24865",
        args: [encodeUint(planetId), encodeUint(BigInt(id))]
      },
      {
        selector: "0x291ee1b5",
        args: [encodeUint(planetId), encodeUint(BigInt(id))]
      }
    ])).flat();
    const results = await this.batchCallContract(this.gameContractAddress, calls);

    return Array.from({ length: buildingCount }, (_, id) => {
      const levelResult = results[id * 2];
      const costResult = results[id * 2 + 1];
      if (!levelResult || !costResult) {
        throw new Error("RPC batch response missing building row.");
      }

      return {
        id,
        level: Number(decodeUintWord(wordAt(splitWords(levelResult), 0))),
        cost: decodeResources(splitWords(costResult))
      };
    });
  }

  private async readMoon(planetId: bigint): Promise<NonNullable<MoonState["moon"]>> {
    const words = splitWords(await this.moonCall("0xce028855", [encodeUint(planetId)]));
    return {
      exists: decodeBoolWord(wordAt(words, 0)),
      planetId: decodeUintWord(wordAt(words, 1)).toString(),
      owner: decodeAddressWord(wordAt(words, 2)),
      fields: Number(decodeUintWord(wordAt(words, 3))),
      diameterKm: Number(decodeUintWord(wordAt(words, 4))),
      createdAt: decodeUintWord(wordAt(words, 5)).toString(),
      jumpGateReadyAt: decodeUintWord(wordAt(words, 6)).toString()
    };
  }

  private async readMoonBuildingRows(planetId: bigint): Promise<MoonState["buildings"]> {
    return Promise.all(
      moonBuildingCatalog.map(async (building) => {
        const [level, cost] = await Promise.all([
          this.readMoonUintCall("0x4e6a984f", [encodeUint(planetId), encodeUint(BigInt(building.id))]),
          this.readMoonResourcesCall("0xa9114d32", [encodeUint(planetId), encodeUint(BigInt(building.id))])
        ]);

        return {
          ...building,
          level: Number(level),
          cost
        };
      })
    );
  }

  private async readMoonShipRows(planetId: bigint): Promise<MoonState["ships"]> {
    const counts = new Map<number, number>();
    await Promise.all(
      supportedShipIds.map(async (id) => {
        const count = await this.readMoonUintCall("0xdc02fa88", [encodeUint(planetId), encodeUint(BigInt(id))]);
        counts.set(id, Number(count));
      })
    );
    return deriveShipRows((id) => counts.get(id) ?? 0);
  }

  private async readMoonBuildingHighscoreRows(
    planetId: bigint,
    wallet: Address
  ): Promise<Array<{ id: number; level: number }>> {
    if (!this.moonContractAddress) return [];

    try {
      const moon = await this.readMoon(planetId);
      if (!moon.exists || moon.owner.toLowerCase() !== wallet.toLowerCase()) return [];
      const rows = await this.readMoonBuildingRows(planetId);
      return rows.map(({ id, level }) => ({ id, level }));
    } catch (error) {
      if (isRpcRevert(error)) return [];
      throw error;
    }
  }

  private async readMoonBuildingHighscoreRowsForPlanets(
    planetIds: string[]
  ): Promise<Map<string, Array<{ id: number; level: number }>>> {
    const rows = new Map<string, Array<{ id: number; level: number }>>();
    if (!this.moonContractAddress || planetIds.length === 0) return rows;

    try {
      const moonResults = await this.batchCallContract(
        this.moonContractAddress,
        planetIds.map((planetId) => ({
          selector: "0xce028855",
          args: [encodeUint(BigInt(planetId))]
        }))
      );
      const planetsWithMoons = planetIds.filter((_, index) => (
        decodeBoolWord(wordAt(splitWords(moonResults[index] ?? "0x"), 0))
      ));
      const levelResults = await this.batchCallContract(
        this.moonContractAddress,
        planetsWithMoons.flatMap((planetId) => moonBuildingCatalog.map((building) => ({
          selector: "0x4e6a984f",
          args: [encodeUint(BigInt(planetId)), encodeUint(BigInt(building.id))]
        })))
      );

      let cursor = 0;
      for (const planetId of planetsWithMoons) {
        rows.set(planetId, moonBuildingCatalog.map((building) => ({
          id: building.id,
          level: Number(decodeUintWord(wordAt(splitWords(levelResults[cursor++] ?? "0x"), 0)))
        })));
      }
    } catch (error) {
      if (isRpcRevert(error)) return new Map();
      throw error;
    }

    return rows;
  }

  private async readTechnologyRows(wallet: Address): Promise<ResearchState["technologies"]> {
    const results = await this.batchCallContract(
      this.gameContractAddress,
      supportedTechnologyIds.flatMap((id) => ([
        {
          selector: "0xe512884c",
          args: [encodeAddress(wallet), encodeUint(BigInt(id))]
        },
        {
          selector: "0x6e984888",
          args: [encodeAddress(wallet), encodeUint(BigInt(id))]
        }
      ]))
    );

    return supportedTechnologyIds.map((id, index) => ({
      id,
      level: Number(decodeUintWord(wordAt(splitWords(results[index * 2] ?? "0x"), 0))),
      cost: decodeResources(splitWords(results[index * 2 + 1] ?? "0x"))
    })
    );
  }

  private async readRiftResources(
    wallet: Address,
    inGameResources: Resources,
    pendingWithdrawals: PendingWithdrawal[]
  ): Promise<RiftResourceState[]> {
    return Promise.all(
      riftResourceCatalog.map(async (resource) => {
        const tokenAddress = this.resourceTokenAddresses[resource.key] ?? null;
        const lockedBalance = pendingWithdrawals.find((withdrawal) => withdrawal.resource === resource.key)?.amount ?? "0";
        if (!tokenAddress) {
          return {
            ...resource,
            tokenAddress,
            walletBalance: null,
            allowance: null,
            inGameBalance: inGameResources[resource.key],
            lockedBalance
          };
        }

        const [walletBalance, allowance] = await Promise.all([
          this.readErc20Uint(tokenAddress, "0x70a08231", [encodeAddress(wallet)]),
          this.readErc20Uint(tokenAddress, "0xdd62ed3e", [encodeAddress(wallet), encodeAddress(this.gameContractAddress)])
        ]);

        return {
          ...resource,
          tokenAddress,
          walletBalance: walletBalance.toString(),
          allowance: allowance.toString(),
          inGameBalance: inGameResources[resource.key],
          lockedBalance
        };
      })
    );
  }

  private async readRiftWithdrawals(wallet: Address): Promise<PendingWithdrawal[]> {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const withdrawals = await Promise.all(
      riftResourceCatalog.map(async (resource) => {
        const words = splitWords(await this.call("0x91f8dfce", [encodeAddress(wallet), encodeUint(BigInt(resource.resourceId))]));
        const active = decodeBoolWord(wordAt(words, 0));
        if (!active) {
          return null;
        }

        const amount = decodeUintWord(wordAt(words, 3));
        const unlocksAt = decodeUintWord(wordAt(words, 4));
        const requestedAt = unlocksAt > BigInt(riftWithdrawalDelaySeconds)
          ? unlocksAt - BigInt(riftWithdrawalDelaySeconds)
          : 0n;

        const withdrawal: PendingWithdrawal = {
          id: resource.key,
          resource: resource.key,
          amount: amount.toString(),
          requestedAt: new Date(Number(requestedAt) * 1000).toISOString(),
          unlocksAt: new Date(Number(unlocksAt) * 1000).toISOString(),
          ready: nowSeconds >= unlocksAt
        };

        return withdrawal;
      })
    );

    return withdrawals.filter((withdrawal): withdrawal is PendingWithdrawal => withdrawal !== null);
  }

  private async readManagedPlanet(planet: PlanetState, homePlanetId: string | null): Promise<ManagedPlanet> {
    const planetId = BigInt(planet.planetId);
    const [buildings, building, defense, ship, moon] = await Promise.all([
      this.readBuildingRows(planetId),
      this.readPlanetQueue("0xb8e835ab", planetId, "building"),
      this.readPlanetQueue("0x5758361d", planetId, "defense"),
      this.readShipQueue(planetId),
      this.readMoonSummary(planet)
    ]);
    const level = (id: number) => buildings.find((building) => building.id === id)?.level ?? 0;
    const fieldsUsed = usedFieldsFromBuildingRows(buildings);

    return {
      ...planet,
      bodyKind: "planet",
      coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
      isHomePlanet: planet.planetId === homePlanetId,
      fieldsUsed,
      fieldsCapacity: planet.fields,
      keyLevels: {
        metalMine: level(0),
        crystalMine: level(1),
        deuteriumSynthesizer: level(2),
        solarPlant: level(3),
        roboticsFactory: level(4),
        shipyard: level(5),
        researchLab: level(6),
        terraformer: level(12)
      },
      queues: {
        building,
        defense,
        ship
      },
      moon
    };
  }

  private async readResearchNetworkLabLevels(wallet: Address, selectedPlanetId: bigint): Promise<number[]> {
    const planets = await this.getWalletPlanets(wallet);
    return planets.planets
      .filter((planet) => BigInt(planet.planetId) !== selectedPlanetId)
      .map((planet) => planet.keyLevels.researchLab)
      .filter((level) => level > 0)
      .sort((left, right) => right - left);
  }

  private async resolveWalletPlanet(wallet: Address, selectedPlanetId?: bigint): Promise<WalletSettlement> {
    if (!selectedPlanetId) return this.getGameSettlement(wallet);

    assertAddress(wallet);
    const [settlement, planet] = await Promise.all([
      this.getGameSettlement(wallet),
      this.getPlanet(selectedPlanetId)
    ]);
    if (!planet || planet.owner.toLowerCase() !== wallet.toLowerCase()) {
      return {
        wallet,
        hasFirstPlanet: settlement.hasFirstPlanet,
        homePlanetId: null,
        planet: null,
        contractKind: "game"
      };
    }

    return {
      wallet,
      hasFirstPlanet: settlement.hasFirstPlanet,
      homePlanetId: planet.planetId,
      planet,
      contractKind: "game"
    };
  }

  private async readPlanetName(planetId: bigint): Promise<string | null> {
    try {
      const value = decodeStringResult(await this.call("0xec16d865", [encodeUint(planetId)]));
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private async readMoonSummary(planet: PlanetState): Promise<ManagedPlanet["moon"]> {
    if (!this.moonContractAddress) return null;
    const planetId = BigInt(planet.planetId);
    try {
      const moon = await this.readMoon(planetId);
      if (!moon.exists) return null;
      const [resources, ships, defenses] = await Promise.all([
        this.readMoonResourcesCall("0x1f20b321", [encodeUint(planetId)]),
        this.readMoonShipRows(planetId),
        this.readMoonDefenseRows(planetId)
      ]);
      return {
        bodyKind: "moon",
        exists: true,
        parentPlanetId: planet.planetId,
        planetId: planet.planetId,
        coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
        resources,
        resourcesAsOfNow: resources,
        ships,
        defenses
      };
    } catch (error) {
      if (isRpcRevert(error)) return null;
      throw error;
    }
  }

  private async readOptionalUintCall(selector: string, args: string[]): Promise<bigint | null> {
    try {
      return await this.readUintCall(selector, args);
    } catch (error) {
      if (isRpcRevert(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readErc20Uint(tokenAddress: Address, selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.callContract(tokenAddress, selector, args)), 0));
  }

  private async getCompactSettlement(wallet: Address): Promise<WalletSettlement> {
    if (!this.settlementContractAddress) {
      return {
        wallet,
        hasFirstPlanet: false,
        homePlanetId: null,
        planet: null,
        contractKind: "settlement"
      };
    }

    const hasFirstPlanet = decodeBoolWord(
      wordAt(splitWords(await this.compactCall("0x1d750846", [encodeAddress(wallet)])), 0)
    );

    if (!hasFirstPlanet) {
      return {
        wallet,
        hasFirstPlanet: false,
        homePlanetId: null,
        planet: null,
        contractKind: "settlement"
      };
    }

    const words = splitWords(await this.compactCall("0x29147f24", [encodeAddress(wallet)]));
    const galaxy = Number(decodeUintWord(wordAt(words, 0)));
    const system = Number(decodeUintWord(wordAt(words, 1)));
    const position = Number(decodeUintWord(wordAt(words, 2)));
    const settledAt = decodeUintWord(wordAt(words, 5)).toString();
    const metadata = planetMetadata(this.chainId, this.settlementContractAddress, { galaxy, system, position });

    return {
      wallet,
      hasFirstPlanet: true,
      homePlanetId: null,
      planet: {
        planetId: `${galaxy}:${system}:${position}`,
        owner: wallet,
        name: null,
        galaxy,
        system,
        position,
        fields: metadata.fields,
        temperature: metadata.temperature,
        metalMultiplierBps: metadata.metalMultiplierBps,
        crystalMultiplierBps: metadata.crystalMultiplierBps,
        deuteriumMultiplierBps: metadata.deuteriumMultiplierBps,
        lastSettledAt: settledAt,
        resources: zeroResources()
      },
      contractKind: "settlement"
    };
  }

  private async readResources(selector: string, firstArg: bigint): Promise<Resources> {
    return decodeResources(splitWords(await this.call(selector, [encodeUint(firstArg)])));
  }

  private async readOptionalResources(selector: string, firstArg: bigint): Promise<Resources | null> {
    try {
      return await this.readResources(selector, firstArg);
    } catch (error) {
      if (isRpcRevert(error)) return null;
      throw error;
    }
  }

  private async readEnergyBalance(planetId: bigint): Promise<EnergyBalance> {
    const words = splitWords(await this.call("0x7938100c", [encodeUint(planetId)]));
    return {
      produced: decodeUintWord(wordAt(words, 0)).toString(),
      required: decodeUintWord(wordAt(words, 1)).toString(),
      scaleBps: decodeUintWord(wordAt(words, 2)).toString()
    };
  }

  private async readResourcesCall(selector: string, args: string[]): Promise<Resources> {
    return decodeResources(splitWords(await this.call(selector, args)));
  }

  private async readMoonResourcesCall(selector: string, args: string[]): Promise<Resources> {
    return decodeResources(splitWords(await this.moonCall(selector, args)));
  }

  private async readUintCall(selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.call(selector, args)), 0));
  }

  private async readStartPrice(): Promise<bigint | undefined> {
    if (!this.startPriceRead) {
      this.startPriceRead = this.fetchStartPrice();
    }
    try {
      return await this.startPriceRead;
    } catch (error) {
      // A transient RPC failure must not poison the memo: drop it so the next funding
      // request retries the read instead of permanently failing.
      this.startPriceRead = undefined;
      throw error;
    }
  }

  private async fetchStartPrice(): Promise<bigint | undefined> {
    try {
      return await this.readUintCall("0xf1a9af89", []);
    } catch (error) {
      if (isRpcRevert(error)) return undefined;
      throw error;
    }
  }

  private async readNativeBalance(wallet: Address): Promise<bigint> {
    return decodeUint(await this.transport.request<string>("eth_getBalance", [
      wallet,
      "latest"
    ]));
  }

  private resourceTokensConfigured(): boolean {
    return Boolean(
      this.resourceTokenAddresses.metal
        && this.resourceTokenAddresses.crystal
        && this.resourceTokenAddresses.deuterium
    );
  }

  private async readMoonUintCall(selector: string, args: string[]): Promise<bigint> {
    return decodeUintWord(wordAt(splitWords(await this.moonCall(selector, args)), 0));
  }

  private async call(selector: string, args: string[]): Promise<string> {
    return this.callContract(this.gameContractAddress, selector, args);
  }

  private async moonCall(selector: string, args: string[]): Promise<string> {
    return this.callContract(this.moonContractAddress ?? this.gameContractAddress, selector, args);
  }

  private async compactCall(selector: string, args: string[]): Promise<string> {
    if (!this.settlementContractAddress) {
      throw new Error("Veydrift settlement contract address is required.");
    }

    return this.callContract(this.settlementContractAddress, selector, args);
  }

  private async readFleetMissionSummaries(): Promise<FleetMissionSummary[]> {
    const missionLogs = await this.getLogs({
      address: this.gameContractAddress,
      fromBlock: toQuantity(this.indexFromBlock),
      toBlock: "latest",
      topics: [[
        fleetMissionLaunchedTopic,
        fleetMissionCargoTopic,
        fleetMissionShipsTopic,
        fleetMissionBodiesTopic,
        fleetMissionRecalledTopic,
        fleetMissionResolvedTopic,
        fleetMissionReturnExposedTopic,
        defenseHoldStationedTopic,
        attackMissionJoinedTopic
      ]]
    });
    const missions = [...decodeFleetMissionLogs(missionLogs).values()].filter(isCompleteFleetMissionSummary);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    // VEY-KANEO-479: only an arrived Attack whose battle randomness has been fulfilled is truly
    // resolvable; fetch the fulfilled request ids so `needsResolution` (and the keeper-facing
    // listResolvableFleetMissions it feeds) never surfaces a phantom-ready attack. Skipped entirely
    // when no Attack has arrived, so the common path adds no extra RPC round trip.
    const fulfilledRandomnessRequestIds = await this.readFulfilledRandomnessRequestIds(missions, nowSeconds);
    return missions.map((mission) => ({
      ...mission,
      needsResolution: fleetMissionNeedsResolution(mission, nowSeconds, fulfilledRandomnessRequestIds)
    }));
  }

  private decodeCanonicalFleetMission(missionId: bigint, result: string): CanonicalFleetMissionSnapshot | null {
    const words = splitWords(result);
    const statusId = Number(decodeUintWord(wordAt(words, 0)));
    const missionTypeId = Number(decodeUintWord(wordAt(words, 1)));
    const owner = decodeAddressWord(wordAt(words, 2));
    if (statusId === 0 || owner === zeroAddress) return null;

    const randomnessRequestId = decodeUintWord(wordAt(words, 12)).toString();
    return {
      missionId: missionId.toString(),
      statusId,
      missionTypeId,
      status: missionStatusLabel(BigInt(statusId)),
      missionType: missionTypeLabel(BigInt(missionTypeId)),
      owner,
      originPlanetId: decodeUintWord(wordAt(words, 3)).toString(),
      targetPlanetId: decodeUintWord(wordAt(words, 4)).toString(),
      departureAt: decodeUintWord(wordAt(words, 5)).toString(),
      arrivalAt: decodeUintWord(wordAt(words, 6)).toString(),
      returnAt: decodeUintWord(wordAt(words, 7)).toString(),
      fuelCost: decodeUintWord(wordAt(words, 8)).toString(),
      cargo: decodeResources(words.slice(9, 12)),
      randomnessRequestId: randomnessRequestId === "0" ? null : randomnessRequestId
    };
  }

  private async readFleetMissionStorageSupplements(
    missionIds: bigint[]
  ): Promise<Map<string, FleetMissionSupplement>> {
    if (missionIds.length === 0) return new Map();
    const slotRequests = missionIds.flatMap((missionId) => {
      const baseSlot = fleetMissionStorageBaseSlot(missionId);
      return [baseSlot + 7n, baseSlot + 8n, baseSlot + 11n];
    });
    const words = await this.batchStorageAt(slotRequests);
    const supplements = new Map<string, FleetMissionSupplement>();
    for (let index = 0; index < missionIds.length; index += 1) {
      const firstShipsWord = words[index * 3] ?? "0x";
      const secondShipsWord = words[index * 3 + 1] ?? "0x";
      const flagsWord = words[index * 3 + 2] ?? "0x";
      supplements.set(missionIds[index]?.toString() ?? "", {
        ships: decodeMissionShipsFromStorage(firstShipsWord, secondShipsWord),
        originIsMoon: decodePackedBool(flagsWord, 0),
        targetIsMoon: decodePackedBool(flagsWord, 1)
      });
    }
    return supplements;
  }

  private async batchStorageAt(slots: bigint[]): Promise<string[]> {
    if (slots.length === 0) return [];
    if (!this.transport.requestBatch) {
      const results: string[] = [];
      for (const slot of slots) {
        results.push(await this.transport.request<string>(
          "eth_getStorageAt",
          [this.gameContractAddress, toQuantity(slot), "latest"]
        ));
      }
      return results;
    }
    return this.transport.requestBatch<string>(slots.map((slot) => ({
      method: "eth_getStorageAt",
      params: [this.gameContractAddress, toQuantity(slot), "latest"]
    })));
  }

  // VEY-KANEO-479: the set of RandomnessEngine request ids already fulfilled on-chain, or null when no
  // gating applies (no randomness engine configured, or no arrived Attack to gate). A null result means
  // "no randomness data" and leaves readiness on the plain arrival check (back-compat).
  private async readFulfilledRandomnessRequestIds(
    missions: FleetMissionSummary[],
    nowSeconds: number
  ): Promise<ReadonlySet<string> | null> {
    if (!this.randomnessEngineAddress) return null;
    const hasGatedArrival = missions.some(
      (mission) =>
        missionBattleRandomnessRequestId(mission) !== null
        && mission.status === "Outbound"
        && Number(mission.arrivalAt) <= nowSeconds
    );
    if (!hasGatedArrival) return null;
    const logs = await this.getLogs({
      address: this.randomnessEngineAddress,
      fromBlock: toQuantity(this.indexFromBlock),
      toBlock: "latest",
      topics: [[randomnessFulfilledTopic]]
    });
    return new Set(logs.map(decodeRandomnessFulfilledRequestId));
  }

  private async readBattleReports(): Promise<BattleReport[]> {
    const logs = await this.getLogs({
      address: this.gameContractAddress,
      fromBlock: toQuantity(this.indexFromBlock),
      toBlock: "latest",
      topics: [[
        attackBattleResolvedTopic,
        combatRoundResolvedTopic,
        combatLossesTopic,
        combatDebrisSignaledTopic
      ]]
    });
    return decodeBattleReports(logs)
      .sort((left, right) => {
        const leftBlock = BigInt(left.blockNumber);
        const rightBlock = BigInt(right.blockNumber);
        if (leftBlock === rightBlock) {
          const leftMission = BigInt(left.missionId);
          const rightMission = BigInt(right.missionId);
          if (leftMission === rightMission) return 0;
          return rightMission > leftMission ? 1 : -1;
        }
        return rightBlock > leftBlock ? 1 : -1;
      });
  }

  private async callContract(contractAddress: Address, selector: string, args: string[]): Promise<string> {
    return this.transport.request<string>("eth_call", [
      {
        to: contractAddress,
        data: `${selector}${args.join("")}`
      },
      "latest"
    ]);
  }

  private async batchCallContract(
    contractAddress: Address,
    calls: Array<{ selector: string; args: string[] }>
  ): Promise<string[]> {
    if (calls.length === 0) return [];
    if (calls.length > maxBatchCallSize) {
      const results: string[] = [];
      for (let index = 0; index < calls.length; index += maxBatchCallSize) {
        results.push(...await this.batchCallContract(contractAddress, calls.slice(index, index + maxBatchCallSize)));
      }
      return results;
    }

    const runSequentially = async (): Promise<string[]> => {
      const results: string[] = [];
      for (const call of calls) {
        results.push(await this.callContract(contractAddress, call.selector, call.args));
      }
      return results;
    };

    if (!this.transport.requestBatch) {
      return runSequentially();
    }

    try {
      return await this.transport.requestBatch<string>(calls.map((call) => ({
        method: "eth_call",
        params: [
          {
            to: contractAddress,
            data: `${call.selector}${call.args.join("")}`
          },
          "latest"
        ]
      })));
    } catch (error) {
      if (!shouldRetryWithoutBatch(error)) {
        throw error;
      }
      return runSequentially();
    }
  }
}

export type MutableFleetMissionSummary = Partial<FleetMissionSummary> & { missionId: string };

export function decodeFleetMissionLogs(logs: RpcLog[]): Map<string, MutableFleetMissionSummary> {
  const missions = new Map<string, MutableFleetMissionSummary>();
  for (const log of logs) {
    const topic = topicAt(log.topics, 0);
    if (topic === attackMissionJoinedTopic) {
      const attackMissionId = decodeUint(topicAt(log.topics, 1)).toString();
      const joinedMissionId = decodeUint(topicAt(log.topics, 2)).toString();
      const attack = missions.get(attackMissionId) ?? {
        missionId: attackMissionId,
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        returnCargo: null,
        ships: {},
        fuelCost: "0",
        recallCost: null,
        attackGroupId: attackMissionId,
        joinedAttackMissionIds: [],
        needsResolution: false,
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString(),
        launchBlockNumber: "0"
      };
      attack.attackGroupId = attackMissionId;
      attack.joinedAttackMissionIds = [
        ...new Set([...(attack.joinedAttackMissionIds ?? []), joinedMissionId])
      ];
      missions.set(attackMissionId, attack);

      const joined = missions.get(joinedMissionId) ?? {
        missionId: joinedMissionId,
        cargo: { metal: "0", crystal: "0", deuterium: "0" },
        returnCargo: null,
        ships: {},
        fuelCost: "0",
        recallCost: null,
        attackGroupId: attackMissionId,
        joinedAttackMissionIds: [],
        needsResolution: false,
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString(),
        launchBlockNumber: "0"
      };
      joined.attackGroupId = attackMissionId;
      missions.set(joinedMissionId, joined);
      continue;
    }

    const missionId = decodeUint(topicAt(log.topics, 1)).toString();
    const mission = missions.get(missionId) ?? {
      missionId,
      cargo: { metal: "0", crystal: "0", deuterium: "0" },
      returnCargo: null,
      ships: {},
      fuelCost: "0",
      recallCost: null,
      attackGroupId: null,
      joinedAttackMissionIds: [],
      defendsMissionId: null,
      counterplayDefenderMissionIds: [],
      needsResolution: false,
      transactionHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber).toString(),
      launchBlockNumber: "0"
    };
    mission.transactionHash = log.transactionHash;
    mission.blockNumber = BigInt(log.blockNumber).toString();

    if (topic === fleetMissionLaunchedTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.missionType = missionTypeLabel(decodeUint(topicAt(log.topics, 3)));
      mission.status = "Outbound";
      // Capture the launch block here (not the rolling `blockNumber`) so the ship-count read model can
      // later tell whether this departure's debit predates the canonical reconcile baseline (VEY-KANEO-447).
      mission.launchBlockNumber = BigInt(log.blockNumber).toString();
      mission.originPlanetId = decodeUintWord(wordAt(words, 0)).toString();
      mission.targetPlanetId = decodeUintWord(wordAt(words, 1)).toString();
      mission.arrivalAt = decodeUintWord(wordAt(words, 2)).toString();
      mission.returnAt = decodeUintWord(wordAt(words, 3)).toString();
      if (mission.missionType === "Attack") {
        // VEY-KANEO-479: an Attack launch always rides its battle RandomnessEngine request id in
        // word 4 (_requestAttackBattleRandomness). Capture it so the read model can gate readiness on
        // the request being fulfilled. Read defensively — some fixtures emit only the first four words.
        mission.randomnessRequestId = words.length > 4 ? decodeUintWord(wordAt(words, 4)).toString() : "0";
      } else if (mission.missionType === "AcsAttack") {
        const attackMissionId = decodeUintWord(wordAt(words, 4)).toString();
        mission.attackGroupId = attackMissionId;
        const attack = missions.get(attackMissionId) ?? {
          missionId: attackMissionId,
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          returnCargo: null,
          ships: {},
          fuelCost: "0",
          recallCost: null,
          attackGroupId: attackMissionId,
          joinedAttackMissionIds: [],
          defendsMissionId: null,
          counterplayDefenderMissionIds: [],
          needsResolution: false,
          transactionHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber).toString(),
          launchBlockNumber: "0"
        };
        attack.attackGroupId = attackMissionId;
        attack.joinedAttackMissionIds = [
          ...new Set([...(attack.joinedAttackMissionIds ?? []), missionId])
        ];
        missions.set(attackMissionId, attack);
      } else if (mission.missionType === "AcsDefend") {
        // VEY-KANEO-442: an AcsDefend fleet stations at the defended planet (its emitted
        // targetPlanetId) to counter a specific hostile attack. The contract encodes that hostile
        // mission id in the FleetMissionLaunched `randomnessRequestId` slot (word 4), the same slot
        // AcsAttack uses for its joined attack id (VeydriftGameplayModule sets
        // `randomnessRequestId = hostileMissionId` for counterplay). Link the defender to the attack
        // so stationed-defense state is queryable from the fleet-mission read model.
        const hostileMissionId = decodeUintWord(wordAt(words, 4)).toString();
        mission.defendsMissionId = hostileMissionId;
        const attack = missions.get(hostileMissionId) ?? {
          missionId: hostileMissionId,
          cargo: { metal: "0", crystal: "0", deuterium: "0" },
          returnCargo: null,
          ships: {},
          fuelCost: "0",
          recallCost: null,
          attackGroupId: null,
          joinedAttackMissionIds: [],
          defendsMissionId: null,
          counterplayDefenderMissionIds: [],
          needsResolution: false,
          transactionHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber).toString(),
          launchBlockNumber: "0"
        };
        attack.counterplayDefenderMissionIds = [
          ...new Set([...(attack.counterplayDefenderMissionIds ?? []), missionId])
        ];
        missions.set(hostileMissionId, attack);
      }
    } else if (topic === defenseHoldStationedTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.missionType = "DefenseHold";
      mission.status = mission.status ?? "Outbound";
      mission.originPlanetId = decodeUintWord(wordAt(words, 0)).toString();
      mission.targetPlanetId = decodeUint(topicAt(log.topics, 3)).toString();
      mission.arrivalAt = decodeUintWord(wordAt(words, 1)).toString();
      mission.defenseHoldUntil = decodeUintWord(wordAt(words, 2)).toString();
      mission.returnAt = decodeUintWord(wordAt(words, 3)).toString();
    } else if (topic === fleetMissionCargoTopic) {
      const words = splitWords(log.data);
      mission.cargo = decodeResources(words.slice(0, 3));
      mission.fuelCost = decodeUintWord(wordAt(words, 3)).toString();
    } else if (topic === fleetMissionShipsTopic) {
      const words = splitWords(log.data);
      mission.ships = Object.fromEntries([
        "smallCargo",
        "lightFighter",
        "recycler",
        "colonyShip",
        "largeCargo",
        "heavyFighter",
        "cruiser",
        "battleship",
        "bomber",
        "destroyer",
        "deathstar",
        "battlecruiser",
        "reaper",
        "pathfinder"
      ].map((key, index) => [key, decodeUintWord(wordAt(words, index)).toString()]));
    } else if (topic === fleetMissionBodiesTopic) {
      const words = splitWords(log.data);
      mission.originIsMoon = decodeUintWord(wordAt(words, 0)) !== 0n;
      mission.targetIsMoon = decodeUintWord(wordAt(words, 1)) !== 0n;
    } else if (topic === fleetMissionRecalledTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.status = "Recalled";
      mission.returnAt = decodeUintWord(wordAt(words, 0)).toString();
      mission.recallCost = decodeUintWord(wordAt(words, 1)).toString();
    } else if (topic === fleetMissionResolvedTopic) {
      mission.returnAt = decodeUintWord(wordAt(splitWords(log.data), 0)).toString();
      if (mission.status !== "Returning" && mission.status !== "Recalled") {
        mission.status = "Resolved";
      }
    } else if (topic === fleetMissionReturnExposedTopic) {
      const words = splitWords(log.data);
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.status = missionStatusLabel(decodeUint(topicAt(log.topics, 3)));
      mission.originPlanetId = decodeUintWord(wordAt(words, 0)).toString();
      mission.targetPlanetId = decodeUintWord(wordAt(words, 1)).toString();
      mission.returnAt = decodeUintWord(wordAt(words, 2)).toString();
      // Do NOT overwrite mission.cargo here. FleetMissionReturnExposed carries the return-leg cargo,
      // which the contract has already folded looted resources into (VeydriftCombatModule
      // ._assignLootShare credits loot into mission.cargo before this event fires). Using it made
      // "Cargo carried" report outbound cargo + loot — e.g. a pure attack that loaded 0 and looted
      // 50 metal showed Cargo 50 / Loot 50 (VEY-404). The outbound launch cargo from
      // FleetMissionCargo is authoritative for `cargo`; loot is surfaced separately from the
      // AttackBattleResolved battle report.
      //
      // We DO capture the return-leg cargo separately as `returnCargo`. The main attacker's loot is
      // read from its AttackBattleResolved event, but joined ACS fleets never emit their own battle
      // report — their only on-chain loot signal is this resulting cargo, which the ACS battle report
      // surfaces as each joiner's individual loot share (VEY-KANEO-432).
      mission.returnCargo = decodeResources(words.slice(3, 6));
    } else if (topic === fleetMissionReturnedTopic) {
      mission.owner = decodeAddressWord(topicAt(log.topics, 2));
      mission.status = "Returned";
      mission.originPlanetId = decodeUint(topicAt(log.topics, 3)).toString();
    }

    missions.set(missionId, mission);
  }

  // Project the recall cost for fleets that can still be recalled (Outbound, no recall event yet) so
  // Mission Detail / Mission Control can surface the Recall action and its deuterium cost instead of
  // falling back to "Not recallable" (VEY-KANEO-424). Recalled fleets keep the authoritative cost
  // emitted by FleetMissionRecalled; finished/returning fleets stay null since recall no longer applies.
  for (const mission of missions.values()) {
    if (mission.recallCost == null && mission.status === "Outbound") {
      mission.recallCost = projectedFleetRecallCost(mission.fuelCost ?? "0");
    }
  }

  return missions;
}

export function decodeCompleteFleetMissionLogs(logs: RpcLog[]): FleetMissionSummary[] {
  return [...decodeFleetMissionLogs(logs).values()].filter(isCompleteFleetMissionSummary);
}

// VEY-KANEO-479: a RandomnessEngine.RandomnessFulfilled log. topics[0] is the event signature and
// the indexed `requestId` is the first indexed parameter, i.e. topics[1] (decoded just below).
export function isRandomnessFulfilledLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === randomnessFulfilledTopic;
}

export function decodeRandomnessFulfilledRequestId(log: RpcLog): string {
  return decodeUint(topicAt(log.topics, 1)).toString();
}

// VEY-KANEO-479: the battle RandomnessEngine request id a mission's resolution consumes, or null when
// the mission carries no battle randomness. Only Attack battles request randomness at launch; Harvest
// and the other resolvable types resolve deterministically, so they are never gated.
export function missionBattleRandomnessRequestId(
  mission: Pick<FleetMissionSummary, "missionType" | "randomnessRequestId">
): string | null {
  if (mission.missionType !== "Attack") return null;
  const requestId = mission.randomnessRequestId;
  if (!requestId || requestId === "0") return null;
  return requestId;
}

// VEY-KANEO-479: whether a mission's arrival leg is actually resolvable now. An arrived Attack is only
// resolvable once its battle randomness has been fulfilled (consumeRandomness reverts with
// PendingRandomness until then), so gating `needsResolution` on it stops Mission Control from showing a
// phantom "Ready to resolve" — and the keeper from attempting a doomed resolve — before the fulfiller
// commits the word. `fulfilledRandomnessRequestIds` is null when no randomness data is available (e.g.
// the engine is not configured); in that case readiness falls back to the plain arrival check.
export function fleetMissionNeedsResolution(
  mission: Pick<FleetMissionSummary, "status" | "arrivalAt" | "returnAt" | "missionType" | "randomnessRequestId"> & Pick<Partial<FleetMissionSummary>, "defenseHoldUntil">,
  nowSeconds: number,
  fulfilledRandomnessRequestIds: ReadonlySet<string> | null
): boolean {
  if (mission.status !== "Outbound") return false;
  const dueAt = mission.missionType === "DefenseHold"
    ? Number(mission.defenseHoldUntil ?? mission.returnAt)
    : Number(mission.arrivalAt);
  if (dueAt > nowSeconds) return false;
  const requestId = missionBattleRandomnessRequestId(mission);
  if (requestId !== null && fulfilledRandomnessRequestIds !== null) {
    return fulfilledRandomnessRequestIds.has(requestId);
  }
  return true;
}

export function isBattleReportLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === attackBattleResolvedTopic
    || topic === combatRoundResolvedTopic
    || topic === combatLossesTopic
    || topic === combatDebrisSignaledTopic;
}

export function decodeBattleReportLogs(logs: RpcLog[], requestedMissionId?: string): BattleReport | null {
  let base: Omit<BattleReport, "attackGroupId" | "attackerLosses" | "debris" | "defenderLosses" | "defenderSnapshot" | "participants" | "roundReports"> | null = null;
  let attackerLosses: Resources = emptyResources();
  let defenderLosses: Resources = emptyResources();
  let debris: BattleReport["debris"] = { metal: "0", crystal: "0" };
  const roundReports: CombatRoundReport[] = [];

  for (const log of logs) {
    const topic = topicAt(log.topics, 0);
    if (!isBattleReportLog(log)) continue;

    const missionId = decodeUint(topicAt(log.topics, 1)).toString();
    if (requestedMissionId && missionId !== requestedMissionId) continue;

    const words = splitWords(log.data);
    if (topic === attackBattleResolvedTopic) {
      base = {
        missionId,
        attacker: decodeAddressWord(topicAt(log.topics, 2)),
        targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
        outcome: battleOutcomeLabel(decodeUintWord(wordAt(words, 0))),
        rounds: Number(decodeUintWord(wordAt(words, 1))),
        randomSeed: decodeUintWord(wordAt(words, 2)).toString(),
        loot: decodeResources(words.slice(3, 6)),
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber).toString(),
        logIndex: log.logIndex ?? "0x0"
      };
    } else if (topic === combatRoundResolvedTopic) {
      roundReports.push({
        round: Number(decodeUint(topicAt(log.topics, 2))),
        attackerUnits: decodeUintWord(wordAt(words, 0)).toString(),
        defenderUnits: decodeUintWord(wordAt(words, 1)).toString(),
        attackerLosses: {
          metal: decodeUintWord(wordAt(words, 2)).toString(),
          crystal: decodeUintWord(wordAt(words, 3)).toString(),
          deuterium: "0"
        },
        defenderLosses: {
          metal: decodeUintWord(wordAt(words, 4)).toString(),
          crystal: decodeUintWord(wordAt(words, 5)).toString(),
          deuterium: "0"
        }
      });
    } else if (topic === combatLossesTopic) {
      attackerLosses = decodeResources(words.slice(0, 3));
      defenderLosses = decodeResources(words.slice(3, 6));
    } else if (topic === combatDebrisSignaledTopic) {
      debris = {
        metal: decodeUintWord(wordAt(words, 0)).toString(),
        crystal: decodeUintWord(wordAt(words, 1)).toString()
      };
    }
  }

  if (!base) return null;

  return {
    ...base,
    attackerLosses,
    defenderLosses,
    debris,
    defenderSnapshot: null,
    roundReports: roundReports.sort((left, right) => left.round - right.round),
    // Default to a solo report: the main attacker is the only participant and its loot is the report
    // loot. attachAttackGroupParticipants() later folds in any ACS joiners and the group id once the
    // fleet-mission read model is available; a report decoded in isolation still carries the attacker.
    attackGroupId: null,
    participants: [
      {
        missionId: base.missionId,
        address: base.attacker,
        isMainAttacker: true,
        ships: {},
        loot: base.loot
      }
    ]
  };
}

// Fold the ACS attack group into each battle report: list every participant (main attacker + joined
// fleets) with their individual loot share. Joined fleets never emit their own AttackBattleResolved,
// so a joiner's loot is its resulting return-leg cargo (`returnCargo`), captured from
// FleetMissionReturnExposed. The main attacker keeps its battle-report loot. `attackGroupId` is set
// when the main mission has any joiners. Solo attacks are returned unchanged (single participant).
export function attachAttackGroupParticipants(
  reports: BattleReport[],
  missions: FleetMissionSummary[]
): BattleReport[] {
  const missionById = new Map(missions.map((mission) => [mission.missionId, mission]));
  return reports.map((report) => {
    const mainMission = missionById.get(report.missionId);
    const participants: BattleReportParticipant[] = [
      {
        missionId: report.missionId,
        address: report.attacker,
        isMainAttacker: true,
        ships: mainMission?.ships ?? {},
        loot: report.loot
      }
    ];

    const joinedMissionIds = mainMission?.joinedAttackMissionIds ?? [];
    for (const joinedMissionId of joinedMissionIds) {
      const joined = missionById.get(joinedMissionId);
      if (!joined) continue;
      participants.push({
        missionId: joinedMissionId,
        address: joined.owner,
        isMainAttacker: false,
        ships: joined.ships,
        // The joiner's resulting cargo after combat is its loot share. Null (fleet still outbound or
        // wiped at the target, so it hauled nothing) reports as zero.
        loot: joined.returnCargo ?? emptyResources()
      });
    }

    return {
      ...report,
      originIsMoon: Boolean(mainMission?.originIsMoon ?? report.originIsMoon),
      targetIsMoon: Boolean(mainMission?.targetIsMoon ?? report.targetIsMoon),
      attackGroupId: joinedMissionIds.length > 0 ? (mainMission?.attackGroupId ?? report.missionId) : null,
      participants
    };
  });
}

export function decodeBattleReports(logs: RpcLog[]): BattleReport[] {
  const missionIds = new Set<string>();
  for (const log of logs) {
    if (isBattleReportLog(log)) {
      missionIds.add(decodeUint(topicAt(log.topics, 1)).toString());
    }
  }

  return [...missionIds]
    .map((missionId) => decodeBattleReportLogs(logs, missionId))
    .filter((report): report is BattleReport => Boolean(report))
    .sort((left, right) => {
      const leftBlock = BigInt(left.blockNumber);
      const rightBlock = BigInt(right.blockNumber);
      if (leftBlock === rightBlock) return 0;
      return leftBlock < rightBlock ? 1 : -1;
    });
}

function isCompleteFleetMissionSummary(mission: MutableFleetMissionSummary): mission is FleetMissionSummary {
  return Boolean(
    mission.status
      && mission.missionType
      && mission.owner
      && mission.originPlanetId
      && mission.targetPlanetId
      && mission.arrivalAt
      && mission.returnAt
      && mission.fuelCost !== undefined
      && mission.attackGroupId !== undefined
      && mission.joinedAttackMissionIds
      && mission.defendsMissionId !== undefined
      && mission.counterplayDefenderMissionIds
      && mission.cargo
      && mission.ships
      && mission.transactionHash
      && mission.blockNumber
      && mission.needsResolution !== undefined
  );
}

function isVisibleCompletedMission(
  mission: FleetMissionSummary,
  walletLower: string,
  ownedPlanetIds: ReadonlySet<string>
): boolean {
  if (mission.status !== "Resolved" && mission.status !== "Returned") return false;
  return mission.owner.toLowerCase() === walletLower || ownedPlanetIds.has(mission.targetPlanetId);
}

function compareFleetMissionsNewestFirst(left: FleetMissionSummary, right: FleetMissionSummary): number {
  const leftTime = Number(left.status === "Returned" ? left.returnAt : left.arrivalAt);
  const rightTime = Number(right.status === "Returned" ? right.returnAt : right.arrivalAt);
  if (leftTime !== rightTime) return rightTime - leftTime;
  const leftBlock = BigInt(left.blockNumber);
  const rightBlock = BigInt(right.blockNumber);
  if (leftBlock !== rightBlock) return rightBlock > leftBlock ? 1 : -1;
  const leftMission = BigInt(left.missionId);
  const rightMission = BigInt(right.missionId);
  if (leftMission === rightMission) return 0;
  return rightMission > leftMission ? 1 : -1;
}

function missionTypeLabel(value: bigint): string {
  return missionTypes[Number(value)] ?? `Unknown:${value.toString()}`;
}

function missionStatusLabel(value: bigint): string {
  return missionStatuses[Number(value)] ?? `Unknown:${value.toString()}`;
}

// VEY-KANEO-424: the only on-chain event that carries a recall cost is FleetMissionRecalled, so an
// Outbound fleet that has not been recalled yet decodes with recallCost: null. That null made the
// Mission Detail page hide the Recall button and render "Not recallable" for a fleet that can still
// be recalled. The contract derives the recall cost deterministically from the mission's fuel cost
// (VeydriftGameplayModule._fleetRecallCost: floor(fuelCost * FLEET_RECALL_COST_BPS / BPS), with a
// floor of 1 deuterium whenever any fuel was spent), so we project the same value for still-recallable
// Outbound missions instead of leaving it null. A real recall later overwrites this with the emitted
// amount, which equals this projection.
const fleetRecallCostBps = 2_500n;
const fleetRecallCostBpsDenominator = 10_000n;

function projectedFleetRecallCost(fuelCost: string): string {
  const fuel = BigInt(fuelCost);
  if (fuel <= 0n) return "0";
  const cost = (fuel * fleetRecallCostBps) / fleetRecallCostBpsDenominator;
  return (cost === 0n ? 1n : cost).toString();
}

function battleOutcomeLabel(value: bigint): BattleOutcomeName {
  return battleOutcomes[Number(value)] ?? "Draw";
}

function emptyResources(): Resources {
  return { metal: "0", crystal: "0", deuterium: "0" };
}

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const maxBatchCallSize = 50;
const buildingCount = 16;
const defenseCount = 10;
const supportedShipIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const missionShipKeys = [
  "smallCargo",
  "lightFighter",
  "recycler",
  "colonyShip",
  "largeCargo",
  "heavyFighter",
  "cruiser",
  "battleship",
  "bomber",
  "destroyer",
  "deathstar",
  "battlecruiser",
  "reaper",
  "pathfinder"
] as const;
const supportedTechnologyIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const riftBuildingId = 15;
const riftWithdrawalDelaySeconds = 30 * 24 * 60 * 60;
const riftResourceCatalog: Array<Pick<RiftResourceState, "key" | "label" | "resourceId">> = [
  { key: "metal", label: "Metal", resourceId: 0 },
  { key: "crystal", label: "Crystal", resourceId: 1 },
  { key: "deuterium", label: "Deuterium", resourceId: 2 }
];
const moonBuildingCatalog: Array<Pick<MoonState["buildings"][number], "id" | "key" | "label">> = [
  { id: 0, key: "lunarBase", label: "Lunar Base" },
  { id: 1, key: "roboticsFactory", label: "Robotics Factory" },
  { id: 2, key: "jumpGate", label: "Jump Gate" },
  { id: 3, key: "shipyard", label: "Shipyard" }
];
const planetStartedTopic = "0xef2d7a7105128f441ebc83d8e2e87960a9b0dfdfa02cc68769872b2c52a431f3";
const colonyCreatedTopic = "0xd7d717f6607ff051c7f2247d5c490eb9ece607b9ee7c7eee946898025815cfc0";
const planetSettledTopic = "0x7faee98c7c745f9c9fb2117a44185f57454dac3013383364df4c22b5f9bc4077";
const moonResourcesSettledTopic = "0xb20fd9e652e1b740544f362fb3047c43a7bf0d6c7fbf0f5cab5f1f939aac6917";
const planetRenamedTopic = "0x2b772c1fa271aad466ce009b6b5824b2ad6ccd942d21efc686513ffa8eb166cd";
const buildingStartedTopic = "0x48456f4ba6902f09ee7c2958aca9c9d1f8a5920c8affef08667504670f8bba1b";
const buildingCompletedTopic = "0xa2543cf02e1a3601ccdc4fff81d99ff1225eaf4ad629fbd0f724d61db252c370";
const defenseQueuedTopic = "0xc3dcdf6abcac9fc4831745727e78f808922f43da079b984420ef70c97cff0f5b";
const defenseCompletedTopic = "0xcc99fccb631bf08aef4833c0cbd43ed8d19a40eacce0fe225beff1693a903aa6";
const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";
const shipCompletedTopic = "0xd261dd8008086de5ef74708b23f5f21be1962fee33795961e03a5750c4897785";
const researchQueuedTopic = "0x2c3d4c823cd097fa6cbea60fb91c561d6a497270c397a8c8258170458fe69e73";
const researchCompletedTopic = "0x93dffeb1ed0a05133592cf6d82b9a200c2ac72b521497b81cef83ac57cb84b4f";
const debrisFieldUpdatedTopic = "0x49f79a15c2a0409be62598b886efd90e25154bb9156b4bd64df41fd515aa4909";
const planetShipCountChangedTopic = "0x6a0fc6b08970eb9f7e15767e6902471ca8731c57dbe4577c76021e1f9d6762cf";
const planetDefenseCountChangedTopic = "0xe861e6f62777a3f6ea372d2892ead2d43e27d726e0ae4a2e39e5c3b682a7bbd3";
const moonResourcesChangedTopic = "0xd1823653b6a3910ee502390b5bf01f05a3b571dc81899a6ac3af3f01fae05c26";
const moonShipCountChangedTopic = "0xbd55c2b529f64f3a888d38432d6c54b03515f3de3f0114255cb36620f5df1257";
const moonDefenseCountChangedTopic = "0x0bf9a31209477c6f81619cdd411e232ee9a5b64ec763c598ce43d938cc6194a2";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionBodiesTopic = "0xfa464e2180f08e3e4d8c4247566d0616a5e1ab845d1678c47fedae6d44e9c502";
const fleetMissionRecalledTopic = "0x2c9b31f1abc732f3b6d28e7724439ea4713ae516632088b8c4dc0211479dc6ca";
const fleetMissionResolvedTopic = "0xcb928b431ffcdbe55fddc2bf06967951efb3dfe87d14bc436d546fdbbee9cb2d";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const fleetMissionReturnedTopic = "0xbb4a50257c10524783e403a4e0db9c4c3e9378c2e398ec5de34281be1aa97b06";
const defenseHoldStationedTopic = "0x1183ab32cc2efce96b8c0956b35dd1b46c594234a5717fd810d8cc569a193a47";
const attackMissionJoinedTopic = "0xc584e0cc52df45c2a92cc5556e493377d69bfe3e3658d1adb13f27cfcc89b146";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
const combatDebrisSignaledTopic = "0xd0fbe8b5c73fec6dcfc5fef85459b695d1c9fedb4f94f9748ecaeff785192f14";
const interplanetaryMissileAttackTopic = "0x44a8c2b7632935050468ed4d9acfb1e99a09cec32fd65811964b95b3693f872c";
// RandomnessEngine.RandomnessFulfilled(uint256 indexed requestId, address indexed requester,
// bytes32 indexed purposeHash, uint64 fulfilledAt, uint256 randomWord). Emitted when the fulfiller
// reveals the random word for a request — the moment a randomness-gated mission (an Attack battle)
// actually becomes resolvable (consumeRandomness reverts with PendingRandomness until then).
const randomnessFulfilledTopic = "0x864b23caf5999ffe7e7b5bc685db237bcef9eb7bd6423c2fd395d9b4663372f5";
const referralCodeClaimedTopic = "0xa7124569721bd8a9fca99961778919ebde17b82e397d5dbeb14eb7b5e1e051fb";
const referralInviteRedeemedTopic = "0x897cc27985afe9fc1880f96288d655b8348796f5ab4cda3eb835be64f8b97088";
const missionTypes = ["Transport", "Deploy", "Colonize", "Attack", "Harvest", "AcsDefend", "Intercept", "MissileAttack", "AcsAttack", "DefenseHold"] as const;
const missionStatuses = ["None", "Outbound", "Returning", "Resolved", "Returned", "Recalled"] as const;
const battleOutcomes = ["Draw", "AttackerWin", "DefenderWin"] as const;
const moonChanceRequestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const moonChanceFinalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const moonChanceSkippedExistingMoonTopic =
  "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";
const moonDestructionRequestedTopic = "0x719ab77026e22a766a85f5c32e5294b20e76b8a0490812761ab98ab3a1739884";
const moonDestructionFinalizedTopic = "0xdac71b69e1912e36573457fd7e6227e8b5ac86e9e011bd7eddc6c104221ed803";
const moonCreatedTopic = "0x395ddd11cfc613034fc4941029df5968212af4a52ba611d84d3257824c81f4a4";
const moonBuildingStartedTopic = "0x6b41aeb096e643752dad879b8f3875d8657186226c3cf8b6e7a38c27292f215a";
const moonBuildingCompletedTopic = "0x59b630c46c04307254808aac61ea2de2a7e6fbf5ed6eb0ebee81c917b575ed3a";
const moonDefenseQueuedTopic = "0xa53d76ce638ebf6aee45c30e9622beeafc4e9c2c9bcd3122a72a3a7e00500637";
const moonDefenseCompletedTopic = "0xb84a089b29951e8696b0ef11e5766578a0e1348284a93e4731fcb416d0536a70";
const jumpGateJumpedTopic = "0xf255456c5522e3e1e2a8063b9e1e2f5cd7243315601b1e8aef2893fe9efc3da6";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceInviteCreatedTopic = "0x2ebeddd3f0119f5464f0f6acb95cbc1477a11e19b059f3234bbb0a671cf2b4bd";
const allianceInviteCancelledTopic = "0x37f5074a814d223ffd29f3e588b4c5c9279cbe4437f691ea0fcf9733d6170255";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinRequestCancelledTopic = "0x5b419221dee71707c4c46c47fa5abb0ae9022d7d37ddaa155aef0aac6cb8b024";
const allianceJoinRequestDismissedTopic = "0xf1fb2103850257aab7ba733ed187ccfcf7483e838bc9d1b725c584a0eaac8cd3";
const allianceJoinRequestApprovedTopic = "0xca0494582fd691cc814cd70d0af7915183b6b0a5b45ede056afe6d4fb9d85a28";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
const allianceLeftTopic = "0x65b0be45688803f341e315da7be3de9dd83ebf51eb3cccb3788080695e19ec54";
const allianceRoleUpdatedTopic = "0xe4ba1cf47cfd4ff05de8585bf5cb06e7b0856932c0d81ef64a3458e26877f30d";
const allianceOwnershipTransferredTopic = "0x68f6446f7a86cbeefdd42de0fd5fe8291d2183c90343d9a43c0cdc976e5a1617";
const allianceDiplomacyUpdatedTopic = "0x3df4b2aa5708b43ef1805908826beae5c9a30fb60b1952ad99ce3444b2eec6da";
const marketResourceDepositedTopic = "0xb241f95d5e925b76c75fd1e811b497abfdc0984105f5b3feb7bee1a75f0a2643";
const marketResourceWithdrawalRequestedTopic = "0xc4694dfe978480c576eacc57b2b09e69c8b8f50c49739ca4c4515295be589eab";
const marketResourceWithdrawalFinishedTopic = "0x2b254e656a481b3978a707e6846146a1d7a3144e414cb803bbc7adc97d7587ee";

const eventNamesByTopic = new Map<string, string>([
  [planetStartedTopic, "PlanetStarted"],
  [colonyCreatedTopic, "ColonyCreated"],
  [planetSettledTopic, "PlanetSettled"],
  [moonResourcesSettledTopic, "MoonResourcesSettled"],
  [planetRenamedTopic, "PlanetRenamed"],
  [buildingStartedTopic, "BuildingStarted"],
  [buildingCompletedTopic, "BuildingCompleted"],
  [defenseQueuedTopic, "DefenseQueued"],
  [defenseCompletedTopic, "DefenseCompleted"],
  [shipQueuedTopic, "ShipQueued"],
  [shipCompletedTopic, "ShipCompleted"],
  [researchQueuedTopic, "ResearchQueued"],
  [researchCompletedTopic, "ResearchCompleted"],
  [debrisFieldUpdatedTopic, "DebrisFieldUpdated"],
  [planetShipCountChangedTopic, "PlanetShipCountChanged"],
  [planetDefenseCountChangedTopic, "PlanetDefenseCountChanged"],
  [moonResourcesChangedTopic, "MoonResourcesChanged"],
  [moonShipCountChangedTopic, "MoonShipCountChanged"],
  [moonDefenseCountChangedTopic, "MoonDefenseCountChanged"],
  [fleetMissionLaunchedTopic, "FleetMissionLaunched"],
  [fleetMissionCargoTopic, "FleetMissionCargo"],
  [fleetMissionShipsTopic, "FleetMissionShips"],
  [fleetMissionBodiesTopic, "FleetMissionBodies"],
  [fleetMissionRecalledTopic, "FleetMissionRecalled"],
  [fleetMissionResolvedTopic, "FleetMissionResolved"],
  [fleetMissionReturnExposedTopic, "FleetMissionReturnExposed"],
  [fleetMissionReturnedTopic, "FleetMissionReturned"],
  [defenseHoldStationedTopic, "DefenseHoldStationed"],
  [attackMissionJoinedTopic, "AttackMissionJoined"],
  [attackBattleResolvedTopic, "AttackBattleResolved"],
  [combatRoundResolvedTopic, "CombatRoundResolved"],
  [combatLossesTopic, "CombatLosses"],
  [combatDebrisSignaledTopic, "CombatDebrisSignaled"],
  [interplanetaryMissileAttackTopic, "InterplanetaryMissileAttack"],
  [randomnessFulfilledTopic, "RandomnessFulfilled"],
  [referralCodeClaimedTopic, "ReferralCodeClaimed"],
  [referralInviteRedeemedTopic, "ReferralInviteRedeemed"],
  [moonChanceRequestedTopic, "MoonChanceRequested"],
  [moonChanceFinalizedTopic, "MoonChanceFinalized"],
  [moonChanceSkippedExistingMoonTopic, "MoonChanceSkippedExistingMoon"],
  [moonDestructionRequestedTopic, "MoonDestructionRequested"],
  [moonDestructionFinalizedTopic, "MoonDestructionFinalized"],
  [moonCreatedTopic, "MoonCreated"],
  [moonBuildingStartedTopic, "MoonBuildingStarted"],
  [moonBuildingCompletedTopic, "MoonBuildingCompleted"],
  [moonDefenseQueuedTopic, "MoonDefenseQueued"],
  [moonDefenseCompletedTopic, "MoonDefenseCompleted"],
  [jumpGateJumpedTopic, "JumpGateJumped"],
  [allianceCreatedTopic, "AllianceCreated"],
  [allianceProfileUpdatedTopic, "AllianceProfileUpdated"],
  [allianceInviteCreatedTopic, "AllianceInviteCreated"],
  [allianceInviteCancelledTopic, "AllianceInviteCancelled"],
  [allianceJoinRequestedTopic, "AllianceJoinRequested"],
  [allianceJoinRequestCancelledTopic, "AllianceJoinRequestCancelled"],
  [allianceJoinRequestDismissedTopic, "AllianceJoinRequestDismissed"],
  [allianceJoinRequestApprovedTopic, "AllianceJoinRequestApproved"],
  [allianceJoinedTopic, "AllianceJoined"],
  [allianceLeftTopic, "AllianceLeft"],
  [allianceRoleUpdatedTopic, "AllianceRoleUpdated"],
  [allianceOwnershipTransferredTopic, "AllianceOwnershipTransferred"],
  [allianceDiplomacyUpdatedTopic, "AllianceDiplomacyUpdated"],
  [marketResourceDepositedTopic, "MarketResourceDeposited"],
  [marketResourceWithdrawalRequestedTopic, "MarketResourceWithdrawalRequested"],
  [marketResourceWithdrawalFinishedTopic, "MarketResourceWithdrawalFinished"]
]);

export function eventNameForTopic(topic: string | null | undefined): string | null {
  return topic ? eventNamesByTopic.get(topic) ?? null : null;
}

export function assertAddress(address: string): asserts address is Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid EVM address.");
  }
}

function emptyRiftState(wallet: Address, homePlanetId: string | null, unavailableReason: string): RiftState {
  return {
    wallet,
    homePlanetId,
    riftAvailable: false,
    unlocked: false,
    unavailableReason,
    withdrawalDelaySeconds: riftWithdrawalDelaySeconds.toString(),
    requirements: riftRequirements(null, 0, 0, {}),
    resources: riftResourceCatalog.map((resource) => ({
      ...resource,
      tokenAddress: null,
      walletBalance: null,
      allowance: null,
      inGameBalance: "0",
      lockedBalance: "0"
    })),
    pendingWithdrawals: []
  };
}

function emptyMoonState(wallet: Address, homePlanetId: string | null, unavailableReason: string): MoonState {
  const resources = zeroResources();
  return {
    wallet,
    bodyKind: "moon",
    homePlanetId,
    parentPlanetId: homePlanetId,
    moonAvailable: false,
    unavailableReason,
    resources,
    resourcesAsOfNow: resources,
    ships: [],
    defenses: deriveDefenseRows(() => 0).filter((defense) => defense.id <= 7),
    moon: null,
    fleet: [],
    buildings: moonBuildingCatalog.map((building) => ({
      ...building,
      level: 0,
      cost: zeroResources()
    })),
    queue: null,
    technologyLevels: {},
    defenseQueue: null
  };
}

export function riftRequirements(
  riftBuilt: boolean | null,
  roboticsLevel: number,
  researchLabLevel: number,
  technologyLevels: Record<string, number>
): RiftRequirement[] {
  return [
    {
      kind: "building",
      key: "interdimensionalRiftStabilizer",
      label: "Rift Stabilizer",
      currentLevel: riftBuilt === null ? null : riftBuilt ? 1 : 0,
      requiredLevel: 1,
      binary: true,
      built: riftBuilt
    },
    {
      kind: "building",
      key: "roboticsFactory",
      label: "Robotics Factory",
      currentLevel: roboticsLevel,
      requiredLevel: 4
    },
    {
      kind: "building",
      key: "researchLab",
      label: "Research Lab",
      currentLevel: researchLabLevel,
      requiredLevel: 2
    },
    {
      kind: "technology",
      key: "energy",
      label: "Energy Technology",
      currentLevel: technologyLevels["0"] ?? 0,
      requiredLevel: 5
    },
    {
      kind: "technology",
      key: "hyperspace",
      label: "Hyperspace Technology",
      currentLevel: technologyLevels["8"] ?? 0,
      requiredLevel: 1
    },
  ];
}

export function isSettledPlanetLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === planetStartedTopic || topic === colonyCreatedTopic;
}

export function isPlanetSettledLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetSettledTopic;
}

export function isMoonResourcesSettledLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonResourcesSettledTopic;
}

export function isPlanetRenamedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetRenamedTopic;
}

export function isDebrisFieldLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === debrisFieldUpdatedTopic;
}

export function isShipCountChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetShipCountChangedTopic;
}

export function isMoonResourcesChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonResourcesChangedTopic;
}

export function isDefenseCountChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === planetDefenseCountChangedTopic;
}

export function isMoonShipCountChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonShipCountChangedTopic;
}

export function isMoonDefenseCountChangedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonDefenseCountChangedTopic;
}

export function isInterplanetaryMissileAttackLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === interplanetaryMissileAttackTopic;
}

export function isReferralClaimLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === referralCodeClaimedTopic;
}

export function isReferralRedemptionLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === referralInviteRedeemedTopic;
}

export function isIndexedQueueStartedLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === buildingStartedTopic
    || topic === defenseQueuedTopic
    || topic === shipQueuedTopic
    || topic === researchQueuedTopic
    || topic === moonBuildingStartedTopic
    || topic === moonDefenseQueuedTopic;
}

export function isIndexedQueueCompletedLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === buildingCompletedTopic
    || topic === defenseCompletedTopic
    || topic === shipCompletedTopic
    || topic === researchCompletedTopic
    || topic === moonBuildingCompletedTopic
    || topic === moonDefenseCompletedTopic;
}

export function isMoonCreatedLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === moonCreatedTopic;
}

export function isMoonJumpGateLog(log: RpcLog): boolean {
  return topicAt(log.topics, 0) === jumpGateJumpedTopic;
}

export function isRiftResourceLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === marketResourceDepositedTopic
    || topic === marketResourceWithdrawalRequestedTopic
    || topic === marketResourceWithdrawalFinishedTopic;
}

export function isAllianceLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === allianceCreatedTopic
    || topic === allianceProfileUpdatedTopic
    || topic === allianceInviteCreatedTopic
    || topic === allianceInviteCancelledTopic
    || topic === allianceJoinRequestedTopic
    || topic === allianceJoinRequestCancelledTopic
    || topic === allianceJoinRequestDismissedTopic
    || topic === allianceJoinRequestApprovedTopic
    || topic === allianceJoinedTopic
    || topic === allianceLeftTopic
    || topic === allianceRoleUpdatedTopic
    || topic === allianceOwnershipTransferredTopic
    || topic === allianceDiplomacyUpdatedTopic;
}

export function isFleetMissionLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === fleetMissionLaunchedTopic
    || topic === fleetMissionCargoTopic
    || topic === fleetMissionShipsTopic
    || topic === fleetMissionBodiesTopic
    || topic === fleetMissionRecalledTopic
    || topic === fleetMissionResolvedTopic
    || topic === fleetMissionReturnExposedTopic
    || topic === fleetMissionReturnedTopic
    || topic === defenseHoldStationedTopic
    || topic === attackMissionJoinedTopic;
}

// VEY-KANEO-489: decode a FleetMissionLaunched log into the attacker + target it records against the
// per-(attacker, defender, planet) bashing window. Only `Attack` missions call _recordAttack on the
// contract (VeydriftGameplayModule._sendFleet); AcsAttack joiners, AcsDefend, and the non-combat types
// never increment the window, and every non-launch fleet log is irrelevant — all of those return null.
// The contract anchors each window at block.timestamp of the launch, so the indexed read model can
// replay it from these logs (plus their block timestamps) instead of a live attackProtectionStatus call.
export function decodeAttackMissionLaunch(
  log: RpcLog
): { attacker: Address; targetPlanetId: string } | null {
  try {
    if (topicAt(log.topics, 0) !== fleetMissionLaunchedTopic) return null;
    if (missionTypeLabel(decodeUint(topicAt(log.topics, 3))) !== "Attack") return null;
    const attacker = decodeAddressWord(topicAt(log.topics, 2)).toLowerCase() as Address;
    const targetPlanetId = decodeUintWord(wordAt(splitWords(log.data), 1)).toString();
    return { attacker, targetPlanetId };
  } catch {
    return null;
  }
}

// A fleet-mission log that signals a mission reaching an end state — combat resolved, a return-leg
// exposed, or the fleet physically home. The event-driven ship read model uses these to trigger a
// bounded, per-planet canonical reconcile for combat missions (whose survivor/defender losses the
// contract emits no ship-count event for), instead of sweeping every planet on a timer (VEY-KANEO-461).
export function isFleetMissionSettlementLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === fleetMissionResolvedTopic
    || topic === fleetMissionReturnExposedTopic
    || topic === fleetMissionReturnedTopic;
}

export function canonicalHealPlanetIdsForLog(log: RpcLog): string[] {
  const topic = topicAt(log.topics, 0);
  const planetIds = new Set<string>();
  const addDataWord = (index: number) => {
    const value = decodeUintWord(wordAt(splitWords(log.data), index));
    if (value > 0n) planetIds.add(value.toString());
  };
  const addTopic = (index: number) => {
    const value = decodeUint(topicAt(log.topics, index));
    if (value > 0n) planetIds.add(value.toString());
  };

  try {
    if (topic === attackBattleResolvedTopic || topic === combatDebrisSignaledTopic) {
      addTopic(topic === attackBattleResolvedTopic ? 3 : 2);
    }
  } catch {
    return [];
  }

  return [...planetIds];
}

// The mission id a single fleet-mission log refers to. Returns null for the attack-joined link log
// (which carries two ids in topics 1/2 and is not itself a settlement) and for non-fleet logs.
export function fleetMissionLogMissionId(log: RpcLog): string | null {
  const topic = topicAt(log.topics, 0);
  if (topic === attackMissionJoinedTopic || !isFleetMissionLog(log)) return null;
  try {
    return decodeUint(topicAt(log.topics, 1)).toString();
  } catch {
    return null;
  }
}

export function decodeSettledPlanetLog(log: RpcLog): SettledPlanetEvent {
  const eventName = topicAt(log.topics, 0) === planetStartedTopic ? "PlanetStarted" : "ColonyCreated";
  const player = decodeAddressWord(topicAt(log.topics, 1));
  const planetId = decodeUint(topicAt(log.topics, eventName === "PlanetStarted" ? 2 : 3));
  const words = splitWords(log.data);
  const fields = Number(decodeUintWord(wordAt(words, 3)));
  const temperature = Number(decodeSignedWord(wordAt(words, 4)));
  const multipliers = planetMultipliers(temperature, fields);

  return {
    eventName,
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: planetId.toString(),
    owner: player,
    name: null,
    galaxy: Number(decodeUintWord(wordAt(words, 0))),
    system: Number(decodeUintWord(wordAt(words, 1))),
    position: Number(decodeUintWord(wordAt(words, 2))),
    fields,
    temperature,
    ...multipliers,
    lastSettledAt: "0",
    resources: {
      metal: "0",
      crystal: "0",
      deuterium: "0"
    }
  };
}

export function decodePlanetSettledLog(log: RpcLog): PlanetSettledEvent {
  const words = splitWords(log.data);

  return {
    eventName: "PlanetSettled",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    logIndex: (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0",
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    resources: decodeResources(words.slice(0, 3)),
    lastSettledAt: decodeUintWord(wordAt(words, 3)).toString()
  };
}

export function decodeReferralClaimLog(log: RpcLog): IndexedReferralClaimEvent {
  const words = splitWords(log.data);
  return {
    eventName: "ReferralCodeClaimed",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    logIndex: (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0",
    inviter: decodeAddressWord(topicAt(log.topics, 1)),
    commitment: topicAt(log.topics, 2) as `0x${string}`,
    claimedAt: decodeUintWord(wordAt(words, 0)).toString()
  };
}

export function decodeReferralRedemptionLog(log: RpcLog): IndexedReferralRedemptionEvent {
  const words = splitWords(log.data);
  return {
    eventName: "ReferralInviteRedeemed",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    logIndex: (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0",
    inviter: decodeAddressWord(topicAt(log.topics, 1)),
    invitee: decodeAddressWord(topicAt(log.topics, 2)),
    commitment: topicAt(log.topics, 3) as `0x${string}`,
    redeemedAt: decodeUintWord(wordAt(words, 0)).toString()
  };
}

export function decodeMoonResourcesSettledLog(log: RpcLog): MoonResourcesSettledEvent {
  const words = splitWords(log.data);

  return {
    eventName: "MoonResourcesSettled",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    logIndex: (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0",
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    resources: decodeResources(words.slice(0, 3)),
    lastSettledAt: decodeUintWord(wordAt(words, 3)).toString()
  };
}

export function decodeShipCountChangedLog(log: RpcLog): IndexedShipCountChangedEvent {
  const words = splitWords(log.data);
  const eventName = topicAt(log.topics, 0) === moonShipCountChangedTopic
    ? "MoonShipCountChanged"
    : "PlanetShipCountChanged";

  return {
    eventName,
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    shipId: Number(decodeUint(topicAt(log.topics, 2))),
    total: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeMoonShipCountChangedLog(log: RpcLog): IndexedMoonShipCountChangedEvent {
  const words = splitWords(log.data);

  return {
    eventName: "MoonShipCountChanged",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    shipId: Number(decodeUint(topicAt(log.topics, 2))),
    total: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeMoonResourcesChangedLog(log: RpcLog): IndexedMoonResourcesChangedEvent {
  const words = splitWords(log.data);

  return {
    eventName: "MoonResourcesChanged",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    logIndex: (log as RpcLog & { logIndex?: string }).logIndex ?? "0x0",
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    resources: decodeResources(words.slice(0, 3))
  };
}

export function decodeDefenseCountChangedLog(log: RpcLog): IndexedDefenseCountChangedEvent {
  const words = splitWords(log.data);

  return {
    eventName: "PlanetDefenseCountChanged",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    defenseId: Number(decodeUint(topicAt(log.topics, 2))),
    total: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeMoonDefenseCountChangedLog(log: RpcLog): IndexedMoonDefenseCountChangedEvent {
  const words = splitWords(log.data);

  return {
    eventName: "MoonDefenseCountChanged",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: decodeUint(topicAt(log.topics, 1)).toString(),
    defenseId: Number(decodeUint(topicAt(log.topics, 2))),
    total: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeInterplanetaryMissileAttackLog(log: RpcLog): InterplanetaryMissileAttackEvent {
  const words = splitWords(log.data);

  return {
    eventName: "InterplanetaryMissileAttack",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    attacker: decodeAddressWord(topicAt(log.topics, 1)),
    originPlanetId: decodeUint(topicAt(log.topics, 2)).toString(),
    targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
    primaryTargetDefenseId: Number(decodeUintWord(wordAt(words, 0))),
    launched: Number(decodeUintWord(wordAt(words, 1))),
    intercepted: Number(decodeUintWord(wordAt(words, 2))),
    hits: Number(decodeUintWord(wordAt(words, 3))),
    destroyedPrimary: Number(decodeUintWord(wordAt(words, 4)))
  };
}

export function decodePlanetRenamedLog(log: RpcLog): PlanetRenamedEvent {
  return {
    eventName: "PlanetRenamed",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    name: decodeStringResult(log.data)
  };
}

export function decodeIndexedQueueStartedLog(log: RpcLog): IndexedQueueStartedEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  // The queue START time is the block the spend mined in — the same instant the
  // contract drained the cost from stored resources and re-settled the planet.
  // Recording it lets a resource snapshot taken at/after that settle time be
  // recognised as already reflecting the spend, so the displayed balance is not
  // reduced by the cost a second time (VEY-318: top bar pinned at 0 while a build
  // was queued because the cost was double-subtracted).
  const startedAt = logBlockTimestampSeconds(log);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    readyAt: decodeUintWord(wordAt(words, 1)).toString(),
    ...(startedAt ? { startedAt } : {}),
    cost: decodeResources(words.slice(2, 5))
  };

  if (topic === researchQueuedTopic) {
    return {
      ...base,
      eventName: "ResearchQueued",
      queueKind: "research",
      owner: decodeAddressWord(topicAt(log.topics, 1)),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonBuildingStartedTopic) {
    return {
      ...base,
      eventName: "MoonBuildingStarted",
      queueKind: "moon-building",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonDefenseQueuedTopic) {
    return {
      ...base,
      eventName: "MoonDefenseQueued",
      queueKind: "moon-defense",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      quantity: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  const planetId = decodeUint(topicAt(log.topics, 1)).toString();
  const itemId = Number(decodeUint(topicAt(log.topics, 2)));
  if (topic === buildingStartedTopic) {
    return {
      ...base,
      eventName: "BuildingStarted",
      queueKind: "building",
      planetId,
      itemId,
      targetLevel: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === defenseQueuedTopic) {
    return {
      ...base,
      eventName: "DefenseQueued",
      queueKind: "defense",
      planetId,
      itemId,
      quantity: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  return {
    ...base,
    eventName: "ShipQueued",
    queueKind: "ship",
    planetId,
    itemId,
    quantity: Number(decodeUintWord(wordAt(words, 0)))
  };
}

export function decodeIndexedQueueCompletedLog(log: RpcLog): IndexedQueueCompletedEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString()
  };

  if (topic === researchCompletedTopic) {
    return {
      ...base,
      eventName: "ResearchCompleted",
      queueKind: "research",
      owner: decodeAddressWord(topicAt(log.topics, 1)),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonBuildingCompletedTopic) {
    return {
      ...base,
      eventName: "MoonBuildingCompleted",
      queueKind: "moon-building",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === moonDefenseCompletedTopic) {
    return {
      ...base,
      eventName: "MoonDefenseCompleted",
      queueKind: "moon-defense",
      planetId: decodeUint(topicAt(log.topics, 1)).toString(),
      itemId: Number(decodeUint(topicAt(log.topics, 2))),
      quantity: Number(decodeUintWord(wordAt(words, 0))),
      total: Number(decodeUintWord(wordAt(words, 1)))
    };
  }

  const planetId = decodeUint(topicAt(log.topics, 1)).toString();
  const itemId = Number(decodeUint(topicAt(log.topics, 2)));
  if (topic === buildingCompletedTopic) {
    return {
      ...base,
      eventName: "BuildingCompleted",
      queueKind: "building",
      planetId,
      itemId,
      level: Number(decodeUintWord(wordAt(words, 0)))
    };
  }

  if (topic === defenseCompletedTopic) {
    return {
      ...base,
      eventName: "DefenseCompleted",
      queueKind: "defense",
      planetId,
      itemId,
      quantity: Number(decodeUintWord(wordAt(words, 0))),
      total: Number(decodeUintWord(wordAt(words, 1)))
    };
  }

  return {
    ...base,
    eventName: "ShipCompleted",
    queueKind: "ship",
    planetId,
    itemId,
    quantity: Number(decodeUintWord(wordAt(words, 0))),
    total: Number(decodeUintWord(wordAt(words, 1)))
  };
}

export function decodeMoonCreatedLog(log: RpcLog): IndexedMoonCreatedEvent {
  const words = splitWords(log.data);
  return {
    eventName: "MoonCreated",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    galaxy: Number(decodeUintWord(wordAt(words, 0))),
    system: Number(decodeUintWord(wordAt(words, 1))),
    position: Number(decodeUintWord(wordAt(words, 2))),
    fields: Number(decodeUintWord(wordAt(words, 3))),
    diameterKm: Number(decodeUintWord(wordAt(words, 4))),
    createdAt: BigInt(log.blockNumber).toString()
  };
}

export function decodeMoonJumpGateLog(log: RpcLog): IndexedMoonJumpGateEvent {
  const words = splitWords(log.data);
  return {
    eventName: "JumpGateJumped",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    player: decodeAddressWord(topicAt(log.topics, 1)),
    originMoonPlanetId: decodeUint(topicAt(log.topics, 2)).toString(),
    destinationMoonPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
    nextReadyAt: decodeUintWord(wordAt(words, 0)).toString()
  };
}

export function decodeRiftResourceLog(log: RpcLog): IndexedRiftResourceEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    owner: decodeAddressWord(topicAt(log.topics, 1)),
    planetId: decodeUint(topicAt(log.topics, 2)).toString(),
    resourceId: Number(decodeUint(topicAt(log.topics, 3))),
    amount: decodeUintWord(wordAt(words, 0)).toString()
  };

  if (topic === marketResourceWithdrawalRequestedTopic) {
    return {
      ...base,
      eventName: "MarketResourceWithdrawalRequested",
      unlocksAt: decodeUintWord(wordAt(words, 1)).toString()
    };
  }

  return {
    ...base,
    eventName: topic === marketResourceDepositedTopic
      ? "MarketResourceDeposited"
      : "MarketResourceWithdrawalFinished"
  };
}

export function decodeAllianceLog(log: RpcLog): IndexedAllianceEvent {
  const topic = topicAt(log.topics, 0);
  const blockTimestamp = logBlockTimestampSeconds(log) ?? "0";
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString()
  };

  if (topic === allianceCreatedTopic) {
    const words = splitWords(log.data);
    return {
      ...base,
      eventName: "AllianceCreated",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      owner: decodeAddressWord(topicAt(log.topics, 2)),
      tag: decodeString(words, 0),
      name: decodeString(words, 1),
      createdAt: blockTimestamp
    };
  }
  if (topic === allianceProfileUpdatedTopic) {
    const words = splitWords(log.data);
    return {
      ...base,
      eventName: "AllianceProfileUpdated",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      tag: decodeString(words, 0),
      name: decodeString(words, 1),
      description: decodeString(words, 2)
    };
  }
  if (topic === allianceInviteCreatedTopic) {
    return {
      ...base,
      eventName: "AllianceInviteCreated",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      inviter: decodeAddressWord(topicAt(log.topics, 2)),
      player: decodeAddressWord(topicAt(log.topics, 3)),
      invitedAt: blockTimestamp
    };
  }
  if (topic === allianceInviteCancelledTopic || topic === allianceJoinRequestCancelledTopic) {
    return {
      ...base,
      eventName: topic === allianceInviteCancelledTopic ? "AllianceInviteCancelled" : "AllianceJoinRequestCancelled",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      player: decodeAddressWord(topicAt(log.topics, 2))
    };
  }
  if (topic === allianceJoinRequestedTopic) {
    const words = splitWords(log.data);
    return {
      ...base,
      eventName: "AllianceJoinRequested",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      requester: decodeAddressWord(topicAt(log.topics, 2)),
      requestedAt: decodeUintWord(wordAt(words, 0)).toString()
    };
  }
  if (topic === allianceJoinRequestDismissedTopic || topic === allianceJoinRequestApprovedTopic) {
    return {
      ...base,
      eventName: topic === allianceJoinRequestDismissedTopic ? "AllianceJoinRequestDismissed" : "AllianceJoinRequestApproved",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      manager: decodeAddressWord(topicAt(log.topics, 2)),
      requester: decodeAddressWord(topicAt(log.topics, 3))
    };
  }
  if (topic === allianceJoinedTopic) {
    const roleId = Number(decodeUintWord(wordAt(splitWords(log.data), 0)));
    return {
      ...base,
      eventName: "AllianceJoined",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      player: decodeAddressWord(topicAt(log.topics, 2)),
      role: allianceRoleName(roleId),
      roleId,
      joinedAt: blockTimestamp
    };
  }
  if (topic === allianceLeftTopic) {
    return {
      ...base,
      eventName: "AllianceLeft",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      player: decodeAddressWord(topicAt(log.topics, 2))
    };
  }
  if (topic === allianceRoleUpdatedTopic) {
    const roleId = Number(decodeUintWord(wordAt(splitWords(log.data), 0)));
    return {
      ...base,
      eventName: "AllianceRoleUpdated",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      player: decodeAddressWord(topicAt(log.topics, 2)),
      role: allianceRoleName(roleId),
      roleId
    };
  }
  if (topic === allianceOwnershipTransferredTopic) {
    return {
      ...base,
      eventName: "AllianceOwnershipTransferred",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      previousOwner: decodeAddressWord(topicAt(log.topics, 2)),
      newOwner: decodeAddressWord(topicAt(log.topics, 3))
    };
  }
  if (topic === allianceDiplomacyUpdatedTopic) {
    return {
      ...base,
      eventName: "AllianceDiplomacyUpdated",
      allianceId: decodeUint(topicAt(log.topics, 1)).toString(),
      otherAllianceId: decodeUint(topicAt(log.topics, 2)).toString(),
      statusId: Number(decodeUintWord(wordAt(splitWords(log.data), 0)))
    };
  }

  throw new Error(`Unsupported alliance log topic: ${topic}`);
}

export function isMoonChanceReportLog(log: RpcLog): boolean {
  const topic = topicAt(log.topics, 0);
  return topic === moonChanceRequestedTopic
    || topic === moonChanceFinalizedTopic
    || topic === moonChanceSkippedExistingMoonTopic
    || topic === moonDestructionRequestedTopic
    || topic === moonDestructionFinalizedTopic;
}

export function decodeMoonChanceReportLog(log: RpcLog): MoonChanceReportEvent {
  const topic = topicAt(log.topics, 0);
  const words = splitWords(log.data);
  const base = {
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString()
  };

  if (topic === moonChanceRequestedTopic) {
    return {
      ...base,
      eventName: "MoonChanceRequested",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      defender: decodeAddressWord(wordAt(words, 0)),
      metalDebris: decodeUintWord(wordAt(words, 1)).toString(),
      crystalDebris: decodeUintWord(wordAt(words, 2)).toString(),
      chanceBps: Number(decodeUintWord(wordAt(words, 3))),
      randomnessRequestId: decodeUintWord(wordAt(words, 4)).toString(),
      purposeHash: `0x${wordAt(words, 5)}`
    };
  }

  if (topic === moonChanceFinalizedTopic) {
    return {
      ...base,
      eventName: "MoonChanceFinalized",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      chanceBps: Number(decodeUintWord(wordAt(words, 0))),
      moonCreated: decodeBoolWord(wordAt(words, 1)),
      randomWord: decodeUintWord(wordAt(words, 2)).toString(),
      moonFields: Number(decodeUintWord(wordAt(words, 3))),
      moonDiameterKm: Number(decodeUintWord(wordAt(words, 4)))
    };
  }

  if (topic === moonDestructionRequestedTopic) {
    return {
      ...base,
      eventName: "MoonDestructionRequested",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      attacker: decodeAddressWord(wordAt(words, 0)),
      deathstars: Number(decodeUintWord(wordAt(words, 1))),
      moonDestructionChanceBps: Number(decodeUintWord(wordAt(words, 2))),
      deathstarDestructionChanceBps: Number(decodeUintWord(wordAt(words, 3))),
      randomnessRequestId: decodeUintWord(wordAt(words, 4)).toString(),
      purposeHash: `0x${wordAt(words, 5)}`
    };
  }

  if (topic === moonDestructionFinalizedTopic) {
    return {
      ...base,
      eventName: "MoonDestructionFinalized",
      outcomeId: decodeUint(topicAt(log.topics, 1)).toString(),
      battleId: decodeUint(topicAt(log.topics, 2)).toString(),
      targetPlanetId: decodeUint(topicAt(log.topics, 3)).toString(),
      moonDestroyed: decodeBoolWord(wordAt(words, 0)),
      deathstarsDestroyed: decodeBoolWord(wordAt(words, 1)),
      randomWord: decodeUintWord(wordAt(words, 2)).toString()
    };
  }

  return {
    ...base,
    eventName: "MoonChanceSkippedExistingMoon",
    battleId: decodeUint(topicAt(log.topics, 1)).toString(),
    targetPlanetId: decodeUint(topicAt(log.topics, 2)).toString(),
    metalDebris: decodeUintWord(wordAt(words, 0)).toString(),
    crystalDebris: decodeUintWord(wordAt(words, 1)).toString()
  };
}

export function decodeDebrisFieldLog(log: RpcLog): DebrisFieldEvent {
  const planetId = decodeUint(topicAt(log.topics, 1));
  const words = splitWords(log.data);

  return {
    eventName: "DebrisFieldUpdated",
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber).toString(),
    planetId: planetId.toString(),
    resources: {
      metal: decodeUintWord(wordAt(words, 0)).toString(),
      crystal: decodeUintWord(wordAt(words, 1)).toString()
    }
  };
}

function isMatchingBuildingStartedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.targetLevel
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function isMatchingDefenseQueuedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.quantity
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function isMatchingShipQueuedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.quantity
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function isMatchingResearchQueuedLog(log: RpcLog, queue: QueueState): boolean {
  try {
    const words = splitWords(log.data);
    return Number(decodeUintWord(wordAt(words, 0))) === queue.targetLevel
      && decodeUintWord(wordAt(words, 1)).toString() === queue.readyAt
      && decodeUintWord(wordAt(words, 2)).toString() === queue.cost.metal
      && decodeUintWord(wordAt(words, 3)).toString() === queue.cost.crystal
      && decodeUintWord(wordAt(words, 4)).toString() === queue.cost.deuterium;
  } catch {
    return false;
  }
}

function encodeAddress(address: Address): string {
  assertAddress(address);
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function toQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}

// VeydriftGameStorage layout: `_fleetMissions` follows `_fleets` at slot 24.
const fleetMissionsStorageSlot = 24n;

function fleetMissionStorageBaseSlot(missionId: bigint): bigint {
  return BigInt(keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" }
    ],
    [missionId, fleetMissionsStorageSlot]
  )));
}

function emptyFleetMissionSupplement(): FleetMissionSupplement {
  return {
    ships: Object.fromEntries(missionShipKeys.map((key) => [key, "0"])),
    originIsMoon: false,
    targetIsMoon: false
  };
}

function isActiveCanonicalMission(mission: CanonicalFleetMissionSnapshot): boolean {
  return mission.status === "Outbound"
    || mission.status === "Returning"
    || mission.status === "Recalled";
}

function decodeMissionShipsFromStorage(
  firstWord: string,
  secondWord: string
): Record<string, string> {
  return Object.fromEntries(missionShipKeys.map((key, index) => {
    const word = index < 8 ? firstWord : secondWord;
    const offset = (index % 8) * 4;
    return [key, decodePackedUint32(word, offset).toString()];
  }));
}

function decodePackedUint32(word: string, byteOffset: number): bigint {
  return BigInt(`0x${packedStorageBytes(word, byteOffset, 4)}`);
}

function decodePackedBool(word: string, byteOffset: number): boolean {
  return packedStorageBytes(word, byteOffset, 1) !== "00";
}

function packedStorageBytes(word: string, byteOffset: number, byteLength: number): string {
  const normalized = (word.startsWith("0x") ? word.slice(2) : word).padStart(64, "0");
  const start = 64 - ((byteOffset + byteLength) * 2);
  return normalized.slice(start, start + byteLength * 2);
}

function toTopic(value: bigint): string {
  return `0x${encodeUint(value)}`;
}

function toAddressTopic(address: Address): string {
  return `0x${encodeAddress(address)}`;
}

function splitWords(hex: string): string[] {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  const words: string[] = [];
  for (let index = 0; index < data.length; index += 64) {
    words.push(data.slice(index, index + 64).padStart(64, "0"));
  }
  return words;
}

function wordAt(words: string[], index: number): string {
  const word = words[index];
  if (!word) {
    throw new Error("RPC response did not contain enough ABI words.");
  }

  return word;
}

function topicAt(topics: string[], index: number): string {
  const topic = topics[index];
  if (!topic) {
    throw new Error("RPC log did not contain enough topics.");
  }

  return topic;
}

function decodeUint(hex: string): bigint {
  return BigInt(hex);
}

function decodeUintWord(word: string): bigint {
  return BigInt(`0x${word}`);
}

function decodeSignedWord(word: string): bigint {
  return BigInt.asIntN(256, BigInt(`0x${word}`));
}

function decodeBoolWord(word: string): boolean {
  return decodeUintWord(word) !== 0n;
}

function decodeAddressWord(word: string): Address {
  return `0x${word.slice(-40)}` as Address;
}

function decodeStringResult(hex: string): string {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0)) / 32n);
  const length = Number(decodeUintWord(wordAt(words, offset)));
  const data = words.slice(offset + 1).join("").slice(0, length * 2);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    bytes[index] = Number.parseInt(data.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function decodeNullableStringResult(hex: string): string | null {
  try {
    const value = decodeStringResult(hex);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function decodeString(words: string[], headIndex: number, baseIndex = 0): string {
  const offset = baseIndex + Number(decodeUintWord(wordAt(words, headIndex))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  let hex = "";
  for (let index = offset + 1; hex.length < length * 2; index += 1) {
    hex += wordAt(words, index);
  }
  return new TextDecoder().decode(hexToBytes(hex.slice(0, length * 2)));
}

function decodeAddressArray(hex: string): Address[] {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  return Array.from({ length }, (_, index) => decodeAddressWord(wordAt(words, offset + 1 + index)));
}

function decodeUintArray(hex: string): bigint[] {
  const words = splitWords(hex);
  const offset = Number(decodeUintWord(wordAt(words, 0))) / 32;
  const length = Number(decodeUintWord(wordAt(words, offset)));
  return Array.from({ length }, (_, index) => decodeUintWord(wordAt(words, offset + 1 + index)));
}

function decodeAllianceDirectoryEntry(allianceId: bigint, words: string[]): AllianceState["directory"][number] {
  const tupleStart = dynamicTupleStart(words);
  return {
    allianceId: allianceId.toString(),
    active: decodeBoolWord(wordAt(words, tupleStart)),
    tag: decodeString(words, tupleStart + 1, tupleStart),
    name: decodeString(words, tupleStart + 2, tupleStart),
    description: decodeString(words, tupleStart + 3, tupleStart),
    owner: decodeAddressWord(wordAt(words, tupleStart + 4)),
    createdAt: decodeUintWord(wordAt(words, tupleStart + 5)).toString(),
    memberCount: Number(decodeUintWord(wordAt(words, tupleStart + 6)))
  };
}

function dynamicTupleStart(words: string[]): number {
  if (words.length < 2) return 0;

  const offset = Number(decodeUintWord(wordAt(words, 0)) / 32n);
  return offset > 0 && offset < words.length ? offset : 0;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function allianceRoleName(role: number): AllianceRoleName {
  if (role === 1) return "member";
  if (role === 2) return "officer";
  if (role === 3) return "owner";
  return "none";
}

function logBlockTimestampSeconds(log: RpcLog): string | undefined {
  if (!("blockTimestamp" in log) || typeof log.blockTimestamp !== "string") return undefined;

  try {
    return BigInt(log.blockTimestamp).toString();
  } catch {
    return undefined;
  }
}

export function attackBlockReasonLabel(reason: AttackBlockReason): string | null {
  if (reason === "bashing_limit") {
    return "Attack blocked: bashing limit reached for this attacker, defender, and planet in the current 24-hour window.";
  }
  if (reason === "score_protection") {
    return "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.";
  }
  if (reason === "same_alliance") {
    return "Attack blocked: target belongs to your alliance.";
  }
  return null;
}

export function transportBlockReasonLabel(reason: TransportBlockReason): string | null {
  if (reason === "not_allied") {
    return "Transport blocked: target must be one of your planets.";
  }
  return null;
}

export function diplomacyStatusName(statusId: number): AllianceDiplomacyStatusName {
  if (statusId === 1) return "ally";
  if (statusId === 2) return "non_aggression_pact";
  if (statusId === 3) return "war";
  return "none";
}

function decodeAttackBlockReason(reason: number): AttackBlockReason {
  if (reason === 1) return "bashing_limit";
  if (reason === 2) return "score_protection";
  if (reason === 3) return "same_alliance";
  return "none";
}

function decodeAttackRelation(flags: number): AttackRelation {
  if ((flags & 1) !== 0) return "stronger";
  if ((flags & 2) !== 0) return "weaker";
  return "peer";
}

function decodeHonorStatus(flags: number): HonorStatus {
  if ((flags & 8) !== 0) return "bandit";
  if ((flags & 4) !== 0) return "honorable";
  return "neutral";
}

function decodeResources(words: string[]): Resources {
  return {
    metal: decodeUintWord(words[0] ?? "0").toString(),
    crystal: decodeUintWord(words[1] ?? "0").toString(),
    deuterium: decodeUintWord(words[2] ?? "0").toString()
  };
}

function zeroResources(): Resources {
  return {
    metal: "0",
    crystal: "0",
    deuterium: "0"
  };
}

function isRpcRevert(error: unknown): boolean {
  return error instanceof Error && /execution reverted|revert|missing revert data/i.test(error.message);
}

function shouldChunkLogQuery(error: unknown): boolean {
  // A truncated/oversized response body (RpcResponseParseError) means the block range produced more logs
  // than the node could return intact — halving the range is the same recovery as an explicit
  // "block range too large" rejection (VEY-KANEO-461).
  return error instanceof RpcResponseParseError
    || (error instanceof Error && /max block range|block range|too many blocks|RPC HTTP 400/i.test(error.message));
}

function shouldRetryWithoutBatch(error: unknown): boolean {
  // A truncated/oversized batch response (RpcResponseParseError) or an explicit too-large rejection
  // (HTTP 400/413) both mean "this batch was too big" — retry the same calls one at a time, whose
  // small individual responses the node can always return intact (VEY-KANEO-461).
  return error instanceof RpcResponseParseError
    || (error instanceof Error && /RPC HTTP (400|413)/i.test(error.message));
}

const defaultRpcRequestTimeoutMsValue = 10_000;

// Per-fetch deadline for upstream RPC calls. Configurable so operators can tighten/loosen the abort
// window without a redeploy during an Alchemy incident; falls back to 10s (well under the typical
// load-balancer/socket idle limits) and ignores non-positive or unparseable overrides.
export function defaultRpcRequestTimeoutMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.VEYDRIFT_RPC_HTTP_TIMEOUT_MS;
  if (!raw) return defaultRpcRequestTimeoutMsValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultRpcRequestTimeoutMsValue;
  return parsed;
}

// Raised when an upstream RPC fetch is aborted because it exceeded the per-request deadline.
export class RpcRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`RPC request timed out after ${timeoutMs}ms`);
    this.name = "RpcRequestTimeoutError";
  }
}

// Wraps a raw network-layer fetch failure (connection reset, DNS, TLS) so the retry loop can treat it
// as a transient transport fault rather than a permanent error.
export class RpcTransportError extends Error {
  constructor(cause: unknown) {
    super(`RPC transport error: ${reasonText(cause)}`);
    this.name = "RpcTransportError";
    this.cause = cause;
  }
}

// Raised when an RPC response body cannot be read or parsed as JSON — typically a truncated or empty
// body from an oversized batch response (the self-hosted node cutting the stream short), surfaced by
// fetch as "Unexpected end of JSON input". Treated as transient so the request is retried, and as a
// batch-too-large signal so a batched eth_call falls back to sequential single calls. Before this the
// parse threw a bare SyntaxError that failed the canonical reconcile hard and froze lastReconciledBlock
// forever (VEY-KANEO-461).
export class RpcResponseParseError extends Error {
  constructor(cause: unknown, bodyLength?: number) {
    super(`RPC response parse error${bodyLength === undefined ? "" : ` (body ${bodyLength} bytes)`}: ${reasonText(cause)}`);
    this.name = "RpcResponseParseError";
    this.cause = cause;
  }
}

// Read and JSON-parse an RPC response defensively. A failure to read the stream (connection reset
// mid-body) or to parse it (truncated/empty body) becomes a typed RpcResponseParseError so callers can
// retry and, for batched reads, shrink the request — rather than a fatal SyntaxError.
async function readRpcJson<T>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new RpcResponseParseError(error);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new RpcResponseParseError(error, text.length);
  }
}

function isRetryableTransportError(error: unknown): boolean {
  return error instanceof RpcRequestTimeoutError
    || error instanceof RpcTransportError
    || error instanceof RpcResponseParseError;
}

function reasonText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRetryableRpcHttpStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function isRetryableRpcError(error: { code: number; message: string }): boolean {
  return /over rate limit|rate limit|too many requests/i.test(error.message);
}

function retryDelay(attempt: number): Promise<void> {
  return retryDelayMs(300 * (attempt + 1));
}

function retryDelayMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
