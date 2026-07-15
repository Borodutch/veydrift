export const REFERRAL_CODE_STORAGE_KEY = "veydrift.referral.settlement-code.v1";
export const REFERRAL_CLAIM_CODE_STORAGE_KEY = "veydrift.referral.claim-code.v1";

export function referralCodeForLanding(search: string, persisted: string): string {
  return new URLSearchParams(search).get("ref")?.trim() || persisted.trim();
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
