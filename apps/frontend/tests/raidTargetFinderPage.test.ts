import { describe, expect, test } from "bun:test";

const raidFinderSource = await Bun.file(new URL("../src/components/RaidTargetFinderPage.tsx", import.meta.url)).text();

describe("Raid Finder page header", () => {
  test("uses concise tool copy without eyebrow or subtitle", () => {
    expect(raidFinderSource).toContain('title="Raid Finder"');
    expect(raidFinderSource).not.toContain('eyebrow="Offense"');
    expect(raidFinderSource).not.toContain("Raid Target Finder");
    expect(raidFinderSource).not.toContain("Scout raidable planets across the universe");
  });
});
