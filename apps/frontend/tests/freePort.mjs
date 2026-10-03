import { createServer } from "node:net";

// Vite treats `port: 0` as "use the default (5173 dev / 4173 preview) and count up on
// EADDRINUSE", so test suites running concurrently on one machine raced for the same ports
// and could hang in Vite's listen(). Ask the OS for a free port and pass it with strictPort.
export async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
