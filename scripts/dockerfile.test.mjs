import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Guards the cache layout of the Tugport Dockerfile (docs/deployment.md#docker-builds).
const root = fileURLToPath(new URL("../", import.meta.url));
const dockerfile = readFileSync(`${root}Dockerfile`, "utf8");
const stages = Object.fromEntries(
  dockerfile.split(/^(?=FROM )/m).map((block) => [/^FROM \S+ AS (\S+)/.exec(block)?.[1], block]),
);

test("install copies the manifests of every workspace", () => {
  const { workspaces } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  const copy = /^COPY --parents (.+) \.\/$/m.exec(stages.install)?.[1].split(" ");
  assert.deepEqual(copy, ["package.json", "bun.lockb", ...workspaces.map((pattern) => `${pattern}/package.json`)]);
});

test("GIT_SHA is declared only in the backend stage, after its source", () => {
  assert.equal(dockerfile.match(/^ARG GIT_SHA$/gm)?.length, 1);
  const afterArg = stages.backend.split(/^ARG GIT_SHA$/m)[1];
  assert.ok(afterArg, "the backend stage does not declare GIT_SHA");
  assert.doesNotMatch(afterArg, /^(COPY|ADD) /m, "a COPY after ARG GIT_SHA reruns on every commit");
});

test("the frontend build declares every VITE_ variable the frontend reads", () => {
  const used = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        for (const [, name] of readFileSync(path, "utf8").matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) used.add(name);
      }
    }
  };
  walk(`${root}apps/frontend/src`);
  const declared = new Set([...stages["frontend-build"].matchAll(/^ARG (VITE_[A-Z0-9_]+)$/gm)].map((m) => m[1]));
  for (const name of used) assert.ok(declared.has(name), `${name} is not an ARG of frontend-build`);
});

test("sitemap.xml lists exactly the pages the image prerenders", () => {
  const routes = stages["frontend-prerender"].split("prerender.mjs dist")[1].split(/\s+/).filter((word) => word.startsWith("/"));
  const sitemap = readFileSync(`${root}apps/frontend/public/sitemap.xml`, "utf8");
  const locs = [...sitemap.matchAll(/<loc>https:\/\/veydrift\.com([^<]*)<\/loc>/g)].map((m) => m[1] || "/");
  assert.deepEqual(locs.sort(), routes.sort());
});
