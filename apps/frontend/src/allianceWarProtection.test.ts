import { describe, expect, test } from "bun:test";

describe("alliance war protection UI", () => {
  test("explains the frozen 1.5x protection rule before a declaration", async () => {
    const source = await Bun.file(new URL("./components/AlliancePage.tsx", import.meta.url)).text();

    expect(source).toContain("Once declared, a war cannot be ended for 48 hours.");
    expect(source).toContain("This snapshots both alliances’ canonical on-chain score and current members.");
    expect(source).toContain("Defender score protection will remain enabled");
    expect(source).toContain("1.5× war threshold");
    expect(source).toContain("Your declarer alliance receives no war score-protection exception");
    expect(source).toContain("Late joins and members who leave/rejoin receive no war exceptions.");
    expect(source).toContain("each alliance may snapshot at most 64 current members");
  });
});
