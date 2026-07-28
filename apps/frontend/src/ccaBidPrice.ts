export function isBidPriceAboveClearingPrice(maxPriceQ96: bigint, clearingPriceQ96: bigint) {
  return maxPriceQ96 > clearingPriceQ96;
}
