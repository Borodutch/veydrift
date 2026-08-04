import { expect, test } from "bun:test";

import { referralCodeForLanding, referralCodeFromText } from "./referralStorage";

test("accepts a direct referral code and removes copy-time invisible characters", () => {
  expect(referralCodeFromText(" \u200Bborodutch\uFEFF ")).toBe("borodutch");
});

test("extracts the same referral code from a pasted Veydrift referral link", () => {
  expect(referralCodeFromText("https://veydrift.com/?ref=borodutch")).toBe("borodutch");
  expect(referralCodeForLanding("?ref=borodutch", "old-code")).toBe("borodutch");
});
