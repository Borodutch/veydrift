// Tactile feedback: Farcaster Mini App SDK haptics when running inside a
// mini app host, navigator.vibrate in regular browsers. Fire and forget.

import { sdk } from "@farcaster/miniapp-sdk";
import { detectFarcasterMiniApp, hasMiniAppUrlHint } from "./farcasterReady";

export type HapticPattern = "complete" | "error" | "select" | "success" | "tick" | "warning";

const VIBRATE_PATTERNS: Record<HapticPattern, number | number[]> = {
  complete: 40,
  error: [80, 40, 80],
  select: 20,
  success: [30, 50, 80],
  tick: 10,
  warning: [60, 40, 60],
};

let miniAppDetection: Promise<boolean> | null = null;

function isMiniAppHost(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (hasMiniAppUrlHint(window.location)) return Promise.resolve(true);
  miniAppDetection ??= detectFarcasterMiniApp().catch(() => false);
  return miniAppDetection;
}

async function fireMiniAppHaptic(pattern: HapticPattern): Promise<boolean> {
  try {
    const haptics = sdk.haptics;
    if (!haptics) return false;
    switch (pattern) {
      case "tick":
        await haptics.selectionChanged();
        return true;
      case "select":
        await haptics.impactOccurred("light");
        return true;
      case "complete":
        await haptics.impactOccurred("medium");
        return true;
      case "success":
        await haptics.notificationOccurred("success");
        return true;
      case "warning":
        await haptics.notificationOccurred("warning");
        return true;
      case "error":
        await haptics.notificationOccurred("error");
        return true;
    }
  } catch {
    // Host does not support haptics; fall back to vibrate below.
  }
  return false;
}

export function haptic(pattern: HapticPattern): void {
  if (typeof navigator === "undefined") return;
  void (async () => {
    if (await isMiniAppHost()) {
      const fired = await fireMiniAppHaptic(pattern);
      if (fired) return;
    }
    try {
      navigator.vibrate?.(VIBRATE_PATTERNS[pattern]);
    } catch {
      // Vibration not supported on this device/browser.
    }
  })();
}
