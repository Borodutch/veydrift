import { describe, expect, test } from "bun:test";
import {
  commitCoordinateDraft,
  coordinateDraftAfterExternalValueChange,
  parseCoordinateDraft,
  sanitizeCoordinateDraft,
} from "./galaxyCoordinateInput";
import { GALAXY_COUNT, POSITION_COUNT, SYSTEM_COUNT } from "./data/mockUniverse";

describe("Galaxy coordinate input helpers", () => {
  test("keeps only numeric draft characters while typing", () => {
    expect(sanitizeCoordinateDraft(" 12a:34 ")).toBe("1234");
  });

  test("parses empty drafts as invalid", () => {
    expect(parseCoordinateDraft("")).toBeNull();
  });

  test("resets invalid drafts without committing navigation", () => {
    expect(commitCoordinateDraft("", 44, 499)).toEqual({
      draft: "44",
      value: null,
    });
  });

  test("clamps committed coordinates to the supported range", () => {
    expect(commitCoordinateDraft("0", 44, 499)).toEqual({
      draft: "1",
      value: 1,
    });
    expect(commitCoordinateDraft("999", 44, 499)).toEqual({
      draft: "499",
      value: 499,
    });
  });

  test("uses live contract-aligned galaxy coordinate bounds", () => {
    expect(GALAXY_COUNT).toBe(9);
    expect(SYSTEM_COUNT).toBe(499);
    expect(POSITION_COUNT).toBe(15);
    expect(commitCoordinateDraft("9", 5, GALAXY_COUNT)).toEqual({
      draft: "9",
      value: 9,
    });
    expect(commitCoordinateDraft("10", 5, GALAXY_COUNT)).toEqual({
      draft: "9",
      value: 9,
    });
    expect(commitCoordinateDraft("499", 200, SYSTEM_COUNT)).toEqual({
      draft: "499",
      value: 499,
    });
  });

  test("does not emit navigation when the committed coordinate is unchanged", () => {
    expect(commitCoordinateDraft("44", 44, 499)).toEqual({
      draft: "44",
      value: null,
    });
  });

  test("preserves focused drafts across parent coordinate refreshes", () => {
    expect(coordinateDraftAfterExternalValueChange("34", 340, true)).toBe("34");
    expect(coordinateDraftAfterExternalValueChange("34", 340, false)).toBe("340");
  });
});
