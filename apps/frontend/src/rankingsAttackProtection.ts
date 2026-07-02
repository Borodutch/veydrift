import type { GalaxyAttackProtectionStatus } from "./galaxyActions";
import type { HighscoreEntry } from "./walletFlow";

type RankingsProtectionEntry = Pick<HighscoreEntry, "alliance" | "attackProtection" | "wallet">;

export function rankingsAttackProtectionForEntry({
  currentAllianceId,
  currentWallet,
  entry,
}: {
  currentAllianceId?: string | null | undefined;
  currentWallet?: string | null | undefined;
  entry: RankingsProtectionEntry;
}): GalaxyAttackProtectionStatus | undefined {
  const existing = highscoreAttackProtectionToGalaxyStatus(entry.attackProtection);
  const currentAlliance = currentAllianceId?.trim();
  const entryAlliance = entry.alliance?.allianceId?.trim();
  const isCurrentPlayer = Boolean(currentWallet && entry.wallet.toLowerCase() === currentWallet.toLowerCase());
  const isSameAlliance = Boolean(
    !isCurrentPlayer
      && currentAlliance
      && currentAlliance !== "0"
      && entryAlliance
      && entryAlliance === currentAlliance
  );

  if (!isSameAlliance) return existing;

  return {
    allowed: false,
    blockedReason: "same_alliance",
    blockedReasonLabel: existing?.blockedReason === "same_alliance" && existing.blockedReasonLabel
      ? existing.blockedReasonLabel
      : "Attack blocked: target belongs to your alliance.",
    ...(existing?.atWar === undefined ? {} : { atWar: existing.atWar }),
    ...(existing?.scoreComparison ? { scoreComparison: existing.scoreComparison } : {}),
  };
}

function highscoreAttackProtectionToGalaxyStatus(
  attackProtection: HighscoreEntry["attackProtection"] | null | undefined,
): GalaxyAttackProtectionStatus | undefined {
  if (!attackProtection) return undefined;

  return {
    allowed: attackProtection.allowed,
    blockedReason: attackProtection.blockedReason,
    blockedReasonLabel: attackProtection.blockedReasonLabel,
    ...(attackProtection.atWar === undefined ? {} : { atWar: attackProtection.atWar }),
    ...(attackProtection.scoreComparison
      ? {
          scoreComparison: {
            attackerScore: attackProtection.scoreComparison.attackerScore,
            defenderScore: attackProtection.scoreComparison.defenderScore,
          },
        }
      : {}),
  };
}
