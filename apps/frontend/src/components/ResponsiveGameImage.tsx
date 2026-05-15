import type { JSX } from "preact";
import { gameImageSrcSet, gameThumbnailSrc, type GameImageWidth } from "../gameImageAssets";

type ResponsiveGameImageProps = Omit<JSX.IntrinsicElements["img"], "sizes" | "src" | "srcSet"> & {
  sizes: string;
  src: string;
  widths: readonly GameImageWidth[];
};

export function ResponsiveGameImage({
  sizes,
  src,
  widths,
  ...props
}: ResponsiveGameImageProps) {
  const srcSet = gameImageSrcSet(src, widths);
  const fallbackWidth = widths[widths.length - 1];
  const fallbackSrc = fallbackWidth ? gameThumbnailSrc(src, fallbackWidth) : src;

  return (
    <img
      {...props}
      sizes={srcSet ? sizes : undefined}
      src={fallbackSrc}
      srcSet={srcSet}
    />
  );
}
