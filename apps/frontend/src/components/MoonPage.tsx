import { ArrowLeftRight, Crosshair, ExternalLink, Eye, Flame, Orbit, Rocket, Shield } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import { useState } from "preact/hooks";
import type { Resources } from "../playableMvp";
import type { MissionShips } from "../galaxyActions";
import type { ChainMoonState } from "../walletFlow";
import type { PlanetType } from "../types";
import { formatCost, MAX_BUILDING_LEVEL } from "../buildingDetails";
import { formatDuration } from "../durationFormat";
import { buildingCatalog, buildingDurationEstimate, canAfford, defenseCatalog, shipCatalog, shipyardCatalog } from "../playableMvp";
import type { DefenseKey, ShipKey } from "../playableMvp";
import { isPositiveIntegerInput, parseMoonJumpShips } from "../moonActions";
import { formatUserTimestamp, timestampToMs } from "../timestampFormat";
import {
  InspectInfoBlock,
} from "./InspectProgressLayout";
import { ActionReasonNote } from "./ActionReasonNote";
import { MoonSkeleton } from "./LoadingSkeletons";
import { GameUnavailableNotice, isGameUnavailableMessage } from "./GameUnavailableNotice";
import { MoonImage } from "./PlanetMoonIndicator";
import {
  adaptProductionItems,
  maxAffordableProductionQuantity,
  ProductionSection,
  type ProductionCatalogItem,
  type ProductionDetailSection,
  type ProductionQuantityInput,
  productionQueueViewModel,
  scaleProductionCost,
} from "./ProductionCatalog";
import { defenseProductionItems } from "./DefensePage";
import { RequirementFlairs, type RequirementFlair, type RequirementTarget } from "./RequirementFlairs";
import { LevelInfoModal, type LevelInfoColumn } from "./LevelInfoModal";
import { QueueProgressPanel } from "./QueueProgressPanel";
import { StructureCatalog, StructureDetail, type StructureLevelInfo } from "./StructureCatalog";

const burningChickensOpenSeaCollectionUrl = "https://opensea.io/collection/chickens-by-eggs";

interface MoonPageProps {
  action?: { status: "idle" | "pending" | "success" | "error"; label?: string } | undefined;
  burningChicken?: {
    configured: boolean;
  } | undefined;
  canTransact?: boolean | undefined;
  canBurnChicken?: boolean | undefined;
  error?: string | undefined;
  loading?: boolean | undefined;
  moonActions?: MoonOverviewAction[] | undefined;
  moonState?: ChainMoonState | null | undefined;
  onBurnChicken?: ((tokenId: string) => void) | undefined;
  onJumpGate?: ((destinationPlanetId: string, ships?: Partial<MissionShips>) => void) | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onRefresh?: (() => void) | undefined;
  onStartBuilding?: ((buildingId: number, label: string) => void) | undefined;
  onStartDefense?: ((defenseId: number, label: string, quantity: number) => void) | undefined;
  parentPlanetLabel?: string | undefined;
  parentPlanetType?: PlanetType | null | undefined;
  transactionUnavailableReason?: string | undefined;
}

export type MoonOverviewAction = {
  disabledReason?: string | undefined;
  kind: "inspect" | "attack" | "transport" | "deploy" | "defend";
  label: string;
  onClick?: (() => void) | undefined;
};

