import { formatUnits, parseUnits } from "viem";

const Q96 = 1n << 96n;
const E18 = 10n ** 18n;
const VEY_SUPPLY = 1_000_000_000n;

export function isBidPriceAboveClearingPrice(maxPriceQ96: bigint, clearingPriceQ96: bigint) {
  return maxPriceQ96 > clearingPriceQ96;
}

export function fdvToPriceQ96(value: string) {
  return (parseUnits(value, 18) * Q96) / (VEY_SUPPLY * E18);
}

export function minimumFdvWeiAboveClearingPriceQ96(clearingPriceQ96: bigint) {
  const numerator = (clearingPriceQ96 + 1n) * VEY_SUPPLY * E18;
  return (numerator + Q96 - 1n) / Q96;
}

export function minimumFdvAboveClearingPriceQ96(clearingPriceQ96: bigint) {
  return formatUnits(minimumFdvWeiAboveClearingPriceQ96(clearingPriceQ96), 18);
}

export function ccaBidPriceError(maxPriceQ96: bigint, clearingPriceQ96: bigint) {
  if (isBidPriceAboveClearingPrice(maxPriceQ96, clearingPriceQ96)) return null;
  return `Your maximum FDV must be strictly above the live clearing price. Smallest accepted max FDV: ${minimumFdvAboveClearingPriceQ96(clearingPriceQ96)} WETH.`;
}
