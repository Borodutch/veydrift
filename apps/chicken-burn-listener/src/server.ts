import type { ChickenBurnProcessor } from "./processor";
import type { ChickenBurnSource } from "./source";
import type { JsonStateStore } from "./store";

export function createHandler(
  source: ChickenBurnSource,
  processor: ChickenBurnProcessor,
  store: JsonStateStore,
  startedAtMs: number
): (request: Request) => Response {
  return (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/") {
      return Response.json({
        ok: true,
        uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1_000),
        source: source.snapshot(),
        processor: processor.snapshot(),
        state: store.snapshot()
      });
    }
    return new Response("Not found", { status: 404 });
  };
}
