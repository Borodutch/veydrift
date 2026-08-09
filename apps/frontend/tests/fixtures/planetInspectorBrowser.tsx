import { h, render } from "preact";
import { FirstPlanetSettlementApp } from "../../src/FirstPlanetSettlementApp";
import { PlayableMvpApp } from "../../src/PlayableMvpApp";
import { PlanetDetail } from "../../src/components/PlanetDetail";
import { PublicMoonDetail } from "../../src/components/PublicMoonDetail";
import type { Coordinates } from "../../src/types";
import type { Eip1193Provider, ManagedPlanetResponse } from "../../src/walletFlow";
import "../../src/styles.css";

declare global {
  interface Window {
    inspectorProof: {
      account: string;
      appReady: boolean;
      errors: string[];
      interactions: Array<{ isTrusted: boolean; pointerType?: string; target: string; type: string }>;
      requests: string[];
      walletRequests: Array<{ method: string; params?: unknown[] }>;
      beginDetailRace(kind: "moon" | "planet"): void;
      pendingDetailRequests(): string[];
      resolveDetailRequest(key: string): void;
    };
  }
}

const account = "0x1111111111111111111111111111111111111111";
const unrelatedOwner = "0x9999999999999999999999999999999999999999";
const appRoot = document.querySelector("#app") as HTMLElement;
const fixtureParams = new URLSearchParams(window.location.search);
const route = fixtureParams.get("route") ?? "/planet/9/9/9";
const settlementShell = fixtureParams.get("shell") === "settlement";
const stallMissionBackgroundReads = fixtureParams.get("stallMissionBackgroundReads") === "true";
const walletEventOnPointerDown = fixtureParams.get("walletEventOnPointerDown");

const ownedPlanets = [
  managedPlanet({
    galaxy: 1,
    isHomePlanet: true,
    name: "Owned Alpha",
    planetId: "owned-a",
    position: 3,
    resources: { crystal: "3873", deuterium: "102", metal: "10313" },
    system: 2,
  }),
  managedPlanet({
    galaxy: 4,
    isHomePlanet: false,
    name: "Owned Beta",
    planetId: "owned-b",
    position: 6,
    resources: { crystal: "201", deuterium: "202", metal: "203" },
    system: 5,
  }),
];

const publicSystems = new Map([
  ["1:2", systemPayload(1, 2, 3, "Owned Alpha Public", account, "owned-a", 1101, true)],
  ["4:5", systemPayload(4, 5, 6, "Owned Beta Public", account, "owned-b", 2202, false)],
  ["9:9", systemPayload(9, 9, 9, "Unrelated Gamma", unrelatedOwner, "unrelated", 9909, true)],
]);

const pendingDetailRequests = new Map<string, (response: Response) => void>();
let detailRaceKind: "moon" | "planet" | null = null;
const fixtureErrors: string[] = [];
const fixtureInteractions: Array<{ isTrusted: boolean; pointerType?: string; target: string; type: string }> = [];
const fixtureRequests: string[] = [];
const walletRequests: Array<{ method: string; params?: unknown[] }> = [];
const providerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const originalConsoleError = console.error;
console.error = (...values) => {
  fixtureErrors.push(values.map(String).join(" "));
  originalConsoleError(...values);
};
window.addEventListener("error", (event) => fixtureErrors.push(`window-error:${event.message}`));
window.addEventListener("unhandledrejection", (event) => fixtureErrors.push(`unhandled:${event.reason?.stack ?? String(event.reason)}`));
for (const type of ["pointerdown", "click"] as const) {
  window.addEventListener(type, (event) => {
    const target = event.target instanceof Element
      ? `${event.target.tagName.toLowerCase()}:${event.target.textContent?.trim() ?? ""}`
      : "unknown";
    fixtureInteractions.push({
      isTrusted: event.isTrusted,
      ...(event instanceof PointerEvent ? { pointerType: event.pointerType } : {}),
      target,
      type,
    });
  }, { capture: true });
}

class FixtureEventSource extends EventTarget {
  close() {}
  onerror: ((event: Event) => void) | null = null;
}

Object.defineProperty(window, "EventSource", { configurable: true, value: FixtureEventSource });
Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FixtureEventSource });

const provider: Eip1193Provider = {
  on(event, listener) {
    const listeners = providerListeners.get(event) ?? new Set();
    listeners.add(listener);
    providerListeners.set(event, listeners);
  },
  removeListener(event, listener) {
    providerListeners.get(event)?.delete(listener);
  },
  request: async ({ method, params }) => {
    walletRequests.push({ method, ...(params ? { params } : {}) });
    if (method === "eth_chainId") return settlementShell ? "0x2105" : "0x14a34";
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
    if (method === "eth_sendTransaction") {
      // Keep the request pending like an open wallet confirmation. Browser tests
      // can prove the Build click reached the wallet without confirming/broadcasting.
      return new Promise<string>(() => undefined);
    }
    return null;
  },
};

