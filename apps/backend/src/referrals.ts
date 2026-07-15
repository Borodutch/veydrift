import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  toHex,
  verifyMessage,
  type Address,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type {
  IndexedReferralClaimEvent,
  IndexedReferralRedemptionEvent,
  IndexedReferralRewardClaimEvent
} from "./evm";

export const referralRedeemDomain = keccak256(toHex("veydrift.referral.redeem.v1"));
export const referralInviteUrlBase = "https://veydrift.com";
export const referralClaimWindowMs = 24 * 60 * 60 * 1000;
export const referralClaimsPerWindow = 3;
export const referralCodePattern = /^[A-Za-z0-9_-]{9}$/;

export type ReferralInviteRecord = {
  code: string;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  txHash?: string | null;
  // Legacy callback-owned data is tolerated on disk but never used as chain truth.
  redemptions?: Array<{ invitee: string; redeemedAt: string; txHash?: string | null }>;
};

export type ReferralRedemptionRecord = {
  invitee: string;
  commitment: Hex;
  redeemedAt: string;
  rewardAmountWei: string | null;
  paid: boolean;
  credited: boolean;
  paymentStatus: "paid" | "credited" | "claimed" | "legacy_unknown";
  txHash: string;
};

export type ReferralInviteSummary = {
  code: string | null;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  txHash: string | null;
  expiresAt: string;
  expired: boolean;
  link: string | null;
  remainingRedemptions: number;
  nextRedemptionAt: string | null;
  redemptionCount: number;
  redemptions: ReferralRedemptionRecord[];
  status: "pending_claim" | "active" | "expired";
};

type ReferralStoreJson = {
  invites: ReferralInviteRecord[];
};

export type ReferralDashboard = {
  configured: boolean;
  invite: ReferralInviteSummary | null;
  invites: ReferralInviteSummary[];
  nextClaimAt: string | null;
  nextRedemptionAt: string | null;
  remainingClaims: number;
  remainingRedemptions: number;
  rewardPerUseWei: string | null;
  totalAccruedRewardsWei: string;
  totalPaidRewardsWei: string;
  claimableRewardsWei: string;
  redemptions: ReferralRedemptionRecord[];
};

export type ReferralRedemption = {
  code: string;
  commitment: Hex;
  signature: Hex;
  v: number;
  r: Hex;
  s: Hex;
};

export type ReferralResolveStatus =
  | "active"
  | "expired"
  | "exhausted"
  | "self_invite"
  | "already_redeemed"
  | "unclaimed"
  | "invalid"
  | "unavailable";

export type ReferralResolveResult = {
  valid: boolean;
  status: ReferralResolveStatus;
  message: string;
  commitment: Hex | null;
  expiresAt: string | null;
  nextRedemptionAt: string | null;
  remainingRedemptions: number;
  startPriceWei: string | null;
  inviterRewardWei: string | null;
};

export type ReferralWalletAction = "dashboard" | "claim-transaction";

export type ReferralChainIndex = {
  referralClaims(owner: `0x${string}`): IndexedReferralClaimEvent[];
  referralRedemptionsForInviter(inviter: `0x${string}`): IndexedReferralRedemptionEvent[];
  referralRewardClaimsForInviter(inviter: `0x${string}`): IndexedReferralRewardClaimEvent[];
};

export class ReferralInviteStore {
  constructor(private readonly path: string) {}

  dashboard(
    wallet: string,
    index: ReferralChainIndex,
    startPriceWei: string | null,
    configured: boolean,
    includeSecrets: boolean,
    now = new Date()
  ): ReferralDashboard {
    return canonicalReferralDashboard({
      configured,
      includeSecrets,
      index,
      now,
      startPriceWei,
      store: this,
      wallet
    });
  }

  recordClaimIntent(
    wallet: string,
    code: unknown,
    commitment: string,
    now = new Date()
  ): ReferralInviteRecord {
    const owner = normalizeAddress(wallet).toLowerCase();
    const normalizedCode = normalizeReferralCode(code);
    const normalizedCommitment = normalizeHex32(commitment, "commitment");
    const expectedCommitment = referralCommitment(normalizedCode, owner);
    if (expectedCommitment.toLowerCase() !== normalizedCommitment.toLowerCase()) {
      throw new Error("Referral code does not match the inviter-bound commitment.");
    }

    const store = this.read();
    const matchingInvite = store.invites.find((candidate) =>
      candidate.code === normalizedCode
      || candidate.commitment.toLowerCase() === normalizedCommitment.toLowerCase()
    );
    if (matchingInvite && matchingInvite.owner.toLowerCase() !== owner) {
      throw new Error("Referral code is already reserved by another wallet.");
    }
    if (matchingInvite) {
      matchingInvite.claimedAt = now.toISOString();
      matchingInvite.txHash = null;
      this.write(store);
      return matchingInvite;
    }

    const record: ReferralInviteRecord = {
      code: normalizedCode,
      commitment: normalizedCommitment,
      owner,
      claimedAt: now.toISOString(),
      txHash: null
    };
    store.invites.push(record);
    this.write(store);
    return record;
  }

