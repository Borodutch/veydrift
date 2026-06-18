import { describe, expect, test } from "bun:test";
import { descriptionLinkParts, descriptionUrlHref, isSafeDescriptionUrl } from "./descriptionLinks";

describe("description link helpers", () => {
  test("linkifies plain http and https URLs while preserving surrounding text", () => {
    expect(descriptionLinkParts("Diplomacy: https://veydrift.com/alliance and http://example.com/forum")).toEqual([
      { text: "Diplomacy: " },
      { href: "https://veydrift.com/alliance", text: "https://veydrift.com/alliance" },
      { text: " and " },
      { href: "http://example.com/forum", text: "http://example.com/forum" },
    ]);
  });

  test("keeps unsafe protocol strings inert", () => {
    expect(descriptionLinkParts("Do not link javascript:https://evil.test, data:t.me/evil or file://t.me/evil")).toEqual([
      { text: "Do not link javascript:https://evil.test, data:t.me/evil or file://t.me/evil" },
    ]);
    expect(isSafeDescriptionUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeDescriptionUrl("data:text/html,hi")).toBe(false);
    expect(isSafeDescriptionUrl("file:///tmp/x")).toBe(false);
  });

  test("linkifies bare domain URLs with safe https hrefs", () => {
    expect(descriptionLinkParts("Join t.me/+4rzhJDnezNhiN2Ux or DM t.me/borodutch.")).toEqual([
      { text: "Join " },
      { href: "https://t.me/+4rzhJDnezNhiN2Ux", text: "t.me/+4rzhJDnezNhiN2Ux" },
      { text: " or DM " },
      { href: "https://t.me/borodutch", text: "t.me/borodutch" },
      { text: "." },
    ]);
    expect(descriptionUrlHref("t.me/borodutch")).toBe("https://t.me/borodutch");
  });

  test("preserves line breaks and leaves trailing punctuation outside links", () => {
    expect(descriptionLinkParts("Line one\nVisit https://veydrift.com/raid, then ping us.")).toEqual([
      { text: "Line one\nVisit " },
      { href: "https://veydrift.com/raid", text: "https://veydrift.com/raid" },
      { text: "," },
      { text: " then ping us." },
    ]);
  });

  test("returns a single inert text part for empty or no-link descriptions", () => {
    expect(descriptionLinkParts("")).toEqual([{ text: "" }]);
    expect(descriptionLinkParts("No public link today.")).toEqual([{ text: "No public link today." }]);
    expect(descriptionLinkParts("Contact admin@example.com for invites.")).toEqual([
      { text: "Contact admin@example.com for invites." },
    ]);
  });
});
