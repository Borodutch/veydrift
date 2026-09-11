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
  MoonDetailSkeleton,
  PlanetDetailSkeleton,
  ProductionCatalogSkeleton,
  RaidTargetsSkeleton,
  RankingsRowsSkeleton,
  RiftSkeleton,
  PageLoadingSkeleton,
  OverviewSkeleton,
  MissionControlPageSkeleton,
  MissionCreationSkeleton,
  MissionDetailSkeleton,
  ShipyardSkeleton,
  DefenseSkeleton,
  RankingsSkeleton,
  InviteSkeleton,
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

describe("Route loading layouts", () => {
  test.each([
    ["overview", OverviewSkeleton],
    ["infrastructure", CatalogSkeleton],
    ["research", CatalogSkeleton],
    ["shipyard", ShipyardSkeleton],
    ["defenses", DefenseSkeleton],
    ["mission-control", MissionControlPageSkeleton],
    ["mission-create", MissionCreationSkeleton],
    ["mission-detail", MissionDetailSkeleton],
    ["battle-reports", MissionControlSkeleton],
    ["moon", MoonSkeleton],
    ["planet", PlanetDetailSkeleton],
    ["moon-inspect", MoonDetailSkeleton],
    ["alliance", AllianceSkeleton],
    ["alliance-invites", InviteSkeleton],
    ["alliance-inspect", InspectPanelSkeleton],
    ["player-inspect", InspectPanelSkeleton],
    ["rankings", RankingsSkeleton],
    ["rift", RiftSkeleton],
    ["galaxy", GalaxyRowsSkeleton],
    ["raid-target-finder", RaidTargetsSkeleton],
  ] as const)("%s uses its page layout and accessible loading status", (page, component) => {
    const skeleton = PageLoadingSkeleton({ page });
    expect(skeleton.type).toBe(component);
    expect(roles(skeleton)).toContain("status");
  });

  test("lazy loading is confined to content, with its fallback supplied by the route", () => {
    const boundary = readFileSync(new URL("../src/components/PageContent.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../src/PlayableMvpApp.tsx", import.meta.url), "utf8");
    expect(boundary).toContain("<Suspense fallback={fallback}>");
    expect(boundary).not.toContain("PlanetDetailSkeleton");
    expect(shell.indexOf("<PageContent")).toBeGreaterThan(shell.indexOf("<main"));
    expect(shell.indexOf("</PageContent>")).toBeLessThan(shell.indexOf("</main>"));
  });
});

const skeletons: Array<{ name: string; node: ComponentChildren }> = [
  { name: "CatalogSkeleton", node: CatalogSkeleton({ label: "Loading research" }) },
  {
    name: "ProductionCatalogSkeleton",
    node: ProductionCatalogSkeleton({ groups: [2, 4, 2, 2], label: "Loading defenses" }),
  },
  { name: "MoonSkeleton", node: MoonSkeleton({}) },
  { name: "MoonDetailSkeleton", node: MoonDetailSkeleton({}) },
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
    "PublicMoonDetail.tsx",
    "PlanetDetail.tsx",
    "ShipyardPage.tsx",
    "DefensePage.tsx",
    "ResearchPage.tsx",
    "MissionControlPage.tsx",
    "MissionDetailPage.tsx",
    "BattleReportsPage.tsx",
    "GalaxyView.tsx",
    "AlliancePage.tsx",
    "RankingsTable.tsx",
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

  test("no page uses the removed text-and-spinner loader", () => {
    for (const page of pages) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/components/${page}`, import.meta.url)),
        "utf8",
      );
      expect(source).not.toContain("VeydriftLoader");
      expect(source).not.toContain("InlineSyncIndicator");
    }
  });

  test("data-loading surfaces reuse skeletons and the old spinner styles are gone", async () => {
    for (const file of ["components/TopBar", "components/BatchSupplyModal", "components/PageHeader", "ComingSoonApp", "FirstPlanetSettlementApp"]) {
      const source = await Bun.file(new URL(`../src/${file}.tsx`, import.meta.url)).text();
      expect(source).toContain("Skeleton");
      expect(source).not.toContain("animate-spin");
    }
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    expect(css).not.toContain("veydrift-loader");
    expect(css).toContain("prefers-reduced-motion: reduce");
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

  test("alliance loading mirrors the directory header and ranked row footprint", () => {
    const skeleton = AllianceSkeleton({});
    const classes = classNames(skeleton).join(" ");

    expect(classes).toContain("md:grid-cols-[2.25rem_minmax(0,1fr)_auto]");
    expect(classes).toContain("h-7 w-20");
    expect(classes).toContain("h-8 w-8");
    expect(classes).toContain("h-10 w-20");
    expect(classes).toContain("h-10 w-28");
    expect(classes).not.toContain("sm:grid-cols-3");
  });
});
