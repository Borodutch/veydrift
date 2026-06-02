import { describe, expect, test } from "bun:test";
import { hasAllianceMembership } from "../src/components/AlliancePage";
import type { ChainAllianceState } from "../src/walletFlow";

describe("AlliancePage", () => {
  test("treats a player with no alliance as outside member-only panels", () => {
    expect(hasAllianceMembership(noAllianceState())).toBe(false);
    expect(hasAllianceMembership(null)).toBe(false);
  });

  test("detects active alliance membership", () => {
    expect(hasAllianceMembership(memberAllianceState())).toBe(true);
  });
});

function noAllianceState(): ChainAllianceState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    allianceAvailable: true,
    membership: {
      allianceId: "0",
      role: "none",
      joinedAt: "0",
    },
    profile: null,
    directory: [],
    pendingInvites: [],
    pendingJoinRequests: [],
    allianceJoinRequests: [],
    members: [],
  };
}

function memberAllianceState(): ChainAllianceState {
  return {
    wallet: "0x1111111111111111111111111111111111111111",
    allianceAvailable: true,
    membership: {
      allianceId: "1",
      role: "officer",
      joinedAt: "1770000000",
    },
    profile: {
      active: true,
      tag: "VDFT",
      name: "Veydrift Union",
      description: "Public coordination",
      owner: "0x2222222222222222222222222222222222222222",
      createdAt: "1770000000",
      memberCount: 2,
    },
    directory: [],
    pendingInvites: [],
    pendingJoinRequests: [],
    allianceJoinRequests: [],
    members: [
      {
        address: "0x1111111111111111111111111111111111111111",
        role: "officer",
        joinedAt: "1770000000",
      },
      {
        address: "0x2222222222222222222222222222222222222222",
        role: "owner",
        joinedAt: "1770000000",
      },
    ],
  };
}
