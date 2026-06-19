import { describe, expect, test } from "bun:test";

const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

describe("button focus outline styling", () => {
  test("suppresses mouse-focus rings while preserving cyan keyboard focus", () => {
    expect(stylesSource).toContain("button:focus:not(:focus-visible)");
    expect(stylesSource).toContain("--tw-ring-shadow: 0 0 #0000;");
    expect(stylesSource).toContain("button:focus-visible");
    expect(stylesSource).toContain("outline: 2px solid rgba(128, 241, 255");
    expect(stylesSource).toContain("--tw-ring-color: rgba(128, 241, 255");
  });
});
