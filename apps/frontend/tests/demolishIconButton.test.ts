import { describe, expect, test } from "bun:test";
import { DemolishIconButton } from "../src/components/StructureCatalog";

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
