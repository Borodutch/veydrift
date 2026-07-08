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

export type ReferralInviteRecord = {
  code: string;
  commitment: Hex;
  owner: string;
  claimedAt: string;
  txHash?: string | null;
};

export type ReferralInviteSummary = Omit<ReferralInviteRecord, "code"> & {
  code: string;
  link: string;
  status: "pending_claim" | "unused";
};

type ReferralStoreJson = {
  invites: ReferralInviteRecord[];
};

export type ReferralDashboard = {
  configured: boolean;
  invites: ReferralInviteSummary[];
  nextClaimAt: string | null;
  remainingClaims: number;
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
    const invites = this.read().invites
      .filter((invite) => invite.owner.toLowerCase() === owner)
      .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
      .map(referralInviteSummary);
    const quota = referralQuota(invites, now);
    return {
      configured: true,
      invites,
      nextClaimAt: quota.nextClaimAt,
      remainingClaims: quota.remainingClaims
    };
  }

  createInvite(wallet: string, now = new Date()): ReferralInviteSummary {
    const owner = wallet.toLowerCase();
    const store = this.read();
    const ownerInvites = store.invites.filter((invite) => invite.owner.toLowerCase() === owner);
    const quota = referralQuota(ownerInvites, now);
    if (quota.remainingClaims <= 0) {
      throw new ReferralQuotaError(quota.nextClaimAt);
    }

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
          txHash: null
        };
      }
    }
    if (!record) {
      throw new Error("Could not generate a unique referral code.");
    }

    store.invites.push(record);
    this.write(store);
    return referralInviteSummary(record);
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

  findByCode(code: unknown): ReferralInviteRecord | undefined {
    const normalized = normalizeReferralCode(code);
    return this.read().invites.find((invite) => invite.code === normalized);
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
    super("Referral claim quota exceeded.");
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
  invites: Array<Pick<ReferralInviteRecord, "claimedAt">>,
  now = new Date()
): { remainingClaims: number; nextClaimAt: string | null } {
  const active = invites
    .map((invite) => new Date(invite.claimedAt).getTime())
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

export function referralInviteSummary(invite: ReferralInviteRecord): ReferralInviteSummary {
  return {
    ...invite,
    link: `${referralInviteUrlBase}?ref=${encodeURIComponent(invite.code)}`,
    status: invite.txHash ? "unused" : "pending_claim"
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
