import type { JSX } from "preact";
import { getSrcSet, Sizes, type SizePreset } from "../utils/imageSizes";

interface OptimizedImageProps {
  /** Original full-size asset path (e.g. /assets/game/planets/lush-temperate.webp). */
  src: string;
  alt: string;
  className?: string;
  /**
   * CSS sizes descriptor for srcset selection. Can be a preset key
   * (e.g. "icon", "shipThumbnail") or a raw sizes string.
   */
  sizes: SizePreset | string;
  /** Intrinsic width of the original image (for layout stability). Defaults to 1024. */
  width?: number;
  /** Intrinsic height of the original image (for layout stability). Defaults to 1024. */
  height?: number;
  loading?: "eager" | "lazy";
}

/**
 * Responsive game asset image with srcset-based size selection.
 *
 * In development mode (vite dev) srcset is omitted so missing variant
 * files don’t trigger 404s. In production the browser receives the full
 * srcset and picks the smallest adequate candidate based on the `sizes`
 * descriptor and device pixel ratio.
 */
export function OptimizedImage({
  src,
  alt,
  className,
  sizes,
  width = 1024,
  height = 1024,
  loading,
}: OptimizedImageProps): JSX.Element {
  const isDev = import.meta.env.DEV;
  const sizesValue = sizes in Sizes ? Sizes[sizes as SizePreset] : sizes;

  return (
    <img
      alt={alt}
      className={className}
      height={height}
      loading={loading}
      sizes={isDev ? undefined : sizesValue}
      src={src}
      srcSet={isDev ? undefined : getSrcSet(src)}
      width={width}
    />
  );
}