  recordClaimTransaction(
    wallet: string,
    code: unknown,
    commitment: string,
    txHash: string,
    now = new Date()
  ): ReferralInviteRecord {
    const normalizedTxHash = normalizeTxHash(txHash);
    this.recordClaimIntent(wallet, code, commitment, now);
    const store = this.read();
    const record = store.invites.find((invite) =>
      invite.commitment.toLowerCase() === commitment.toLowerCase()
    );
    if (!record) throw new Error("Referral claim preimage recovery record was not persisted.");
    record.claimedAt = now.toISOString();
    record.txHash = normalizedTxHash;
    this.write(store);
    return record;
  }

  findByCode(code: unknown): ReferralInviteRecord | undefined {
    const normalized = normalizeReferralCode(code);
    return this.read().invites.find((invite) => invite.code === normalized);
  }

  findByCommitment(commitment: string): ReferralInviteRecord | undefined {
    const normalized = normalizeHex32(commitment, "commitment").toLowerCase();
    return this.read().invites.find((invite) => invite.commitment.toLowerCase() === normalized);
  }

  invitesForOwner(owner: string): ReferralInviteRecord[] {
    const normalized = normalizeAddress(owner).toLowerCase();
    return this.read().invites
      .filter((invite) => invite.owner.toLowerCase() === normalized)
      .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
  }

