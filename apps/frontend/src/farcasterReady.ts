import { sdk } from "@farcaster/miniapp-sdk";

export type FarcasterReadyClient = {
  actions: {
    ready: () => Promise<void> | void;
  };
};

type ReadyScheduler = (callback: () => void) => void;

let readyPromise: Promise<void> | undefined;

export function signalFarcasterReadyOnce(
  client: FarcasterReadyClient = sdk,
): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.resolve()
      .then(() => client.actions.ready())
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
