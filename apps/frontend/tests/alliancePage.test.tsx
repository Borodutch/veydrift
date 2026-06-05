import { describe, expect, test } from "bun:test";
import {
  allianceDirectoryPageSize,
  allianceRosterPageSize,
  allianceExitActionState,
  allianceInviteAcceptanceState,
  allianceJoinRequestApprovalState,
  allianceJoinRequestDismissalState,
  directoryPageCount,
  directoryPageRows,
  hasAllianceMembership,
  rosterPageCount,
  rosterPageRows,
  shouldShowAllianceInitialLoader,
  shouldShowAllianceRefreshIndicator,
  sortedAllianceDirectory,
} from "../src/components/AlliancePage";
import type { ChainAllianceState } from "../src/walletFlow";

const alliancePageSource = await Bun.file(new URL("../src/components/AlliancePage.tsx", import.meta.url)).text();

describe("AlliancePage loading display", () => {
  test("uses the shared app shell instead of an extra Alliance page wrapper", () => {
    expect(alliancePageSource).toContain('<section className="grid min-h-0 gap-4">');
    expect(alliancePageSource).not.toContain('className="min-h-0 overflow-auto bg-[#080d16]"');
    expect(alliancePageSource).not.toContain('className="mx-auto grid w-full max-w-7xl gap-4 p-4"');
  });

  test("uses the shared labeled refresh button treatment", () => {
    expect(alliancePageSource).toContain("inline-flex h-9 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200");
    expect(alliancePageSource).toContain('<RefreshCw aria-hidden="true" size={14} />');
    expect(alliancePageSource).toContain("Refresh");
    expect(alliancePageSource).not.toContain('className="icon-button" onClick={onRefresh}');
  });

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

  test("keeps stale applicants non-approvable while still allowing officers to dismiss the stale application", () => {
    const state = memberAllianceState();
    const staleRequest = joinRequest("0x4444444444444444444444444444444444444444", {
      allianceId: "8",
      role: "member",
      joinedAt: "1770000010",
    });

    expect(allianceJoinRequestApprovalState(state, staleRequest)).toEqual({
      canApprove: false,
      reason: "Applicant already joined another alliance.",
    });
    expect(allianceJoinRequestDismissalState(state, staleRequest)).toEqual({
      canDismiss: true,
      reason: null,
    });
  });

  test("allows officers to dismiss applications by default", () => {
    const state = memberAllianceState();

    expect(allianceJoinRequestDismissalState(state, joinRequest("0x3333333333333333333333333333333333333333"))).toEqual({
      canDismiss: true,
      reason: null,
    });
  });

  test("blocks join application dismissal for non-officer viewers", () => {
    const state = memberAllianceState({
      membership: {
        allianceId: "7",
        joinedAt: "1770000000",
        role: "member",
      },
    });

    expect(allianceJoinRequestDismissalState(state, joinRequest("0x3333333333333333333333333333333333333333"))).toEqual({
      canDismiss: false,
      reason: "Only officers and owners can dismiss applications.",
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

  test("enables leave for non-owner members and delete only for solo owners", () => {
    expect(allianceExitActionState(unaffiliatedAllianceState())).toEqual({
      canSubmit: false,
      label: "Leave Alliance",
      reason: "You are not in an alliance.",
    });

    expect(allianceExitActionState(memberAllianceState())).toEqual({
      canSubmit: true,
      label: "Leave Alliance",
      reason: null,
    });
    expect(allianceExitActionState(memberAllianceState({
      membership: {
        allianceId: "7",
        joinedAt: "1770000000",
        role: "member",
      },
    }))).toEqual({
      canSubmit: true,
      label: "Leave Alliance",
      reason: null,
    });

    expect(allianceExitActionState(memberAllianceState({
      membership: {
        allianceId: "7",
        joinedAt: "1770000000",
        role: "owner",
      },
      profile: {
        active: true,
        createdAt: "1770000000",
        description: "Outer-rim coordination",
        memberCount: 2,
        name: "Veydrift Union",
        owner: "0x1111111111111111111111111111111111111111",
        tag: "VDFT",
      },
    }))).toEqual({
      canSubmit: false,
      label: "Delete Alliance",
      reason: "Remove every other member before deleting this alliance.",
    });

    expect(allianceExitActionState(memberAllianceState({
      members: [
        {
          address: "0x1111111111111111111111111111111111111111",
          joinedAt: "1770000000",
          role: "owner",
        },
      ],
      membership: {
        allianceId: "7",
        joinedAt: "1770000000",
        role: "owner",
      },
      profile: {
        active: true,
        createdAt: "1770000000",
        description: "Outer-rim coordination",
        memberCount: 1,
        name: "Veydrift Union",
        owner: "0x1111111111111111111111111111111111111111",
        tag: "VDFT",
      },
    }))).toEqual({
      canSubmit: true,
      label: "Delete Alliance",
      reason: null,
    });
  });

  test("paginates long alliance rosters at 10 members per page", () => {
    const rows = Array.from({ length: 121 }, (_, index) => `member-${index + 1}`);

    expect(allianceRosterPageSize).toBe(10);
    expect(rosterPageCount(rows.length)).toBe(13);
    expect(rosterPageRows(rows, 1)).toEqual(rows.slice(0, 10));
    expect(rosterPageRows(rows, 2)).toEqual(rows.slice(10, 20));
    expect(rosterPageRows(rows, 13)).toEqual(rows.slice(120, 121));
    expect(rosterPageRows(rows, 99)).toEqual(rows.slice(120, 121));
  });

  test("sorts alliance directory by total member score and paginates at 10 rows", () => {
    const alliances = [
      directoryAlliance("1", true, { name: "Low", totalMemberScore: "100", memberCount: 2 }),
      directoryAlliance("2", true, { name: "Top", totalMemberScore: "900", memberCount: 1 }),
      directoryAlliance("3", true, { name: "Mid", totalMemberScore: "500", memberCount: 5 }),
      directoryAlliance("4", true, { name: "No Score", memberCount: 99 }),
    ];
    const rows = Array.from({ length: 24 }, (_, index) => directoryAlliance(String(index + 10), true, {
      name: `Alliance ${index + 10}`,
      totalMemberScore: String(24 - index),
    }));

    expect(sortedAllianceDirectory(alliances).map((alliance) => alliance.allianceId)).toEqual(["2", "3", "1", "4"]);
    expect(allianceDirectoryPageSize).toBe(10);
    expect(directoryPageCount(rows.length)).toBe(3);
    expect(directoryPageRows(rows, 1)).toEqual(rows.slice(0, 10));
    expect(directoryPageRows(rows, 3)).toEqual(rows.slice(20, 24));
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

function directoryAlliance(
  allianceId: string,
  active: boolean,
  overrides: Partial<ChainAllianceState["directory"][number]> = {}
): ChainAllianceState["directory"][number] {
  return {
    active,
    allianceId,
    createdAt: "1770000000",
    description: "Outer-rim coordination",
    memberCount: 2,
    name: "Veydrift Union",
    owner: "0x2222222222222222222222222222222222222222",
    tag: "VDFT",
    ...overrides,
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
