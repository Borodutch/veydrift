// Sharing a battle-report link (VEY-KANEO-339).
//
// The battle-report header Share button used to be copy-to-clipboard only: it silently wrote the URL
// and showed no share dialog, which read as broken (QA: "page navigates away / no share dialog").
// This helper gives the button a real share affordance: it prefers the native Web Share API — on
// mobile and on desktop Chrome/Edge/Safari that opens the OS share sheet with copy-link and social
// targets — and falls back to copying the link to the clipboard where the API is unavailable. It is
// route-safe by construction: it only calls `navigator.share` / `navigator.clipboard.writeText` and
// never touches `window.location`, so it can never drop the viewer back to the overview page.

export type ShareOutcome = "shared" | "copied" | "error";

// Structural subset of `navigator` this helper touches, so it stays unit-testable with a plain fake
// and does not depend on the ambient DOM typings being present.
export interface ShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

const SHARE_TITLE = "Veydrift battle report";

export async function shareReportUrl(
  navigatorRef: ShareCapableNavigator | undefined,
  url: string,
): Promise<ShareOutcome> {
  if (!url || !navigatorRef) return "error";

  if (typeof navigatorRef.share === "function") {
    try {
      await navigatorRef.share({ title: SHARE_TITLE, url });
      return "shared";
    } catch (error) {
      // Dismissing the native share sheet rejects with AbortError — that is a normal cancellation,
      // not a failure, so it must not fall through to a clipboard copy or surface an error state.
      if (error instanceof Error && error.name === "AbortError") return "shared";
      // Any other share rejection falls back to copying the link below.
    }
  }

  const clipboard = navigatorRef.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(url);
      return "copied";
    } catch {
      return "error";
    }
  }

  return "error";
}
