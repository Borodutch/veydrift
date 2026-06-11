import { installCrashDiagnostics } from "./crashDiagnostics";
import { createRequestHandler } from "./server";

// Install before binding the port so a startup-time unhandled rejection or signal is captured with a
// structured reason + memory snapshot (VEY-KANEO-459).
installCrashDiagnostics();

const port = Number.parseInt(process.env.PORT ?? "4000", 10);

Bun.serve({
  idleTimeout: Number.parseInt(process.env.VEYDRIFT_HTTP_IDLE_TIMEOUT_SECONDS ?? "30", 10),
  port,
  fetch: createRequestHandler()
});

console.log(`Veydrift backend listening on http://localhost:${port}`);
