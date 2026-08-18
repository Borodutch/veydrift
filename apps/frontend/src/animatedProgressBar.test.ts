import { describe, expect, test } from "bun:test";
import { AnimatedProgressBar } from "./components/AnimatedProgressBar";

describe("AnimatedProgressBar", () => {
  test("renders unknown timing as full-track stripes without a percentage-like fill", () => {
    const progress = AnimatedProgressBar({
      fillClassName: "bg-violet-300",
      indeterminate: true,
      label: "Research queue progress",
    });
    const child = progress.props.children as { props: Record<string, unknown> };

    expect(progress.props["aria-valuenow"]).toBeUndefined();
    expect(progress.props["aria-valuetext"]).toBe("Progress timing unavailable");
    expect(String(child.props.className)).toContain("queue-indeterminate-track");
    expect(String(child.props.className)).toContain("w-full");
    expect(String(child.props.className)).not.toContain("w-2/3");
  });

  test("keeps exact determinate percentages accessible", () => {
    const progress = AnimatedProgressBar({
      label: "Research queue progress",
      value: 0.21,
    });

    expect(progress.props["aria-valuenow"]).toBe(21);
    expect(progress.props["aria-valuetext"]).toBe("21%");
  });
});