export function MoonPage({
  action,
  burningChicken,
  canTransact,
  canBurnChicken,
  error,
  loading,
  moonActions,
  moonState,
  onBurnChicken,
  onJumpGate,
  onOpenRequirement,
  onStartBuilding,
  onStartDefense,
  parentPlanetLabel,
  parentPlanetType,
  transactionUnavailableReason,
}: MoonPageProps) {
  const moon = moonState?.moon;
  const hasMoon = Boolean(moon?.exists);
  const unavailableReason = moonState?.unavailableReason;
  const moonUnavailable = moonState?.moonAvailable === false;
  return (
    <div className="grid gap-4">
      {!loading && !hasMoon ? (
        <ChickenBurnPanel
          action={action}
          burningChicken={burningChicken}
          canBurnChicken={canBurnChicken}
          hasMoon={hasMoon}
          onBurnChicken={onBurnChicken}
          transactionUnavailableReason={transactionUnavailableReason}
        />
      ) : null}

      {hasMoon && moon ? (
        <>
          {error ? (
            isGameUnavailableMessage(error) ? <GameUnavailableNotice /> : <MoonStatusPanel title="Moon state refresh failed" body={error} tone="warning" />
          ) : null}
          <MoonSystemsPanel
            action={action}
            canTransact={canTransact}
            moon={moon}
            moonActions={moonActions}
            moonState={moonState}
            onJumpGate={onJumpGate}
            onOpenRequirement={onOpenRequirement}
            onStartBuilding={onStartBuilding}
            onStartDefense={onStartDefense}
            parentPlanetLabel={parentPlanetLabel}
            parentPlanetType={parentPlanetType}
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
        <NoMoonGuidance moonState={moonState} parentPlanetType={parentPlanetType} reason={unavailableReason} />
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
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  burningChicken?: MoonPageProps["burningChicken"];
  canBurnChicken?: boolean | undefined;
  hasMoon: boolean;
  onBurnChicken?: MoonPageProps["onBurnChicken"];
  transactionUnavailableReason?: string | undefined;
}) {
  const pending = action?.status === "pending";
  const configured = Boolean(burningChicken?.configured);
  const disabledReason = chickenBurnDisabledReason({
    canBurnChicken,
    configured,
    hasMoon,
    pending,
    transactionUnavailableReason,
  });
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
          <h3 className="text-base font-semibold text-white">Burning Chickens</h3>
        </div>
        <a
          className="inline-flex h-9 items-center gap-2 rounded border border-amber-200/20 bg-amber-200/10 px-3 text-xs font-semibold text-amber-100 transition hover:border-amber-200/40 hover:bg-amber-200/20"
          href={burningChickensOpenSeaCollectionUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
          Browse Chickens
        </a>
      </div>

      {!configured ? (
        <p className="mt-3 rounded border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Burning Chicken burn config is not available yet.
        </p>
      ) : null}

      {configured ? (
        <p className="mt-3 rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          Any Chicken NFT from the OpenSea collection can be burned for a moon at any planet.
        </p>
      ) : null}

      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitChickenBurn}>
        <label className="grid gap-1 text-xs text-slate-300">
          <span>Chicken ID</span>
          <input
            className="h-11 min-w-0 rounded border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none transition focus:border-amber-200/40 sm:h-9"
            inputMode="numeric"
            name="chickenTokenId"
            placeholder="91528"
            type="text"
          />
        </label>
        <button
          className="h-11 self-end rounded border border-amber-200/20 bg-amber-200/10 px-4 text-xs font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          type="submit"
        >
          Burn for Moon
        </button>
        <ActionReasonNote reason={disabledReason} />
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
  pending,
  transactionUnavailableReason,
}: {
  canBurnChicken?: boolean | undefined;
  configured: boolean;
  hasMoon: boolean;
  pending: boolean;
  transactionUnavailableReason?: string | undefined;
}): string | undefined {
  if (!configured) return "Burning Chicken burn config is unavailable.";
  if (hasMoon) return "The selected planet already has a moon.";
  if (!canBurnChicken) return transactionUnavailableReason ?? "Wallet or Burning Chicken contract unavailable.";
  if (pending) return "A moon transaction is already pending.";
  return undefined;
}

function NoMoonGuidance({
  moonState,
  parentPlanetType,
  reason,
}: {
  moonState?: ChainMoonState | null | undefined;
  parentPlanetType?: PlanetType | null | undefined;
  reason?: string | undefined;
}) {
  const previewBuildings = moonStructurePreviewBuildings(moonState);

  return (
    <section className="rounded-md border border-white/10 bg-[#101624] p-4">
      <div className="grid gap-4">
        <div className="min-w-0">
          <div className="mb-3 grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-cyan-200/20 bg-cyan-200/10 text-cyan-200">
            <MoonImage className="h-full w-full rounded-full object-cover" planetType={parentPlanetType} />
          </div>
          <h3 className="text-base font-semibold text-white">No moon in orbit</h3>
          {reason ? <p className="mt-2 text-xs text-slate-500">{reason}</p> : null}
        </div>

        <div>
          <h4 className="text-base font-semibold text-white">Moon structures</h4>
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
  moonActions,
  moonState,
  onJumpGate,
  onOpenRequirement,
  onStartBuilding,
  onStartDefense,
  parentPlanetLabel,
  parentPlanetType,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonActions?: MoonOverviewAction[] | undefined;
  moonState?: ChainMoonState | null | undefined;
  onJumpGate?: MoonPageProps["onJumpGate"];
  onOpenRequirement?: MoonPageProps["onOpenRequirement"];
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  onStartDefense?: MoonPageProps["onStartDefense"];
  parentPlanetLabel?: string | undefined;
  parentPlanetType?: PlanetType | null | undefined;
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
  const openMoonRequirement = (target: RequirementTarget) => {
    if (target.kind === "building" && target.key === "shipyard") {
      setSelectedBuildingKey("shipyard");
      if (typeof window !== "undefined") {
        window.setTimeout(() => document.getElementById("moon-structure-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
      return;
    }
    onOpenRequirement?.(target);
  };

  return (
    <div className="grid gap-4">
      <MoonResourceBar rows={moonResourceRows(moonState)} />

      <section className="overflow-hidden rounded-md border border-white/10 bg-[#101624]">
        <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="relative aspect-[16/9] overflow-hidden bg-black/25 lg:aspect-auto lg:h-60">
            <MoonImage
              className="absolute inset-0 h-full w-full object-cover"
              height={1254}
              loading="eager"
              planetType={parentPlanetType}
              sizes="(min-width: 1024px) 288px, 100vw"
              width={1254}
            />
          </div>
          <div className="flex min-w-0 flex-col justify-center p-4 lg:p-5" data-celestial-summary>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold text-white sm:text-3xl">Moon</h2>
                <p className="mt-1 truncate text-sm text-slate-400">
                  Orbiting {moonOrbitParentLabel(parentPlanetLabel, moon.planetId)}
                </p>
              </div>
              <MoonActionStrip actions={moonActions} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <MoonSummaryPill icon={Orbit} label="Diameter" value={`${moon.diameterKm.toLocaleString()} km`} />
              <MoonSummaryPill label="Fields" value={`${fieldSummary.used}/${fieldSummary.capacity}`} />
            </div>

            {moonStructureFieldHint(fieldSummary) ? (
              <p className="mt-3 text-xs text-slate-500">{moonStructureFieldHint(fieldSummary)}</p>
            ) : null}
          </div>
        </div>
      </section>

      <MoonShipyardSection
        moonState={moonState}
        onSelectShip={setSelectedShipKey}
        selectedShipKey={selectedShipKey}
      />

      <MoonStructuresSection
        action={action}
        canTransact={canTransact}
        moon={moon}
        moonState={moonState}
        onSelectBuilding={setSelectedBuildingKey}
        onStartBuilding={onStartBuilding}
        pending={pending}
        selectedBuildingKey={selectedBuildingKey}
        transactionUnavailableReason={transactionUnavailableReason}
      />

      <MoonDefenseSection
        actionPending={pending}
        canTransact={Boolean(canTransact)}
        moonState={moonState}
        onOpenRequirement={openMoonRequirement}
        onSelectDefense={setSelectedDefenseKey}
        onStartDefense={onStartDefense}
        selectedDefenseKey={selectedDefenseKey}
        transactionUnavailableReason={transactionUnavailableReason}
      />

      {jumpGateAvailable ? (
      <section className="rounded-md border border-white/10 bg-[#101624] p-4">
        <div>
          <h3 className="text-base font-semibold text-white">Jump Gate</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]">
            <select
              className="h-11 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100 sm:h-9"
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
            <input className="h-11 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100 sm:h-9" inputMode="numeric" onInput={(event) => setJumpSmallCargo(event.currentTarget.value)} placeholder="Small" value={jumpSmallCargo} />
            <input className="h-11 rounded border border-white/10 bg-black/20 px-2 text-sm text-slate-100 sm:h-9" inputMode="numeric" onInput={(event) => setJumpLargeCargo(event.currentTarget.value)} placeholder="Large" value={jumpLargeCargo} />
            <button
              className="h-11 rounded border border-cyan-200/20 bg-cyan-200/10 px-3 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
              disabled={!canTransact || pending || !onJumpGate || !jumpDestinationReady || !jumpCargoValid}
              onClick={() => jumpCargoValid ? onJumpGate?.(jumpDestination.trim(), jumpShips) : undefined}
              title={!canTransact ? transactionUnavailableReason : undefined}
              type="button"
            >
              Deploy
            </button>
            {!canTransact ? <ActionReasonNote reason={transactionUnavailableReason} /> : null}
          </div>
        </div>
      </section>
      ) : null}
    </div>
  );
}

function MoonSummaryPill({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon | undefined;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap rounded border border-white/10 bg-black/15 px-3 py-2 text-sm">
      {Icon ? <Icon aria-hidden="true" className="shrink-0 text-cyan-200" size={15} strokeWidth={1.8} /> : null}
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold tabular-nums text-slate-100">{value}</span>
    </div>
  );
}

function MoonResourceBar({ rows }: { rows: Array<{ label: string; value: string }> }) {
  const tones: Record<string, string> = {
    Metal: "text-amber-300",
    Crystal: "text-cyan-300",
    Deuterium: "text-emerald-300",
  };
  return (
    <dl className="flex min-h-10 flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-white/10 bg-[#0b111d] px-3 py-2">
      {rows.map((row) => (
        <div className="inline-flex items-baseline gap-2 whitespace-nowrap text-sm" key={row.label}>
          <dt className={`font-semibold ${tones[row.label] ?? "text-slate-300"}`}>{row.label}</dt>
          <dd className="font-medium tabular-nums text-slate-100">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function moonStructureFieldHint(fieldSummary: { capacity: number; used: number; open: number }): string | undefined {
  if (fieldSummary.open > 0) return undefined;
  return "Build or upgrade the Lunar Base to open more structure fields.";
}

export function MoonActionStrip({ actions }: { actions?: MoonOverviewAction[] | undefined }) {
  const availableActions = actions?.filter((action) => action.kind !== "inspect" && action.onClick && !action.disabledReason) ?? [];
  if (availableActions.length === 0) return null;

  return (
    <div aria-label="Moon actions" className="flex flex-wrap gap-2">
        {availableActions.map((action) => {
          const Icon = moonActionIcon(action.kind);
          return (
            <button
              aria-label={action.label}
              className="inline-flex h-11 w-11 items-center justify-center rounded border border-cyan-200/20 bg-cyan-200/10 text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-200/15 xl:h-10 xl:w-10"
              key={action.kind}
              onClick={action.onClick}
              title={action.label}
              type="button"
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
            </button>
          );
        })}
    </div>
  );
}

function moonActionIcon(kind: MoonOverviewAction["kind"]): LucideIcon {
  if (kind === "inspect") return Eye;
  if (kind === "attack") return Crosshair;
  if (kind === "transport") return ArrowLeftRight;
  if (kind === "deploy") return Rocket;
  return Shield;
}

function MoonStructuresSection({
  action,
  canTransact,
  moon,
  moonState,
  onSelectBuilding,
  onStartBuilding,
  pending,
  selectedBuildingKey,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onSelectBuilding: (key: MoonBuilding["key"]) => void;
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  pending: boolean;
  selectedBuildingKey: MoonBuilding["key"];
  transactionUnavailableReason?: string | undefined;
}) {
  const buildings = moonState?.buildings ?? [];
  const selectedBuilding = buildings.find((building) => building.key === selectedBuildingKey)
    ?? buildings[0];
  const constructionQueue = moonState?.queue?.active ? moonState.queue : undefined;
  const constructionLabel = constructionQueue
    ? `${moonBuildingLabel(constructionQueue.itemId)}${constructionQueue.targetLevel ? ` Level ${constructionQueue.targetLevel}` : ""}`
    : undefined;
  return (
    <section className="grid gap-3" id="moon-structures">
      <h3 className="text-base font-semibold text-white">Structures</h3>

      {constructionQueue && constructionLabel ? (
        <QueueProgressPanel
          asset={moonBuildingAssetForId(constructionQueue.itemId)}
          itemText={constructionLabel}
          label={constructionLabel}
          readyAt={constructionQueue.readyAt}
          startedAt={constructionQueue.startedAt}
          title="Construction"
          tone="amber"
        />
      ) : null}

      {buildings.length > 0 ? (
        <StructureCatalog
          items={buildings.map((building) => {
            const status = moonStructureStatus(building, moon, moonState, {
              canTransact,
              pending,
              transactionUnavailableReason,
            });

            return {
              asset: moonBuildingAsset(building.key),
              currentText: moonStructureLevelText(building),
              isDimmed: building.level === 0,
              key: building.key,
              label: building.label,
              labelTone: moonStructureCatalogTitleTone(status),
              statusText: moonStructureCatalogStatusText(building),
              statusTone: "accent" as const,
            };
          })}
          onSelect={onSelectBuilding}
          selectedKey={selectedBuilding?.key}
          detail={(selectBuilding) => selectedBuilding ? (
            <div id="moon-structure-detail">
              <MoonStructureDetailPanel
                action={action}
                building={selectedBuilding}
                canTransact={canTransact}
                moon={moon}
                moonState={moonState}
                onOpenRequirement={(target) => {
                  if (target.kind === "moonStructure" && isMoonBuildingKey(target.key, buildings)) {
                    selectBuilding(target.key);
                  }
                }}
                onStartBuilding={onStartBuilding}
                pending={pending}
                transactionUnavailableReason={transactionUnavailableReason}
              />
            </div>
          ) : null}
        />
      ) : (
        <MoonStatusPanel title="Moon structures unavailable" body="No moon structure data is available yet." />
      )}
    </section>
  );
}

function MoonStructureDetailPanel({
  action,
  building,
  canTransact,
  moon,
  moonState,
  onOpenRequirement,
  onStartBuilding,
  pending,
  transactionUnavailableReason,
}: {
  action?: MoonPageProps["action"];
  building: MoonBuilding;
  canTransact?: boolean | undefined;
  moon: NonNullable<ChainMoonState["moon"]>;
  moonState?: ChainMoonState | null | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onStartBuilding?: MoonPageProps["onStartBuilding"];
  pending: boolean;
  transactionUnavailableReason?: string | undefined;
}) {
  const status = moonStructureStatus(building, moon, moonState, {
    canTransact,
    pending,
    transactionUnavailableReason,
  });
  const binary = isBinaryMoonStructure(building.key);
  const built = building.level > 0;
  const actionVerb = building.level === 0 || binary ? "Build" : "Upgrade";
  const currentEffect = moonStructureLevelEffect(building.key, building.level);
  const nextEffect = moonStructureLevelEffect(building.key, building.level + 1);
  const levelInfoRows = moonStructureLevelInfoRows(building, moon, moonState);
  const levelInfo = moonStructureHasLevelInfo(building.key)
    ? moonStructureLevelInfoTable(building.key, building.level, levelInfoRows)
    : undefined;

  return (
    <StructureDetail
      action={onStartBuilding && !(binary && built) ? {
        ariaLabel: `${actionVerb} ${building.label} to Level ${status.targetLevel}`,
        disabled: status.disabled,
        label: building.level === 0 || binary ? `Build ${building.label}` : `Upgrade Level ${status.targetLevel}`,
        onClick: () => onStartBuilding(building.id, building.label),
      } : undefined}
      active={built}
      asset={moonBuildingAsset(building.key)}
      cacheKey={`moon-building:${building.key}`}
      description={moonBuildingEffect(building.key)}
      effectContent={<dl className="mt-4 grid gap-2">
        <MoonStructureComparisonMetric
          label="Effect"
          next={nextEffect}
          value={currentEffect}
        />
      </dl>}
      infoContent={<>
        <InspectInfoBlock label="Requirements">
          <RequirementFlairs onOpenRequirement={onOpenRequirement} requirements={moonRequirementFlairs(status.requirements)} />
        </InspectInfoBlock>
        <InspectInfoBlock label={building.level === 0 ? "Build cost" : "Upgrade cost"} value={status.costAvailable ? formatCost(status.cost) : "Cost pending"} />
        {status.durationSeconds === undefined ? null : (
          <InspectInfoBlock label={building.level === 0 ? "Build time" : "Upgrade time"} value={formatDuration(status.durationSeconds)} />
        )}
      </>}
      isDimmed={!built}
      label={building.label}
      levelInfo={levelInfo}
      notice={action?.status === "error" && action.label ? { label: action.label, tone: "error" } : undefined}
      statusReason={{ disabled: status.disabled, label: status.reason }}
      summary={moonStructureLevelSummary(building, status.targetLevel)}
    />
  );
}

function MoonStructureComparisonMetric({
  label,
  next,
  value,
}: {
  label: string;
  next: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
      <dt className="text-[0.68rem] uppercase tracking-normal text-slate-500">{label}</dt>
      <dd className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 text-sm font-semibold">
        <span className="min-w-0 break-words text-slate-200">{value}</span>
        <span aria-hidden="true" className="text-slate-500">→</span>
        <span className="min-w-0 break-words text-signal">{next}</span>
      </dd>
    </div>
  );
}

export type MoonStructureLevelInfoRow = {
  cost: Resources;
  durationSeconds: number;
  effect: string;
  level: number;
  status: "current" | "next" | "future";
};

export function MoonStructureLevelInfoModal({
  buildingKey,
  buildingLabel,
  currentLevel,
  onClose,
  rows,
}: {
  buildingKey: MoonBuilding["key"];
  buildingLabel: string;
  currentLevel: number;
  onClose: () => void;
  rows: MoonStructureLevelInfoRow[];
}) {
  const table = moonStructureLevelInfoTable(buildingKey, currentLevel, rows);
  return LevelInfoModal({
    ...table,
    itemLabel: buildingLabel,
    onClose,
  });
}

export function moonStructureLevelInfoTable(
  buildingKey: MoonBuilding["key"],
  currentLevel: number,
  rows: MoonStructureLevelInfoRow[],
): StructureLevelInfo {
  return {
    columns: moonStructureLevelInfoColumns(buildingKey),
    currentLevel,
    rows: rows.map((row) => ({
    cells: {
      cost: formatCost(row.cost),
      duration: formatDuration(row.durationSeconds),
      effect: row.effect,
    },
    key: row.level,
    level: row.level,
    status: row.status,
    })),
  };
}

export function moonStructureHasLevelInfo(key: MoonBuilding["key"]): boolean {
  return key !== "jumpGate";
}

export function moonStructureLevelInfoColumns(_key: MoonBuilding["key"]): LevelInfoColumn[] {
  return [
    { key: "cost", label: "Upgrade cost", headerClassName: "min-w-52" },
    { key: "duration", label: "Build time", headerClassName: "min-w-32" },
    { key: "effect", label: "Effect", headerClassName: "min-w-60" },
  ];
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
  return (
    <ProductionSection
      actionPending={false}
      canTransact={false}
      emptyLabel="No ships are stationed on this moon."
      items={(quantities) => moonShipProductionItems({ moonState, quantities })}
      onBuild={() => undefined}
      onSelect={onSelectShip}
      selectedKey={selectedShipKey}
      title="Stationed fleet"
    />
  );
}

function MoonDefenseSection({
  actionPending,
  canTransact,
  moonState,
  onOpenRequirement,
  onSelectDefense,
  onStartDefense,
  selectedDefenseKey,
  transactionUnavailableReason,
}: {
  actionPending: boolean;
  canTransact: boolean;
  moonState?: ChainMoonState | null | undefined;
  onOpenRequirement?: ((target: RequirementTarget) => void) | undefined;
  onSelectDefense: (key: DefenseKey) => void;
  onStartDefense?: MoonPageProps["onStartDefense"];
  selectedDefenseKey: DefenseKey;
  transactionUnavailableReason?: string | undefined;
}) {
  return (
    <ProductionSection
      actionPending={actionPending}
      canTransact={canTransact}
      emptyLabel="No moon defenses are available yet."
      items={(quantities) => moonDefenseProductionItems({
        actionPending,
        canTransact,
        moonState,
        quantities,
        transactionUnavailableReason,
      })}
      onBuild={(item) => onStartDefense?.(item.id, item.label, item.quantity)}
      onOpenRequirement={onOpenRequirement}
      onSelect={onSelectDefense}
      queue={productionQueueViewModel(moonState?.defenseQueue, defenseCatalog)}
      queueTone="rose"
      selectedKey={selectedDefenseKey}
      title="Defenses"
    />
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

export function moonShipProductionItems({
  moonState,
  quantities,
}: {
  moonState?: ChainMoonState | null | undefined;
  quantities: Record<string, ProductionQuantityInput>;
}): ProductionCatalogItem<ShipKey>[] {
  const moonShips = moonState?.ships ?? moonState?.fleet ?? [];

  const resources = toResources(moonState?.resourcesAsOfNow ?? moonState?.resources);
  return adaptProductionItems<ShipKey, (typeof shipyardCatalog)[number]>(shipyardCatalog, quantities, (ship, { quantity, quantityValid }) => {
    const chainShip = moonShips.find((item) => item.id === ship.id);
    const count = chainShip?.count ?? 0;
    const unitCost = toResources(chainShip?.cost);
    const totalCost = unitCost && quantityValid ? scaleProductionCost(unitCost, quantity) : undefined;
    const durationSeconds = chainShip?.durationSeconds === undefined
      ? undefined
      : chainShip.durationSeconds * quantity;

    return {
      actionLabel: "Stationed",
      blockedReason: "Moon shipyard is a stationed fleet view. Build ships from a planet Shipyard.",
      cost: totalCost,
      unitCost,
      maxQuantity: maxAffordableProductionQuantity(resources, unitCost),
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      countLabel: "On moon",
      countValue: count,
      detailSections: moonShipDetailSections({ count, durationSeconds, ship, totalCost, unitCost }),
      detailNote: ship.description,
      disabled: true,
      groupLabel: moonShipGroupLabel(ship.group),
      labelTone: count > 0 ? "normal" : "muted",
      missing: [],
      readOnly: true,
      requirements: [],
      status: count > 0 ? "ready" : "unavailable",
      statusLabel: count > 0 ? "Stationed" : undefined,
    };
  }).filter((item) => (item.countValue ?? 0) > 0);
}

export function moonDefenseProductionItems({
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
  const resources = toResources(moonState?.resourcesAsOfNow ?? moonState?.resources);
  const sharedItems = defenseProductionItems({
    actionPending,
    canTransact,
    defenseState: moonState ? {
      wallet: moonState.wallet,
      homePlanetId: moonState.moon?.exists ? moonState.homePlanetId : null,
      productionAvailable: moonState.moonAvailable !== false,
      resources: moonState.resources ?? null,
      shipyardLevel: moonBuildingLevels(moonState).shipyard,
      naniteLevel: 0,
      missileSiloLevel: 0,
      technologyLevels: moonState.technologyLevels ?? {},
      defenses: moonState.defenses,
      queue: moonState.defenseQueue ?? null,
    } : null,
    productionAvailable: moonState?.moonAvailable !== false,
    quantities,
    queue: moonState?.defenseQueue ?? undefined,
    resources,
    transactionUnavailableReason,
  });

  return sharedItems.filter((item) => item.group !== "missile").map((item) => {
    const available = moonState?.defenses.some((defense) => defense.id === item.id) ?? false;
    const moonBlocker = !canTransact
      ? transactionUnavailableReason ?? "Wallet or moon contract unavailable"
      : moonState && !moonState.moon?.exists
        ? "No selected moon"
        : moonState && !available
          ? "Defense unavailable on current moon deployment"
          : queueBlocked
            ? "Moon defense queue is active"
            : undefined;
    const blockedReason = moonBlocker ?? item.blockedReason;

    return {
      ...item,
      blockedReason,
      countLabel: "On moon",
      disabled: Boolean(blockedReason) || actionPending,
      labelTone: blockedReason ? "muted" : item.labelTone,
    };
  });
}

function moonShipDetailSections({
  count,
  durationSeconds,
  ship,
  totalCost,
  unitCost,
}: {
  count: number;
  durationSeconds: number | undefined;
  ship: (typeof shipCatalog)[number];
  totalCost: Resources | undefined;
  unitCost: Resources | undefined;
}): ProductionDetailSection[] {
  return [{
    title: "Stationed",
    stats: [
      { label: "On moon", value: count.toLocaleString("en-US") },
      { label: "Unit", value: ship.group === "civil" ? "Civil ship" : ship.group === "combat" ? "Combat ship" : "Special unit" },
      { label: "Total cost", value: totalCost ? formatCost(totalCost) : "-", wide: true },
      { label: "Per unit", value: unitCost ? formatCost(unitCost) : "-", wide: true },
      ...(durationSeconds === undefined ? [] : [{ label: "Build time", value: formatDuration(durationSeconds), wide: true }]),
    ],
  }];
}

function moonShipGroupLabel(group: (typeof shipCatalog)[number]["group"]): string {
  if (group === "civil") return "Civil and economy";
  if (group === "combat") return "Combat ships";
  return "Satellites and specials";
}

function toResources(resources: ChainMoonState["resources"] | ChainMoonState["defenses"][number]["cost"] | null | undefined): Resources | undefined {
  if (!resources) return undefined;
  return {
    metal: Number(resources.metal),
    crystal: Number(resources.crystal),
    deuterium: Number(resources.deuterium),
  };
}

export function moonBuildingAsset(key: ChainMoonState["buildings"][number]["key"]): string {
  const fallback = "/assets/game/style-pass/generated/buildings/terraformer-mid.webp";
  if (key === "lunarBase") return "/assets/game/style-pass/generated/buildings/lunar-base.webp";
  if (key === "roboticsFactory") return "/assets/game/style-pass/generated/buildings/moon-robotics-factory.webp";
  if (key === "shipyard") return "/assets/game/style-pass/generated/buildings/moon-shipyard.webp";
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
  target?: RequirementTarget | undefined;
};

export type MoonStructureStatus = {
  cost: Resources;
  costAvailable: boolean;
  disabled: boolean;
  durationSeconds?: number | undefined;
  reason: string;
  requirements: RequirementRow[];
  targetLevel: number;
};

export function moonStructureStatus(
  building: MoonBuilding,
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
  options: {
    canTransact?: boolean | undefined;
    pending?: boolean | undefined;
    transactionUnavailableReason?: string | undefined;
  } = {},
): MoonStructureStatus {
  const cost = moonStructureUpgradeCost(building);
  const spendable = resourcesFromChain(moonState?.resourcesAsOfNow ?? moonState?.resources);
  const requirements = moonBuildingRequirementRows(building, moon, moonState);
  const targetLevel = moonStructureTargetLevel(building);
  const costAvailable = moonStructureCostAvailable(cost);
  const base = {
    cost,
    costAvailable,
    durationSeconds: moonStructureBuildDurationSeconds(building, targetLevel, moonState),
    requirements,
    targetLevel,
  };

  if (!options.canTransact) {
    return {
      ...base,
      disabled: true,
      reason: options.transactionUnavailableReason ?? "Wallet or moon contract unavailable.",
    };
  }

  if (options.pending) {
    return {
      ...base,
      disabled: true,
      reason: "A moon transaction is already pending.",
    };
  }

  const activeQueueReason = activeQueueTitle(moonState?.queue);
  if (activeQueueReason) {
    return {
      ...base,
      disabled: true,
      reason: activeQueueReason,
    };
  }

  const missingRequirement = firstMissingRequirementLabel(requirements);
  if (missingRequirement) {
    return {
      ...base,
      disabled: true,
      reason: missingRequirement,
    };
  }

  if (!costAvailable) {
    return {
      ...base,
      disabled: true,
      reason: "Moon structure cost unavailable. Refresh moon state before building.",
    };
  }

  if (!canAfford(spendable, cost)) {
    return {
      ...base,
      disabled: true,
      reason: "Moon resources are below the build cost.",
    };
  }

  return {
    ...base,
    disabled: false,
    reason: building.level === 0 ? `Ready to build ${building.label}` : `Ready for Level ${targetLevel}`,
  };
}

function moonStructureTargetLevel(building: MoonBuilding): number {
  return isBinaryMoonStructure(building.key) ? 1 : building.level + 1;
}

function isBinaryMoonStructure(key: MoonBuilding["key"]): boolean {
  return key === "jumpGate";
}

function moonStructureLevelSummary(building: MoonBuilding, targetLevel: number): string {
  if (isBinaryMoonStructure(building.key)) {
    return building.level > 0 ? "Built on this moon" : "Build on this moon";
  }
  return building.level === 0 ? `Build Level ${targetLevel}` : `Level ${building.level} to ${targetLevel}`;
}

function moonStructureCatalogTitleTone(
  status: Pick<MoonStructureStatus, "disabled" | "reason">,
): "normal" | "muted" {
  return status.disabled && (
    status.reason.startsWith("Lunar Base")
    || status.reason.startsWith("Robotics Factory")
    || status.reason.startsWith("Hyperspace")
    || status.reason.includes("open field")
  )
    ? "muted"
    : "normal";
}

function moonStructureCatalogStatusText(building: MoonBuilding): string {
  void building;
  return "";
}

export function moonBuildingRequirementRows(
  building: MoonBuilding,
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): RequirementRow[] {
  const levels = moonBuildingLevels(moonState);
  const fieldSummary = moonFieldSummary(moon, moonState);
  const moonStructureTarget = (key: MoonBuilding["key"]): RequirementTarget | undefined => (
    moonState?.buildings.some((candidate) => candidate.key === key)
      ? { kind: "moonStructure", key }
      : undefined
  );
  const rows: RequirementRow[] = [{
    label: fieldSummary.open === 1 ? "1 open field" : `${fieldSummary.open} open fields`,
    met: fieldSummary.open > 0,
    status: fieldSummary.open > 0 ? "Available" : "No open fields",
  }];

  if (building.key !== "lunarBase" && levels.lunarBase === 0) {
    rows.push({
      label: "Lunar Base level 1",
      met: false,
      status: "Current level 0",
      target: moonStructureTarget("lunarBase"),
    });
  }

  if (building.key === "shipyard") {
    const robotics = levels.roboticsFactory;
    rows.push({
      label: "Robotics Factory level 2",
      met: robotics >= 2,
      status: `Current level ${robotics}`,
      target: moonStructureTarget("roboticsFactory"),
    });
  }

  if (building.key === "jumpGate") {
    const lunarBase = levels.lunarBase;
    const hyperspace = moonState?.technologyLevels?.["8"] ?? 0;
    rows.push({
      label: "Lunar Base level 1",
      met: lunarBase >= 1,
      status: `Current level ${lunarBase}`,
      target: moonStructureTarget("lunarBase"),
    }, {
      label: "Hyperspace level 7",
      met: hyperspace >= 7,
      status: `Current level ${hyperspace}`,
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

export function moonStructureQueueProgress(
  queue: ChainMoonState["queue"] | undefined,
): { readyAt: number; startedAt: number } | undefined {
  if (!queue?.active) return undefined;
  const readyAt = timestampToMs(queue.readyAt);
  const startedAt = timestampToMs(queue.startedAt);
  if (readyAt === undefined || startedAt === undefined) return undefined;
  return { readyAt, startedAt };
}

function activeQueueTitle(queue: ChainMoonState["queue"] | undefined): string | undefined {
  if (!queue?.active) return undefined;
  return queueReady(queue)
    ? undefined
    : "Moon queue is active.";
}

function moonRequirementFlairs(rows: RequirementRow[]): RequirementFlair[] {
  return rows.map((row) => ({
    label: row.label,
    met: row.met,
    target: row.target,
  }));
}

function moonStructureCostAvailable(cost: Resources): boolean {
  return cost.metal > 0 || cost.crystal > 0 || cost.deuterium > 0;
}

function moonStructureUpgradeCost(building: MoonBuilding, level = building.level + 1): Resources {
  const chainCost = resourcesFromChain(building.cost);
  if (moonStructureCostAvailable(chainCost)) return chainCost;
  return moonStructureCatalogCost(building.key, Math.max(0, level - 1));
}

function moonStructureCatalogCost(key: MoonBuilding["key"], currentLevel: number): Resources {
  const base = moonStructureBaseCost(key);
  const multiplier = 2 ** Math.max(0, currentLevel);
  return {
    metal: base.metal * multiplier,
    crystal: base.crystal * multiplier,
    deuterium: base.deuterium * multiplier,
  };
}

function moonStructureBaseCost(key: MoonBuilding["key"]): Resources {
  if (key === "lunarBase") return { metal: 20_000, crystal: 40_000, deuterium: 20_000 };
  if (key === "jumpGate") return { metal: 2_000_000, crystal: 4_000_000, deuterium: 2_000_000 };
  const planetBuilding = buildingCatalog.find((building) => building.key === key);
  return planetBuilding?.baseCost ?? { metal: 0, crystal: 0, deuterium: 0 };
}

export function moonStructureLevelInfoRows(
  building: MoonBuilding,
  moon: NonNullable<ChainMoonState["moon"]>,
  moonState: ChainMoonState | null | undefined,
): MoonStructureLevelInfoRow[] {
  const currentLevel = building.level;
  const highestLevel = isBinaryMoonStructure(building.key)
    ? 1
    : MAX_BUILDING_LEVEL;
  return Array.from({ length: highestLevel }, (_, index) => {
    const level = index + 1;
    const status = level === currentLevel ? "current" : level === currentLevel + 1 ? "next" : "future";
    return {
      cost: level === currentLevel + 1 ? moonStructureUpgradeCost(building, level) : moonStructureCatalogCost(building.key, level - 1),
      durationSeconds: moonStructureBuildDurationSeconds(building, level, moonState),
      effect: moonStructureLevelEffect(building.key, level),
      level,
      status,
    };
  });
}

function moonStructureBuildDurationSeconds(
  building: MoonBuilding,
  level: number,
  moonState: ChainMoonState | null | undefined,
): number {
  if (level === building.level + 1 && building.durationSeconds !== undefined) {
    return building.durationSeconds;
  }

  const moonLevels = moonBuildingLevels(moonState);
  const roboticsLevel = building.key === "roboticsFactory"
    ? Math.max(0, level - 1)
    : moonLevels.roboticsFactory;
  const estimatedBuildings = {
    metalMine: 0,
    crystalMine: 0,
    deuteriumSynthesizer: 0,
    solarPlant: 0,
    roboticsFactory: roboticsLevel,
    shipyard: building.key === "shipyard" ? Math.max(0, level - 1) : moonLevels.shipyard,
    researchLab: 0,
    terraformer: 0,
    fusionReactor: 0,
    naniteFactory: 0,
    metalStorage: 0,
    crystalStorage: 0,
    deuteriumTank: 0,
    allianceDepot: 0,
    missileSilo: 0,
    interdimensionalRiftStabilizer: 0,
  };
  return buildingDurationEstimate(
    estimatedBuildings,
    moonStructureCatalogCost(building.key, Math.max(0, level - 1)),
  );
}

function moonStructureLevelText(building: MoonBuilding): string {
  return building.level > 0 ? `Level ${building.level}` : "Not built";
}

function moonBuildingEffect(key: ChainMoonState["buildings"][number]["key"]): string {
  if (key === "lunarBase") return "Adds 3 gross fields and consumes 1 field.";
  if (key === "roboticsFactory") return "Reduces moon facility build time and unlocks the moon Shipyard.";
  if (key === "shipyard") return "Unlocks and speeds moon defense construction.";
  return "Enables fleet jumps between owned moons.";
}

function moonStructureLevelEffect(key: ChainMoonState["buildings"][number]["key"], level: number): string {
  if (level <= 0) return "Not built";
  if (key === "lunarBase") return `+${level * 3} gross fields`;
  if (key === "roboticsFactory") return `Construction speed x${level + 1}`;
  if (key === "shipyard") return `Defense production speed x${level + 1}`;
  return "Moon-to-moon fleet jumps enabled";
}

function moonBuildingLabel(itemId: number | undefined): string {
  return [
    { id: 0, label: "Lunar Base" },
    { id: 1, label: "Robotics Factory" },
    { id: 2, label: "Jump Gate" },
    { id: 3, label: "Shipyard" },
  ].find((building) => building.id === itemId)?.label ?? "Moon building";
}

function moonBuildingAssetForId(itemId: number | undefined): string | undefined {
  const building = [
    { id: 0, key: "lunarBase" as const },
    { id: 1, key: "roboticsFactory" as const },
    { id: 2, key: "jumpGate" as const },
    { id: 3, key: "shipyard" as const },
  ].find((candidate) => candidate.id === itemId);
  return building ? moonBuildingAsset(building.key) : undefined;
}

function firstMissingRequirementLabel(rows: RequirementRow[]): string | undefined {
  const row = rows.find((candidate) => !candidate.met);
  return row ? `Requires ${row.label}${row.status ? ` (${row.status})` : ""}` : undefined;
}

function isMoonBuildingKey(key: string, buildings: MoonBuilding[]): key is MoonBuilding["key"] {
  return buildings.some((building) => building.key === key);
}

function moonOrbitParentLabel(parentPlanetLabel: string | undefined, planetId: string): string {
  const trimmed = parentPlanetLabel?.trim();
  return trimmed || `parent planet #${planetId}`;
}

function formatMoonReadyAt(value: string | null | undefined): string {
  if (!value || value === "0") return "Ready";
  return formatUserTimestamp(value);
}
