export function ccaLiveBidCountLabel(visibleCount: number, confirmedBidCount: number): string {
  return `${visibleCount.toLocaleString()} recent · ${confirmedBidCount.toLocaleString()} total confirmed`;
}
