import { Fragment, type ComponentChildren } from "preact";
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
  coords,
  current,
  isHome = false,
  leadingSlot,
  meta,
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
  coords: Coordinates;
  current?: boolean | undefined;
  isHome?: boolean | undefined;
  leadingSlot?: ComponentChildren;
  meta: PlanetMetaItem[];
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

  return (
    <div
      className={`group grid min-h-16 w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
        leadingSlot
          ? "grid-cols-[3rem_minmax(0,1fr)_auto] sm:grid-cols-[4rem_minmax(0,1fr)_8rem_auto]"
          : showIdentity
            ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]"
      } ${
        isHighlighted
          ? "border-emerald-300/40 bg-emerald-300/10 shadow-[0_0_18px_rgba(110,231,183,0.10)]"
          : "border-white/10 bg-white/[0.035] hover:border-signal/35 hover:bg-white/[0.06]"
      }`}
    >
      {leadingSlot ? <div className="self-start pt-0.5">{leadingSlot}</div> : null}
      <div className="min-w-0">
        <button
          className="flex min-w-0 items-center gap-3 text-left"
          onClick={() => onInspect(coords)}
          type="button"
        >
          <div className={`relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-md border bg-black/30 ${
            isHighlighted ? "border-emerald-300/35" : "border-white/15"
          }`}>
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
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-white group-hover:text-signal">
                {planet.name}
              </span>
              {isHome ? (
                <span className="rounded border border-cyan-300/35 bg-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-100">
                  Home
                </span>
              ) : null}
              {meta.some((item) => item.label === "Inactive") ? <AfkFlair /> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {meta.map((item, index) => (
                <Fragment key={`${item.label}-${index}`}>
                  {index > 0 ? <span className="text-slate-700">/</span> : null}
                  <span className={metaToneClass(item.tone)}>{item.label}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </button>
        {planet.hasMoon ? (
          <PlanetMoonSubsection
            action={moonActionSlot}
            label={planet.moonName ?? "Moon"}
            onClick={moonActionSlot ? undefined : onInspectMoon ? () => onInspectMoon(coords) : undefined}
            planetType={planet.type}
            title={`Open ${planet.moonName ?? "Moon"} at [${coords.galaxy}:${coords.system}:${coords.position}]`}
          />
        ) : null}
      </div>

      {showIdentity ? (
        <div className={`hidden min-w-32 justify-self-end text-right text-xs font-medium sm:block ${isHighlighted ? "text-emerald-100" : "text-slate-500"}`}>
          <div className="min-w-0">
            {planet.occupiedBy?.owner ? (
              <button
                className="break-words text-right hover:text-cyan-100 hover:underline disabled:cursor-not-allowed disabled:text-slate-600"
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
              className="mt-1 text-cyan-200 underline-offset-2 hover:text-cyan-100 hover:underline disabled:cursor-not-allowed disabled:text-slate-600"
              disabled={!onSelectAlliance}
              onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
              title={`Open ${allianceLabel}`}
              type="button"
            >
              {allianceLabel}
            </button>
          ) : (
            <div className="mt-1 text-slate-600">{allianceLabel}</div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-1.5 pt-2">
        {canWatch ? (
          <button
            aria-pressed={watched}
            aria-label={watched ? "Unwatch planet" : "Watch planet"}
            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition ${
              watched
                ? "border-cyan-300/35 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25"
                : "border-white/15 bg-white/5 text-slate-400 hover:border-cyan-300/30 hover:text-cyan-100"
            } disabled:cursor-wait disabled:opacity-60`}
            disabled={watchBusy}
            onClick={onToggleWatch}
            title={watched ? "Unwatch planet" : "Watch planet"}
            type="button"
          >
            {watched ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        ) : null}
        <button
          className="rounded border border-signal/25 px-2 py-1 text-xs font-medium text-signal hover:bg-signal/10"
          onClick={() => onInspect(coords)}
          type="button"
        >
          Inspect
        </button>
        {actionSlot}
      </div>

      {showIdentity ? (
        <div className={`${leadingSlot ? "col-span-2 col-start-2" : "col-span-2"} min-w-0 text-xs font-medium sm:hidden`}>
          <div className={isHighlighted ? "text-emerald-100" : "text-slate-500"}>
            <span className="break-words">{commanderLabel}</span>
          </div>
          {planet.alliance ? (
            <button
              className="mt-1 max-w-full truncate text-cyan-200 underline-offset-2 hover:text-cyan-100 hover:underline disabled:cursor-not-allowed disabled:text-slate-600"
              disabled={!onSelectAlliance}
              onClick={() => onSelectAlliance?.(planet.alliance?.allianceId ?? "")}
              title={`Open ${allianceLabel}`}
              type="button"
            >
              {allianceLabel}
            </button>
          ) : (
            <div className="mt-1 text-slate-600">{allianceLabel}</div>
          )}
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
