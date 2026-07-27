import { describe, expect, test } from "bun:test";
import { ChevronDown, ChevronUp } from "lucide-preact";
import type { ComponentChildren, VNode } from "preact";
import {
  CommanderAccountSummary,
  commanderCollapsedIdentityGeometry,
  commanderIdentityLabel,
  commanderJoinCta,
  commanderSummaryInitiallyExpanded,
  shouldShowCommanderJoinCta,
} from "../src/components/NavBar";
import { shortAddress, type PlayerProfile } from "../src/walletFlow";

const wallet = "0x1111111111111111111111111111111111111111";

function playerProfile(displayName: string | null): PlayerProfile {
  return {
    wallet,
    displayName,
    description: null,
    fallbackName: shortAddress(wallet),
    updatedAt: null,
  };
}

function renderCommanderSummary(
  overrides: Partial<Parameters<typeof CommanderAccountSummary>[0]> = {},
): ComponentChildren {
  return CommanderAccountSummary({
    account: wallet,
    className: "summary",
    coordinates: "8:490:11",
    copiedField: undefined,
    detailsId: "commander-details",
    expanded: commanderSummaryInitiallyExpanded,
    onCopy: () => undefined,
    onEdit: () => undefined,
    onToggle: () => undefined,
    playerCopyValue: wallet,
    playerLabel: commanderIdentityLabel(overrides.playerProfile, wallet),
    playerPanelOpen: false,
    playerProfileBusy: false,
    playerStatusTone: "text-slate-300",
    ...overrides,
  });
}

function elementNodes(node: ComponentChildren): VNode[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elementNodes);

  const vnode = node as VNode;
  return [vnode, ...elementNodes(vnode.props?.children as ComponentChildren)];
}

function visibleText(node: ComponentChildren): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");

  return visibleText((node as VNode).props?.children as ComponentChildren);
}

function disclosureButton(node: ComponentChildren): VNode | undefined {
  return elementNodes(node).find((item) =>
    item.type === "button"
      && typeof item.props?.["aria-label"] === "string"
      && item.props["aria-label"].includes("Commander profile")
  );
}

function commanderHeaderRow(node: ComponentChildren): VNode | undefined {
  return elementNodes(node).find((item) =>
    item.type === "div"
      && typeof item.props?.className === "string"
      && item.props.className.includes("justify-between")
      && item.props.className.includes("min-h-7")
  );
}

function commanderValue(node: ComponentChildren): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.copyKey === "commander");
}

function copyValue(node: ComponentChildren, key: string): string | undefined {
  return elementNodes(node).find((item) => item.props?.copyKey === key)?.props?.value;
}

describe("NavBar public commander panel", () => {
  test("shows a join CTA only for public viewers with a connect action", () => {
    expect(shouldShowCommanderJoinCta(undefined, () => undefined)).toBe(true);
    expect(shouldShowCommanderJoinCta("0x1111111111111111111111111111111111111111", () => undefined)).toBe(false);
    expect(shouldShowCommanderJoinCta(undefined, undefined)).toBe(false);
  });

  test("uses the requested public commander copy", () => {
    expect(commanderJoinCta).toEqual({
      action: "Connect wallet",
      label: "Join Veydrift",
    });
  });

  test("starts the Commander summary collapsed with only the display name and up-arrow disclosure", () => {
    const profile = playerProfile("Nova");
    const summary = renderCommanderSummary({
      playerLabel: commanderIdentityLabel(profile, wallet),
      playerProfile: profile,
    });
    const disclosure = disclosureButton(summary);
    const header = commanderHeaderRow(summary);
    const identity = commanderValue(summary);

    expect(commanderSummaryInitiallyExpanded).toBe(false);
    expect(copyValue(summary, "commander")).toBe("Nova");
    expect(commanderCollapsedIdentityGeometry).toEqual({
      lineHeightPx: 16,
      opticalOffsetYPx: 2,
      rowHeightPx: 28,
    });
    expect(header?.props?.className).toContain("items-center");
    expect(header?.props?.className).toContain("min-h-7");
    expect(identity?.props?.className).toContain("h-7");
    expect(identity?.props?.className).toContain("items-center");
    expect(identity?.props?.className).toContain("leading-4");
    expect(identity?.props?.contentStyle).toEqual({ transform: "translateY(2px)" });
    expect(disclosure?.props?.className).toContain("h-7");
    expect(copyValue(summary, "home")).toBeUndefined();
    expect(copyValue(summary, "wallet")).toBeUndefined();
    expect(visibleText(summary)).not.toContain("Home");
    expect(visibleText(summary)).not.toContain("Wallet");
    expect(disclosure?.props?.["aria-expanded"]).toBe(false);
    expect(disclosure?.props?.["aria-controls"]).toBe("commander-details");
    expect(disclosure?.props?.["aria-label"]).toBe("Expand Commander profile");
    expect((disclosure?.props?.children as VNode)?.type).toBe(ChevronUp);
  });

  test("uses the existing shortened wallet fallback when no Commander name exists", () => {
    const profile = playerProfile(null);
    const label = commanderIdentityLabel(profile, wallet);
    const summary = renderCommanderSummary({
      playerLabel: label,
      playerProfile: profile,
    });
    const header = commanderHeaderRow(summary);
    const identity = commanderValue(summary);

    expect(label).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).not.toBe("Unnamed player");
    expect(header?.props?.className).toContain("items-center");
    expect(identity?.props?.className).toContain("h-7");
    expect(identity?.props?.className).toContain("items-center");
    expect(identity?.props?.contentStyle).toEqual({ transform: "translateY(2px)" });
  });

  test("reveals the complete existing profile content and exposes the collapse state", () => {
    let toggleCount = 0;
    const profile = playerProfile("Nova");
    const summary = renderCommanderSummary({
      expanded: true,
      onToggle: () => {
        toggleCount += 1;
      },
      playerLabel: commanderIdentityLabel(profile, wallet),
      playerProfile: profile,
    });
    const disclosure = disclosureButton(summary);
    const header = commanderHeaderRow(summary);
    const identity = commanderValue(summary);
    const edit = elementNodes(summary).find((item) => item.props?.["aria-label"] === "Edit player profile");
    const text = visibleText(summary);

    expect(text).toContain("Commander");
    expect(text).toContain("Home");
    expect(text).toContain("Wallet");
    expect(copyValue(summary, "commander")).toBe("Nova");
    expect(copyValue(summary, "commander-fallback")).toBe(shortAddress(wallet));
    expect(copyValue(summary, "home")).toBe("8:490:11");
    expect(copyValue(summary, "wallet")).toBe(shortAddress(wallet));
    expect(edit).toBeDefined();
    expect(header?.props?.className).toContain("items-start");
    expect(identity?.props?.className).not.toContain("h-7");
    expect(identity?.props?.contentStyle).toBeUndefined();
    expect(disclosure?.props?.["aria-expanded"]).toBe(true);
    expect(disclosure?.props?.["aria-label"]).toBe("Collapse Commander profile");
    expect((disclosure?.props?.children as VNode)?.type).toBe(ChevronDown);

    (disclosure?.props?.onClick as () => void)();
    expect(toggleCount).toBe(1);
  });
});
