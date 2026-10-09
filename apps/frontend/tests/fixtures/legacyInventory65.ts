// @ts-nocheck -- historical nullable contract is intentionally incompatible with current types.
import { GameApiError } from "../../src/gameApiError";
import { diagnosticRoute } from "../../src/requestDiagnostics";
import { GAME_UNAVAILABLE_MESSAGE, serverUnavailableRetryMessage } from "../../src/gameUnavailable";
import { fleetMissionDistance } from "../../src/fleetMissionRules";
import { formatScore as formatCanonicalScore } from "../../src/numberFormat";
// Frozen production consumer functions from 99a8d0f12f47ec89a695aa9ba4563c32fd354f77. Do not modernize.
// Only imports/type context are adapted; transport and rendering bodies are verbatim.
const WALLET_API_READ_TIMEOUT_MS = 10_000;
export const GAME_BACKEND_UNAVAILABLE_MESSAGE = GAME_UNAVAILABLE_MESSAGE;
export async function fetchGameApiJson<T>(
  url: string,
  label: string,
  options: {
    cache?: RequestCache;
    httpErrorMessage?: (response: Response) => Promise<string>;
    networkFailureMessage?: (error: unknown) => string;
    signal?: AbortSignal | undefined;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  // BackendDataStore is the only owner of GET deduplication, caching and
  // scheduling.  This adapter deliberately performs one abortable transport
  // so an invalidation cannot be satisfied by a lower-level stale response.
  return requestGameApiJson<T>(url, label, options);
}

async function requestGameApiJson<T>(
  url: string,
  label: string,
  options: {
    method?: "POST" | "DELETE";
    body?: Record<string, unknown>;
    cache?: RequestCache;
    httpErrorMessage?: (response: Response) => Promise<string>;
    networkFailureMessage?: (error: unknown) => string;
    signal?: AbortSignal | undefined;
    timeoutMs?: number;
  },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? WALLET_API_READ_TIMEOUT_MS;
  const timeoutMessage = options.method
    ? "The request took too long. Check your wallet activity before retrying; it may already have been sent."
    : serverUnavailableRetryMessage();
  const started = performance.now();
  let timedOut = false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new Error(timeoutMessage));
  }, timeoutMs);
  const forwardAbort = () => controller.abort(options.signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  let response: Response | undefined;
  try {
    response = await fetch(url, {
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
      ...(options.method ? { method: options.method } : {}),
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body: unknown = await response.clone().json().catch(() => null);
      const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error.trim() : undefined;
      throw new GameApiError(options.httpErrorMessage ? await options.httpErrorMessage(response) : apiErrorMessage(response.status, label), {
        status: response.status, ...(code ? { code } : {}), retryAfter: response.headers.get("retry-after"),
      });
    }
    return await response.json() as T;
  } catch (error) {
    // Ordinary subscriber cancellation is expected. Record real transport failures once.
    if (timedOut || !controller.signal.aborted) console.warn(JSON.stringify({
      event: "game_api_request", route: diagnosticRoute(url), method: options.method ?? "GET",
      durationMs: Math.round(performance.now() - started), timeoutMs,
      outcome: timedOut ? "timeout" : response ? "http_or_body_error" : "network_error",
      ...(response ? { status: response.status } : {}),
    }));
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(timeoutMessage);
    }
    if (response) throw error;
    throw new GameApiError(options.networkFailureMessage?.(error) ?? walletApiNetworkFailureMessage(label, error), { cause: error });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

function apiErrorMessage(status: number, label: string): string {
  if (status >= 500) return GAME_UNAVAILABLE_MESSAGE;
  if (status === 401) return "Reconnect your wallet and try again.";
  if (status === 403) return "This wallet is not allowed to perform this action.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return `${label} could not be completed. Refresh and review your selection before trying again.`;
}

function walletApiNetworkFailureMessage(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|load failed|network|err_http2/i.test(message)) {
    return GAME_BACKEND_UNAVAILABLE_MESSAGE;
  }

  return `${label} could not be reached. Check your connection and try again.`;
}
export function playerPlanetTacticalSignals(
  planet: ManagedPlanetResponse,
  originCoords: Coordinates | undefined,
  attackProtection: HighscoreEntry["attackProtection"] | null,
): Array<{ label: string; value: string }> {
  const protectionSignal = attackProtection && !attackProtection.allowed && attackProtection.blockedReason !== "none"
    ? [{ label: "Protection", value: attackProtection.blockedReasonLabel ?? "Protected" }]
    : [];
  const targetScoreText = attackProtection?.scoreComparison?.defenderScore
    ? formatCanonicalScore(attackProtection.scoreComparison.defenderScore)
    : null;
  const scoreSignal = targetScoreText ? [{ label: "Score", value: targetScoreText }] : [];
  const warSignal = attackProtection?.atWar
    ? [{ label: "War", value: attackProtection.targetAlliance?.tag ? `[${attackProtection.targetAlliance.tag}]` : "Active" }]
    : [];

  return [
    { label: "Distance", value: originCoords ? fleetMissionDistance(originCoords, planet).toLocaleString("en-US") : "Home planet unavailable" },
    { label: "Resources", value: formatResources(planet.tactical?.raidableResources ?? planet.resources) },
    ...protectionSignal,
    ...scoreSignal,
    ...warSignal,
    { label: "Ships", value: planetTacticalUnitSignal(planet.tactical?.ships) },
    { label: "Defenses", value: planetTacticalUnitSignal(planet.tactical?.defenses) },
    { label: "Fields", value: `${planet.fieldsUsed}/${planet.fieldsCapacity}` },
    { label: "Queues", value: planetQueueSignal(planet) },
    { label: "Moon", value: planet.moon?.exists ? "Yes" : "No" },
  ];
}

function formatResources(resources: OnChainResources): string {
  return `${formatShortNumber(resources.metal)} M / ${formatShortNumber(resources.crystal)} C / ${formatShortNumber(resources.deuterium)} D`;
}

function formatShortNumber(value: string): string {
  try {
    const number = BigInt(value);
    if (number >= 1_000_000_000n) return `${(Number(number / 100_000_000n) / 10).toLocaleString("en-US")}B`;
    if (number >= 1_000_000n) return `${(Number(number / 100_000n) / 10).toLocaleString("en-US")}M`;
    if (number >= 1_000n) return `${(Number(number / 100n) / 10).toLocaleString("en-US")}K`;
    return number.toLocaleString("en-US");
  } catch {
    return value;
  }
}

function planetTacticalUnitSignal(unit: { count: number; power: string } | undefined): string {
  if (!unit) return "Unavailable";
  const count = unit.count.toLocaleString("en-US");
  const power = formatShortNumber(unit.power);
  return unit.count === 1 ? `${count} unit / ${power} power` : `${count} units / ${power} power`;
}

function planetQueueSignal(planet: ManagedPlanetResponse): string {
  const active = [
    planet.queues.building?.active ? "Building" : null,
    planet.queues.ship?.active ? "Shipyard" : null,
    planet.queues.defense?.active ? "Defense" : null,
  ].filter(Boolean);
  return active.length ? active.join(", ") : "Idle";
}
