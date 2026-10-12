export type AnimationVariant = { base: string; version: string; assetType: string; size: number; masterWidth: number };
export const animationVariants: AnimationVariant[];
export const animationRoot: string;
export const maxAnimationBytes: number;
export function animationKey(route: AnimationVariant): string;
export function animationFilename(route: AnimationVariant): string;
export function prepareAnimationVariants(options?: { root?: string; sourceRoot?: string; variants?: AnimationVariant[] }): Promise<{ variants: number; bytes: number }>;
export function assertAnimationVariantsReady(root?: string, variants?: AnimationVariant[]): Promise<{ variants: number; bytes: number }>;
export const animationConfigs: { base: string; types: readonly string[]; version: string; widths: readonly number[]; masterWidth: number }[];
