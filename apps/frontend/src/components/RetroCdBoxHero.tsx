import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Disc3, RotateCw, Undo2 } from "lucide-preact";
import { haptic } from "../haptics";
import { playSfx, startSfxLoop, stopSfxLoop } from "../sfx";

export type CdView = "back" | "front" | "open";

const cdViewOrder: readonly CdView[] = ["front", "open", "back"];

const cdCycleLabel: Record<CdView, string> = {
  front: "Open the box",
  open: "Show the back",
  back: "Back to front",
};

const cdBackScreens = [
  {
    alt: "Veydrift overview screenshot",
    label: "Empire",
    src: "/assets/landing/qa-screens/overview-desktop.jpg",
  },
  {
    alt: "Veydrift shipyard screenshot",
    label: "Shipyard",
    src: "/assets/landing/qa-screens/shipyard-desktop.jpg",
  },
  {
    alt: "Veydrift missions screenshot",
    label: "Missions",
    src: "/assets/landing/qa-screens/missions-desktop.jpg",
  },
] as const;

const cdBackFeatures = ["Onchain", "Alliances", "Fleet ops", "Rift economy"] as const;

const cdBookletTracks = [
  { index: "01", title: "Command planets" },
  { index: "02", title: "Marshal fleets" },
  { index: "03", title: "Raid rivals" },
  { index: "04", title: "Drift the Rift" },
] as const;

const cdBackdropFloaters = [
  {
    alt: "",
    className: "retro-cd-floater-planet-main",
    src: "/assets/game/style-pass/generated/planets/crystal-violet.webp",
  },
  {
    alt: "",
    className: "retro-cd-floater-planet-molten",
    src: "/assets/game/style-pass/generated/planets/scorching-molten.webp",
  },
  {
    alt: "",
    className: "retro-cd-floater-planet-blue",
    src: "/assets/game/style-pass/generated/planets/deuterium-blue.webp",
  },
  {
    alt: "",
    className: "retro-cd-floater-deathstar",
    src: "/assets/game/style-pass/generated/ships/deathstar.webp",
  },
] as const;

