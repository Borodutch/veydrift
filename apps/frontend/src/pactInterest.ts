import { playableApiUrl } from "./runtimeConfig";

export async function submitPactInterest(body: { amountUsd: unknown; email: unknown; telegram: unknown }): Promise<void> {
  const response = await fetch(`${playableApiUrl}/pact/interest`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "");
}
