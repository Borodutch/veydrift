import { describe, expect, test } from "bun:test";

import { isBidPriceAboveClearingPrice } from "./ccaBidPrice";

describe("CCA bid price validation", () => {
  test("rejects a bid whose maximum price equals the clearing price", () => {
    expect(isBidPriceAboveClearingPrice(8_556_641_551_540_548_460_102n, 8_556_641_551_540_548_460_102n)).toBe(false);
  });

  test("accepts the smallest Q96 value above the clearing price", () => {
    expect(isBidPriceAboveClearingPrice(8_556_641_551_540_548_460_103n, 8_556_641_551_540_548_460_102n)).toBe(true);
  });
});
