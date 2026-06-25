import { describe, expect, test } from "bun:test";
import {
  commanderJoinCta,
  shouldShowCommanderJoinCta,
} from "../src/components/NavBar";

describe("NavBar public commander panel", () => {
  test("shows a join CTA only for public viewers with a connect action", () => {
    expect(shouldShowCommanderJoinCta(undefined, () => undefined)).toBe(true);
    expect(shouldShowCommanderJoinCta("0x1111111111111111111111111111111111111111", () => undefined)).toBe(false);
    expect(shouldShowCommanderJoinCta(undefined, undefined)).toBe(false);
  });

  test("uses the requested public commander copy", () => {
    expect(commanderJoinCta).toEqual({
      action: "Connect wallet",
      label: "Join Veydrift",
    });
  });
});
