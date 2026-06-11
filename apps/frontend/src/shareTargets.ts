// Social share intent links for the battle-report Share dialog (VEY-KANEO-339).
//
// The Share button opens an in-app dialog rather than relying on the native Web Share API: on
// desktop Chrome `navigator.share` opens OS-level chrome that automated QA cannot see or interact
// with, which read as "no share dialog appears" and bounced this ticket repeatedly. The in-app
// dialog always renders the link plus these social targets as real DOM, so it is visible and
// inspectable everywhere. Each target is a plain share-intent URL opened in a new tab; none of them
// touch the current page's route.

export type ShareTarget = {
  key: "x" | "telegram" | "farcaster";
  label: string;
  href: string;
};

const SHARE_TEXT = "Veydrift battle report";

// Builds the X / Telegram / Farcaster share-intent URLs for a battle-report link. Returns an empty
// list for an empty URL so the dialog can omit the social row instead of emitting broken links.
export function shareTargets(url: string, text: string = SHARE_TEXT): ShareTarget[] {
  if (!url) return [];
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  return [
    {
      key: "x",
      label: "Share on X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      key: "telegram",
      label: "Share on Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      key: "farcaster",
      // Farcaster's compose URL embeds the link rather than appending it to the text body.
      label: "Share on Farcaster",
      href: `https://warpcast.com/~/compose?text=${encodedText}&embeds[]=${encodedUrl}`,
    },
  ];
}
