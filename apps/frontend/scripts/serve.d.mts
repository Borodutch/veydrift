export function planetAnimationResponse(url: URL): Promise<Response | null>;
export function hiddenWhitepaperPath(pathname: string): boolean;
export function frontendResponse(request: Request): Promise<Response>;
export const pactMeta: { title: string; description: string; imagePath: string };
export function rangeResponseFor(file: Blob, pathname: string, rangeHeader: string | null | undefined): Response;
