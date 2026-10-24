import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Bun.serve defaults `development` to NODE_ENV !== "production", and the Easypanel images run with
// NODE_ENV unset (#104). Every server that ships must therefore pass `development: false` itself, or
// an uncaught handler error returns Bun's dev error page with the message and source paths.
const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = /\.(ts|tsx|mjs|js)$/;
// Dependency and build output anywhere; other skips are exact repo paths so new source dirs are scanned.
const SKIPPED_NAMES = new Set(["node_modules", "dist", ".media"]);
const SKIPPED_PATHS = new Set(["packages/contracts/lib", "packages/contracts/out", "packages/contracts/cache", "apps/frontend/tests"]);
// Local tooling that never runs in a deployed service.
const TOOLING = new Set(["apps/frontend/scripts/benchmark-animation-delivery.mjs"]);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_NAMES.has(entry.name) || SKIPPED_PATHS.has(relative(root, path)) ? [] : sourceFiles(path);
    }
    return SOURCE.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

// The argument text of each Bun.serve(...) call, up to its matching parenthesis. This is a lint-style
// scan: parentheses inside strings or comments are not special-cased.
function serveCalls(source) {
  const calls = [];
  for (const match of source.matchAll(/\bBun\.serve\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") depth -= 1;
      end += 1;
    }
    const line = source.slice(0, match.index).split("\n").length;
    calls.push({ line, args: source.slice(match.index + match[0].length, end - 1) });
  }
  return calls;
}

// Other ways to start a Bun server that would bypass the Bun.serve check above.
const UNCHECKED_SERVERS = [
  /import\s*\{[^}]*\bserve\b[^}]*\}\s*from\s*["']bun["']/,
  /\{[^}]*\bserve\b[^}]*\}\s*=\s*Bun\b/,
  /^export\s+default\s*\{[^}]*\bfetch\b/m
];

function deployedSources() {
  return ["apps", "packages"]
    .flatMap((dir) => sourceFiles(join(root, dir)))
    .map((file) => relative(root, file))
    .filter((file) => !TOOLING.has(file))
    .map((file) => ({ file, source: readFileSync(join(root, file), "utf8") }));
}

test("every deployed Bun.serve call disables development mode explicitly", () => {
  const calls = deployedSources().flatMap(({ file, source }) => serveCalls(source).map((call) => ({ file, ...call })));

  // Canary for the scan itself: these are the nine servers known at #104.
  assert.ok(calls.length >= 9, `expected the known production servers, found ${calls.length}`);
  const missing = calls
    .filter(({ args }) => !/\bdevelopment:\s*false\b/.test(args))
    .map(({ file, line }) => `${file}:${line}`);
  assert.deepEqual(missing, [], "add `development: false` to these Bun.serve calls");
});

test("deployed servers are started only through Bun.serve", () => {
  const unchecked = deployedSources()
    .filter(({ source }) => UNCHECKED_SERVERS.some((pattern) => pattern.test(source)))
    .map(({ file }) => file);
  assert.deepEqual(unchecked, [], "start servers with Bun.serve({ development: false, ... }) so the guard above covers them");
});

test("development: false answers handler errors with a plain 500 even when NODE_ENV is unset", (t) => {
  const probe = `
    const server = Bun.serve({ development: false, port: 0, fetch() { throw new Error("secret-handler-detail"); } });
    const response = await fetch(server.url);
    const body = await response.text();
    console.log(JSON.stringify({ status: response.status, type: response.headers.get("content-type"), body }));
    server.stop(true);
  `;
  const env = { ...process.env };
  delete env.NODE_ENV;
  const run = spawnSync("bun", ["-e", probe], { encoding: "utf8", env, timeout: 30_000 });
  if (run.error?.code === "ENOENT") return t.skip("bun is not installed");
  // Bun still logs the handler error and exits non-zero afterwards; only the response matters here.
  const result = run.stdout.trim().split("\n").at(-1);
  assert.ok(result, run.stderr);
  const { status, type, body } = JSON.parse(result);
  assert.equal(status, 500);
  // The dev page is HTML (tens to hundreds of KB, depending on the Bun version); production is short text.
  assert.doesNotMatch(type ?? "", /html/);
  assert.ok(body.length < 200, `expected a short error body, got ${body.length} bytes`);
  assert.doesNotMatch(body, /secret-handler-detail/);
});
