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
export const referralCodePattern = /^[A-Za-z0-9_-]{1,24}$/;

export type ReferralInviteRecord = {
  code: string;
  codeHash: Hex;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  activeUntil: string;
  txHash: string;
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
  code: string;
  codeHash: Hex;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  txHash: string;
  expiresAt: string;
  expired: boolean;
  link: string;
  remainingRedemptions: number;
  nextRedemptionAt: string | null;
  redemptionCount: number;
  redemptions: ReferralRedemptionRecord[];
  renewable: boolean;
  status: "active" | "renewable" | "owned";
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
  | "inactive"
  | "exhausted"
  | "self_invite"
  | "already_redeemed"
  | "available"
  | "invalid"
  | "unavailable";

export type ReferralOwnershipState = "available" | "owned_by_you" | "reserved";

export type ReferralResolveResult = {
  valid: boolean;
  status: ReferralResolveStatus;
  message: string;
  normalizedCode: string | null;
  codeHash: Hex | null;
  owner: string | null;
  ownership: ReferralOwnershipState;
  renewable: boolean;
  commitment: Hex | null;
  expiresAt: string | null;
  nextRedemptionAt: string | null;
  remainingRedemptions: number;
  startPriceWei: string | null;
  inviterRewardWei: string | null;
};

export type ReferralWalletAction = "dashboard" | "claim-transaction";

export type ReferralChainIndex = {
  referralClaim(owner: `0x${string}`, commitment: `0x${string}`, txHash: `0x${string}`): IndexedReferralClaimEvent | null;
  referralClaims(owner: `0x${string}`): IndexedReferralClaimEvent[];
  referralClaimsByCodeHash(codeHash: `0x${string}`): IndexedReferralClaimEvent[];
  referralRedemptionsForInviter(inviter: `0x${string}`): IndexedReferralRedemptionEvent[];
  referralRedemptionsForInvitee(invitee: `0x${string}`): IndexedReferralRedemptionEvent[];
  referralRewardClaimsForInviter(inviter: `0x${string}`): IndexedReferralRewardClaimEvent[];
};

// Kept as the server dependency boundary so existing construction/tests do not need a
// separate service object. It is deliberately stateless: all referral truth comes from
// indexed contract events, never from the former referral JSON side file.
export class ReferralInviteStore {
  constructor(_unusedPath?: string) {}

  dashboard(
    wallet: string,
    index: ReferralChainIndex,
    startPriceWei: string | null,
    configured: boolean,
    _includeSecrets = false,
    now = new Date()
  ): ReferralDashboard {
    return canonicalReferralDashboard({ configured, index, now, startPriceWei, wallet });
  }
}

export function createReferralStore(_config: BackendConfig): ReferralInviteStore {
  return new ReferralInviteStore();
}

export function resolveReferralCode(input: {
  code: unknown;
  index: ReferralChainIndex;
  invitee?: string;
  wallet?: string;
  now?: Date;
  startPriceWei: string | null;
}): ReferralResolveResult {
  const now = input.now ?? new Date();
  const price = parseWei(input.startPriceWei);
  const common = {
    inviterRewardWei: price === null ? null : (price / 2n).toString(),
    startPriceWei: price?.toString() ?? null
  };

  let code: string;
  try {
    code = normalizeReferralCode(input.code);
  } catch (error) {
    return resolveResult({
      status: "invalid",
      message: error instanceof Error ? error.message : "Referral code is invalid.",
      normalizedCode: null,
      codeHash: null,
      owner: null,
      ownership: "available",
      renewable: false,
      commitment: null,
      expiresAt: null,
      nextRedemptionAt: null,
      remainingRedemptions: referralClaimsPerWindow,
      ...common
    });
  }

  const codeHash = referralCodeHash(code);
  const claim = latestReferralClaims(input.index.referralClaimsByCodeHash(codeHash)).at(-1);
  if (!claim) {
    const availableOwner = input.wallet
      ? normalizeAddress(input.wallet).toLowerCase() as `0x${string}`
      : null;
    const availableQuota = availableOwner
      ? referralQuota(input.index.referralRedemptionsForInviter(availableOwner).map(chainRedemptionTime), now)
      : { remainingClaims: referralClaimsPerWindow, nextClaimAt: null };
    return resolveResult({
      status: "available",
      message: "Referral code is available to claim.",
      normalizedCode: code,
      codeHash,
      owner: null,
      ownership: "available",
      renewable: false,
      commitment: null,
      expiresAt: null,
      nextRedemptionAt: availableQuota.nextClaimAt,
      remainingRedemptions: availableQuota.remainingClaims,
      ...common
    });
  }

  const owner = normalizeAddress(claim.inviter).toLowerCase() as `0x${string}`;
  const wallet = input.wallet ? normalizeAddress(input.wallet).toLowerCase() : null;
  const ownership: ReferralOwnershipState = wallet === owner ? "owned_by_you" : "reserved";
  const expiresAt = new Date(Number(claim.activeUntil) * 1_000).toISOString();
  const currentClaim = latestReferralClaims(input.index.referralClaims(owner)).at(-1);
  const currentActive = Boolean(
    currentClaim && now.getTime() < Number(currentClaim.activeUntil) * 1_000
  );
  const active = currentClaim?.commitment.toLowerCase() === claim.commitment.toLowerCase()
    && now.getTime() < Number(claim.activeUntil) * 1_000;
  const redemptions = input.index.referralRedemptionsForInviter(owner);
  const quota = referralQuota(redemptions.map(chainRedemptionTime), now);

  if (!active) {
    const renewable = ownership === "owned_by_you" && !currentActive;
    return resolveResult({
      status: "inactive",
      message: ownership === "owned_by_you" && renewable
        ? "Referral code is owned by this wallet and can be renewed."
        : ownership === "owned_by_you"
          ? "Referral code is owned by this wallet, but another invite code is active."
        : "Referral code is permanently reserved and its invite window is inactive.",
      normalizedCode: code,
      codeHash,
      owner,
      ownership,
      renewable,
      commitment: claim.commitment,
      expiresAt,
      nextRedemptionAt: quota.nextClaimAt,
      remainingRedemptions: quota.remainingClaims,
      ...common
    });
  }

  if (input.invitee) {
    const invitee = normalizeAddress(input.invitee).toLowerCase() as `0x${string}`;
    if (invitee === owner) {
      return resolveResult({
        status: "self_invite",
        message: "Referral invites cannot be redeemed by the inviter.",
        normalizedCode: code,
        codeHash,
        owner,
        ownership,
        renewable: false,
        commitment: claim.commitment,
        expiresAt,
        nextRedemptionAt: quota.nextClaimAt,
        remainingRedemptions: quota.remainingClaims,
        ...common
      });
    }
    if (input.index.referralRedemptionsForInvitee(invitee).length > 0) {
      return resolveResult({
        status: "already_redeemed",
        message: "This wallet has already redeemed a referral invite.",
        normalizedCode: code,
        codeHash,
        owner,
        ownership,
        renewable: false,
        commitment: claim.commitment,
        expiresAt,
        nextRedemptionAt: quota.nextClaimAt,
        remainingRedemptions: quota.remainingClaims,
        ...common
      });
    }
  }

  if (quota.remainingClaims === 0) {
    return resolveResult({
      status: "exhausted",
      message: "Referral redemption quota is exhausted.",
      normalizedCode: code,
      codeHash,
      owner,
      ownership,
      renewable: false,
      commitment: claim.commitment,
      expiresAt,
      nextRedemptionAt: quota.nextClaimAt,
      remainingRedemptions: 0,
      ...common
    });
  }
  if (price === null) {
    return resolveResult({
      status: "unavailable",
      message: "The current on-chain settlement price is unavailable.",
      normalizedCode: code,
      codeHash,
      owner,
      ownership,
      renewable: false,
      commitment: claim.commitment,
      expiresAt,
      nextRedemptionAt: quota.nextClaimAt,
      remainingRedemptions: quota.remainingClaims,
      ...common
    });
  }
  return resolveResult({
    status: "active",
    message: "Referral code is active.",
    normalizedCode: code,
    codeHash,
    owner,
    ownership,
    renewable: false,
    commitment: claim.commitment,
    expiresAt,
    nextRedemptionAt: quota.nextClaimAt,
    remainingRedemptions: quota.remainingClaims,
    ...common
  });
}

export async function buildReferralRedemption(
  config: BackendConfig,
  invite: Pick<ReferralInviteRecord, "code" | "commitment">,
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

export function referralInviteRecord(claim: IndexedReferralClaimEvent): ReferralInviteRecord {
  return {
    code: claim.code,
    codeHash: claim.codeHash,
    commitment: claim.commitment,
    owner: claim.inviter.toLowerCase(),
    claimedAt: new Date(Number(claim.claimedAt) * 1_000).toISOString(),
    activeUntil: new Date(Number(claim.activeUntil) * 1_000).toISOString(),
    txHash: claim.transactionHash
  };
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
    throw new Error("Referral code must be 1–24 letters, numbers, underscores, or hyphens.");
  }
  return code.toLowerCase();
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
  lines.push("Only sign this message if you want to manage your Veydrift referral invite.");
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
  index: ReferralChainIndex;
  now: Date;
  startPriceWei: string | null;
  wallet: string;
}): ReferralDashboard {
  const owner = normalizeAddress(input.wallet).toLowerCase() as `0x${string}`;
  const claims = latestReferralClaims(input.index.referralClaims(owner));
  const redemptions = input.index.referralRedemptionsForInviter(owner);
  const rewardClaims = input.index.referralRewardClaimsForInviter(owner);
  const claimedCredits = new Set(rewardClaims.map((claim) => rewardKey(claim.commitment, claim.invitee)));
  const redemptionRecords = redemptions.map((event) => chainRedemptionRecord(event, claimedCredits));
  const quota = referralQuota(redemptions.map(chainRedemptionTime), input.now);
  const currentClaim = claims.at(-1);
  const currentActive = Boolean(
    currentClaim && input.now.getTime() < Number(currentClaim.activeUntil) * 1_000
  );
  const summaries = claims.map((claim) => chainInviteSummary({
    claim,
    currentActive,
    currentCommitment: currentClaim?.commitment ?? null,
    now: input.now,
    owner,
    quota,
    redemptions: redemptionRecords.filter((item) => item.commitment.toLowerCase() === claim.commitment.toLowerCase())
  }));
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
    nextClaimAt: currentActive ? currentClaim ? new Date(Number(currentClaim.activeUntil) * 1_000).toISOString() : null : null,
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
  currentActive: boolean;
  currentCommitment: string | null;
  now: Date;
  owner: string;
  quota: ReturnType<typeof referralQuota>;
  redemptions: ReferralRedemptionRecord[];
}): ReferralInviteSummary {
  const claimedAt = new Date(Number(input.claim.claimedAt) * 1_000).toISOString();
  const expiresAt = new Date(Number(input.claim.activeUntil) * 1_000).toISOString();
  const expired = input.now.getTime() >= Date.parse(expiresAt);
  const isCurrent = input.currentCommitment?.toLowerCase() === input.claim.commitment.toLowerCase();
  const status = isCurrent && !expired
    ? "active"
    : !input.currentActive
      ? "renewable"
      : "owned";
  return {
    code: input.claim.code,
    codeHash: input.claim.codeHash,
    commitment: input.claim.commitment,
    owner: input.owner,
    claimedAt,
    txHash: input.claim.transactionHash,
    expiresAt,
    expired,
    link: `${referralInviteUrlBase}?ref=${encodeURIComponent(input.claim.code)}`,
    remainingRedemptions: input.quota.remainingClaims,
    nextRedemptionAt: input.quota.nextClaimAt,
    redemptionCount: input.redemptions.length,
    redemptions: input.redemptions,
    renewable: status === "renewable",
    status
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
  return /^\d+$/.test(event.rewardAmount) ? event.rewardAmount : null;
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
    if (!current || compareReferralClaims(claim, current) > 0) latest.set(key, claim);
  }
  return [...latest.values()].sort(compareReferralClaims);
}

function compareReferralClaims(left: IndexedReferralClaimEvent, right: IndexedReferralClaimEvent): number {
  const activationOrder = Number(left.claimedAt) - Number(right.claimedAt);
  if (activationOrder !== 0) return activationOrder;
  const chainOrder = referralClaimOrder(left) - referralClaimOrder(right);
  return chainOrder === 0 ? left.commitment.localeCompare(right.commitment) : chainOrder;
}

function referralClaimOrder(claim: IndexedReferralClaimEvent): number {
  const block = Number(claim.blockNumber);
  const log = Number.parseInt(claim.logIndex, 16);
  return (Number.isFinite(block) ? block : 0) * 1_000_000 + (Number.isFinite(log) ? log : 0);
}

function resolveResult(input: Omit<ReferralResolveResult, "valid"> & { status: ReferralResolveStatus }): ReferralResolveResult {
  return { ...input, valid: input.status === "active" };
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
