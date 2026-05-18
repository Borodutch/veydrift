export type ImageLoadState = Pick<HTMLImageElement, "complete" | "naturalWidth">;

export function isImageReady(image: ImageLoadState | null | undefined): boolean {
  return Boolean(image?.complete && image.naturalWidth > 0);
}
