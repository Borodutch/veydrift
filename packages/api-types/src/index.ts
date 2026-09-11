/** JSON wire contracts only. No runtime imports or backend implementation dependencies. */
export type Resources = { metal: string; crystal: string; deuterium: string };

export type Pagination = {
  page: number;
  pageSize: number;
  totalEntries: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type QueueAsOfNow = {
  secondsRemaining: number;
  complete: boolean;
  completedQuantity?: number;
  remainingQuantity?: number;
  currentUnitSecondsRemaining?: number;
  currentUnitProgressBps?: number;
  overallProgressBps?: number;
};

export type QueueState = {
  active: boolean;
  kind: string | null;
  planetId?: string;
  itemId?: number;
  targetLevel?: number;
  quantity?: number;
  readyAt: string | null;
  startedAt?: string | null;
  cost: Resources;
  backlog?: QueueState[];
  productionTiming?: { startedAt: string; originalQuantity: number; unitWorkSeconds: string; rate: string };
  /** Derived by the backend; optional on stored event rows before projection. */
  asOfNow?: QueueAsOfNow;
};

export type PlayerQueues<Wallet extends string = string> = {
  wallet: Wallet;
  homePlanetId: string | null;
  building: QueueState | null;
  defense: QueueState | null;
  ship: QueueState | null;
  research: QueueState | null;
};

export type MissionArchiveEntry<Mission, Report> =
  | { kind: "mission"; mission: Mission; report?: Report | undefined }
  | { kind: "battleReport"; report: Report };

export type GlobalMissionArchive<Mission, Report> = {
  rows: MissionArchiveEntry<Mission, Report>[];
  pagination: Pagination;
};

export type FleetMissionArchive<Mission, Report, Wallet extends string = string> = GlobalMissionArchive<Mission, Report> & {
  wallet: Wallet;
  homePlanetId: string | null;
};

export type AllianceRole = "none" | "member" | "officer" | "owner";
export type AllianceDiplomacyStatus = "none" | "ally" | "non_aggression_pact" | "war";
export type AllianceDiplomacyEntry<Alliance> = {
  allianceId: string;
  otherAllianceId: string;
  status: AllianceDiplomacyStatus;
  statusId: number;
  updatedAt: string | null;
  initiatedByAllianceId: string | null;
  declaredAt?: string | null;
  warSnapshot?: {
    snapshotId: string;
    declarerScore: string;
    declareeScore: string;
    declarerMemberCount: number;
    declareeMemberCount: number;
  } | null;
  alliance: Alliance | null;
};
