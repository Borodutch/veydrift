const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export type ReferralXShareResult = "opened" | "shared";

type ReferralShareNavigator = {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

type ReferralShareWindow = {
  open?: (url?: string | URL, target?: string, features?: string) => Window | null;
};

function normalizedReferralCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!REFERRAL_CODE_PATTERN.test(normalized)) {
    throw new Error("Invite code must be 1–24 letters, numbers, underscores, or hyphens.");
  }
  return normalized;
}

export function referralOgImageUrl(inviteLink: string, code: string): string {
  const inviteUrl = new URL(inviteLink);
  return new URL(`/og/referral/${encodeURIComponent(normalizedReferralCode(code))}.png`, inviteUrl.origin).toString();
}

export function referralXPostText(code: string): string {
  return `Join me in Veydrift — invite code: ${normalizedReferralCode(code)}`;
}

export function referralXIntentUrl(code: string, inviteLink: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(referralXPostText(code))}&url=${encodeURIComponent(inviteLink)}`;
}

export async function fetchReferralShareImage(
  inviteLink: string,
  code: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<File> {
  const response = await fetcher(referralOgImageUrl(inviteLink, code), {
    cache: "no-store",
    headers: { accept: "image/png" },
  });
  if (!response.ok) {
    throw new Error(`Invite image request failed (${response.status}).`);
  }
  const blob = await response.blob();
  if (blob.type && blob.type !== "image/png") {
    throw new Error("Invite image response was not a PNG.");
  }
  return new File([blob], `veydrift-invite-${normalizedReferralCode(code)}.png`, { type: "image/png" });
}

export async function shareReferralOnX(
  code: string,
  inviteLink: string,
  image?: File | null,
  navigatorRef: ReferralShareNavigator = globalThis.navigator,
  windowRef: ReferralShareWindow = globalThis.window,
): Promise<ReferralXShareResult> {
  if (image) {
    const shareData: ShareData = {
      files: [image],
      text: referralXPostText(code),
      title: "Veydrift invite",
    };

    let canShareFile = false;
    try {
      canShareFile = typeof navigatorRef.share === "function"
        && typeof navigatorRef.canShare === "function"
        && navigatorRef.canShare(shareData);
    } catch {
      // Browsers may throw while probing file-share support. The URL fallback remains usable.
    }

    if (canShareFile && navigatorRef.share) {
      await navigatorRef.share(shareData);
      return "shared";
    }
  }

  windowRef.open?.(referralXIntentUrl(code, inviteLink), "_blank", "noopener,noreferrer");
  return "opened";
}
