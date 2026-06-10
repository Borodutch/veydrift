import { describe, expect, test } from "bun:test";
import { canTransferAllianceOwnership } from "./components/AlliancePage";

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
