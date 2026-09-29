// Run from apps/frontend: node --test tests/batchSupply.browser.mjs
// Optional BATCH_SUPPLY_ARTIFACTS writes screenshots and layout evidence. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

test("Supply ship eligibility persists through mounted draft interactions at desktop/mobile sizes", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.BATCH_SUPPLY_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/batchSupply.html`;
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
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const types = ['Large Cargo', 'Small Cargo', 'Recycler', 'Colony Ship'];
    const defaults = [true, true, false, true];
    const checkbox = index => 'document.querySelectorAll("fieldset input")[ ' + index + ' ]';
    const launch = 'document.querySelector("footer button")';
    const source = `document.querySelector('[aria-label="Source planets"] input[type="checkbox"]')`;
    async function load(width, query = '') {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
      await send('Page.navigate', { url: url + '?' + query });
      const deadline = Date.now() + 20_000;
      while (!(await evaluate('Boolean(window.supplyFixture && document.querySelector("fieldset"))'))) {
        assert.ok(Date.now() < deadline, 'fixture did not render');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Source autoselection is a mounted useEffect, not a synchronous initial render.
      while (!(await evaluate(source + '.checked'))) {
        assert.ok(Date.now() < deadline, 'source selection effect did not run');
        await settle();
      }
      await evaluate('document.fonts.ready');
      await settle();
    }
    async function point(expression) {
      return evaluate('(() => { const node = ' + expression + '; node.scrollIntoView({block:"nearest", inline:"nearest"}); const r = node.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2; return {x, y, reachable: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && (document.elementFromPoint(x,y) === node || node.contains(document.elementFromPoint(x,y)))}; })()');
    }
    async function click(expression) {
      const { x, y, reachable } = await point(expression);
      assert.ok(reachable, 'reachable pointer target: ' + expression);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await settle();
    }
    const selected = () => evaluate('[...document.querySelectorAll("fieldset input")].map(input => input.checked)');
    async function expectTypes(expected, reason) { assert.deepEqual(await selected(), expected, reason); }
    async function input(label, value) {
      const expression = 'document.querySelector(' + JSON.stringify('input[aria-label="' + label + '"]') + ')';
      await click(expression);
      await evaluate(expression + '.select()');
      await send('Input.insertText', { text: String(value) });
      await settle();
    }
    async function submit() {
      assert.equal(await evaluate(launch + '.disabled'), false, 'valid plan can launch');
      const before = await evaluate('supplyFixture.submissions.length');
      await click(launch);
      assert.equal(await evaluate('supplyFixture.submissions.length'), before + 1);
      return evaluate('supplyFixture.submissions.at(-1)');
    }
    async function record(label) {
      const result = await evaluate('(() => { const panel = document.querySelector("[role=dialog]").firstElementChild; return {viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, labels: [...document.querySelectorAll("fieldset label")].map(node => node.textContent.trim())}; })()');
      assert.deepEqual(result.labels, types, label + ': all type controls rendered');
      assert.ok(result.pageWidth <= result.viewport, label + ': page horizontal overflow');
      assert.ok(result.panelScrollWidth <= result.panelWidth, label + ': modal horizontal overflow');
      for (let i = 0; i < types.length; i++) assert.ok((await point(checkbox(i))).reachable, label + ': reachable ' + types[i]);
      assert.ok((await point(launch)).reachable, label + ': launch reachable');
      assert.ok((await point(source)).reachable, label + ': source reachable');
      measurements.push({ label, ...result });
      if (artifacts) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, label + '.png'), Buffer.from(screenshot.data, 'base64'));
      }
    }
    for (const width of [1280, 390, 320]) {
      await load(width);
      assert.equal(await evaluate('document.querySelector("legend").textContent'), 'Ship types for all sources');
      await expectTypes(defaults, 'Recycler defaults off');
      let submission = await submit();
      assert.deepEqual(submission.allowedShipTypes, ['largeCargo', 'smallCargo', 'colonyShip']);
      assert.equal(submission.orders[0].ships.recycler, 0);
      await record(width + '-default');

      // Explicit opt-in must survive even if the current small order does not need a Recycler.
      await click(checkbox(2));
      submission = await submit();
      assert.ok(submission.allowedShipTypes.includes('recycler'));
      assert.equal(submission.orders[0].ships.recycler, 0, 'opt-in differs from currently planned fleet');
      await evaluate('supplyFixture.refresh()'); await settle();
      await expectTypes([true, true, true, true], 'refresh preserves explicit opt-in');
      await click(`document.querySelector('input[aria-label="metal to send"]').closest("label").querySelector("button")`);
      const maximumWithRecycler = Number(await evaluate(`document.querySelector('input[aria-label="metal to send"]').value`));
      submission = await submit();
      assert.ok(submission.orders[0].ships.recycler > 0, 'Max uses enabled Recycler capacity');
      await click(checkbox(2));
      await click(`document.querySelector('input[aria-label="metal to send"]').closest("label").querySelector("button")`);
      const maximumWithoutRecycler = Number(await evaluate(`document.querySelector('input[aria-label="metal to send"]').value`));
      assert.ok(maximumWithoutRecycler < maximumWithRecycler, 'Max excludes disabled Recycler capacity');
      await expectTypes(defaults, 'Max does not reset eligibility');
      submission = await submit();
      assert.equal(submission.orders[0].ships.recycler, 0, 'disabled type cannot be submitted');
      await click(checkbox(2));
      await input('metal to send', 1000);
      await input('Astro metal to send', 1000);
      await expectTypes([true, true, true, true], 'resource and per-source edits preserve opt-in');
      await click(source);
      assert.equal(await evaluate(source + '.checked'), false);
      await click(source);
      await expectTypes([true, true, true, true], 'source deselect/reselect preserves choices');

      // Opt out of every type: the UI stays operable, but no transport can launch.
      for (let i = 0; i < types.length; i++) await click(checkbox(i));
      await expectTypes([false, false, false, false], 'no types remains explicit');
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("No ships of the selected types")'));
      await evaluate('supplyFixture.refresh()'); await settle();
      await expectTypes([false, false, false, false], 'refresh must not restore defaults');
      await record(width + '-no-types');
      await click(checkbox(2));
      submission = await submit();
      assert.deepEqual(submission.allowedShipTypes, ['recycler']);
      assert.ok(submission.orders[0].ships.recycler > 0);
      for (const key of ['largeCargo', 'smallCargo', 'colonyShip']) assert.equal(submission.orders[0].ships[key], 0);

      for (const kind of ['action', 'transaction']) {
        await evaluate('supplyFixture.pending(' + JSON.stringify(kind) + ')'); await settle();
        assert.equal(await evaluate('[...document.querySelectorAll("fieldset input")].every(input => input.matches(":disabled"))'), true);
        assert.equal(await evaluate(launch + '.disabled'), true);
        await click(checkbox(2));
        await expectTypes([false, false, true, false], kind + ' pending prevents changes');
      }
      await evaluate('supplyFixture.reject()'); await settle();
      assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Wallet request rejected")'));
      await expectTypes([false, false, true, false], 'wallet rejection retains intent');
      assert.equal(await evaluate('document.querySelector("fieldset input").matches(":disabled")'), false);
      submission = await submit();
      assert.deepEqual(submission.allowedShipTypes, ['recycler'], 'retry carries retained choices');
      await record(width + '-rejected');

      for (const kind of ['draft', 'target', 'account']) {
        await evaluate('supplyFixture.reset(' + JSON.stringify(kind) + ')');
        await settle();
        await expectTypes(defaults, kind + ' starts fresh defaults');
        await click(checkbox(2));
        await click(checkbox(0));
        await expectTypes([false, true, true, true], 'new draft remains editable');
      }

      // A source with only Recyclers cannot supply by default, but opt-in unblocks it.
      await load(width, 'recyclerOnly=1');
      await expectTypes(defaults, 'Recycler-only source still defaults off');
      assert.equal(await evaluate(launch + '.disabled'), true);
      await click(checkbox(2));
      submission = await submit();
      assert.ok(submission.orders[0].ships.recycler > 0);
      await click(checkbox(2));
      assert.equal(await evaluate(launch + '.disabled'), true, 'opt-out removes Recycler-only plan');
      await click(checkbox(2));
      await submit();
      await record(width + '-recycler-only');
      console.log('PASS mounted Supply at ' + width + 'px: defaults, explicit intent, refresh, Max, edits, source toggle, empty selection, pending, rejection, resets, Recycler-only source');
    }
    if (artifacts) writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
    await send('Browser.close', {}, false);
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
