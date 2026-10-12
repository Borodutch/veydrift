export type MediaManifest = { baseUrl: string; files: Record<string, { sha256: string; bytes: number }> };
export const mediaManifestPath: string;
export const mediaRoot: string;
export const mediaManifest: MediaManifest;
export function mediaFileForPathname(pathname: string, options?: { root?: string; manifest?: MediaManifest }): string | null;
export function hashFile(path: string): Promise<string>;
export function syncMedia(options?: {
  root?: string;
  manifest?: MediaManifest;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}): Promise<{ files: number; downloaded: number; downloadedBytes: number }>;
export function publishMedia(options?: { root?: string; stage?: string }): Promise<{ files: number; stage: string }>;
