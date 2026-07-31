import type { ComponentChildren } from "preact";
import { Eye, EyeOff } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Coordinates, Planet } from "../types";
import { isImageReady } from "../imageLoadState";
import { OptimizedImage } from "./OptimizedImage";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";
import { PlanetMoonIndicator, PlanetMoonSubsection } from "./PlanetMoonIndicator";
import { AfkFlair } from "./AfkFlair";

export type PlanetMetaItem = {
  label: string;
  tone?: "default" | "warning" | "info";
};

export function WatchablePlanetRow({
  actionSlot,
  allianceLabel,
  commanderLabel,
  compact = false,
  coords,
  current,
  isHome = false,
  leadingSlot,
  meta,
  mobileIdentityInMeta = false,
  moonActionSlot,
  onInspect,
  onInspectMoon,
  onSelectAlliance,
  onSelectPlayer,
  onToggleWatch,
  planet,
  showIdentity = true,
  showMoonIndicator = true,
  watchBusy = false,
  watched = false,
}: {
  actionSlot?: ComponentChildren;
  allianceLabel: string;
  commanderLabel: string;
  compact?: boolean | undefined;
  coords: Coordinates;
  current?: boolean | undefined;
  isHome?: boolean | undefined;
  leadingSlot?: ComponentChildren;
  meta: PlanetMetaItem[];
  mobileIdentityInMeta?: boolean | undefined;
  moonActionSlot?: ComponentChildren;
  onInspect: (coords: Coordinates) => void;
  onInspectMoon?: ((coords: Coordinates) => void) | undefined;
  onSelectAlliance?: ((allianceId: string) => void) | undefined;
  onSelectPlayer?: ((wallet: string) => void) | undefined;
  onToggleWatch?: (() => void) | undefined;
  planet: Planet;
  showIdentity?: boolean | undefined;
  showMoonIndicator?: boolean | undefined;
  watchBusy?: boolean | undefined;
  watched?: boolean | undefined;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const canWatch = Boolean(onToggleWatch && !isHome && planet.occupiedBy?.planetId);
  const isHighlighted = current ?? isHome;

  useEffect(() => {
    setImageLoaded(isImageReady(imageRef.current));
  }, [planet.image]);

  const moonSubsection = planet.hasMoon ? (
    <PlanetMoonSubsection
      action={moonActionSlot}
      compact={compact}
      label={planet.moonName ?? "Moon"}
      onClick={onInspectMoon ? () => onInspectMoon(coords) : undefined}
      planetType={planet.type}
      title={`Open ${planet.moonName ?? "Moon"} at [${coords.galaxy}:${coords.system}:${coords.position}]`}
    />
  ) : null;

  return (
    <div
      className={`group grid w-full items-start rounded-md border text-left transition ${
        compact ? "min-h-0 gap-2 px-2 py-1.5" : "min-h-16 gap-3 px-3 py-2"
      } ${
        leadingSlot
          ? compact
            ? "grid-cols-[2rem_minmax(0,1fr)_auto] sm:grid-cols-[2.25rem_minmax(0,1fr)_8rem_auto]"
            : "grid-cols-[3rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_8rem_auto]"
          : showIdentity
            ? "grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            : "grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto]"
      } ${
        isHighlighted
          ? "border-emerald-300/40 bg-emerald-300/10 shadow-[0_0_18px_rgba(110,231,183,0.10)]"
          : "border-white/10 bg-white/[0.035] hover:border-signal/35 hover:bg-white/[0.06]"
      }`}
    >
      {leadingSlot ? <div className="self-start pt-0.5">{leadingSlot}</div> : null}
      <div className={`flex min-w-0 items-center ${compact ? "gap-2" : "gap-3"}`}>
        <button
          aria-label={`Open ${planet.name}`}
          className={`relative flex-shrink-0 overflow-hidden border bg-black/30 ${
            compact ? "h-9 w-9 rounded-full" : "h-11 w-11 rounded-md"
          } ${
            isHighlighted ? "border-emerald-300/35" : "border-white/15"
          }`}
          onClick={() => onInspect(coords)}
          type="button"
        >
          {!imageLoaded && <PlanetImageSkeleton className="absolute inset-0" />}
          <OptimizedImage
            key={planet.image}
            alt={planet.name}
            className={`h-full w-full object-cover transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
            imageRef={imageRef}
            loading="eager"
            onLoad={(event) => {
              if (isImageReady(event.currentTarget)) setImageLoaded(true);
            }}
            sizes="icon"
            src={planet.image}
          />
          {showMoonIndicator && planet.hasMoon ? <PlanetMoonIndicator compact planetType={planet.type} /> : null}
        </button>

        <div className="min-w-0">
          <button
            className="flex min-w-0 flex-wrap items-center gap-2 text-left"
            onClick={() => onInspect(coords)}
            type="button"
          >
            <span className="truncate text-sm font-semibold text-white group-hover:text-signal">
              {planet.name}
            </span>
            {isHome ? (
              <span className="rounded border border-cyan-300/35 bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">
                Home
              </span>
            ) : null}
            {meta.some((item) => item.label === "Inactive") ? <AfkFlair /> : null}
          </button>
          {meta.length > 0 ? (
            <div className={`mt-1 flex flex-wrap items-center text-slate-500 ${
              compact ? "gap-1.5 text-[11px] sm:gap-2 sm:text-xs" : "gap-2 text-xs"
            }`}>
              {mobileIdentityInMeta && showIdentity ? (
                <span className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap font-medium sm:hidden ${
                  isHighlighted ? "text-emerald-100" : "text-slate-500"
                }`}>
                  {planet.occupiedBy?.owner ? (
                    <button
                      className="max-w-24 truncate hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
                      disabled={!onSelectPlayer}
                      onClick={() => onSelectPlayer?.(planet.occupiedBy?.owner ?? "")}
                      title={`Open player ${commanderLabel}`}
                      type="button"
                    >
                      {commanderLabel}
                    </button>
                  ) : (
                    <span className="max-w-24 truncate">{commanderLabel}</span>
                  )}
                  {planet.alliance ? (
                    <>
                      <span className="text-slate-700">/</span>
                      <button
                        className="max-w-20 truncate text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
                        disabled={!onSelectAlliance}
                        onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
                        title={`Open ${allianceLabel}`}
                        type="button"
                      >
                        {allianceLabel}
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
              {meta.map((item, index) => (
                <span
                  className={`items-center whitespace-nowrap ${
                    mobileIdentityInMeta && index === 0 ? "hidden sm:inline-flex" : "inline-flex"
                  }`}
                  key={`${item.label}-${index}`}
                >
                  {index > 0 ? (
                    <span className={`${compact ? "mr-1.5 sm:mr-2" : "mr-2"} text-slate-700`}>/</span>
                  ) : null}
                  <span className={metaToneClass(item.tone)}>{item.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {showIdentity ? (
        <div className={`hidden min-w-32 justify-self-end text-right text-xs font-medium ${
          planet.alliance ? "self-start sm:block" : "self-stretch items-center justify-end sm:flex"
        } ${isHighlighted ? "text-emerald-100" : "text-slate-500"}`}>
          <div className="min-w-0">
            {planet.occupiedBy?.owner ? (
              <button
                className="break-words text-right hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
                disabled={!onSelectPlayer}
                onClick={() => onSelectPlayer?.(planet.occupiedBy?.owner ?? "")}
                title={`Open player ${commanderLabel}`}
                type="button"
              >
                {commanderLabel}
              </button>
            ) : (
              <span className="break-words">{commanderLabel}</span>
            )}
          </div>
          {planet.alliance ? (
            <button
              className="mt-1 text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
              disabled={!onSelectAlliance}
              onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
              title={`Open ${allianceLabel}`}
              type="button"
            >
              {allianceLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {canWatch || actionSlot ? (
        <div className={`flex min-w-0 ${
          compact && leadingSlot
            ? "col-start-3 row-start-1 self-center justify-end sm:col-start-4"
            : `col-span-full flex-wrap justify-end sm:col-span-1 ${compact ? "pt-0" : "pt-2"}`
        }`}>
          <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
            {canWatch ? (
              <button
                aria-pressed={watched}
                aria-label={watched ? "Unwatch planet" : "Watch planet"}
                className={`inline-flex h-10 w-10 items-center justify-center rounded border transition sm:h-8 sm:w-8 ${
                  watched
                    ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25"
                    : "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
                } disabled:cursor-wait disabled:opacity-60`}
                disabled={watchBusy}
                onClick={onToggleWatch}
                title={watched ? "Unwatch planet" : "Watch planet"}
                type="button"
              >
                {watched ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            ) : null}
            {/* No standalone Inspect button: the planet art + name block above is the inspect control. */}
            {actionSlot}
          </div>
        </div>
      ) : null}

      {moonSubsection ? (
        <div className="col-span-full min-w-0" data-watchable-moon-row="full-width">
          {moonSubsection}
        </div>
      ) : null}

      {showIdentity && !compact ? (
        <div className={`${leadingSlot ? "col-start-2" : "col-span-full"} min-w-0 text-xs font-medium sm:hidden`}>
          <div className={isHighlighted ? "text-emerald-100" : "text-slate-500"}>
            <span className="break-words">{commanderLabel}</span>
          </div>
          {planet.alliance ? (
            <button
              className="mt-1 max-w-full truncate text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-600"
              disabled={!onSelectAlliance}
              onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
              title={`Open ${allianceLabel}`}
              type="button"
            >
              {allianceLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function metaToneClass(tone: PlanetMetaItem["tone"]): string {
  if (tone === "warning") return "text-amber-200";
  if (tone === "info") return "text-cyan-200";
  return "text-slate-500";
}
