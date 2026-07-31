import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const sourceGlob = new Bun.Glob("**/*.{ts,tsx}");

describe("native browser hints", () => {
  test("keeps passive hints on native title attributes instead of custom tooltip overlays", async () => {
    const violations: string[] = [];

    for await (const relativePath of sourceGlob.scan({ cwd: sourceRoot })) {
      const source = await Bun.file(`${sourceRoot}/${relativePath}`).text();
      if (
        /role\s*=\s*["']tooltip["']/.test(source)
        || /data-tooltip/.test(source)
        || /pointer-events-none[^"]*absolute[^"]*(?:group-hover|peer-hover)/.test(source)
      ) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });
});
