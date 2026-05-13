import heroUrl from "./assets/veydrift-hero.png";

const statusItems = [
  "Base",
  "Coming soon",
  "Public signal pending"
] as const;

export function App() {
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
        </div>
      </section>
    </main>
  );
}
