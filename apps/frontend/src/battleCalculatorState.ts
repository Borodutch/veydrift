import type { CombatTechnology, ContractBattleInput } from "./battlePreview";
import { fetchSystemData } from "./walletFlow";
import { planetsFromSystemResponse, type ApiSystemResponse } from "./data/mockUniverse";
import { researchCatalog, shipCatalog } from "./playableMvp";

/** One calculator force. `defenses` only count for the target body (defenders[0]). */
export type CalculatorFleet = {
  coords: string;
  moon: boolean;
  tech: CombatTechnology;
  ships: number[];
  defenses: number[];
};

/** defenders[0] is the attacked planet or moon; later defenders are supporting fleets. */
export type CalculatorSetup = {
  attackers: CalculatorFleet[];
  defenders: CalculatorFleet[];
};

const SHIP_TYPES = 16;
const DEFENSE_TYPES = 8;
/** Solar Satellites (9) and Crawlers (15) never leave their planet. */
export const isFleetShip = (id: number) => id !== 9 && id !== 15;
/** Ship slot 14 exists onchain but can never be built, so the calculator never offers it. */
export const isPlayableShip = (id: number) => id !== 14;

export function emptyFleet(): CalculatorFleet {
  return {
    coords: "", moon: false, tech: { weapons: 0, shielding: 0, armor: 0 },
    ships: Array(SHIP_TYPES).fill(0), defenses: Array(DEFENSE_TYPES).fill(0),
  };
}

export function emptySetup(): CalculatorSetup {
  return { attackers: [emptyFleet()], defenders: [emptyFleet()] };
}

export function setupToBattleInput(setup: CalculatorSetup): ContractBattleInput {
  const fleet = (force: CalculatorFleet, index: number, label: string) => ({
    id: `${label}-${index + 1}`,
    label: `${label} ${index + 1}${force.coords ? ` [${force.coords}]` : ""}`,
    owner: "",
    laneGroup: 0,
    ships: force.ships.map((count, id) => isFleetShip(id) ? count : 0),
    technology: force.tech,
  });
  const [target = emptyFleet(), ...supports] = setup.defenders;
  return {
    attackers: setup.attackers.map((force, index) => fleet(force, index, "Attacker")),
    defender: {
      id: "defender",
      label: `Defender${target.coords ? ` [${target.coords}]` : ""}`,
      owner: "",
      ships: target.ships,
      defenses: target.defenses,
      technology: target.tech,
      counterplay: supports.map((force, index) => fleet(force, index, "Support")),
    },
  };
}

/** Mission forecasts open the calculator with the same forces they simulated. */
export function battleInputToSetup(input: ContractBattleInput): CalculatorSetup {
  const counts = (values: readonly number[], length: number) => Array.from({ length }, (_, id) => Math.max(0, Math.trunc(values[id] ?? 0)));
  const force = (ships: readonly number[], tech: CombatTechnology, defenses: readonly number[] = []): CalculatorFleet => ({
    coords: "", moon: false, tech: { ...tech }, ships: counts(ships, SHIP_TYPES), defenses: counts(defenses, DEFENSE_TYPES),
  });
  return {
    attackers: input.attackers.map((fleet) => force(fleet.ships, fleet.technology)),
    defenders: [
      force(input.defender.ships, input.defender.technology, input.defender.defenses),
      ...input.defender.counterplay.map((fleet) => force(fleet.ships, fleet.technology)),
    ],
  };
}

// URL form: sparse counts, base64url JSON. { a, d: [{ c, m, t: [w, s, a], s: {id: n}, f: {id: n} }] }
type WireFleet = { c?: string; m?: 1; t?: [number, number, number]; s?: Record<string, number>; f?: Record<string, number> };

