import { useEffect, useState } from "preact/hooks";
import type { Coordinates, Planet } from "../types";
import { formatPlanetType, planetsFromSystemResponse } from "../data/mockUniverse";
import { playableApiUrl } from "../runtimeConfig";
import { shortAddress } from "../walletFlow";
import { MoonImage } from "./PlanetMoonIndicator";
import { PlanetImageSkeleton } from "./PlanetImageSkeleton";

type PublicMoonDetailProps = {
  apiBaseUrl?: string | undefined;
  coords: Coordinates;
  onBack: () => void;
};

export function PublicMoonDetail({
  apiBaseUrl = playableApiUrl,
  coords,
  onBack,
}: PublicMoonDetailProps) {
  const [planet, setPlanet] = useState<Planet | null>(null);
  const [source, setSource] = useState<"api" | "error" | "loading">("loading");

  useEffect(() => {
    const abortController = new AbortController();
    setSource("loading");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/universe/galaxies/${coords.galaxy}/systems/${coords.system}`, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Universe request failed with ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const apiPlanet = planetsFromSystemResponse(payload).find((item) => item.position === coords.position) ?? null;
        setPlanet(apiPlanet);
        setSource("api");
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error(error);
          setSource("error");
        }
      });

    return () => abortController.abort();
  }, [apiBaseUrl, coords.galaxy, coords.position, coords.system]);

  const coordinateText = `[${coords.galaxy}:${coords.system}:${coords.position}]`;

  if (source === "loading" && !planet) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <button
          className="w-fit rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          ← Back
        </button>
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <PlanetImageSkeleton className="aspect-square rounded-lg border border-white/15" />
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-4 w-64 max-w-full animate-pulse rounded bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  if (!planet || !planet.hasMoon) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-slate-400">
          {source === "error" ? "Moon data could not be loaded." : `No moon in orbit at ${coordinateText}.`}
        </p>
        <button
          className="rounded border border-white/15 bg-white/8 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          onClick={onBack}
          type="button"
        >
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <button
        className="w-fit rounded border border-white/15 bg-white/8 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
        onClick={onBack}
        type="button"
      >
        ← System {coordinateText}
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
        <div className="aspect-square overflow-hidden rounded-lg border border-cyan-200/20 bg-black/40">
          <MoonImage
            alt={planet.moonName ?? "Moon"}
            className="h-full w-full object-cover"
            loading="eager"
            planetType={planet.type}
            sizes="planetPreview"
          />
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h2 className="text-xl font-semibold text-white">{planet.moonName ?? "Moon"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>Moon orbiting {planet.name}</span>
              <span className="text-slate-700">|</span>
              <span>{coordinateText}</span>
              <span className="text-slate-700">|</span>
              <span>{formatPlanetType(planet.type)} parent</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MoonRecordPanel title="Public Owner" rows={[
              { label: "Player", value: planet.occupiedBy?.ownerDisplayName ?? (planet.ownerId ? shortAddress(planet.ownerId) : "Unknown") },
              { label: "Planet", value: planet.name },
              { label: "Planet ID", value: planet.occupiedBy?.planetId ? `#${planet.occupiedBy.planetId}` : "Unknown" },
            ]} />
            <MoonRecordPanel title="Moon Resources" rows={moonResourceRows(planet)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MoonRecordPanel({
  rows,
  title,
}: {
  rows: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div className="flex items-baseline justify-between gap-3 text-sm" key={row.label}>
            <span className="text-slate-500">{row.label}</span>
            <span className="min-w-0 truncate text-right font-mono text-slate-200">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function moonResourceRows(planet: Planet): Array<{ label: string; value: string }> {
  const resources = planet.publicMoonState?.resources;
  if (!resources) {
    return [
      { label: "Metal", value: "Unknown" },
      { label: "Crystal", value: "Unknown" },
      { label: "Deuterium", value: "Unknown" },
    ];
  }
  return [
    { label: "Metal", value: resourceValue(resources.metal) },
    { label: "Crystal", value: resourceValue(resources.crystal) },
    { label: "Deuterium", value: resourceValue(resources.deuterium) },
  ];
}

function resourceValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "0";
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed).toLocaleString("en-US") : value;
  }
}
