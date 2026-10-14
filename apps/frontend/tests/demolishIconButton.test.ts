import { describe, expect, test } from "bun:test";
import { DemolishIconButton, structureDemolitionProgress } from "../src/components/StructureCatalog";

function button(overrides: Partial<Parameters<typeof DemolishIconButton>[0]> = {}) {
  const calls = { demolish: 0, toggle: 0 };
  const node = DemolishIconButton({
    disabled: false,
    isReasonOpen: false,
    label: "Metal Mine",
    onClick: () => { calls.demolish++; },
    onToggleReason: () => { calls.toggle++; },
    reasonId: "reason-1",
    ...overrides,
  });
  return { calls, props: node.props as Record<string, any> };
}

describe("inline Demolish icon (#120)", () => {
  test("is icon-only with an accessible label and a Demolish tooltip that opens the dialog", () => {
    const { calls, props } = button();
    expect(props["aria-label"]).toBe("Demolish Metal Mine");
    expect(props.title).toBe("Demolish");
    expect(props.disabled).toBe(false);
    expect(props["aria-disabled"]).toBeUndefined();
    // The only child is the aria-hidden glyph: no text label.
    expect(typeof props.children).toBe("object");
    expect(props.children.props["aria-hidden"]).toBe("true");
    expect(props.className).toContain("h-10 w-10");
    props.onClick();
    expect(calls).toEqual({ demolish: 1, toggle: 0 });
  });

  test("an unavailable Demolish stays tappable and reveals the exact reason instead of demolishing", () => {
    const reason = "Not enough metal and crystal";
    const { calls, props } = button({ disabled: true, reason, isReasonOpen: true });
    expect(props.disabled).toBe(false);
    expect(props["aria-disabled"]).toBe("true");
    expect(props["aria-expanded"]).toBe(true);
    expect(props["aria-controls"]).toBe("reason-1");
    // Screen readers hear the reason without activating the button.
    expect(props["aria-describedby"]).toBe("reason-1");
    expect(props.title).toBe(reason);
    props.onClick();
    expect(calls).toEqual({ demolish: 0, toggle: 1 });
  });

  test("a disabled Demolish without a reason is natively disabled", () => {
    const { props } = button({ disabled: true });
    expect(props.disabled).toBe(true);
    expect(props["aria-disabled"]).toBeUndefined();
  });
});

describe("demolition progress (#120)", () => {
  const now = 1_800_000_000_000;

  test("falls back to the queue timeline when no shared projection is available", () => {
    expect(structureDemolitionProgress("Demolishing Metal Mine 6 → 5", undefined, { readyAt: now + 120_000, startedAt: now - 60_000 }, now))
      .toEqual({ indeterminate: false, label: "Demolishing Metal Mine 6 → 5", progress: 1 / 3, remaining: "2m" });
  });

  test("is indeterminate without a start time but still counts down to readyAt", () => {
    const progress = structureDemolitionProgress("Demolishing Jump Gate 1 → 0", undefined, { readyAt: now + 90_000 }, now);
    expect(progress.indeterminate).toBe(true);
    expect(progress.remaining).toBe("1m 30s");
    expect(structureDemolitionProgress("x", undefined, undefined, now)).toMatchObject({ indeterminate: true, remaining: "syncing" });
  });
});
