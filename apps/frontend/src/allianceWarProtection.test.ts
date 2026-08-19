import { describe, expect, test } from "bun:test";

describe("alliance war protection UI", () => {
  test("explains the frozen directional protection rule before a declaration", async () => {
    const source = await Bun.file(new URL("./components/AlliancePage.tsx", import.meta.url)).text();

    expect(source).toContain("Once declared, a war cannot be ended for 48 hours.");
    expect(source).toContain("War scores and rosters are locked on-chain at declaration.");
    expect(source).toContain("an original member regains that privilege when rejoining their original alliance");
    expect(source).toContain("Your alliance is not stronger at declaration");
    expect(source).toContain("only {allianceName}&apos;s original members can bypass score protection and bashing limits");
    expect(source).toContain("both original rosters will bypass score protection and bashing limits");
    expect(source).toContain("A weaker/equal declaration or a stronger declaration within 1.5× is bilateral");
    expect(source).toContain("each alliance can snapshot at most 64 members");
    expect(source).toContain("<WarDeclarationRule icon={Scale}");
  });
});
