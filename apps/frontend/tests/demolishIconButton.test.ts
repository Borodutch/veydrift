import { describe, expect, test } from "bun:test";
import { DemolishIconButton, structureDemolitionProgress } from "../src/components/StructureCatalog";

describe("inline Demolish icon (#120, #125)", () => {
  test("is icon-only with an accessible label and a Demolish tooltip that opens the dialog", () => {
    let demolish = 0;
    const props = DemolishIconButton({ label: "Metal Mine", onClick: () => { demolish++; } }).props as Record<string, any>;
    expect(props["aria-label"]).toBe("Demolish Metal Mine");
    expect(props.title).toBe("Demolish");
    // Only rendered while demolition is available, so it never carries a disabled state.
    expect(props.disabled).toBeUndefined();
    expect(props["aria-disabled"]).toBeUndefined();
    expect(props.className).not.toContain("disabled:");
    // The only child is the aria-hidden glyph: no text label.
    expect(typeof props.children).toBe("object");
    expect(props.children.props["aria-hidden"]).toBe("true");
    expect(props.className).toContain("h-10 w-10");
    props.onClick();
    expect(demolish).toBe(1);
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
