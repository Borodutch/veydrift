#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const defaultExcludedRoutes = new Set(["/chain/events"]);

export function apiLatencyReport(lines, options = {}) {
  const thresholdMs = options.thresholdMs ?? 300;
  const excludedRoutes = options.excludedRoutes ?? defaultExcludedRoutes;
  const durations = new Map();
  let parsedApiRequests = 0;
  let excludedRequests = 0;

  for (const line of lines) {
    const event = parseStructuredLine(line);
    if (!event || event.kind !== "api_request" || !Number.isFinite(event.durationMs)) continue;
    parsedApiRequests += 1;
    if (event.stream === true || excludedRoutes.has(event.route)) {
      excludedRequests += 1;
      continue;
    }
    const family = `${event.method ?? "GET"} ${event.route ?? event.path ?? "unknown"}`;
    const samples = durations.get(family) ?? [];
    samples.push(Number(event.durationMs));
    durations.set(family, samples);
  }

  const routes = [...durations.entries()].map(([route, samples]) => {
    samples.sort((left, right) => left - right);
    return {
      route,
      requests: samples.length,
      p50Ms: percentile(samples, 0.50),
      p95Ms: percentile(samples, 0.95),
      p99Ms: percentile(samples, 0.99),
      maxMs: samples.at(-1) ?? 0,
      overThreshold: samples.filter((duration) => duration > thresholdMs).length
    };
  }).sort((left, right) => right.p95Ms - left.p95Ms || right.p99Ms - left.p99Ms || right.requests - left.requests);

  return { thresholdMs, parsedApiRequests, excludedRequests, routes };
}

export function percentile(sortedSamples, quantile) {
  if (sortedSamples.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedSamples.length * quantile) - 1);
  return sortedSamples[Math.min(index, sortedSamples.length - 1)];
}

function parseStructuredLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return null;
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(trimmed.slice(jsonStart));
  } catch {
    return null;
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const text = args.files.length === 0 || args.files.includes("-")
    ? await readStdin()
    : (await Promise.all(args.files.map((file) => readFile(file, "utf8")))).join("\n");
  const report = apiLatencyReport(text.split(/\r?\n/), { thresholdMs: args.thresholdMs });
  const routes = report.routes.slice(0, args.limit);
  if (args.json) {
    console.log(JSON.stringify({ ...report, routes }, null, 2));
    return;
  }
  console.log(`Non-stream API requests: ${report.parsedApiRequests - report.excludedRequests} (excluded: ${report.excludedRequests})`);
  console.log(`Threshold: ${report.thresholdMs} ms`);
  console.table(routes);
}

function parseArgs(argv) {
  const files = [];
  let json = false;
  let limit = 10;
  let thresholdMs = 300;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") json = true;
    else if (value === "--limit") limit = positiveNumber(argv[++index], "--limit");
    else if (value === "--threshold-ms") thresholdMs = positiveNumber(argv[++index], "--threshold-ms");
    else files.push(value);
  }
  return { files, json, limit, thresholdMs };
}

function positiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive number`);
  return parsed;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
