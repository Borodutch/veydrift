import { describe, expect, test } from "bun:test";
import { descriptionLinkParts, isSafeDescriptionUrl } from "./descriptionLinks";

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
    expect(descriptionLinkParts("Do not link javascript:alert(1), data:text/html,hi or file:///tmp/x")).toEqual([
      { text: "Do not link javascript:alert(1), data:text/html,hi or file:///tmp/x" },
    ]);
    expect(isSafeDescriptionUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeDescriptionUrl("data:text/html,hi")).toBe(false);
    expect(isSafeDescriptionUrl("file:///tmp/x")).toBe(false);
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
  });
});
