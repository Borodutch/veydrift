import { describe, expect, test } from "bun:test";

import { shareDialogSemantics } from "../src/components/ShareDialog";

const URL = "https://veydrift.com/mission/77";

describe("ShareDialog semantics", () => {
  test("uses battle-report semantics for combat sharing", () => {
    const semantics = shareDialogSemantics("battle", URL);
    expect(semantics).toMatchObject({
      dialogTitle: "Share battle report",
      linkAriaLabel: "Shareable battle report link",
      subject: "battle report",
    });
    expect(semantics.targets).toHaveLength(3);
    for (const target of semantics.targets) {
      expect(target.href).toContain(encodeURIComponent("Veydrift battle report"));
      expect(target.href).not.toContain(encodeURIComponent("Veydrift missile impact"));
    }
  });
});
