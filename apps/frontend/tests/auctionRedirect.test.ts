import { expect, test } from "bun:test";
import { frontendResponse } from "../scripts/serve.mjs";
import { auctionUrl } from "../src/auction";

test("/cca and the retired /pact send visitors to the live auction on Uniswap", async () => {
  for (const path of ["/cca", "/cca/", "/pact", "/pact/"]) {
    const response = await frontendResponse(new Request(`https://veydrift.com${path}`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(auctionUrl);
  }
});
