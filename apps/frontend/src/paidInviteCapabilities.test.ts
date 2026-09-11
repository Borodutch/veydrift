import { expect, test } from "bun:test";
import { paidAllianceInviteCapabilitiesForRuntime, type RuntimeConfig } from "./runtimeConfig";

test("private invite actions fail closed locally and preserve fully configured legacy backends", () => {
  const config = (overrides: Partial<RuntimeConfig>) => overrides as RuntimeConfig;
  expect(paidAllianceInviteCapabilitiesForRuntime(undefined)).toEqual({ redemption: false, recovery: false });
  expect(paidAllianceInviteCapabilitiesForRuntime(config({ paidAllianceInviteAddress: "0xcontract" }))).toEqual({ redemption: false, recovery: false });
  const legacy = { paidAllianceInviteAddress: "0xcontract", paidAllianceInviteSignerAddress: "0xsigner" };
  expect(paidAllianceInviteCapabilitiesForRuntime(config(legacy))).toEqual({ redemption: true, recovery: true });
  for (const capabilities of [
    { redemption: false, recovery: false }, { redemption: true, recovery: false },
    { redemption: false, recovery: true }, { redemption: true, recovery: true },
  ]) expect(paidAllianceInviteCapabilitiesForRuntime(config({ ...legacy, paidAllianceInviteCapabilities: capabilities }))).toEqual(capabilities);
});
