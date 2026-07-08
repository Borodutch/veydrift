import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";

export const referralRedeemDomain = keccak256(toHex("veydrift.referral.redeem.v1"));
export const referralInviteUrlBase = "https://veydrift.com";
export const referralClaimWindowMs = 24 * 60 * 60 * 1000;
export const referralClaimsPerWindow = 3;

export type ReferralRedemptionRecord = {
  invitee: string;
  redeemedAt: string;
  txHash?: string | null;
};

export type ReferralInviteRecord = {
  code: string;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  txHash?: string | null;
  redemptions?: ReferralRedemptionRecord[];
};

export type ReferralInviteSummary = Omit<ReferralInviteRecord, "code"> & {
  code: string;
  link: string;
  remainingRedemptions: number;
  nextRedemptionAt: string | null;
  redemptionCount: number;
  status: "pending_claim" | "active";
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
};

export type ReferralRedemption = {
  code: string;
  commitment: Hex;
  signature: Hex;
  v: number;
  r: Hex;
  s: Hex;
};

export class ReferralInviteStore {
  constructor(private readonly path: string) {}

  dashboard(wallet: string, now = new Date()): ReferralDashboard {
    const owner = wallet.toLowerCase();
    const invite = this.ownerInvite(this.read(), owner);
    const summary = invite ? referralInviteSummary(invite, now) : null;
    return {
      configured: true,
      invite: summary,
      invites: summary ? [summary] : [],
      nextClaimAt: summary?.nextRedemptionAt ?? null,
      nextRedemptionAt: summary?.nextRedemptionAt ?? null,
      remainingClaims: summary?.remainingRedemptions ?? referralClaimsPerWindow,
      remainingRedemptions: summary?.remainingRedemptions ?? referralClaimsPerWindow
    };
  }

  createInvite(wallet: string, now = new Date()): ReferralInviteSummary {
    const owner = wallet.toLowerCase();
    const store = this.read();
    const existing = this.ownerInvite(store, owner);
    if (existing) return referralInviteSummary(existing, now);

    let record: ReferralInviteRecord | undefined;
    for (let attempt = 0; attempt < 8 && !record; attempt++) {
      const code = randomBytes(32).toString("base64url");
      const commitment = referralCommitment(code);
      if (!store.invites.some((invite) => invite.commitment.toLowerCase() === commitment.toLowerCase())) {
        record = {
          code,
          commitment,
          owner,
          claimedAt: now.toISOString(),
          redemptions: [],
          txHash: null
        };
      }
    }
    if (!record) {
      throw new Error("Could not generate a unique referral code.");
    }

    store.invites.push(record);
    this.write(store);
    return referralInviteSummary(record, now);
  }

  recordClaimTransaction(wallet: string, commitment: string, txHash: string): ReferralInviteSummary {
    const owner = wallet.toLowerCase();
    const normalizedCommitment = normalizeHex32(commitment, "commitment");
    const store = this.read();
    const invite = store.invites.find((candidate) =>
      candidate.owner.toLowerCase() === owner
      && candidate.commitment.toLowerCase() === normalizedCommitment.toLowerCase()
    );
    if (!invite) {
      throw new Error("Referral invite was not generated for this wallet.");
    }
    invite.txHash = txHash;
    this.write(store);
    return referralInviteSummary(invite);
  }

  pendingRedemption(code: unknown, invitee: string, now = new Date()): ReferralInviteRecord | undefined {
    const normalized = normalizeReferralCode(code);
    const normalizedInvitee = normalizeAddress(invitee).toLowerCase();
    const invite = this.read().invites.find((candidate) => candidate.code === normalized);
    if (!invite) return undefined;
    this.assertRedeemable(invite, normalizedInvitee, now);
    return invite;
  }

  recordRedemption(code: unknown, invitee: string, txHash: string, now = new Date()): ReferralInviteRecord | undefined {
    const normalized = normalizeReferralCode(code);
    const normalizedInvitee = normalizeAddress(invitee).toLowerCase();
    const normalizedTxHash = normalizeTxHash(txHash);
    const store = this.read();
    const invite = store.invites.find((candidate) => candidate.code === normalized);
    if (!invite) return undefined;
    this.assertRedeemable(invite, normalizedInvitee, now);

    const redemptions = invite.redemptions ?? [];
    invite.redemptions = [
      ...redemptions,
      {
        invitee: normalizedInvitee,
        redeemedAt: now.toISOString(),
        txHash: normalizedTxHash
      }
    ];
    this.write(store);
    return invite;
  }

