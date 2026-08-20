import { describe, expect, test } from "bun:test";
import { galaxyActionsForSlot } from "./galaxyActions";
import {
  galaxyActionsForMoonSlot,
  galaxyAttackProtectionRequests,
  unavailableGalaxyAttackProtection,
} from "./components/GalaxyView";
import { planetDetailGalaxyActions } from "./components/PlanetDetail";
import { rankingsAttackProtectionForEntry, rankingsProtectionPresentation } from "./rankingsAttackProtection";
import type { Planet } from "./types";

const account = "0x1111111111111111111111111111111111111111";

describe("galaxyActions", () => {
  test("loads and applies moon-specific protection independently from the parent planet", () => {
    const moonTarget = planet({ hasMoon: true });
    expect(galaxyAttackProtectionRequests(
      [moonTarget],
      account,
      { galaxy: 9, system: 9, position: 9 },
    )).toEqual([
      { planetId: moonTarget.occupiedBy!.planetId, targetIsMoon: false },
      { planetId: moonTarget.occupiedBy!.planetId, targetIsMoon: true },
    ]);

    const attack = galaxyActionsForMoonSlot({
      account,
      attackProtection: unavailableGalaxyAttackProtection(moonTarget.occupiedBy!.planetId),
      defenseState: null,
      homePlanetId: "7",
      planet: moonTarget,
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: false,
      reason: "Attack protection is unavailable. Refresh Galaxy before launching.",
    });
  });

  test("enables recycler harvest only when indexed debris and recyclers are present", () => {
    const enemy = planet({
      debrisField: {
        metal: 40_000,
        crystal: 15_000,
      },
    });
    const harvest = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: enemy,
      shipyardState: shipyardState([{ id: 2, count: 2 }]),
    }).find((action) => action.kind === "harvest");

    expect(harvest).toMatchObject({
      enabled: true,
      mode: "mission",
      mission: "harvest",
      ships: {
        recycler: 0,
      },
    });
  });

  test("explains real harvest blockers instead of deployment-not-live copy", () => {
    const noDebris = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({ debrisField: null }),
      shipyardState: shipyardState([{ id: 2, count: 2 }]),
    }).find((action) => action.kind === "harvest");
    const noRecycler = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({
        debrisField: {
          metal: 40_000,
          crystal: 15_000,
        },
      }),
      shipyardState: shipyardState([]),
    }).find((action) => action.kind === "harvest");

    expect(noDebris).toMatchObject({
      enabled: false,
      reason: "No debris field at this coordinate.",
    });
    expect(noRecycler).toMatchObject({
      enabled: false,
      reason: "Requires a recycler on your home planet.",
    });
  });

  test("surfaces Harvest for eligible own debris, including the active origin planet", () => {
    const ownDebris = planet({
      ownerId: account,
      occupiedBy: { owner: account, planetId: "7" },
      debrisField: { metal: 40_000, crystal: 15_000 },
    });
    const readyShipyard = shipyardState([{ id: 2, count: 2 }]);

    for (const isOrigin of [false, true]) {
      expect(galaxyActionsForSlot({
        account,
        homePlanetId: "7",
        isOrigin,
        planet: ownDebris,
        shipyardState: readyShipyard,
      }).find((action) => action.kind === "harvest")).toMatchObject({
        enabled: true,
        mission: "harvest",
        ships: { recycler: 0 },
      });
    }
  });

  test("does not expose own-planet Harvest without debris or an eligible recycler", () => {
    const own = planet({
      ownerId: account,
      occupiedBy: { owner: account, planetId: "7" },
    });
    const noDebris = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: own,
      shipyardState: shipyardState([{ id: 2, count: 1 }]),
    });
    const noRecycler = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: { ...own, debrisField: { metal: 1, crystal: 0 } },
      shipyardState: shipyardState([]),
    });

    expect(noDebris.some((action) => action.kind === "harvest")).toBe(false);
    expect(noRecycler.some((action) => action.kind === "harvest")).toBe(false);
  });

  test("uses canonical attack protection to block attack actions", () => {
    const attack = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: false,
        blockedReason: "score_protection",
        blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: false,
      reason: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
    });
  });

  test("requires target-specific verification before advertising a ranked active-war attack", () => {
    const attack = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: true,
        atWar: true,
        warEligibilityNeedsCheck: true,
        blockedReason: "none",
        blockedReasonLabel: null,
      },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: true,
      label: "Verify war attack",
    });
  });

  test.each([
    ["sub-50k 1.5× band", "18001", "12000"],
    ["50k–499,999 10× band", "500001", "50000"],
  ])("shows and disables a Rankings attack for the %s from canonical status", (_label, attackerScore, defenderScore) => {
    const canonicalStatus = {
      allowed: false,
      blockedReason: "score_protection" as const,
      blockedReasonLabel: "Attack blocked: score protection allows a 1.5× gap below 50,000 score and a 10× gap below 500,000.",
      scoreComparison: {
        scoreType: "contract_total_user_score" as const,
        attackerScore,
        defenderScore,
        attackerVisibleScore: attackerScore,
        defenderVisibleScore: defenderScore,
        protected: true,
      },
    };
    const attackProtection = rankingsAttackProtectionForEntry({
      currentWallet: account,
      entry: {
        alliance: null,
        attackProtection: canonicalStatus,
        wallet: "0x3333333333333333333333333333333333333333",
      },
    });
    const attack = galaxyActionsForSlot({
      account,
      attackProtection,
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(rankingsProtectionPresentation(canonicalStatus)).toEqual({
      badgeLabel: "Score protected",
      detailLabel: canonicalStatus.blockedReasonLabel,
      blockedAttackLabel: "Protected",
    });
    expect(attack).toMatchObject({
      enabled: false,
      reason: canonicalStatus.blockedReasonLabel,
    });
  });

  test("keeps a canonically allowed Rankings target attackable", () => {
    const canonicalStatus = {
      allowed: true,
      blockedReason: "none" as const,
      blockedReasonLabel: null,
      scoreComparison: {
        scoreType: "contract_total_user_score" as const,
        attackerScore: "400000",
        defenderScore: "50000",
        attackerVisibleScore: "400000",
        defenderVisibleScore: "50000",
        protected: false,
      },
    };
    const attackProtection = rankingsAttackProtectionForEntry({
      currentWallet: account,
      entry: {
        alliance: null,
        attackProtection: canonicalStatus,
        wallet: "0x3333333333333333333333333333333333333333",
      },
    });
    const attack = galaxyActionsForSlot({
      account,
      attackProtection,
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    }).find((action) => action.kind === "attack");

    expect(rankingsProtectionPresentation(canonicalStatus)).toBeUndefined();
    expect(attack).toMatchObject({ enabled: true });
  });

  test("does not claim personalized Rankings protection for a disconnected viewer", () => {
    const attackProtection = rankingsAttackProtectionForEntry({
      currentWallet: undefined,
      entry: {
        alliance: null,
        attackProtection: null,
        wallet: "0x3333333333333333333333333333333333333333",
      },
    });
    const attack = galaxyActionsForSlot({
      account: undefined,
      attackProtection,
      homePlanetId: null,
      planet: planet(),
      shipyardState: null,
    }).find((action) => action.kind === "attack");

    expect(attackProtection).toBeUndefined();
    expect(rankingsProtectionPresentation(null)).toBeUndefined();
    expect(attack).toMatchObject({
      enabled: false,
      reason: "Connect a wallet to launch contract missions.",
    });
  });

  test("labels missing attack fleet separately from state and protection blockers", () => {
    const attack = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: true,
        blockedReason: "none",
        blockedReasonLabel: null,
      },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([]),
    }).find((action) => action.kind === "attack");

    expect(attack).toMatchObject({
      enabled: false,
      reason: "Requires at least one movable ship on your home planet.",
    });
  });

  test("keeps transport and deploy available for owned non-origin planets, plus proactive defend", () => {
    const ownColony = planet({
      ownerId: account,
      occupiedBy: {
        owner: account,
        planetId: "9",
      },
    });
    const actions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownColony,
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });

    expect(actions.map((action) => [action.kind, action.enabled])).toEqual([
      ["transport", true],
      ["deploy", true],
      ["defenseHold", true],
    ]);
  });

  test("never seeds enabled fleet actions from mission requirements or available inventory", () => {
    const readyShipyard = shipyardState([
      { id: 0, count: 4 },
      { id: 1, count: 4 },
      { id: 2, count: 4 },
      { id: 3, count: 4 },
    ]);
    const enemyActions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({ debrisField: { metal: 10_000, crystal: 10_000 } }),
      shipyardState: readyShipyard,
    });
    const ownActions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({
        ownerId: account,
        occupiedBy: { owner: account, planetId: "9" },
      }),
      shipyardState: readyShipyard,
    });
    const colonizeActions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({ owner: null, ownerId: null, occupiedBy: null }),
      shipyardState: readyShipyard,
    });
    const fleetActions = [...enemyActions, ...ownActions, ...colonizeActions]
      .filter((action) => action.enabled && action.mode !== "missile");

    expect(fleetActions.map((action) => action.kind).sort()).toEqual([
      "attack",
      "colonize",
      "defenseHold",
      "deploy",
      "harvest",
      "transport",
    ]);
    for (const action of fleetActions) {
      expect(
        Object.values(action.ships).every((quantity) => quantity === 0),
        `${action.kind} must wait for an explicit player quantity`,
      ).toBe(true);
    }
  });

  test("enables Deploy with a combat-only origin while Transport keeps its cargo requirement", () => {
    const ownColony = planet({
      ownerId: account,
      occupiedBy: {
        owner: account,
        planetId: "9",
      },
    });
    const actions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownColony,
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    });

    expect(actions.find((action) => action.kind === "transport")).toMatchObject({
      enabled: false,
      reason: "Requires a cargo-capable ship on your home planet.",
    });
    expect(actions.find((action) => action.kind === "deploy")).toMatchObject({
      enabled: true,
      ships: { lightFighter: 0 },
    });

    const emptyOriginActions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownColony,
      shipyardState: shipyardState([]),
    });
    expect(emptyOriginActions.find((action) => action.kind === "deploy")).toMatchObject({
      enabled: false,
      reason: "Requires at least one movable ship on the active origin.",
    });
  });

  test("blocks colonization of quantum-unstable migration reservations", () => {
    const actions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      planet: planet({
        owner: null,
        ownerId: null,
        occupiedBy: null,
        migrationReservation: {
          status: "quantum-unstable",
          label: "Quantum-unstable planet",
        },
      }),
      shipyardState: shipyardState([{ id: 3, count: 1 }]),
    });

    expect(actions).toMatchObject([
      {
        enabled: false,
        kind: "colonize",
        label: "Quantum locked",
        reason: "This testnet migration planet is quantum-unstable until its commander claims it on mainnet.",
      },
    ]);
  });

  test("offers proactive Defend, but not transport, on a same-alliance member's planet", () => {
    const allyPlanet = planet({
      ownerId: "0x3333333333333333333333333333333333333333",
      alliance: { allianceId: "5", tag: "ALLY", name: "Allies" },
    });
    const allyActions = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: false,
        blockedReason: "same_alliance",
        blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
      },
      homePlanetId: "7",
      planet: allyPlanet,
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    });
    const allyTransport = allyActions.find((action) => action.kind === "transport");
    const allyDefend = allyActions.find((action) => action.kind === "defenseHold");
    expect(allyTransport).toBeUndefined();
    expect(allyActions[0]).toMatchObject({ kind: "defenseHold", enabled: true, label: "Defend" });
    expect(allyDefend).toMatchObject({ enabled: true, mission: "defenseHold", ships: { lightFighter: 0 } });

    const hostileActions = galaxyActionsForSlot({
      account,
      attackProtection: { allowed: true, blockedReason: "none", blockedReasonLabel: null },
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    });
    const hostileDefend = hostileActions.find((action) => action.kind === "defenseHold");
    const hostileTransport = hostileActions.find((action) => action.kind === "transport");
    expect(hostileDefend).toBeUndefined();
    expect(hostileTransport).toBeUndefined();
  });

  test("keeps transport hidden on a same-alliance member's planet when a cargo ship is available", () => {
    const allyActions = galaxyActionsForSlot({
      account,
      attackProtection: {
        allowed: false,
        blockedReason: "same_alliance",
        blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
      },
      homePlanetId: "7",
      planet: planet({
        ownerId: "0x3333333333333333333333333333333333333333",
        alliance: { allianceId: "5", tag: "ALLY", name: "Allies" },
      }),
      shipyardState: shipyardState([{ id: 0, count: 2 }]),
    });

    expect(allyActions.find((action) => action.kind === "transport")).toBeUndefined();
    expect(allyActions.find((action) => action.kind === "defenseHold")).toMatchObject({
      kind: "defenseHold",
      enabled: true,
    });
    expect(allyActions.map((action) => action.kind)).not.toContain("deploy");
  });

  test("blocks Rankings attack actions for alliance allies even without personalized attack protection", () => {
    const attackProtection = rankingsAttackProtectionForEntry({
      currentAllianceId: "5",
      currentWallet: account,
      entry: {
        alliance: { allianceId: "5", tag: "ALLY", name: "Allies" },
        attackProtection: null,
        wallet: "0x3333333333333333333333333333333333333333",
      },
    });
    const actions = galaxyActionsForSlot({
      account,
      attackProtection,
      homePlanetId: "7",
      planet: planet({
        alliance: { allianceId: "5", tag: "ALLY", name: "Allies" },
        ownerId: "0x3333333333333333333333333333333333333333",
      }),
      shipyardState: shipyardState([{ id: 1, count: 3 }]),
    });

    expect(attackProtection).toMatchObject({
      allowed: false,
      blockedReason: "same_alliance",
      blockedReasonLabel: "Attack blocked: target belongs to your alliance.",
    });
    expect(actions.find((action) => action.kind === "defenseHold")).toMatchObject({
      enabled: true,
      kind: "defenseHold",
    });
    expect(actions.find((action) => action.kind === "attack")).toMatchObject({
      enabled: false,
      reason: "Attack blocked: target belongs to your alliance.",
    });
  });

  test("surfaces a disabled, explained Defend on the home/launch planet so it stays discoverable", () => {
    const homePlanet = planet({
      position: 7,
      ownerId: account,
      occupiedBy: { owner: account, planetId: "7" },
    });
    const actions = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: true,
      planet: homePlanet,
      shipyardState: shipyardState([{ id: 1, count: 5 }]),
    });

    // A single-colony, no-alliance wallet only ever inspects its home planet; the Defend action must be
    // visible (disabled) with the eligibility prerequisite explained, not omitted entirely.
    expect(actions).toMatchObject([
      {
        kind: "defenseHold",
        enabled: false,
        label: "Defend",
        reason:
          "You can't station a defending fleet at the planet it launches from. Open another colony or an alliance member's planet to defend it.",
      },
    ]);
  });

  test("blocks proactive Defend with a clear reason when no movable ship is available", () => {
    const ownColony = planet({
      ownerId: account,
      occupiedBy: { owner: account, planetId: "9" },
    });
    const defend = galaxyActionsForSlot({
      account,
      homePlanetId: "7",
      isOrigin: false,
      planet: ownColony,
      shipyardState: shipyardState([]),
    }).find((action) => action.kind === "defenseHold");

    expect(defend).toMatchObject({
      enabled: false,
      reason: "Requires at least one movable ship on your home planet.",
    });
  });

  test("planet detail reuses galaxy mission actions for occupied, owned, origin, and empty targets", () => {
    const homeCoords = { galaxy: 2, system: 44, position: 7 };
    const enemyActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 8 },
      defenseState: defenseState([{ id: 9, count: 1 }]),
      homeCoords,
      homePlanetId: "7",
      planet: planet(),
      shipyardState: shipyardState([
        { id: 1, count: 1 },
        { id: 2, count: 1 },
      ]),
    });
    const ownActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 9 },
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: planet({
        position: 9,
        ownerId: account,
        occupiedBy: {
          owner: account,
          planetId: "9",
        },
      }),
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });
    const originActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: homeCoords,
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: planet({
        position: 7,
        ownerId: account,
        occupiedBy: {
          owner: account,
          planetId: "7",
        },
      }),
      shipyardState: shipyardState([{ id: 0, count: 1 }]),
    });
    const emptyActions = planetDetailGalaxyActions({
      account,
      attackProtection: null,
      coords: { galaxy: 2, system: 44, position: 12 },
      defenseState: null,
      homeCoords,
      homePlanetId: "7",
      planet: undefined,
      shipyardState: shipyardState([{ id: 3, count: 1 }]),
    });

    expect(enemyActions.map((action) => action.label)).toEqual(["Attack", "Harvest", "Missile"]);
    expect(ownActions.map((action) => action.label)).toEqual(["Transport", "Deploy", "Defend"]);
    // The launch/home planet surfaces Defend in a disabled, explained state (launchDefenseHold reverts
    // with SamePlanet on origin == target) so the feature stays discoverable for single-colony wallets.
    expect(originActions).toMatchObject([
      {
        kind: "defenseHold",
        enabled: false,
        label: "Defend",
        reason:
          "You can't station a defending fleet at the planet it launches from. Open another colony or an alliance member's planet to defend it.",
      },
    ]);
    expect(emptyActions).toEqual([]);
  });
});

