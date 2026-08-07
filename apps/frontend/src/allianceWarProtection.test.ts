import { describe, expect, test } from "bun:test";

describe("alliance war protection UI", () => {
  test("explains the frozen 1.5x protection rule before a declaration", async () => {
    const source = await Bun.file(new URL("./components/AlliancePage.tsx", import.meta.url)).text();

    expect(source).toContain("Once declared, a war cannot be ended for 48 hours.");
    expect(source).toContain("War scores and rosters are locked on-chain at declaration.");
    expect(source).toContain("Alliance score check failed:");
    expect(source).toContain("Two score checks apply when you attack");
    expect(source).toContain("each attacker must be no more than 1.5× their target");
    expect(source).toContain("Defender advantage:");
    expect(source).toContain("Late joins and members who leave or rejoin get no war exceptions.");
    expect(source).toContain("each alliance can snapshot at most 64 members");
    expect(source).toContain("<WarDeclarationRule icon={Scale}");
  });
});
