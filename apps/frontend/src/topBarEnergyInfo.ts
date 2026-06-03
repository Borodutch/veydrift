const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const BPS = 10_000;

export function energyExplanationTitle({
  produced,
  required,
  scaleBps,
  sources,
}: {
  produced: number;
  required: number;
  scaleBps: number;
  sources?: {
    solarPlant: number;
    fusionReactor: number;
    fusionReactorDeuteriumConsumed: number;
    solarSatellites: number;
    solarSatelliteCount: number;
    solarSatelliteEnergy: number;
  } | undefined;
}): string {
  const current = produced - required;
  const productionPercent = Math.floor((scaleBps * 100) / BPS);
  const status = current < 0
    ? `Shortage ${format(Math.abs(current))}`
    : `Surplus ${format(current)}`;
  const details = [
    "Energy powers mines.",
    "Solar Plant and Solar Satellites produce it; mines consume it.",
    `${format(produced)} produced / ${format(required)} consumed.`,
    status,
  ];

  if (sources) {
    details.push(
      `Production in total: ${format(produced)}.`,
      `By Solar Plant: ${format(sources.solarPlant)}.`,
      `By Fusion Generator: ${format(sources.fusionReactor)} from ${format(sources.fusionReactorDeuteriumConsumed)} DEUT/h.`,
      `By Solar Satellites: ${format(sources.solarSatellites)} from ${format(sources.solarSatelliteCount)} satellites (${format(sources.solarSatelliteEnergy)} E/Sat).`,
    );
  }

  if (current < 0 && required > 0 && scaleBps < BPS) {
    details.push(`Mine output is reduced to ${productionPercent}% until energy production catches up.`);
  } else {
    details.push("Mine output is fully powered.");
  }

  return details.join(" ");
}

function format(value: number): string {
  return formatter.format(Math.floor(value));
}