function planet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: "2:44:8",
    name: "Planet 2.44.8",
    type: "cold-tundra",
    image: "/assets/game/style-pass/generated/planets/cold-tundra.webp",
    position: 8,
    galaxy: 2,
    system: 44,
    owner: "Enemy",
    ownerId: "0x3333333333333333333333333333333333333333",
    alliance: null,
    occupiedBy: {
      owner: "0x3333333333333333333333333333333333333333",
      planetId: "9",
    },
    debrisField: null,
    moonChance: null,
    resources: {
      metal: 0,
      crystal: 0,
      deuterium: 0,
      energy: 0,
    },
    temperature: {
      min: -40,
      max: 10,
    },
    diameter: 12_000,
    fields: 180,
    hasMoon: false,
    ...overrides,
  };
}

function shipyardState(ships: Array<{ id: number; count: number }>) {
  return {
    homePlanetId: "7",
    productionAvailable: true,
    resources: null,
    shipyardLevel: 1,
    naniteLevel: 0,
    technologyLevels: {},
    ships: ships.map((ship) => ({
      ...ship,
      cost: {
        metal: "0",
        crystal: "0",
        deuterium: "0",
      },
    })),
    queue: null,
    wallet: account,
  };
}

function defenseState(defenses: Array<{ id: number; count: number }>) {
  return {
    homePlanetId: "7",
    productionAvailable: true,
    resources: null,
    shipyardLevel: 1,
    naniteLevel: 0,
    missileSiloLevel: 4,
    technologyLevels: {},
    defenses: defenses.map((defense) => ({
      ...defense,
      cost: {
        metal: "0",
        crystal: "0",
        deuterium: "0",
      },
    })),
    queue: null,
    wallet: account,
  };
}
