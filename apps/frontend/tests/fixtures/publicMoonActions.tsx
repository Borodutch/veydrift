import { render } from "preact";
import { PublicMoonDetail } from "../../src/components/PublicMoonDetail";
import type { ChainShipyardState } from "../../src/walletFlow";
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
let serial = 0;
let mode = "eligible";
window.fetch = async (input) => {
  const url = String(input);
  requests.push(url);
  if (url.includes("/systems/")) return Response.json({ galaxy: 2, system: 44, planets: [{
    ...coords, key: "2:44:9", fields: 211, temperature: -8, hasMoon: true,
    metalMultiplierBps: 10000, crystalMultiplierBps: 10000, deuteriumMultiplierBps: 10000,
    occupiedBy: { owner: mode === "own" ? account : "0x2222222222222222222222222222222222222222", planetId: "9" },
    publicMoonState: { resources: { metal: "1", crystal: "2", deuterium: "3" } },
  }] });
  if (url.includes("/attack-protection")) {
    const requestMode = mode;
    if (requestMode === "loading") await new Promise<void>(resolve => { resolveProtection = resolve; });
    if (requestMode === "failed") return Response.json({ error: "Unavailable" }, { status: 503 });
    const restricted = ["same_alliance", "score_protection", "bashing_limit"].includes(requestMode);
    return Response.json({ allowed: !restricted, blockedReason: restricted ? requestMode : "none", blockedReasonLabel: null, targetPlanetId: requestMode === "mismatch" ? "999" : "9" });
  }
  if (url.includes("/missions")) return Response.json({ missions: [] });
  throw new Error("Unexpected fixture request: " + url);
};
function show(next = "eligible") {
  mode = next;
  render(<PublicMoonDetail key={++serial} apiBaseUrl={location.origin + "/fixture-api/" + serial}
    account={mode === "disconnected" ? undefined : account} coords={coords}
    homeCoords={mode === "own" ? coords : { ...coords, position: 1 }} homePlanetId="7"
    shipyardState={mode === "no-ships" ? { ...shipyardState, ships: [] } : shipyardState}
    onAction={mode === "no-callback" ? undefined : (action, target, destination) => launches.push({ action, targetId: target?.occupiedBy?.planetId, coords: destination })}
    actionState={mode === "busy" ? { status: "pending", label: "Preparing mission…" } : { status: "idle" }}
    onBack={() => {}} />, document.getElementById("app")!);
}
Object.assign(window, { fixture: { show, requests, launches, release: () => resolveProtection?.() } });
document.body.style.background = "#05070d";
document.getElementById("app")!.style.cssText = "max-width:1100px;margin:16px auto;padding:0 12px";
show(new URLSearchParams(location.search).get("mode") ?? "eligible");