  private assertRedeemable(invite: ReferralInviteRecord, normalizedInvitee: string, now: Date): void {
    if (!invite.txHash) {
      throw new ReferralInviteUnclaimedError();
    }
    if (invite.owner.toLowerCase() === normalizedInvitee) {
      throw new ReferralSelfInviteError();
    }
    const redemptions = invite.redemptions ?? [];
    if (redemptions.some((redemption) => redemption.invitee.toLowerCase() === normalizedInvitee)) {
      throw new ReferralInviteeAlreadyRedeemedError();
    }
    const quota = referralQuota(redemptions, now);
    if (quota.remainingClaims <= 0) {
      throw new ReferralQuotaError(quota.nextClaimAt);
    }
  }

  findByCode(code: unknown): ReferralInviteRecord | undefined {
    const normalized = normalizeReferralCode(code);
    return this.read().invites.find((invite) => invite.code === normalized);
  }

  private ownerInvite(store: ReferralStoreJson, owner: string): ReferralInviteRecord | undefined {
    return store.invites
      .filter((invite) => invite.owner.toLowerCase() === owner)
      .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
      [0];
  }

  private read(): ReferralStoreJson {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ReferralStoreJson>;
      const invites = Array.isArray(parsed.invites) ? parsed.invites : [];
      return {
        invites: invites.filter(isReferralInviteRecord)
      };
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") {
        return { invites: [] };
      }
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

export class ReferralQuotaError extends Error {
  constructor(readonly nextClaimAt: string | null) {
    super("Referral redemption quota exceeded.");
  }
}

export class ReferralInviteUnclaimedError extends Error {
  constructor() {
    super("Referral invite has not been claimed on-chain yet.");
  }
}

export class ReferralInviteeAlreadyRedeemedError extends Error {
  constructor() {
    super("This wallet has already redeemed this referral invite.");
  }
}

export class ReferralSelfInviteError extends Error {
  constructor() {
    super("Referral invites cannot be redeemed by the inviter.");
  }
}

export function createReferralStore(config: BackendConfig): ReferralInviteStore {
  return new ReferralInviteStore(config.referralStorePath);
}

export async function buildReferralRedemption(
  config: BackendConfig,
  invite: ReferralInviteRecord,
  invitee: string
): Promise<ReferralRedemption> {
  if (!config.referralSignerPrivateKey) {
    throw new Error("Referral signer is not configured.");
  }
  const contractAddress = config.settlementContractAddress ?? config.gameContractAddress;
  if (!contractAddress) {
    throw new Error("Settlement contract address is not configured.");
  }

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
  return {
    code: invite.code,
    commitment: invite.commitment,
    signature,
    v,
    r,
    s
  };
}

export function referralCommitment(code: string): Hex {
  return keccak256(toHex(normalizeReferralCode(code)));
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
  redemptions: Array<Partial<Pick<ReferralInviteRecord, "claimedAt">> & Partial<ReferralRedemptionRecord>>,
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

export function referralInviteSummary(invite: ReferralInviteRecord, now = new Date()): ReferralInviteSummary {
  const quota = referralQuota(invite.redemptions ?? [], now);
  return {
    ...invite,
    link: `${referralInviteUrlBase}?ref=${encodeURIComponent(invite.code)}`,
    nextRedemptionAt: quota.nextClaimAt,
    remainingRedemptions: quota.remainingClaims,
    redemptionCount: invite.redemptions?.length ?? 0,
    status: invite.txHash ? "active" : "pending_claim"
  };
}

export function normalizeReferralCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Referral code is required.");
  }
  const code = value.trim();
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(code)) {
    throw new Error("Referral code is invalid.");
  }
  return code;
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
  if (clean.length !== 130) {
    throw new Error("Unexpected referral signature length.");
  }
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
