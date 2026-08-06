import { describe, expect, test } from "bun:test";

const frontendRoot = new URL("..", import.meta.url).pathname;

describe("frontend backend-data boundary", () => {
  test("keeps raw HTTP reads out of UI components", async () => {
    const violations: string[] = [];
    const files = new Bun.Glob("src/**/*.tsx").scan({ cwd: frontendRoot });

    for await (const file of files) {
      const source = await Bun.file(`${frontendRoot}/${file}`).text();
      if (/\bfetch\s*\(/.test(source)) violations.push(file);
    }

    expect(violations).toEqual([]);
  });

  test("routes shared planet reads through the request-coalescing store", async () => {
    const appSource = await Bun.file(new URL("./PlayableMvpApp.tsx", import.meta.url)).text();
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();

    expect(appSource).toContain("backendDataStoreFor(apiBaseUrl)");
    expect(appSource).toContain("backendData!.infrastructure(account, activePlanetId)");
    expect(appSource).toContain("backendData!.queues(account, activePlanetId)");
    expect(storeSource).toContain("const running = this.inFlight.get(key)");
    expect(storeSource).toContain("if (running) return running as Promise<T>");
  });

  test("keeps consumer-visible state in explicit view projections", async () => {
    const storeSource = await Bun.file(new URL("./backendDataStore.ts", import.meta.url)).text();
    const planetStoreSource = await Bun.file(new URL("./planetSectionStore.ts", import.meta.url)).text();
    const guide = await Bun.file(new URL("../../../docs/frontend-data-store.md", import.meta.url)).text();

    expect(storeSource).toContain("private readonly inFlight");
    expect(storeSource).not.toContain("private readonly entries");
    expect(storeSource).not.toContain("subscribe(listener");
    expect(planetStoreSource).toContain("export type PlanetSectionRefreshStatus");
    expect(planetStoreSource).toContain("export function setPlanetSectionData");
    expect(guide).toContain("a request coordinator, not a second UI state store");
  });
});
