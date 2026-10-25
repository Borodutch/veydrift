import loops from "./loopAnimations.json" with { type: "json" };

// Seamless building/ship loops, delivered as precomputed WebM (VP9) with an MP4
// (H.264) fallback. loopAnimations.json is written by `bun scripts/media.mjs
// publish` from the masters in .media-src/<LOOP_ANIMATION_MASTER_BASE>/<name>.mp4,
// where <name> is the still's path under LOOP_ANIMATION_STILL_BASE without
// ".webp" (e.g. "ships/cruiser"). Each version is derived from the master bytes
// and the encoder settings, so a new or redone master needs no code change.
export type LoopAnimation = { version: string; width: number; frames: number; fps: number };
export type LoopAnimationFormat = "webm" | "mp4";

export const LOOP_ANIMATION_BASE = "/assets/game/loops";
export const LOOP_ANIMATION_STILL_BASE = "/assets/game/style-pass/generated";
export const LOOP_ANIMATION_MASTER_BASE = "assets/game/loop-masters";
export const LOOP_ANIMATION_WIDTHS = [64, 128, 256, 512] as const;
export const LOOP_ANIMATION_FORMATS = ["webm", "mp4"] as const satisfies readonly LoopAnimationFormat[];
export const LOOP_ANIMATIONS: Readonly<Record<string, LoopAnimation>> = loops;

// Production renders byte-identical stills for these items, so they share a loop.
export const LOOP_ANIMATION_ALIASES: Readonly<Record<string, string>> = {
  "buildings/alliance-depot-mid": "buildings/research-lab-mid",
  "buildings/nanite-factory-mid": "buildings/robotics-factory-mid",
  "buildings/terraformer-mid": "buildings/deuterium-tank-mid",
};

const hasLoop = (name: string) => Object.prototype.hasOwnProperty.call(LOOP_ANIMATIONS, name);

/** Served widths for a loop: never larger than its master. */
export function loopAnimationWidths(loop: Pick<LoopAnimation, "width">): number[] {
  return LOOP_ANIMATION_WIDTHS.filter((width) => width <= loop.width);
}

export function loopAnimationNameForStill(src: string): string | undefined {
  if (!src.startsWith(`${LOOP_ANIMATION_STILL_BASE}/`) || !src.endsWith(".webp")) return undefined;
  const still = src.slice(LOOP_ANIMATION_STILL_BASE.length + 1, -".webp".length);
  const name = LOOP_ANIMATION_ALIASES[still] ?? still;
  return hasLoop(name) ? name : undefined;
}

/** Smallest served width covering `pixels` device pixels (the largest one otherwise). */
export function loopAnimationWidthFor(name: string, pixels: number): number {
  const widths = loopAnimationWidths(LOOP_ANIMATIONS[name]!);
  return widths.find((width) => width >= pixels) ?? widths[widths.length - 1]!;
}

export function loopAnimationUrl(name: string, format: LoopAnimationFormat, size: number): string {
  const loop = hasLoop(name) ? LOOP_ANIMATIONS[name]! : undefined;
  if (!loop) throw new Error(`Unknown loop animation: ${name}`);
  if (!loopAnimationWidths(loop).includes(size)) throw new Error(`Unsupported loop animation width: ${size}`);
  return `${LOOP_ANIMATION_BASE}/${name}.${format}?size=${size}&v=${loop.version}`;
}
