import { Flame, Orbit } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import { useState } from "preact/hooks";
import type { Resources } from "../playableMvp";
import type { MissionShips } from "../galaxyActions";
import type { ChainMoonState } from "../walletFlow";
import type { Coordinates } from "../types";
import { formatCost } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import { buildingCatalog, defenseCatalog, shipCatalog, shipyardCatalog } from "../playableMvp";
import type { DefenseKey, ShipKey } from "../playableMvp";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../moonActions";
import { formatUserTimestamp } from "../timestampFormat";
import {
  InspectCatalogTile,
  InspectDetailHero,
  InspectDetailImage,
  InspectDetailShell,
  InspectInfoBlock,
  InspectTwoColumnLayout,
  useInspectDetailSelection,
} from "./InspectProgressLayout";
import { PageHeader, RefreshButton } from "./PageHeader";
import { InlineSyncIndicator } from "./VeydriftLoader";
import { MoonSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { MoonImage } from "./PlanetMoonIndicator";
import {
  parseProductionQuantity,
  ProductionCatalog,
  type ProductionCatalogItem,
  type ProductionDetailSection,
  type ProductionQuantityInput,
  type ProductionRequirementState,
  productionQueueViewModel,
} from "./ProductionCatalog";
import { RequirementFlairs } from "./RequirementFlairs";

interface MoonPageProps {
  action?: { status: "idle" | "pending" | "success" | "error"; label?: string } | undefined;
  burningChicken?: {
    configured: boolean;
    maxMoonsPerPlayer: number;
    moonCount: number;
  } | undefined;
  canTransact?: boolean | undefined;
  canBurnChicken?: boolean | undefined;
  error?: string | undefined;
  loading?: boolean | undefined;
  moonState?: ChainMoonState | null | undefined;
  onBurnChicken?: ((tokenId: string) => void) | undefined;
  onFinishBuilding?: ((label: string) => void) | undefined;
  onFinishDefense?: ((label: string) => void) | undefined;
  onJumpGate?: ((destinationPlanetId: string, ships?: Partial<MissionShips>) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onStartBuilding?: ((buildingId: number, label: string) => void) | undefined;
  onStartDefense?: ((defenseId: number, label: string, quantity: number) => void) | undefined;
  parentPlanetLabel?: string | undefined;
  selectedCoordinates?: Coordinates | undefined;
  transactionUnavailableReason?: string | undefined;
}

export function MoonPage({
  action,
  burningChicken,
  canTransact,
  canBurnChicken,
  error,
  loading,
  moonState,
  onBurnChicken,
  onFinishBuilding,
  onFinishDefense,
  onJumpGate,
  onRefresh,
  onStartBuilding,
  onStartDefense,
  parentPlanetLabel,
  selectedCoordinates,
  transactionUnavailableReason,
}: MoonPageProps) {
  const moon = moonState?.moon;
  const hasMoon = Boolean(moon?.exists);
  const unavailableReason = moonState?.unavailableReason;
  const moonUnavailable = moonState?.moonAvailable === false;
  const isLoading = Boolean(loading);

  return (
    <div className="grid gap-4">
      <PageHeader
        actions={onRefresh ? <RefreshButton loading={isLoading} onRefresh={onRefresh} title="Refresh moon state" /> : undefined}
        title="Moon"
      />

      {!hasMoon ? (
        <ChickenBurnPanel
          action={action}
          burningChicken={burningChicken}
          canBurnChicken={canBurnChicken}
          hasMoon={hasMoon}
          onBurnChicken={onBurnChicken}
          selectedCoordinates={selectedCoordinates}
          transactionUnavailableReason={transactionUnavailableReason}
        />
      ) : null}

      {hasMoon && moon ? (
        <>
          {loading ? (
            <InlineSyncIndicator label="Refreshing moon state" />
          ) : error ? (
            isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <MoonStatusPanel title="Moon state refresh failed" body={error} tone="warning" />
          ) : null}
          <MoonSystemsPanel
            action={action}
            canTransact={canTransact}
            moon={moon}
            moonState={moonState}
            onFinishBuilding={onFinishBuilding}
            onFinishDefense={onFinishDefense}
            onJumpGate={onJumpGate}
            onStartBuilding={onStartBuilding}
            onStartDefense={onStartDefense}
            parentPlanetLabel={parentPlanetLabel}
            transactionUnavailableReason={transactionUnavailableReason}
          />
        </>
      ) : loading ? (
        <MoonSkeleton />
      ) : moonUnavailable ? (
        <MoonStatusPanel
          title={moonState?.indexedNotReady ? "Moon state is indexing" : "Moon systems unavailable"}
          body={unavailableReason ?? "Moon state is not available for the selected planet yet."}
          tone="warning"
        />
      ) : error ? (
        isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <MoonStatusPanel title="Moon state unavailable" body={error} tone="warning" />
      ) : (
        <NoMoonGuidance moonState={moonState} reason={unavailableReason} />
      )}
    </div>
  );
}

function ChickenBurnPanel({
  action,
  burningChicken,
  canBurnChicken,
  hasMoon,
  onBurnChicken,
  selectedCoordinates,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  burningChicken?: MoonPageProps["burningChicken"];
  canBurnChicken?: boolean | undefined;
  hasMoon: boolean;
  onBurnChicken?: MoonPageProps["onBurnChicken"];
  selectedCoordinates?: Coordinates | undefined;
  transactionUnavailableReason?: string | undefined;
}) {
  const pending = action?.status === "pending";
  const configured = Boolean(burningChicken?.configured);
  const capCount = burningChicken?.moonCount ?? 0;
  const capMax = burningChicken?.maxMoonsPerPlayer ?? 2;
  const moonLimitReached = Boolean(
    burningChicken && capCount >= capMax
  );
  const disabledReason = chickenBurnDisabledReason({
    canBurnChicken,
    configured,
    hasMoon,
    moonLimitReached,
    pending,
    transactionUnavailableReason,
  });
  const targetLabel = selectedCoordinates
    ? `${selectedCoordinates.galaxy}:${selectedCoordinates.system}:${selectedCoordinates.position}`
    : "selected planet";
  const submitChickenBurn = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    const tokenId = String(new FormData(form ?? undefined).get("chickenTokenId") ?? "").trim();
    onBurnChicken?.(tokenId);
  };

  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded border border-amber-200/20 bg-amber-200/10 text-amber-200">
            <Flame aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <h3 className="text-sm font-semibold text-white">Burning Chickens</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Enter a Chicken ID to burn it on Base mainnet and grant a moon to {targetLabel}. Veydrift verifies this wallet owns the chicken before opening the transaction.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Burning Chicken burn config is not available yet.
        </p>
      ) : null}

      {configured ? (
        <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          During testnet, each account can receive only {capMax} Chicken moons. {capCount} / {capMax} testnet Chicken moons used.
        </p>
      ) : null}

      {moonLimitReached ? (
        <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          Moon limit reached: this wallet already has {capCount} of {capMax} testnet Chicken moons.
        </p>
      ) : null}

      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitChickenBurn}>
        <label className="grid gap-1 text-xs text-slate-300">
          <span>Chicken ID</span>
          <input
            className="h-9 min-w-0 rounded border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none transition focus:border-amber-200/40"
            inputMode="numeric"
            name="chickenTokenId"
            placeholder="91528"
            type="text"
          />
        </label>
        <button
          className="h-9 self-end rounded border border-amber-200/20 bg-amber-200/10 px-4 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          type="submit"
        >
          Burn for Moon
        </button>
      </form>

      {action?.status !== "idle" && action?.label ? (
        <p className={`mt-3 text-xs ${chickenBurnActionTone(action.status)}`}>{action.label}</p>
      ) : null}
    </section>
  );
}