globalThis.fetch = (async (input) => {
  const url = new URL(String(input), window.location.origin);
  fixtureRequests.push(`${url.pathname}${url.search}`);
  const systemMatch = url.pathname.match(/\/universe\/galaxies\/(\d+)\/systems\/(\d+)/);

  if (stallMissionBackgroundReads && (
    url.pathname.endsWith(`/wallet/${account}/missions`)
    || url.pathname.endsWith(`/wallet/${account}/missile-attacks`)
    || (url.pathname.endsWith("/missions") && url.searchParams.get("status") === "completed")
  )) {
    return new Promise<Response>(() => undefined);
  }

  if (detailRaceKind && systemMatch) {
    const key = `${systemMatch[1]}:${systemMatch[2]}`;
    return new Promise<Response>((resolve) => pendingDetailRequests.set(key, resolve));
  }

  if (url.pathname.endsWith("/runtime-config")) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return Response.json({
      allianceContractAddress: null,
      apiUrl: `${window.location.origin}/api`,
      chainId: settlementShell ? 8453 : 84532,
      contractAddress: "0x2222222222222222222222222222222222222222",
      featureSupport: {
        allianceConfigured: false,
        gameConfigured: true,
        highscoresEndpoint: true,
        moonConfigured: false,
        referralsConfigured: false,
        researchEndpoint: true,
        resourceTokensConfigured: false,
        settlementConfigured: true,
      },
      gameContractAddress: "0x2222222222222222222222222222222222222222",
      graphqlUrl: `${window.location.origin}/graphql`,
      moonContractAddress: null,
      network: settlementShell ? "base" : "base-sepolia",
      resourceTokenAddresses: { crystal: null, deuterium: null, metal: null },
      rpcProvider: "unknown",
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/overview`)) {
    return Response.json(walletOverview());
  }

  if (url.pathname.endsWith(`/wallet/${account}/settlement`)) {
    return Response.json(walletOverview().settlement);
  }

  if (url.pathname.endsWith(`/wallet/${account}/profile`)) {
    return Response.json({
      description: null,
      displayName: "Fixture Commander",
      fallbackName: "Fixture Commander",
      updatedAt: null,
      wallet: account,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/shipyard`)) {
    return Response.json({
      wallet: account,
      homePlanetId: "1",
      planetId: "1",
      productionAvailable: true,
      resources: { crystal: "3873", deuterium: "0", metal: "10313" },
      resourcesAsOfNow: { crystal: "3873", deuterium: "0", metal: "10313" },
      fleetSlots: { active: 0, limit: 1 },
      shipyardLevel: 5,
      naniteLevel: 0,
      technologyLevels: { "3": 6, "6": 2 },
      ships: [{
        id: 0,
        count: 5,
        cost: { crystal: "2000", deuterium: "0", metal: "2000" },
        durationSeconds: 60,
      }],
      queue: null,
    });
  }

  if (url.pathname.endsWith(`/wallet/${account}/watched-planets`)) {
    return Response.json({
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
      planets: [],
      wallet: account,
      watchedPlanetIds: [],
    });
  }

  if (systemMatch) {
    const key = `${systemMatch[1]}:${systemMatch[2]}`;
    return Response.json(publicSystems.get(key) ?? { galaxy: Number(systemMatch[1]), system: Number(systemMatch[2]), planets: [] });
  }

  if (url.pathname.includes("/attack-protection")) {
    return Response.json({ blockedReason: "none", isProtected: false, isSameAlliance: false });
  }

  return Response.json({ error: `Fixture endpoint not implemented: ${url.pathname}` }, { status: 404 });
}) as typeof fetch;

document.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof HTMLButtonElement ? event.target : undefined;
  if (walletEventOnPointerDown === "accountsChanged" && target?.textContent?.trim() === "Build") {
    for (const listener of providerListeners.get("accountsChanged") ?? []) listener([account]);
  }
}, { capture: true });

