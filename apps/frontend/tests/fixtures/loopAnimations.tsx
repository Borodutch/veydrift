// Local-only real-component fixture. No wallet, API, or production entry imports this file.
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { LOOP_ANIMATIONS, loopAnimationNameForStill } from "../../loopAnimationConfig";
import { InspectDetailImage } from "../../src/components/InspectProgressLayout";
import { AssetImage, OptimizedImage } from "../../src/components/OptimizedImage";
import { ProductionCatalog, type ProductionCatalogItem } from "../../src/components/ProductionCatalog";
import { moonBuildingAsset, shipAssetByKey } from "../../src/gameAssets";
import { buildingCatalog, shipyardCatalog } from "../../src/playableMvp";
import "../../src/styles.css";

const stills = [
  ...buildingCatalog.map((building) => building.asset),
  ...(["lunarBase", "roboticsFactory", "jumpGate", "shipyard"] as const).map(moonBuildingAsset),
  ...shipyardCatalog.map((ship) => ship.asset),
];
const items: ProductionCatalogItem[] = shipyardCatalog.map((item) => ({
  ...item, groupLabel: "Ships", countLabel: "Owned", countValue: 3,
  status: "ready", cost: { metal: 2000, crystal: 500, deuterium: 100 },
  unitCost: { metal: 2000, crystal: 500, deuterium: 100 },
  unitCostRaw: { metal: "2000", crystal: "500", deuterium: "100" },
  durationSeconds: 720, requirements: [], missing: [], quantity: 1, disabled: false,
  actionLabel: "Build", detailNote: "", queued: 0,
}));
const noop = () => undefined;
const fixture = {
  inspect: (_asset: string, _cacheKey: string) => undefined as void,
  loops: LOOP_ANIMATIONS,
  refLoad: null as null | { complete: boolean; sameAsRef: boolean },
  select: (_key: string) => undefined as void,
  stills: Object.fromEntries(stills.map((src) => [src, loopAnimationNameForStill(src) ?? null])),
};
(window as unknown as { loopFixture: unknown }).loopFixture = fixture;

function Catalog() {
  const [selected, setSelected] = useState("cruiser");
  fixture.select = setSelected;
  return <ProductionCatalog actionPending={false} canTransact emptyLabel="" items={items} now={1_790_279_000_000}
    onBuild={noop} onQuantity={noop} onSelect={noop} selectedKey={selected as never} />;
}

// The real inspect panel image, with its skeleton and "already cached" fast path.
function Inspect() {
  const [shown, setShown] = useState({ asset: shipAssetByKey.cruiser, cacheKey: "initial" });
  fixture.inspect = (asset, cacheKey) => setShown({ asset, cacheKey });
  return <InspectDetailImage asset={shown.asset} cacheKey={shown.cacheKey} isDimmed={false} />;
}

// What an imageRef + onLoad caller sees for a loop asset.
function RefProbe() {
  const ref = useRef<HTMLImageElement>(null);
  return <OptimizedImage alt="" className="h-full w-full object-cover" imageRef={ref} sizes="64px" src={shipAssetByKey.destroyer}
    onLoad={(event) => { fixture.refLoad = { complete: event.currentTarget.complete, sameAsRef: event.currentTarget === ref.current }; }} />;
}

render(<main style={{ maxWidth: "1200px", margin: "0 auto", padding: "8px" }}>
  <div className="flex flex-wrap gap-1">
    {stills.map((src) => <div className="h-16 w-16 overflow-hidden rounded" data-tile={src} key={src}>
      <OptimizedImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="64px" src={src} />
    </div>)}
  </div>
  <div className="mt-2 flex gap-2">
    <span data-icon="cruiser"><AssetImage alt="" className="h-6 w-6 rounded object-cover" height={24} loading="lazy" src={shipAssetByKey.cruiser} width={24} /></span>
    <span data-responsive style={{ display: "block", height: "64px", width: "64px" }}><OptimizedImage alt="" className="h-full w-full object-cover" sizes="64px" src={shipAssetByKey.battlecruiser} /></span>
    <span data-icon="small-cargo"><AssetImage alt="" className="h-6 w-6 rounded object-cover" height={24} loading="lazy" src={shipAssetByKey.smallCargo} width={24} /></span>
    <span data-ref-probe style={{ display: "block", height: "64px", width: "64px" }}><RefProbe /></span>
    <span className="block w-36" data-inspect><Inspect /></span>
  </div>
  <section className="mt-2" data-catalog>
    <Catalog />
  </section>
  <div style={{ height: "4000px" }} />
  <div className="h-32 w-32" id="offscreen">
    <OptimizedImage alt="Cruiser" className="h-full w-full object-cover" loading="lazy" sizes="128px" src={shipAssetByKey.cruiser} />
  </div>
</main>, document.getElementById("app")!);
