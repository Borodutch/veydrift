import { describe, expect, test } from "bun:test";

const riftPageSource = await Bun.file(new URL("../src/components/RiftPage.tsx", import.meta.url)).text();

describe("Rift page under-construction state", () => {
  test("renders only the generated Rift construction graphic and status copy", () => {
    expect(riftPageSource).toContain("return <RiftUnderConstruction />;");
    expect(riftPageSource).toContain("/assets/game/style-pass/generated/rift-under-construction.webp");
    expect(riftPageSource).toContain("Under construction");
    expect(riftPageSource).toContain("The Rift is taking shape");
  });
});
