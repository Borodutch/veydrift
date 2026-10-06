/** JSON wire contracts only. No runtime imports or backend implementation dependencies. */
export type Resources = { metal: string; crystal: string; deuterium: string };

export type WalletDelegation<Wallet extends string = string> = {
  wallet: Wallet;
  main: Wallet;
  delegate: Wallet | null;
  actingAsDelegate: boolean;
};

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
  /** Canonical unsettled defense batch; defense above is projected not-yet-due work. */
  unsettledDefense?: QueueState | null;
  ship: QueueState | null;
  research: QueueState | null;
};

/** Observed proof lifecycle, not prover availability, acceptance evidence or percent complete.
 * Absent for legacy/unobserved missions. Economics is NOT terminal settlement.
 * Optional block identity is present for canonical getter observations, absent for event-only
 * or unavailable observations. Application cursors are decimal strings, never JS numbers.
 */
export type ProofBattleProgress = {
  state: "preparing" | "randomness-wait" | "proving" | "applying" | "economics" | "unavailable";
  stagedPhase: number;
  blockNumber?: string;
  blockHash?: string;
  nextIndex?: string;
  memberCount?: string;
};

/** Canonical event archive, not terminal battle/report or release authorization. */
export type ProofBattleAcceptance = {
  battleId: string; binding: string; releaseId: string; root: string; memberCount: string;
  rounds: number; finalTotals: [string, string]; outcome: number; version: number;
  address: string; blockNumber: string; blockHash: string; transactionHash: string; logIndex: string;
};

/** Runtime FinalArtifact serialized fields; Proof is compressed gnark/base64, NOT EVM calldata.
 * Leaves/manifest are untrusted until compared with the pinned accepted summary and root. */
export type FinalBattleArtifact = {
  Schema: "raw-linked-settlement22-v3";
  Manifest: { VKHash: string; InputHash: string; ProofHash: string; ChainRecord: string; OutputRoot: string;
    MemberCount: string; Rounds: string; FinalSide0: string; FinalSide1: string; Outcome: string };
  Public: string[]; Proof: string;
  Leaves: Array<{ Index: string; Cohort: string; Owner: string; Source: string; Side: string;
    Unit: string; Count: string; Lost: string; Survivors: string; Next: string }>;
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
