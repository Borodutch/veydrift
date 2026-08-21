import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "vite";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  // Arch's /usr/bin/chromium launcher applies the user's chromium-flags.conf.
  // Prefer the real binary so headless tests are isolated from desktop flags.
  "/usr/lib/chromium/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let cdp;
let browserCdp;
let chrome;
let chromeProfile;
let devToolsTargetsUrl;
let fixtureUrl;
let inspectorFixtureUrl;
let pageTargetId;
let server;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 0;

    socket.addEventListener("error", () => reject(new Error(`Could not connect to ${webSocketUrl}`)));
    socket.addEventListener("close", () => {
      for (const command of pending.values()) {
        command.reject(new Error(`DevTools connection closed: ${webSocketUrl}`));
      }
      pending.clear();
    });
    socket.addEventListener("open", () => {
      resolve({
        close() {
          socket.close();
        },
        send(method, params = {}) {
          const id = ++nextId;
          return new Promise((resolveCommand, rejectCommand) => {
            pending.set(id, { reject: rejectCommand, resolve: resolveCommand });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      if (message.error) {
        command.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        command.resolve(message.result);
      }
    });
  });
}

async function waitForPageTarget(expectedTargetId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(devToolsTargetsUrl)).json();
      const pageTarget = targets.find((target) => (
        target.type === "page"
        && (!expectedTargetId || target.id === expectedTargetId)
        && target.webSocketDebuggerUrl
      ));
      if (pageTarget) return pageTarget;
    } catch {
      // DevTools can advertise its browser socket just before the target list is ready.
    }
    await delay(25);
  }
  throw new Error(expectedTargetId
    ? `Chrome did not expose page target ${expectedTargetId}.`
    : "Chrome did not expose a page target.");
}

async function configurePageTarget(connection) {
  await connection.send("Page.enable");
  await connection.send("Runtime.enable");
  await connection.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
}

async function replacePageTarget() {
  const previousCdp = cdp;
  const previousTargetId = pageTargetId;
  const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank" });
  const pageTarget = await waitForPageTarget(targetId);
  const nextCdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
  await configurePageTarget(nextCdp);

  cdp = nextCdp;
  pageTargetId = targetId;
  previousCdp?.close();
  if (previousTargetId) {
    await browserCdp.send("Target.closeTarget", { targetId: previousTargetId }).catch(() => undefined);
  }
}

