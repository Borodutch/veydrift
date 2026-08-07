import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbiParameters,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { BackendConfig } from "./config";

export const paidAllianceInviteSecretPattern = /^0x[0-9a-fA-F]{64}$/;
export const paidAllianceAuthorizationLifetimeSeconds = 10 * 60;
const paidAllianceInviteSecretRecordVersion = "Veydrift paid alliance invite secret v1";

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
  redeemed: boolean;
};

export type PaidAllianceInviteResolution = {
  commitment: Hex;
  allianceId: string | null;
  status: "active" | "invalid" | "redeemed";
  valid: boolean;
};

export interface PaidAllianceInviteReader {
  invite(commitment: Hex): Promise<PaidAllianceInviteState>;
  bonusBalance?(allianceId: bigint): Promise<{ metal: bigint; crystal: bigint; deuterium: bigint }>;
}

type EncryptedInviteRecord = {
  commitment: Hex;
  purchaser: Address;
  ciphertext: string;
  iv: string;
  tag: string;
  storedAt: string;
};

export function paidAllianceInviteStoreMessage(purchaser: Address, commitment: Hex): string {
  return `Veydrift paid alliance invite store\nPurchaser: ${purchaser.toLowerCase()}\nCommitment: ${commitment}`;
}

export function paidAllianceInviteRecoveryMessage(purchaser: Address): string {
  return `Veydrift paid alliance invite recovery\nPurchaser: ${purchaser.toLowerCase()}`;
}

export function paidAllianceInviteSecretRecordAad(commitmentInput: string, purchaserInput: string): Buffer {
  const commitment = normalizePaidAllianceInviteCommitment(commitmentInput);
  const purchaser = getAddress(purchaserInput).toLowerCase();
  return Buffer.from(
    `${paidAllianceInviteSecretRecordVersion}\nCommitment: ${commitment}\nPurchaser: ${purchaser}`,
    "utf8",
  );
}

export class PaidAllianceInviteSecretStore {
  private readonly keys: Buffer[];
  private readonly database: Database;

