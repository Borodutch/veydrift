import type { LoopAnimation, LoopAnimationFormat } from "../loopAnimationConfig";

export type AnimationVariant = {
  base: string; version: string; assetType: string; size: number; masterWidth: number;
  format?: LoopAnimationFormat; frames?: number; fps?: number;
};
export const imageAnimationVariants: AnimationVariant[];
export const animationVariants: AnimationVariant[];
export const animationRoot: string;
export const maxAnimationBytes: number;
export const loopEncoding: Record<LoopAnimationFormat, string[]>;
export function loopAnimationVariants(loops?: Readonly<Record<string, LoopAnimation>>): AnimationVariant[];
export function probeVideo(path: string): Promise<{ width: number; height: number; frames: number; fps: number; duration: number }>;
export function describeLoopMasters(source?: string, stillRoot?: URL): Promise<Record<string, LoopAnimation>>;
export function animationKey(route: AnimationVariant): string;
export function animationFilename(route: AnimationVariant): string;
export function prepareAnimationVariants(options?: { root?: string; sourceRoot?: string; variants?: AnimationVariant[] }): Promise<{ variants: number; bytes: number }>;
export function assertAnimationVariantsReady(root?: string, variants?: AnimationVariant[]): Promise<{ variants: number; bytes: number }>;
export const animationConfigs: { base: string; types: readonly string[]; version: string; widths: readonly number[]; masterWidth: number }[];
