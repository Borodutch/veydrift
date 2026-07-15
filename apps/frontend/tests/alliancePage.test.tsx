import { describe, expect, test } from "bun:test";
import {
  allianceDirectoryPageSize,
  allianceDirectoryWarActionState,
  allianceRefreshButtonState,
  allianceRosterPageSize,
  allianceExitActionState,
  allianceInviteAcceptanceState,
  allianceJoinRequestApprovalState,
  allianceJoinRequestDismissalState,
  allianceWarEndActionState,
  clampDirectoryPage,
  clampRosterPage,
  directoryPageCount,
  directoryPageRows,
  hasAllianceMembership,
  memberCountLabel,
  rosterPageCount,
  rosterPageRows,
  shouldShowAllianceInitialLoader,
  shouldShowAllianceTransactionNotice,
  sortedAllianceDirectory,
  sortedRosterMembers,
  warMinimumDurationCopy,
} from "../src/components/AlliancePage";
import type { ChainAllianceState } from "../src/walletFlow";

const alliancePageSource = await Bun.file(new URL("../src/components/AlliancePage.tsx", import.meta.url)).text();
const inspectPagesSource = await Bun.file(new URL("../src/components/InspectPages.tsx", import.meta.url)).text();
const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
const walletFlowSource = await Bun.file(new URL("../src/walletFlow.ts", import.meta.url)).text();

