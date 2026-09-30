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
      while (!query.includes('emptyFleet') && !(await evaluate(source + '.checked'))) {
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
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
      await settle();
    }
    const selected = () => evaluate('[...document.querySelectorAll("[role=group] button")].filter(input => input.getAttribute("aria-label").endsWith(" at Astro")).map(input => input.getAttribute("aria-pressed") === "true")');
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
        return {viewport: innerWidth, viewportHeight: innerHeight, pageWidth: document.documentElement.scrollWidth, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, overflowing, labels: [...document.querySelectorAll("[role=group] button")].map(node => node.getAttribute("aria-label").split(" at ")[0])};
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
      assert.equal(await evaluate(large + '.title'), 'Large Cargo');
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
      assert.ok(await evaluate('document.body.textContent.includes("No ships planned from this source.")'));
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
      assert.equal(await evaluate('document.querySelectorAll("[role=group] button").length'), 0);
      assert.equal(await evaluate(source + '.disabled'), true);
      assert.equal(await evaluate(launch + '.disabled'), true);
      assert.ok(await evaluate('document.body.textContent.includes("No cargo ships")'));
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
        assert.equal(await evaluate('[...document.querySelectorAll("[role=group] button")].every(input => input.matches(":disabled"))'), true);
        assert.equal(await evaluate(launch + '.disabled'), true);
        await click(checkbox(2));
        await expectTypes([false, false, true, false], kind + ' pending prevents changes');
      }
      await evaluate('supplyFixture.reject()'); await settle();
      assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Wallet request rejected")'));
      await expectTypes([false, false, true, false], 'wallet rejection retains intent');
      assert.equal(await evaluate('document.querySelector("[role=group] button").matches(":disabled")'), false);
      submission = await submit();
      assert.deepEqual(submission.shipTypesBySource["188"], ['recycler'], 'retry carries retained choices');
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
      await expectTypes([false], 'Recycler-only source still defaults off');
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
    // Two distinct source inventories: physical taps/keyboard must not toggle another source or checkbox.
    for (const width of [1280, 390, 320]) {
      await load(width, 'twoSources=1', 568);
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
