export type VeydriftLoaderVariant = "section" | "inline";

interface VeydriftLoaderProps {
  label?: string | undefined;
  variant?: VeydriftLoaderVariant | undefined;
}

export function VeydriftLoader({
  label = "Syncing",
  variant = "section",
}: VeydriftLoaderProps) {
  const inline = variant === "inline";

  return (
    <div
      aria-live="polite"
      className={inline ? "veydrift-loader veydrift-loader-inline" : "veydrift-loader veydrift-loader-section"}
      role="status"
    >
      <span className="veydrift-loader-orbit" aria-hidden="true">
        <span className="veydrift-loader-core" />
        <span className="veydrift-loader-ring veydrift-loader-ring-a" />
        <span className="veydrift-loader-ring veydrift-loader-ring-b" />
        <span className="veydrift-loader-satellite veydrift-loader-satellite-a" />
        <span className="veydrift-loader-satellite veydrift-loader-satellite-b" />
      </span>
      <span className="veydrift-loader-label">{label}</span>
    </div>
  );
}

export function InlineSyncIndicator({ label = "Refreshing" }: { label?: string | undefined }) {
  return <VeydriftLoader label={label} variant="inline" />;
}
