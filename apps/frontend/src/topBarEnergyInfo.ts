const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const BPS = 10_000;

export function energyExplanationTitle({
  produced,
  required,
  scaleBps,
}: {
  produced: number;
  required: number;
  scaleBps: number;
}): string {
  const current = produced - required;
  const productionPercent = Math.floor((scaleBps * 100) / BPS);
  const status = current < 0
    ? `Shortage ${format(Math.abs(current))}`
    : `Surplus ${format(current)}`;
  const details = [
    "Energy powers mines and other production buildings.",
    `${format(produced)} produced / ${format(required)} required.`,
    status,
  ];

  if (current < 0 && required > 0 && scaleBps < BPS) {
    details.push(`Resource production is reduced to ${productionPercent}%.`);
  } else {
    details.push("Resource production is fully powered.");
  }

  return details.join(" ");
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}
