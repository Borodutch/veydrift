import { describe, expect, test } from "bun:test";
import {
  infrastructureActionNoticeFor,
  mobilePlanetButtonLabel,
  shouldShowMobilePlanetSelector,
} from "../src/PlayableMvpApp";
import { mobileNavigationButtonLabel } from "../src/components/NavBar";

describe("Playable MVP app display helpers", () => {
  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });

  test("uses the mobile hamburger labels for open and closed navigation states", () => {
    expect(mobileNavigationButtonLabel(false)).toBe("Open navigation menu");
    expect(mobileNavigationButtonLabel(true)).toBe("Close navigation menu");
  });

  test("shows the mobile planet image selector only for multi-planet accounts", () => {
    expect(shouldShowMobilePlanetSelector([])).toBe(false);
    expect(shouldShowMobilePlanetSelector([{ planetId: "1" }])).toBe(false);
    expect(shouldShowMobilePlanetSelector([{ planetId: "1" }, { planetId: "2" }])).toBe(true);
  });

  test("labels mobile planet image buttons with destination and role", () => {
    expect(mobilePlanetButtonLabel({
      coordinates: "1:42:7",
      isHomePlanet: true,
      name: "Vey Prime",
    })).toBe("Switch to Vey Prime home planet at 1:42:7");

    expect(mobilePlanetButtonLabel({
      coordinates: "1:42:8",
      isHomePlanet: false,
      name: "",
    })).toBe("Switch to Planet 1:42:8 colony at 1:42:8");
  });
});