  constructor(private readonly path: string, keyHex: string, previousKeyHexes: string[] = []) {
    const keyRing = [keyHex, ...previousKeyHexes];
    if (keyRing.some((key) => !/^0x[0-9a-fA-F]{64}$/.test(key))) throw new Error("Paid invite encryption key must be 32 bytes.");
    this.keys = keyRing.map((key) => Buffer.from(key.slice(2), "hex"));
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS paid_alliance_invite_secrets (
        commitment TEXT PRIMARY KEY,
        purchaser TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        stored_at TEXT NOT NULL
      )
    `);
  }

  async store(secretInput: unknown, purchaserInput: string, signature: unknown, state: PaidAllianceInviteState): Promise<Hex> {
    const secret = normalizePaidAllianceInviteSecret(secretInput);
    const commitment = paidAllianceInviteCommitment(secret);
    const purchaser = getAddress(purchaserInput) as Address;
    if (purchaser !== getAddress(state.purchaser)) throw new Error("Only the invite purchaser can store this link.");
    if (typeof signature !== "string" || !await verifyMessage({
      address: purchaser,
      message: paidAllianceInviteStoreMessage(purchaser, commitment),
      signature: signature as Hex,
    })) throw new Error("Invalid purchaser authorization.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys[0]!, iv);
    cipher.setAAD(paidAllianceInviteSecretRecordAad(commitment, purchaser));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const record: EncryptedInviteRecord = {
      commitment,
      purchaser,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      storedAt: new Date().toISOString(),
    };
    this.database.query(`
      INSERT INTO paid_alliance_invite_secrets (commitment, purchaser, ciphertext, iv, tag, stored_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(commitment) DO UPDATE SET
        purchaser = excluded.purchaser,
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        tag = excluded.tag,
        stored_at = excluded.stored_at
    `).run(record.commitment, record.purchaser, record.ciphertext, record.iv, record.tag, record.storedAt);
    return commitment;
  }

  async recover(purchaserInput: string, signature: unknown): Promise<Array<{ commitment: Hex; secret: Hex }>> {
    const purchaser = getAddress(purchaserInput) as Address;
    if (typeof signature !== "string" || !await verifyMessage({
      address: purchaser,
      message: paidAllianceInviteRecoveryMessage(purchaser),
      signature: signature as Hex,
    })) throw new Error("Invalid purchaser authorization.");
    const records = this.database.query(`
      SELECT commitment, purchaser, ciphertext, iv, tag, stored_at AS storedAt
      FROM paid_alliance_invite_secrets WHERE lower(purchaser) = lower(?)
      ORDER BY stored_at DESC
    `).all(purchaser) as EncryptedInviteRecord[];
    return records.map((record) => ({
      commitment: normalizePaidAllianceInviteCommitment(record.commitment),
      secret: this.decrypt(record),
    }));
  }

  private decrypt(record: EncryptedInviteRecord): Hex {
    const commitment = normalizePaidAllianceInviteCommitment(record.commitment);
    const aad = paidAllianceInviteSecretRecordAad(commitment, record.purchaser);
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
        decipher.setAAD(aad);
        decipher.setAuthTag(Buffer.from(record.tag, "base64"));
        const secret = normalizePaidAllianceInviteSecret(Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64")),
          decipher.final(),
        ]).toString("utf8"));
        if (paidAllianceInviteCommitment(secret) !== commitment) {
          throw new Error("Paid invite secret does not match its stored commitment.");
        }
        return secret;
      } catch {
        // Continue through explicitly configured previous keys during rotation.
      }
    }
    throw new Error("Paid invite secret cannot be decrypted with the configured key ring.");
  }

  close(): void {
    this.database.close();
  }
}

export function createPaidAllianceInviteSecretStore(config: BackendConfig): PaidAllianceInviteSecretStore | undefined {
  if (!config.paidAllianceInviteSecretStorePath || !config.paidAllianceInviteEncryptionKey) return undefined;
  return new PaidAllianceInviteSecretStore(
    config.paidAllianceInviteSecretStorePath,
    config.paidAllianceInviteEncryptionKey,
    config.paidAllianceInvitePreviousEncryptionKeys,
  );
}

export function normalizePaidAllianceInviteSecret(secret: unknown): Hex {
  const normalized = String(secret ?? "").trim();
  if (!paidAllianceInviteSecretPattern.test(normalized)) {
    throw new Error("Alliance invite links require a 32-byte high-entropy secret.");
  }
  return normalized.toLowerCase() as Hex;
}

function normalizePaidAllianceInviteCommitment(commitment: unknown): Hex {
  const normalized = String(commitment ?? "").trim();
  if (!paidAllianceInviteSecretPattern.test(normalized)) {
    throw new Error("Paid invite commitment must be 32 bytes.");
  }
  return normalized.toLowerCase() as Hex;
}

export function paidAllianceInviteCommitment(secret: unknown): Hex {
  return keccak256(normalizePaidAllianceInviteSecret(secret));
}

export function resolvePaidAllianceInvite(
  secret: unknown,
  state: PaidAllianceInviteState,
): PaidAllianceInviteResolution {
  const commitment = paidAllianceInviteCommitment(secret);
  if (state.allianceId === 0n) {
    return { commitment, allianceId: null, status: "invalid", valid: false };
  }
  const base = {
    commitment,
    allianceId: state.allianceId.toString(),
  };
  if (state.redeemed) return { ...base, status: "redeemed", valid: false };
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
  const resolution = resolvePaidAllianceInvite(secret, state);
  if (!resolution.valid) throw new Error(`Alliance invite is ${resolution.status}.`);
  const expiresAt = nowSeconds + BigInt(paidAllianceAuthorizationLifetimeSeconds);
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
