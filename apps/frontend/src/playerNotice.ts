/** Translate known service implementation notices, never player-authored content or state flags. */
export function playerNotice(message: string): string;
export function playerNotice(message: string | undefined): string | undefined;
export function playerNotice(message: string | null | undefined): string | null | undefined;
export function playerNotice(message: string | null | undefined): string | null | undefined {
  if (!message) return message;
  if (/^Resource token reserves are not configured\b/.test(message)) return "Starting resources are currently unavailable. Please try again later.";
  if (/^Resource token addresses are not configured\b/.test(message)) return "Resource transfers are currently unavailable. Please try again later.";
  if (/^Settlement start price is not available from indexed\b/.test(message)) return "Settlement pricing is updating. Please try again shortly.";
  if (/^A required randomness reveal mapping is unavailable/.test(message)) return "Battle randomness is unavailable. New attacks are temporarily paused.";
  if (/^Randomness commitments are activating/.test(message)) return "Battle randomness is preparing. New attacks are temporarily paused.";
  const legacyFeature = message.match(/^The deployed contract only supports first-planet settlement\. (.+?) (?:is|are) not available/);
  if (legacyFeature) return `${legacyFeature[1]} ${/ are not available/.test(message) ? "are" : "is"} currently unavailable.`;
  if (/^This deployment does not expose Veydrift moon/.test(message)) return "Moon systems are currently unavailable.";
  if (/^This deployment does not expose the Rift/.test(message)) return "The Rift Stabilizer is currently unavailable.";
  const updating = message.match(/^(Moon|Infrastructure) indexed .*warming\./);
  if (updating) return `${updating[1]} data is still updating. Refresh shortly.`;
  const mission = message.match(/\(mission ([^)]+)\)/)?.[1];
  if (/^Mission resolution is pending for this planet/.test(message) && /indexer or keeper/.test(message)) {
    return `Mission${mission ? ` ${mission}` : ""} is still resolving at this planet. Refresh after it finishes before starting another upgrade.`;
  }
  if (/^Fleet slot state is waiting for mission settlement/.test(message)) {
    return `Mission${mission ? ` ${mission}` : ""} is still resolving. Refresh after it finishes before launching another fleet.`;
  }
  if (/^(?:Attack #|Joined attack #|Counterplay defender #|DefenseHold #|Stationed-defense storage order)/.test(message)
    && /index|contract lane|storage order/.test(message)) {
    return "Battle details for this group are incomplete, so the outcome cannot be estimated safely.";
  }
  return message;
}
