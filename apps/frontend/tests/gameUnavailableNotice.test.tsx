import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  GAME_UNAVAILABLE_MESSAGE,
  GAME_UNAVAILABLE_TITLE,
  GameUnavailableNotice,
  isGameUnavailableMessage,
} from "../src/components/GameUnavailableNotice";
import { serverUnavailableRetryMessage } from "../src/gameUnavailable";
import { InlineStateNotice } from "../src/components/InlineStateNotice";

describe("shared game unavailable notice", () => {
  test("uses a quiet inline treatment for ordinary state and an alert role only for blocking errors", () => {
    const quiet = InlineStateNotice({ children: "Showing cached data", title: "Refresh delayed" });
    const blocking = InlineStateNotice({ blocking: true, children: "Retry", title: "Unavailable", tone: "error" });

    expect(quiet.props?.role).toBe("status");
    expect(quiet.props?.className).toContain("border-l-2");
    expect(quiet.props?.className).not.toMatch(/\brounded\b|\bbg-/);
    expect(blocking.props?.role).toBe("alert");
  });

  test("renders player-facing outage copy without diagnostics", () => {
    const notice = GameUnavailableNotice({});
    const text = visibleText(notice);

    expect(text).toContain(GAME_UNAVAILABLE_TITLE);
    expect(text).toContain(GAME_UNAVAILABLE_MESSAGE);
    expect(text).not.toMatch(/CORS|deployment|browser|Settlement API|wallet|last known game state|RPC|backend|network mismatch/i);
  });

  test("formats retry countdown pluralization", () => {
    expect(serverUnavailableRetryMessage(1)).toBe("Servers are unavailable. Retrying in 1 second.");
    expect(serverUnavailableRetryMessage(10)).toBe("Servers are unavailable. Retrying in 10 seconds.");
  });

  test("classifies page-level backend outage messages from affected surfaces", () => {
    expect(isGameUnavailableMessage(
      "Rankings are temporarily unavailable because the game API could not be reached from this browser. Check the API deployment or CORS settings, then retry.",
    )).toBe(true);
    expect(isGameUnavailableMessage("Game API unavailable.")).toBe(true);
    expect(isGameUnavailableMessage("Servers are unavailable. Retrying in 1 second.")).toBe(true);
    expect(isGameUnavailableMessage("Wallet connection was rejected.")).toBe(false);
    expect(isGameUnavailableMessage("Rankings are warming from indexed game state. Retry in a moment.")).toBe(false);
  });
});

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textParts);

  const vnode = node as VNode;
  if (typeof vnode.type === "function") return textParts(vnode.type(vnode.props));

  return textParts(vnode.props?.children);
}
