import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// VEY-389 hard rule: the product must NEVER mention "OGame" in any source that
// ships to users. This guard scans the frontend product source (excluding test
// files, which legitimately reference the banned word to assert its absence) and
// fails if any "OGame" reference is reintroduced.
const SRC_ROOT = new URL("../src", import.meta.url).pathname;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) files.push(fullPath);
  }
  return files;
}

describe("OGame reference ban", () => {
  test("no frontend product source mentions OGame", () => {
    const offenders = collectSourceFiles(SRC_ROOT).filter((file) =>
      /ogame/i.test(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });
});
