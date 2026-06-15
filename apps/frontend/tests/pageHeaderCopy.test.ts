import { describe, expect, test } from "bun:test";

const componentFiles = [
  "AlliancePage.tsx",
  "BattleReportsPage.tsx",
  "DefensePage.tsx",
  "InfrastructurePage.tsx",
  "InspectPages.tsx",
  "MissionControlPage.tsx",
  "MoonPage.tsx",
  "PageHeader.tsx",
  "ResearchPage.tsx",
  "RiftPage.tsx",
  "ShipyardPage.tsx",
] as const;

const pageHeaderSources = await Promise.all(
  componentFiles.map(async (fileName) => [
    fileName,
    await Bun.file(new URL(`../src/components/${fileName}`, import.meta.url)).text(),
  ] as const),
);

describe("page headers", () => {
  test("do not render page-level subtitles or eyebrow labels", () => {
    for (const [fileName, source] of pageHeaderSources) {
      expect(source, fileName).not.toContain("subtitle=");
      expect(source, fileName).not.toContain("eyebrow=");
    }
  });

  test("remove the known redundant screen subtitle copy", () => {
    const allSource = pageHeaderSources.map(([, source]) => source).join("\n");

    for (const removedCopy of [
      "Select a technology to inspect real levels",
      "Select a building to inspect real production",
      "Building levels and production are hidden",
      "Watch inbound attacks",
      "Lunar structures and fleet support",
      "Move open-market resource tokens",
      "Planet #${defenseState.homePlanetId} · Shipyard Level",
      "Planet #${shipyardState.planetId ?? shipyardState.homePlanetId} · Shipyard Level",
      "Create an alliance or scan the public directory",
      "Public alliance details",
      "Shareable combat outcomes",
      "Veydrift Rift Stabilizer",
    ]) {
      expect(allSource).not.toContain(removedCopy);
    }
  });
});
