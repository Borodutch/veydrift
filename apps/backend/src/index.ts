import { createRequestHandler } from "./server";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);

Bun.serve({
  port,
  fetch: createRequestHandler()
});

console.log(`Veydrift backend listening on http://localhost:${port}`);
