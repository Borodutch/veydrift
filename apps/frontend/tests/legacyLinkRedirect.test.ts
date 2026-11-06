import { expect, test } from "bun:test";
import { frontendResponse } from "../scripts/serve.mjs";
import { veydriftSwapUrl } from "../src/swap";

test("the shared /cca and /pact links send visitors to the $VEYDRIFT swap on Uniswap", async () => {
  for (const path of ["/cca", "/cca/", "/pact", "/pact/"]) {
    const response = await frontendResponse(new Request(`https://veydrift.com${path}`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(veydriftSwapUrl);
  }
});
