import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { formatQueueEta, QueueProgressPanel, queueTimestampToMs } from "../src/components/QueueProgressPanel";

describe("QueueProgressPanel", () => {
  test("normalizes chain seconds and millisecond timestamps", () => {
    expect(queueTimestampToMs("1700000000")).toBe(1_700_000_000_000);
    expect(queueTimestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(queueTimestampToMs(null)).toBeUndefined();
    expect(queueTimestampToMs("not-a-number")).toBeUndefined();
    expect(formatQueueEta(null)).toBe("ETA —");
  });

  test("renders a compact queue strip with an ETA and no visible item title", () => {
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

    expect(panel.props["aria-label"]).toBe("Active queue: Rocket Launcher");
    expect(text.replace(/\s+/g, "")).toContain("×2");
    expect(text).toContain("50%");
    expect(text).toContain("Complete queue");
    expect(text).toContain("Active queue");
    expect(text).not.toContain("Rocket Launcher");
    expect(text).not.toContain("Time remaining");
    expect(text).not.toContain("Ready at");
    expect(panel.props.className).toContain("border");
  });

  test("renders a freshly started ship queue near 0%, not nearly full", () => {
    const now = 1_700_000_000_000;
    const startedAt = String(Math.floor(now / 1_000)); // chain seconds: just started
    const readyAt = String(Math.floor(now / 1_000) + 24 * 60); // +24m build
    const panel = QueueProgressPanel({
      label: "Small Cargo",
      now,
      quantity: 1,
      readyAt,
      startedAt,
      title: "Active queue",
      tone: "cyan",
    });
    const text = visibleText(panel);

    expect(text).toContain("0%");
    expect(text).not.toContain("100%");
    expect(hasClass(panel, "animate-pulse")).toBe(false);
  });

  test("keeps unit-detail metadata out of the compact queue rail", () => {
    const panel = QueueProgressPanel({
      completedQuantity: 2,
      currentUnitProgressBps: 3750,
      currentUnitSecondsRemaining: 75,
      label: "Small Cargo",
      now: 1_700_000_300_000,
      progress: 0.4,
      quantity: 3,
      readyAt: "1700000900",
      remainingQuantity: 3,
      startedAt: "1700000000",
      title: "Active queue",
      tone: "cyan",
    });
    const text = visibleText(panel);

    expect(text).toContain("33%");
    expect(text.replace(/\s+/g, "")).toContain("2/5·33%");
    expect(text).not.toContain("Units complete");
    expect(text).not.toContain("Current unit");
  });

  test("keeps pending queues without a canonical timeline indeterminate", () => {
    const panel = QueueProgressPanel({
      label: "Light Laser",
      now: 1_500_000,
      quantity: 3,
      readyAt: "2000",
      title: "Active queue",
      tone: "rose",
    });
    const text = visibleText(panel);

    expect(text).toContain("…");
    expect(text).not.toContain("0%");
    expect(hasClass(panel, "animate-pulse")).toBe(true);
  });

  test("renders ready queues as complete even without a started timestamp", () => {
    const panel = QueueProgressPanel({
      label: "Small Cargo",
      now: 2_500_000,
      quantity: 1,
      readyAt: "2000",
      title: "Active queue",
      tone: "cyan",
    });
    const text = visibleText(panel);

    expect(text).toContain("100%");
    expect(text).not.toContain("Ready");
    expect(hasClass(panel, "animate-pulse")).toBe(false);
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

function hasClass(node: ComponentChildren, className: string): boolean {
  if (node === null || node === undefined || typeof node === "boolean") {
    return false;
  }

  if (typeof node === "string" || typeof node === "number") {
    return false;
  }

  if (Array.isArray(node)) {
    return node.some((child) => hasClass(child, className));
  }

  const vnode = node as VNode;
  const classes = typeof vnode.props?.className === "string" ? vnode.props.className : "";
  return classes.split(/\s+/).includes(className) || hasClass(vnode.props?.children, className);
}
