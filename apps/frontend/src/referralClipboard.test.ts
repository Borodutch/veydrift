import { expect, test } from "bun:test";

import { copyReferralText } from "./referralClipboard";

test("uses Clipboard API when it succeeds", async () => {
  const written: string[] = [];
  await expect(copyReferralText("active-code", {
    clipboard: { writeText: async (value) => { written.push(value); } }
  })).resolves.toBe("copied");
  expect(written).toEqual(["active-code"]);
});

test("falls back to the selectable legacy copy path after clipboard rejection", async () => {
  const events: string[] = [];
  const textarea = {
    style: {},
    value: "",
    select: () => events.push("select"),
    remove: () => events.push("remove")
  };
  await expect(copyReferralText("active-code", {
    clipboard: { writeText: async () => { throw new Error("denied"); } },
    document: {
      body: { append: () => events.push("append") },
      createElement: () => textarea,
      execCommand: (command) => command === "copy"
    }
  })).resolves.toBe("copied");
  expect(textarea.value).toBe("active-code");
  expect(events).toEqual(["append", "select", "remove"]);
});
