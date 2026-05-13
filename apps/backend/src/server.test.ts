import { describe, expect, test } from "bun:test";
import { createRequestHandler } from "./server";

const handler = createRequestHandler();

describe("Veydrift backend", () => {
  test("returns health status", async () => {
    const response = await handler(new Request("http://localhost/health"));

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "veydrift-backend"
    });
    expect(response.status).toBe(200);
  });

  test("returns a minimal GraphQL response", async () => {
    const response = await handler(
      new Request("http://localhost/graphql", {
        body: JSON.stringify({
          query: "{ service { name status } }"
        }),
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({
      data: {
        service: {
          name: "Veydrift",
          status: "coming-soon"
        }
      }
    });
    expect(response.status).toBe(200);
  });
});
