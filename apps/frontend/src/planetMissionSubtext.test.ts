import { describe, expect, test } from "bun:test";
import {
  activeMissionsByPlanetId,
  maxPlanetMissionLines,
  maxUniverseMissionBannerLines,
  planetMissionSubtext,
  universeActiveMissionLines,
} from "./planetMissionSubtext";
import type { FleetMissionPlanetReference, FleetMissionSummary } from "./walletFlow";

const OWNER = "0xOwner";
const THIRD_PARTY = "0xRaider";
// Far enough in the future that every mission ETA renders as a live countdown rather than "Ready".
const NOW = 0;

function planetRef(overrides: Partial<FleetMissionPlanetReference> & { planetId: string }): FleetMissionPlanetReference {
  return {
    owner: "0x0",
    ownerDisplayName: null,
    name: null,
    galaxy: 1,
    system: 1,
    position: 1,
    coordinates: "1:1:1",
    ...overrides,
  };
}

function mission(overrides: Partial<FleetMissionSummary> & { missionId: string }): FleetMissionSummary {
  return {
    status: "Outbound",
    missionType: "Attack",
    owner: OWNER,
    originPlanetId: "home",
    targetPlanetId: "enemy",
    originPlanet: null,
    targetPlanet: null,
    arrivalAt: "1000",
    returnAt: "2000",
    fuelCost: "0",
    recallCost: null,
    attackGroupId: null,
    joinedAttackMissionIds: [],
    cargo: { metal: "0", crystal: "0", deuterium: "0" },
    ships: {},
    transactionHash: "0x",
    blockNumber: "1",
    ...overrides,
  };
}

describe("activeMissionsByPlanetId", () => {
  test("files each mission under both its origin and target planet", () => {
    const m = mission({ missionId: "1", originPlanetId: "A", targetPlanetId: "B" });
    const byPlanet = activeMissionsByPlanetId([m]);
    expect(byPlanet.get("A")).toEqual([m]);
    expect(byPlanet.get("B")).toEqual([m]);
  });

  test("files a self-targeted mission once", () => {
    const m = mission({ missionId: "1", originPlanetId: "A", targetPlanetId: "A" });
    const byPlanet = activeMissionsByPlanetId([m]);
    expect(byPlanet.get("A")).toEqual([m]);
    expect(byPlanet.size).toBe(1);
  });
});

describe("planetMissionSubtext owner vs third-party classification", () => {
  test("owner outbound fleet reads as the owner's own launch toward its target", () => {
    const m = mission({
      missionId: "1",
      owner: OWNER,
      originPlanetId: "home",
      targetPlanetId: "enemy",
      targetPlanet: planetRef({ planetId: "enemy", coordinates: "7:396:3" }),
    });
    const { lines } = planetMissionSubtext("home", OWNER, [m], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.origin).toBe("owner");
    expect(lines[0]?.direction).toBe("outgoing");
    expect(lines[0]?.hostile).toBe(false);
    expect(lines[0]?.label).toContain("Own Attack → [7:396:3]");
  });

  test("owner fleet returning home names the mission type", () => {
    const m = mission({
      missionId: "1",
      status: "Returning",
      missionType: "Attack",
      owner: OWNER,
      originPlanetId: "home",
      targetPlanetId: "enemy",
    });
    const { lines } = planetMissionSubtext("home", OWNER, [m], NOW);
    expect(lines[0]?.origin).toBe("owner");
    expect(lines[0]?.direction).toBe("incoming");
    expect(lines[0]?.label).toContain("Own Attack returning");
  });

  test("owner's own fleet arriving at one of their planets reads as own arrival", () => {
    const m = mission({
      missionId: "1",
      missionType: "Transport",
      owner: OWNER,
      originPlanetId: "homeA",
      targetPlanetId: "homeB",
    });
    const { lines } = planetMissionSubtext("homeB", OWNER, [m], NOW);
    expect(lines[0]?.origin).toBe("owner");
    expect(lines[0]?.direction).toBe("incoming");
    expect(lines[0]?.hostile).toBe(false);
    expect(lines[0]?.label).toContain("Own Transport arriving");
  });

  test("third-party hostile fleet inbound reads as an incoming attack from the attacker", () => {
    const m = mission({
      missionId: "1",
      missionType: "Attack",
      owner: THIRD_PARTY,
      originPlanetId: "raiderHome",
      targetPlanetId: "victim",
      originPlanet: planetRef({ planetId: "raiderHome", owner: THIRD_PARTY, ownerDisplayName: "Dread Pirate" }),
    });
    const { lines } = planetMissionSubtext("victim", OWNER, [m], NOW);
    expect(lines[0]?.origin).toBe("third-party");
    expect(lines[0]?.direction).toBe("incoming");
    expect(lines[0]?.hostile).toBe(true);
    expect(lines[0]?.label).toContain("Incoming Attack from Dread Pirate");
  });

  test("third-party friendly fleet inbound reads as a friendly incoming visit", () => {
    const m = mission({
      missionId: "1",
      missionType: "Transport",
      owner: THIRD_PARTY,
      originPlanetId: "allyHome",
      targetPlanetId: "victim",
      originPlanet: planetRef({ planetId: "allyHome", owner: THIRD_PARTY, ownerDisplayName: "Quartermaster" }),
    });
    const { lines } = planetMissionSubtext("victim", OWNER, [m], NOW);
    expect(lines[0]?.origin).toBe("third-party");
    expect(lines[0]?.hostile).toBe(false);
    expect(lines[0]?.label).toContain("Incoming Transport from Quartermaster");
  });

  test("third-party fleet name falls back to a short address when unnamed", () => {
    const m = mission({
      missionId: "1",
      missionType: "Attack",
      owner: "0x1234567890abcdef1234567890abcdef12345678",
      originPlanetId: "raiderHome",
      targetPlanetId: "victim",
      originPlanet: planetRef({ planetId: "raiderHome", owner: "0x1234567890abcdef1234567890abcdef12345678" }),
    });
    const { lines } = planetMissionSubtext("victim", OWNER, [m], NOW);
    expect(lines[0]?.label).toContain("Incoming Attack from 0x1234");
    expect(lines[0]?.label).not.toContain("from undefined");
  });

  test("third-party raider returning home reads as outgoing third-party traffic", () => {
    const m = mission({
      missionId: "1",
      status: "Returning",
      missionType: "Attack",
      owner: THIRD_PARTY,
      originPlanetId: "raiderHome",
      targetPlanetId: "victim",
      originPlanet: planetRef({ planetId: "raiderHome", coordinates: "9:9:9", owner: THIRD_PARTY, ownerDisplayName: "Dread Pirate" }),
    });
    const { lines } = planetMissionSubtext("victim", OWNER, [m], NOW);
    expect(lines[0]?.origin).toBe("third-party");
    expect(lines[0]?.direction).toBe("outgoing");
    expect(lines[0]?.label).toContain("Attack from Dread Pirate returning → [9:9:9]");
  });

  test("missing planet owner never misclassifies a fleet as third-party", () => {
    const m = mission({
      missionId: "1",
      missionType: "Attack",
      owner: THIRD_PARTY,
      originPlanetId: "raiderHome",
      targetPlanetId: "victim",
    });
    const { lines } = planetMissionSubtext("victim", undefined, [m], NOW);
    expect(lines[0]?.origin).toBe("owner");
  });
});

