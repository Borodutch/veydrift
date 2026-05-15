const GAME_ASSET_PREFIX = "/assets/game/";

export type GameImageWidth = 96 | 160 | 320 | 640;

export function gameThumbnailSrc(src: string, width: GameImageWidth): string {
  if (!canUseGameThumbnail(src)) return src;
  return src.replace(GAME_ASSET_PREFIX, `${GAME_ASSET_PREFIX}thumbnails/w${width}/`);
}

export function gameImageSrcSet(src: string, widths: readonly GameImageWidth[]): string | undefined {
  if (!canUseGameThumbnail(src)) return undefined;
  return widths.map((width) => `${gameThumbnailSrc(src, width)} ${width}w`).join(", ");
}

function canUseGameThumbnail(src: string): boolean {
  return src.startsWith(GAME_ASSET_PREFIX) && !src.startsWith(`${GAME_ASSET_PREFIX}thumbnails/`);
}
