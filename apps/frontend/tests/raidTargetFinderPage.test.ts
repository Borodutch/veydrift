import { describe, expect, test } from "bun:test";

const raidFinderSource = await Bun.file(new URL("../src/components/RaidTargetFinderPage.tsx", import.meta.url)).text();

describe("Raid Finder page header", () => {
  test("omits the redundant screen title, eyebrow, and subtitle", () => {
    expect(raidFinderSource).not.toContain('title="Raid Finder"');
    expect(raidFinderSource).not.toContain('eyebrow="Offense"');
    expect(raidFinderSource).not.toContain("Raid Target Finder");
    expect(raidFinderSource).not.toContain("Scout raidable planets across the universe");
  });

  test("uses one Defense threat column instead of separate Combat and Defense columns", () => {
    expect(raidFinderSource).toContain('{ key: "defense", label: "Defense"');
    expect(raidFinderSource).not.toContain('label: "Combat"');
    expect(raidFinderSource).not.toContain('<span className="text-slate-600">Combat </span>');
  });

  test("shares fixed metric and action tracks between headers and rows", () => {
    expect(raidFinderSource.match(/sm:grid-cols-\[minmax\(0,1fr\)_64px_96px_88px_40px\]/g)?.length).toBe(2);
    expect(raidFinderSource.match(/sm:grid-cols-\[minmax\(0,1fr\)_64px_88px_88px_88px_72px_72px_40px\]/g)?.length).toBe(2);
  });

  test("keeps moon and fleet activity details out of raid results", () => {
    expect(raidFinderSource).not.toContain("PlanetMoonSubsection");
    expect(raidFinderSource).not.toContain("IncomingThreatsBanner");
    expect(raidFinderSource).not.toContain("<PlanetMissionLines");
  });

  test("paginates each Raid Finder mode independently", () => {
    expect(raidFinderSource).toContain("const [pages, setPages]");
    expect(raidFinderSource).toContain("pagedRaidTargets.map");
    expect(raidFinderSource).toContain("pagedDebrisTargets.map");
    expect(raidFinderSource).toContain("pagedRifterEntries.map");
    expect(raidFinderSource).toContain("<RaidFinderPagination");
  });

  test("supports input and change events for mobile sort selections", () => {
    expect(raidFinderSource).toContain("onChange={(event) => selectSort(event.currentTarget)}");
    expect(raidFinderSource).toContain("onInput={(event) => selectSort(event.currentTarget)}");
    expect(raidFinderSource).toContain("applyMobileSortSelection(element.value as K, sort.key, onSelectSort);");
  });
});
