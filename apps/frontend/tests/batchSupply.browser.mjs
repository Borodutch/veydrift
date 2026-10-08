// Run from apps/frontend: node --test tests/batchSupply.browser.mjs
// Optional BATCH_SUPPLY_ARTIFACTS writes screenshots and layout evidence. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Supply ship eligibility persists through mounted draft interactions at desktop/mobile sizes", { timeout: 240_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const server = await createServer({
    // This fixture renders cargo controls, not planet animations. Avoid a full cold
    // animation encode before Chrome starts (production builds still verify it).
    plugins: [{ name: "supply-fixture-no-animation-precompute", configResolved(config) {
      const animations = config.plugins.find(plugin => plugin.name === "veydrift-planet-animations");
      if (animations) { animations.buildStart = undefined; animations.configureServer = undefined; }
    } }],
    logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
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
        if (message.method === "Runtime.exceptionThrown") console.error("Browser exception", JSON.stringify(message.params));
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
    await send("Runtime.enable");
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    let touch = false;
    const types = ['Large Cargo', 'Small Cargo', 'Recycler', 'Colony Ship'];
    const defaults = [true, true, false, true];
    const checkbox = index => 'document.querySelector(' + JSON.stringify('button[aria-label="' + types[index] + ' at Astro"]') + ')';
    const launch = 'document.querySelector("footer button")';
    const source = `document.querySelector('[aria-label="Source planets"] input[type="checkbox"]')`;
    async function load(width, query = '', height = 900) {
      touch = width < 640;
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
      await send('Emulation.setTouchEmulationEnabled', { enabled: touch });
      await send('Page.navigate', { url: url + '?' + query });
      const deadline = Date.now() + 20_000;
      while (!(await evaluate('Boolean(window.supplyFixture && document.querySelector("[role=dialog]"))'))) {
        assert.ok(Date.now() < deadline, 'fixture did not render');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // Source autoselection is a mounted useEffect, not a synchronous initial render.
      const autoSource = query.includes('denver') ? `document.querySelectorAll('[aria-label="Source planets"] input[type="checkbox"]')[2]` : query.includes('combatOnlyFirst') ? `document.querySelectorAll('[aria-label="Source planets"] input[type="checkbox"]')[1]` : source;
      while (!query.includes('emptyFleet') && !query.includes('recyclerOnly') && !(await evaluate(autoSource + '.checked'))) {
        assert.ok(Date.now() < deadline, 'source selection effect did not run');
        await settle();
      }
      await evaluate('document.querySelector("[data-supply-details]")?.setAttribute("open", ""); document.querySelector("[data-supply-amounts]")?.setAttribute("open", "")');
      await evaluate('document.fonts.ready');
      await evaluate('Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))');
      await settle();
    }
    async function point(expression) {
      await evaluate('(() => { const node = ' + expression + '; const scroll = node.closest("[data-supply-scroll]"); if (scroll) { const r=node.getBoundingClientRect(), box=scroll.getBoundingClientRect(); scroll.scrollTop += r.y + r.height/2 - box.y - box.height/2; } })()'); await settle();
      return evaluate('(() => { const node = ' + expression + '; const r = node.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2; return {x, y, reachable: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && (document.elementFromPoint(x,y) === node || node.contains(document.elementFromPoint(x,y)))}; })()');
    }
    async function click(expression) {
      let { x, y, reachable } = await point(expression);
      // Wait for native scroll/layout settling before hit-testing a trusted tap.
      if (touch) { await new Promise(resolve => setTimeout(resolve, 100)); ({ x, y, reachable } = await point(expression)); }
      assert.ok(reachable, 'reachable pointer target: ' + expression);
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await new Promise(resolve => setTimeout(resolve, 50));
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
      await settle();
      // Chromium dispatches the compatibility click after touchend; wait for it before scrolling to another target.
      if (touch) await new Promise(resolve => setTimeout(resolve, 350));
      // Max is deliberately asynchronous; normal interaction checks await its result.
      if (expression.includes("closest")) {
        const deadline = Date.now() + 20_000;
        while (await evaluate('Boolean(document.querySelector("button[aria-busy=true]"))')) {
          assert.ok(Date.now() < deadline, "Max did not finish");
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await settle();
      }
    }
    const selected = () => evaluate('[...document.querySelectorAll("[role=group] button[aria-describedby]")].filter(input => input.getAttribute("aria-label").endsWith(" at Astro")).map(input => input.getAttribute("aria-pressed") === "true")');
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
      const result = await evaluate(`(() => {
        const panel = document.querySelector("[role=dialog]").firstElementChild;
        const overflowing = [...panel.querySelectorAll("*")].filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth).map(node => ({
          tag: node.tagName, text: node.textContent.trim().slice(0, 100), className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth,
        }));
        return {viewport: innerWidth, viewportHeight: innerHeight, pageWidth: document.documentElement.scrollWidth, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, overflowing, labels: [...document.querySelectorAll("[role=group] button[aria-describedby]")].map(node => node.getAttribute("aria-label").split(" at ")[0])};
      })()`);
      assert.deepEqual(result.labels, label.includes('recycler-only') ? ['Recycler'] : types, label + ': available type controls rendered');
      assert.ok(result.pageWidth <= result.viewport, label + ': page horizontal overflow');
      assert.ok(result.panelScrollWidth <= result.panelWidth, label + ': modal horizontal overflow: ' + JSON.stringify(result));
      for (const name of result.labels) assert.ok((await point(checkbox(types.indexOf(name)))).reachable, label + ": reachable " + name);
      assert.ok((await point(launch)).reachable, label + ': launch reachable');
      assert.ok((await point(source)).reachable, label + ': source reachable');
      measurements.push({ label, ...result });
      if (artifacts) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, label + '.png'), Buffer.from(screenshot.data, 'base64'));
      }
    }
    // Reporter-equivalent read-only fixture; production modal, never a real wallet.
    for (const width of [1280, 390, 320]) {
      await load(width, 'denver=1', 568);
      await evaluate('document.querySelector("[data-supply-details]").removeAttribute("open"); document.querySelector("[data-supply-amounts]").removeAttribute("open")'); await settle();
      assert.equal(await evaluate('document.querySelector("[data-supply-details]").open'), false);
      if (artifacts) { const shot = await send('Page.captureScreenshot', {format:'png'}); writeFileSync(join(artifacts, 'denver-auto-' + width + '.png'), Buffer.from(shot.data, 'base64')); }
      const first = await submit();
      assert.equal(first.orders.length, 1);
      assert.equal(first.orders[0].originPlanetId, '1');
      assert.deepEqual(first.orders[0].cargo, {metal:12300, crystal:3340, deuterium:6400});
      assert.equal(first.orders[0].ships.largeCargo, 1);
      assert.equal(first.orders[0].fuelCost, 7);
      await evaluate('supplyFixture.accrueStock()'); await settle();
      assert.equal(await evaluate(launch + '.disabled'), false, 'production refresh does not flicker Launch');
      assert.deepEqual((await submit()).orders, first.orders, 'production never increases reviewed shipment');
      await evaluate('supplyFixture.harmlessStock()'); await settle();
      assert.equal(await evaluate(launch + '.disabled'), false, 'unselected locks, unselected ships and irrelevant stock decreases preserve feasibility');
      assert.equal(await evaluate(`document.querySelector('input[aria-label="metal to send"]').closest("label").querySelector("button").disabled`), false, 'irrelevant changes do not disable Max');
      assert.deepEqual((await submit()).orders, first.orders, 'unrelated changes retain exact reviewed shipment');
      const footer = await evaluate('(() => { const r = document.querySelector("footer").getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; })()');
      assert.ok(footer.top >= 0 && footer.bottom <= 568, 'persistent footer fits short viewport');
      await evaluate('document.querySelector("[data-supply-details]").setAttribute("open", "")'); await settle();
      await click('document.querySelector(' + JSON.stringify('button[aria-label="Use only New Zion"]') + ')');
      assert.deepEqual((await submit()).orders, first.orders, 'one-click source comparison preserves exact complete loadout');
      await input('New Zion metal to send', 12500);
      await evaluate('supplyFixture.changeStock()'); await settle();
      assert.equal(await evaluate('document.querySelector(' + JSON.stringify('input[aria-label="New Zion metal to send"]') + ').value'), '12500', 'refresh keeps exact manual input');
      assert.equal(await evaluate(launch + '.disabled'), true, 'changed stock requires explicit review');
      await click('[...document.querySelectorAll("button")].find(b => b.textContent === "Review latest inventory")');
      assert.equal(await evaluate('document.querySelector(' + JSON.stringify('input[aria-label="New Zion metal to send"]') + ').value'), '12500', 'review does not erase oversized manual input');
      assert.equal(await evaluate(launch + '.disabled'), true, 'exact remaining shortfall blocks incomplete plan');
      assert.ok(await evaluate('document.querySelector("section[aria-label$=totals]").textContent.includes("Remaining")'));
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      if (artifacts) { const shot = await send('Page.captureScreenshot', {format:'png'}); writeFileSync(join(artifacts, 'denver-review-' + width + '.png'), Buffer.from(shot.data, 'base64')); }
    }
    // API/store boundary coverage lives in batchSupplyEffectiveInventory.test.ts.
    // Mount the same modal to prove refreshed effective counts drive real controls.
    for (const width of [1280, 390]) {
      await load(width, 'emptyFleet=1');
      assert.equal(await evaluate(launch + '.disabled'), true);
      await evaluate('supplyFixture.effectiveCargo(3)'); await settle();
      await click('[...document.querySelectorAll("button")].find(b => b.textContent === "Recalculate with latest stock")');
      await click(source); // Preserve explicit selection; refresh must not reselect sources.
      await input('metal to send', 0);
      assert.equal(await evaluate(launch + '.disabled'), true, 'new ships alone must not send cargo');
      await input('metal to send', 50000);
      const transport = await submit();
      assert.equal(transport.mission, 'transport');
      assert.equal(transport.orders[0].ships.largeCargo, 3);
      assert.equal(transport.orders[0].cargo.metal, 50000);
      await click('[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Deploy")');
      const deploy = await submit();
      assert.equal(deploy.mission, 'deploy');
      assert.equal(deploy.orders[0].ships.largeCargo, 3);
      await evaluate('supplyFixture.effectiveCargo(3)'); await settle();
      assert.deepEqual((await submit()).orders, deploy.orders, 'partial/final credit snapshot does not double count the effective fleet');
      await evaluate('supplyFixture.effectiveCargo(1)'); await settle();
      await click('[...document.querySelectorAll("button")].find(b => b.textContent === "Review latest inventory")');
      await input('metal to send', 10000);
      const afterDebit = await submit();
      assert.equal(afterDebit.orders[0].ships.largeCargo, 1, 'spent ships do not reappear');
      await evaluate('supplyFixture.effectiveCargo(0)'); await settle();
      assert.equal(await evaluate(launch + '.disabled'), true, 'unavailable inventory blocks submission');
    }
    console.log('PASS refreshed effective cargo: resource-selected Transport/Deploy at desktop/mobile widths');

    // Selected feasibility changes still cancel in-flight Max and preserve edits.
    for (const change of ['changeStock', 'changeEligibility', 'changeDrives']) {
      await load(1280);
      await evaluate('window.Worker = class { constructor() { window.feasibilityWorker = this; } postMessage() {} terminate() { this.terminated = true; } };');
      await evaluate(`document.querySelector('input[aria-label="metal to send"]').closest("label").querySelector("button").click()`);
      await settle();
      await evaluate('supplyFixture.' + change + '()'); await settle();
      assert.equal(await evaluate('feasibilityWorker.terminated'), true, change + ': relevant change cancels Max');
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.equal(await evaluate(`document.querySelector('input[aria-label="metal to send"]').value`), '1000');
    }
    // Hold worker results so pending geometry is deterministic, even for tiny fleets.
    for (const width of [1280, 390, 320]) {
      await load(width);
      await evaluate('window.Worker = class { constructor() { window.layoutWorker = this; } postMessage() {} terminate() {} };');
      const geometry = () => evaluate(`(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; };
        return {controls: [...document.querySelectorAll('[aria-label="Resources to send"] input, [aria-label="Resources to send"] button')].map(rect), sources: rect(document.querySelector('[aria-label="Source planets"]'))};
      })()`);
      const before = await geometry();
      for (const resource of ['metal', 'crystal', 'deuterium']) {
        const button = 'document.querySelector(' + JSON.stringify('input[aria-label="' + resource + ' to send"]') + ').closest("label").querySelector("button")';
        await evaluate(button + '.focus(); ' + button + '.click()'); await settle();
        assert.deepEqual(await geometry(), before, width + ': pending ' + resource + ' must not shift controls or sources');
        assert.equal(await evaluate('document.activeElement === ' + button), true, 'Max keeps focus');
        await evaluate('supplyFixture.refresh()'); await settle();
        assert.deepEqual(await geometry(), before, width + ': refresh keeps pending layout');
        assert.equal(await evaluate(button + '.getAttribute("aria-busy")'), 'true');
        // Return the same amount: isolate Max's own layout from legitimate preview changes.
        await evaluate('layoutWorker.onmessage({data:{maximum:' + (resource === 'metal' ? 1000 : 0) + '}})'); await settle();
        assert.deepEqual(await geometry(), before, width + ': completion keeps layout');
        assert.ok(await evaluate('document.querySelector("[role=status]").textContent.includes("Max applied")'));
        assert.equal(await evaluate('document.activeElement === ' + button), true);
        await evaluate(button + '.click()'); await settle();
        await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Cancel Max").click()'); await settle();
        assert.deepEqual(await geometry(), before, width + ': cancellation keeps layout');
        assert.ok(await evaluate('document.querySelector("[role=status]").textContent.includes("Max cancelled")'));
      }
      measurements.push({label: width + '-stable-max', ...before});
    }
    console.log('PASS stable pending/completed Max geometry and focus at 1280, 390 and 320px');

    // Production worker: fifteen fuel-starved 10,000-ship sources used to block
    // this same main thread for seconds. Measure event-loop progress, not throughput.
    await load(1280, 'largeFleet=1');
    const maxButton = resource => 'document.querySelector(' + JSON.stringify('input[aria-label="' + resource + ' to send"]') + ').closest("label").querySelector("button")';
    const busy = () => evaluate('Boolean(document.querySelector("button[aria-busy=true]"))');
    const elapsed = await evaluate('(() => { const start = performance.now(); ' + maxButton('metal') + '.click(); return performance.now() - start; })()');
    assert.ok(elapsed < 250, 'Max click must not run the exact search on the UI thread: ' + elapsed);
    await settle();
    assert.equal(await busy(), true, 'large search has visible progress');
    assert.equal(await evaluate(launch + '.disabled'), true, 'cannot launch the old preview during Max');
    const heartbeat = await evaluate('new Promise(resolve => { let ticks = 0; const start = performance.now(); const timer = setInterval(() => { if (++ticks === 10) { clearInterval(timer); resolve(performance.now() - start); } }, 10); })');
    assert.ok(heartbeat < 500, 'main-thread heartbeat stays responsive during exact search: ' + heartbeat);
    const cancelStart = Date.now();
    await click('[...document.querySelectorAll("button")].find(button => button.textContent === "Cancel Max")');
    assert.equal(await busy(), false);
    assert.ok(Date.now() - cancelStart < 1000, 'large search is immediately cancellable');
    console.log('PASS 15 × 10,000 ships: click ' + elapsed.toFixed(1) + 'ms, ten UI ticks ' + heartbeat.toFixed(1) + 'ms, cancellable');

    // Deterministic queued-event injection into the mounted production hook.
    // Capture callbacks before cleanup to prove identity guards, not just null handlers.
    await load(1280);
    await evaluate(`(() => {
      window.maxWorkers = [];
      window.maxWorkerFailure = '';
      window.Worker = class {
        constructor() {
          if (window.maxWorkerFailure === 'construct') throw new Error('fixture');
          window.maxWorkers.push(this);
        }
        postMessage(request) {
          if (window.maxWorkerFailure === 'post') throw new Error('fixture');
          this.request = request;
          this.reply = this.onmessage;
          this.fail = this.onerror;
          this.messageError = this.onmessageerror;
        }
        terminate() { this.terminated = true; }
      };
    })()`);
    const startMax = async resource => { await evaluate(maxButton(resource) + '.click()'); await settle(); };
    const amount = resource => evaluate('document.querySelector(' + JSON.stringify('input[aria-label="' + resource + ' to send"]') + ').value');
    await startMax('metal');
    assert.equal(await busy(), true);
    for (let refresh = 0; refresh < 3; refresh++) {
      await evaluate('supplyFixture.refresh()'); await settle();
      assert.equal(await busy(), true, 'identical refresh must not cancel pending Max');
      assert.equal(await evaluate('Boolean(maxWorkers[0].terminated)'), false);
      assert.equal(await amount('metal'), '1000', 'refresh never rewrites the draft');
    }
    await evaluate('supplyFixture.accrueStock()'); await settle();
    assert.equal(await busy(), true, 'production increase cannot cancel reviewed-snapshot Max');
    await startMax('crystal');
    assert.equal(await evaluate('maxWorkers[0].terminated'), true, 'replacement terminates CPU work');
    await evaluate('maxWorkers[0].reply({data:{maximum:999999}}); maxWorkers[0].fail();');
    await settle();
    assert.equal(await amount('metal'), '1000', 'superseded result ignored');
    assert.equal(await busy(), true, 'superseded error cannot finish current job');
    await evaluate('maxWorkers[1].reply({data:{maximum:123}})'); await settle();
    assert.equal(await amount('metal'), '1000');
    assert.equal(await amount('crystal'), '123', 'only clicked resource changes');
    assert.equal(await busy(), false);
    assert.equal(await evaluate('maxWorkers[1].terminated'), true, 'success releases worker');

    for (const change of [
      () => input('metal to send', 777),
      () => input('metal to send', '0777'), // Numeric-equivalent edits still cancel.
      () => input('Astro metal to send', 400),
      () => input('Astro metal to send', 400), // Re-entering an override also cancels.
      () => click(`document.querySelector('button[aria-label="Select all ships at Astro"]')`),
      () => click('[...document.querySelectorAll("button")].find(button => button.textContent === "Reset to automatic cargo")'),
      () => click(checkbox(0)),
      () => click(source),
      () => click(`document.querySelector('[aria-label="Mission type"] button:last-child')`),
      async () => { await evaluate("supplyFixture.changeRoute()"); await settle(); },
      async () => { await evaluate("supplyFixture.changeBody()"); await settle(); },
      async () => { await evaluate("supplyFixture.changeLimit()"); await settle(); },
      () => click('[...document.querySelectorAll("button")].find(button => button.textContent === "Cancel Max")'),
      async () => { await evaluate('supplyFixture.pending("action")'); await settle(); },
    ]) {
      await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Review latest inventory")?.click()'); await settle();
      await startMax('metal');
      await evaluate('window.staleMax = maxWorkers.at(-1)');
      await change();
      const expected = await amount('metal');
      assert.equal(await evaluate('staleMax.terminated'), true, 'draft change terminates worker');
      assert.equal(await busy(), false);
      assert.ok(await evaluate('document.querySelector("[role=status]").textContent.includes("Max cancelled")'));
      await evaluate('staleMax.reply({data:{maximum:999999}}); staleMax.fail();'); await settle();
      assert.equal(await amount('metal'), expected, 'draft edit survives stale result');
      assert.equal(await evaluate('Boolean(document.querySelector("[role=alert]"))'), false, 'stale errors ignored');
    }
    await evaluate('supplyFixture.pending("none")'); await settle();
    // The preceding selection toggle left no contributing shipment. Unrelated
    // availability changes must neither cancel Max nor adopt a different snapshot.
    await startMax('metal');
    await evaluate('window.staleMax = maxWorkers.at(-1); supplyFixture.changeStock(); supplyFixture.changeEligibility(); supplyFixture.changeDrives()'); await settle();
    assert.equal(await busy(), true, 'unselected inventory changes do not cancel Max');
    assert.notEqual(await evaluate('staleMax.terminated'), true);
    await click('[...document.querySelectorAll("button")].find(button => button.textContent === "Cancel Max")');
    await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Recalculate with latest stock")?.click()'); await settle();
    for (const failure of ['response', 'error', 'messageerror', 'construct', 'post']) {
      await evaluate('window.maxWorkerFailure = ' + JSON.stringify(failure));
      const expected = await amount('metal');
      await startMax('metal');
      if (failure === 'response') await evaluate('maxWorkers.at(-1).reply({data:{error:"fixture"}})');
      if (failure === 'error') await evaluate('maxWorkers.at(-1).fail()');
      if (failure === 'messageerror') await evaluate('maxWorkers.at(-1).messageError()');
      await settle();
      assert.equal(await busy(), false, failure + ' clears busy');
      assert.equal(await amount('metal'), expected, failure + ' preserves request');
      assert.ok(await evaluate('document.querySelector("[role=alert]")?.textContent.includes("Please retry")'), failure + ' visible retry message');
      assert.equal(await evaluate('maxWorkers.at(-1).terminated'), true, failure + ' releases worker');
    }
    await evaluate('window.maxWorkerFailure = ""');
    await startMax('metal');
    assert.equal(await evaluate('Boolean(document.querySelector("[role=alert]"))'), false, 'retry clears error');
    await evaluate('window.staleMax = maxWorkers.at(-1); supplyFixture.unmount();');
    assert.equal(await evaluate('staleMax.terminated'), true, 'unmount terminates CPU work');
    await evaluate('staleMax.reply({data:{maximum:999999}}); staleMax.fail();'); await settle();
    assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'unmounted result cannot reopen modal');
    console.log('PASS Max replacement, edits, overrides, ships, sources, mission, stock, pending, failures, retry and unmount');
    // Normal transport's actual cargo controls: stock equality is not an action gate.
    for (const width of [1280, 320]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:false});
      await send('Page.navigate', {url: url + '?normal=1'});
      const deadline = Date.now() + 20_000;
      while (!(await evaluate('Boolean(document.querySelector("#resource-metal"))'))) {
        assert.ok(Date.now() < deadline, 'normal cargo fixture did not render');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await evaluate('document.fonts.ready'); await settle();
      const metal = `document.querySelector('button[aria-label^="Set metal cargo"]')`;
      const style = () => evaluate('(() => { const b = ' + metal + '; const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return {width:r.width, height:r.height, opacity:s.opacity}; })()');
      const before = await style();
      for (let cycle = 0; cycle < 4; cycle++) {
        await evaluate('document.querySelector("section > button").click()'); await settle();
        assert.equal(await evaluate(metal + '.disabled'), false, 'refresh does not toggle Max disabled');
        assert.deepEqual(await style(), before, 'stock refresh does not flash opacity or resize Max');
        const expected = cycle % 2 === 0 ? '751' : '750';
        await evaluate(metal + '.focus(); ' + metal + '.click()'); await settle();
        assert.equal(await evaluate('document.querySelector("#resource-metal").value'), expected);
        assert.equal(await evaluate('document.querySelector("#resource-crystal").value'), '200');
        assert.equal(await evaluate('document.querySelector("#resource-deuterium").value'), '100');
        assert.equal(await evaluate(metal + '.disabled'), false);
        assert.equal(await evaluate('document.activeElement === ' + metal), true);
        assert.deepEqual(await style(), before, 'Max completion keeps opacity and geometry');
      }
    }
    console.log('PASS normal transport Max stock refresh, appearance, focus and cargo preservation');
    // Mission selection is draft-local, survives refresh/rejection, and reaches onConfirm.
    for (const width of [1280, 390, 320]) {
      await load(width);
      const transport = "document.querySelector('[aria-label=\"Mission type\"] button:first-child')";
      const deploy = "document.querySelector('[aria-label=\"Mission type\"] button:last-child')";
      assert.equal((await submit()).mission, 'transport');
      assert.equal(await evaluate(transport + '.getAttribute("aria-pressed")'), 'true');
      await click(deploy);
      assert.equal(await evaluate(deploy + '.getAttribute("aria-pressed")'), 'true');
      assert.ok(await evaluate('document.body.textContent.includes("No return trip")'));
      assert.ok(await evaluate(launch + '.textContent.includes("deployment")'));
      const deployment = await submit();
      assert.equal(deployment.mission, 'deploy');
      await evaluate('supplyFixture.refresh()'); await settle();
      assert.equal((await submit()).mission, 'deploy');
      await evaluate('supplyFixture.pending("action")'); await settle();
      assert.equal(await evaluate(transport + '.disabled'), true);
      assert.equal(await evaluate(deploy + '.disabled'), true);
      await evaluate('supplyFixture.reject()'); await settle();
      assert.equal((await submit()).mission, 'deploy');
      await click(transport);
      const returning = await submit();
      assert.equal(returning.mission, 'transport');
      assert.deepEqual(returning.orders, deployment.orders, 'both missions pay the same dispatch fuel');
      await click(deploy);
      await evaluate('supplyFixture.reset("draft")'); await settle();
      assert.equal((await submit()).mission, 'transport', 'new draft defaults to Transport');
      await load(width, 'twoSources=1');
      await evaluate('[...document.querySelectorAll("[data-supply-details] input[type=checkbox]")].filter(input => !input.checked && !input.disabled).forEach(input => input.click())'); await settle();
      await click("document.querySelector('input[aria-label=\"metal to send\"]').closest('label').querySelector('button')");
      assert.equal((await submit()).orders.length, 2);
      await click(deploy);
      assert.equal(await evaluate(launch + '.disabled'), false, 'multi-source Deploy uses an atomic batch');
      assert.equal((await submit()).orders.length, 2);
      await click(transport);
      assert.equal(await evaluate(launch + '.disabled'), false, 'Transport still batches');
    }
    for (const width of [1280, 390]) {
      await load(width, 'combatFleet=1');
      const fighter = "document.querySelector('button[aria-label=\"Light Fighter at Astro\"]')";
      const all = "document.querySelector('button[aria-label=\"Select all ships at Astro\"]')";
      assert.equal(await evaluate(fighter + '.getAttribute("aria-pressed")'), 'false');
      assert.equal(await evaluate(launch + '.disabled'), true, 'empty default cargo does not launch');
      await click(fighter);
      let fleet = await submit();
      assert.equal(fleet.orders[0].ships.lightFighter, 70, 'opt-in type moves every ship');
      assert.equal(fleet.orders[0].ships.largeCargo, 0);
      assert.deepEqual(fleet.orders[0].cargo, {metal:0, crystal:0, deuterium:0});
      await click(all);
      fleet = await submit();
      assert.equal(fleet.fleetModesBySource['188'], 'all');
      assert.equal(fleet.orders[0].ships.largeCargo, 2);
      assert.equal(fleet.orders[0].ships.recycler, 5);
      assert.equal(fleet.orders[0].ships.cruiser, 12);
      await click(fighter);
      fleet = await submit();
      assert.equal(fleet.orders[0].ships.lightFighter, 0, 'deselect after Select all keeps the type home');
      assert.equal(fleet.orders[0].ships.largeCargo, 2);
      await click("document.querySelector('[aria-label=\"Mission type\"] button:last-child')");
      assert.equal((await submit()).mission, 'deploy');
      await evaluate('supplyFixture.refresh()'); await settle();
      assert.equal((await submit()).orders[0].ships.largeCargo, 2);
      await evaluate('supplyFixture.pending("action")'); await settle();
      assert.equal(await evaluate(all + '.disabled'), true);
      await evaluate('supplyFixture.reject()'); await settle();
      await click("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Reset to automatic cargo')");
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.equal(await evaluate(fighter + '.getAttribute("aria-pressed")'), 'false');
    }
    // Standalone moon Supply has no upgrade/shortfall props and may use its parent planet.
    for (const width of [1280, 390]) {
      await load(width, 'moon=1&twoSources=1');
      assert.ok(await evaluate('document.body.textContent.includes("Home moon")'));
      assert.ok(await evaluate('document.body.textContent.includes("Moon Supply uses one source")'));
      assert.equal(await evaluate('document.body.textContent.includes("Destination shortfall")'), false);
      assert.ok(await evaluate(launch + '.textContent.includes("to moon")'));
      assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Source planets"] input:checked').length`), 1);
      assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Source planets"] input[type="checkbox"]')[1].disabled`), true);
      const initial = await submit();
      assert.equal(initial.orders[0].originPlanetId, '189');
      assert.ok(initial.orders[0].fuelCost > 0, 'same-coordinate moon leg consumes fuel');
      assert.ok(initial.orders[0].travelSeconds > 0, 'same-coordinate moon leg has a travel time');
      await click("document.querySelector('input[aria-label=\"metal to send\"]').closest('label').querySelector('button')");
      const maximum = await submit();
      assert.equal(maximum.orders.length, 1);
      assert.equal(maximum.orders[0].cargo.metal + maximum.orders[0].fuelCost, 72500, 'Max reserves parent-to-moon fuel from the selected cargo fleet');
      await click("document.querySelector('[aria-label=\"Mission type\"] button:last-child')");
      const deployed = await submit();
      assert.equal(deployed.mission, 'deploy');
      assert.deepEqual(deployed.orders, maximum.orders);
    }
    // Screenshot-equivalent fleet: five available, two actually sent, one selector row only.
    for (const width of [1280, 390, 320]) {
      await load(width, 'plannedFleetExample=1', 568);
      const fleet = `document.querySelector('[aria-label="Planned fleet at Astro"]')`;
      const large = checkbox(0), recycler = checkbox(2);
      assert.equal(await evaluate('document.body.textContent.includes("Available cargo fleet")'), false);
      assert.equal(await evaluate('[...document.querySelectorAll("span")].filter(node => node.textContent === "Planned fleet").length'), 1, 'one heading per source');
      assert.equal(await evaluate(fleet + '.querySelectorAll("button").length'), 2);
      assert.equal(await evaluate('document.querySelectorAll("[role=dialog] img").length'), 2, 'no duplicate noninteractive fleet icons');
      assert.equal(await evaluate(large + '.textContent'), '×2 planned');
      assert.equal(await evaluate(recycler + '.textContent'), '×0 planned');
      const accessibleButton = async expression => {
        const { result } = await send('Runtime.evaluate', { expression });
        const { nodes } = await send('Accessibility.getPartialAXTree', { objectId: result.objectId });
        return nodes.find(node => node.role?.value === 'button');
      };
      const largeAX = await accessibleButton(large), recyclerAX = await accessibleButton(recycler);
      assert.equal(largeAX.name.value, 'Large Cargo at Astro');
      assert.equal(recyclerAX.name.value, 'Recycler at Astro');
      assert.equal(largeAX.properties.find(property => property.name === 'pressed').value.value, 'true');
      assert.equal(recyclerAX.properties.find(property => property.name === 'pressed').value.value, 'false');
      assert.equal(largeAX.description.value, '×2 planned', 'planned amount is exposed to assistive technology');
      const chipStyle = expression => evaluate('(() => { const button = ' + expression + '; const chip = button.firstElementChild; const target = button.getBoundingClientRect(), visual = chip.getBoundingClientRect(); return {width: target.width, height: target.height, visualWidth: visual.width, visualHeight: visual.height, background: getComputedStyle(chip).backgroundColor, imageOpacity: getComputedStyle(button.querySelector("img")).opacity}; })()');
      const on = await chipStyle(large), off = await chipStyle(recycler);
      for (const style of [on, off]) {
        assert.ok(style.width >= 24 && style.height >= 24, 'usable minimum pointer target');
        assert.ok(style.width <= 44 && style.height <= 30, 'outer button matches the original compact chip footprint');
        assert.equal(style.height, style.visualHeight, 'no invisible vertical padding around the chip');
        assert.ok(style.visualWidth <= 44 && style.visualHeight <= 28, 'compact icon/count footprint');
      }
      assert.notEqual(on.background, off.background, 'selected chip is highlighted');
      assert.equal(off.imageOpacity, '0.5', 'excluded ship image is subdued');
      assert.equal(await evaluate(large + '.title'), 'Large Cargo: 5 available; 2 planned');
      const layout = await evaluate('(() => { const group = ' + fleet + '; const boxes = [...group.querySelectorAll("button")].map(node => { const r = node.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; }); return {rowHeight: group.parentElement.getBoundingClientRect().height, groupHeight: group.getBoundingClientRect().height, boxes}; })()');
      assert.ok(layout.rowHeight <= 30 && layout.groupHeight <= 30, 'whole Planned Fleet row retains the original density');
      for (let i = 0; i < layout.boxes.length; i++) {
        for (let j = i + 1; j < layout.boxes.length; j++) {
          const a = layout.boxes[i], b = layout.boxes[j];
          assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'ship pointer targets never overlap');
        }
      }
      measurements.push({label: width + '-compact-chips', on, off, ...layout});
      const original = await submit();
      assert.equal(original.orders[0].ships.largeCargo, 2);
      await click(large);
      assert.equal(await evaluate(large + '.textContent'), '×0 planned');
      assert.equal((await accessibleButton(large)).description.value, '×0 planned', 'accessible count updates when excluded');
      assert.equal((await chipStyle(large)).background, off.background, 'excluded type loses its highlight');
      assert.equal((await chipStyle(large)).imageOpacity, '0.5');
      assert.equal(await evaluate(source + '.checked'), true);
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.ok(await evaluate('document.body.textContent.includes("No contribution: check stock, selected ships and fuel.")'));
      await evaluate('supplyFixture.refresh()'); await settle();
      assert.equal(await evaluate(large + '.getAttribute("aria-pressed")'), 'false');
      await click(large);
      assert.deepEqual((await submit()).orders, original.orders, 're-enable restores exactly the preview fleet');
      await input('metal to send', 0);
      assert.equal(await evaluate(large + '.textContent'), '×0 planned', 'enabled unused type remains discoverable');
      assert.equal(await evaluate(launch + '.disabled'), true);
      await input('metal to send', 34900);
      assert.equal(await evaluate(large + '.textContent'), '×2 planned');
      if (artifacts) {
        await point(large);
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(artifacts, width + '-planned-fleet.png'), Buffer.from(screenshot.data, 'base64'));
      }
    }
    // No inventory is not an excluded fleet: do not direct players to nonexistent controls.
    for (const width of [1280, 390, 320]) {
      await load(width, 'emptyFleet=1', 568);
      assert.equal(await evaluate('document.querySelectorAll("[role=group] button[aria-describedby]").length'), 0);
      assert.equal(await evaluate(source + '.disabled'), true);
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.ok(await evaluate('document.body.textContent.includes("No mobile ships")'));
      assert.equal(await evaluate('document.body.textContent.includes("Enable another ship type")'), false, 'empty inventory must not suggest nonexistent type controls');
      assert.equal(await evaluate('document.body.textContent.includes("Enable more ship types")'), false, 'empty inventory shortfall must not suggest nonexistent type controls');
      assert.equal(await evaluate('supplyFixture.submissions.length'), 0);
      assert.ok((await point(source)).reachable);
      assert.ok((await point(launch)).reachable);
    }
    // Short viewports must scroll the whole draft, including newly inserted warnings.
    for (const width of [390, 320]) {
      await load(width, '', 568);
      // Reserve classic scrollbar space even on overlay-scrollbar platforms.
      await evaluate(`(() => {
        const panel = document.querySelector("[role=dialog]").firstElementChild;
        const scrollbarWidth = panel.offsetWidth - panel.clientWidth - 2;
        if (scrollbarWidth < 15) panel.style.paddingRight = (parseFloat(getComputedStyle(panel).paddingRight) + 15 - scrollbarWidth) + "px";
      })()`);
      await settle();
      await click(source);
      assert.equal(await evaluate(source + '.checked'), false, 'short-screen source deselected');
      const warning = '[...document.querySelectorAll("[role=dialog] p")].find(node => node.textContent.startsWith("Missing:"))';
      assert.ok(await evaluate('Boolean(' + warning + ')'), 'deselect inserts shortfall warning');
      assert.ok((await point(source)).reachable, width + ': source stays reachable after warning');
      assert.ok((await point(warning)).reachable, width + ': shortfall warning reachable');
      await record(width + '-568-shortfall');
      await click(source);
      assert.equal(await evaluate(source + '.checked'), true, 'short-screen source reselected');
      assert.equal(await evaluate('Boolean(' + warning + ')'), false, 'reselect clears shortfall');
      for (let i = 0; i < types.length; i++) {
        await click(checkbox(i));
        assert.equal((await selected())[i], !defaults[i], 'short-screen type toggle');
        await click(checkbox(i));
      }
      await expectTypes(defaults, 'short-screen type controls remain operable');
      await submit();
      await record(width + '-568-restored');
      console.log('PASS mounted Supply at ' + width + '×568: source deselect/reselect, shortfall state, type controls, footer, no horizontal overflow');
    }
    for (const width of [1280, 390, 320]) {
      await load(width);
      assert.equal(await evaluate('document.body.textContent.includes("Ship types for all sources")'), false);
      await expectTypes(defaults, 'Recycler defaults off');
      let submission = await submit();
      assert.deepEqual(submission.shipTypesBySource, {});
      assert.equal(submission.orders[0].ships.recycler, 0);
      await record(width + '-default');

      // Explicit opt-in must survive even if the current small order does not need a Recycler.
      await click(checkbox(2));
      submission = await submit();
      assert.ok(submission.shipTypesBySource["188"].includes('recycler'));
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
      assert.deepEqual(submission.shipTypesBySource["188"], ['recycler']);
      assert.ok(submission.orders[0].ships.recycler > 0);
      for (const key of ['largeCargo', 'smallCargo', 'colonyShip']) assert.equal(submission.orders[0].ships[key], 0);

      for (const kind of ['action', 'transaction']) {
        await evaluate('supplyFixture.pending(' + JSON.stringify(kind) + ')'); await settle();
        assert.equal(await evaluate('[...document.querySelectorAll("[role=group] button[aria-describedby]")].every(input => input.matches(":disabled"))'), true);
        assert.equal(await evaluate(launch + '.disabled'), true);
        await click(checkbox(2));
        await expectTypes([false, false, true, false], kind + ' pending prevents changes');
      }
      await evaluate('supplyFixture.reject()'); await settle();
      assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Wallet request rejected")'));
      await expectTypes([false, false, true, false], 'wallet rejection retains intent');
      assert.equal(await evaluate('document.querySelector("[role=group] button[aria-describedby]").matches(":disabled")'), false);
      submission = await submit();
      assert.deepEqual(submission.shipTypesBySource["188"], ['recycler'], 'retry carries retained choices');
      await record(width + '-rejected');

      for (const kind of ['draft', 'target', 'account']) {
        await evaluate('supplyFixture.reset(' + JSON.stringify(kind) + ')');
        await settle();
        await evaluate('document.querySelector("[data-supply-details]").setAttribute("open", ""); document.querySelector("[data-supply-amounts]").setAttribute("open", "")'); await settle();
        await expectTypes(defaults, kind + ' starts fresh defaults');
        await click(checkbox(2));
        await click(checkbox(0));
        await expectTypes([false, true, true, true], 'new draft remains editable');
      }

      // A source with only Recyclers cannot supply by default, but opt-in unblocks it.
      await load(width, 'recyclerOnly=1');
      await expectTypes([false], 'Recycler-only source still defaults off');
      assert.equal(await evaluate(source + '.checked'), false, 'opt-in-only source does not auto-select');
      assert.equal(await evaluate(launch + '.disabled'), true);
      await click(checkbox(2));
      assert.equal(await evaluate(source + '.checked'), false, 'enabling a type never silently selects the source');
      await click(source);
      submission = await submit();
      assert.ok(submission.orders[0].ships.recycler > 0);
      await click(checkbox(2));
      assert.equal(await evaluate(launch + '.disabled'), true, 'opt-out removes Recycler-only plan');
      await click(checkbox(2));
      await submit();
      await record(width + '-recycler-only');
      console.log('PASS mounted Supply at ' + width + 'px: defaults, explicit intent, refresh, Max, edits, source toggle, empty selection, pending, rejection, resets, Recycler-only source');
    }
    for (const width of [1280, 390]) for (const oneSlot of [true, false]) {
      await load(width, 'combatOnlyFirst=1' + (oneSlot ? '&oneSlot=1' : ''), 568);
      const sourceChecks = "[...document.querySelectorAll('[aria-label=\"Source planets\"] input[type=\"checkbox\"]')].map(input => input.checked)";
      assert.deepEqual(await evaluate(sourceChecks), [false, true], 'nearest combat-only source must not displace default cargo source');
      assert.equal(await evaluate(launch + '.disabled'), false);
      const submission = await submit();
      assert.equal(submission.orders.length, 1);
      assert.equal(submission.orders[0].originPlanetId, '190');
      assert.equal(submission.orders[0].cargo.metal, 1000);
    }
    console.log('PASS nearest combat-only origin stays opt-in with one and multiple slots on desktop/mobile');
    // Two distinct source inventories: physical taps/keyboard must not toggle another source or checkbox.
    for (const width of [1280, 390, 320]) {
      await load(width, 'twoSources=1', 568);
      await evaluate('[...document.querySelectorAll("[data-supply-details] input[type=checkbox]")].filter(input => !input.checked && !input.disabled).forEach(input => input.click())'); await settle();
      const lunaSmall = `document.querySelector('button[aria-label="Small Cargo at Luna"]')`;
      const lunaRecycler = `document.querySelector('button[aria-label="Recycler at Luna"]')`;
      const sourceChecks = `[...document.querySelectorAll('[aria-label="Source planets"] input[type="checkbox"]')].map(input => input.checked)`;
      const maxMetal = `document.querySelector('input[aria-label="metal to send"]').closest("label").querySelector("button")`;
      const pressed = expression => evaluate(expression + '.getAttribute("aria-pressed") === "true"');
      assert.equal(await pressed(lunaRecycler), false, 'second source Recycler defaults off');
      assert.equal(await evaluate(lunaSmall + '.textContent.includes("×0")'), true, 'unused source shows zero planned, not two available');
      await click(maxMetal);
      const before = await submit();
      const originalLuna = before.orders.find(order => order.originPlanetId === '190');
      assert.ok(originalLuna && originalLuna.ships.smallCargo === 2);
      await click(checkbox(0));
      await expectTypes([false, true, false, true], 'only tapped type changes');
      assert.equal(await pressed(lunaSmall), true);
      assert.deepEqual(await evaluate(sourceChecks), [true, true], 'chip does not toggle source checkboxes');
      assert.equal(await evaluate(launch + '.disabled'), true, 'reduced capacity blocks old Max');
      await click(maxMetal);
      let submission = await submit();
      assert.deepEqual(submission.orders.find(order => order.originPlanetId === '190'), originalLuna, 'other source plan unchanged');
      assert.equal(submission.orders[0].ships.largeCargo, 0);
      // Native button keyboard activation re-adds the excluded type.
      await evaluate(checkbox(0) + '.focus()');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await settle();
      await expectTypes(defaults, 'keyboard re-adds type');
      assert.deepEqual(await evaluate('(() => { const button = ' + checkbox(0) + '; const style = getComputedStyle(button); return {focused: document.activeElement === button, visible: button.matches(":focus-visible"), outline: style.outlineStyle, width: style.outlineWidth}; })()'), {focused: true, visible: true, outline: 'solid', width: '2px'}, 'visible keyboard focus survives activation');
      await click(maxMetal);
      submission = await submit();
      assert.deepEqual(submission.orders, before.orders, 're-adding restores fleet plan');
      await click(lunaRecycler);
      assert.equal(await pressed(checkbox(2)), false, 'second source opt-in leaves first Recycler off');
      assert.deepEqual(await evaluate(sourceChecks), [true, true]);
      await click(maxMetal);
      submission = await submit();
      assert.ok(submission.orders.find(order => order.originPlanetId === '190').ships.recycler > 0);
      assert.equal(submission.orders[0].ships.recycler, 0);
      await click(source);
      const secondSource = `document.querySelectorAll('[aria-label="Source planets"] input[type="checkbox"]')[1]`;
      await click(secondSource);
      await evaluate('supplyFixture.refresh()'); await settle();
      assert.deepEqual(await evaluate(sourceChecks), [false, false], 'refresh preserves explicit deselect-all');
      assert.equal(await pressed(lunaRecycler), true);
      await click(source); await click(secondSource);
      await evaluate('supplyFixture.changeStock()'); await settle();
      assert.equal(await evaluate(launch + '.disabled'), true, 'stock refresh requires explicit review');
      await click('[...document.querySelectorAll("button")].find(b => b.textContent === "Review latest inventory")');
      assert.equal(await evaluate(lunaSmall + '.textContent.includes("×1")'), true, 'fresh planned count');
      assert.equal(await pressed(lunaRecycler), true, 'changed inventory retains opt-in');
      assert.equal(await evaluate(launch + '.disabled'), true, 'changed stock blocks short shipment');
      await click(maxMetal);
      submission = await submit();
      assert.equal(submission.orders.reduce((sum, order) => sum + order.cargo.metal, 0), 1000);
      assert.ok(submission.shipTypesBySource['190'].includes('recycler'));
      assert.equal(submission.shipTypesBySource['188'].includes('recycler'), false);
      console.log('PASS independent source chips at ' + width + 'px: source/type isolation, exact plans, keyboard, changed counts, refresh and Max');
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
