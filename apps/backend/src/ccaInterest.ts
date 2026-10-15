import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type CcaInterest = {
  email: string;
  amountUsd: number;
  telegram: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCcaInterest(body: Record<string, unknown> | null): CcaInterest | string {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !emailPattern.test(email)) return "Enter a valid email.";
  // The amount is optional: an email alone is interest too.
  const amountUsd = body?.amountUsd === undefined || body.amountUsd === null || body.amountUsd === "" ? 0 : Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 0 || amountUsd > 10_000_000) return "Enter an amount between $0 and $10,000,000.";
  const telegram = typeof body?.telegram === "string" ? body.telegram.trim().replace(/^@/, "") : "";
  if (telegram && !/^[A-Za-z0-9_]{3,32}$/.test(telegram)) return "Enter a valid Telegram username.";
  return { email, amountUsd: Math.round(amountUsd), telegram: telegram || null };
}

export function ccaInterestMessage(interest: CcaInterest): string {
  return [
    "New CCA interest",
    interest.amountUsd ? `$${interest.amountUsd.toLocaleString("en-US")}` : "No amount given",
    interest.email,
    ...(interest.telegram ? [`@${interest.telegram}`] : []),
  ].join("\n");
}

// Best effort: a Telegram outage must never fail a sign-up that is already stored.
// The env names predate the CCA page (they were set up for the retired Pact round) and stay as configured in prod.
export async function notifyCcaInterest(
  interest: CcaInterest,
  env: Record<string, string | undefined> = process.env,
  send: typeof fetch = fetch,
): Promise<void> {
  const token = env.VEYDRIFT_PACT_TELEGRAM_BOT_TOKEN;
  const chatId = env.VEYDRIFT_PACT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const response = await send(`https://api.telegram.org/bot${token}/sendMessage`, {
      body: JSON.stringify({ chat_id: chatId, text: ccaInterestMessage(interest) }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.warn("CCA interest Telegram notification failed", response.status);
  } catch (error) {
    console.warn("CCA interest Telegram notification failed", error instanceof Error ? error.name : "error");
  }
}

export function ccaInterestStorePath(indexDbPath: string): string {
  return indexDbPath === ":memory:" ? ":memory:" : join(dirname(indexDbPath), "cca-interest.sqlite");
}

export class CcaInterestStore {
  private readonly database: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS cca_interest (
        email TEXT PRIMARY KEY,
        amount_usd INTEGER NOT NULL,
        telegram TEXT,
        updated_at TEXT NOT NULL
      )
    `);
  }

  // Resubmitting the same email updates the amount instead of adding a row.
  save(interest: CcaInterest): void {
    this.database.query(`
      INSERT INTO cca_interest (email, amount_usd, telegram, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET amount_usd = excluded.amount_usd, telegram = excluded.telegram, updated_at = excluded.updated_at
    `).run(interest.email, interest.amountUsd, interest.telegram, new Date().toISOString());
  }

  list(): Array<{ email: string; amount_usd: number; telegram: string | null; updated_at: string }> {
    return this.database.query("SELECT * FROM cca_interest ORDER BY updated_at DESC").all() as never;
  }

  totals(): { people: number; amountUsd: number } {
    return this.database.query("SELECT COUNT(*) AS people, COALESCE(SUM(amount_usd), 0) AS amountUsd FROM cca_interest").get() as never;
  }
}
