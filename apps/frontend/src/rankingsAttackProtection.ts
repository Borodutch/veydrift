import type { GalaxyAttackProtectionStatus } from "./galaxyActions";
import type { HighscoreEntry } from "./walletFlow";

type RankingsProtectionEntry = Pick<HighscoreEntry, "alliance" | "attackProtection" | "wallet">;

type RankingsAttackProtection = NonNullable<HighscoreEntry["attackProtection"]>;

export type RankingsProtectionPresentation = {
  badgeLabel: "Bashing limit" | "Score protected";
  detailLabel: string;
  blockedAttackLabel: "Bashing limit" | "Protected";
};

export function rankingsProtectionPresentation(
  attackProtection: RankingsAttackProtection | null | undefined,
): RankingsProtectionPresentation | undefined {
  if (!attackProtection || attackProtection.allowed) return undefined;

  if (attackProtection.blockedReason === "score_protection") {
    return {
      badgeLabel: "Score protected",
      detailLabel: attackProtection.blockedReasonLabel
        ?? "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      blockedAttackLabel: "Protected",
    };
  }

  if (attackProtection.blockedReason === "bashing_limit") {
    return {
      badgeLabel: "Bashing limit",
      detailLabel: attackProtection.blockedReasonLabel ?? "Attack blocked by bashing limit.",
      blockedAttackLabel: "Bashing limit",
    };
  }

  return undefined;
}

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
