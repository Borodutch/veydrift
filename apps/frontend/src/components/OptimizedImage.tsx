import type { JSX, Ref } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { loopAnimationNameForStill, loopAnimationUrl, loopAnimationWidthFor } from "../../loopAnimationConfig";
import { getImageDimensions, getSizedImageSrc, getSrcSet, getStillVariantSrc, Sizes, type SizePreset } from "../utils/imageSizes";

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
  imageRef?: Ref<HTMLImageElement>;
  loading?: "eager" | "lazy";
  onLoad?: JSX.GenericEventHandler<HTMLImageElement>;
  style?: JSX.CSSProperties | undefined;
}

/**
 * Responsive game asset image with srcset-based size selection.
 *
 * In development mode (vite dev) srcset is omitted so missing variant
 * files don’t trigger 404s. In production the browser receives the full
 * srcset and picks the smallest adequate candidate based on the `sizes`
 * descriptor and device pixel ratio.
 *
 * A building/ship still that has a seamless loop plays it instead (see
 * LoopVideo); every other asset renders exactly this still.
 */
export function OptimizedImage(props: OptimizedImageProps): JSX.Element {
  const loop = loopAnimationNameForStill(props.src);
  const still = () => <StillImage {...props} />;
  if (!loop || !loopMotionAllowed()) return still();
  const dimensions = getImageDimensions(props.src);
  return (
    <LoopVideo
      alt={props.alt}
      className={props.className}
      height={props.height ?? dimensions?.height ?? 1024}
      loop={loop}
      onLoad={props.onLoad}
      src={props.src}
      still={still}
      style={props.style}
      width={props.width ?? dimensions?.width ?? 1024}
    />
  );
}

/** A plain game-asset <img> that plays its building/ship loop when one exists. */
export function AssetImage(props: {
  alt: string;
  className?: string;
  height?: number;
  loading?: "eager" | "lazy";
  sizes?: string;
  src: string;
  srcSet?: string;
  width?: number;
}): JSX.Element {
  const loop = loopAnimationNameForStill(props.src);
  const still = () => <img {...props} />;
  if (!loop || !loopMotionAllowed()) return still();
  return (
    <LoopVideo
      alt={props.alt}
      className={props.className}
      height={props.height}
      loop={loop}
      src={props.src}
      still={still}
      width={props.width}
    />
  );
}

function StillImage({
  src,
  alt,
  className,
  sizes,
  width,
  height,
  imageRef,
  loading,
  onLoad,
  style,
}: OptimizedImageProps): JSX.Element {
  const isDev = import.meta.env.DEV;
  const sizesValue = sizes in Sizes ? Sizes[sizes as SizePreset] : sizes;
  const dimensions = getImageDimensions(src);
  const intrinsicWidth = width ?? dimensions?.width ?? 1024;
  const intrinsicHeight = height ?? dimensions?.height ?? 1024;
  const fallbackSrc = getSizedImageSrc(src, 512);

  return (
    <img
      alt={alt}
      className={className}
      height={intrinsicHeight}
      loading={loading}
      onLoad={onLoad}
      {...(imageRef ? { ref: imageRef } : {})}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallbackApplied === "true") return;
        image.dataset.fallbackApplied = "true";
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
        image.src = fallbackSrc;
      }}
      sizes={isDev ? undefined : sizesValue}
      src={fallbackSrc}
      srcSet={isDev ? undefined : getSrcSet(src)}
      style={style}
      width={intrinsicWidth}
    />
  );
}

let reducedMotion: MediaQueryList | undefined;

// False outside a browser too, where the still is all that can render.
export function loopMotionAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function" || typeof window.matchMedia !== "function") return false;
  reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return !reducedMotion.matches;
}

/**
 * Muted inline loop with the existing still as its poster, in the same box as
 * the still. Nothing is fetched until it nears the viewport; the size variant
 * is then picked from its rendered width, and it plays only while visible.
 * Reduced motion, refused autoplay or an unplayable source keep the still.
 */
function LoopVideo({
  alt,
  className,
  height,
  loop,
  onLoad,
  src,
  still,
  style,
  width,
}: {
  alt: string;
  className?: string | undefined;
  height?: number | undefined;
  loop: string;
  onLoad?: JSX.GenericEventHandler<HTMLImageElement> | undefined;
  src: string;
  still: () => JSX.Element;
  style?: JSX.CSSProperties | undefined;
  width?: number | undefined;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showStill, setShowStill] = useState(() => !loopMotionAllowed());
  const [size, setSize] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (showStill || !video) return;
    const onMotionChange = () => {
      if (!loopMotionAllowed()) setShowStill(true);
    };
    reducedMotion?.addEventListener?.("change", onMotionChange);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const pixels = entry.boundingClientRect.width * (window.devicePixelRatio || 1);
      if (entry.isIntersecting && pixels > 0) setSize((current) => current ?? loopAnimationWidthFor(loop, pixels));
      setVisible(entry.isIntersecting);
    }, { rootMargin: "128px" });
    observer.observe(video);
    return () => {
      observer.disconnect();
      reducedMotion?.removeEventListener?.("change", onMotionChange);
    };
  }, [loop, showStill]);

  useEffect(() => {
    const video = videoRef.current;
    if (showStill || !video || size === null) return;
    if (!visible) {
      video.pause();
      return;
    }
    // Autoplay can be refused (e.g. iOS Low Power Mode). A pause() racing a
    // pending play() rejects with AbortError, which is not a refusal.
    video.play()?.catch((error: unknown) => {
      if ((error as { name?: unknown } | null)?.name !== "AbortError") setShowStill(true);
    });
  }, [showStill, size, visible]);

  if (showStill) return still();
  return (
    <video
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      autoPlay
      className={className}
      disablePictureInPicture
      height={height}
      loop
      muted
      onLoadedData={onLoad ? (event) => onLoad(event as never) : undefined}
      playsInline
      poster={size === null ? undefined : getStillVariantSrc(src, size)}
      preload="none"
      ref={videoRef}
      role={alt ? "img" : undefined}
      style={style}
      width={width}
    >
      {size === null ? null : (
        <>
          <source src={loopAnimationUrl(loop, "webm", size)} type='video/webm; codecs="vp9"' />
          <source onError={() => setShowStill(true)} src={loopAnimationUrl(loop, "mp4", size)} type="video/mp4" />
        </>
      )}
    </video>
  );
}