window.inspectorProof = {
  account,
  appReady: false,
  errors: fixtureErrors,
  interactions: fixtureInteractions,
  requests: fixtureRequests,
  walletRequests,
  beginDetailRace(kind) {
    detailRaceKind = kind;
    pendingDetailRequests.clear();
    const oldCoords = { galaxy: 7, system: 1, position: 2 };
    renderDetail(kind, oldCoords);
    queueMicrotask(() => renderDetail(kind, { galaxy: 8, system: 2, position: 4 }));
  },
  pendingDetailRequests() {
    return [...pendingDetailRequests.keys()].sort();
  },
  resolveDetailRequest(key) {
    const resolve = pendingDetailRequests.get(key);
    if (!resolve) throw new Error(`No pending detail request for ${key}`);
    const [galaxy, system] = key.split(":").map(Number);
    const isOld = galaxy === 7;
    resolve(Response.json(systemPayload(
      galaxy,
      system,
      isOld ? 2 : 4,
      `${isOld ? "Stale" : "Current"} ${detailRaceKind === "moon" ? "Moon Parent" : "Planet"}`,
      isOld ? unrelatedOwner : account,
      isOld ? "stale" : "current",
      isOld ? 7001 : 8002,
      detailRaceKind === "moon",
    )));
    pendingDetailRequests.delete(key);
  },
};

history.replaceState({ fixture: true }, "", route);
if (settlementShell) {
  Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
  render(<FirstPlanetSettlementApp />, appRoot);
} else {
  render(<PlayableMvpApp account={account} provider={provider} />, appRoot);
}
window.inspectorProof.appReady = true;

function renderDetail(kind: "moon" | "planet", coords: Coordinates) {
  const props = {
    account,
    apiBaseUrl: `${window.location.origin}/api`,
    coords,
    onBack: () => undefined,
  };
  render(kind === "moon" ? <PublicMoonDetail {...props} /> : <PlanetDetail {...props} />, appRoot);
}

function managedPlanet(overrides: Partial<ManagedPlanetResponse>): ManagedPlanetResponse {
  const galaxy = overrides.galaxy ?? 1;
  const system = overrides.system ?? 2;
  const position = overrides.position ?? 3;
  return {
    coordinates: `${galaxy}:${system}:${position}`,
    crystalMultiplierBps: 10_000,
    deuteriumMultiplierBps: 10_000,
    fields: 200,
    fieldsCapacity: 200,
    fieldsUsed: 7,
    galaxy,
    isHomePlanet: false,
    keyLevels: {
      crystalMine: 2,
      deuteriumSynthesizer: 3,
      metalMine: 1,
      researchLab: 0,
      roboticsFactory: 0,
      shipyard: 0,
      solarPlant: 4,
      terraformer: 0,
    },
    lastSettledAt: "1770000000",
    metalMultiplierBps: 10_000,
    moon: null,
    name: "Owned fixture",
    owner: account,
    planetId: "owned-fixture",
    position,
    queues: { building: null, defense: null, ship: null },
    resources: { crystal: "1", deuterium: "2", metal: "3" },
    system,
    temperature: 20,
    ...overrides,
  };
}

function walletOverview() {
  const selected = ownedPlanets[0]!;
  return {
    fleetVisibility: {
      battleReports: [],
      completedMissions: [],
      homePlanetId: selected.planetId,
      incoming: [],
      joinableAttacks: [],
      outgoing: [],
      returning: [],
      wallet: account,
    },
    planetsResponse: {
      homePlanetId: selected.planetId,
      planets: ownedPlanets,
      queues: { research: null },
      wallet: account,
    },
    queues: {
      building: null,
      defense: null,
      homePlanetId: selected.planetId,
      research: null,
      ship: null,
      wallet: account,
    },
    settlement: {
      hasFirstPlanet: true,
      homePlanetId: selected.planetId,
      planet: selected,
      wallet: account,
    },
  };
}

function systemPayload(
  galaxy: number,
  system: number,
  position: number,
  name: string,
  owner: string,
  planetId: string,
  metal: number,
  hasMoon: boolean,
) {
  return {
    galaxy,
    planets: [{
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      fields: 200,
      galaxy,
      hasMoon,
      metalMultiplierBps: 10_000,
      name,
      occupiedBy: { owner, ownerDisplayName: `${name} — Long Range Expeditionary Commander`, planetId },
      position,
      publicMoonState: hasMoon ? {
        buildings: [{ id: 0, level: metal === 8002 ? 8 : 7 }],
        defenses: [{ count: metal === 8002 ? 82 : 71, id: 0 }],
        resources: { crystal: String(metal + 1), deuterium: String(metal + 2), metal: String(metal) },
      } : null,
      publicState: {
        buildings: [{ id: 0, level: metal === 8002 ? 8 : 7 }],
        defenses: [{ count: metal === 8002 ? 82 : 71, id: 0 }],
        fleet: [{ count: metal === 8002 ? 42 : 31, id: 0 }],
        resources: { crystal: String(metal + 1), deuterium: String(metal + 2), metal: String(metal) },
      },
      system,
      temperature: 20,
    }],
    system,
  };
}
