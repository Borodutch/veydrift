import { describe, expect, test } from "bun:test";
import { shareReportUrl, type ShareCapableNavigator } from "../src/shareReport";

// VEY-KANEO-339: the battle-report Share button used to be copy-only and read as broken (no share
// dialog; QA also reported it dropping back to the overview). `shareReportUrl` now backs it: it
// prefers the native Web Share dialog and falls back to a clipboard copy, and — critically — it only
// ever calls navigator.share / navigator.clipboard, so it can never mutate the route.

const URL = "https://test.veydrift.com/#/mission/228";

describe("shareReportUrl", () => {
  test("uses the native Web Share API when available and reports a share", async () => {
    const calls: Array<{ title?: string; url?: string }> = [];
    const navigatorRef: ShareCapableNavigator = {
      share: async (data) => {
        calls.push(data);
      },
    };

    const outcome = await shareReportUrl(navigatorRef, URL);

    expect(outcome).toBe("shared");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL);
    expect(calls[0]?.title).toBe("Veydrift battle report");
  });

  test("treats a dismissed share sheet (AbortError) as a share, not a failure or copy", async () => {
    let copied = false;
    const abort = new Error("user cancelled");
    abort.name = "AbortError";
    const navigatorRef: ShareCapableNavigator = {
      share: async () => {
        throw abort;
      },
      clipboard: {
        writeText: async () => {
          copied = true;
        },
      },
    };

    const outcome = await shareReportUrl(navigatorRef, URL);

    expect(outcome).toBe("shared");
    expect(copied).toBe(false);
  });

  test("falls back to copying the link when the share sheet fails for another reason", async () => {
    const written: string[] = [];
    const navigatorRef: ShareCapableNavigator = {
      share: async () => {
        throw new Error("NotAllowedError");
      },
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    };

    const outcome = await shareReportUrl(navigatorRef, URL);

    expect(outcome).toBe("copied");
    expect(written).toEqual([URL]);
  });

  test("copies the link when the Web Share API is unavailable", async () => {
    const written: string[] = [];
    const navigatorRef: ShareCapableNavigator = {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    };

    const outcome = await shareReportUrl(navigatorRef, URL);

    expect(outcome).toBe("copied");
    expect(written).toEqual([URL]);
  });

  test("reports an error when neither share nor clipboard is available", async () => {
    expect(await shareReportUrl({}, URL)).toBe("error");
    expect(await shareReportUrl(undefined, URL)).toBe("error");
  });

  test("reports an error for an empty URL without invoking any capability", async () => {
    let touched = false;
    const navigatorRef: ShareCapableNavigator = {
      share: async () => {
        touched = true;
      },
      clipboard: {
        writeText: async () => {
          touched = true;
        },
      },
    };

    expect(await shareReportUrl(navigatorRef, "")).toBe("error");
    expect(touched).toBe(false);
  });

  test("surfaces a clipboard-copy failure as an error", async () => {
    const navigatorRef: ShareCapableNavigator = {
      clipboard: {
        writeText: async () => {
          throw new Error("clipboard blocked");
        },
      },
    };

    expect(await shareReportUrl(navigatorRef, URL)).toBe("error");
  });
});
