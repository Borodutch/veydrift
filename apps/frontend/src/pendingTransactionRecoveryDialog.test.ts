import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pendingTransactionRecoveryAgeLabel } from "./pendingTransactionRecovery";

describe("pending transaction recovery dialog", () => {
  test("formats persisted transaction age without restarting from page load", () => {
    const now = 1_800_000_000_000;
    expect(pendingTransactionRecoveryAgeLabel(now - 5 * 60_000, now)).toBe("5 minutes");
    expect(pendingTransactionRecoveryAgeLabel(now - 2 * 60 * 60_000, now)).toBe("2 hours");
  });

  test("renders one accessible store-driven decision in both wallet shells", () => {
    const component = readFileSync(new URL("./components/PendingTransactionRecoveryDialog.tsx", import.meta.url), "utf8");
    const mainShell = readFileSync(new URL("./PlayableMvpApp.tsx", import.meta.url), "utf8");
    const settlementShell = readFileSync(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url), "utf8");
    const store = readFileSync(new URL("./backendDataStore.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(component).toContain('role="alertdialog"');
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain("Keep waiting");
    expect(component).toContain("Discard saved record");
    expect(mainShell).toContain("<PendingTransactionRecoveryDialog");
    expect(settlementShell).toContain("<PendingTransactionRecoveryDialog");
    expect(store).not.toContain("window.confirm");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("@media (max-width: 440px)");
  });
});
