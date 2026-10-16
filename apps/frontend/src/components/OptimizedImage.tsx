import type { JSX, Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
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
  // Mounted under reduced motion too: LoopVideo follows the preference live.
  if (!loop || !loopsSupported()) return still();
  const dimensions = getImageDimensions(props.src);
  return (
    // Keyed by asset: a <source> swapped in place would keep playing the old loop.
    <LoopVideo
      alt={props.alt}
      className={props.className}
      height={props.height ?? dimensions?.height ?? 1024}
      imageRef={props.imageRef}
      key={props.src}
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
  if (!loop || !loopsSupported()) return still();
  return (
    <LoopVideo
      alt={props.alt}
      className={props.className}
      height={props.height}
      key={props.src}
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
// Loops within this many CSS px of the viewport are sized and fetched.
const NEAR_VIEWPORT = 128;

// Sets a ref as Preact would; with `onlyIf`, an object ref that already points elsewhere is left alone.
function assignRef<T>(ref: Ref<T> | undefined, value: T | null, onlyIf?: T): void {
  if (typeof ref === "function") ref(value);
  else if (ref && (onlyIf === undefined || ref.current === onlyIf)) ref.current = value;
}

// Outside a browser the still is all that can render.
function loopsSupported(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function" && typeof window.matchMedia === "function";
}

export function loopMotionAllowed(): boolean {
  if (!loopsSupported()) return false;
  reducedMotion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return !reducedMotion.matches;
}

/**
 * Muted inline loop with the existing still as its poster, in the same box as
 * the still. Nothing is fetched until it nears the viewport; the size variant
 * is then picked from its rendered width (and only ever grows), and its
 * decoder is released again when it leaves. Reduced motion (followed live, in
 * both directions), refused autoplay or a failing source/decode keep the still.
 */
function LoopVideo({
  alt,
  className,
  height,
  imageRef,
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
  imageRef?: Ref<HTMLImageElement> | undefined;
  loop: string;
  onLoad?: JSX.GenericEventHandler<HTMLImageElement> | undefined;
  src: string;
  still: () => JSX.Element;
  style?: JSX.CSSProperties | undefined;
  width?: number | undefined;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attachedSize = useRef<number | null>(null);
  const probe = useRef<{ image: HTMLImageElement; url: string } | null>(null);
  const [reduced, setReduced] = useState(() => !loopMotionAllowed());
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const showStill = reduced || failed;
  const activeSize = visible ? size : null;
  const poster = size === null ? undefined : getStillVariantSrc(src, size);
  const latest = useRef({ imageRef, onLoad, showStill });
  latest.current = { imageRef, onLoad, showStill };

  useEffect(() => {
    const onMotionChange = () => setReduced(!loopMotionAllowed());
    // Catch up on a change between the first render and this subscription.
    onMotionChange();
    reducedMotion?.addEventListener?.("change", onMotionChange);
    return () => reducedMotion?.removeEventListener?.("change", onMotionChange);
  }, []);

  // The poster is the still: probe it as the still's own <img>, so an imageRef
  // reader (e.g. an "already cached" check) and onLoad (e.g. ending a loading
  // skeleton) work without waiting for the first decoded frame.
  const probePoster = (url: string) => {
    if (!imageRef && !onLoad) return;
    if (probe.current?.url !== url) {
      if (probe.current) probe.current.image.onload = probe.current.image.onerror = null;
      const image = new Image();
      image.onload = () => latest.current.onLoad?.({ currentTarget: image } as never);
      // A missing poster variant falls back to the still, which has its own error fallback.
      image.onerror = () => setFailed(true);
      image.src = url;
      probe.current = { image, url };
    }
    assignRef(imageRef, probe.current.image);
  };

  // An imageRef reader checks for a cached image as it mounts, before the
  // observer below first reports: size a loop already near the viewport now.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!imageRef || showStill || !video) return;
    const box = video.getBoundingClientRect();
    if (box.width <= 0 || box.bottom < -NEAR_VIEWPORT || box.right < -NEAR_VIEWPORT
      || box.top > window.innerHeight + NEAR_VIEWPORT || box.left > window.innerWidth + NEAR_VIEWPORT) return;
    const next = Math.max(size ?? 0, loopAnimationWidthFor(loop, box.width * (window.devicePixelRatio || 1)));
    setSize(next);
    probePoster(getStillVariantSrc(src, next));
  }, [loop, showStill]);

  useLayoutEffect(() => {
    if (poster && !showStill) probePoster(poster);
  }, [poster, showStill]);

  useLayoutEffect(() => () => {
    const current = probe.current;
    if (!current) return;
    current.image.onload = current.image.onerror = null;
    // A shown still owns the ref (and releases it itself); otherwise release it as an unmounted <img> would.
    if (!latest.current.showStill) assignRef(latest.current.imageRef, null, current.image);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (showStill || !video) return;
    let near = false;
    // Measured only near the viewport, so off-screen loops fetch nothing (not even the poster).
    const measure = () => {
      if (!near) return;
      const pixels = video.getBoundingClientRect().width * (window.devicePixelRatio || 1);
      if (pixels > 0) setSize((current) => Math.max(current ?? 0, loopAnimationWidthFor(loop, pixels)));
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      near = entry.isIntersecting;
      measure();
      setVisible(near);
    }, { rootMargin: `${NEAR_VIEWPORT}px` });
    observer.observe(video);
    // Settle a growing box (e.g. a width transition) before reloading at a larger size.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const resize = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => { clearTimeout(settle); settle = setTimeout(measure, 150); })
      : undefined;
    resize?.observe(video);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      clearTimeout(settle);
      // While the still shows nothing tracks visibility: start over when the video returns.
      attachedSize.current = null;
      setVisible(false);
    };
  }, [loop, showStill]);

  useEffect(() => {
    const video = videoRef.current;
    if (showStill || !video) return;
    // <source> changes only apply on load(); without sources it releases the decoder.
    if (attachedSize.current !== activeSize) {
      attachedSize.current = activeSize;
      video.load();
    }
    if (activeSize === null) return;
    // Autoplay can be refused (e.g. iOS Low Power Mode). A pause() or load()
    // interrupting a pending play() rejects with AbortError, which is not a refusal.
    video.play()?.catch((error: unknown) => {
      if ((error as { name?: unknown } | null)?.name !== "AbortError") setFailed(true);
    });
  }, [activeSize, showStill]);


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
      onError={() => setFailed(true)}
      playsInline
      poster={poster}
      preload="none"
      ref={videoRef}
      role={alt ? "img" : undefined}
      style={style}
      width={width}
    >
      {activeSize === null ? null : (
        <>
          <source src={loopAnimationUrl(loop, "webm", activeSize)} type='video/webm; codecs="vp9"' />
          <source onError={() => setFailed(true)} src={loopAnimationUrl(loop, "mp4", activeSize)} type="video/mp4" />
        </>
      )}
    </video>
  );
}
