import { describe, expect, test } from "bun:test";
import {
  canRemoveAllianceRosterMember,
  canSelectAllianceRosterMember,
  canTransferAllianceOwnership,
} from "./components/AlliancePage";

describe("canTransferAllianceOwnership", () => {
  test("owners may hand ownership to an officer", () => {
    expect(canTransferAllianceOwnership({ role: "officer" }, true, false)).toBe(true);
  });

  test("non-owners can never transfer ownership", () => {
    expect(canTransferAllianceOwnership({ role: "officer" }, false, false)).toBe(false);
  });

  test("plain members and existing owners are not valid transfer targets", () => {
    expect(canTransferAllianceOwnership({ role: "member" }, true, false)).toBe(false);
    expect(canTransferAllianceOwnership({ role: "owner" }, true, false)).toBe(false);
  });

  test("an owner cannot transfer ownership to themselves", () => {
    expect(canTransferAllianceOwnership({ role: "officer" }, true, true)).toBe(false);
  });
});

describe("alliance batch roster eligibility", () => {
  const viewer = "0x1111111111111111111111111111111111111111";
  const member = { address: "0x2222222222222222222222222222222222222222", role: "member" as const };
  const officer = { address: "0x3333333333333333333333333333333333333333", role: "officer" as const };
  const owner = { address: "0x4444444444444444444444444444444444444444", role: "owner" as const };
  const self = { address: viewer, role: "member" as const };

  test("owners can batch select members and officers, but not owners or themselves", () => {
    expect(canSelectAllianceRosterMember({ canManageMembers: true, isOwner: true, member, viewer })).toBe(true);
    expect(canSelectAllianceRosterMember({ canManageMembers: true, isOwner: true, member: officer, viewer })).toBe(true);
    expect(canSelectAllianceRosterMember({ canManageMembers: true, isOwner: true, member: owner, viewer })).toBe(false);
    expect(canSelectAllianceRosterMember({ canManageMembers: true, isOwner: true, member: self, viewer })).toBe(false);
  });

  test("officers can batch remove plain members only", () => {
    expect(canRemoveAllianceRosterMember({ canManageMembers: true, isOwner: false, member, viewer })).toBe(true);
    expect(canRemoveAllianceRosterMember({ canManageMembers: true, isOwner: false, member: officer, viewer })).toBe(false);
    expect(canRemoveAllianceRosterMember({ canManageMembers: true, isOwner: false, member: owner, viewer })).toBe(false);
  });
});
