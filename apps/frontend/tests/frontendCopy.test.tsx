import { afterEach, describe, expect, test } from "bun:test";
import type { ComponentChildren, ComponentClass, VNode } from "preact";
import { playerNotice } from "../src/playerNotice";
import audit from "./fixtures/frontendCopyAudit.json";
import { auditFrontendCopy } from "../scripts/audit-frontend-copy.mjs";
import { farcasterMiniAppReportableWalletError, settlementErrorStateMessage, settlementLaunchBlocker } from "../src/FirstPlanetSettlementApp";
import { attackProtectionSubmitBlocker, clearRecoveredWalletContractUnavailableAction } from "../src/PlayableMvpApp";
import { shouldAutoDismissActionNotice } from "../src/actionNoticeAutoDismiss";
import { CONTRACT_REJECTED_NO_REASON_MESSAGE, fetchGameApiJson, fetchGameApiMutation, isTransientWalletBootstrapError } from "../src/walletFlow";
import { GameApiError } from "../src/gameApiError";
import { InlineStateNotice } from "../src/components/InlineStateNotice";
import { RiftUnderConstruction } from "../src/components/RiftPage";
import { TopBar } from "../src/components/TopBar";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("frontend copy audit", () => {
  test("retired copy cannot return through components, helpers, docs, public assets or metadata", () => {
    const result = auditFrontendCopy();
    expect(result.files).toBeGreaterThan(100);
    expect(result.candidates).toBeGreaterThan(150);
    expect(result.violations).toEqual([]);
  });

  test("resource popover retains loading accessibility and shortage warnings without implementation copy", () => {
    const bar = TopBar({
      isWalletConnected: true, resourceStatus: "ready",
      caps: { metal: 10000, crystal: 10000, deuterium: 10000 },
      resources: { metal: 10, crystal: 20, deuterium: 30 },
      rates: { metal: 5, crystal: 5, deuterium: 5 },
      energy: { produced: 50, required: 100, scaleBps: 5000 },
    });
    const text = visibleCopy(bar);
    expect(text).toContain("Insufficient energy reduces mine output to 50%");
    expect(text).toContain("Crawler production details are loading");
    expect(text).not.toMatch(/backend|production model|verified/i);
  });

  test("Rift keeps one truthful unavailable heading, not placeholder badges or description", () => {
    const section = RiftUnderConstruction();
    expect(section.props["aria-labelledby"]).toBe("rift-under-construction-title");
    const text = visibleCopy(section);
    expect(text).toContain("The Rift is not available yet");
    expect(text).not.toMatch(/Under construction|taking shape|assembled and stabilized/);
  });

  test("onboarding and wallet errors retain player recovery and settlement gates", () => {
    expect(settlementLaunchBlocker(false, { status: "loading" })).toBe("Settlement is currently unavailable.");
    const error = settlementErrorStateMessage({ kind: "error", message: "The Veydrift backend is temporarily unreachable" });
    expect(error.title).toBe("Game server unavailable");
    expect(error.body).toContain("try again");
    expect(error.body).not.toMatch(/backend|deployment/i);
    expect(farcasterMiniAppReportableWalletError("Wallet connection was rejected.")).toContain("contact Veydrift support");
    expect(attackProtectionSubmitBlocker(undefined)).toContain("Retry before launching an attack");
  });

  test("copy changes do not dismiss genuine rejection notices or strand recovered wallet notices", () => {
    expect(shouldAutoDismissActionNotice({ status: "error", label: CONTRACT_REJECTED_NO_REASON_MESSAGE })).toBe(false);
    expect(shouldAutoDismissActionNotice({ status: "error", label: "Fleet action was rejected: unavailable." })).toBe(false);
    expect(shouldAutoDismissActionNotice({ status: "error", label: "Wallet connection was rejected." })).toBe(true);
    for (const label of ["Wallet or game connection is unavailable.", "Alliance actions are unavailable.", "Wallet or moon connection unavailable."]) {
      expect(clearRecoveredWalletContractUnavailableAction({ status: "error", label }, true)).toEqual({ status: "idle" });
      expect(clearRecoveredWalletContractUnavailableAction({ status: "error", label }, false)).toEqual({ status: "error", label });
    }
  });

  test("inline errors and quiet status copy retain announcement semantics", () => {
    expect(InlineStateNotice({ children: "Please retry", blocking: true, tone: "error" }).props).toMatchObject({ role: "alert", "aria-live": "assertive" });
    expect(InlineStateNotice({ children: "Updating" }).props).toMatchObject({ role: "status", "aria-live": "polite" });
  });

  test("API-supplied unavailable reasons lose implementation detail without hiding warnings", () => {
    for (const item of audit.filter(item => "apiSupplied" in item && item.apiSupplied)) {
      expect(playerNotice(item.before), item.before).toBe(item.after);
    }
    expect(playerNotice(undefined)).toBeUndefined();
    expect(playerNotice(null)).toBeNull();
    expect(playerNotice("Settle a home planet before using moon systems.")).toBe("Settle a home planet before using moon systems.");
    expect(playerNotice("No moon exists for this home planet yet.")).toBe("No moon exists for this home planet yet.");
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      contractKind: "game", affordable: false, balanceWei: 0n, startPriceWei: 1n,
      unavailableReason: "Resource token reserves are not configured for this game deployment yet.",
    } })).toContain("Starting resources are currently unavailable");
  });

  test("timeouts retain automatic read recovery and uncertain-write safety without API diagnostics", async () => {
    globalThis.fetch = (async (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    })) as typeof fetch;
    const read = await fetchGameApiJson("https://api.example.test/queues", "Queues", { timeoutMs: 1 }).catch(error => error);
    expect(read.message).toBe("Servers are unavailable. Retrying in 10 seconds.");
    expect(isTransientWalletBootstrapError(read)).toBe(true);
    const write = await fetchGameApiMutation("https://api.example.test/queues", "Queues", {}, { timeoutMs: 1 }).catch(error => error);
    expect(write.message).toContain("Check your wallet activity before retrying");
    expect(write.message).toContain("may already have been sent");
    expect(write.message).not.toContain("API");
    expect(isTransientWalletBootstrapError(write)).toBe(false);
  });

  test("transport error codes remain structured, not rendered, with authorization and throttling recovery", async () => {
    for (const [status, code, message] of [
      [400, "internal_decoder_failure", "Refresh and review your selection"],
      [401, "auth_required", "Reconnect your wallet"],
      [403, "wallet_not_authorized", "not allowed"],
      [429, "rate_limited", "Wait a moment"],
    ] as const) {
      globalThis.fetch = (async () => Response.json({ error: code }, { status, headers: { "retry-after": "12" } })) as typeof fetch;
      const error = await fetchGameApiJson("https://api.example.test/queues", "Queues").catch(error => error);
      expect(error).toBeInstanceOf(GameApiError);
      expect(error).toMatchObject({ status, code, retryAfterMs: 12000 });
      expect(error.message).toContain(message);
      expect(error.message).not.toContain(code);
      expect(error.message).not.toContain("API");
    }
  });
});

function visibleCopy(node: ComponentChildren): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleCopy).join(" ");
  const vnode = node as VNode;
  if (typeof vnode.type === "function") {
    // The primitive icon/image nodes have no authored copy needed by these assertions.
    if ("size" in vnode.props || "src" in vnode.props) return "";
    if (vnode.type.prototype?.render) {
      const instance = new (vnode.type as ComponentClass)(vnode.props);
      return visibleCopy(instance.render(instance.props, instance.state, instance.context));
    }
    return visibleCopy(vnode.type(vnode.props));
  }
  return [vnode.props?.["aria-label"], vnode.props?.title, visibleCopy(vnode.props?.children)].filter(Boolean).join(" ").replace(/\s+/g, " ");
}
