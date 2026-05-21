import { describe, expect, test } from "bun:test";
import { waitForSettledPlanet } from "../src/postSettlementSync";
import type { Eip1193Provider, SettlementConfig, SettlementState } from "../src/walletFlow";

const provider = {
  request: async () => {
    throw new Error("provider should not be called by this test");
  },
} satisfies Eip1193Provider;

const account = "0x1111111111111111111111111111111111111111";
const config = {
  address: "0x2222222222222222222222222222222222222222",
} satisfies SettlementConfig;

describe("post-settlement sync", () => {
  test("accepts a confirmed game settlement before full planet coordinates hydrate", async () => {
    const confirmedSettlement = {
      kind: "settled",
      planet: {
        label: "Planet #42",
        source: "chain",
      },
    } satisfies SettlementState;

    await expect(waitForSettledPlanet(provider, account, config, {
      attempts: 1,
      delay: async () => undefined,
      readSettlementState: async () => confirmedSettlement,
    })).resolves.toBe(confirmedSettlement);
  });

  test("checks the settlement state returned by the final retry read", async () => {
    const reads: SettlementState[] = [
      { kind: "not-settled" },
      {
        kind: "settled",
        planet: {
          label: "Planet #43",
          source: "chain",
        },
      },
    ];

    await expect(waitForSettledPlanet(provider, account, config, {
      attempts: 1,
      delay: async () => undefined,
      readSettlementState: async () => reads.shift() ?? { kind: "not-settled" },
    })).resolves.toMatchObject({
      kind: "settled",
      planet: {
        label: "Planet #43",
      },
    });
  });
});
