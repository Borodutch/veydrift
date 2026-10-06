import { useRef, useState } from "preact/hooks";
import { Play } from "lucide-preact";

// Versioned: /assets/ is served immutable, so a new cut needs a new file name.
const trailer = {
  captions: "/assets/landing/veydrift-trailer-v1.vtt",
  poster: "/assets/landing/veydrift-trailer-v1-poster.webp",
  src: "/assets/landing/veydrift-trailer-v1.mp4",
};

// Click-to-play with sound; preload="none" keeps the 2-minute file off the wire until asked for.
export function TrailerPlayer() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const play = () => {
    setStarted(true);
    void video.current?.play().catch(() => setStarted(false));
  };

  return (
    <div className="relative mx-auto max-w-6xl overflow-hidden rounded-xl border border-cyan-300/15 bg-black shadow-[0_28px_110px_rgba(0,0,0,0.55),0_0_60px_rgba(128,241,255,0.08)]">
      <video
        className="block aspect-video w-full bg-black"
        controls={started}
        onEnded={() => setStarted(false)}
        onPlay={() => setStarted(true)}
        playsInline
        poster={trailer.poster}
        preload="none"
        ref={video}
        title="Veydrift in two minutes"
      >
        <source src={trailer.src} type="video/mp4" />
        <track kind="captions" label="English" src={trailer.captions} srcLang="en" />
      </video>
      {started ? null : (
        <button
          aria-label="Play the two-minute Veydrift trailer"
          className="group absolute inset-0 flex items-end justify-center bg-[linear-gradient(180deg,rgba(4,7,11,0)_52%,rgba(4,7,11,0.7)_100%)] pb-[9%]"
          onClick={play}
          type="button"
        >
          <span className="inline-flex min-h-12 items-center gap-3 rounded-lg border border-signal/30 bg-signal px-6 py-3 text-sm font-bold text-[#031014] shadow-[0_0_40px_rgba(128,241,255,0.35)] transition group-hover:bg-cyan-100">
            <Play aria-hidden="true" className="h-5 w-5 fill-current" />
            Watch the trailer
            <span className="font-semibold opacity-70">2:00</span>
          </span>
        </button>
      )}
    </div>
  );
}