describe("planetMissionSubtext real-universe shared scenario (VEY-448 Rankings + Raid Finder)", () => {
  // Locks the exact live `/missions?status=active` shape that both surfaces render so a regression on
  // either page is caught here. Mirrors a real returning third-party Attack (one owner's fleet that
  // struck another owner's planet and is now flying home): Jabba (planet 12, 2:72:5) attacked Amaliee
  // (planet 16, 7:396:3) and is Returning. The Raid Finder lists BOTH owners' planets, so both rows
  // must classify correctly from the same feed via `activeMissionsByPlanetId`.
  const JABBA = "0xf3d95ca6cc810ab74b5670955a1cc0b68e55a1a4";
  const AMALIEE = "0xeb35d3b4385b0a917bffd62daae2419789f59521";
  const returningAttack = mission({
    missionId: "217",
    owner: JABBA,
    missionType: "Attack",
    status: "Returning",
    originPlanetId: "12",
    targetPlanetId: "16",
    originPlanet: planetRef({ planetId: "12", owner: JABBA, ownerDisplayName: "Jabba", coordinates: "2:72:5" }),
    targetPlanet: planetRef({ planetId: "16", owner: AMALIEE, ownerDisplayName: "Amaliee", coordinates: "7:396:3" }),
  });
  const byPlanet = activeMissionsByPlanetId([returningAttack]);

  test("the attacker's own planet (Jabba/12) reads as the owner's own returning fleet", () => {
    const { lines } = planetMissionSubtext("12", JABBA, byPlanet.get("12") ?? [], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.origin).toBe("owner");
    expect(lines[0]?.hostile).toBe(false);
    expect(lines[0]?.label).toContain("Own Attack returning");
  });

  test("the victim's planet (Amaliee/16) reads as a hostile third-party fleet that names the attacker", () => {
    const { lines } = planetMissionSubtext("16", AMALIEE, byPlanet.get("16") ?? [], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.origin).toBe("third-party");
    expect(lines[0]?.hostile).toBe(true);
    expect(lines[0]?.label).toContain("Attack from Jabba returning → [2:72:5]");
    expect(lines[0]?.label).not.toContain("Own");
  });
});

