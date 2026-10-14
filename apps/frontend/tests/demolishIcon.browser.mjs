// Run from apps/frontend: node --test tests/demolishIcon.browser.mjs
// Optional DEMOLISH_ICON_ARTIFACTS writes screenshots. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

const views = {
  planet: { label: "Metal Mine", upgrade: 'button[aria-label="Upgrade Metal Mine to Level 7"]' },
  moon: { label: "Robotics Factory", upgrade: 'button[aria-label="Upgrade Robotics Factory to Level 4"]' },
};

test("Demolish is an icon-only button inline with Upgrade on planet and moon buildings, hidden while unavailable (#120, #125)", { timeout: 180_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered demolish layout regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-demolish-icon-"));
  const server = await createServer({
    // These fixtures render building detail panels, not animated planets.
    plugins: [{ name: "demolish-icon-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) animations.configureServer = undefined;
    } }], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.DEMOLISH_ICON_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/demolishIcon.html`;
    chrome = spawn(executable, ["--headless=new", "--use-mock-keychain", "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });
    let id = 0, buffered = "", sessionId;
    function send(method, params = {}, page = true) {
      const commandId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(method + " timed out")); }, 15_000);
        pending.set(commandId, { resolve, reject, timer });
        chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
      });
    }
    chrome.stdio[4].on("data", chunk => {
      buffered += chunk.toString();
      let end;
      while ((end = buffered.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        const command = pending.get(message.id);
        if (!command) continue;
        pending.delete(message.id); clearTimeout(command.timer);
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      }
    });
    await send("Browser.getVersion", {}, false);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, false);
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, false));
    await send("Page.enable");
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const rect = selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; })()`);
    // Real pointer input: a mouse click on desktop, a touch tap on mobile.
    async function tap(selector, mobile) {
      const box = await rect(selector);
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (mobile) {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      }
      await settle();
    }
    for (const width of [1280, 390]) {
      const mobile = width < 640;
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
      for (const [view, { label, upgrade }] of Object.entries(views)) {
        const demolish = `button[aria-label="Demolish ${label}"]`;
        // Demolish renders only while it is available (#125): no greyed-out icon
        // for a resource shortfall or a busy building queue.
        for (const state of ["ready", "blocked", "upgrading"]) {
          const available = state === "ready";
          await send("Page.navigate", { url: `${url}?view=${view}&state=${state}` });
          const deadline = Date.now() + 20_000;
          // Moon detail opens on the Lunar Base; pick the demolishable structure like a player would.
          const tile = `Array.from(document.querySelectorAll("button[aria-pressed]")).find(b => b.textContent.includes(${JSON.stringify(label)}))`;
          while (view === "moon" && !(await evaluate(`Boolean(${tile})`))) {
            assert.ok(Date.now() < deadline, `moon catalog did not render: ${state} ${width}`);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (view === "moon") await evaluate(`${tile}.click()`);
          while (!(await evaluate(`Boolean(window.demolishFixture && document.querySelector(${JSON.stringify(upgrade)}))`))) {
            assert.ok(Date.now() < deadline, `demolish fixture did not render: ${view} ${state} ${width}\n` + await evaluate("document.body.textContent.slice(0, 800)"));
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          await evaluate(`document.querySelector(${JSON.stringify(upgrade)}).scrollIntoView({ block: "center" })`);
          await settle();
          const where = `${view} ${state} ${width}`;

          // At most one Demolish control, and none at all while demolition is unavailable.
          assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).filter(b => (b.getAttribute('aria-label') || '').startsWith('Demolish')).length"), available ? 1 : 0, where);
          // The #112 reason row is gone with the disabled icon.
          assert.equal(await evaluate("/Building queue busy|Not enough /.test(Array.from(document.querySelectorAll('[role=\"status\"]')).map(n => n.textContent).join(' '))"), false, `${where}: stale demolish reason row`);

          // One row of Upgrade [+ Supply] [+ Demolish], the destructive icon last; the
          // row's last control ends flush with the row whether or not the icon is there.
          const up = await rect(upgrade);
          const rowParent = `document.querySelector(${JSON.stringify(upgrade)}).parentElement`;
          const row = await evaluate(`Array.from(${rowParent}.children).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute("aria-label"), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })`);
          const upgradeLabel = await evaluate(`document.querySelector(${JSON.stringify(upgrade)}).getAttribute("aria-label")`);
          const expectedRow = [upgradeLabel, ...(view === "planet" && state === "blocked" ? ["Supply missing resources for Metal Mine"] : []), ...(available ? [`Demolish ${label}`] : [])];
          assert.deepEqual(row.map(b => b.label), expectedRow, where);
          for (const [index, button] of row.entries()) {
            assert.ok(Math.abs(button.top - up.top) < 1 && Math.abs(button.bottom - up.bottom) < 1, `${where}: ${button.label} not on the Upgrade row ${JSON.stringify(row)}`);
            if (index > 0) assert.ok(button.left >= row[index - 1].right && button.left - row[index - 1].right <= 12, `${where}: gap before ${button.label} ${JSON.stringify(row)}`);
          }
          const rowRight = await evaluate(`${rowParent}.getBoundingClientRect().right`);
          assert.ok(Math.abs(row.at(-1).right - rowRight) < 1, `${where}: row leaves a gap where the icon was ${JSON.stringify(row)} ${rowRight}`);
          assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, where);
          if (artifacts) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(artifacts, `demolish-${view}-${state}-${width}.png`), Buffer.from(shot.data, "base64")); }

          if (available) {
            const icon = await rect(demolish);
            // An icon (svg) with no visible text, labelled and titled.
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).textContent.trim()`), "", where);
            assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(demolish)} + " svg"))`), true, where);
            assert.ok(icon.right <= await evaluate("innerWidth"), `${where}: icon overflows`);
            assert.ok(icon.width >= 40 && icon.height >= 40, `${where}: tap target ${icon.width}x${icon.height}`);
            assert.ok(icon.width < up.width / 2, `${where}: icon should stay small next to Upgrade`);
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).title`), "Demolish", where);
            assert.equal(await evaluate(`document.querySelector(${JSON.stringify(demolish)}).getAttribute("aria-disabled")`), null, where);
            await tap(demolish, mobile);
            // The #112 confirmation dialog opens; nothing is sent until it is confirmed.
            assert.equal(await evaluate("document.querySelector('#demolition-title') !== null"), true, `${where}: demolition dialog did not open`);
            assert.equal(await evaluate("window.demolishFixture.calls.demolish"), 0, where);
            if (artifacts) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(artifacts, `demolish-${view}-dialog-${width}.png`), Buffer.from(shot.data, "base64")); }
          }
          console.log("PASS demolish icon", where);
        }

        // A running demolition shows on the card, the detail and the queue panel
        // from one progress source; the Upgrade + Demolish row gives way to it.
        for (const state of ["demolishing", "finished"]) {
          const where = `${view} ${state} ${width}`;
          await send("Page.navigate", { url: `${url}?view=${view}&state=${state}` });
          const deadline = Date.now() + 20_000;
          const tile = `Array.from(document.querySelectorAll("button[aria-pressed]")).find(b => b.textContent.includes(${JSON.stringify(label)}))`;
          while (!(await evaluate(`Boolean(window.demolishFixture && ${tile})`))) {
            assert.ok(Date.now() < deadline, `demolition fixture did not render: ${where}`);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          await evaluate(`${tile}.click()`);
          await settle();
          const detailUpgrade = `Boolean(document.querySelector('button[aria-label^="Upgrade ${label}"]'))`;
          if (state === "finished") {
            // Once the backend reports it complete the stale Demolishing state is gone everywhere.
            assert.equal(await evaluate("document.body.textContent.match(/.{0,80}Demolishing.{0,40}/)?.[0] ?? null"), null, where);
            assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(demolish)}))`), true, where);
            assert.equal(await evaluate(detailUpgrade), true, where);
            console.log("PASS demolition progress", where);
            continue;
          }
          const levels = view === "planet" ? "6 → 5" : "3 → 2";
          const bars = await evaluate(`Array.from(document.querySelectorAll('[role="progressbar"]')).filter(b => b.getAttribute("aria-label") === ${JSON.stringify(`Demolishing ${label} ${levels} progress`)}).map(b => ({ inTile: ${tile}.contains(b), value: b.getAttribute("aria-valuenow") }))`);
          // One bar on the card and one in the detail, both at the shared 1/3 projection.
          assert.deepEqual(bars, [{ inTile: true, value: "33" }, { inTile: false, value: "33" }], `${where}: ${JSON.stringify(bars)}`);
          assert.match(await evaluate(`${tile}.textContent`), new RegExp(`Demolishing ${levels}.*2m`), where);
          assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(demolish)}))`), false, `${where}: Demolish icon should give way to the running demolition`);
          assert.equal(await evaluate(detailUpgrade), false, `${where}: Upgrade should give way to the running demolition`);
          const cancels = await evaluate("Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Cancel' && !b.disabled).length");
          assert.equal(cancels, 2, `${where}: Cancel in the queue panel and the detail`);
          assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, where);
          if (artifacts) {
            await evaluate(`${tile}.scrollIntoView({ block: "center" })`);
            await settle();
            const shot = await send("Page.captureScreenshot", { format: "png" });
            writeFileSync(join(artifacts, `demolish-${view}-running-${width}.png`), Buffer.from(shot.data, "base64"));
          }
          console.log("PASS demolition progress", where);
        }
      }
    }
    await send("Browser.close", {}, false);
  } finally {
    for (const command of pending.values()) clearTimeout(command.timer);
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
