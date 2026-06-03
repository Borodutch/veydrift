import { describe, expect, test } from "bun:test";
import {
  allianceInviteAcceptanceState,
  allianceJoinRequestApprovalState,
  hasAllianceMembership,
  shouldShowAllianceInitialLoader,
  shouldShowAllianceRefreshIndicator,
} from "../src/components/AlliancePage";
import type { ChainAllianceState } from "../src/walletFlow";

describe("AlliancePage loading display", () => {
  test("uses the shared loader for initial alliance state loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: null,
      loading: true,
    })).toBe(true);
    expect(shouldShowAllianceRefreshIndicator({
      allianceState: null,
      loading: true,
    })).toBe(false);
  });

  test("keeps confirmed alliance data visible during background refresh", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: memberAllianceState(),
      loading: true,
    })).toBe(false);
    expect(shouldShowAllianceRefreshIndicator({
      allianceState: memberAllianceState(),
      loading: true,
    })).toBe(true);
  });

  test("keeps loaded unaffiliated state distinct from loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: unaffiliatedAllianceState(),
      loading: false,
    })).toBe(false);
    expect(shouldShowAllianceRefreshIndicator({
      allianceState: unaffiliatedAllianceState(),
      loading: false,
    })).toBe(false);
  });

  test("keeps loaded member state distinct from loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: memberAllianceState(),
      loading: false,
    })).toBe(false);
    expect(shouldShowAllianceRefreshIndicator({
      allianceState: memberAllianceState(),
      loading: false,
    })).toBe(false);
  });

  test("treats a player with no alliance as outside member-only panels", () => {
    expect(hasAllianceMembership(unaffiliatedAllianceState())).toBe(false);
    expect(hasAllianceMembership(null)).toBe(false);
  });

  test("detects active alliance membership", () => {
    expect(hasAllianceMembership(memberAllianceState())).toBe(true);
  });

  test("keeps valid join applicants approvable while blocking stale ineligible applicants", () => {
    const state = memberAllianceState();
    const validRequest = joinRequest("0x3333333333333333333333333333333333333333", {
      allianceId: "0",
      role: "none",
      joinedAt: "0",
    });
    const alreadyJoinedElsewhere = joinRequest("0x4444444444444444444444444444444444444444", {
      allianceId: "8",
      role: "member",
      joinedAt: "1770000010",
    });
    const alreadyInRoster = joinRequest("0x2222222222222222222222222222222222222222", {
      allianceId: "7",
      role: "owner",
      joinedAt: "1770000000",
    });

    expect(allianceJoinRequestApprovalState(state, validRequest)).toEqual({
      canApprove: true,
      reason: null,
    });
    expect(allianceJoinRequestApprovalState(state, alreadyJoinedElsewhere)).toEqual({
      canApprove: false,
      reason: "Applicant already joined another alliance.",
    });
    expect(allianceJoinRequestApprovalState(state, alreadyInRoster)).toEqual({
      canApprove: false,
      reason: "Applicant is already in this alliance.",
    });
  });

  test("blocks join approvals for non-officer viewers", () => {
    const state = memberAllianceState({
      membership: {
        allianceId: "7",
        joinedAt: "1770000000",
        role: "member",
      },
    });

    expect(allianceJoinRequestApprovalState(state, joinRequest("0x3333333333333333333333333333333333333333"))).toEqual({
      canApprove: false,
      reason: "Only officers and owners can approve applications.",
    });
  });

  test("keeps valid invites acceptable while blocking stale acceptance reverts", () => {
    const invite = allianceInvite("7");
    const state = unaffiliatedAllianceState({
      directory: [directoryAlliance("7", true)],
      pendingInvites: [invite],
    });

    expect(allianceInviteAcceptanceState(state, invite)).toEqual({
      canAccept: true,
      reason: null,
    });
    expect(allianceInviteAcceptanceState(state, allianceInvite("8"))).toEqual({
      canAccept: false,
      reason: "This invitation is no longer pending.",
    });
    expect(allianceInviteAcceptanceState({
      ...state,
      directory: [directoryAlliance("7", false)],
    }, invite)).toEqual({
      canAccept: false,
      reason: "This alliance is unavailable.",
    });
    expect(allianceInviteAcceptanceState(memberAllianceState({
      directory: [directoryAlliance("7", true)],
      pendingInvites: [invite],
    }), invite)).toEqual({
      canAccept: false,
      reason: "You are already in an alliance.",
    });
  });
});

function unaffiliatedAllianceState(overrides: Partial<ChainAllianceState> = {}): ChainAllianceState {
  return allianceState({
    membership: {
      allianceId: "0",
      joinedAt: "0",
      role: "none",
    },
    profile: null,
    ...overrides,
  });
}

function memberAllianceState(overrides: Partial<ChainAllianceState> = {}): ChainAllianceState {
  return allianceState({
    membership: {
      allianceId: "7",
      joinedAt: "1770000000",
      role: "officer",
    },
    profile: {
      active: true,
      createdAt: "1770000000",
      description: "Outer-rim coordination",
      memberCount: 2,
      name: "Veydrift Union",
      owner: "0x2222222222222222222222222222222222222222",
      tag: "VDFT",
    },
    members: [
      {
        address: "0x1111111111111111111111111111111111111111",
        joinedAt: "1770000000",
        role: "officer",
      },
      {
        address: "0x2222222222222222222222222222222222222222",
        joinedAt: "1770000000",
        role: "owner",
      },
    ],
    ...overrides,
  });
}

function joinRequest(
  requester: string,
  requesterMembership = {
    allianceId: "0",
    role: "none" as const,
    joinedAt: "0",
  }
): ChainAllianceState["allianceJoinRequests"][number] {
  return {
    allianceId: "7",
    requester,
    requesterMembership,
    requestedAt: "1770000001",
  };
}

function allianceInvite(allianceId: string): ChainAllianceState["pendingInvites"][number] {
  return {
    allianceId,
    invitedAt: "1770000001",
    inviter: "0x2222222222222222222222222222222222222222",
  };
}

function directoryAlliance(allianceId: string, active: boolean): ChainAllianceState["directory"][number] {
  return {
    active,
    allianceId,
    createdAt: "1770000000",
    description: "Outer-rim coordination",
    memberCount: 2,
    name: "Veydrift Union",
    owner: "0x2222222222222222222222222222222222222222",
    tag: "VDFT",
  };
}

function allianceState(overrides: Partial<ChainAllianceState> = {}): ChainAllianceState {
  return {
    allianceAvailable: true,
    allianceJoinRequests: [],
    directory: [],
    members: [],
    membership: {
      allianceId: "0",
      joinedAt: "0",
      role: "none",
    },
    pendingInvites: [],
    pendingJoinRequests: [],
    profile: null,
    wallet: "0x1111111111111111111111111111111111111111",
    ...overrides,
  };
}
