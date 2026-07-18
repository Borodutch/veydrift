import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const backendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(backendDirectory, "scripts/write-build-sha.sh");
const temporaryDirectories: string[] = [];

function createBuildContext(): string {
  const directory = mkdtempSync(join(tmpdir(), "veydrift-build-sha-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "apps/backend"), { recursive: true });
  return directory;
}

function cleanEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.GIT_SHA;
  return { ...environment, ...overrides };
}

function runArtifactWriter(directory: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync("sh", [scriptPath], {
    cwd: directory,
    encoding: "utf8",
    env: cleanEnvironment(environment)
  });
}

function expectArtifacts(directory: string, expectedSha: string): void {
  expect(readFileSync(join(directory, ".veydrift-backend-build-sha"), "utf8")).toBe(`${expectedSha}\n`);
  expect(readFileSync(join(directory, "apps/backend/.veydrift-backend-build-sha"), "utf8")).toBe(`${expectedSha}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("backend build SHA artifact writer", () => {
  test("is the artifact step used by the Nixpacks backend build", () => {
    const nixpacksConfig = readFileSync(join(backendDirectory, "nixpacks.test.toml"), "utf8");

    expect(nixpacksConfig).toContain("sh apps/backend/scripts/write-build-sha.sh && cd apps/backend");
    expect(nixpacksConfig).not.toContain("git rev-parse HEAD | tee");
  });

  test("uses Easypanel's provider GIT_SHA without local Git metadata", () => {
    const directory = createBuildContext();
    const providerSha = "0ab2d0e5afcef1facc28951533dfbf4eeb505611";

    const result = runArtifactWriter(directory, { GIT_SHA: providerSha });

    expect(result.status).toBe(0);
    expectArtifacts(directory, providerSha);
  });

  test("fails closed without a provider SHA or local Git metadata", () => {
    const directory = createBuildContext();

    const result = runArtifactWriter(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GIT_SHA is unset and local Git metadata is unavailable");
    expect(existsSync(join(directory, ".veydrift-backend-build-sha"))).toBe(false);
    expect(existsSync(join(directory, "apps/backend/.veydrift-backend-build-sha"))).toBe(false);
  });

  test("rejects an invalid provider SHA instead of falling back", () => {
    const directory = createBuildContext();

    const result = runArtifactWriter(directory, { GIT_SHA: "0ab2d0e5afce" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected a full 40-character hexadecimal commit SHA");
    expect(existsSync(join(directory, ".veydrift-backend-build-sha"))).toBe(false);
  });

  test("rejects extra content after an otherwise valid provider SHA", () => {
    const directory = createBuildContext();
    const providerSha = "0ab2d0e5afcef1facc28951533dfbf4eeb505611";

    const result = runArtifactWriter(directory, { GIT_SHA: `${providerSha}\nuntrusted` });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected a full 40-character hexadecimal commit SHA");
    expect(existsSync(join(directory, ".veydrift-backend-build-sha"))).toBe(false);
  });

  test("falls back to the local Git commit when GIT_SHA is absent", () => {
    const directory = createBuildContext();
    const sourceFile = join(directory, "apps/backend/source.txt");
    writeFileSync(sourceFile, "build source\n");

    expect(spawnSync("git", ["init", "--quiet"], { cwd: directory }).status).toBe(0);
    expect(spawnSync("git", ["add", sourceFile], { cwd: directory }).status).toBe(0);
    expect(spawnSync("git", ["-c", "user.name=Veydrift Test", "-c", "user.email=test@veydrift.invalid", "commit", "--quiet", "-m", "test source"], {
      cwd: directory
    }).status).toBe(0);
    const commitSha = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8"
    }).stdout.trim();

    const result = runArtifactWriter(directory);

    expect(result.status).toBe(0);
    expectArtifacts(directory, commitSha);
  });
});
