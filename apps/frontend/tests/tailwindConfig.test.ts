import { describe, expect, test } from "bun:test";
import tailwindConfig from "../tailwind.config.js";

describe("tailwind config", () => {
  test("keeps Veydrift custom signal colors available to production utilities", () => {
    expect(tailwindConfig.theme?.extend?.colors).toMatchObject({
      signal: "#80f1ff",
      ember: "#f6b35c",
    });
  });
});
