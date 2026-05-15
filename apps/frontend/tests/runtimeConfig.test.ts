import { describe, expect, test } from "bun:test";
import { runtimeConfigUrl } from "../src/runtimeConfig";

describe("runtime config URL", () => {
  test("targets the API runtime-config endpoint", () => {
    expect(runtimeConfigUrl("https://api-test.veydrift.com/")).toBe(
      "https://api-test.veydrift.com/runtime-config",
    );
  });
});
