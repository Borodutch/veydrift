import { render } from "preact";
import { PlanetFleetActivityPanel, planetFleetActivityRows } from "../../src/components/PlanetDetail";
import type { FleetMissionSummary } from "../../src/walletFlow";
import "../../src/styles.css";

// Deterministic presentation-only fixture. No wallet, backend or mutation calls.
let now = Date.parse("2026-09-30T00:00:00Z");
Date.now = () => now;
const timers = new Map<number, () => void>();
let timerId = 0;
window.setInterval = ((callback: () => void) => { timers.set(++timerId, callback); return timerId; }) as typeof setInterval;
window.clearInterval = ((id: number) => { timers.delete(id); }) as typeof clearInterval;
let fetches = 0;
window.fetch = (() => { fetches++; throw new Error("Unexpected fixture fetch"); }) as typeof fetch;
const missions = [
  { missionId: "95088", status: "Outbound", missionType: "GroupDefend", originPlanetId: "7", targetPlanetId: "9", arrivalAt: String(now / 1000 + 93784) },
  { missionId: "95163", status: "Outbound", missionType: "Attack", originPlanetId: "9", targetPlanetId: "7", arrivalAt: String(now / 1000 + 60) },
  { missionId: "94825", status: "Returning", missionType: "Transport", originPlanetId: "7", targetPlanetId: "9", returnAt: String(now / 1000 + 2) },
  { missionId: "94826", status: "Recalled", missionType: "Attack", originPlanetId: "7", targetPlanetId: "9", returnAt: String(now / 1000 - 1) },
  { missionId: "94827", status: "Outbound", missionType: "Transport", originPlanetId: "7", targetPlanetId: "9", arrivalAt: "" },
].map(mission => ({ owner: "0xother", ships: { lightFighter: "20" }, arrivalAt: "", returnAt: "", ...mission })) as FleetMissionSummary[];
const root = document.getElementById("app")!;
function show() {
  render(<main style={{ maxWidth: "820px", margin: "16px auto", padding: "0 12px" }}><PlanetFleetActivityPanel loading={false} rows={planetFleetActivityRows("7", missions, "planet", "0xown")} /></main>, root);
}
Object.assign(window, { fixture: {
  show,
  advance(ms: number) { now += ms; for (const callback of timers.values()) callback(); },
  timers: () => timers.size,
  fetches: () => fetches,
  returning() { missions[1]!.status = "Returning"; missions[1]!.returnAt = String(now / 1000 + 60); show(); },
  unmount() { render(null, root); },
} });
show();
document.body.style.background = "#05070d";