describe("universeActiveMissionLines (Rankings + Raid Finder active-fleet banner, VEY-448)", () => {
  test("frames an outbound third-party attack from the target planet so it reads as an incoming attack", () => {
    // Mirrors the live feed: an Outbound Attack from the attacker's planet (rank #2) to a victim whose
    // owner sits on a later rankings page — the case where the per-row subtext is off-page-1.
    const m = mission({
      missionId: "231",
      missionType: "Attack",
      status: "Outbound",
      owner: THIRD_PARTY,
      originPlanetId: "23",
      targetPlanetId: "2",
      originPlanet: planetRef({ planetId: "23", owner: THIRD_PARTY, ownerDisplayName: "Illusive Man", coordinates: "2:477:7" }),
      targetPlanet: planetRef({ planetId: "2", owner: OWNER, coordinates: "1:132:7" }),
    });
    const { lines, overflow } = universeActiveMissionLines([m], NOW);
    expect(lines).toHaveLength(1);
    expect(overflow).toBe(0);
    expect(lines[0]?.origin).toBe("third-party");
    expect(lines[0]?.hostile).toBe(true);
    expect(lines[0]?.direction).toBe("incoming");
    expect(lines[0]?.planetCoordinates).toBe("1:132:7");
    expect(lines[0]?.label).toContain("Incoming Attack from Illusive Man");
  });

  test("frames an owner's own internal transport as an own arrival", () => {
    const m = mission({
      missionId: "1",
      missionType: "Transport",
      status: "Outbound",
      owner: OWNER,
      originPlanetId: "homeA",
      targetPlanetId: "homeB",
      targetPlanet: planetRef({ planetId: "homeB", owner: OWNER, coordinates: "3:3:3" }),
    });
    const { lines } = universeActiveMissionLines([m], NOW);
    expect(lines[0]?.origin).toBe("owner");
    expect(lines[0]?.hostile).toBe(false);
    expect(lines[0]?.planetCoordinates).toBe("3:3:3");
    expect(lines[0]?.label).toContain("Own Transport arriving");
  });

  test("returns no lines for an empty feed", () => {
    expect(universeActiveMissionLines([], NOW)).toEqual({ lines: [], overflow: 0 });
  });

  test("sorts soonest-first and caps with an overflow count", () => {
    const missions: FleetMissionSummary[] = Array.from({ length: maxUniverseMissionBannerLines + 2 }, (_unused, index) =>
      mission({
        missionId: `m${index}`,
        owner: THIRD_PARTY,
        originPlanetId: `o${index}`,
        targetPlanetId: `t${index}`,
        arrivalAt: String((index + 1) * 1000),
        originPlanet: planetRef({ planetId: `o${index}`, owner: THIRD_PARTY, ownerDisplayName: `Raider ${index}` }),
        targetPlanet: planetRef({ planetId: `t${index}`, owner: OWNER, coordinates: `9:9:${index}` }),
      }),
    );
    const { lines, overflow } = universeActiveMissionLines(missions, NOW);
    expect(lines).toHaveLength(maxUniverseMissionBannerLines);
    expect(overflow).toBe(2);
    expect(lines[0]?.planetCoordinates).toBe("9:9:0");
    expect(lines.at(-1)?.planetCoordinates).toBe(`9:9:${maxUniverseMissionBannerLines - 1}`);
  });

  test("drops missions without a resolvable event timestamp", () => {
    const m = mission({ missionId: "1", owner: THIRD_PARTY, originPlanetId: "o", targetPlanetId: "t", arrivalAt: "0" });
    expect(universeActiveMissionLines([m], NOW)).toEqual({ lines: [], overflow: 0 });
  });
});

describe("planetMissionSubtext sorting and overflow", () => {
  test("sorts lines by soonest event and caps with an overflow count", () => {
    const missions: FleetMissionSummary[] = [
      mission({ missionId: "late", owner: OWNER, originPlanetId: "home", targetPlanetId: "t1", arrivalAt: "5000" }),
      mission({ missionId: "soon", owner: OWNER, originPlanetId: "home", targetPlanetId: "t2", arrivalAt: "1000" }),
      mission({ missionId: "mid", owner: OWNER, originPlanetId: "home", targetPlanetId: "t3", arrivalAt: "3000" }),
      mission({ missionId: "latest", owner: OWNER, originPlanetId: "home", targetPlanetId: "t4", arrivalAt: "7000" }),
    ];
    const subtext = planetMissionSubtext("home", OWNER, missions, NOW);
    expect(subtext.lines).toHaveLength(maxPlanetMissionLines);
    expect(subtext.lines.map((line) => line.key)).toEqual(["soon-out", "mid-out", "late-out"]);
    expect(subtext.overflow).toBe(1);
  });

  test("drops missions without a resolvable event timestamp", () => {
    const m = mission({ missionId: "1", owner: OWNER, originPlanetId: "home", targetPlanetId: "t", arrivalAt: "0" });
    const subtext = planetMissionSubtext("home", OWNER, [m], NOW);
    expect(subtext.lines).toHaveLength(0);
    expect(subtext.overflow).toBe(0);
  });
});
