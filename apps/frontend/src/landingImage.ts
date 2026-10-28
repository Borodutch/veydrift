import { getImageDimensions, getSrcSet } from "./utils/imageSizes";

// A lighter candidate for the art a phone draws largest at the top of the landing (the CD disc, its LCP image).
const lighter: Record<string, string> = {
  "/assets/game/style-pass/generated/planets/crystal-violet.webp": "/assets/landing/crystal-violet-480.webp 480w",
};

/**
 * Props for a landing-page <img>. The art is drawn far smaller than its originals (1024 px game art, 1440 px
 * screenshots), so the browser gets a srcset to pick a small variant from, and width/height keep the layout
 * still while it loads. `sizes` is the width the image is drawn at.
 */
export function landingImage(src: string, sizes: string) {
  const screenshot = src.match(/^(\/assets\/landing\/qa-screens\/[\w-]+)\.jpg$/);
  if (screenshot) {
    return { src, srcSet: `${screenshot[1]}-480.webp 480w, ${screenshot[1]}-960.webp 960w, ${src} 1440w`, sizes, width: 1440, height: 1040, decoding: "async" as const };
  }
  const size = getImageDimensions(src);
  return { src, srcSet: [lighter[src], getSrcSet(src)].filter(Boolean).join(", "), sizes, width: size?.width, height: size?.height, decoding: "async" as const };
}
