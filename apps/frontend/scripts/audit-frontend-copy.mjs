import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const audit = JSON.parse(readFileSync(join(root, "tests/fixtures/frontendCopyAudit.json"), "utf8"));
const normalize = (text) => text.replace(/\s+/g, " ").trim();

function textFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return /\.(?:[cm]?js|tsx?|html|json|map|md|txt|xml|css|svg)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

export function auditFrontendCopy(dist) {
  const files = dist ? textFiles(resolve(root, dist)) : [
    ...textFiles(join(root, "src")),
    ...textFiles(join(root, "public")),
    ...textFiles(resolve(root, "../stats/src")),
    resolve(root, "../stats/index.html"),
    join(root, "index.html"),
    join(root, "miniAppMetadata.ts"),
    join(root, "scripts/serve.mjs"),
  ];
  const violations = [];
  for (const file of files) {
    const text = normalize(readFileSync(file, "utf8"));
    for (const { before } of audit) {
      if (text.includes(normalize(before))) violations.push({ file: relative(root, file), copy: before });
    }
  }
  return { files: files.length, candidates: audit.length, violations };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 2 && args[0] === "--dist"))) {
    throw new Error("Usage: node scripts/audit-frontend-copy.mjs [--dist dist]");
  }
  const result = auditFrontendCopy(args[1]);
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length) process.exitCode = 1;
}