async function launchChrome() {
  const executable = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`Chrome executable not found. Checked: ${chromeCandidates.join(", ")}`);
  }

  chromeProfile = mkdtempSync(join(tmpdir(), "veydrift-touch-browser-"));
  chrome = spawn(executable, [
    "--headless=new",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${chromeProfile}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const browserWebSocketUrl = await new Promise((resolve, reject) => {
    // GitHub-hosted runners occasionally take longer than the local cold-start path
    // to initialize headless Chrome after dependency installation.
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools endpoint timed out.")), 30_000);
    let stderr = "";
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    chrome.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (code ${code}).`));
    });
  });

  browserCdp = await connectCdp(browserWebSocketUrl);
  devToolsTargetsUrl = browserWebSocketUrl
    .replace(/^ws:/, "http:")
    .replace(/\/devtools\/browser\/.*$/, "/json/list");
  const pageTarget = await waitForPageTarget();
  pageTargetId = pageTarget.id;
  return connectCdp(pageTarget.webSocketDebuggerUrl);
}

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return response.result.value;
}

async function waitForExpression(expression, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

async function loadFixture() {
  await cdp.send("Page.navigate", { url: fixtureUrl });
  await waitForExpression("window.touchProofReady === true");
}

before(async () => {
  server = await createServer({
    logLevel: "error",
    root: new URL("..", import.meta.url).pathname,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a browser-test port.");
  }
  fixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/planetPickerTouchBrowser.html`;
  inspectorFixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/planetInspectorBrowser.html`;

  cdp = await launchChrome();
  await configurePageTarget(cdp);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 720,
    mobile: true,
    width: 390,
  });
  await loadFixture();
});

after(async () => {
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    await Promise.race([
      browserCdp?.send("Browser.close").catch(() => undefined),
      delay(1_000),
    ]);
    await Promise.race([
      exited,
      delay(3_000),
    ]);
    if (chrome.exitCode === null) {
      chrome.kill("SIGTERM");
      await Promise.race([exited, delay(2_000)]);
    }
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
      await Promise.race([exited, delay(2_000)]);
    }
  }
  cdp?.close();
  browserCdp?.close();
  await server?.close();
  if (chromeProfile) {
    rmSync(chromeProfile, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

async function dispatchTouch(type, x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" || type === "touchCancel"
      ? []
      : [{ force: 1, id: 1, radiusX: 4, radiusY: 4, x, y }],
  });
}

async function planetCenter() {
  return evaluate(`(() => {
    const box = document.querySelector("#planet").getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height - 30 };
  })()`);
}

async function proofState() {
  return evaluate(`({
    activations: window.touchProof.activations,
    pointerCancels: window.touchProof.pointerCancels,
    pointerMovesAfterActivation: window.touchProof.pointerMovesAfterActivation,
    preventedTouchMoves: window.touchProof.preventedTouchMoves,
    scrollLeft: document.querySelector("#scroller").scrollLeft,
    scrollTop: document.querySelector("#scroller").scrollTop,
    touchMoves: window.touchProof.touchMoves,
  })`);
}

async function moveTouch(x, y, axis) {
  for (const offset of [15, 30, 50, 75, 105]) {
    await dispatchTouch(
      "touchMove",
      axis === "x" ? x - offset : x,
      axis === "y" ? y - offset : y,
    );
    await delay(30);
  }
}

test("native two-axis touch scroll works before the hold and post-hold movement stays reorderable", async () => {
  let center = await planetCenter();
  await dispatchTouch("touchStart", center.x, center.y);
  await delay(30);
  await moveTouch(center.x, center.y, "y");
  await dispatchTouch("touchEnd", center.x, center.y - 105);
  await delay(250);

  const scrollState = await proofState();
  assert.equal(scrollState.activations, 0);
  assert.equal(scrollState.preventedTouchMoves, 0);
  assert.ok(scrollState.scrollTop > 0, `expected native scroll, got scrollTop=${scrollState.scrollTop}`);

  await loadFixture();
  center = await planetCenter();
  await dispatchTouch("touchStart", center.x, center.y);
  await delay(30);
  await moveTouch(center.x, center.y, "x");
  await dispatchTouch("touchEnd", center.x - 105, center.y);
  await delay(250);

  const horizontalScrollState = await proofState();
  assert.equal(horizontalScrollState.activations, 0);
  assert.equal(horizontalScrollState.preventedTouchMoves, 0);
  assert.ok(
    horizontalScrollState.scrollLeft > 0,
    `expected native horizontal scroll, got scrollLeft=${horizontalScrollState.scrollLeft}`,
  );

  await loadFixture();
  center = await planetCenter();
  await dispatchTouch("touchStart", center.x, center.y);
  await delay(550);
  for (const offset of [15, 30, 50, 70]) {
    await dispatchTouch("touchMove", center.x - offset, center.y);
    await delay(30);
  }
  await dispatchTouch("touchEnd", center.x - 70, center.y);
  await delay(100);

  const reorderState = await proofState();
  assert.equal(reorderState.activations, 1);
  assert.ok(
    reorderState.preventedTouchMoves > 0,
    `expected cancelled touchmove after activation: ${JSON.stringify(reorderState)}`,
  );
  assert.ok(
    reorderState.pointerMovesAfterActivation > 0,
    `expected pointermove after activation: ${JSON.stringify(reorderState)}`,
  );
  assert.equal(reorderState.pointerCancels, 0);
  assert.equal(reorderState.scrollLeft, 0);
  assert.equal(reorderState.scrollTop, 0);
});

async function loadInspectorFixture(route, width, options = {}) {
  // Inspector fixtures can intentionally leave wallet requests pending. Give every
  // test a fresh page target so one fixture cannot stall the next navigation.
  await replacePageTarget();
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 900,
    mobile: width < 768,
    width,
  });
  const { waitForPlanetSelectors = "true", ...fixtureOptions } = options;
  const params = new URLSearchParams({ route, ...fixtureOptions });
  await cdp.send("Page.navigate", {
    url: `${inspectorFixtureUrl}?${params}`,
  });
  try {
    await waitForExpression("window.inspectorProof?.appReady === true", 30_000);
  } catch (error) {
    const diagnostics = await evaluate(`({
      body: document.body?.innerText.slice(0, 2000),
      errors: window.inspectorProof?.errors,
      path: location.pathname,
      readyState: document.readyState,
      requests: window.inspectorProof?.requests,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name).slice(-20),
      url: location.href,
    })`).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    throw new Error(`${error.message}\nInspector bootstrap diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  if (waitForPlanetSelectors === "false") return;
  try {
    await waitForExpression("document.querySelectorAll('[data-planet-selector-item]').length >= 2");
  } catch (error) {
    const diagnostics = await evaluate(`({
      body: document.body.innerText.slice(0, 2000),
      html: document.querySelector('#app')?.innerHTML.slice(0, 2000),
      path: location.pathname,
      errors: window.inspectorProof?.errors,
      requests: window.inspectorProof?.requests,
      selectors: document.querySelectorAll('[data-planet-selector-item]').length,
    })`);
    throw new Error(`${error.message}\nInspector diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}

async function clickExpression(expression) {
  const clicked = await evaluate(`(() => {
    const target = ${expression};
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `could not click ${expression}`);
}

async function clickExpressionWithTrustedPointer(expression, pointerType = "mouse") {
  await evaluate(`(() => {
    const target = ${expression};
    target?.scrollIntoView({ block: 'center', inline: 'center' });
  })()`);
  await delay(50);
  const center = await evaluate(`(() => {
    const target = ${expression};
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(center, `could not find ${expression}`);
  if (pointerType === "touch") {
    await dispatchTouch("touchStart", center.x, center.y);
    await dispatchTouch("touchEnd", center.x, center.y);
    return;
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: center.x, y: center.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: center.x, y: center.y });
}

async function expressionCenter(expression) {
  const center = await evaluate(`(() => {
    const target = ${expression};
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(center, `could not find ${expression}`);
  return center;
}

async function clickSectionAndReadRender(expression) {
  return evaluate(`(() => {
    const target = ${expression};
    if (!target) return null;
    target.click();
    return {
      activeHref: document.querySelector('nav.hidden a[aria-current="page"]')?.getAttribute('href') ?? null,
      hasOverviewFleets: document.querySelector('main section[aria-label="Fleets"]') !== null,
      path: location.pathname,
    };
  })()`);
}

async function accessibilityNode(name) {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  return nodes.find((node) => node.name?.value === name && !node.ignored);
}

async function inspectorSnapshot() {
  return evaluate(`({
    heading: document.querySelector('main h2')?.textContent?.trim() ?? null,
    path: location.pathname,
    text: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    topBarTitles: [...document.querySelectorAll('.sticky.top-0 summary[title]')].map((summary) => summary.title),
  })`);
}

async function responsiveDetailSnapshot() {
  return evaluate(`(() => {
    const detail = document.querySelector('[data-celestial-detail]');
    const layout = detail?.querySelector('[data-celestial-layout]');
    const artwork = detail?.querySelector('[data-celestial-artwork]');
    const media = detail?.querySelector('[data-celestial-media]');
    const summary = detail?.querySelector('[data-celestial-summary]');
    const back = detail?.querySelector('[data-celestial-back]');
    if (!detail || !layout || !artwork || !media || !summary || !back) return null;
    const detailRect = detail.getBoundingClientRect();
    const main = detail.closest('main');
    const mainRect = main?.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const artworkRect = artwork.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const backRect = back.getBoundingClientRect();
    const recordValues = [...detail.querySelectorAll('[data-celestial-record-value]')].map((value) => {
      const rect = value.getBoundingClientRect();
      const style = getComputedStyle(value);
      return {
        clientWidth: value.clientWidth,
        left: rect.left,
        right: rect.right,
        scrollWidth: value.scrollWidth,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    const tapTargets = [...detail.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, text: button.textContent?.trim() ?? '', width: rect.width };
    });
    const overflowing = [...detail.querySelectorAll('*')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1))
      .map(({ element, rect }) => ({
        className: typeof element.className === 'string' ? element.className : '',
        left: rect.left,
        right: rect.right,
        tag: element.tagName,
      }));
    return {
      artwork: { bottom: artworkRect.bottom, height: artworkRect.height, left: artworkRect.left, right: artworkRect.right, top: artworkRect.top, width: artworkRect.width },
      back: { height: backRect.height, width: backRect.width },
      detail: { bottom: detailRect.bottom, left: detailRect.left, right: detailRect.right, width: detailRect.width },
      documentWidth: document.documentElement.scrollWidth,
      layout: { left: layoutRect.left, right: layoutRect.right, width: layoutRect.width },
      minHeight: getComputedStyle(detail).minHeight,
      media: { height: mediaRect.height, width: mediaRect.width },
      overflowing,
      recordValues,
      summary: { left: summaryRect.left, right: summaryRect.right, top: summaryRect.top, width: summaryRect.width },
      tailGap: main && mainRect ? main.scrollHeight - (detailRect.bottom - mainRect.top + main.scrollTop) : null,
      tapTargets,
      viewportWidth: document.documentElement.clientWidth,
    };
  })()`);
}

for (const { width, route, kind } of [
  { width: 360, route: "/planet/9/9/9", kind: "planet" },
  { width: 360, route: "/moon/9/9/9", kind: "moon" },
  { width: 390, route: "/planet/1/2/3", kind: "planet" },
  { width: 390, route: "/moon/1/2/3", kind: "moon" },
  { width: 768, route: "/planet/9/9/9", kind: "planet" },
  { width: 768, route: "/moon/9/9/9", kind: "moon" },
  { width: 1280, route: "/planet/1/2/3", kind: "planet" },
  { width: 1280, route: "/moon/1/2/3", kind: "moon" },
]) {
  test(`${kind} detail is responsive without horizontal overflow at ${width}px`, async () => {
    await loadInspectorFixture(route, width);
    await waitForExpression(`document.querySelector('[data-celestial-detail="${kind}"] [data-celestial-summary]') !== null`);
    const snapshot = await responsiveDetailSnapshot();
    assert.ok(snapshot, "expected the celestial detail layout markers");
    assert.equal(snapshot.documentWidth, snapshot.viewportWidth);
    assert.deepEqual(snapshot.overflowing, []);
    assert.equal(snapshot.minHeight, "0px");
    assert.ok(Math.abs(snapshot.media.width - snapshot.media.height) <= 1, JSON.stringify(snapshot.media));
    assert.ok(snapshot.artwork.width <= snapshot.layout.width + 1);
    assert.ok(snapshot.back.height >= 43.5, `expected a 44px back target, got ${snapshot.back.height}`);
    for (const value of snapshot.recordValues) {
      assert.ok(value.left >= snapshot.detail.left - 1 && value.right <= snapshot.detail.right + 1, JSON.stringify(value));
      assert.ok(value.scrollWidth <= value.clientWidth + 1, JSON.stringify(value));
      assert.notEqual(value.textOverflow, "ellipsis");
      assert.notEqual(value.whiteSpace, "nowrap");
    }
    if (width < 1280) {
      for (const target of snapshot.tapTargets) {
        assert.ok(target.height >= 43.5, `expected a 44px tap target: ${JSON.stringify(target)}`);
      }
    }
    if (width < 1280) {
      assert.ok(snapshot.tailGap === null || snapshot.tailGap <= 48, `unexpected empty detail tail: ${snapshot.tailGap}px`);
    }
    if (width < 1280) {
      assert.ok(snapshot.artwork.bottom <= snapshot.summary.top + 1, JSON.stringify(snapshot));
      assert.ok(snapshot.summary.width >= snapshot.layout.width - 1, JSON.stringify(snapshot));
    } else {
      assert.ok(snapshot.artwork.right <= snapshot.summary.left + 1, JSON.stringify(snapshot));
      assert.ok(Math.abs(snapshot.artwork.top - snapshot.summary.top) <= 1, JSON.stringify(snapshot));
    }
  });
}

test("desktop selector atomically replaces an unrelated inspector with one owned route and dataset", async () => {
  await loadInspectorFixture("/planet/9/9/9", 1280);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");

  await clickExpression("document.querySelector('aside[aria-label=\"Select planet\"] [data-planet-selector-item=\"owned-b\"] button[data-planet-selector-long-press]')");
  await waitForExpression("location.pathname === '/planet/4/5/6'");
  try {
    await waitForExpression("document.querySelector('main h2')?.textContent?.includes('Owned Beta') === true");
  } catch (error) {
    const diagnostics = await evaluate(`({
      errors: window.inspectorProof.errors,
      heading: document.querySelector('main h2')?.textContent,
      path: location.pathname,
      requests: window.inspectorProof.requests.slice(-20),
      text: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 2000),
    })`);
    throw new Error(`${error.message}\nPost-click diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const snapshot = await inspectorSnapshot();
  assert.equal(snapshot.path, "/planet/4/5/6");
  assert.equal(snapshot.heading, "Owned Beta");
  assert.match(snapshot.text, /Home world/);
  assert.match(snapshot.text, /Add media/);
  assert.ok(snapshot.topBarTitles.some((title) => title.startsWith("Metal: 203")));
  assert.ok(snapshot.topBarTitles.some((title) => title.startsWith("Crystal: 201")));
  assert.ok(snapshot.topBarTitles.some((title) => title.startsWith("Deuterium: 202")));
  assert.doesNotMatch(snapshot.text, /Unrelated Gamma|9,909/);
});

test("mobile hamburger is exposed as a button with a clickable hit region", async () => {
  await loadInspectorFixture("/planet/9/9/9", 390);

  const toggle = await accessibilityNode("Open navigation menu");
  assert.ok(toggle, "expected the mobile navigation toggle in the accessibility tree");
  assert.equal(toggle.role?.value, "button");

  const bounds = await evaluate(`(() => {
    const box = document.querySelector('[aria-label="Open navigation menu"]')?.getBoundingClientRect();
    return box ? { height: box.height, width: box.width } : null;
  })()`);
  assert.ok(bounds, "expected the mobile navigation toggle in the document");
  assert.ok(bounds.height >= 44 && bounds.width >= 44, `expected a 44px mobile menu hit region: ${JSON.stringify(bounds)}`);
});

test("mobile hamburger selector independently invokes the owned-planet transition", async () => {
  await loadInspectorFixture("/planet/9/9/9", 390);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");
  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression(`(() => {
    const details = document.querySelector('details:has(#mobile-navigation-menu)');
    const menu = document.querySelector('#mobile-navigation-menu');
    const labels = [...document.querySelectorAll('#mobile-navigation-menu nav a')]
      .map((link) => link.textContent?.trim());
    return details?.open === true
      && menu?.getBoundingClientRect().height > 0
      && ['Overview', 'Infrastructure', 'Galaxy', 'Raid Finder', 'Rankings', 'Alliance']
        .every((label) => labels.includes(label));
  })()`);
  await waitForExpression("document.querySelector('#mobile-navigation-menu section[aria-label=\"Select planet\"]') !== null");
  await clickExpression("document.querySelector('#mobile-navigation-menu [data-planet-selector-item=\"owned-b\"] button[data-planet-selector-long-press]')");
  await waitForExpression("location.pathname === '/planet/4/5/6' && document.querySelector('main h2')?.textContent === 'Owned Beta'");

  const snapshot = await inspectorSnapshot();
  assert.equal(snapshot.heading, "Owned Beta");
  assert.match(snapshot.text, /Home world/);
  assert.match(snapshot.text, /Add media/);
  assert.ok(snapshot.topBarTitles.some((title) => title.startsWith("Metal: 203")));
  assert.doesNotMatch(snapshot.text, /Unrelated Gamma|9,909/);
});

test("desktop sidebar first clicks commit Infrastructure and Shipyard routes", async () => {
  await loadInspectorFixture("/planet/9/9/9", 1280);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");

  await clickExpression("document.querySelector('nav.hidden a[href=\"/infrastructure\"]')");
  await waitForExpression("location.pathname === '/infrastructure' && document.querySelector('nav.hidden a[href=\"/infrastructure\"][aria-current=\"page\"]') !== null");

  const shipyardRender = await clickSectionAndReadRender("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasOverviewFleets: false,
    path: "/shipyard",
  });
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('nav.hidden a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Fleets"]') === null`);
});

test("Galaxy sidebar trusted clicks commit Raid Finder and Shipyard routes", async () => {
  await loadInspectorFixture("/galaxy", 1280);
  await waitForExpression("location.pathname === '/galaxy' && document.querySelector('nav.hidden a[href=\"/galaxy\"][aria-current=\"page\"]') !== null");

  await clickExpressionWithTrustedPointer("document.querySelector('nav.hidden a[href=\"/raid-finder\"]')");
  await waitForExpression(`location.pathname === '/raid-finder'
    && document.querySelector('nav.hidden a[href="/raid-finder"][aria-current="page"]') !== null
    && document.querySelector('main [data-raid-target-finder-page]') !== null
    && document.querySelector('main')?.textContent?.includes('Galaxy') === false`);

  await loadInspectorFixture("/galaxy", 1280);
  await waitForExpression("location.pathname === '/galaxy' && document.querySelector('nav.hidden a[href=\"/galaxy\"][aria-current=\"page\"]') !== null");

  await clickExpressionWithTrustedPointer("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('nav.hidden a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main')?.textContent?.includes('Galaxy') === false`);
});

test("desktop mouse release over a Galaxy sidebar link does not navigate when the press began elsewhere", async () => {
  await loadInspectorFixture("/galaxy", 1280);
  await waitForExpression("location.pathname === '/galaxy' && document.querySelector('nav.hidden a[href=\"/galaxy\"][aria-current=\"page\"]') !== null");

  const start = await expressionCenter("document.querySelector('main')");
  const end = await expressionCenter("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: start.x,
    y: start.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    x: end.x,
    y: end.y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: end.x,
    y: end.y,
  });
  await delay(100);

  assert.equal(await evaluate("location.pathname"), "/galaxy");
  assert.equal(
    await evaluate("document.querySelector('nav.hidden a[href=\"/galaxy\"]')?.getAttribute('aria-current')"),
    "page",
  );
});

test("mobile Galaxy sidebar touch drag and cancel sequences do not navigate", async () => {
  for (const mode of ["drag", "cancel"]) {
    await loadInspectorFixture("/galaxy", 390);
    await waitForExpression("location.pathname === '/galaxy' && document.querySelector('a[href=\"/galaxy\"][aria-current=\"page\"]') !== null");
    await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
    await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");

    const start = await expressionCenter("document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"]')");
    await dispatchTouch("touchStart", start.x, start.y);
    if (mode === "drag") {
      await dispatchTouch("touchMove", Math.max(10, start.x - 100), Math.min(890, start.y + 100));
      await dispatchTouch("touchEnd", Math.max(10, start.x - 100), Math.min(890, start.y + 100));
    } else {
      await dispatchTouch("touchCancel", start.x, start.y);
    }
    await delay(100);

    assert.equal(await evaluate("location.pathname"), "/galaxy", `${mode} should not activate Shipyard`);
    assert.equal(
      await evaluate("document.querySelector('a[href=\"/galaxy\"]')?.getAttribute('aria-current')"),
      "page",
    );
  }
});

test("Galaxy sidebar pointer releases navigate on desktop and mobile when the later click phase is consumed", async () => {
  for (const width of [1280, 390]) {
    for (const [href, destinationSelector] of [
      ["/raid-finder", "main [data-raid-target-finder-page]"],
      ["/shipyard", "main [data-production-catalog]"],
    ]) {
      await loadInspectorFixture("/galaxy", width);
      const navSelector = width < 768 ? "#mobile-navigation-menu" : "nav.hidden";
      const pointerType = width < 768 ? "touch" : "mouse";
      await waitForExpression("location.pathname === '/galaxy' && document.querySelector('a[href=\"/galaxy\"][aria-current=\"page\"]') !== null");
      if (width < 768) {
        await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
        await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
      }

      await evaluate(`document.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('${navSelector} a[href="${href}"]')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, { capture: true, once: true })`);
      await clickExpressionWithTrustedPointer(`document.querySelector('${navSelector} a[href="${href}"]')`, pointerType);
      await waitForExpression(`location.pathname === '${href}'
        && document.querySelector('${navSelector} a[href="${href}"][aria-current="page"]') !== null
        && document.querySelector('${destinationSelector}') !== null
        && document.querySelector('main')?.textContent?.includes('Galaxy') === false
        ${width < 768 ? "&& document.querySelector('details:has(#mobile-navigation-menu)')?.open === false" : ""}`);

      const pointerProof = await evaluate(`window.inspectorProof.interactions
        .findLast((event) => event.type === 'pointerdown') ?? null`);
      assert.equal(pointerProof?.isTrusted, true);
      assert.equal(pointerProof?.pointerType, pointerType);
    }
  }
});

test("desktop sidebar commits the reported Overview to Raid Finder and Shipyard to Mission Control routes", async () => {
  await loadInspectorFixture("/", 1280);
  await waitForExpression("location.pathname === '/' && document.querySelector('nav.hidden a[href=\"/\"][aria-current=\"page\"]') !== null");

  await clickExpression("document.querySelector('nav.hidden a[href=\"/raid-finder\"]')");
  await waitForExpression("location.pathname === '/raid-finder' && document.querySelector('nav.hidden a[href=\"/raid-finder\"][aria-current=\"page\"]') !== null");

  const shipyardRender = await clickSectionAndReadRender("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasOverviewFleets: false,
    path: "/shipyard",
  });
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('nav.hidden a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Fleets"]') === null`);

  await clickExpression("document.querySelector('nav.hidden a[href=\"/mission-control\"]')");
  await waitForExpression("location.pathname === '/mission-control' && document.querySelector('nav.hidden a[href=\"/mission-control\"][aria-current=\"page\"]') !== null");
  await waitForExpression("document.querySelector('main [data-mission-control-page]') !== null");

  await clickExpressionWithTrustedPointer("document.querySelector('nav.hidden a[href=\"/raid-finder\"]')");
  await waitForExpression(`location.pathname === '/raid-finder'
    && document.querySelector('nav.hidden a[href="/raid-finder"][aria-current="page"]') !== null
    && document.querySelector('main [data-raid-target-finder-page]') !== null
    && document.querySelector('main [data-mission-control-page]') === null`);
});

for (const width of [1280, 390]) {
  const layout = width < 768 ? "mobile" : "desktop";

  test(`${layout} Overview to Alliance click commits the route and Alliance UI`, async () => {
    await loadInspectorFixture("/", width, { audioContextFailure: "true" });
    await waitForExpression("location.pathname === '/' && document.querySelector('main section[aria-label=\"Fleets\"]') !== null");

    if (width < 768) {
      await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
      await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
      await clickExpressionWithTrustedPointer("document.querySelector('#mobile-navigation-menu a[href=\"/alliance\"]')", "touch");
    } else {
      await clickExpressionWithTrustedPointer("document.querySelector('nav.hidden a[href=\"/alliance\"]')");
    }

    const activeSelector = width < 768
      ? '#mobile-navigation-menu a[href="/alliance"][aria-current="page"]'
      : 'nav.hidden a[href="/alliance"][aria-current="page"]';
    await waitForExpression(`location.pathname === '/alliance'
      && document.querySelector('${activeSelector}') !== null
      && document.querySelector('main [data-alliance-page]') !== null
      && document.querySelector('main')?.textContent?.includes('Alliance directory') === true
      && document.querySelector('main [aria-label="Create alliance"]') !== null
      && document.querySelector('main section[aria-label="Fleets"]') === null
      ${width < 768 ? "&& document.querySelector('details:has(#mobile-navigation-menu)')?.open === false" : ""}`);

    const result = await evaluate(`({
      interaction: window.inspectorProof.interactions.findLast((event) => event.type === 'pointerdown') ?? null,
      path: location.pathname,
    })`);
    assert.equal(result.path, "/alliance");
    assert.equal(result.interaction?.isTrusted, true);
    assert.equal(result.interaction?.pointerType, width < 768 ? "touch" : "mouse");
    assert.equal(result.interaction?.type, "pointerdown");
  });

  test(`direct Alliance load hydrates game content at ${width}px`, async () => {
    await loadInspectorFixture("/alliance", width, { shell: "settlement" });
    await waitForExpression(`location.pathname === '/alliance'
      && document.querySelector('a[href="/alliance"][aria-current="page"]') !== null
      && document.querySelector('main [data-alliance-page]') !== null
      && document.querySelector('main')?.textContent?.includes('Alliance directory') === true
      && document.querySelector('main')?.textContent?.includes('OPEN THE BOX') === false`);
  });
}

test("direct Mission Control load hydrates before stalled history reads occupy the API pool", async () => {
  await loadInspectorFixture("/mission-control", 390, { stallMissionBackgroundReads: "true" });
  await waitForExpression(`location.pathname === '/mission-control'
    && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
    && document.querySelector('main [data-mission-control-page]') !== null`);

  const requests = await evaluate("window.inspectorProof.requests");
  const overviewIndex = requests.findIndex((request) => request.includes('/overview'));
  const firstHistoryIndex = requests.findIndex((request) => (
    request.includes('/missions?') || request.includes('/missile-attacks?')
  ));
  assert.ok(overviewIndex >= 0, JSON.stringify(requests));
  assert.ok(firstHistoryIndex > overviewIndex, JSON.stringify(requests));
});

for (const width of [390, 1280]) {
  test(`direct Shipyard load hydrates game content at ${width}px`, async () => {
    await loadInspectorFixture("/shipyard", width);
    await waitForExpression(`location.pathname === '/shipyard'
      && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
      && document.querySelector('main [data-production-catalog]') !== null`);
  });

  for (const route of ["infrastructure", "defenses"]) {
    test(`direct ${route} load hydrates game content at ${width}px`, async () => {
      await loadInspectorFixture(`/${route}`, width, { shell: "settlement" });
      await waitForExpression(`location.pathname === '/${route}'
        && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
        && document.querySelector('a[href="/${route}"][aria-current="page"]') !== null
        && document.querySelector('main')?.textContent?.includes('${route === "infrastructure" ? "Metal Mine" : "Rocket Launcher"}') === true
        && document.querySelector('main')?.textContent?.includes('OPEN THE BOX') === false`);
      if (route === "infrastructure") {
        const rendered = await evaluate(`({
          bodyText: document.body.textContent?.replace(/\\s+/g, ' ').trim(),
          errors: window.inspectorProof.errors,
          mainText: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim(),
          requests: window.inspectorProof.requests,
        })`);
        assert.match(rendered.mainText ?? "", /Level 4/);
        assert.match(rendered.bodyText ?? "", /\+620\/h/);
        assert.deepEqual(rendered.errors, []);
      }
    });
  }
}

test("Infrastructure renders its indexed planet snapshot while wallet overview hydration is incomplete", async () => {
  await loadInspectorFixture("/infrastructure", 1280, {
    incompleteOverview: "true",
    shell: "settlement",
    waitForPlanetSelectors: "false",
  });
  await waitForExpression(`location.pathname === '/infrastructure'
    && document.querySelector('main')?.textContent?.includes('Level 4') === true
    && document.querySelector('main')?.textContent?.includes('Infrastructure state unavailable') === false
    && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false`);

  const rendered = await evaluate(`({
    errors: window.inspectorProof.errors,
    requests: window.inspectorProof.requests,
  })`);
  assert.ok(rendered.requests.some((request) => request.includes('/infrastructure')), JSON.stringify(rendered.requests));
  assert.deepEqual(rendered.errors, []);
});

test("mobile Defenses renders its indexed planet snapshot while wallet overview hydration is incomplete", async () => {
  await loadInspectorFixture("/defenses", 390, {
    incompleteOverview: "true",
    shell: "settlement",
    waitForPlanetSelectors: "false",
  });
  try {
    await waitForExpression(`location.pathname === '/defenses'
      && document.querySelector('main')?.textContent?.includes('Rocket Launcher') === true
      && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
      && document.querySelector('summary[title^="Metal:"]') !== null
      && document.querySelector('[data-production-catalog-key="rocketLauncher"]')?.textContent?.includes('Deployed: 3') === true
      && [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build')`);
  } catch (error) {
    const diagnostics = await evaluate(`({
      bodyText: document.body.textContent?.replace(/\\s+/g, ' ').trim(),
      errors: window.inspectorProof.errors,
      mainText: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim(),
      requests: window.inspectorProof.requests,
    })`);
    throw new Error(`${error.message}\nDefenses diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const rendered = await evaluate(`({
    bodyText: document.body.textContent?.replace(/\\s+/g, ' ').trim(),
    errors: window.inspectorProof.errors,
    requests: window.inspectorProof.requests,
  })`);
  assert.ok(rendered.requests.some((request) => request.includes('/defenses')), JSON.stringify(rendered.requests));
  assert.doesNotMatch(rendered.bodyText ?? "", /Resources loading|Syncing planetfall/);
  assert.deepEqual(rendered.errors, []);
});

for (const width of [390, 1280]) {
  test(`established-account gameplay routes escape an incomplete overview snapshot at ${width}px`, async () => {
    await loadInspectorFixture("/", width, {
      incompleteOverview: "true",
      shell: "settlement",
      waitForPlanetSelectors: "false",
    });
    await waitForExpression(`location.pathname === '/'
      && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
      && document.querySelector('main')?.textContent?.includes('Owned Alpha') === true
      && document.querySelector('[data-resource-status="ready"] summary[title^="Metal:"]') !== null
      && window.inspectorProof.requests.some((request) => request.includes('/overview'))
      && window.inspectorProof.requests.some((request) => request.includes('/settlement'))`);

    const initialSnapshot = await evaluate(`({
      overviewRequests: window.inspectorProof.requests.filter((request) => request.includes('/overview')).length,
      resourceValue: document.querySelector('[data-resource-status="ready"] summary[title^="Metal:"] [data-tick-value]')?.dataset.tickValue ?? null,
    })`);
    const routes = [
      {
        path: "/mission-control",
        ready: `document.querySelector('[data-past-tab-panel="mine"]')?.textContent?.includes('No completed missions are visible for this wallet yet.') === true
          && document.querySelector('[data-past-tab-button="all"]')?.textContent?.includes('All (0)') === true
          && document.querySelector('main')?.textContent?.includes('Loading completed missions…') === false`,
      },
      { path: "/galaxy", ready: "document.querySelector('main h2')?.textContent === 'Galaxy'" },
    ];

    for (const route of routes) {
      if (width < 768) {
        await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
        await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
        await clickExpressionWithTrustedPointer(`document.querySelector('#mobile-navigation-menu a[href="${route.path}"]')`, "touch");
      } else {
        await clickExpressionWithTrustedPointer(`document.querySelector('nav.hidden a[href="${route.path}"]')`);
      }
      try {
        await waitForExpression(`location.pathname === '${route.path}'
          && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
          && document.querySelector('[data-resource-status="ready"] summary[title^="Metal:"] [data-tick-value]')?.dataset.tickValue === ${JSON.stringify(initialSnapshot.resourceValue)}
          && ${route.ready}`);
      } catch (error) {
        const diagnostics = await evaluate(`({
          errors: window.inspectorProof.errors,
          mainText: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim(),
          path: location.pathname,
          requests: window.inspectorProof.requests,
        })`);
        throw new Error(`${error.message}\nGameplay hydration diagnostics: ${JSON.stringify(diagnostics)}`);
      }
    }

    const rendered = await evaluate(`({
      errors: window.inspectorProof.errors,
      overviewRequests: window.inspectorProof.requests.filter((request) => request.includes('/overview')).length,
      requests: window.inspectorProof.requests,
      resourceStatus: document.querySelector('[data-resource-status]')?.getAttribute('data-resource-status') ?? null,
      resourceTitle: document.querySelector('[data-resource-status] summary[title^="Metal:"]')?.title ?? null,
      resourceValue: document.querySelector('[data-resource-status] summary[title^="Metal:"] [data-tick-value]')?.dataset.tickValue ?? null,
      syncingPlanetfall: document.querySelector('main')?.textContent?.includes('Syncing planetfall') ?? false,
    })`);
    assert.equal(rendered.overviewRequests, initialSnapshot.overviewRequests, JSON.stringify(rendered.requests));
    assert.ok(rendered.requests.some((request) => request.includes('/settlement')), JSON.stringify(rendered.requests));
    assert.ok(rendered.requests.some((request) => request.includes('/wallet/0x1111111111111111111111111111111111111111/missions?status=completed')), JSON.stringify(rendered.requests));
    assert.ok(rendered.requests.some((request) => request.includes('/wallet/0x1111111111111111111111111111111111111111/missile-attacks?')), JSON.stringify(rendered.requests));
    assert.ok(rendered.requests.some((request) => request.includes('/missions?status=completed') && request.includes('summaryOnly=true')), JSON.stringify(rendered.requests));
    assert.equal(rendered.resourceStatus, "ready");
    assert.match(rendered.resourceTitle ?? "", /^Metal: 10,313\b/);
    assert.equal(rendered.resourceValue, initialSnapshot.resourceValue);
    assert.equal(rendered.syncingPlanetfall, false);
    assert.deepEqual(rendered.errors, []);
  });
}

test("desktop Overview to Shipyard click atomically replaces the rendered page", async () => {
  await loadInspectorFixture("/", 1280);
  await waitForExpression("location.pathname === '/' && document.querySelector('main section[aria-label=\"Fleets\"]') !== null");

  const shipyardRender = await clickSectionAndReadRender("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasOverviewFleets: false,
    path: "/shipyard",
  });
  await waitForExpression(`document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Fleets"]') === null`);
});

test("wallet shell does not let a repeated account event interrupt the Build gesture", async () => {
  await loadInspectorFixture("/", 1280, {
    shell: "settlement",
    walletEventOnPointerDown: "accountsChanged",
  });
  await clickExpression("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  await waitForExpression(`location.pathname === '/shipyard'
    && [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build' && !button.disabled)`);

  await clickExpressionWithTrustedPointer(
    "[...document.querySelectorAll('main button')].find((button) => button.textContent?.trim() === 'Build' && !button.disabled)",
  );
  await waitForExpression("window.inspectorProof.walletRequests.some((request) => request.method === 'eth_sendTransaction')");
  await delay(100);

  const result = await evaluate(`({
    buildVisible: [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build'),
    path: location.pathname,
    syncingPlanetfall: document.body.textContent?.includes('Syncing planetfall') ?? false,
  })`);
  assert.deepEqual(result, {
    buildVisible: true,
    path: "/shipyard",
    syncingPlanetfall: false,
  });
});

test("wallet shell does not let a repeated chain event interrupt the Build gesture", async () => {
  await loadInspectorFixture("/", 1280, {
    shell: "settlement",
    walletEventOnPointerDown: "chainChanged",
  });
  await clickExpression("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  await waitForExpression(`location.pathname === '/shipyard'
    && [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build' && !button.disabled)`);

  await clickExpressionWithTrustedPointer(
    "[...document.querySelectorAll('main button')].find((button) => button.textContent?.trim() === 'Build' && !button.disabled)",
  );
  await waitForExpression("window.inspectorProof.walletRequests.some((request) => request.method === 'eth_sendTransaction')");
  await delay(100);

  const result = await evaluate(`({
    buildVisible: [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build'),
    path: location.pathname,
    syncingPlanetfall: document.body.textContent?.includes('Syncing planetfall') ?? false,
  })`);
  assert.deepEqual(result, {
    buildVisible: true,
    path: "/shipyard",
    syncingPlanetfall: false,
  });
});

for (const width of [1280, 390]) {
  test(`${width < 768 ? "mobile" : "desktop"} Small Cargo Build reaches the wallet after Shipyard navigation`, async () => {
    await loadInspectorFixture("/", width);
    if (width < 768) {
      await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
      await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
      await clickExpression("document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"]')");
    } else {
      await clickExpression("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
    }
    await waitForExpression(`location.pathname === '/shipyard'
      && [...document.querySelectorAll('main button')].some((button) => button.textContent?.trim() === 'Build' && !button.disabled)`);

    await clickExpressionWithTrustedPointer(
      "[...document.querySelectorAll('main button')].find((button) => button.textContent?.trim() === 'Build' && !button.disabled)",
      width < 768 ? "touch" : "mouse",
    );
    try {
      await waitForExpression("window.inspectorProof.walletRequests.some((request) => request.method === 'eth_sendTransaction')");
    } catch (error) {
      const diagnostics = await evaluate(`({
        buildButtons: [...document.querySelectorAll('main button')]
          .filter((button) => button.textContent?.trim() === 'Build')
          .map((button) => ({ disabled: button.disabled, outerHTML: button.outerHTML })),
        errors: window.inspectorProof.errors,
        mainText: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 3000),
        path: location.pathname,
        requests: window.inspectorProof.requests.slice(-20),
        walletRequests: window.inspectorProof.walletRequests,
      })`);
      throw new Error(`${error.message}\nBuild diagnostics: ${JSON.stringify(diagnostics)}`);
    }

    const result = await evaluate(`(() => {
      const request = window.inspectorProof.walletRequests.find((candidate) => candidate.method === 'eth_sendTransaction');
      return {
        data: request?.params?.[0]?.data ?? null,
        from: request?.params?.[0]?.from ?? null,
        interaction: window.inspectorProof.interactions.findLast((event) => event.type === 'pointerdown' && event.target === 'button:Build') ?? null,
        path: location.pathname,
        syncingPlanetfall: document.querySelector('main')?.textContent?.includes('Syncing planetfall') ?? false,
        to: request?.params?.[0]?.to ?? null,
      };
    })()`);
    assert.deepEqual(result, {
      data: "0x13aed9a2" + "0".repeat(63) + "1" + "0".repeat(64) + "0".repeat(63) + "1",
      from: "0x1111111111111111111111111111111111111111",
      interaction: {
        isTrusted: true,
        pointerType: width < 768 ? "touch" : "mouse",
        target: "button:Build",
        type: "pointerdown",
      },
      path: "/shipyard",
      syncingPlanetfall: false,
      to: "0x2222222222222222222222222222222222222222",
    });
  });
}

test("mobile sidebar first clicks commit routes and close the menu", async () => {
  await loadInspectorFixture("/planet/9/9/9", 390);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");

  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  await clickExpression("document.querySelector('#mobile-navigation-menu a[href=\"/infrastructure\"]')");
  await waitForExpression("location.pathname === '/infrastructure' && document.querySelector('#mobile-navigation-menu a[href=\"/infrastructure\"][aria-current=\"page\"]') !== null && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false");

  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  const shipyardRender = await clickSectionAndReadRender("document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasOverviewFleets: false,
    path: "/shipyard",
  });
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('#mobile-navigation-menu a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Fleets"]') === null`);

  await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  await clickExpressionWithTrustedPointer("document.querySelector('#mobile-navigation-menu a[href=\"/mission-control\"]')", "touch");
  await waitForExpression(`location.pathname === '/mission-control'
    && document.querySelector('main [data-mission-control-page]') !== null
    && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false`);

  await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  await clickExpressionWithTrustedPointer("document.querySelector('#mobile-navigation-menu a[href=\"/raid-finder\"]')", "touch");
  await waitForExpression(`location.pathname === '/raid-finder'
    && document.querySelector('#mobile-navigation-menu a[href="/raid-finder"][aria-current="page"]') !== null
    && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false
    && document.querySelector('main [data-raid-target-finder-page]') !== null
    && document.querySelector('main [data-mission-control-page]') === null`);
});

test("owned deep links and real back-forward events never expose owned controls under an unrelated identity", async () => {
  await loadInspectorFixture("/planet/1/2/3", 1280);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Owned Alpha'");
  assert.match((await inspectorSnapshot()).text, /Home world/);

  await evaluate(`(() => {
    history.pushState({ proof: 'unrelated' }, '', '/planet/9/9/9');
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  })()`);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");
  let snapshot = await inspectorSnapshot();
  assert.equal(snapshot.path, "/planet/9/9/9");
  assert.doesNotMatch(snapshot.text, /Add media|Home world|Owned Alpha Public/);
  assert.match(snapshot.text, /Occupied public world|Unrelated Gamma/);

  await evaluate("history.back()");
  await waitForExpression("location.pathname === '/planet/1/2/3' && document.querySelector('main h2')?.textContent === 'Owned Alpha'");
  snapshot = await inspectorSnapshot();
  assert.match(snapshot.text, /Add media/);
  assert.match(snapshot.text, /Home world/);

  await evaluate("history.forward()");
  await waitForExpression("location.pathname === '/planet/9/9/9' && document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");
  snapshot = await inspectorSnapshot();
  assert.doesNotMatch(snapshot.text, /Add media|Home world|Owned Alpha Public/);
});

for (const kind of ["planet", "moon"]) {
  test(`late ${kind} detail responses cannot replace the currently rendered body`, async () => {
    await loadInspectorFixture("/planet/9/9/9", 1280);
    await evaluate(`window.inspectorProof.beginDetailRace('${kind}')`);
    await waitForExpression("JSON.stringify(window.inspectorProof.pendingDetailRequests()) === JSON.stringify(['7:1', '8:2'])");

    await evaluate("window.inspectorProof.resolveDetailRequest('8:2')");
    const expectedHeading = kind === "moon" ? "Moon" : "Current Planet";
    await waitForExpression(`document.querySelector('#app h2')?.textContent === '${expectedHeading}'`);
    let text = await evaluate("document.querySelector('#app')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''");
    assert.match(text, kind === "moon" ? /8,002|8,003|8,004/ : /8,002|8,003|8,004|Level 8/);
    assert.doesNotMatch(text, /Stale|7,001|7,002|7,003/);

    await evaluate("window.inspectorProof.resolveDetailRequest('7:1')");
    await delay(100);
    text = await evaluate("document.querySelector('#app')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''");
    assert.match(text, new RegExp(expectedHeading));
    assert.match(text, /8,002|8,003|8,004/);
    assert.doesNotMatch(text, /Stale|7,001|7,002|7,003/);
  });
}
