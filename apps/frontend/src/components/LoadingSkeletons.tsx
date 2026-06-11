import type { JSX } from "preact";
import { Skeleton, SkeletonRegion, skeletonList } from "./Skeleton";

const CARD = "rounded-md border border-white/10 bg-[#101624] p-4";

/** A catalog tile placeholder: square thumbnail above two short text lines. */
function CatalogTileSkeleton(): JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-[#101624] p-2">
      <Skeleton className="aspect-square w-full rounded" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
      <div className="mt-1 flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/** Detail panel placeholder: hero image, title, a few stat rows, an action bar. */
function DetailPanelSkeleton(): JSX.Element {
  return (
    <div className={CARD}>
      <Skeleton className="aspect-[16/9] w-full rounded" />
      <Skeleton className="mt-3 h-5 w-1/2" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
      <div className="mt-4 grid gap-2">
        {skeletonList(4, (index) => (
          <div className="flex items-center justify-between gap-3" key={index}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-9 w-full rounded" />
    </div>
  );
}

/**
 * Two-column "catalog + detail" skeleton used by the inspect-style production
 * pages (Research, Shipyard, Defenses). Mirrors `InspectTwoColumnLayout`.
 */
export function CatalogSkeleton({ label, tiles = 9 }: { label: string; tiles?: number | undefined }): JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:items-start">
        <div className="order-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:order-1 xl:grid-cols-3 2xl:grid-cols-4">
          {skeletonList(tiles, (index) => <CatalogTileSkeleton key={index} />)}
        </div>
        <div className="order-1 xl:order-2">
          <DetailPanelSkeleton />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Moon page skeleton: metrics row, structures grid, jump-gate controls. */
export function MoonSkeleton(): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-4" label="Loading moon state">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-3">
          {skeletonList(3, (index) => (
            <div className="flex items-center gap-3 rounded border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-9 w-9 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="mt-2 h-3.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className={CARD}>
        <Skeleton className="h-4 w-40" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {skeletonList(3, (index) => (
            <div className="rounded border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-2 h-3 w-32" />
              <Skeleton className="mt-3 h-8 w-full rounded" />
            </div>
          ))}
        </div>
      </section>
    </SkeletonRegion>
  );
}

/**
 * Rankings rows skeleton. Rendered inside the existing rankings table shell
 * (header already present), so this only supplies the row placeholders.
 */
export function RankingsRowsSkeleton({ rows = 8 }: { rows?: number | undefined }): JSX.Element {
  return (
    <SkeletonRegion label="Loading rankings">
      <div className="divide-y divide-white/5">
        {skeletonList(rows, (index) => (
          <div className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-2 px-2 py-3 sm:grid-cols-[72px_minmax(0,1fr)_120px] sm:px-3" key={index}>
            <Skeleton className="h-4 w-6" />
            <div className="min-w-0">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
            <Skeleton className="hidden h-4 w-16 justify-self-end sm:block" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Mission Control skeleton: section heading plus a few mission-row cards. */
export function MissionControlSkeleton(): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-3" label="Loading missions">
      <Skeleton className="h-4 w-44" />
      {skeletonList(3, (index) => (
        <div className={CARD} key={index}>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-2/3" />
          <Skeleton className="mt-2 h-3.5 w-1/3" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Galaxy slot rows skeleton. Rendered inside the existing galaxy grid shell. */
export function GalaxyRowsSkeleton({ rows = 8 }: { rows?: number | undefined }): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-1.5" label="Mapping galaxy">
      {skeletonList(rows, (index) => (
        <div className="flex items-center gap-3 rounded border border-white/10 bg-[#101624] px-3 py-2.5" key={index}>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="mt-1.5 h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3.5 w-16 sm:block" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Rift skeleton: three resource-bridge columns plus a withdrawal-queue strip. */
export function RiftSkeleton(): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-4" label="Loading Rift state">
      <div className="grid gap-3 md:grid-cols-3">
        {skeletonList(3, (index) => (
          <article className="rounded-lg border border-white/10 bg-[#101624] p-4" key={index}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-1.5 h-3 w-20" />
              </div>
              <Skeleton className="h-6 w-16 rounded" />
            </div>
            <div className="mt-4 grid gap-2">
              {skeletonList(4, (rowIndex) => (
                <div className="flex items-center justify-between gap-3" key={rowIndex}>
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-14" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-4 h-9 w-full rounded" />
            <Skeleton className="mt-2 h-9 w-full rounded" />
          </article>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Alliance page skeleton: a header panel plus a directory list. */
export function AllianceSkeleton(): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-4" label="Loading alliance data">
      <section className={CARD}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-3.5 w-3/4" />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {skeletonList(3, (index) => (
            <div className="rounded border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-2 h-4 w-12" />
            </div>
          ))}
        </div>
      </section>
      <section className={CARD}>
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 grid gap-2">
          {skeletonList(4, (index) => (
            <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </section>
    </SkeletonRegion>
  );
}

/** Generic single-panel skeleton for inspect overlays (player / alliance). */
export function InspectPanelSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-4" label={label}>
      <section className={CARD}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-2 h-3.5 w-32" />
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {skeletonList(4, (index) => (
            <div className="rounded border border-white/10 bg-black/15 p-3" key={index}>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>
      </section>
    </SkeletonRegion>
  );
}

/** Raid target list skeleton, shown while a scan is in flight. */
export function RaidTargetsSkeleton(): JSX.Element {
  return (
    <SkeletonRegion className="grid gap-2" label="Scanning for raid targets">
      {skeletonList(4, (index) => (
        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-[#101624] p-3" key={index}>
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-20 rounded" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
