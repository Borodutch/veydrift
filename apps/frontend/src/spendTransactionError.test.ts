import { describe, expect, test } from "bun:test";
import { INSUFFICIENT_RESOURCES_SPEND_MESSAGE, spendTransactionErrorMessage } from "./walletFlow";

describe("spendTransactionErrorMessage", () => {
  test("maps the on-chain InsufficientResources revert (0x2ab0f96f) to friendly copy", () => {
    const error = { data: "0x2ab0f96f" };
    expect(spendTransactionErrorMessage(error)).toBe(INSUFFICIENT_RESOURCES_SPEND_MESSAGE);
  });

  test("maps a nested InsufficientResources revert to friendly copy", () => {
    const error = { error: { data: "0x2ab0f96f000000000000000000000000" } };
    expect(spendTransactionErrorMessage(error)).toBe(INSUFFICIENT_RESOURCES_SPEND_MESSAGE);
  });

  test("falls back to the generic wallet message for other reverts", () => {
    const error = new Error("execution reverted");
    const message = spendTransactionErrorMessage(error);
    expect(message).not.toBe(INSUFFICIENT_RESOURCES_SPEND_MESSAGE);
    expect(message.length).toBeGreaterThan(0);
  });
});