  private read(): ReferralStoreJson {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ReferralStoreJson>;
      const invites = Array.isArray(parsed.invites) ? parsed.invites : [];
      return { invites: invites.filter(isReferralInviteRecord) };
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") return { invites: [] };
      throw error;
    }
  }

  private write(store: ReferralStoreJson): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`);
    renameSync(tempPath, this.path);
  }
}

export function createReferralStore(config: BackendConfig): ReferralInviteStore {
  return new ReferralInviteStore(config.referralStorePath);
}

export function resolveReferralCode(input: {
  code: unknown;
  index: ReferralChainIndex;
  invitee?: string;
  now?: Date;
  startPriceWei: string | null;
  store: ReferralInviteStore;
}): ReferralResolveResult {
  const now = input.now ?? new Date();
  let invite: ReferralInviteRecord | undefined;
  try {
    invite = input.store.findByCode(input.code);
  } catch {
    invite = undefined;
  }
  const price = parseWei(input.startPriceWei);
  const reward = price === null ? null : price / 2n;
  const common = {
    inviterRewardWei: reward?.toString() ?? null,
    startPriceWei: price?.toString() ?? null
  };
  if (!invite) {
    return resolveResult("invalid", "Referral code was not found.", null, null, null, referralClaimsPerWindow, common);
  }

  const owner = normalizeAddress(invite.owner).toLowerCase() as `0x${string}`;
  const claim = latestReferralClaim(
    input.index.referralClaims(owner),
    invite.commitment
  );
  if (!claim) {
    return resolveResult("unclaimed", "Referral code is not confirmed on-chain yet.", invite.commitment, null, null, referralClaimsPerWindow, common);
  }

  const claimedAtMs = Number(claim.claimedAt) * 1_000;
  const expiresAt = new Date(claimedAtMs + referralClaimWindowMs).toISOString();
  const redemptions = input.index.referralRedemptionsForInviter(owner);
  const quota = referralQuota(redemptions.map(chainRedemptionTime), now);
  if (now.getTime() >= claimedAtMs + referralClaimWindowMs) {
    return resolveResult("expired", "Referral code has expired.", invite.commitment, expiresAt, quota.nextClaimAt, quota.remainingClaims, common);
  }
  if (input.invitee) {
    const invitee = normalizeAddress(input.invitee).toLowerCase();
    if (invitee === owner) {
      return resolveResult("self_invite", "Referral invites cannot be redeemed by the inviter.", invite.commitment, expiresAt, quota.nextClaimAt, quota.remainingClaims, common);
    }
    if (redemptions.some((event) => event.invitee.toLowerCase() === invitee)) {
      return resolveResult("already_redeemed", "This wallet has already redeemed a referral invite.", invite.commitment, expiresAt, quota.nextClaimAt, quota.remainingClaims, common);
    }
  }
  if (quota.remainingClaims === 0) {
    return resolveResult("exhausted", "Referral redemption quota is exhausted.", invite.commitment, expiresAt, quota.nextClaimAt, 0, common);
  }
  if (price === null) {
    return resolveResult("unavailable", "The current on-chain settlement price is unavailable.", invite.commitment, expiresAt, quota.nextClaimAt, quota.remainingClaims, common);
  }
  return resolveResult("active", "Referral code is active.", invite.commitment, expiresAt, quota.nextClaimAt, quota.remainingClaims, common);
}

export async function buildReferralRedemption(
  config: BackendConfig,
  invite: ReferralInviteRecord,
  invitee: string
): Promise<ReferralRedemption> {
  if (!config.referralSignerPrivateKey) throw new Error("Referral signer is not configured.");
  const contractAddress = config.gameContractAddress;
  if (!contractAddress) throw new Error("Game contract address is not configured.");

  const account = privateKeyToAccount(config.referralSignerPrivateKey);
  const normalizedInvitee = normalizeAddress(invitee);
  const payloadHash = referralRedeemPayloadHash({
    chainId: config.chainId,
    commitment: invite.commitment,
    contractAddress,
    invitee: normalizedInvitee
  });
  const signature = await account.signMessage({ message: { raw: payloadHash } });
  const { r, s, v } = splitSignature(signature);
  return { code: invite.code, commitment: invite.commitment, signature, v, r, s };
}

export function referralCodeHash(code: string): Hex {
  return keccak256(toHex(normalizeReferralCode(code)));
}

export function referralCommitment(code: string, inviter: string): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,bytes32"),
      [normalizeAddress(inviter), referralCodeHash(code)]
    )
  );
}

export function referralRedeemPayloadHash(input: {
  chainId: number;
  commitment: Hex;
  contractAddress: string;
  invitee: string;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32,uint256,address,address,bytes32"),
      [
        referralRedeemDomain,
        BigInt(input.chainId),
        normalizeAddress(input.contractAddress),
        normalizeAddress(input.invitee),
        input.commitment
      ]
    )
  );
}

export function referralQuota(
  redemptions: Array<{ redeemedAt?: string; claimedAt?: string }>,
  now = new Date()
): { remainingClaims: number; nextClaimAt: string | null } {
  const active = redemptions
    .map((redemption) => new Date(redemption.redeemedAt ?? redemption.claimedAt ?? "").getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && now.getTime() - timestamp < referralClaimWindowMs)
    .sort((a, b) => a - b);
  const remainingClaims = Math.max(0, referralClaimsPerWindow - active.length);
  return {
    remainingClaims,
    nextClaimAt: remainingClaims > 0 || active.length === 0
      ? null
      : new Date(active[0]! + referralClaimWindowMs).toISOString()
  };
}

export function normalizeReferralCode(value: unknown): string {
  if (typeof value !== "string") throw new Error("Referral code is required.");
  const code = value.trim();
  if (!referralCodePattern.test(code)) {
    throw new Error("Referral code must be 9 letters, numbers, underscores, or hyphens.");
  }
  return code;
}

export function referralWalletMessage(wallet: string, action: ReferralWalletAction, commitment?: string): string {
  const lines = [
    "Veydrift referral invites",
    `Wallet: ${normalizeAddress(wallet).toLowerCase()}`,
    `Action: ${action}`
  ];
  if (commitment !== undefined) {
    lines.push(`Commitment: ${normalizeHex32(commitment, "commitment").toLowerCase()}`);
  }
  lines.push("Only sign this message if you want to manage your private Veydrift referral invite.");
  return lines.join("\n");
}

export async function verifyReferralWalletSignature({
  action,
  commitment,
  signature,
  wallet
}: {
  action: ReferralWalletAction;
  commitment?: string;
  signature: unknown;
  wallet: string;
}): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(signature)) return false;
  try {
    return await verifyMessage({
      address: getAddress(normalizeAddress(wallet)),
      message: referralWalletMessage(wallet, action, commitment),
      signature: signature as Hex
    });
  } catch {
    return false;
  }
}

function canonicalReferralDashboard(input: {
  configured: boolean;
  includeSecrets: boolean;
  index: ReferralChainIndex;
  now: Date;
  startPriceWei: string | null;
  store: ReferralInviteStore;
  wallet: string;
}): ReferralDashboard {
  const owner = normalizeAddress(input.wallet).toLowerCase() as `0x${string}`;
  const claims = latestReferralClaims(input.index.referralClaims(owner));
  const redemptions = input.index.referralRedemptionsForInviter(owner);
  const rewardClaims = input.index.referralRewardClaimsForInviter(owner);
  const claimedCredits = new Set(rewardClaims.map((claim) => rewardKey(claim.commitment, claim.invitee)));
  const redemptionRecords = redemptions.map((event) => chainRedemptionRecord(event, claimedCredits));
  const quota = referralQuota(redemptions.map(chainRedemptionTime), input.now);
  const stored = input.store.invitesForOwner(owner);
  const claimCommitments = new Set(claims.map((claim) => claim.commitment.toLowerCase()));
  const summaries = claims.map((claim) => {
    const record = stored.find((candidate) => candidate.commitment.toLowerCase() === claim.commitment.toLowerCase());
    return chainInviteSummary({
      claim,
      includeSecrets: input.includeSecrets,
      now: input.now,
      owner,
      quota,
      ...(record ? { record } : {}),
      redemptions: redemptionRecords.filter((item) => item.commitment.toLowerCase() === claim.commitment.toLowerCase())
    });
  });
  for (const record of stored.filter((candidate) => !claimCommitments.has(candidate.commitment.toLowerCase()))) {
    summaries.push(pendingInviteSummary(record, input.includeSecrets, quota));
  }
  summaries.sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
  const invite = summaries.at(-1) ?? null;

  const accrued = redemptions.reduce((sum, event) => sum + indexedRewardAmount(event), 0n);
  const directlyPaid = redemptions.reduce((sum, event) => sum + (event.paid ? indexedRewardAmount(event) : 0n), 0n);
  const claimed = rewardClaims.reduce((sum, event) => sum + BigInt(event.amount), 0n);
  const credited = redemptions.reduce((sum, event) => sum + (event.credited ? indexedRewardAmount(event) : 0n), 0n);
  const claimable = credited > claimed ? credited - claimed : 0n;
  const price = parseWei(input.startPriceWei);

  return {
    configured: input.configured,
    invite,
    invites: summaries,
    nextClaimAt: invite?.status === "active" ? invite.expiresAt : null,
    nextRedemptionAt: quota.nextClaimAt,
    remainingClaims: quota.remainingClaims,
    remainingRedemptions: quota.remainingClaims,
    rewardPerUseWei: price === null ? null : (price / 2n).toString(),
    totalAccruedRewardsWei: accrued.toString(),
    totalPaidRewardsWei: (directlyPaid + claimed).toString(),
    claimableRewardsWei: claimable.toString(),
    redemptions: redemptionRecords
  };
}

function chainInviteSummary(input: {
  claim: IndexedReferralClaimEvent;
  includeSecrets: boolean;
  now: Date;
  owner: string;
  quota: ReturnType<typeof referralQuota>;
  record?: ReferralInviteRecord;
  redemptions: ReferralRedemptionRecord[];
}): ReferralInviteSummary {
  const claimedAt = new Date(Number(input.claim.claimedAt) * 1_000).toISOString();
  const expiresAt = new Date(Number(input.claim.claimedAt) * 1_000 + referralClaimWindowMs).toISOString();
  const expired = input.now.getTime() >= Date.parse(expiresAt);
  const code = input.includeSecrets ? input.record?.code ?? null : null;
  return {
    code,
    commitment: input.claim.commitment,
    owner: input.owner,
    claimedAt,
    txHash: input.claim.transactionHash,
    expiresAt,
    expired,
    link: code ? `${referralInviteUrlBase}?ref=${encodeURIComponent(code)}` : null,
    remainingRedemptions: input.quota.remainingClaims,
    nextRedemptionAt: input.quota.nextClaimAt,
    redemptionCount: input.redemptions.length,
    redemptions: input.redemptions,
    status: expired ? "expired" : "active"
  };
}

function pendingInviteSummary(
  record: ReferralInviteRecord,
  includeSecrets: boolean,
  quota: ReturnType<typeof referralQuota>
): ReferralInviteSummary {
  const code = includeSecrets ? record.code : null;
  return {
    code,
    commitment: record.commitment,
    owner: record.owner,
    claimedAt: record.claimedAt,
    txHash: null,
    expiresAt: new Date(Date.parse(record.claimedAt) + referralClaimWindowMs).toISOString(),
    expired: false,
    link: code ? `${referralInviteUrlBase}?ref=${encodeURIComponent(code)}` : null,
    remainingRedemptions: quota.remainingClaims,
    nextRedemptionAt: quota.nextClaimAt,
    redemptionCount: 0,
    redemptions: [],
    status: "pending_claim"
  };
}

function chainRedemptionRecord(
  event: IndexedReferralRedemptionEvent,
  claimedCredits: ReadonlySet<string>
): ReferralRedemptionRecord {
  const rewardAmountWei = indexedRewardAmountString(event);
  const claimed = claimedCredits.has(rewardKey(event.commitment, event.invitee));
  return {
    invitee: event.invitee,
    commitment: event.commitment,
    redeemedAt: new Date(Number(event.redeemedAt) * 1_000).toISOString(),
    rewardAmountWei,
    paid: event.paid || claimed,
    credited: event.credited,
    paymentStatus: rewardAmountWei === null ? "legacy_unknown" : event.paid ? "paid" : claimed ? "claimed" : "credited",
    txHash: event.transactionHash
  };
}

function indexedRewardAmountString(event: IndexedReferralRedemptionEvent): string | null {
  const value = (event as IndexedReferralRedemptionEvent & { rewardAmount?: unknown }).rewardAmount;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function indexedRewardAmount(event: IndexedReferralRedemptionEvent): bigint {
  const value = indexedRewardAmountString(event);
  return value === null ? 0n : BigInt(value);
}

function chainRedemptionTime(event: IndexedReferralRedemptionEvent): { redeemedAt: string } {
  return { redeemedAt: new Date(Number(event.redeemedAt) * 1_000).toISOString() };
}

function rewardKey(commitment: string, invitee: string): string {
  return `${commitment.toLowerCase()}:${invitee.toLowerCase()}`;
}

function latestReferralClaims(claims: IndexedReferralClaimEvent[]): IndexedReferralClaimEvent[] {
  const latest = new Map<string, IndexedReferralClaimEvent>();
  for (const claim of claims) {
    const key = claim.commitment.toLowerCase();
    const current = latest.get(key);
    if (!current || referralClaimOrder(claim) > referralClaimOrder(current)) latest.set(key, claim);
  }
  return [...latest.values()].sort((left, right) => {
    const order = referralClaimOrder(left) - referralClaimOrder(right);
    return order === 0 ? left.commitment.localeCompare(right.commitment) : order;
  });
}

function latestReferralClaim(
  claims: IndexedReferralClaimEvent[],
  commitment: string
): IndexedReferralClaimEvent | undefined {
  const normalized = commitment.toLowerCase();
  return latestReferralClaims(claims.filter((claim) => claim.commitment.toLowerCase() === normalized)).at(-1);
}

function referralClaimOrder(claim: IndexedReferralClaimEvent): number {
  const claimedAt = Number(claim.claimedAt);
  return Number.isFinite(claimedAt) ? claimedAt : 0;
}

function resolveResult(
  status: ReferralResolveStatus,
  message: string,
  commitment: Hex | null,
  expiresAt: string | null,
  nextRedemptionAt: string | null,
  remainingRedemptions: number,
  price: { startPriceWei: string | null; inviterRewardWei: string | null }
): ReferralResolveResult {
  return {
    valid: status === "active",
    status,
    message,
    commitment,
    expiresAt,
    nextRedemptionAt,
    remainingRedemptions,
    ...price
  };
}

function parseWei(value: string | null): bigint | null {
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  return BigInt(value);
}

function normalizeHex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed 32-byte hex value.`);
  }
  return value as Hex;
}

function normalizeTxHash(value: unknown): Hex {
  return normalizeHex32(value, "txHash");
}

function normalizeAddress(value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("Expected a 0x-prefixed 20-byte EVM address.");
  }
  return value as Address;
}

function splitSignature(signature: Hex): { r: Hex; s: Hex; v: number } {
  const clean = signature.replace(/^0x/, "");
  if (clean.length !== 130) throw new Error("Unexpected referral signature length.");
  return {
    r: `0x${clean.slice(0, 64)}` as Hex,
    s: `0x${clean.slice(64, 128)}` as Hex,
    v: Number.parseInt(clean.slice(128, 130), 16)
  };
}

function isReferralInviteRecord(value: unknown): value is ReferralInviteRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReferralInviteRecord>;
  return typeof candidate.code === "string"
    && /^0x[a-fA-F0-9]{64}$/.test(candidate.commitment ?? "")
    && typeof candidate.owner === "string"
    && typeof candidate.claimedAt === "string";
}
