import { describe, expect, test } from "bun:test";

import { parseInternalDetailRoute } from "./inspectRoutes";

describe("internal detail routing", () => {
  test("recognizes every entity detail route for client-side navigation", () => {
    const origin = "https://veydrift.com";

    expect(parseInternalDetailRoute("/planet/1/2/3", origin)).toEqual({
      kind: "planet",
      coords: { galaxy: 1, system: 2, position: 3 },
    });
    expect(parseInternalDetailRoute("/moon/1/2/3", origin)).toEqual({
      kind: "moon",
      coords: { galaxy: 1, system: 2, position: 3 },
    });
    expect(parseInternalDetailRoute("/player/0xabc", origin)).toEqual({ kind: "player", wallet: "0xabc" });
    expect(parseInternalDetailRoute("/alliance/42", origin)).toEqual({ kind: "alliance", allianceId: "42" });
    expect(parseInternalDetailRoute("/mission/123", origin)).toEqual({ kind: "mission", missionId: "123" });
    expect(parseInternalDetailRoute("/mission-control/report/123", origin)).toEqual({ kind: "mission-report", missionId: "123" });
  });

  test("leaves external and page navigation to their respective owners", () => {
    const origin = "https://veydrift.com";

    expect(parseInternalDetailRoute("https://basescan.org/tx/0xabc", origin)).toBeNull();
    expect(parseInternalDetailRoute("/docs", origin)).toBeNull();
    expect(parseInternalDetailRoute("/mission-control?view=past", origin)).toBeNull();
  });
});
