import type { ComponentChildren } from "preact";

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

export function RetroCdBoxHero({
  ariaLabel,
  children,
  stage = "main",
  support,
}: {
  ariaLabel: string;
  children: ComponentChildren;
  stage?: "main" | "section";
  support?: ComponentChildren;
}) {
  const content = (
    <div className="retro-cd-stage-inner">
      <div className="retro-cd-backdrop" aria-hidden="true">
        <div className="retro-cd-starfield retro-cd-starfield-one" />
        <div className="retro-cd-starfield retro-cd-starfield-two" />
        <div className="retro-cd-nebula" />
        <div className="retro-cd-scanlines" />
      </div>

      {support}

      <div className="retro-cd-shell" aria-label={ariaLabel}>
        <div className="retro-cd-case" aria-label="Retro Veydrift CD box">
          <div className="retro-cd-spine" aria-hidden="true">
            <span>VEYDRIFT</span>
            <span>BASE</span>
          </div>

          <section className="retro-cd-cover retro-cd-front">
            <div className="retro-cd-brand">
              <strong>VEYDRIFT</strong>
            </div>
            <div className="retro-cd-front-orbit" aria-hidden="true" />
            <div className="retro-cd-copy-panel">
              {children}
            </div>
            <div className="retro-cd-rating" aria-hidden="true">BETA</div>
          </section>

          <aside className="retro-cd-cover retro-cd-back" aria-label="Veydrift screenshots">
            <div className="retro-cd-back-copy">
              <strong>Build. Raid. Drift.</strong>
            </div>
            <div className="retro-cd-screens">
              {cdBackScreens.map((screen) => (
                <figure className="retro-cd-screen" key={screen.src}>
                  <img alt={screen.alt} src={screen.src} />
                  <figcaption>{screen.label}</figcaption>
                </figure>
              ))}
            </div>
            <div className="retro-cd-spec-grid" aria-hidden="true">
              <span>Onchain</span>
              <span>Alliances</span>
              <span>Fleet ops</span>
              <span>Rift economy</span>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  if (stage === "section") {
    return <section className="retro-cd-stage">{content}</section>;
  }

  return <main className="retro-cd-stage">{content}</main>;
}