export function RetroCdBoxHero({
  ariaLabel,
  children,
  id,
  stage = "main",
  support,
  viewSignal,
}: {
  ariaLabel: string;
  children: ComponentChildren;
  id?: string;
  stage?: "main" | "section";
  support?: ComponentChildren;
  viewSignal?: CdView | undefined;
}) {
  const [view, setView] = useState<CdView>("front");
  const stageRef = useRetroCdTilt<HTMLElement>();

  useEffect(() => {
    if (viewSignal && viewSignal !== view) {
      setView(viewSignal);
    }
  }, [viewSignal]);

  useEffect(() => {
    if (view === "open") {
      startSfxLoop("disc-spin");
      return () => stopSfxLoop("disc-spin");
    }
    return undefined;
  }, [view]);

  const cycleView = () => {
    haptic("tick");
    playSfx(view === "front" ? "cd-open" : view === "open" ? "cd-flip" : "cd-close");
    setView((current) => (current === "front" ? "open" : current === "open" ? "back" : "front"));
  };

  const content = (
    <div className="retro-cd-stage-inner">
      <div className="retro-cd-backdrop" aria-hidden="true">
        <div className="retro-cd-starfield retro-cd-starfield-one" />
        <div className="retro-cd-starfield retro-cd-starfield-two" />
        <div className="retro-cd-starfield retro-cd-starfield-twinkle" />
        <div className="retro-cd-nebula" />
        <div className="retro-cd-floaters">
          {cdBackdropFloaters.map((floater) => (
            <div className={`retro-cd-floater ${floater.className}`} key={floater.className}>
              <img alt={floater.alt} loading="lazy" src={floater.src} />
            </div>
          ))}
        </div>
        <div className="retro-cd-shooting-star" />
        <div className="retro-cd-scanlines" />
      </div>

      <div className={`retro-cd-hero retro-cd-view-${view}`} aria-label={ariaLabel}>
        <div className="retro-cd-copy-panel">{children}</div>

        <div className="retro-cd-showcase">
          <div className="retro-cd-scene">
            <div className="retro-cd-tilt">
              <div className="retro-cd-case" aria-label={`Retro Veydrift CD box, ${view} view`}>
                <div className="retro-cd-tray">
                  <aside className="retro-cd-cover retro-cd-back" aria-label="Veydrift screenshots">
                    <div className="retro-cd-back-copy">
                      <strong>Build. Raid. Drift.</strong>
                      <p>
                        One persistent universe living fully onchain. Every mine, fleet and alliance
                        is yours to command — and everyone else's to fear.
                      </p>
                    </div>
                    <div className="retro-cd-screens">
                      {cdBackScreens.map((screen, index) => (
                        <figure
                          className={`retro-cd-screen ${index === 0 ? "retro-cd-screen-wide" : ""}`}
                          key={screen.src}
                        >
                          <img alt={screen.alt} src={screen.src} />
                          <figcaption>{screen.label}</figcaption>
                        </figure>
                      ))}
                    </div>
                    <p className="retro-cd-back-features" aria-label="Feature list">
                      {cdBackFeatures.map((feature, index) => (
                        <span key={feature}>
                          {index > 0 ? <i aria-hidden="true">✦</i> : null}
                          {feature}
                        </span>
                      ))}
                    </p>
                    <div className="retro-cd-sysreq" aria-label="System requirements">
                      <strong>System requirements</strong>
                      <p>
                        <em>MINIMUM:</em> modern browser · EVM wallet · internet connection
                      </p>
                      <p>
                        <em>RECOMMENDED:</em> an alliance of five or more commanders
                      </p>
                    </div>
                    <div className="retro-cd-back-bottom">
                      <div className="retro-cd-barcode" aria-hidden="true">
                        <span>8 901204 VEYDRIFT</span>
                      </div>
                    </div>
                    <p className="retro-cd-back-legal" aria-hidden="true">
                      © 2026 VEYDRIFT. ALL RIGHTS RESERVED. PUBLISHED ON BASE.
                    </p>
                  </aside>

                  <div className="retro-cd-tray-floor" aria-hidden="true" />

                  <img
                    alt=""
                    aria-hidden="true"
                    className="retro-cd-tray-art retro-cd-tray-art-planet"
                    src="/assets/game/style-pass/generated/planets/deuterium-blue.webp"
                  />
                  <img
                    alt=""
                    aria-hidden="true"
                    className="retro-cd-tray-art retro-cd-tray-art-ship"
                    src="/assets/game/style-pass/generated/ships/battlecruiser.webp"
                  />

                  <div className="retro-cd-disc" aria-hidden="true">
                    <div className="retro-cd-disc-face">
                      <img
                        alt=""
                        className="retro-cd-disc-art"
                        src="/assets/game/style-pass/generated/planets/crystal-violet.webp"
                      />
                      <div className="retro-cd-disc-print">
                        <strong>VEYDRIFT</strong>
                        <span>ONCHAIN SPACE STRATEGY</span>
                      </div>
                      <div className="retro-cd-disc-code">
                        <span>VEY-0001</span>
                        <span>BASE MAINNET</span>
                      </div>
                    </div>
                    <div className="retro-cd-disc-sheen" aria-hidden="true" />
                  </div>

                  <div className="retro-cd-edge retro-cd-edge-top" aria-hidden="true" />
                  <div className="retro-cd-edge retro-cd-edge-bottom" aria-hidden="true" />
                  <div className="retro-cd-edge retro-cd-edge-right" aria-hidden="true" />
                  <div className="retro-cd-spine" aria-hidden="true">
                    <span>VEYDRIFT</span>
                    <span>BASE</span>
                  </div>
                  <div className="retro-cd-hinge" aria-hidden="true">
                    <span className="retro-cd-hinge-knuckle retro-cd-hinge-knuckle-top" />
                    <span className="retro-cd-hinge-knuckle retro-cd-hinge-knuckle-bottom" />
                  </div>
                </div>

                <div className="retro-cd-lid">
                  <div className="retro-cd-booklet" aria-hidden="true">
                    <strong className="retro-cd-booklet-title">Field manual</strong>
                    <figure className="retro-cd-booklet-fig">
                      <img alt="" src="/assets/landing/qa-screens/overview-desktop.jpg" />
                      <figcaption>FIG. 1 — COMMAND DECK</figcaption>
                    </figure>
                    <ol className="retro-cd-booklet-tracks">
                      {cdBookletTracks.map((track) => (
                        <li key={track.index}>
                          <span>{track.index}</span>
                          {track.title}
                        </li>
                      ))}
                    </ol>
                    <img
                      alt=""
                      className="retro-cd-booklet-art"
                      src="/assets/game/style-pass/generated/planets/crystal-violet.webp"
                    />
                    <p className="retro-cd-booklet-note">
                      Insert into nearest browser. No install required.
                    </p>
                  </div>

                  <section className="retro-cd-cover retro-cd-front">
                    <div className="retro-cd-front-stars" aria-hidden="true" />
                    <img
                      alt=""
                      aria-hidden="true"
                      className="retro-cd-front-art"
                      src="/assets/game/style-pass/generated/planets/crystal-violet.webp"
                    />
                    <div className="retro-cd-brand">
                      <span>Onchain space strategy</span>
                      <strong>VEYDRIFT</strong>
                    </div>
                    <div className="retro-cd-holo" aria-hidden="true">
                      <img alt="" src="/assets/game/style-pass/generated/ships/deathstar.webp" />
                    </div>
                    <div className="retro-cd-badges" aria-hidden="true">
                      <div className="retro-cd-rating">
                        <span>OPEN</span>
                        <strong>BETA</strong>
                      </div>
                      <div className="retro-cd-platform">
                        <span>BASE</span>
                        <strong>MAINNET</strong>
                      </div>
                    </div>
                    <div className="retro-cd-glare" aria-hidden="true" />
                  </section>

                  <div className="retro-cd-lid-edge retro-cd-lid-edge-right" aria-hidden="true" />
                  <div className="retro-cd-lid-edge retro-cd-lid-edge-top" aria-hidden="true" />
                  <div className="retro-cd-lid-edge retro-cd-lid-edge-bottom" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>

          <div className="retro-cd-controls">
            <button className="retro-cd-cycle" onClick={cycleView} onPointerEnter={() => playSfx("hover-tick")} type="button">
              {view === "front"
                ? <Disc3 aria-hidden="true" className="retro-cd-cycle-icon" />
                : view === "open"
                  ? <RotateCw aria-hidden="true" className="retro-cd-cycle-icon" />
                  : <Undo2 aria-hidden="true" className="retro-cd-cycle-icon" />}
              {cdCycleLabel[view]}
            </button>
            <div className="retro-cd-steps" aria-hidden="true">
              {cdViewOrder.map((step) => (
                <span
                  className={`retro-cd-step ${step === view ? "is-active" : ""}`}
                  key={step}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (stage === "section") {
    return (
      <section className="retro-cd-stage" id={id} ref={stageRef}>
        {support}
        {content}
      </section>
    );
  }

  return (
    <main className="retro-cd-stage" ref={stageRef}>
      {support}
      {content}
    </main>
  );
}

function useRetroCdTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.075;
      currentY += (targetY - currentY) * 0.075;

      stage.style.setProperty("--cd-tilt-x", `${(currentX * 7).toFixed(3)}deg`);
      stage.style.setProperty("--cd-tilt-y", `${(currentY * -5).toFixed(3)}deg`);
      stage.style.setProperty("--cd-px", `${(currentX * 30).toFixed(2)}px`);
      stage.style.setProperty("--cd-py", `${(currentY * 20).toFixed(2)}px`);
      stage.style.setProperty("--cd-gx", `${((currentX + 1) * 50).toFixed(2)}%`);
      stage.style.setProperty("--cd-gy", `${((currentY + 1) * 50).toFixed(2)}%`);

      if (Math.abs(targetX - currentX) > 0.0008 || Math.abs(targetY - currentY) > 0.0008) {
        rafId = window.requestAnimationFrame(render);
        return;
      }
      rafId = 0;
    };

    const schedule = () => {
      if (rafId === 0) rafId = window.requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => {
      targetX = Math.min(1, Math.max(-1, (event.clientX / window.innerWidth) * 2 - 1));
      targetY = Math.min(1, Math.max(-1, (event.clientY / window.innerHeight) * 2 - 1));
      schedule();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return ref;
}
