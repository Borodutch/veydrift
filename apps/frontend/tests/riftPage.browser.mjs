// Run from apps/frontend: node --test tests/riftPage.browser.mjs
// The Rift page at phone widths, with and without a Rift Stabilizer: nothing may be wider than the
// viewport, or mobile browsers lay the page out wider and zoom the whole thing out.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";
import { connect } from "./cdp.mjs";

const WIDTHS = [360, 390];
// The skeleton shows first on every visit: if it is too wide, the page zooms out and stays zoomed out.
const STATES = ["loading", "locked", "unlocked"];

test("the Rift page fits phone widths while loading, and with and without a Rift Stabilizer", { timeout: 180_000 }, async (t) => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered layout regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-rift-page-"));
  const server = await createServer({ cacheDir: `node_modules/.vite-browser/riftPage`,
    plugins: [{ name: "rift-page-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  let cdp;
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/riftPage.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    cdp = connect(t, chrome);
    const { send, evaluate, until } = cdp;
    await send("Browser.getVersion", {}, { page: false });
    await cdp.openPage();
    const failures = [];
    for (const width of WIDTHS) {
      // A real phone: mobile layout, so an over-wide element widens the layout viewport (and zooms out).
      await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 3, mobile: true });
      for (const state of STATES) {
        await send("Page.navigate", { url: `${base}?state=${state}` });
        await until(`Boolean(document.querySelector(${JSON.stringify({ loading: "[aria-label='Loading Rift state'], [aria-busy=true]", locked: "#rift-locked-title", unlocked: "#rift-title" }[state])}))`);
        // Both workbench directions lay out differently, so measure each one.
        for (const mode of state === "unlocked" ? ["extract", "inject"] : [state]) {
          if (mode === "inject") await evaluate(`[...document.querySelectorAll('[aria-label="Rift direction"] button')].find(button => button.textContent.includes('Inject')).click()`);
          await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
          const measured = await evaluate(`(() => {
            const viewport = document.documentElement.clientWidth;
            const wide = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > viewport + 1)
              .slice(0, 3).map(el => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 4).join('.') + ' right=' + Math.round(el.getBoundingClientRect().right));
            return { viewport, innerWidth, scrollWidth: document.documentElement.scrollWidth, wide };
          })()`);
          const label = `${mode} @${width}px`;
          if (measured.innerWidth !== width) failures.push(`${label}: layout viewport is ${measured.innerWidth}px, so the page is zoomed out (${measured.wide.join(" | ")})`);
          if (measured.scrollWidth !== measured.viewport) failures.push(`${label}: scrollWidth ${measured.scrollWidth}px exceeds ${measured.viewport}px (${measured.wide.join(" | ")})`);
          if (measured.wide.length) failures.push(`${label}: wider than the viewport: ${measured.wide.join(" | ")}`);
        }
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill("SIGKILL");
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
