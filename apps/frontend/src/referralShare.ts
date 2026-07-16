const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export type ReferralXShareResult = "copied" | "downloaded" | "shared";

type ReferralShareNavigator = {
  canShare?: (data?: ShareData) => boolean;
  clipboard?: Pick<Clipboard, "write">;
  share?: (data?: ShareData) => Promise<void>;
};

type ReferralShareWindow = {
  open?: (url?: string | URL, target?: string, features?: string) => Window | null;
  URL?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  document?: Pick<Document, "body" | "createElement">;
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

export function referralXIntentUrl(code: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(referralXPostText(code))}`;
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
  image: File,
  navigatorRef: ReferralShareNavigator = globalThis.navigator,
  windowRef: ReferralShareWindow = globalThis.window,
  clipboardItemRef: typeof ClipboardItem | undefined = typeof globalThis.ClipboardItem === "function"
    ? globalThis.ClipboardItem
    : undefined,
): Promise<ReferralXShareResult> {
  const shareData: ShareData = {
    files: [image],
    text: referralXPostText(code),
    title: "Veydrift invite",
  };

  if (
    typeof navigatorRef.share === "function"
    && typeof navigatorRef.canShare === "function"
    && navigatorRef.canShare(shareData)
  ) {
    await navigatorRef.share(shareData);
    return "shared";
  }

  let clipboardWrite: Promise<void> | undefined;
  if (navigatorRef.clipboard?.write && clipboardItemRef) {
    try {
      clipboardWrite = navigatorRef.clipboard.write([
        new clipboardItemRef({ [image.type || "image/png"]: image }),
      ]);
    } catch {
      clipboardWrite = undefined;
    }
  }

  windowRef.open?.(referralXIntentUrl(code), "_blank", "noopener,noreferrer");

  if (clipboardWrite) {
    try {
      await clipboardWrite;
      return "copied";
    } catch {
      // Clipboard image writes are not supported by every desktop browser.
    }
  }

  downloadReferralShareImage(image, windowRef);
  return "downloaded";
}

function downloadReferralShareImage(image: File, windowRef: ReferralShareWindow): void {
  const urlApi = windowRef.URL;
  const documentRef = windowRef.document;
  if (!urlApi?.createObjectURL || !urlApi.revokeObjectURL || !documentRef) return;

  const objectUrl = urlApi.createObjectURL(image);
  const link = documentRef.createElement("a");
  link.download = image.name;
  link.href = objectUrl;
  link.hidden = true;
  documentRef.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => urlApi.revokeObjectURL(objectUrl), 0);
}
