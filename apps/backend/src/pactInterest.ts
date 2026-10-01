import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type PactInterest = {
  email: string;
  amountUsd: number;
  telegram: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePactInterest(body: Record<string, unknown> | null): PactInterest | string {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !emailPattern.test(email)) return "Enter a valid email.";
  const amountUsd = Number(body?.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1_000 || amountUsd > 100_000) return "Enter an amount between $1,000 and $100,000.";
  const telegram = typeof body?.telegram === "string" ? body.telegram.trim().replace(/^@/, "") : "";
  if (telegram && !/^[A-Za-z0-9_]{3,32}$/.test(telegram)) return "Enter a valid Telegram username.";
  return { email, amountUsd: Math.round(amountUsd), telegram: telegram || null };
}

export function pactInterestMessage(interest: PactInterest): string {
  const tokens = Math.floor(interest.amountUsd / 0.002).toLocaleString("en-US");
  return [
    "New Pact sign-up",
    `$${interest.amountUsd.toLocaleString("en-US")} → ${tokens} $VEYDRIFT`,
    interest.email,
    ...(interest.telegram ? [`@${interest.telegram}`] : []),
  ].join("\n");
}

// Best effort: a Telegram outage must never fail a sign-up that is already stored.
export async function notifyPactInterest(
  interest: PactInterest,
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
): Promise<void> {
  const token = env.VEYDRIFT_PACT_TELEGRAM_BOT_TOKEN;
  const chatId = env.VEYDRIFT_PACT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const response = await send(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({ chat_id: chatId, text: pactInterestMessage(interest) }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.warn("Pact Telegram notification failed", response.status);
  } catch (error) {
    console.warn("Pact Telegram notification failed", error instanceof Error ? error.name : "error");
  }
}

export function pactInterestStorePath(indexDbPath: string): string {
  return indexDbPath === ":memory:" ? ":memory:" : join(dirname(indexDbPath), "pact-interest.sqlite");
}

export class PactInterestStore {
  private readonly database: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pact_interest (
        email TEXT PRIMARY KEY,
        amount_usd INTEGER NOT NULL,
        telegram TEXT,
        updated_at TEXT NOT NULL
      )
    `);
  }

  // Resubmitting the same email updates the amount instead of adding a row.
  save(interest: PactInterest): void {
    this.database.query(`
      INSERT INTO pact_interest (email, amount_usd, telegram, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET amount_usd = excluded.amount_usd, telegram = excluded.telegram, updated_at = excluded.updated_at
    `).run(interest.email, interest.amountUsd, interest.telegram, new Date().toISOString());
  }

  list(): Array<{ email: string; amount_usd: number; telegram: string | null; updated_at: string }> {
    return this.database.query("SELECT * FROM pact_interest ORDER BY updated_at DESC").all() as never;
  }
}
