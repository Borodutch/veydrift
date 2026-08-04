export const REFERRAL_CODE_STORAGE_KEY = "veydrift.referral.settlement-code.v1";
export const REFERRAL_CLAIM_CODE_STORAGE_KEY = "veydrift.referral.claim-code.v1";

// Some mobile wallets/webviews do not expose a reliable Clipboard API. Accepting the complete
// referral URL when it is pasted makes the manual code field behave exactly like opening the link.
// Strip zero-width characters too: chat apps occasionally introduce them while copying formatted
// text, but they are not part of a valid on-chain invite code.
export function referralCodeFromText(value: string): string {
  const trimmed = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!trimmed) return "";
  try {
    const linkedCode = new URL(trimmed).searchParams.get("ref");
    return linkedCode?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

export function referralCodeForLanding(search: string, persisted: string): string {
  return referralCodeFromText(new URLSearchParams(search).get("ref") ?? "") || referralCodeFromText(persisted);
}

export function readReferralStorage(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeReferralStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted Mini App hosts; the URL remains the fallback.
  }
}
