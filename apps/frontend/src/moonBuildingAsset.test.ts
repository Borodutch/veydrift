import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildingCatalog } from "./playableMvp";
import { moonBuildingAsset } from "./components/MoonPage";
import type { ChainMoonState } from "./walletFlow";

type MoonBuildingKey = ChainMoonState["buildings"][number]["key"];

describe("moon building assets", () => {
  test("uses moon-specific Robotics Factory and Shipyard art", () => {
    const planetRoboticsAsset = buildingCatalog.find((item) => item.key === "roboticsFactory")?.asset;
    const planetShipyardAsset = buildingCatalog.find((item) => item.key === "shipyard")?.asset;

    expect(moonBuildingAsset("lunarBase" as MoonBuildingKey)).toBe("/assets/game/style-pass/generated/buildings/lunar-base.webp");
    expect(moonBuildingAsset("jumpGate" as MoonBuildingKey)).toBe("/assets/game/style-pass/generated/buildings/jump-gate.webp");

    expect(moonBuildingAsset("roboticsFactory" as MoonBuildingKey)).toBe("/assets/game/style-pass/generated/buildings/moon-robotics-factory.webp");
    expect(moonBuildingAsset("roboticsFactory" as MoonBuildingKey)).not.toBe(planetRoboticsAsset);

    expect(moonBuildingAsset("shipyard" as MoonBuildingKey)).toBe("/assets/game/style-pass/generated/buildings/moon-shipyard.webp");
    expect(moonBuildingAsset("shipyard" as MoonBuildingKey)).not.toBe(planetShipyardAsset);
  });

  test("keeps moon structure source assets listed in the game manifest", () => {
    const manifestPath = resolve(import.meta.dir, "../public/assets/game/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      moonStructures?: Record<string, { image?: string }>;
    };

    const moonRobotics = manifest.moonStructures?.["moon-robotics-factory"]?.image;
    const moonShipyard = manifest.moonStructures?.["moon-shipyard"]?.image;

    expect(moonRobotics).toBe(moonBuildingAsset("roboticsFactory" as MoonBuildingKey));
    expect(moonShipyard).toBe(moonBuildingAsset("shipyard" as MoonBuildingKey));

    expect(existsSync(resolve(import.meta.dir, "../public", moonRobotics?.replace(/^\//, "") ?? ""))).toBe(true);
    expect(existsSync(resolve(import.meta.dir, "../public", moonShipyard?.replace(/^\//, "") ?? ""))).toBe(true);
  });
});