export function encodeSetup(setup: CalculatorSetup): string {
  const sparse = (values: number[]) => {
    const entries = values.flatMap((count, id) => count > 0 ? [[String(id), count] as const] : []);
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  const wire = (force: CalculatorFleet): WireFleet => {
    const tech: [number, number, number] = [force.tech.weapons, force.tech.shielding, force.tech.armor];
    const ships = sparse(force.ships), defenses = sparse(force.defenses);
    return {
      ...(force.coords ? { c: force.coords } : {}),
      ...(force.moon ? { m: 1 as const } : {}),
      ...(tech.some(Boolean) ? { t: tech } : {}),
      ...(ships ? { s: ships } : {}),
      ...(defenses ? { f: defenses } : {}),
    };
  };
  const json = JSON.stringify({ a: setup.attackers.map(wire), d: setup.defenders.map(wire) });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSetup(encoded: string): CalculatorSetup | null {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) as { a?: unknown; d?: unknown };
    const level = (value: unknown) => clampCount(value, 99);
    const counts = (values: unknown, length: number) => Array.from({ length }, (_, id) =>
      values && typeof values === "object" ? clampCount((values as Record<string, unknown>)[String(id)]) : 0);
    const force = (value: unknown): CalculatorFleet => {
      const wire = (value && typeof value === "object" ? value : {}) as WireFleet;
      const tech = Array.isArray(wire.t) ? wire.t : [];
      return {
        coords: typeof wire.c === "string" ? wire.c.slice(0, 16) : "",
        moon: wire.m === 1,
        tech: { weapons: level(tech[0]), shielding: level(tech[1]), armor: level(tech[2]) },
        ships: counts(wire.s, SHIP_TYPES).map((count, id) => isPlayableShip(id) ? count : 0),
        defenses: counts(wire.f, DEFENSE_TYPES),
      };
    };
    const list = (value: unknown) => (Array.isArray(value) ? value : []).slice(0, MAX_FLEETS).map(force);
    const setup = { attackers: list(parsed.a), defenders: list(parsed.d) };
    if (!setup.attackers.length) setup.attackers.push(emptyFleet());
    if (!setup.defenders.length) setup.defenders.push(emptyFleet());
    return setup;
  } catch {
    return null;
  }
}

export const MAX_FLEETS = 16;
export const MAX_UNITS = 999_999_999;

export function clampCount(value: unknown, max = MAX_UNITS): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.trunc(number))) : 0;
}

export function calculatorHref(setup: CalculatorSetup): string {
  return `/calculator?b=${encodeSetup(setup)}`;
}

/** "1:23:4" → coordinates, or null. */
export function parseCoords(text: string): { galaxy: number; system: number; position: number } | null {
  const match = /^\s*(\d{1,3})\s*[:.\s]\s*(\d{1,4})\s*[:.\s]\s*(\d{1,2})\s*$/.exec(text);
  if (!match) return null;
  const [galaxy, system, position] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return galaxy > 0 && system > 0 && position > 0 ? { galaxy, system, position } : null;
}

export type LoadedForces = { force: CalculatorFleet; supports: CalculatorFleet[]; owner: string | null };

const researchId = (key: "weapons" | "shielding" | "armor") => researchCatalog.find((entry) => entry.key === key)?.id;

/** Public forces at a planet or moon: its ships and defenses, the owner's combat research and,
 * for a planet, the fleets currently stationed there in its defense. */
export async function loadForcesAt(apiUrl: string, coords: string, moon: boolean, signal?: AbortSignal): Promise<LoadedForces> {
  const at = parseCoords(coords);
  if (!at) throw new Error("Use coordinates like 1:23:4.");
  const system = await fetchSystemData(apiUrl, at.galaxy, at.system, { detail: "full", ...(signal ? { signal } : {}) }) as ApiSystemResponse;
  const planet = planetsFromSystemResponse(system).find((candidate) => candidate.position === at.position);
  const owner = planet?.occupiedBy?.owner ?? planet?.owner ?? null;
  if (!planet || !owner) throw new Error(`Nobody lives at ${at.galaxy}:${at.system}:${at.position}.`);
  const body = moon ? planet.publicMoonState : planet.publicState;
  if (!body) throw new Error(moon ? "There is no moon at these coordinates." : "This planet's forces are not public yet.");
  const research = planet.publicState?.research ?? [];
  const level = (key: "weapons" | "shielding" | "armor") => research.find((row) => row.id === researchId(key))?.level ?? 0;
  const counts = (rows: Array<{ id: number; count: number }> | null | undefined, length: number) => {
    const values = Array(length).fill(0) as number[];
    for (const row of rows ?? []) if (row.id >= 0 && row.id < length) values[row.id] = clampCount(row.count);
    return values;
  };
  const force: CalculatorFleet = {
    coords: `${at.galaxy}:${at.system}:${at.position}`,
    moon,
    tech: { weapons: level("weapons"), shielding: level("shielding"), armor: level("armor") },
    ships: counts(body.fleet, SHIP_TYPES),
    defenses: counts(body.defenses, DEFENSE_TYPES),
  };
  const supports = moon ? [] : (planet.publicState?.stationedDefenders ?? []).map((defender) => ({
    ...emptyFleet(),
    tech: { weapons: 0, shielding: 0, armor: 0, ...defender.combatTechnology },
    ships: Array.from({ length: SHIP_TYPES }, (_, id) => clampCount(defender.ships[shipCatalog.find((ship) => ship.id === id)?.key ?? ""])),
  }));
  return { force, supports, owner };
}