function chickenBurnActionTone(status: NonNullable<MoonPageProps["action"]>["status"]): string {
  if (status === "error") return "text-amber-100";
  if (status === "success") return "text-emerald-100";
  return "text-cyan-100";
}

function chickenBurnDisabledReason({
  canBurnChicken,
  configured,
  hasMoon,
  moonLimitReached,
  pending,
  transactionUnavailableReason,
}: {
  canBurnChicken?: boolean | undefined;
  configured: boolean;
  hasMoon: boolean;
  moonLimitReached: boolean;
  pending: boolean;
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!configured) return "Burning Chicken burn config is unavailable.";
  if (hasMoon) return "The selected planet already has a moon.";
  if (moonLimitReached) return "This wallet has reached the two-moon limit.";
  if (!canBurnChicken) return transactionUnavailableReason ?? "Wallet or Burning Chicken contract unavailable.";
  if (pending) return "A moon transaction is already pending.";
  return undefined;
}

function NoMoonGuidance({
  moonState,
  reason,
}: {
  moonState?: ChainMoonState | null | undefined;
  reason?: string | undefined;
}) {
  const previewBuildings = moonStructurePreviewBuildings(moonState);

  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="grid gap-4">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
            <MoonImage className="h-full w-full object-cover" />
          </div>
          <h3 className="text-base font-semibold text-white">No moon in orbit</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Burn a verified Chicken to grant a moon to this planet, then build moon structures.
          </p>
          {reason ? <p className="mt-2 text-xs text-slate-500">{reason}</p> : null}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-normal text-cyan-200/80">Moon structures</h4>
          <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
            {previewBuildings.map((building) => (
              <GuidanceStep key={building.label} label={building.label} value={building.description} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MoonStatusPanel({
  body,
  title,
  tone = "neutral",
}: {
  body: string;
  title: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <section className={
      "rounded-md border p-4 " + (
        tone === "warning"
          ? "border-amber-300/20 bg-amber-300/10"
          : "border-white/10 bg-[#101624]"
      )
    }>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className={"mt-1 text-sm " + (tone === "warning" ? "text-amber-100/80" : "text-slate-400")}>{body}</p>
    </section>
  );
}

function MoonSystemsPanel({
  action,
  canTransact,
  moon,
  moonState,
  onJumpGate,
  onFinishBuilding,
  onFinishDefense,
  onStartBuilding,
  onStartDefense,
  parentPlanetLabel,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onJumpGate?: MoonPageProps["onJumpGate"];
  onFinishBuilding?: MoonPageProps["onFinishBuilding"];
  onFinishDefense?: MoonPageProps["onFinishDefense"];
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  onStartDefense?: MoonPageProps["onStartDefense"];
  parentPlanetLabel?: string | undefined;
  transactionUnavailableReason?: string | undefined;
}) {
  const [jumpDestination, setJumpDestination] = useState("");
  const [jumpSmallCargo, setJumpSmallCargo] = useState("");
  const [jumpLargeCargo, setJumpLargeCargo] = useState("");
  const pending = action?.status === "pending";
  const jumpDestinationReady = isPositiveIntegerInput(jumpDestination);
  const jumpShips = parseMoonJumpShips(jumpSmallCargo, jumpLargeCargo);
  const jumpCargoValid = jumpShips !== null;
  const fieldSummary = moonFieldSummary(moon, moonState);
  const jumpGateDestinations = moonJumpGateDestinations(moonState);
  const jumpGateAvailable = moonJumpGateAvailable(moon, moonState, jumpGateDestinations);
  const [selectedBuildingKey, setSelectedBuildingKey] = useState<MoonBuilding["key"]>("lunarBase");
  const [selectedShipKey, setSelectedShipKey] = useState<ShipKey>("smallCargo");
  const [selectedDefenseKey, setSelectedDefenseKey] = useState<DefenseKey>("rocketLauncher");

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-md border border-white/10 bg-[#101624]">
        <div className="grid lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
          <div className="relative min-h-56 overflow-hidden bg-black/40">
            <MoonImage
              className="absolute inset-0 h-full w-full object-cover"
              height={1254}
              loading="eager"
              sizes="(min-width: 1280px) 38vw, (min-width: 768px) 46vw, 100vw"
              width={1254}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_45%_25%,transparent,rgba(5,7,13,0.18)_42%,rgba(5,7,13,0.86)_100%)]" />
            <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded border border-cyan-200/25 bg-black/55 px-2 py-1 text-xs font-semibold text-cyan-100">
              Moon orbiting {moonOrbitParentLabel(parentPlanetLabel, moon.planetId)}
            </div>
          </div>
          <div className="grid gap-4 p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <MoonMetric icon={Orbit} label="Diameter" value={moon.diameterKm.toLocaleString() + " km"} />
              <MoonMetric icon={Orbit} label="Fields" value={`${fieldSummary.used} / ${fieldSummary.capacity}`} />
              <MoonMetric icon={Orbit} label="Jump Gate" value={moonJumpGateStatus(moon, moonState, jumpGateDestinations)} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Resources</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {moonResourceRows(moonState).map((resource) => (
                  <div className="min-w-24 rounded border border-white/10 bg-black/15 px-2.5 py-1.5" key={resource.label}>
                    <div className="text-[10px] font-semibold uppercase tracking-normal text-cyan-200/80">{resource.label}</div>
                    <div className="text-sm font-semibold text-slate-100">{resource.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <MoonStructuresSection
        action={action}
        canTransact={canTransact}
        fieldSummary={fieldSummary}
        moon={moon}
        moonState={moonState}
        onFinishBuilding={onFinishBuilding}
        onSelectBuilding={setSelectedBuildingKey}
        onStartBuilding={onStartBuilding}
        pending={pending}
        selectedBuildingKey={selectedBuildingKey}
        transactionUnavailableReason={transactionUnavailableReason}
      />

      <MoonShipyardSection
        moonState={moonState}
        onSelectShip={setSelectedShipKey}
        selectedShipKey={selectedShipKey}
      />

      <MoonDefenseSection
        actionPending={pending}
        canTransact={Boolean(canTransact)}
        moonState={moonState}
        onFinishDefense={onFinishDefense}
        onSelectDefense={setSelectedDefenseKey}
        onStartDefense={onStartDefense}
        selectedDefenseKey={selectedDefenseKey}
        transactionUnavailableReason={transactionUnavailableReason}
      />

      {jumpGateAvailable ? (
      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Jump Gate</h3>
          <p className="mt-1 text-xs text-slate-400">
            Deploy stationed moon ships to another owned moon with a ready Jump Gate. Resources stay on the origin moon.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
            <select
              className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100"
              onChange={(event) => setJumpDestination(event.currentTarget.value)}
              value={jumpDestination}
            >
              <option value="">Destination moon</option>
              {jumpGateDestinations.map((destination) => (
                <option key={destination.planetId} value={destination.planetId}>
                  {destination.label?.trim() || destination.coordinates?.trim() || `Moon #${destination.planetId}`}
                </option>
              ))}
            </select>
            <input className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100" inputMode="numeric" onInput={(event) => setJumpSmallCargo(event.currentTarget.value)} placeholder="Small" value={jumpSmallCargo} />
            <input className="h-9 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100" inputMode="numeric" onInput={(event) => setJumpLargeCargo(event.currentTarget.value)} placeholder="Large" value={jumpLargeCargo} />
            <button
              className="h-9 rounded border border-cyan-200/20 bg-cyan-200/10 px-3 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canTransact || pending || !onJumpGate || !jumpDestinationReady || !jumpCargoValid}
              onClick={() => jumpCargoValid ? onJumpGate?.(jumpDestination.trim(), jumpShips) : undefined}
              title={!canTransact ? transactionUnavailableReason : undefined}
              type="button"
            >
              Deploy
            </button>
          </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}

function MoonStructuresSection({
  action,
  canTransact,
  fieldSummary,
  moon,
  moonState,
  onFinishBuilding,
  onSelectBuilding,
  onStartBuilding,
  pending,
  selectedBuildingKey,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  canTransact?: boolean | undefined;
  fieldSummary: ReturnType<typeof moonFieldSummary>;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onFinishBuilding?: MoonPageProps["onFinishBuilding"];
  onSelectBuilding: (key: MoonBuilding["key"]) => void;
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  pending: boolean;
  selectedBuildingKey: MoonBuilding["key"];
  transactionUnavailableReason?: string | undefined;
}) {
  const buildings = moonState?.buildings ?? [];
  const selectedBuilding = buildings.find((building) => building.key === selectedBuildingKey)
    ?? buildings[0];
  const buildingQueueReady = queueReady(moonState?.queue);
  const { detailPanelRef, selectInspectItem } = useInspectDetailSelection<MoonBuilding["key"]>((key) => {
    onSelectBuilding(key);
  });

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Moon Structures</h3>
          <p className="text-xs text-slate-400">
            Lunar Base expands fields. Jump Gate supports fleet movement between owned moons. {fieldSummary.used} / {fieldSummary.capacity} fields used.
          </p>
        </div>
      </div>

      {!canTransact && transactionUnavailableReason ? (
        <p className="rounded border border-cyan-300/20 bg-cyan-300/10 px-2 py-1.5 text-xs text-cyan-100">
          {transactionUnavailableReason}
        </p>
      ) : null}

      {buildings.length > 0 ? (
        <InspectTwoColumnLayout
          catalog={buildings.map((building) => {
            const requirements = moonBuildingRequirementRows(building, moon, moonState);
            const locked = requirements.some((requirement) => !requirement.met);

            return (
              <InspectCatalogTile
                asset={moonBuildingAsset(building.key)}
                currentText={`Level ${building.level}`}
                isDimmed={building.level === 0}
                isSelected={selectedBuilding?.key === building.key}
                key={building.key}
                label={building.label}
                labelTone={locked ? "muted" : "normal"}
                onClick={() => selectInspectItem(building.key)}
                statusText={locked ? "Locked" : formatCost(resourcesFromChain(building.cost))}
                statusTone={locked ? "warning" : "accent"}
              />
            );
          })}
          detail={selectedBuilding ? (
            <MoonStructureDetailPanel
              action={action}
              building={selectedBuilding}
              canTransact={canTransact}
              moon={moon}
              moonState={moonState}
              onStartBuilding={onStartBuilding}
              pending={pending}
              transactionUnavailableReason={transactionUnavailableReason}
            />
          ) : null}
          detailPanelRef={detailPanelRef}
        />
      ) : (
        <MoonStatusPanel title="Moon structures unavailable" body="No moon structure data is available yet." />
      )}

      {moonState?.queue?.active ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
          <span>
            Moon queue: {moonBuildingLabel(moonState.queue.itemId)}{" "}
            {moonState.queue.targetLevel ? "L" + moonState.queue.targetLevel : ""} / ready{" "}
            {formatMoonReadyAt(moonState.queue.readyAt)}
          </span>
          {buildingQueueReady && onFinishBuilding ? (
            <button
              className="h-8 rounded border border-amber-200/30 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canTransact || pending}
              onClick={() => onFinishBuilding(moonBuildingLabel(moonState.queue?.itemId))}
              title={!canTransact ? transactionUnavailableReason : undefined}
              type="button"
            >
              Complete
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MoonStructureDetailPanel({
  action,
  building,
  canTransact,
  moon,
  moonState,
  onStartBuilding,
  pending,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  building: MoonBuilding;
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  pending: boolean;
  transactionUnavailableReason?: string | undefined;
}) {
  const requirements = moonBuildingRequirementRows(building, moon, moonState);
  const queueBlocked = Boolean(moonState?.queue?.active && !queueReady(moonState.queue));
  const requirementsMissing = requirements.some((row) => !row.met);
  const disabled = !canTransact || pending || queueBlocked || requirementsMissing;
  const disabledReason = !canTransact
    ? transactionUnavailableReason
    : activeQueueTitle(moonState?.queue) ?? firstMissingRequirementLabel(requirements);

  return (
    <InspectDetailShell>
      <InspectDetailHero
        image={(
          <InspectDetailImage
            asset={moonBuildingAsset(building.key)}
            cacheKey={`moon-building:${building.key}`}
            isDimmed={building.level === 0}
          />
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-semibold text-white">{building.label}</h3>
            <p className="mt-1 text-sm text-slate-400">Level {building.level} to {building.level + 1}</p>
          </div>
          {building.level > 0 ? (
            <span className="rounded bg-emerald-300/10 px-2 py-1 text-xs font-semibold text-emerald-200">Active</span>
          ) : (
            <span className="rounded bg-white/5 px-2 py-1 text-xs font-semibold text-slate-400">Not built</span>
          )}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">{moonBuildingEffect(building.key)}</p>
      </InspectDetailHero>

      <div className="mt-4 grid gap-2 border-t border-white/10 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <InspectInfoBlock label="Requirements">
          <RequirementFlairs requirements={requirements.map((row) => ({
            label: `${row.label} ${row.status}`,
            met: row.met,
          }))} />
        </InspectInfoBlock>
        <InspectInfoBlock label="Upgrade cost" value={formatCost(resourcesFromChain(building.cost))} />
        {building.durationSeconds === undefined ? null : (
          <InspectInfoBlock label="Upgrade time" value={formatDuration(building.durationSeconds)} />
        )}
      </div>

      <div className="mt-4 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <p className={`text-sm font-semibold ${disabled ? "text-slate-400" : "text-emerald-200"}`}>
          {disabledReason ?? "Ready to upgrade"}
        </p>
      </div>

      {action?.status === "error" && action.label ? (
        <div className="mt-2 rounded border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-200">
          {action.label}
        </div>
      ) : null}

      {onStartBuilding ? (
        <button
          className="mt-3 h-10 w-full rounded-md border border-signal/40 bg-signal/10 px-3 text-sm font-semibold text-signal transition hover:bg-signal/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
          disabled={disabled}
          onClick={() => onStartBuilding(building.id, building.label)}
          title={disabledReason}
          type="button"
        >
          Upgrade Level {building.level + 1}
        </button>
      ) : null}
    </InspectDetailShell>
  );
}

function MoonShipyardSection({
  moonState,
  onSelectShip,
  selectedShipKey,
}: {
  moonState?: ChainMoonState | null | undefined;
  onSelectShip: (key: ShipKey) => void;
  selectedShipKey: ShipKey;
}) {
  const [quantities, setQuantities] = useState<Record<string, ProductionQuantityInput>>({});

  return (
    <section className="grid gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white">Moon Shipyard</h3>
        <p className="text-xs text-slate-400">
          Stationed moon ships use the same selectable catalog pattern as the planet Shipyard.
        </p>
      </div>
      <ProductionCatalog
        actionPending={false}
        canTransact={false}
        emptyLabel="No moon ships are available yet."
        items={moonShipProductionItems({ moonState, quantities })}
        onBuild={() => undefined}
        onQuantity={(key, quantity) => setQuantities((prev) => ({ ...prev, [key]: quantity }))}
        onSelect={onSelectShip}
        selectedKey={selectedShipKey}
      />
    </section>
  );
}

function MoonDefenseSection({
  actionPending,
  canTransact,
  moonState,
  onFinishDefense,
  onSelectDefense,
  onStartDefense,
  selectedDefenseKey,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  canTransact: boolean;
  moonState?: ChainMoonState | null | undefined;
  onFinishDefense?: MoonPageProps["onFinishDefense"];
  onSelectDefense: (key: DefenseKey) => void;
  onStartDefense?: MoonPageProps["onStartDefense"];
  selectedDefenseKey: DefenseKey;
  transactionUnavailableReason?: string | undefined;
}) {
  const [quantities, setQuantities] = useState<Record<string, ProductionQuantityInput>>({});
  const defenseQueueReady = queueReady(moonState?.defenseQueue);

  return (
    <section className="grid gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white">Moon Defenses</h3>
        <p className="text-xs text-slate-400">
          Moon defenses use the same selectable catalog and detail controls as the planet Defenses screen.
        </p>
      </div>

      {moonState?.defenseQueue?.active ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">
          <span>
            Defense queue: {moonDefenseLabel(moonState.defenseQueue.itemId)} x{moonState.defenseQueue.quantity ?? 0} / ready{" "}
            {formatMoonReadyAt(moonState.defenseQueue.readyAt)}
          </span>
          {defenseQueueReady && onFinishDefense ? (
            <button
              className="h-8 rounded border border-amber-200/30 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canTransact || actionPending}
              onClick={() => onFinishDefense(moonDefenseLabel(moonState.defenseQueue?.itemId))}
              title={!canTransact ? transactionUnavailableReason : undefined}
              type="button"
            >
              Complete
            </button>
          ) : null}
        </div>
      ) : null}

      <ProductionCatalog
        actionPending={actionPending}
        canTransact={canTransact}
        emptyLabel="No moon defenses are available yet."
        items={moonDefenseProductionItems({
          actionPending,
          canTransact,
          moonState,
          quantities,
          transactionUnavailableReason,
        })}
        onBuild={(item) => onStartDefense?.(item.id, item.label, item.quantity)}
        onQuantity={(key, quantity) => setQuantities((prev) => ({ ...prev, [key]: quantity }))}
        onSelect={onSelectDefense}
        queue={productionQueueViewModel(moonState?.defenseQueue, defenseCatalog)}
        selectedKey={selectedDefenseKey}
      />
    </section>
  );
}

function moonResourceRows(moonState?: ChainMoonState | null | undefined): Array<{ label: string; value: string }> {
  const resources = moonState?.resourcesAsOfNow ?? moonState?.resources ?? { metal: "0", crystal: "0", deuterium: "0" };
  return [
    { label: "Metal", value: formatMoonAmount(resources.metal) },
    { label: "Crystal", value: formatMoonAmount(resources.crystal) },
    { label: "Deuterium", value: formatMoonAmount(resources.deuterium) },
  ];
}

function moonShipProductionItems({
  moonState,
  quantities,
}: {
  moonState?: ChainMoonState | null | undefined;
  quantities: Record<string, ProductionQuantityInput>;
}): ProductionCatalogItem<ShipKey>[] {
  const moonShips = moonState?.ships ?? moonState?.fleet ?? [];

  return shipyardCatalog.map((ship) => {
    const chainShip = moonShips.find((item) => item.id === ship.id);
    const quantityInput = quantities[ship.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    const count = chainShip?.count ?? 0;
    const cost = toResources(chainShip?.cost);
    const durationSeconds = chainShip?.durationSeconds === undefined
      ? undefined
      : chainShip.durationSeconds * quantity;

    return {
      actionLabel: "Stationed",
      asset: ship.asset,
      blockedReason: "Moon shipyard is a stationed fleet view. Build ships from a planet Shipyard.",
      cost: cost ? multiplyResources(cost, quantity) : undefined,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "On moon",
      countValue: count,
      detailSections: moonShipDetailSections({ cost, count, durationSeconds, ship }),
      detailNote: ship.description,
      disabled: true,
      group: ship.group,
      groupLabel: moonShipGroupLabel(ship.group),
      id: ship.id,
      key: ship.key,
      labelTone: count > 0 ? "normal" : "muted",
      label: ship.label,
      missing: [],
      quantity,
      quantityInput,
      quantityValid: parsedQuantity !== undefined,
      requirements: [],
      status: count > 0 ? "ready" : "unavailable",
      statusLabel: count > 0 ? "Stationed" : undefined,
    };
  });
}

function moonDefenseProductionItems({
  actionPending,
  canTransact,
  moonState,
  quantities,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  canTransact: boolean;
  moonState?: ChainMoonState | null | undefined;
  quantities: Record<string, ProductionQuantityInput>;
  transactionUnavailableReason?: string | undefined;
}): ProductionCatalogItem<DefenseKey>[] {
  const queueBlocked = Boolean(moonState?.defenseQueue?.active && !queueReady(moonState.defenseQueue));

  return defenseCatalog.map((defense) => {
    const moonDefense = moonState?.defenses.find((item) => item.id === defense.id);
    const quantityInput = quantities[defense.key] ?? 1;
    const parsedQuantity = parseProductionQuantity(quantityInput);
    const quantity = parsedQuantity ?? 1;
    const baseCost = toResources(moonDefense?.cost);
    const totalCost = baseCost ? multiplyResources(baseCost, quantity) : undefined;
    const durationSeconds = moonDefense?.durationSeconds === undefined
      ? undefined
      : moonDefense.durationSeconds * quantity;
    const requirements = moonDefenseRequirementStates(defense, moonState);
    const missing = requirements.filter((requirement) => !requirement.met).map((requirement) => requirement.label);
    const blockedReason = moonDefenseBlockedReason({
      canTransact,
      missing,
      moonDefenseAvailable: Boolean(moonDefense),
      moonState,
      queueBlocked,
      transactionUnavailableReason,
    });
    const queued = queuedMoonDefenseCount(defense.id, moonState?.defenseQueue);

    return {
      actionLabel: queued > 0 ? "Add" : "Build",
      asset: defense.asset,
      blockedReason,
      cost: totalCost,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "On moon",
      countValue: moonDefense?.count ?? 0,
      detailSections: moonDefenseDetailSections({
        cost: totalCost,
        defense,
        durationSeconds,
        deployed: moonDefense?.count ?? 0,
      }),
      detailNote: defense.group === "missile" ? "Moon missile support" : "Moon defensive emplacement",
      disabled: Boolean(blockedReason) || actionPending,
      group: defense.group,
      groupLabel: moonDefenseGroupLabel(defense.group),
      id: defense.id,
      key: defense.key,
      labelTone: blockedReason ? "muted" : "normal",
      label: defense.label,
      missing,
      quantity,
      quantityInput,
      quantityValid: parsedQuantity !== undefined,
      queued,
      requirements,
      status: queued > 0 ? "queued" : missing.length === 0 && moonDefense ? "ready" : "locked",
      statusLabel: queued > 0 ? "Queued" : undefined,
    };
  });
}

function moonShipDetailSections({
  cost,
  count,
  durationSeconds,
  ship,
}: {
  cost: Resources | undefined;
  count: number;
  durationSeconds: number | undefined;
  ship: (typeof shipCatalog)[number];
}): ProductionDetailSection[] {
  return [{
    title: "Stationed",
    stats: [
      { label: "On moon", value: count.toLocaleString("en-US") },
      { label: "Unit", value: ship.group === "civil" ? "Civil ship" : ship.group === "combat" ? "Combat ship" : "Special unit" },
      { label: "Base cost", value: cost ? formatCost(cost) : "-", wide: true },
      ...(durationSeconds === undefined ? [] : [{ label: "Build time", value: formatDuration(durationSeconds), wide: true }]),
    ],
  }];
}

function moonDefenseDetailSections({
  cost,
  defense,
  deployed,
  durationSeconds,
}: {
  cost: Resources | undefined;
  defense: (typeof defenseCatalog)[number];
  deployed: number;
  durationSeconds: number | undefined;
}): ProductionDetailSection[] {
  return [{
    title: "Build",
    stats: [
      { label: "On moon", value: deployed.toLocaleString("en-US") },
      { label: "Class", value: moonDefenseGroupLabel(defense.group) },
      { label: "Price", value: cost ? formatCost(cost) : "-", wide: true },
      ...(durationSeconds === undefined ? [] : [{ label: "Build time", value: formatDuration(durationSeconds), wide: true }]),
    ],
  }];
}

function moonDefenseRequirementStates(
  defense: (typeof defenseCatalog)[number],
  moonState?: ChainMoonState | null | undefined,
): ProductionRequirementState[] {
  const moonShipyardLevel = moonBuildingLevels(moonState).shipyard;
  const technologyLevels = moonTechnologyLevelsByKey(moonState?.technologyLevels);

  return uniqueMoonRequirements(defense.requirements).map((requirement) => {
    const actual = requirement.kind === "building"
      ? requirement.key === "shipyard" ? moonShipyardLevel : 0
      : technologyLevels[requirement.key as string] ?? 0;

    return {
      label: `${requirement.label} ${requirement.level}`,
      met: actual >= requirement.level,
    };
  });
}

function uniqueMoonRequirements(requirements: (typeof defenseCatalog)[number]["requirements"]) {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = `${requirement.kind}:${requirement.key ?? requirement.label}:${requirement.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function moonDefenseBlockedReason({
  canTransact,
  missing,
  moonDefenseAvailable,
  moonState,
  queueBlocked,
  transactionUnavailableReason,
}: {
  canTransact: boolean;
  missing: string[];
  moonDefenseAvailable: boolean;
  moonState?: ChainMoonState | null | undefined;
  queueBlocked: boolean;
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!canTransact) return transactionUnavailableReason ?? "Wallet or moon contract unavailable";
  if (!moonState?.moon?.exists) return "No selected moon";
  if (!moonDefenseAvailable) return "Defense unavailable on current moon deployment";
  if (queueBlocked) return "Moon defense queue is active";
  if (missing.length > 0) return missing[0];
  return undefined;
}

function queuedMoonDefenseCount(defenseId: number, queue?: ChainMoonState["defenseQueue"] | undefined): number {
  let quantity = queue?.active && queue.itemId === defenseId ? queue.quantity ?? 0 : 0;
  for (const backlog of queue?.backlog ?? []) {
    if (backlog.active && backlog.itemId === defenseId) {
      quantity += backlog.quantity ?? 0;
    }
  }
  return quantity;
}

function moonShipGroupLabel(group: (typeof shipCatalog)[number]["group"]): string {
  if (group === "civil") return "Civil and economy";
  if (group === "combat") return "Combat ships";
  return "Satellites and specials";
}

function moonDefenseGroupLabel(group: (typeof defenseCatalog)[number]["group"]): string {
  if (group === "kinetic") return "Kinetic batteries";
  if (group === "energy") return "Energy weapons";
  if (group === "shield") return "Shield domes";
  return "Missiles";
}

function toResources(resources: ChainMoonState["resources"] | ChainMoonState["defenses"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

function multiplyResources(resources: Resources, quantity: number): Resources {
  return {
    metal: resources.metal * quantity,
    crystal: resources.crystal * quantity,
    deuterium: resources.deuterium * quantity,
  };
}

function moonTechnologyLevelsByKey(levels: Record<string, number> | undefined): Record<string, number> {
  const technologyIdByKey: Partial<Record<string, number>> = {
    energy: 0,
    laser: 1,
    ion: 2,
    combustionDrive: 3,
    computer: 4,
    weapons: 5,
    shielding: 6,
    armor: 7,
    hyperspace: 8,
    impulseDrive: 9,
    hyperspaceDrive: 10,
    plasma: 11,
    astrophysics: 12,
    intergalacticResearchNetwork: 13,
    graviton: 14,
  };

  return Object.fromEntries(
    Object.entries(technologyIdByKey).map(([key, id]) => [
      key,
      id === undefined ? 0 : levels?.[id.toString()] ?? 0,
    ]),
  );
}

function moonBuildingAsset(key: ChainMoonState["buildings"][number]["key"]): string {
  const fallback = "/assets/game/style-pass/generated/buildings/terraformer-mid.webp";
  if (key === "lunarBase") return "/assets/game/style-pass/generated/buildings/lunar-base.webp";
  if (key === "roboticsFactory") return buildingCatalog.find((item) => item.key === "roboticsFactory")?.asset ?? fallback;
  if (key === "shipyard") return buildingCatalog.find((item) => item.key === "shipyard")?.asset ?? fallback;
  return "/assets/game/style-pass/generated/buildings/jump-gate.webp";
}

type MoonJumpGateDestination = NonNullable<ChainMoonState["jumpGateDestinations"]>[number];

export function moonJumpGateDestinations(moonState: ChainMoonState | null | undefined): MoonJumpGateDestination[] {
  return (moonState?.jumpGateDestinations ?? []).filter((destination) => (
    isPositiveIntegerInput(destination.planetId)
      && formatMoonReadyAt(destination.jumpGateReadyAt) === "Ready"
  ));
}

export function moonJumpGateAvailable(
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
  destinations: MoonJumpGateDestination[],
): boolean {
  const hasBuiltGate = (moonState?.buildings ?? []).some((building) => building.key === "jumpGate" && building.level > 0);
  return hasBuiltGate && formatMoonReadyAt(moon.jumpGateReadyAt) === "Ready" && destinations.length > 0;
}

export function moonJumpGateStatus(
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
  destinations: MoonJumpGateDestination[],
): string {
  const hasBuiltGate = (moonState?.buildings ?? []).some((building) => building.key === "jumpGate" && building.level > 0);
  if (!hasBuiltGate) return "Not built";
  const readyLabel = formatMoonReadyAt(moon.jumpGateReadyAt);
  if (readyLabel !== "Ready") return readyLabel;
  if (destinations.length === 0) return "Needs another moon";
  return `${destinations.length} destination${destinations.length === 1 ? "" : "s"}`;
}

function formatMoonAmount(value: string | number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : String(value);
}

function GuidanceStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/15 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-normal text-cyan-200/80">{label}</div>
      <div className="mt-1 leading-5 text-slate-300">{value}</div>
    </div>
  );
}

function moonStructurePreviewBuildings(moonState?: ChainMoonState | null | undefined): Array<{ label: string; description: string }> {
  const descriptions = new Map([
    ["Lunar Base", "Adds moon fields so more lunar structures can be built."],
    ["Robotics Factory", "Speeds moon facilities and unlocks the moon Shipyard."],
    ["Shipyard", "Builds moon defenses from the lunar queue."],
    ["Jump Gate", "Moves fleets between owned moons when the gate is ready."],
  ]);
  const labels = [
    ...(moonState?.buildings.map((building) => building.label) ?? []),
    "Lunar Base",
    "Robotics Factory",
    "Shipyard",
    "Jump Gate",
  ];
  const uniqueLabels = Array.from(new Set(labels));

  return uniqueLabels
    .map((label) => ({
      label,
      description: descriptions.get(label) ?? "Buildable moon structure available after the moon is granted.",
    }));
}

function MoonMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded border border-white/10 bg-black/15 px-2.5 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
        <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-normal text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      </div>
    </div>
  );
}

function resourcesFromChain(resources: ChainMoonState["resources"] | ChainMoonState["buildings"][number]["cost"] | null | undefined): Resources {
  return {
    metal: Number(resources?.metal ?? 0),
    crystal: Number(resources?.crystal ?? 0),
    deuterium: Number(resources?.deuterium ?? 0),
  };
}

type MoonBuilding = ChainMoonState["buildings"][number];
type RequirementRow = {
  label: string;
  met: boolean;
  status: string;
};

export function moonBuildingRequirementRows(
  building: MoonBuilding,
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): RequirementRow[] {
  const levels = moonBuildingLevels(moonState);
  const fieldSummary = moonFieldSummary(moon, moonState);
  const rows: RequirementRow[] = [{
    label: "Open field",
    met: fieldSummary.open > 0,
    status: `${fieldSummary.open} open`,
  }];

  if (building.key !== "lunarBase" && levels.lunarBase === 0) {
    rows.push({
      label: "Lunar Base first",
      met: false,
      status: "Build Lunar Base",
    });
  }

  if (building.key === "shipyard") {
    const robotics = levels.roboticsFactory;
    rows.push({
      label: "Robotics Factory 2",
      met: robotics >= 2,
      status: `L${robotics} / 2`,
    });
  }

  if (building.key === "jumpGate") {
    const lunarBase = levels.lunarBase;
    const hyperspace = moonState?.technologyLevels?.["8"] ?? 0;
    rows.push({
      label: "Lunar Base 1",
      met: lunarBase >= 1,
      status: `L${lunarBase} / 1`,
    }, {
      label: "Hyperspace 7",
      met: hyperspace >= 7,
      status: `L${hyperspace} / 7`,
    });
  }

  return rows;
}

function moonBuildingLevels(moonState: ChainMoonState | null | undefined): Record<MoonBuilding["key"], number> {
  const levels = {
    lunarBase: 0,
    roboticsFactory: 0,
    jumpGate: 0,
    shipyard: 0,
  };
  for (const building of moonState?.buildings ?? []) {
    levels[building.key] = building.level;
  }
  return levels;
}

export function moonFieldSummary(
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): { capacity: number; used: number; open: number } {
  const lunarBaseLevel = moonBuildingLevels(moonState).lunarBase;
  const capacity = lunarBaseLevel === 0 ? Math.min(moon.fields, 1) : moon.fields;
  const used = (moonState?.buildings ?? []).reduce((sum, building) => sum + building.level, 0);
  return {
    capacity,
    used,
    open: Math.max(0, capacity - used),
  };
}

export function queueReady(queue: ChainMoonState["queue"] | undefined): boolean {
  return Boolean(queue?.active && queue.asOfNow?.complete === true);
}

function activeQueueTitle(queue: ChainMoonState["queue"] | undefined): string | undefined {
  if (!queue?.active || queueReady(queue)) return undefined;
  return "Moon queue is active.";
}

function moonBuildingEffect(key: ChainMoonState["buildings"][number]["key"]): string {
  if (key === "lunarBase") return "Adds 3 gross fields and consumes 1 field.";
  if (key === "roboticsFactory") return "Reduces moon facility build time and unlocks the moon Shipyard.";
  if (key === "shipyard") return "Unlocks and speeds moon defense construction.";
  return "Enables fleet jumps between owned moons.";
}

function moonBuildingLabel(itemId: number | undefined): string {
  return [
    { id: 0, label: "Lunar Base" },
    { id: 1, label: "Robotics Factory" },
    { id: 2, label: "Jump Gate" },
    { id: 3, label: "Shipyard" },
  ].find((building) => building.id === itemId)?.label ?? "Moon building";
}

function moonDefenseLabel(itemId: number | undefined): string {
  return defenseCatalog.find((defense) => defense.id === itemId)?.label ?? "Moon defense";
}

function firstMissingRequirementLabel(rows: RequirementRow[]): string | undefined {
  const row = rows.find((candidate) => !candidate.met);
  return row ? `${row.label}: ${row.status}` : undefined;
}

function moonOrbitParentLabel(parentPlanetLabel: string | undefined, planetId: string): string {
  const trimmed = parentPlanetLabel?.trim();
  return trimmed || `parent planet #${planetId}`;
}

function formatMoonReadyAt(value: string | null | undefined): string {
  if (!value || value === "0") return "Ready";
  return formatUserTimestamp(value);
}
