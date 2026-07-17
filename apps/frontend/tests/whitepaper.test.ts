import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { whitepaperUrl } from "../src/ComingSoonApp";

const expectedHash = "29072d391b6bf66bf72c13ebb48f4ababb859856caaf2f6d7592529d4f6c2719";
const landingSource = await Bun.file(new URL("../src/ComingSoonApp.tsx", import.meta.url)).text();
const whitepaper = Bun.file(new URL("../public/whitepaper.pdf", import.meta.url));

describe("public whitepaper", () => {
  test("publishes the approved PDF bytes at the stable same-origin route", async () => {
    const hash = createHash("sha256")
      .update(Buffer.from(await whitepaper.arrayBuffer()))
      .digest("hex");

    expect(whitepaperUrl).toBe("/whitepaper.pdf");
    expect(hash).toBe(expectedHash);
  });

  test("renders a visible landing-page action with safe new-tab attributes", () => {
    expect(landingSource).toContain("href={whitepaperUrl}");
    expect(landingSource).toContain("Whitepaper");
    expect(landingSource).toContain('target="_blank"');
    expect(landingSource).toContain('rel="noopener noreferrer"');
  });
});
