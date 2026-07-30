import { describe, expect, test } from "bun:test";

const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

describe("button focus outline styling", () => {
  test("suppresses mouse-focus rings while preserving cyan keyboard focus", () => {
    expect(stylesSource).toContain("button:focus:not(:focus-visible)");
    expect(stylesSource).toContain("--tw-ring-shadow: 0 0 #0000;");
    expect(stylesSource).toContain("button:focus-visible");
    expect(stylesSource).toContain("outline: 2px solid rgba(128, 241, 255");
    expect(stylesSource).toContain("--tw-ring-color: rgba(128, 241, 255");
    expect(stylesSource).toContain(".veydrift-planet-selector-button:focus-visible");
    expect(stylesSource).toContain("outline: 1px solid rgba(128, 241, 255, 0.68)");
  });

  test("does not stack a focus ring on controls that already show selection", () => {
    expect(stylesSource).toContain('[aria-current="page"]:focus-visible');
    expect(stylesSource).toContain('[aria-current="true"]:focus-visible');
    expect(stylesSource).toContain('[aria-selected="true"]:focus-visible');
    expect(stylesSource).toContain('[aria-pressed="true"]:focus-visible');
    expect(stylesSource).toContain("box-shadow: var(--tw-shadow, 0 0 #0000);");
  });
});
