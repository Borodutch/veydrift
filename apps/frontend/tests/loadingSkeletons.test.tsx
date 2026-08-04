import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ComponentChildren, VNode } from "preact";
import {
  AllianceSkeleton,
  CatalogSkeleton,
  GalaxyRowsSkeleton,
  InspectPanelSkeleton,
  MissionControlSkeleton,
  MoonSkeleton,
  PlanetDetailSkeleton,
  ProductionCatalogSkeleton,
  RaidTargetsSkeleton,
  RankingsRowsSkeleton,
  RiftSkeleton,
} from "../src/components/LoadingSkeletons";
import { Skeleton, SkeletonRegion } from "../src/components/Skeleton";
import { EntityMediaPanelSkeleton } from "../src/components/EntityMediaPanel";

function classNames(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(classNames);
  }
  const vnode = node as VNode;
  const own: string[] = [];
  const props = (vnode.props ?? {}) as Record<string, unknown>;
  if (typeof vnode.type === "function") {
    return classNames((vnode.type as (props: Record<string, unknown>) => ComponentChildren)(props));
  }
  if (typeof props.className === "string") {
    own.push(props.className);
  }
  return [...own, ...classNames(props.children as ComponentChildren)];
}

function roles(node: ComponentChildren): string[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(roles);
  }
  const vnode = node as VNode;
  const props = (vnode.props ?? {}) as Record<string, unknown>;
  if (typeof vnode.type === "function") {
    return roles((vnode.type as (props: Record<string, unknown>) => ComponentChildren)(props));
  }
  const own = typeof props.role === "string" ? [props.role] : [];
  return [...own, ...roles(props.children as ComponentChildren)];
}

describe("Skeleton primitives", () => {
  test("base Skeleton block carries the shimmer (animate-pulse) and skeleton classes", () => {
    const classes = classNames(Skeleton({ className: "h-4 w-10" })).join(" ");
    expect(classes).toContain("animate-pulse");
    expect(classes).toContain("skeleton");
  });

  test("SkeletonRegion announces loading via role=status and a visually-hidden label", () => {
    const region = SkeletonRegion({ label: "Loading widgets", children: Skeleton({}) });
    expect(roles(region)).toContain("status");
    const classes = classNames(region).join(" ");
    expect(classes).toContain("sr-only");
  });
});

const skeletons: Array<{ name: string; node: ComponentChildren }> = [
  { name: "CatalogSkeleton", node: CatalogSkeleton({ label: "Loading research" }) },
  {
    name: "ProductionCatalogSkeleton",
    node: ProductionCatalogSkeleton({ groups: [2, 4, 2, 2], label: "Loading defenses" }),
  },
  { name: "MoonSkeleton", node: MoonSkeleton({}) },
  { name: "PlanetDetailSkeleton", node: PlanetDetailSkeleton({}) },
  { name: "EntityMediaPanelSkeleton", node: EntityMediaPanelSkeleton({ canEdit: true, heading: "Planet anthem" }) },
  { name: "RankingsRowsSkeleton", node: RankingsRowsSkeleton({}) },
  { name: "MissionControlSkeleton", node: MissionControlSkeleton({}) },
  { name: "GalaxyRowsSkeleton", node: GalaxyRowsSkeleton({}) },
  { name: "RiftSkeleton", node: RiftSkeleton({}) },
  { name: "AllianceSkeleton", node: AllianceSkeleton({}) },
  { name: "InspectPanelSkeleton", node: InspectPanelSkeleton({ label: "Loading player" }) },
  { name: "RaidTargetsSkeleton", node: RaidTargetsSkeleton({}) },
];

describe("Page loading skeletons", () => {
  for (const { name, node } of skeletons) {
    test(`${name} renders animated skeleton blocks inside a status region`, () => {
      expect(roles(node)).toContain("status");
      const animated = classNames(node).filter((c) => c.includes("animate-pulse") && c.includes("skeleton"));
      expect(animated.length).toBeGreaterThan(0);
    });
  }
});

describe("Pages render skeleton loaders, not text loaders, during initial load", () => {
  // Every page that previously showed a full-section text loader must now wire
  // in a LoadingSkeletons component so a hard refresh shows skeletons.
  const pages = [
    "MoonPage.tsx",
    "PlanetDetail.tsx",
    "ShipyardPage.tsx",
    "DefensePage.tsx",
    "ResearchPage.tsx",
    "MissionControlPage.tsx",
    "GalaxyView.tsx",
    "AlliancePage.tsx",
    "RankingsPage.tsx",
    "InspectPages.tsx",
    "RaidTargetFinderPage.tsx",
  ];

  for (const page of pages) {
    test(`${page} imports a loading skeleton`, () => {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/components/${page}`, import.meta.url)),
        "utf8",
      );
      expect(source).toContain('from "./LoadingSkeletons"');
    });
  }

  test("no page uses a full-section VeydriftLoader (text loader) for initial load", () => {
    for (const page of pages) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/components/${page}`, import.meta.url)),
        "utf8",
      );
      // Inline refresh indicators (variant="inline") are allowed; a bare
      // section-variant <VeydriftLoader label=...> initial loader is not.
      const sectionLoader = /<VeydriftLoader\s+label=(?:(?!variant)[^>])*\/>/.test(source);
      expect({ page, sectionLoader }).toEqual({ page, sectionLoader: false });
    }
  });

  test("production pages use the grouped row and featured-card skeleton", () => {
    const skeleton = ProductionCatalogSkeleton({
      groups: [4, 8, 3],
      label: "Loading shipyard",
    });
    const classes = classNames(skeleton).join(" ");

    expect(classes).toContain("grid-cols-[44px_minmax(0,1fr)]");
    expect(classes).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]");
    expect(classes).toContain("xl:aspect-[4/3]");
    expect(classes).toContain("border-cyan-300/20");
  });
});
