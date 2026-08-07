import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  allianceDisplayName,
  buildAllianceRoster,
  currentAllianceEntry,
  findAllianceEntry,
} from "../src/components/AlliancePage";

const owner = "0x1111111111111111111111111111111111111111";
const officer = "0x2222222222222222222222222222222222222222";
const member = "0x3333333333333333333333333333333333333333";

describe("AlliancePage helpers", () => {
  test("buildAllianceRoster inserts and prioritizes the owner", () => {
    const roster = buildAllianceRoster([
      { address: member, role: "member", joinedAt: "30" },
      { address: officer, role: "officer", joinedAt: "20" },
    ], owner);

    expect(roster.all.map((row) => row.address)).toEqual([owner, officer, member]);
    expect(roster.officers.map((row) => row.role)).toEqual(["owner", "officer"]);
    expect(roster.members).toEqual([{ address: member, role: "member", joinedAt: "30" }]);
  });

  test("buildAllianceRoster upgrades an existing owner member row", () => {
    const roster = buildAllianceRoster([
      { address: owner.toUpperCase(), role: "member", joinedAt: "10" },
    ], owner);

    expect(roster.all).toEqual([
      { address: owner.toUpperCase(), displayName: null, role: "owner", joinedAt: "10" },
    ]);
  });

  test("findAllianceEntry returns selected directory entries before current fallback", () => {
    const currentAlliance = {
      active: true,
      allianceId: "1",
      createdAt: "100",
      description: "Current",
      memberCount: 3,
      name: "Home",
      owner,
      rosterAvailable: true,
      tag: "HOM",
    };
    const selected = findAllianceEntry([
      {
        active: true,
        allianceId: "2",
        createdAt: "200",
        description: "Other",
        memberCount: 4,
        name: "Other",
        owner: officer,
        tag: "OTH",
      },
    ], "2", currentAlliance);

    expect(selected).toMatchObject({
      allianceId: "2",
      name: "Other",
      rosterAvailable: false,
    });
  });

  test("findAllianceEntry falls back to current alliance when no selection exists", () => {
    const currentAlliance = {
      active: true,
      allianceId: "1",
      createdAt: "100",
      description: "Current",
      memberCount: 3,
      name: "Home",
      owner,
      rosterAvailable: true,
      tag: "HOM",
    };

    expect(findAllianceEntry([], null, currentAlliance)).toBe(currentAlliance);
  });

  test("findAllianceEntry does not fake an unknown explicit selection", () => {
    const currentAlliance = {
      active: true,
      allianceId: "1",
      createdAt: "100",
      description: "Current",
      memberCount: 3,
      name: "Home",
      owner,
      rosterAvailable: true,
      tag: "HOM",
    };

    expect(findAllianceEntry([], "999", currentAlliance)).toBeNull();
  });

  test("currentAllianceEntry preserves treasury balances from the member profile or directory", () => {
    const balance = { metal: "100", crystal: "200", deuterium: "300" };
    const privateInviteStats = { remaining: 2, used: 3 };
    const state = {
      wallet: owner,
      allianceAvailable: true,
      membership: { allianceId: "1", role: "owner" as const, joinedAt: "100" },
      profile: {
        active: true,
        tag: "HOM",
        name: "Home",
        description: "",
        owner,
        createdAt: "100",
        memberCount: 1,
      },
      directory: [{
        allianceId: "1",
        active: true,
        tag: "HOM",
        name: "Home",
        description: "",
        owner,
        createdAt: "100",
        memberCount: 1,
        bonusBalance: balance,
        privateInviteStats,
      }],
      pendingInvites: [],
      pendingJoinRequests: [],
      allianceJoinRequests: [],
      diplomacy: [],
      activeWars: [],
      members: [],
    };

    expect(currentAllianceEntry(state, 1)?.bonusBalance).toEqual(balance);
    expect(currentAllianceEntry(state, 1)?.privateInviteStats).toEqual(privateInviteStats);
  });

  test("allianceDisplayName keeps tag and name compact", () => {
    expect(allianceDisplayName({ tag: "VDFT", name: "Veydrift Union" })).toBe("VDFT - Veydrift Union");
  });

  test("renders alliance descriptions through clickable link parts", () => {
    const alliancePageSource = readFileSync(new URL("../src/components/AlliancePage.tsx", import.meta.url), "utf8");
    const inspectPagesSource = readFileSync(new URL("../src/components/InspectPages.tsx", import.meta.url), "utf8");

    expect(alliancePageSource).toContain("<AllianceDescription description={currentAlliance.description}");
    expect(alliancePageSource).toContain("<AllianceDescription description={alliance.description}");
    expect(alliancePageSource).toContain('target="_blank"');
    expect(alliancePageSource).toContain('rel="noreferrer noopener"');
    expect(inspectPagesSource).toContain("<AllianceSummary alliance={alliance} onOpenPlayer={onOpenPlayer} />");
  });
});
