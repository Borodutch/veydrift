import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guards the cache layout of the shared nixpacks.toml (docs/deployment.md#nixpacks-build-caching).
const root = fileURLToPath(new URL("../", import.meta.url));
const config = readFileSync(`${root}nixpacks.toml`, "utf8");

function section(name) {
  const start = config.indexOf(`[${name}]`);
  assert.notEqual(start, -1, `nixpacks.toml has no [${name}] section`);
  const rest = config.slice(start + name.length + 2);
  const end = rest.search(/^\[/m);
  return end === -1 ? rest : rest.slice(0, end);
}

function stringArray(text, key) {
  const match = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*$`, "m").exec(text);
  assert.ok(match, `missing ${key}`);
  return [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

function workspaceManifests() {
  const { workspaces } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  return workspaces.flatMap((pattern) => {
    assert.match(pattern, /^[a-z-]+\/\*$/, `unsupported workspace pattern ${pattern}`);
    const dir = pattern.slice(0, -2);
    return readdirSync(`${root}${dir}`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(`${root}${dir}/${entry.name}/package.json`))
      .map((entry) => `${dir}/${entry.name}/package.json`);
  }).sort();
}

test("install copies exactly the root manifests and every workspace package.json", () => {
  const files = stringArray(section("phases.install"), "onlyIncludeFiles");
  assert.deepEqual(files.slice(0, 2), ["package.json", "bun.lockb"]);
  assert.deepEqual(files.slice(2).sort(), workspaceManifests());
});

test("install is a single frozen bun install with dev dependencies", () => {
  const cmds = stringArray(section("phases.install"), "cmds");
  assert.deepEqual(cmds, ["NODE_ENV=development bun install --frozen-lockfile"]);
});

test("no phase installs apt packages", () => {
  // apt in setup runs before the build-arg line but plain HTTP mirrors time out on the
  // Easypanel host (#1445); apt in a later phase reruns on every deploy (#102).
  assert.doesNotMatch(config, /aptPkgs|apt-get/);
});

test("fonts come from the cached Nix setup and fontconfig is pointed at them at login", () => {
  const pkgs = stringArray(section("phases.setup"), "nixPkgs");
  assert.ok(pkgs.includes("dejavu_fonts"));
  assert.ok(pkgs.includes("fontconfig"));
  const profile = pkgs.find((pkg) => pkg.startsWith("(writeTextDir \"etc/profile.d/"));
  assert.ok(profile, "missing the runtime profile script");
  assert.match(profile, /FONTCONFIG_FILE=\$\{makeFontsConf \{ fontDirectories = \[ dejavu_fonts \]; \}\}/);
  assert.match(profile, /NIXPACKS_PATH=\/app\/node_modules\/\.bin/);
});

test("start runs in a separate image that copies stable layers before the source", () => {
  const start = section("start");
  assert.match(start, /^runImage = "ghcr\.io\/railwayapp\/nixpacks:ubuntu-1741046653"$/m);
  assert.deepEqual(stringArray(start, "onlyIncludeFiles"), [
    "/nix",
    "/root/.profile",
    "node_modules",
    "package.json",
    "tsconfig.base.json",
    "packages",
    "apps",
  ]);
});