describe("AlliancePage loading display", () => {
  test("uses the shared app shell instead of an extra Alliance page wrapper", () => {
    expect(alliancePageSource).toContain('<section className="grid min-h-0 gap-4">');
    expect(alliancePageSource).not.toContain('className="min-h-0 overflow-auto bg-[#080d16]"');
    expect(alliancePageSource).not.toContain('className="mx-auto grid w-full max-w-7xl gap-4 p-4"');
  });

  test("restyles the Invite referral panel as a core app page surface", () => {
    expect(alliancePageSource).toContain('<section className="invite-page grid min-h-0 gap-4">');
    expect(stylesSource).toContain(".invite-page .referral-program");
    expect(stylesSource).toContain("border: 1px solid rgba(255, 255, 255, 0.1);");
    expect(stylesSource).toContain("background: rgba(255, 255, 255, 0.04);");
    expect(stylesSource).toContain(".invite-page .referral-copy-button");
  });

  test("uses the shared labeled refresh button treatment", () => {
    expect(alliancePageSource).toContain("<RefreshButton");
    expect(alliancePageSource).toContain("Refresh alliance state");
    expect(alliancePageSource).toContain("Refresh");
    expect(alliancePageSource).not.toContain('className="icon-button" onClick={onRefresh}');
  });

  test("uses the shared labeled refresh button treatment on inspected alliances", () => {
    expect(inspectPagesSource).toContain("<RefreshButton");
    expect(inspectPagesSource).toContain("loading={disabled}");
    expect(inspectPagesSource).toContain("Refresh alliance state");
    expect(inspectPagesSource).not.toContain('<button className="icon-button" disabled={actionBusy} onClick={onRefresh}');
  });

  test("surfaces transaction sync copy on alliance pages while shared actions are gated", () => {
    expect(alliancePageSource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(alliancePageSource).toContain("shouldShowAllianceTransactionNotice({");
    expect(alliancePageSource).toContain("{!canTransact && showTransactionUnavailableNotice ? <Notice>{transactionUnavailableReason}</Notice> : null}");
    expect(inspectPagesSource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(inspectPagesSource).toContain("{!canTransact && transactionUnavailableReason ? <Notice>{transactionUnavailableReason}</Notice> : null}");
  });

  test("deduplicates alliance transaction unavailable copy that matches the active action notice", () => {
    const label = "Alliance join approval: syncing indexed state...";
    expect(shouldShowAllianceTransactionNotice({
      actionLabel: label,
      transactionUnavailableReason: label,
    })).toBe(false);
    expect(shouldShowAllianceTransactionNotice({
      actionLabel: label,
      transactionUnavailableReason: "Alliance contract unavailable.",
    })).toBe(true);
    expect(shouldShowAllianceTransactionNotice({
      transactionUnavailableReason: "Alliance contract unavailable.",
    })).toBe(true);
    expect(shouldShowAllianceTransactionNotice({ actionLabel: label })).toBe(false);
  });

  test("uses the shared loader for initial alliance state loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: null,
      loading: true,
    })).toBe(true);
  });

  test("keeps confirmed alliance data visible during background refresh", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: memberAllianceState(),
      loading: true,
    })).toBe(false);
    expect(allianceRefreshButtonState(true)).toEqual({ disabled: true, label: "Refreshing" });
    expect(alliancePageSource).not.toContain("Refreshing alliance");
    expect(alliancePageSource).not.toContain("InlineSyncIndicator");
  });

  test("keeps loaded unaffiliated state distinct from loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: unaffiliatedAllianceState(),
      loading: false,
    })).toBe(false);
    expect(allianceRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
  });

  test("keeps loaded member state distinct from loading", () => {
    expect(shouldShowAllianceInitialLoader({
      allianceState: memberAllianceState(),
      loading: false,
    })).toBe(false);
    expect(allianceRefreshButtonState(false)).toEqual({ disabled: false, label: "Refresh" });
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

  test("renders join applications with the shared member-row player info treatment", () => {
    expect(alliancePageSource).toContain("function PlayerRowInfo");
    expect(alliancePageSource).toContain("<PlayerRowInfo");
    expect(alliancePageSource).toContain('badge="Applicant"');
    expect(alliancePageSource).toContain("totalScore={request.requesterTotalScore}");
    expect(alliancePageSource).toContain('timestampLabel="Requested"');
    expect(alliancePageSource).toContain("Score {formatScore(totalScore)} / {timestampLabel} {formatUserTimestamp(timestamp)}");
    expect(alliancePageSource).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
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
    expect(clampRosterPage(3, rows.length)).toBe(3);
    expect(clampRosterPage(99, rows.length)).toBe(13);
    expect(clampRosterPage(0, rows.length)).toBe(1);
    expect(rosterPageRows(rows, 1)).toEqual(rows.slice(0, 10));
    expect(rosterPageRows(rows, 2)).toEqual(rows.slice(10, 20));
    expect(rosterPageRows(rows, 13)).toEqual(rows.slice(120, 121));
    expect(rosterPageRows(rows, 99)).toEqual(rows.slice(120, 121));
  });

  test("preserves alliance roster page during same-size refetches and only clamps invalid pages", () => {
    expect(clampRosterPage(5, 118)).toBe(5);
    expect(clampRosterPage(5, 111)).toBe(5);
    expect(clampRosterPage(12, 111)).toBe(12);
    expect(clampRosterPage(12, 109)).toBe(11);
    expect(alliancePageSource).toContain("setPage((current) => clampRosterPage(current, sortedRows.length));");
    expect(alliancePageSource).toContain("[sortedRows.length]");
    expect(alliancePageSource).not.toContain("setPage(1);\n  }, [rows]);");
  });

  test("sorts alliance rosters by role group and member score before pagination", () => {
    const rows = [
      rosterMember("0x4000000000000000000000000000000000000000", "member", "90"),
      rosterMember("0x3000000000000000000000000000000000000000", "officer", "10"),
      rosterMember("0x1000000000000000000000000000000000000000", "owner", "1"),
      rosterMember("0x5000000000000000000000000000000000000000", "member", "300"),
      rosterMember("0x2000000000000000000000000000000000000000", "officer", "200"),
      ...Array.from({ length: 9 }, (_, index) =>
        rosterMember(`0x6${String(index).repeat(39)}`, "member", String(80 - index))
      ),
    ];
    const sortedRows = sortedRosterMembers(rows);

    expect(sortedRows.slice(0, 5).map((member) => member.address)).toEqual([
      "0x1000000000000000000000000000000000000000",
      "0x2000000000000000000000000000000000000000",
      "0x3000000000000000000000000000000000000000",
      "0x5000000000000000000000000000000000000000",
      "0x4000000000000000000000000000000000000000",
    ]);
    expect(rosterPageRows(sortedRows, 1)).toEqual(sortedRows.slice(0, 10));
    expect(rosterPageRows(sortedRows, 1).map((member) => member.role)).toEqual([
      "owner",
      "officer",
      "officer",
      "member",
      "member",
      "member",
      "member",
      "member",
      "member",
      "member",
    ]);
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
    expect(clampDirectoryPage(2, rows.length)).toBe(2);
    expect(clampDirectoryPage(9, rows.length)).toBe(3);
    expect(directoryPageRows(rows, 1)).toEqual(rows.slice(0, 10));
    expect(directoryPageRows(rows, 3)).toEqual(rows.slice(20, 24));
  });

  test("uses all-alliance directory copy and keeps inspected alliances out of a separate details panel", () => {
    expect(alliancePageSource).toContain('<Panel title="Alliances">');
    expect(alliancePageSource).not.toContain('<Panel title="Other Alliances">');
    expect(alliancePageSource).not.toContain('filter((alliance) => alliance.allianceId !== currentAllianceId)');
    expect(alliancePageSource).not.toContain("Alliance Details");
  });

  test("moves declare war to owner-only alliance directory rows", () => {
    const activeWarAllianceIds = new Set(["9"]);

    expect(allianceDirectoryWarActionState({
      activeWarAllianceIds,
      allianceId: "8",
      canDeclareWar: true,
      currentAllianceId: "7",
    })).toEqual({
      atWar: false,
      canDeclare: true,
    });
    expect(allianceDirectoryWarActionState({
      activeWarAllianceIds,
      allianceId: "8",
      canDeclareWar: false,
      currentAllianceId: "7",
    })).toEqual({
      atWar: false,
      canDeclare: false,
    });
    expect(allianceDirectoryWarActionState({
      activeWarAllianceIds,
      allianceId: "7",
      canDeclareWar: true,
      currentAllianceId: "7",
    })).toEqual({
      atWar: false,
      canDeclare: false,
    });
    expect(allianceDirectoryWarActionState({
      activeWarAllianceIds,
      allianceId: "9",
      canDeclareWar: true,
      currentAllianceId: "7",
    })).toEqual({
      atWar: true,
      canDeclare: false,
    });
    expect(alliancePageSource).toContain("<DirectorySection");
    expect(alliancePageSource).toContain("Declare War");
    expect(alliancePageSource).not.toContain('<span className="text-xs uppercase tracking-[0.14em] text-slate-500">Declare War</span>');
    expect(alliancePageSource).not.toContain("<option value=\"\">Select alliance</option>");
    expect(alliancePageSource).toContain('role="dialog"');
    expect(alliancePageSource).toContain("Confirm War Declaration");
    expect(warMinimumDurationCopy).toBe("Once declared, a war cannot be ended for 48 hours.");
  });

  test("only enables End War for wars started by the current alliance", () => {
    expect(allianceWarEndActionState({
      canEndWar: true,
      currentAllianceId: "7",
      declaredAt: "1000",
      initiatedByAllianceId: "7",
      nowSeconds: 1000 + 48 * 60 * 60,
    })).toEqual({
      visible: true,
      enabled: true,
      reason: null,
    });
    expect(allianceWarEndActionState({
      canEndWar: true,
      currentAllianceId: "7",
      declaredAt: "1000",
      initiatedByAllianceId: "8",
      nowSeconds: 1000 + 48 * 60 * 60,
    })).toEqual({
      visible: true,
      enabled: false,
      reason: "Only the alliance that declared this war can end it.",
    });
    expect(allianceWarEndActionState({
      canEndWar: true,
      currentAllianceId: "7",
      declaredAt: "1000",
      initiatedByAllianceId: null,
      nowSeconds: 1000,
    })).toEqual({
      visible: true,
      enabled: false,
      reason: "Only the alliance that declared this war can end it.",
    });
    expect(allianceWarEndActionState({
      canEndWar: false,
      currentAllianceId: "7",
      declaredAt: "1000",
      initiatedByAllianceId: "7",
      nowSeconds: 1000,
    })).toEqual({
      visible: false,
      enabled: false,
      reason: null,
    });
    expect(allianceWarEndActionState({
      canEndWar: true,
      currentAllianceId: "7",
      declaredAt: "1000",
      initiatedByAllianceId: "7",
      nowSeconds: 1000 + 60,
    })).toEqual({
      visible: true,
      enabled: false,
      reason: "War can be ended in 1d 23h.",
    });
    expect(allianceWarEndActionState({
      canEndWar: true,
      currentAllianceId: "7",
      declaredAt: null,
      initiatedByAllianceId: "7",
      nowSeconds: 1000,
    })).toEqual({
      visible: true,
      enabled: false,
      reason: "War declaration time is unavailable; End War remains locked.",
    });
    expect(alliancePageSource).toContain("disabledReasonId");
    expect(alliancePageSource).toContain("aria-describedby={disabledReasonId}");
    expect(alliancePageSource).toContain('role="tooltip"');
    expect(alliancePageSource).toContain("group-hover:opacity-100 group-focus-within:opacity-100");
    expect(alliancePageSource).toContain("Only the alliance that declared this war can end it.");
    expect(alliancePageSource).toContain("Reciprocal war: attack score protection and bashing limits are bypassed for both alliances.");
  });

  test("polishes alliance edit invite and delete controls with explicit labels", () => {
    expect(alliancePageSource).toContain("profileFormOpen");
    expect(alliancePageSource).toContain("Alliance controls");
    expect(alliancePageSource).toContain("Edit Profile");
    expect(alliancePageSource).toContain("Save Profile");
    expect(alliancePageSource).not.toContain("<h3 className=\"text-sm font-semibold text-white\">Profile</h3>");
    expect(alliancePageSource).toContain("Invite Member");
    expect(alliancePageSource).toContain("Close Invite");
    expect(alliancePageSource).toContain("Confirm Delete");
    expect(alliancePageSource).toContain("Trash2 size={15}");
    expect(alliancePageSource).toContain('const showExit = exitAction.label !== "Delete Alliance";');
  });

  test("keeps member controls enabled during background alliance refetches", () => {
    expect(alliancePageSource).toContain('const disabled = !canTransact || actionState.status === "pending";');
    expect(alliancePageSource).not.toContain("const disabled = !canTransact || loading || actionState.status === \"pending\";");
  });

  test("removes alliance inspect labeling from the dedicated alliance route", () => {
    expect(inspectPagesSource).not.toContain('eyebrow="Alliance Inspect"');
    expect(inspectPagesSource).toContain('<Panel title={isCurrentAlliance ? "My Alliance" : "Alliance"}>');
    expect(inspectPagesSource).toContain("<AllianceSummary alliance={alliance} onOpenPlayer={onOpenPlayer} />");
  });

  test("renders public inspected alliance member rows instead of directory explanation copy", () => {
    expect(walletFlowSource).toContain("members?: Array<{");
    expect(inspectPagesSource).toContain("publicRoster.all.length");
    expect(inspectPagesSource).toContain("members={publicRoster.all}");
    expect(inspectPagesSource).toContain("No indexed public members are available for this alliance yet.");
    expect(inspectPagesSource).not.toContain("Public directory data exposes");
  });

  test("keeps inspected alliance summaries player-facing instead of backend-detail heavy", () => {
    expect(inspectPagesSource).toContain("<PublicAllianceInspectSummary alliance={alliance} />");
    expect(inspectPagesSource).toContain('Pick<ChainAllianceState["directory"][number], "description" | "name" | "tag" | "totalMemberScore">');
    expect(inspectPagesSource).not.toContain("#{alliance.allianceId}");
  });

  test("pluralizes alliance member counts", () => {
    expect(memberCountLabel(0)).toBe("0 members");
    expect(memberCountLabel(1)).toBe("1 member");
    expect(memberCountLabel(2)).toBe("2 members");
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

function rosterMember(
  address: string,
  role: ChainAllianceState["members"][number]["role"],
  totalScore: string
): ChainAllianceState["members"][number] {
  return {
    address,
    joinedAt: "1770000000",
    role,
    totalScore,
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
