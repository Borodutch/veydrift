import { expect, spyOn, test } from "bun:test";
import { diagnosticRoute, observeFrontendRequest } from "./requestDiagnostics";

test("request diagnostics redact identities and log a stalled handler before it settles", async () => {
  expect(diagnosticRoute("https://api.test/wallet/0xsecret/shipyard?signature=private")).toBe("/wallet/:id/shipyard");
  expect(diagnosticRoute("/invite/private-code")).toBe("/:id/:id");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let finish!: (response: Response) => void;
  try {
    const pending = observeFrontendRequest(new Request("https://test/assets/private.webp?token=secret"),
      () => new Promise(resolve => { finish = resolve; }), 5);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ event: "frontend_request", route: "/assets/:id", outcome: "handler_pending" });
    finish(new Response("ok"));
    await pending;
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    await observeFrontendRequest(new Request("https://test/"), async () => new Response("missing", { status: 404 }), 5);
    expect(JSON.parse(warn.mock.calls[1]![0])).toMatchObject({ outcome: "response", status: 404 });
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(warn).toHaveBeenCalledTimes(2);
  } finally { warn.mockRestore(); }
});
