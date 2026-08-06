import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";

export const paidAllianceInviteSecretPattern = /^0x[0-9a-fA-F]{64}$/;
export const paidAllianceAuthorizationLifetimeSeconds = 10 * 60;

const inviteAbi = [{
  type: "function",
  name: "invite",
  stateMutability: "view",
  inputs: [{ name: "commitment", type: "bytes32" }],
  outputs: [{
    name: "",
    type: "tuple",
    components: [
      { name: "allianceId", type: "uint256" },
      { name: "purchaser", type: "address" },
      { name: "settlementPrice", type: "uint128" },
      { name: "purchasedAt", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "redeemed", type: "bool" },
    ],
  }],
}, {
  type: "function",
  name: "bonusBalance",
  stateMutability: "view",
  inputs: [{ name: "allianceId", type: "uint256" }],
  outputs: [{
    name: "",
    type: "tuple",
    components: [
      { name: "metal", type: "uint128" },
      { name: "crystal", type: "uint128" },
      { name: "deuterium", type: "uint128" },
    ],
  }],
}] as const;

export type PaidAllianceInviteState = {
  allianceId: bigint;
  purchaser: Address;
  settlementPrice: bigint;
  purchasedAt: bigint;
  validUntil: bigint;
  redeemed: boolean;
};

export type PaidAllianceInviteResolution = {
  commitment: Hex;
  allianceId: string | null;
  validUntil: string | null;
  status: "active" | "expired" | "invalid" | "redeemed";
  valid: boolean;
};

export interface PaidAllianceInviteReader {
  invite(commitment: Hex): Promise<PaidAllianceInviteState>;
  bonusBalance?(allianceId: bigint): Promise<{ metal: bigint; crystal: bigint; deuterium: bigint }>;
}

export function normalizePaidAllianceInviteSecret(secret: unknown): Hex {
  const normalized = String(secret ?? "").trim();
  if (!paidAllianceInviteSecretPattern.test(normalized)) {
    throw new Error("Alliance invite links require a 32-byte high-entropy secret.");
  }
  return normalized.toLowerCase() as Hex;
}

export function paidAllianceInviteCommitment(secret: unknown): Hex {
  return keccak256(normalizePaidAllianceInviteSecret(secret));
}

export function resolvePaidAllianceInvite(
  secret: unknown,
  state: PaidAllianceInviteState,
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
): PaidAllianceInviteResolution {
  const commitment = paidAllianceInviteCommitment(secret);
  if (state.allianceId === 0n) {
    return { commitment, allianceId: null, validUntil: null, status: "invalid", valid: false };
  }
  const base = {
    commitment,
    allianceId: state.allianceId.toString(),
    validUntil: state.validUntil.toString(),
  };
  if (state.redeemed) return { ...base, status: "redeemed", valid: false };
  if (nowSeconds >= state.validUntil) return { ...base, status: "expired", valid: false };
  return { ...base, status: "active", valid: true };
}

export function paidAllianceAuthorizationHash(
  chainId: number,
  contract: Address,
  commitment: Hex,
  invitee: Address,
  expiresAt: bigint,
): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,address,bytes32,address,uint64"),
    [
      keccak256(new TextEncoder().encode("VeydriftPaidAllianceInvite")),
      BigInt(chainId),
      contract,
      commitment,
      invitee,
      expiresAt,
    ],
  ));
}

export async function buildPaidAllianceInviteAuthorization(
  config: BackendConfig,
  secret: unknown,
  invitee: Address,
  state: PaidAllianceInviteState,
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
) {
  if (!config.paidAllianceInviteAddress || !config.paidAllianceInviteSignerPrivateKey) {
    throw new Error("Paid alliance invite redemption is not configured.");
  }
  const resolution = resolvePaidAllianceInvite(secret, state, nowSeconds);
  if (!resolution.valid) throw new Error(`Alliance invite is ${resolution.status}.`);
  const expiresAt = minBigInt(nowSeconds + BigInt(paidAllianceAuthorizationLifetimeSeconds), state.validUntil - 1n);
  if (expiresAt <= nowSeconds) throw new Error("Alliance invite is expired.");
  const hash = paidAllianceAuthorizationHash(
    config.chainId,
    config.paidAllianceInviteAddress,
    resolution.commitment,
    invitee,
    expiresAt,
  );
  const signature = await privateKeyToAccount(config.paidAllianceInviteSignerPrivateKey)
    .signMessage({ message: { raw: hash } });
  return { ...resolution, expiresAt: expiresAt.toString(), signature };
}

export function createPaidAllianceInviteReader(config: BackendConfig): PaidAllianceInviteReader | undefined {
  if (!config.rpcUrl || !config.paidAllianceInviteAddress) return undefined;
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  return {
    async invite(commitment) {
      return await client.readContract({
        address: config.paidAllianceInviteAddress!,
        abi: inviteAbi,
        functionName: "invite",
        args: [commitment],
      }) as PaidAllianceInviteState;
    },
    async bonusBalance(allianceId) {
      return await client.readContract({
        address: config.paidAllianceInviteAddress!,
        abi: inviteAbi,
        functionName: "bonusBalance",
        args: [allianceId],
      }) as { metal: bigint; crystal: bigint; deuterium: bigint };
    },
  };
}

export class PaidAllianceInviteRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maximum = 10, private readonly windowMs = 60_000) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (!current || now >= current.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.maximum) return false;
    current.count += 1;
    return true;
  }
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
