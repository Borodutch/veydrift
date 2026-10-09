import { expect, test } from "bun:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { resourceViewResponse } from "./server";

for (const capable of [false, true]) for (const unavailable of [false, true]) {
  test(`gzip resource fence preserves wire bytes or rejects nullable stock: capable=${capable} unavailable=${unavailable}`, async () => {
    const payload = { planets: [{ resources: { metal: "1000000" }, resourcesAsOfNow: unavailable ? null : { metal: "1000000" } }] };
    const compressed = gzipSync(JSON.stringify(payload));
    const response = await resourceViewResponse(new Request("http://localhost/wallet/test/planets", {
      headers: capable ? { accept: "application/json; resource-view=nullable-v1" } : {},
    }), new Response(compressed, { headers: {
      "content-type": "application/json", "content-encoding": "gzip", "content-length": String(compressed.byteLength),
      "cache-control": "public, max-age=10", "vary": "Accept-Encoding", "etag": "fixture",
    } }));
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
    if (unavailable && !capable) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      for (const header of ["content-encoding", "content-length", "etag"]) expect(response.headers.get(header)).toBeNull();
      expect(await response.json()).toMatchObject({ error: "resource_view_upgrade_required" });
    } else {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-length")).toBe(String(compressed.byteLength));
      const body = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(body)).toEqual(Array.from(compressed));
      expect(JSON.parse(gunzipSync(body).toString("utf8"))).toEqual(payload);
    }
  });
}
