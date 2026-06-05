#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const options = parseArgs(process.argv.slice(2));
const dist = options.dist ?? "apps/frontend/dist";
const expectedApiUrl = trimSlash(options["api-url"] ?? "https://api-test.veydrift.com");
const forbiddenApiUrls = (options["forbid-api-url"] ?? "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(trimSlash);

if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  fail(`Frontend dist directory does not exist: ${dist}`);
}

const files = walk(dist).filter((file) => /\.(?:html|js|css)$/i.test(file));
if (files.length === 0) {
  fail(`Frontend dist directory has no inspectable assets: ${dist}`);
}

const hits = [];
const forbiddenHits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (text.includes(expectedApiUrl)) hits.push(file);
  for (const forbidden of forbiddenApiUrls) {
    if (text.includes(forbidden)) forbiddenHits.push({ file, forbidden });
  }
}

if (hits.length === 0) {
  fail(`Built frontend does not contain expected Veydrift API URL: ${expectedApiUrl}`);
}

if (forbiddenHits.length > 0) {
  fail(`Built frontend contains forbidden API URL(s): ${forbiddenHits.map((hit) => `${hit.forbidden} in ${hit.file}`).join("; ")}`);
}

process.stdout.write(JSON.stringify({
  ok: true,
  dist,
  expectedApiUrl,
  matchedFiles: hits.map((file) => file.replace(`${dist}/`, "")),
}, null, 2));
process.stdout.write("\n");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) usage(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usage(`Missing value for --${key}`);
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function usage(message) {
  fail(`${message}\nUsage: node scripts/veydrift-test-frontend-config-check.mjs [--dist apps/frontend/dist] [--api-url https://api-test.veydrift.com] [--forbid-api-url <csv>]`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
