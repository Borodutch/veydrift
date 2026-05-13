import { existsSync } from "node:fs";
import { join } from "node:path";

const requiredPaths = [
  "src/placeholder.circom",
  "inputs/placeholder.input.json",
  "proofs/README.md",
  "docs/proving-stack-decision-log.md"
] as const;

const missingPaths = requiredPaths.filter((path) => !existsSync(join(import.meta.dir, "..", path)));

if (missingPaths.length > 0) {
  console.error(`Missing circuit workspace files: ${missingPaths.join(", ")}`);
  process.exit(1);
}

console.log("Circuit workspace placeholders are present.");
