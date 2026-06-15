import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";

import { InspectPageHeader } from "./components/InspectProgressLayout";
import { MoonPage } from "./components/MoonPage";
import { PageHeader } from "./components/PageHeader";

describe("page header separators", () => {
  test("keeps inspect progress headers aligned with the shared page header separator", () => {
    const header = InspectPageHeader({ title: "Research" });

    expect(classNameOf(header)).toContain("border-b");
    expect(classNameOf(header)).toContain("border-white/10");
    expect(classNameOf(header)).toContain("pb-4");
  });

  test("keeps moon screen header aligned with the shared page header separator", () => {
    const page = MoonPage({ loading: false });
    const headerNode = findPageHeader(page);

    expect(headerNode).not.toBeNull();
    if (!headerNode) throw new Error("Moon page header was not rendered");

    expect(headerNode.props.bordered).not.toBe(false);
    expect(classNameOf(PageHeader(headerNode.props))).toContain("border-b");
  });
});

function classNameOf(node: ComponentChildren): string {
  if (!isVNode(node)) return "";
  return String((node.props as { className?: unknown }).className ?? "");
}

function findPageHeader(node: ComponentChildren): VNode<Parameters<typeof PageHeader>[0]> | null {
  if (!isVNode(node)) return null;
  if (node.type === PageHeader) return node as VNode<Parameters<typeof PageHeader>[0]>;

  const children = (node.props as { children?: ComponentChildren }).children;
  const childNodes = Array.isArray(children) ? children : [children];
  for (const child of childNodes) {
    const found = findPageHeader(child);
    if (found) return found;
  }
  return null;
}

function isVNode(node: ComponentChildren): node is VNode {
  return Boolean(node && typeof node === "object" && "props" in node);
}
