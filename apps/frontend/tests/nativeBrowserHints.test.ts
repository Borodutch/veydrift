import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const sourceGlob = new Bun.Glob("**/*.{ts,tsx}");

describe("native browser hints", () => {
  test("keeps passive hints on native title attributes instead of custom tooltip overlays", async () => {
    const violations: string[] = [];

    for await (const relativePath of sourceGlob.scan({ cwd: sourceRoot })) {
      let source = await Bun.file(`${sourceRoot}/${relativePath}`).text();
      // Ticket #17 explicitly requires keyboard-discoverable labels for icon-only
      // navigation. Native title cannot provide them on focus; limit the exception
      // to this rail label component, not passive hints elsewhere in NavBar.
      if (relativePath === "components/NavBar.tsx") {
        const start = source.indexOf("function RailTooltip(");
        const end = source.indexOf("export function MobileTab", start);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        source = source.slice(0, start) + source.slice(end);
      }
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
