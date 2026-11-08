// Run from apps/frontend: node --test tests/levelPopupLayout.browser.mjs
// Every structure's level popup at phone, landscape and desktop widths: no sideways scrolling, no
// clipped numbers, and equal-height rows. Long effect text may ellipsize only on phones under 390px.
// Optional LEVEL_POPUP_ARTIFACTS writes the measurements.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";
import { connect } from "./cdp.mjs";

// One width per layout: 320 (narrowest, ellipsis allowed), 390 (no ellipsis from here), 640 (sm), 1024 (lg;
// the panel caps at max-w-4xl, so wider viewports lay out the same). In-between widths repeated these.
const WIDTHS = [320, 390, 640, 1024];

test("level popups fit every structure at every width", { timeout: 180_000 }, async (t) => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered layout regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-level-popup-"));
  const server = await createServer({ cacheDir: `node_modules/.vite-browser/levelPopupLayout`,
    plugins: [{ name: "level-popup-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  let cdp;
  const artifacts = process.env.LEVEL_POPUP_ARTIFACTS;
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/levelPopupLayout.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    cdp = connect(t, chrome);
    const { send, evaluate, until } = cdp;
    await send("Browser.getVersion", {}, { page: false });
    await cdp.openPage();
    const settle = () => evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    const failures = [];
    for (const width of WIDTHS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      await send("Page.navigate", { url });
      await until("Boolean(window.levelPopup)");
      const cases = await evaluate("window.levelPopup.cases");
      for (let index = 0; index < cases.length; index++) {
        await evaluate(`window.levelPopup.show(${index})`);
        await settle();
        const measured = await evaluate(`(() => {
          const table = document.querySelector('[data-level-info-layer] [role=table]');
          const scroller = table.parentElement;
          const rows = Array.from(table.querySelectorAll('[role=row][data-level-status]'));
          const heights = rows.map(row => row.offsetHeight);
          // Chrome draws an ellipsis for any sub-pixel overflow, so compare the laid-out text width
          // (a Range) with the box instead of the rounded scrollWidth/clientWidth.
          const overflows = el => {
            const display = getComputedStyle(el).display;
            if (display === 'contents') return false;
            // A stat line holds boxes that truncate on their own: it only fails if those boxes spill out.
            if (el.dataset.levelFit === 'box') return el.scrollWidth > el.clientWidth;
            const range = document.createRange();
            range.selectNodeContents(el);
            return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.05;
          };
          const clipped = Array.from(table.querySelectorAll('[data-level-fit]')).filter(el => overflows(el) && !(el.dataset.levelFit === 'text' && innerWidth < 390));
          return { tableWidth: table.clientWidth, rows: rows.length, overflow: scroller.scrollWidth - scroller.clientWidth, minHeight: Math.min(...heights), maxHeight: Math.max(...heights),
            clipped: clipped.length, clippedSample: clipped.slice(0, 2).map(el => el.closest('[role=row]').querySelector('[role=rowheader]').textContent + ': ' + el.textContent) };
        })()`);
        const { body, key } = cases[index];
        assert.ok(measured.rows > 0, `${body} ${key} rendered no level rows`);
        measurements.push({ width, body, key, ...measured });
        const label = `${body} ${cases[index].label} @${width}`;
        if (measured.overflow > 1) failures.push(`${label} scrolls sideways by ${measured.overflow}px`);
        if (measured.clipped > 0) failures.push(`${label} clips ${measured.clipped} values, e.g. ${measured.clippedSample.join(" | ")}`);
        // Research requirement/effect text wraps by design; every structure row is one fixed height.
        if (body !== "research" && measured.maxHeight - measured.minHeight > 1) failures.push(`${label} rows range ${measured.minHeight}-${measured.maxHeight}px`);
      }
      console.log("PASS measured level popups", width);
    }
    if (artifacts) {
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, "level-popup-all-layout.json"), JSON.stringify(measurements, null, 2));
    }
    assert.deepEqual(failures, []);
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      // Its profile is a temp dir: nothing to save, so no graceful shutdown.
      chrome.kill("SIGKILL");
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
