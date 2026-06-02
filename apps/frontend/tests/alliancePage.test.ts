import { describe, expect, test } from "bun:test";
import {
  allianceDisplayName,
  buildAllianceRoster,
  findAllianceEntry,
  joinRequestApprovalAvailability,
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

  test("allianceDisplayName keeps tag and name compact", () => {
    expect(allianceDisplayName({ tag: "VDFT", name: "Veydrift Union" })).toBe("VDFT - Veydrift Union");
  });

  test("keeps mixed pending applicants eligible one row at a time", () => {
    const validRequest = {
      allianceId: "1",
      requester: "0x4444444444444444444444444444444444444444",
      requestedAt: "1770000000",
    };
    const staleRequest = {
      allianceId: "1",
      requester: member,
      requestedAt: "1770000001",
    };

    expect(joinRequestApprovalAvailability({
      currentAllianceId: "1",
      members: [{ address: member, role: "member", joinedAt: "30" }],
      request: validRequest,
      role: "officer",
    })).toEqual({ canApprove: true });
    expect(joinRequestApprovalAvailability({
      currentAllianceId: "1",
      members: [{ address: member, role: "member", joinedAt: "30" }],
      request: staleRequest,
      role: "officer",
    })).toEqual({
      canApprove: false,
      reason: "Applicant is already in this alliance.",
    });
  });

  test("blocks join approvals when the caller role or alliance target is stale", () => {
    const request = {
      allianceId: "2",
      requester: member,
      requestedAt: "1770000000",
    };

    expect(joinRequestApprovalAvailability({
      currentAllianceId: "1",
      members: [],
      request,
      role: "officer",
    })).toEqual({
      canApprove: false,
      reason: "This application targets another alliance.",
    });
    expect(joinRequestApprovalAvailability({
      currentAllianceId: "2",
      members: [],
      request,
      role: "member",
    })).toEqual({
      canApprove: false,
      reason: "Only alliance owners or officers can approve applications.",
    });
  });
});
