import { sdk } from "@farcaster/miniapp-sdk";

export type FarcasterReadyClient = {
  isInMiniApp?: (timeoutMs?: number) => Promise<boolean>;
  actions: {
    ready: (options?: Record<string, unknown>) => Promise<void> | void;
  };
};

type ReadyScheduler = (callback: () => void) => void;
type MiniAppLocation = Pick<Location, "pathname" | "search">;

let readyPromise: Promise<void> | undefined;

export function hasMiniAppUrlHint(
  location: MiniAppLocation = window.location,
): boolean {
  const params = new URLSearchParams(location.search);
  return location.pathname.startsWith("/miniapp") || params.get("miniApp") === "true";
}

export async function detectFarcasterMiniApp(
  client: FarcasterReadyClient = sdk,
  location: MiniAppLocation = window.location,
): Promise<boolean> {
  if (hasMiniAppUrlHint(location)) {
    return true;
  }

  return client.isInMiniApp?.(500).catch(() => false) ?? false;
}

export function signalFarcasterReadyOnce(
  client: FarcasterReadyClient = sdk,
): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.resolve()
      .then(() => withTimeout(Promise.resolve(client.actions.ready({})), 1_200))
      .catch(() => {
        // Keep regular browser loads resilient when no Mini App host responds.
      });
  }

  return readyPromise;
}

export function scheduleFarcasterReady(
  client?: FarcasterReadyClient,
  scheduler: ReadyScheduler = scheduleAfterNextPaint,
): void {
  scheduler(() => {
    void signalFarcasterReadyOnce(client);
  });
}

export function resetFarcasterReadyForTests(): void {
  readyPromise = undefined;
}

function scheduleAfterNextPaint(callback: () => void): void {
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => {
      callback();
    });
    return;
  }

  setTimeout(callback, 0);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]);
}
