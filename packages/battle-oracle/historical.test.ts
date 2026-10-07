import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import expected from "./fixtures/planet1-candidate-results.json";
import { replay } from "./historical";
test("catalog is pinned source data, not imported combat logic", () => {
  expect(createHash("sha256").update(readFileSync(new URL("./fixtures/catalog.json",import.meta.url))).digest("hex")).toBe("86290965991ad030826bb0ae7d65f767940d1cbf7c37f0f76fcaaf11309e8ae1");
});
test("four independently frozen planet-1 counterfactuals replay exactly", () => { expect(expected).toEqual(replay()); });
