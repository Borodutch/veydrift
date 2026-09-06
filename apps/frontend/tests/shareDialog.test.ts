import { describe, expect, test } from "bun:test";

import { shareDialogSemantics } from "../src/components/ShareDialog";

const URL = "https://veydrift.com/mission/77";

describe("ShareDialog semantics", () => {
  test("uses missile-impact copy and intents throughout the dialog", () => {
    const semantics = shareDialogSemantics("missile", URL);

    expect(semantics).toMatchObject({
      dialogTitle: "Share missile impact",
      linkAriaLabel: "Shareable missile impact link",
      subject: "missile impact",
    });
    expect(semantics.targets).toHaveLength(3);
    for (const target of semantics.targets) {
      expect(target.href).toContain(encodeURIComponent("Veydrift missile impact"));
      expect(target.href).not.toContain(encodeURIComponent("Veydrift battle report"));
    }
  });

  test("preserves battle-report semantics for combat sharing", () => {
    expect(shareDialogSemantics("battle", URL)).toMatchObject({
      dialogTitle: "Share battle report",
      linkAriaLabel: "Shareable battle report link",
      subject: "battle report",
    });
  });
});
