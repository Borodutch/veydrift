import { render } from "preact";
import { AttackOutcomePanel, preparePublicTargetBattleForecast, useDeferredPublicTargetBattleForecast } from "../../src/components/MissionCreationPage";
import { CONTRACT_COMBAT_MODEL_VERSION } from "../../src/battlePreview";
import { emptyMissionShips } from "../../src/galaxyActions";
import "../../src/styles.css";

// Only capability/transport clocks are virtual. Preact and the real report worker
// keep their native scheduling, so this exercises mounted state, not a boolean gate.
let now = 0;
Object.defineProperty(performance, "now", { value: () => now });
const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const timers = new Map<number, { at: number; delay: number; callback: () => void }>();
let timerId = -1;
window.setTimeout = ((callback: () => void, delay: number, ...args: unknown[]) => {
  if (![5_000, 15_000, 20_000].includes(delay)) return nativeSetTimeout(callback, delay, ...args);
  const id = timerId--;
  timers.set(id, { at: now + delay, delay, callback });
  return id;
}) as typeof setTimeout;
window.clearTimeout = ((id: number) => {
  if (!timers.delete(id)) nativeClearTimeout(id);
}) as typeof clearTimeout;

type Mode = "success" | "mismatch" | "failure" | "pending";
let mode: Mode = "success";
let pendingPath = "/combat-model";
let requests = 0;
const pending: { signal: AbortSignal; resolve: (response: Response) => void; path: string }[] = [];
const response = (path: string, mismatch = false) => Response.json(path.endsWith("/runtime-config")
  ? { apiUrl: "https://combat-fixture.invalid" }
  : { version: mismatch ? -1 : CONTRACT_COMBAT_MODEL_VERSION });
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  if (!path.endsWith("/runtime-config") && !path.endsWith("/combat-model")) throw new Error("Unexpected fixture fetch: " + path);
  requests++;
  if (mode === "pending" && path.endsWith(pendingPath)) {
    // Deliberately ignore abort to exercise stale-response guards.
    return new Promise<Response>(resolve => pending.push({ signal: init!.signal!, resolve, path }));
  }
  if (mode === "failure") throw new Error("Fixture transport failure");
  return response(path, mode === "mismatch");
}) as typeof fetch;

// Mount the real composer hook, cache, disclosure and report worker.
const prepared = preparePublicTargetBattleForecast(
  { ...emptyMissionShips(), cruiser: 3 },
  { id: "812", name: "Target", owner: "0xdef", occupiedBy: null, publicState: {
    fleet: [{ id: 1, count: 2 }], defenses: [], research: [],
    stationedDefenderForecastTimeline: [], stationedDefenderTimelineComplete: true,
  } },
  { weapons: 2, shielding: 3, armor: 4 }, false, undefined,
  { projectedAttackArrivalAt: Date.now() / 1000 + 600 },
);
function Forecast() {
  const forecast = useDeferredPublicTargetBattleForecast(prepared);
  return <AttackOutcomePanel battleForecast={forecast} />;
}
const app = document.getElementById("app")!;
Object.assign(window, { fixture: {
  mount: () => render(<Forecast />, app),
  unmount: () => render(null, app),
  mode(value: Mode, path = "/combat-model") { mode = value; pendingPath = path; },
  timers: () => [...timers.values()].map(timer => timer.delay),
  requests: () => requests,
  pending: () => pending.map(request => ({ aborted: request.signal.aborted, path: request.path })),
  resolve() { for (const request of pending.splice(0)) request.resolve(response(request.path)); },
  advance(ms: number, runTimers = true) {
    now += ms;
    if (!runTimers) return; // Simulate a throttled tab / delayed timer dispatch.
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
  },
} });
render(<Forecast />, app);
