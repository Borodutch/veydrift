import { render } from "preact";
import { useMemo } from "preact/hooks";
import { PublicMoonDetail } from "../../src/components/PublicMoonDetail";
import { shouldRefreshMissionActionStateForPage, shouldRefreshShipyardStateForPage } from "../../src/PlayableMvpApp";
import { backendDataStoreFor } from "../../src/backendDataStore";
import { useBackendDataQuery } from "../../src/useBackendDataQuery";
import { parseInspectPath } from "../../src/inspectRoutes";
import type { Page } from "../../src/components/NavBar";
import type { ChainDefenseState, ChainShipyardState } from "../../src/walletFlow";
import "../../src/styles.css";

// Offline component regression only: no wallet or real gameplay API.
const account = "0x1111111111111111111111111111111111111111";
const coords = { galaxy: 2, system: 44, position: 9 };
const shipyardState: ChainShipyardState = {
  wallet: account, homePlanetId: "7", productionAvailable: true, resources: null,
  shipyardLevel: 1, naniteLevel: 0, technologyLevels: {}, queue: null,
  ships: [{ id: 1, count: 2, cost: { metal: "0", crystal: "0", deuterium: "0" } }],
};
const requests: string[] = [];
const launches: unknown[] = [];
let resolveProtection: (() => void) | undefined;
let resolveOrigin: (() => void) | undefined;
let serial = 0;
let mode = "eligible";
window.fetch = async (input) => {
  const url = String(input);
  requests.push(url);
  if (url.includes("/shipyard")) {
    const requestMode = mode;
    if (requestMode.startsWith("origin-")) await new Promise<void>(resolve => { resolveOrigin = resolve; });
    return Response.json(requestMode === "no-ships" ? { ...shipyardState, ships: [] } : shipyardState);
  }
  if (url.includes("/defenses")) return Response.json({
    wallet: account, homePlanetId: "7", resources: null, shipyardLevel: 1, naniteLevel: 0,
    missileSiloLevel: 0, technologyLevels: {}, defenses: [], queue: null,
  });
  if (url.includes("/systems/")) return Response.json({ galaxy: 2, system: 44, planets: [{
    ...coords, key: "2:44:9", fields: 211, temperature: -8, hasMoon: true,
    metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000,
    occupiedBy: { owner: mode === "own" ? account : "0x2222222222222222222222222222222222222222", planetId: "9" },
    publicMoonState: { resources: { metal: "1", crystal: "2", deuterium: "3" } },
  }] });
  if (url.includes("/attack-protection")) {
    const requestMode = mode.replace(/^origin-/, "");
    if (requestMode === "loading") await new Promise<void>(resolve => { resolveProtection = resolve; });
    if (requestMode === "failed") return Response.json({ error: "Unavailable" }, { status: 503 });
    const restricted = ["same_alliance", "score_protection", "bashing_limit"].includes(requestMode);
    return Response.json({ allowed: !restricted, blockedReason: restricted ? requestMode : "none", blockedReasonLabel: null, targetPlanetId: requestMode === "mismatch" ? "999" : "9" });
  }
  if (url.includes("/missions")) return Response.json({ missions: [] });
  throw new Error("Unexpected fixture request: " + url);
};
function RouteFixture({ path, fixtureId }: { path: string; fixtureId: number }) {
  const route = parseInspectPath(path);
  const page: Page = route?.kind === "moon" ? "moon-inspect" : "research";
  const apiBaseUrl = location.origin + "/fixture-api/" + fixtureId;
  const backendData = useMemo(() => backendDataStoreFor(apiBaseUrl), [apiBaseUrl]);
  // Exercise the actual app route gates and canonical query subscriptions,
  // rather than handing PublicMoonDetail already-loaded origin inventory.
  const shipyard = useBackendDataQuery(backendData.queries.shipyard(account, "7"), shouldRefreshShipyardStateForPage(page));
  const defenses = useBackendDataQuery<ChainDefenseState>(backendData.queries.defenses(account, "7"), shouldRefreshMissionActionStateForPage(page));
  return route?.kind !== "moon" ? <p>Research fixture</p> : <div data-origin-loaded={Boolean(shipyard.snapshot?.data)} data-defense-loaded={Boolean(defenses.snapshot?.data)}>
    <PublicMoonDetail apiBaseUrl={apiBaseUrl}
      account={mode === "disconnected" ? undefined : account} coords={route.coords}
      homeCoords={mode === "own" ? coords : { ...coords, position: 1 }} homePlanetId="7"
      shipyardState={shipyard.snapshot?.data ?? null} defenseState={defenses.snapshot?.data ?? null}
      onAction={mode === "no-callback" ? undefined : (action, target, destination) => launches.push({ action, targetId: target?.occupiedBy?.planetId, coords: destination })}
      actionState={mode === "busy" ? { status: "pending", label: "Preparing mission…" } : { status: "idle" }}
      onBack={() => {}} /></div>;
}
function navigate(path: string) {
  render(<RouteFixture key={serial} path={path} fixtureId={serial} />, document.getElementById("app")!);
}
function show(next = "eligible", path = "/moon/2/44/9") {
  mode = next;
  serial++;
  resolveOrigin = undefined;
  resolveProtection = undefined;
  navigate(path);
}
Object.assign(window, { fixture: { show, navigate, requests, launches, release: () => resolveProtection?.(), releaseOrigin: () => resolveOrigin?.() } });
document.body.style.background = "#05070d";
document.getElementById("app")!.style.cssText = "max-width:1100px;margin:16px auto;padding:0 12px";
show(new URLSearchParams(location.search).get("mode") ?? "eligible");
