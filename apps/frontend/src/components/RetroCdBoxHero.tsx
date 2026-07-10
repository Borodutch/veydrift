import type { ComponentChildren } from "preact";
import retroCdBoxHeroUrl from "../assets/veydrift-retro-cd-box-hero.webp";

export function RetroCdBoxHero({
  ariaLabel,
  children,
  support,
}: {
  ariaLabel: string;
  children: ComponentChildren;
  support?: ComponentChildren;
}) {
  return (
    <main className="retro-cd-stage">
      <div className="retro-cd-backdrop" aria-hidden="true">
        <div className="retro-cd-starfield retro-cd-starfield-one" />
        <div className="retro-cd-starfield retro-cd-starfield-two" />
        <div className="retro-cd-nebula" />
        <div className="retro-cd-scanlines" />
      </div>

      {support}

      <section className="retro-cd-shell" aria-label={ariaLabel}>
        <div className="retro-cd-copy-panel">
          {children}
        </div>

        <figure className="retro-cd-art" aria-label="Retro Veydrift PC CD box floating in space">
          <img
            alt="Retro Veydrift PC CD box floating in space"
            className="retro-cd-box"
            src={retroCdBoxHeroUrl}
          />
        </figure>
      </section>
    </main>
  );
}
