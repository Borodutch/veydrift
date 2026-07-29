export function CcaLaunchBanner({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <aside
      className={`cca-launch-banner${embedded ? " cca-launch-banner--game" : ""}`}
      aria-label="$VEYDRIFT auction"
    >
      <a href="/cca">
        <span><b>$VEYDRIFT</b> auction is live on Base</span>
        <span>Place a bid <span aria-hidden="true">→</span></span>
      </a>
    </aside>
  );
}
