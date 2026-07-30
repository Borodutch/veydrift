import { describe, expect, test } from "bun:test";
import { InspectPageHeader } from "./components/InspectProgressLayout";
import { MoonPage } from "./components/MoonPage";

describe("title-free page headers", () => {
  test("omits inspect progress headers when there are no page actions", () => {
    const header = InspectPageHeader({ title: "Research" });

    expect(header).toBeNull();
  });

  test("omits the moon screen header", () => {
    const page = MoonPage({ loading: false });
    expect(visibleText(page)).not.toContain("Moon Operations");
  });
});

function visibleText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (typeof node !== "object" || !("props" in node)) return "";
  return visibleText((node as { props?: { children?: unknown } }).props?.children);
}
