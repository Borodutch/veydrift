#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

export function topTenRoutePaths({ wallet, missionId, targetPlanetId }) {
  const encodedWallet = encodeURIComponent(wallet);
  return [
    `/highscores?category=total&page=1&pageSize=50&currentWallet=${encodedWallet}&includeAttackProtection=true`,
    `/wallet/${encodedWallet}/attack-protection?targetPlanetId=${encodeURIComponent(targetPlanetId)}`,
    `/wallet/${encodedWallet}/missions?status=completed&page=1&pageSize=25`,
    `/mission/${encodeURIComponent(missionId)}`,
    `/wallet/${encodedWallet}/alliance`,
    "/universe/systems?galaxy=1&center=250&radius=2&detail=summary",
    `/wallet/${encodedWallet}/overview`,
    `/wallet/${encodedWallet}/referrals`,
    `/wallet/${encodedWallet}/settlement`,
    `/wallet/${encodedWallet}/planets`
  ];
}

export function performanceRoutePaths(options) {
  return [
    ...topTenRoutePaths(options),
    // The original top-10 baseline grouped wallet mission reads, but deployed QA found the same
    // five-second hydration stall on the universe-wide completed archive. Keep it as an explicit
    // tail guard so a healthy aggregate p95 cannot hide a single blocking archive request.
    "/missions?status=completed&page=1&pageSize=25"
  ];
}

export async function benchmarkRoutes(options) {
  const routes = options.routes ?? performanceRoutePaths(options);
  const results = [];
  for (const route of routes) {
    for (let index = 0; index < options.warmup; index += 1) await timedFetch(options.baseUrl, route, options.timeoutMs);
    const durations = [];
    for (let offset = 0; offset < options.samples; offset += options.concurrency) {
      const batch = Array.from({ length: Math.min(options.concurrency, options.samples - offset) }, () => (
        timedFetch(options.baseUrl, route, options.timeoutMs)
      ));
      durations.push(...await Promise.all(batch));
    }
    durations.sort((left, right) => left - right);
    results.push({
      route: `GET ${new URL(route, "http://benchmark.invalid").pathname}`,
      requests: durations.length,
      p50Ms: nearestRank(durations, 0.50),
      p95Ms: nearestRank(durations, 0.95),
      p99Ms: nearestRank(durations, 0.99),
      maxMs: durations.at(-1) ?? 0
    });
  }
  return results;
}

export function failedBenchmarkRoutes(results, thresholdMs) {
  return results.filter((result) => (
    result.p95Ms >= thresholdMs
    || (
      result.route === "GET /missions"
      && (result.p99Ms >= thresholdMs || result.maxMs >= thresholdMs)
    )
  ));
}

async function timedFetch(baseUrl, route, timeoutMs) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  return Math.round(performance.now() - started);
}

function nearestRank(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function main(argv) {
  const options = parseArgs(argv);
  const results = await benchmarkRoutes(options);
  const failed = failedBenchmarkRoutes(results, options.thresholdMs);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...options, routes: results, passed: failed.length === 0 }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const required = (flag) => {
    const value = values.get(flag);
    if (!value) throw new Error(`Missing ${flag}`);
    return value;
  };
  const positive = (flag, fallback) => {
    const parsed = Number(values.get(flag) ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be positive`);
    return parsed;
  };
  return {
    baseUrl: required("--base-url").replace(/\/+$/, ""),
    wallet: required("--wallet"),
    missionId: required("--mission-id"),
    targetPlanetId: required("--target-planet-id"),
    samples: positive("--samples", 20),
    warmup: positive("--warmup", 2),
    concurrency: positive("--concurrency", 4),
    timeoutMs: positive("--timeout-ms", 5000),
    thresholdMs: positive("--threshold-ms", 300)
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}
