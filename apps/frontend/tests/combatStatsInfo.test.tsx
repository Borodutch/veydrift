import { describe, expect, test } from "bun:test";
import type { ComponentChildren, VNode } from "preact";
import { CombatStatsInfoButton, formatCombatStatValue } from "../src/components/CombatStatsInfo";
import { defenseCatalog, defenseCombatStats, shipCatalog, shipCombatStats } from "../src/playableMvp";

describe("combat stat info controls", () => {
  test("renders ship battle stats behind an accessible info control", () => {
    const lightFighter = shipCatalog.find((ship) => ship.key === "lightFighter")!;
    const control = CombatStatsInfoButton({
      label: lightFighter.label,
      stats: shipCombatStats(lightFighter),
    });
    const text = visibleText(control);

    expect(control.type).toBe("details");
    expect(ariaLabels(control)).toContain("Open Light Fighter combat stats");
    expect(text).toContain("Battle stats");
    expect(text).toContain("Attack");
    expect(text).toContain("50");
    expect(text).toContain("Shield");
    expect(text).toContain("Hull");
    expect(text).toContain("400");
    expect(text).toContain("Cargo");
    expect(text).toContain("50");
  });

  test("renders defense and missile-specific battle notes", () => {
    const rocketLauncher = defenseCatalog.find((defense) => defense.key === "rocketLauncher")!;
    const interplanetaryMissile = defenseCatalog.find((defense) => defense.key === "interplanetaryMissile")!;

    expect(visibleText(CombatStatsInfoButton({
      label: rocketLauncher.label,
      stats: defenseCombatStats(rocketLauncher),
    }))).toContain("80");
    expect(visibleText(CombatStatsInfoButton({
      label: interplanetaryMissile.label,
      stats: defenseCombatStats(interplanetaryMissile),
    }))).toContain("Not counted");
  });

  test("formats large combat values for compact display", () => {
    expect(formatCombatStatValue(1_000_000)).toBe("1,000,000");
    expect(formatCombatStatValue("Not counted")).toBe("Not counted");
  });

  test("renders the battle stats popup as a viewport-positioned layer", () => {
    const lightFighter = shipCatalog.find((ship) => ship.key === "lightFighter")!;
    const control = CombatStatsInfoButton({
      label: lightFighter.label,
      stats: shipCombatStats(lightFighter),
    }) as VNode;
    const panel = findByProp(control, "data-combat-stats-panel", true);

    expect(typeof control.props?.onToggle).toBe("function");
    expect(panel?.props?.className).toContain("fixed");
    expect(panel?.props?.className).toContain("overflow-auto");
    expect(panel?.props?.style?.maxHeight).toContain("--combat-stats-panel-max-height");
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
  return textParts(vnode.props?.children as ComponentChildren);
}

function ariaLabels(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(ariaLabels);
  }

  const vnode = node as VNode;
  const label = vnode.props?.["aria-label"];
  return [
    ...(typeof label === "string" ? [label] : []),
    ...ariaLabels(vnode.props?.children as ComponentChildren),
  ];
}

function findByProp(node: ComponentChildren, propName: string, value: unknown): VNode | undefined {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return undefined;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByProp(child, propName, value);

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  const vnode = node as VNode;

  if (vnode.props?.[propName] === value) {
    return vnode;
  }

  return findByProp(vnode.props?.children as ComponentChildren, propName, value);
}
