import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { QueueProgressPanel, queueTimestampToMs } from "../src/components/QueueProgressPanel";

describe("QueueProgressPanel", () => {
  test("normalizes chain seconds and millisecond timestamps", () => {
    expect(queueTimestampToMs("1700000000")).toBe(1_700_000_000_000);
    expect(queueTimestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(queueTimestampToMs(null)).toBeUndefined();
    expect(queueTimestampToMs("not-a-number")).toBeUndefined();
  });

  test("renders shared active queue progress with action, remaining time, and quantity", () => {
    const panel = QueueProgressPanel({
      action: {
        label: "Complete queue",
        onClick: () => undefined,
      },
      label: "Rocket Launcher",
      now: 1_500_000,
      quantity: 2,
      readyAt: "2000",
      startedAt: "1000",
      title: "Active queue",
      tone: "rose",
    });
    const text = visibleText(panel);

    expect(text).toContain("Active queue");
    expect(text).toContain("Rocket Launcher x2");
    expect(text).toContain("50 %");
    expect(text).toContain("Time remaining 8m 20s");
    expect(text).toContain("Ready at");
    expect(text).toContain("Complete queue");
  });
});

function visibleText(node: ComponentChildren): string {
  return textParts(node).join(" ").replace(/\s+/g, " ").trim();
}

function textParts(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (typeof node === "string" || typeof node === "number") {
    return [String(node)];
  }

  if (Array.isArray(node)) {
    return node.flatMap(textParts);
  }

  const vnode = node as VNode;
  return textParts(vnode.props?.children);
}
