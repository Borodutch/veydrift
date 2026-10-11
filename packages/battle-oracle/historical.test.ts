import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import expected from "./fixtures/planet1-results.json";
import { replay } from "./historical";
test("catalog is pinned source data, not imported combat logic", () => {
  expect(createHash("sha256").update(readFileSync(new URL("../contracts/combat-preview-catalog.json",import.meta.url))).digest("hex")).toBe("0195660ee06e59761960d966d187c029e94ad9b3e212ae39147484a594bed941");
});
test("four independently frozen planet-1 counterfactuals replay exactly", () => { expect(expected).toEqual(replay()); });
