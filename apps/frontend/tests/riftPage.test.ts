import { describe, expect, test } from "bun:test";

const riftPageSource = await Bun.file(new URL("../src/components/RiftPage.tsx", import.meta.url)).text();

describe("Rift page transaction gating", () => {
  test("surfaces transaction sync copy while resource actions are gated", () => {
    expect(riftPageSource).toContain("transactionUnavailableReason?: string | undefined;");
    expect(riftPageSource).toContain("{!canTransact && transactionUnavailableReason ? (");
    expect(riftPageSource).toContain("disabledReason={!canTransact ? transactionUnavailableReason");
    expect(riftPageSource).toContain("title={!canTransact ? transactionUnavailableReason : undefined}");
  });
});
