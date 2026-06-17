#!/usr/bin/env node

const options = parseArgs(process.argv.slice(2));
const apiUrl = trimSlash(options["api-url"] ?? "https://api-test.veydrift.com");
const durationSeconds = positiveInteger(options["duration-seconds"] ?? "180", "duration-seconds");
const intervalMs = positiveInteger(options["interval-ms"] ?? "1000", "interval-ms");
const timeoutMs = positiveInteger(options["timeout-ms"] ?? "3000", "timeout-ms");
const endpoints = arrayOption(options.endpoint) ?? [
  "/health",
  "/runtime-config",
  "/universe/galaxies/1/systems/1"
];

const startedAt = new Date();
const samples = [];
const deadline = Date.now() + durationSeconds * 1000;
let sequence = 0;

while (Date.now() < deadline) {
  const sampledAt = new Date();
  const results = await Promise.all(endpoints.map((endpoint) => probe(endpoint)));
  const sample = {
    sequence,
    sampledAt: sampledAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    results
  };
  samples.push(sample);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
  sequence += 1;
  await sleep(Math.max(0, intervalMs - (Date.now() - sampledAt.getTime())));
}

const summary = summarize(samples);
process.stdout.write(`${JSON.stringify({
  ok: summary.longestUnhealthyWindowMs < 1_000,
  apiUrl,
  endpoints,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  durationSeconds,
  intervalMs,
  timeoutMs,
  summary
}, null, 2)}\n`);

if (summary.longestUnhealthyWindowMs >= 1_000) {
  process.exit(1);
}

async function probe(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = parseJson(text);
    return {
      endpoint,
      ok: response.ok && (endpoint !== "/health" || parsed?.ok === true),
      status: response.status,
      ms: Date.now() - started,
      healthOk: endpoint === "/health" ? parsed?.ok === true : undefined,
      readinessReady: endpoint === "/health" ? parsed?.readiness?.ready === true : undefined,
      error: parsed?.error ?? undefined
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(currentSamples) {
  const unhealthySamples = currentSamples.filter((sample) => sample.results.some((result) => !result.ok));
  const windows = [];
  let openWindow = null;

  for (const sample of currentSamples) {
    const unhealthy = sample.results.some((result) => !result.ok);
    if (unhealthy && !openWindow) {
      openWindow = { start: sample.sampledAt, end: sample.sampledAt, count: 1 };
    } else if (unhealthy && openWindow) {
      openWindow.end = sample.sampledAt;
      openWindow.count += 1;
    } else if (!unhealthy && openWindow) {
      windows.push(openWindow);
      openWindow = null;
    }
  }
  if (openWindow) windows.push(openWindow);

  const windowsWithDuration = windows.map((window) => ({
    ...window,
    durationMs: Math.max(0, Date.parse(window.end) - Date.parse(window.start)) + intervalMs
  }));

  return {
    totalSamples: currentSamples.length,
    unhealthySamples: unhealthySamples.length,
    longestUnhealthyWindowMs: Math.max(0, ...windowsWithDuration.map((window) => window.durationMs)),
    unhealthyWindows: windowsWithDuration,
    lastSample: currentSamples.at(-1) ?? null
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) usage(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usage(`Missing value for --${key}`);
    if (parsed[key] === undefined) {
      parsed[key] = next;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(next);
    } else {
      parsed[key] = [parsed[key], next];
    }
    index += 1;
  }
  return parsed;
}

function arrayOption(value) {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== String(value)) {
    usage(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage(message) {
  console.error(
    `${message}\nUsage: node scripts/veydrift-redeploy-readiness-probe.mjs ` +
      `[--api-url https://api-test.veydrift.com] [--duration-seconds 180] ` +
      `[--interval-ms 1000] [--timeout-ms 3000] [--endpoint /health]`
  );
  process.exit(1);
}
