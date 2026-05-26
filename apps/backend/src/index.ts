import { createRequestHandler } from "./server";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);

Bun.serve({
  idleTimeout: Number.parseInt(process.env.VEYDRIFT_HTTP_IDLE_TIMEOUT_SECONDS ?? "30", 10),
  port,
  fetch: createRequestHandler()
});

console.log(`Veydrift backend listening on http://localhost:${port}`);
