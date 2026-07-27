import { describe, expect, test } from "bun:test";
import { ChevronDown, ChevronUp } from "lucide-preact";
import type { ComponentChildren, VNode } from "preact";
import {
  CommanderAccountSummary,
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
      && item.props.style?.minHeight !== undefined
  );
}

function commanderValue(node: ComponentChildren): VNode | undefined {
  return elementNodes(node).find((item) => item.props?.copyKey === "commander");
}

function renderFunctionComponent(node: VNode | undefined): ComponentChildren {
  if (!node || typeof node.type !== "function") return undefined;
  return (node.type as (props: Record<string, unknown>) => ComponentChildren)(
    node.props as Record<string, unknown>,
  );
}

function commanderIdentityElement(node: ComponentChildren): VNode | undefined {
  return elementNodes(renderFunctionComponent(commanderValue(node))).find((item) =>
    item.type === "button" || item.type === "span"
  );
}

function commanderIdentityContent(node: ComponentChildren): VNode | undefined {
  const identity = commanderIdentityElement(node);
  return elementNodes(identity?.props?.children as ComponentChildren).find((item) =>
    item.type === "span" && item.props?.style?.transform !== undefined
  );
}

function px(value: unknown): number {
  expect(typeof value).toBe("string");
  expect(value as string).toMatch(/^-?\d+px$/);
  return Number.parseInt(value as string, 10);
}

function collapsedGeometry(node: ComponentChildren) {
  const header = commanderHeaderRow(node);
  const identity = commanderIdentityElement(node);
  const content = commanderIdentityContent(node);
  const disclosure = disclosureButton(node);
  const transform = content?.props?.style?.transform;

  expect(transform).toMatch(/^translateY\(-?\d+px\)$/);

  return {
    disclosureHeight: px(disclosure?.props?.style?.height),
    disclosureWidth: px(disclosure?.props?.style?.width),
    identityHeight: px(identity?.props?.style?.height),
    identityLineHeight: px(identity?.props?.style?.lineHeight),
    identityOffsetY: Number.parseInt(transform.match(/-?\d+/)?.[0] ?? "", 10),
    rowHeight: px(header?.props?.style?.minHeight),
  };
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

  test("renders the configured name in the complete collapsed row geometry", () => {
    const profile = playerProfile("Nova");
    const summary = renderCommanderSummary({
      copiedField: { key: "commander", nonce: 1 },
      playerLabel: commanderIdentityLabel(profile, wallet),
      playerProfile: profile,
    });
    const disclosure = disclosureButton(summary);
    const header = commanderHeaderRow(summary);
    const geometry = collapsedGeometry(summary);

    expect(commanderSummaryInitiallyExpanded).toBe(false);
    expect(copyValue(summary, "commander")).toBe("Nova");
    expect(geometry).toEqual({
      disclosureHeight: 28,
      disclosureWidth: 28,
      identityHeight: 28,
      identityLineHeight: 16,
      identityOffsetY: 2,
      rowHeight: 28,
    });
    expect(geometry.identityHeight).toBe(geometry.rowHeight);
    expect(geometry.disclosureHeight).toBe(geometry.rowHeight);
    expect(header?.props?.className).toContain("items-center");
    expect(
      elementNodes(commanderIdentityContent(summary)?.props?.children as ComponentChildren)
        .some((item) => item.props?.className?.includes("veydrift-copy-value-fade-up")),
    ).toBe(true);
    expect(copyValue(summary, "home")).toBeUndefined();
    expect(copyValue(summary, "wallet")).toBeUndefined();
    expect(visibleText(summary)).not.toContain("Home");
    expect(visibleText(summary)).not.toContain("Wallet");
    expect(disclosure?.props?.["aria-expanded"]).toBe(false);
    expect(disclosure?.props?.["aria-controls"]).toBe("commander-details");
    expect(disclosure?.props?.["aria-label"]).toBe("Expand Commander profile");
    expect((disclosure?.props?.children as VNode)?.type).toBe(ChevronUp);
  });

  test("renders the shortened-wallet fallback with the identical collapsed geometry", () => {
    const profile = playerProfile(null);
    const label = commanderIdentityLabel(profile, wallet);
    const summary = renderCommanderSummary({
      playerLabel: label,
      playerProfile: profile,
    });
    const header = commanderHeaderRow(summary);
    const geometry = collapsedGeometry(summary);

    expect(label).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).toBe(shortAddress(wallet));
    expect(copyValue(summary, "commander")).not.toBe("Unnamed player");
    expect(header?.props?.className).toContain("items-center");
    expect(geometry).toEqual({
      disclosureHeight: 28,
      disclosureWidth: 28,
      identityHeight: 28,
      identityLineHeight: 16,
      identityOffsetY: 2,
      rowHeight: 28,
    });
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
    const identity = commanderIdentityElement(summary);
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
    expect(identity?.props?.style).toEqual({
      height: undefined,
      lineHeight: "16px",
    });
    expect(commanderIdentityContent(summary)).toBeUndefined();
    expect(disclosure?.props?.["aria-expanded"]).toBe(true);
    expect(disclosure?.props?.["aria-label"]).toBe("Collapse Commander profile");
    expect((disclosure?.props?.children as VNode)?.type).toBe(ChevronDown);

    (disclosure?.props?.onClick as () => void)();
    expect(toggleCount).toBe(1);
  });
});
