#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../apps/frontend/src/docs/content", import.meta.url).pathname;
const prohibited = [
  { pattern: /\bogame\b/i, label: "external comparison game name" },
  { pattern: /\bopenc?law\b/i, label: "internal operations name" },
  { pattern: /\bvey-kaneo-\d+\b/i, label: "internal task identifier" },
  { pattern: /\bkaneo\b/i, label: "internal task system name" },
];

function collectMarkdown(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectMarkdown(fullPath));
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

const offenders = [];
for (const file of collectMarkdown(root)) {
  const text = readFileSync(file, "utf8");
  for (const rule of prohibited) {
    if (rule.pattern.test(text)) {
      offenders.push(`${file}: ${rule.label}`);
    }
  }
}

if (offenders.length > 0) {
  console.error("Veydrift docs content contains prohibited user-visible references:");
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log(`Veydrift docs content check passed (${collectMarkdown(root).length} Markdown files).`);
