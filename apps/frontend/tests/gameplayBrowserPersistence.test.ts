import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const frontendRoot = join(import.meta.dir, "..");

function source(path: string): string {
  return readFileSync(join(frontendRoot, path), "utf8");
}

describe("gameplay browser persistence audit", () => {
  test("does not persist wallet gameplay state from the app shell or playable game", () => {
    const gameplaySources = [
      "src/FirstPlanetSettlementApp.tsx",
      "src/PlayableMvpApp.tsx",
    ].map(source).join("\n");

    expect(gameplaySources).not.toContain("localStorage");
    expect(gameplaySources).not.toContain("sessionStorage");
    expect(gameplaySources).not.toContain("indexedDB");
    expect(gameplaySources).not.toContain("document.cookie");
    expect(gameplaySources).not.toContain("gameStateCache");
  });
});
