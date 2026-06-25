import { describe, expect, test } from "bun:test";

import { BASE_DOCUMENT_TITLE, resetDocumentTitle } from "./pageTitle";

describe("document title", () => {
  test("uses Veydrift as the base browser title", () => {
    expect(BASE_DOCUMENT_TITLE).toBe("Veydrift");
  });

  test("resets stale route-specific titles back to the base title", () => {
    const documentRef = { title: "Mission #609609" };

    resetDocumentTitle(documentRef);

    expect(documentRef.title).toBe("Veydrift");
  });

  test("is safe when no browser document is available", () => {
    expect(() => resetDocumentTitle(undefined)).not.toThrow();
  });
});
