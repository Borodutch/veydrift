#!/usr/bin/env node
// Guards the unoptimized test list in foundry.toml: a listed file must not carry src logic that
// would then be compiled without the production optimizer (harnesses inheriting src, deploy
// scripts) and must not be a mainnet-fork test (those check real gas/state but are skipped in CI).
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

function walk(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".sol") ? [join(dir, entry.name)] : []);
}

export function unoptimizedTestFiles(toml) {
  return [...toml.matchAll(/\{\s*paths\s*=\s*"([^"]+)"\s*,\s*max_optimizer_runs\s*=\s*0\s*\}/g)].map((m) => m[1]);
}

export function profileProblems(file, source, srcNames) {
  const problems = [];
  if (file === "test/VeydriftGame.t.sol") {
    problems.push("has production gas ceilings requiring production-profile linked libraries");
  }
  if (/Fork\.t\.sol$/.test(file)) problems.push("is a mainnet-fork test");
  if (/import\s[^;]*["']\.\.\/script\//.test(source)) problems.push("imports a deploy script");
  for (const match of source.matchAll(/^\s*(?:abstract\s+)?contract\s+(\w+)\s+is\s+([^{]+)\{/gm)) {
    const inherited = match[2].match(/\w+/g).filter((name) => srcNames.has(name));
    if (inherited.length) problems.push(`${match[1]} inherits src ${inherited.join(", ")}`);
  }
  return problems;
}

function main() {
  const srcNames = new Set(walk("src").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^\s*(?:abstract\s+)?(?:contract|library)\s+(\w+)/gm)].map((m) => m[1])));
  const failures = [];
  for (const file of unoptimizedTestFiles(readFileSync("foundry.toml", "utf8"))) {
    if (!existsSync(file)) {
      failures.push(`${file}: listed in foundry.toml but does not exist`);
      continue;
    }
    for (const problem of profileProblems(file, readFileSync(file, "utf8"), srcNames)) {
      failures.push(`${file}: ${problem}; remove it from the unoptimized list in foundry.toml`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("Unoptimized test profile list is valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
