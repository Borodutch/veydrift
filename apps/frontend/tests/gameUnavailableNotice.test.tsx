import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import {
  GAME_UNAVAILABLE_MESSAGE,
  GAME_UNAVAILABLE_TITLE,
  GameUnavailableNotice,
  isGameUnavailableMessage,
} from "../src/components/GameUnavailableNotice";

describe("shared game unavailable notice", () => {
  test("renders player-facing outage copy without diagnostics", () => {
    const notice = GameUnavailableNotice({});
    const text = visibleText(notice);

    expect(text).toContain(GAME_UNAVAILABLE_TITLE);
    expect(text).toContain(GAME_UNAVAILABLE_MESSAGE);
    expect(text).not.toMatch(/CORS|deployment|browser|Settlement API|wallet|last known game state/i);
  });

  test("classifies page-level backend outage messages from affected surfaces", () => {
    expect(isGameUnavailableMessage(
      "Rankings are temporarily unavailable because the game API could not be reached from this browser. Check the API deployment or CORS settings, then retry.",
    )).toBe(true);
    expect(isGameUnavailableMessage("Game API unavailable.")).toBe(true);
    expect(isGameUnavailableMessage("Veydrift is temporarily unavailable or restarting. Refresh or try again in a few minutes.")).toBe(true);
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
