export function planetAnimationResponse(url: URL): Promise<Response | null>;
export function loopAnimationResponse(url: URL, rangeHeader: string | null | undefined): Promise<Response | null>;
export function loopAnimationRoute(url: URL): { error: string; status: number } | { base: string; assetType: string; version: string; size: number; format: "webm" | "mp4"; masterWidth: number } | null;
export function hiddenWhitepaperPath(pathname: string): boolean;
export function frontendResponse(request: Request): Promise<Response>;
export function rangeResponseFor(file: Blob, pathname: string, rangeHeader: string | null | undefined, baseHeaders?: Record<string, string>): Response;
