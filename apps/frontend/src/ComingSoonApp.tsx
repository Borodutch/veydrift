import heroUrl from "./assets/veydrift-hero.webp";

const statusItems = [
  "Base",
  "Coming soon",
  "Public signal pending"
] as const;

export function ComingSoonApp() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-void text-white">
      <img
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        src={heroUrl}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,13,0.94)_0%,rgba(5,7,13,0.78)_36%,rgba(5,7,13,0.22)_72%,rgba(5,7,13,0.55)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_28%,rgba(128,241,255,0.18),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(246,179,92,0.12),transparent_30%)]" />

      <section className="relative z-10 flex min-h-dvh w-full items-end px-6 py-10 sm:px-10 lg:px-16">
        <div className="mb-[8vh] max-w-3xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.22em] text-signal">
            Onchain space begins soon
          </p>
          <h1 className="text-5xl font-semibold leading-none text-white sm:text-7xl lg:text-8xl">
            Veydrift
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
            A new frontier is aligning on Base. Coordinates are being prepared
            for the first public signal.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {statusItems.map((item) => (
              <span
                className="border border-white/18 bg-white/8 px-4 py-2 text-sm font-medium text-slate-100 backdrop-blur"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>

          <a
            href="https://t.me/+Vh9ndeKMY31jNzQx"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2.5 rounded-lg border border-signal/40 bg-signal/10 px-5 py-3 text-sm font-semibold text-signal transition-colors hover:bg-signal/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            Join the tester group
          </a>
        </div>
      </section>
    </main>
  );
}
