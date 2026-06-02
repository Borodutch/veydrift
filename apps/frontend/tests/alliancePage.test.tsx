import { describe, expect, test } from "bun:test";
import {
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
});

function unaffiliatedAllianceState(): ChainAllianceState {
  return allianceState({
    membership: {
      allianceId: "0",
      joinedAt: "0",
      role: "none",
    },
    profile: null,
  });
}

function memberAllianceState(): ChainAllianceState {
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
  });
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
