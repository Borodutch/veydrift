import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";
import { PLANET_ANIMATION_VERSION } from "../planetAnimationConfig.ts";

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
let recoveryFixtureUrl;
let server;
let routeChunkGate;
let gatedRouteChunkRequests = [];

const INSPECTOR_APP_READY_TIMEOUT_MS = 30_000;
const INSPECTOR_PRELOAD_TIMEOUT_MS = 120_000;

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
      const pageTarget = targets.find((target) => target.type === "page" && (!expectedTargetId || target.id === expectedTargetId) && target.webSocketDebuggerUrl);
      if (pageTarget) return pageTarget;
    } catch {
      // DevTools can advertise its browser socket just before the target list is ready.
    }
    await delay(25);
  }
  throw new Error(expectedTargetId ? `Chrome did not expose page target ${expectedTargetId}.` : "Chrome did not expose a page target.");
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
  chrome = spawn(
    executable,
    ["--headless=new", "--use-mock-keychain", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${chromeProfile}`, "about:blank"],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

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
  devToolsTargetsUrl = browserWebSocketUrl.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "/json/list");
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
  const diagnostics = await evaluate(`({ path: location.pathname, main: document.querySelector('main')?.innerText.slice(0, 1500), errors: window.inspectorProof?.errors, requests: window.inspectorProof?.requests?.slice(-10), pendingDetailRequests: window.inspectorProof?.pendingDetailRequests?.() })`).catch(() => null);
  throw new Error(`Timed out waiting for browser expression: ${expression}\n${JSON.stringify(diagnostics)}`);
}

async function loadFixture(query = "") {
  await cdp.send("Page.navigate", { url: fixtureUrl + query });
  await waitForExpression("window.touchProofReady === true");
}

async function preloadInspectorFixture() {
  // A focused --test-name-pattern invocation reaches the inspector with a cold
  // Vite module graph. Keep that one-time transform/crawl cost outside each
  // scenario's app-ready deadline, and do not continue until the full fixture
  // has executed in Chrome and Vite has finished processing its static imports.
  // A fresh page target then discards this app instance and its input/timer
  // state while retaining Vite's transformed graph and the browser cache.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 900,
    mobile: false,
    width: 1280,
  });
  await cdp.send("Page.navigate", {
    url: `${inspectorFixtureUrl}?${new URLSearchParams({
      incompleteOverview: "true",
      route: "/",
      shell: "settlement",
    })}`,
  });
  try {
    await waitForExpression("window.inspectorProof?.appReady === true", INSPECTOR_PRELOAD_TIMEOUT_MS);
  } catch (error) {
    const diagnostics = await evaluate(`({
      body: document.body?.innerText.slice(0, 2000),
      errors: window.inspectorProof?.errors,
      path: location.pathname,
      readyState: document.readyState,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name).slice(-20),
      url: location.href,
    })`).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    throw new Error(`${error.message}\nInspector preload diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  await server.waitForRequestsIdle();
  await replacePageTarget();
}

before(async () => {
  server = await createServer({ cacheDir: `node_modules/.vite-browser/planetPickerTouchBrowser${(process.env.BROWSER_TEST_SHARD ?? "").replace("/", "-of-")}`,
    logLevel: "error",
    root: new URL("..", import.meta.url).pathname,
    // Fixture stores and mocked requests must not depend on a developer's .env.local.
    define: { "import.meta.env.VITE_VEYDRIFT_API_URL": JSON.stringify("/local-api") },
    plugins: [{
      name: "browser-proof-route-gate",
      configureServer(vite) {
        vite.middlewares.use((request, _response, next) => {
          if (routeChunkGate && /\/components\/(MissionControlPage|ShipyardPage)\.tsx(?:\?|$)/.test(request.url ?? "")) {
            gatedRouteChunkRequests.push(request.url);
            void routeChunkGate.then(() => next());
          } else next();
        });
      },
    }],
    server: {
      host: "127.0.0.1",
      port: await freePort(),
      strictPort: true,
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a browser-test port.");
  }
  fixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/planetPickerTouchBrowser.html`;
  inspectorFixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/planetInspectorBrowser.html`;
  recoveryFixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/pendingTransactionRecoveryBrowser.html`;

  cdp = await launchChrome();
  await configurePageTarget(cdp);
  await preloadInspectorFixture();
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 720,
    mobile: true,
    width: 390,
  });
  await loadFixture("?noHold");
});

after(async () => {
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    await Promise.race([browserCdp?.send("Browser.close").catch(() => undefined), delay(1_000)]);
    await Promise.race([exited, delay(3_000)]);
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
    touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ force: 1, id: 1, radiusX: 4, radiusY: 4, x, y }],
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
    await dispatchTouch("touchMove", axis === "x" ? x - offset : x, axis === "y" ? y - offset : y);
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

  await loadFixture("?noHold");
  center = await planetCenter();
  await dispatchTouch("touchStart", center.x, center.y);
  await delay(30);
  await moveTouch(center.x, center.y, "x");
  await dispatchTouch("touchEnd", center.x - 105, center.y);
  await delay(250);

  const horizontalScrollState = await proofState();
  assert.equal(horizontalScrollState.activations, 0);
  assert.equal(horizontalScrollState.preventedTouchMoves, 0);
  assert.ok(horizontalScrollState.scrollLeft > 0, `expected native horizontal scroll, got scrollLeft=${horizontalScrollState.scrollLeft}`);

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
  assert.ok(reorderState.preventedTouchMoves > 0, `expected cancelled touchmove after activation: ${JSON.stringify(reorderState)}`);
  assert.ok(reorderState.pointerMovesAfterActivation > 0, `expected pointermove after activation: ${JSON.stringify(reorderState)}`);
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
    await waitForExpression("window.inspectorProof?.appReady === true", INSPECTOR_APP_READY_TIMEOUT_MS);
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

function missionConfirmExpression(disabled) {
  return `[...document.querySelectorAll('[data-mission-actions] button')].find(button => button.textContent.trim() === 'Confirm Mission' && button.disabled === ${disabled})`;
}

function raidFinderAttackExpression(coordinates) {
  return `[...document.querySelectorAll('[data-raid-target-finder-page] button[aria-label="Attack"]')].find(button => button.closest('[class*="grid-cols-"]')?.querySelector('button[title="Open [${coordinates}]"]'))`;
}

async function loadRecoveryFixture() {
  await replacePageTarget();
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 720,
    mobile: false,
    width: 1024,
  });
  await cdp.send("Page.navigate", { url: recoveryFixtureUrl });
  await waitForExpression("window.recoveryProofReady === true");
}

async function pressTab(shiftKey = false) {
  const modifiers = shiftKey ? 8 : 0;
  await cdp.send("Input.dispatchKeyEvent", {
    code: "Tab",
    key: "Tab",
    modifiers,
    nativeVirtualKeyCode: 9,
    type: "keyDown",
    windowsVirtualKeyCode: 9,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    code: "Tab",
    key: "Tab",
    modifiers,
    nativeVirtualKeyCode: 9,
    type: "keyUp",
    windowsVirtualKeyCode: 9,
  });
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
  // Press only where the target itself is hit: right after a history traversal the list
  // re-renders, and a press measured on the outgoing node lands on nothing.
  let center;
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(50);
    center = await evaluate(`(() => {
      const target = ${expression};
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      return { x, y, hit: target.contains(document.elementFromPoint(x, y)) };
    })()`);
    if (center?.hit) break;
  }
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
      hasEmpire: document.querySelector('main section[aria-label="Empire"]') !== null,
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

for (const width of [390, 1280]) {
  test(`planet Mission activity identifies own returns across navigation at ${width}px`, async () => {
    await loadInspectorFixture("/planet/1/2/3", width, { activeMission: "true", returningRaid: "true" });
    const row = "[...document.querySelectorAll('a')].find(a => a.textContent.includes('#777'))";
    await waitForExpression(`${row}?.textContent.includes('Inbound · Own Attack returning')`);
    assert.equal(await evaluate(`${row}?.querySelector('.text-rose-300') !== null`), false);
    for (const [path, label] of [
      ["/planet/9/9/9", "Outbound · Third-party Attack returning"],
      ["/planet/1/2/3", "Inbound · Own Attack returning"],
    ]) {
      await evaluate(`history.pushState({}, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate"))`);
      await waitForExpression(`${row}?.textContent.includes(${JSON.stringify(label)})`);
    }
    const bounds = await evaluate(`(() => { const r = (${row}).getBoundingClientRect(); return {left:r.left, right:r.right}; })()`);
    assert.ok(bounds.left >= 0 && bounds.right <= width, JSON.stringify(bounds));
    assert.deepEqual(await evaluate("window.inspectorProof.errors"), []);
  });
}

test("planet switches show balances and production together and retain cached resources during refresh", async () => {
  await loadInspectorFixture("/", 1280, { shell: "settlement" });
  const metalTitle = "document.querySelector('[data-resource=\"M\"] summary')?.title";
  await waitForExpression(`${metalTitle}?.startsWith('Metal: 10,313')`);
  const alphaTitle = await evaluate(metalTitle);
  await evaluate(`(() => {
    const fetch = window.fetch;
    window.resourceSwitch = { release: null, waiting: false, hold: true };
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.origin);
      if (!url.pathname.endsWith('/infrastructure') || url.searchParams.get('planetId') !== '102') return fetch(...args);
      if (window.resourceSwitch.hold) {
        window.resourceSwitch.waiting = true;
        await new Promise(resolve => { window.resourceSwitch.release = resolve; });
      }
      const data = await (await fetch(...args)).json();
      // Deliberately differ from the roster, which must not publish a partial header.
      data.resourcesAsOfNow = { metal: '1203', crystal: '1201', deuterium: '1202' };
      data.productionPerHour = { metal: '920', crystal: '338', deuterium: '171' };
      return Response.json(data);
    };
  })()`);
  const select = (id) => clickExpression(`document.querySelector('aside[aria-label="Select planet"] [data-planet-selector-item="${id}"] button[data-planet-selector-long-press]')`);
  await select("102");
  await waitForExpression("window.resourceSwitch.waiting && document.querySelector('[data-resource-status]')?.dataset.resourceStatus === 'loading'");
  assert.equal(await evaluate(metalTitle), undefined, "must not display roster balances with missing production");
  for (const width of [390, 768, 1280]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    const skeleton = await evaluate(`(() => {
      const bar = document.querySelector('[data-resource-status]');
      const blocks = [...bar.querySelectorAll('.skeleton')];
      const copy = bar.cloneNode(true);
      copy.querySelectorAll('.sr-only').forEach(node => node.remove());
      return {
        count: blocks.length,
        busy: bar.querySelector('[role="status"]')?.getAttribute('aria-busy'),
        fits: blocks.filter(node => node.offsetWidth > 0).every(node => { const rect = node.getBoundingClientRect(); return rect.width <= 56 && rect.left >= 0 && rect.right <= innerWidth; }),
        text: copy.textContent,
      };
    })()`);
    assert.equal(skeleton.count, 8);
    assert.equal(skeleton.busy, "true");
    assert.equal(skeleton.fits, true, `resource skeletons must fit at ${width}px`);
    assert.doesNotMatch(skeleton.text, /loading|syncing/i);
  }
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-resource-status] .skeleton')).animationName"), "none");
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  await evaluate("window.resourceSwitch.hold = false; window.resourceSwitch.release()");
  await waitForExpression(`${metalTitle}?.startsWith('Metal: 1,203')`);
  const betaTitle = await evaluate(metalTitle);
  assert.match(betaTitle, /920/);

  await select("101");
  await waitForExpression(`${metalTitle} === ${JSON.stringify(alphaTitle)}`);
  await evaluate("window.resourceSwitch.hold = true; window.resourceSwitch.waiting = false");
  await evaluate(`(async () => {
    const url = performance.getEntriesByType('resource').map(r => r.name).find(name => name.includes('/src/backendDataStore.ts'));
    const { backendDataStoreFor } = await import(url);
    void backendDataStoreFor('/local-api').invalidate(['planet:102']);
  })()`);
  await select("102");
  await waitForExpression(`${metalTitle} === ${JSON.stringify(betaTitle)}`);
  await waitForExpression("window.resourceSwitch.waiting");
  assert.equal(await evaluate(metalTitle), betaTitle, "a background refresh must retain both cached values");
  // A late response for B must not change A's displayed resources.
  await select("101");
  await waitForExpression(`${metalTitle} === ${JSON.stringify(alphaTitle)}`);
  await evaluate("window.resourceSwitch.hold = false; window.resourceSwitch.release()");
  await delay(100);
  assert.equal(await evaluate(metalTitle), alphaTitle);
});

for (const width of [390, 1440]) {
  test(`home labels stay authoritative outside the selector while selecting home and two colonies at ${width}px`, { timeout: 60_000 }, async () => {
    await loadInspectorFixture("/planet/1/2/3", width, { homeIdentityProbe: "true" });
    await waitForExpression("document.querySelector('main h2')?.textContent === 'Owned Alpha'");
    assert.match((await inspectorSnapshot()).text, /Home world/);

    // On mobile the planet picker is the always-visible strip beside the menu toggle.
    const selector = width < 768 ? 'details:has(#mobile-navigation-menu) ~ div' : 'aside[aria-label="Select planet"]';
    const nav = width < 768 ? '#mobile-navigation-menu nav' : 'nav.hidden';
    async function openMenu() {
      if (width >= 768) return;
      // Synthetic route clicks can leave the menu open until its deferred close.
      if (!await evaluate("document.querySelector('details:has(#mobile-navigation-menu)')?.open")) {
        await clickExpression(`document.querySelector('summary[aria-controls="mobile-navigation-menu"]')`);
      }
      await waitForExpression(`document.querySelector('details:has(#mobile-navigation-menu)')?.open === true
        && document.querySelector('summary[aria-controls="mobile-navigation-menu"]')?.getAttribute('aria-expanded') === 'true'
        && document.querySelector('#mobile-navigation-menu')?.getBoundingClientRect().height > 0`);
    }
    for (const [id, name, route] of [
      ["102", "Owned Beta", "/planet/4/5/6"],
      ["103", "Owned Delta", "/planet/1/2/4"],
      ["101", "Owned Alpha", "/planet/1/2/3"],
    ]) {
      // The mobile planet strip is always visible, so no menu needs opening before picking a planet.
      await clickExpression(`document.querySelector('${selector} [data-planet-selector-item="${id}"] button[data-planet-selector-long-press]')`);
      await waitForExpression(`location.pathname === '${route}' && document.querySelector('main h2')?.textContent === '${name}'`);
      assert.equal(/Home world/.test((await inspectorSnapshot()).text), id === "101");
      assert.equal(await evaluate(`document.querySelector('${selector} button[data-planet-selector-long-press][aria-current="true"]')?.dataset.planetSelectorLongPress`), id);
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${selector} [data-planet-selector-item]')).filter(node => [...node.querySelectorAll('span')].some(span => span.textContent.trim() === 'Home')).map(node => node.dataset.planetSelectorItem)`), []);

      await openMenu();
      await clickExpression(`document.querySelector('${nav} a[href="/galaxy"]')`);
      await waitForExpression(`document.querySelector('main button[aria-label="Open ${name}"]') !== null`);
      const rows = await evaluate(`Array.from(document.querySelectorAll('main button[aria-label^="Open Owned"]')).map(button => {
        const row = button.closest('div.group');
        return { name: button.getAttribute('aria-label').slice(5), home: [...row.querySelectorAll('span')].some(span => span.textContent.trim() === 'Home'), transport: [...row.querySelectorAll('button')].some(button => button.getAttribute('aria-label')?.startsWith('Transport') && !button.closest('[data-watchable-moon-row]')) };
      })`);
      assert.ok(rows.length > 0);
      for (const row of rows) {
        assert.equal(row.home, row.name === "Owned Alpha", JSON.stringify(rows));
        assert.equal(row.transport, row.name !== name, "Transport must follow launch origin, not HOME identity: " + JSON.stringify(rows));
      }
      assert.deepEqual(await evaluate("window.inspectorProof.walletRequests.filter(request => request.method === 'eth_sendTransaction')"), []);
      // Galaxy selection stays inline; reopen the inspector before the next switch.
      await clickExpression(`document.querySelector('main button[aria-label="Open ${name}"]')`);
      await waitForExpression(`location.pathname === '${route}' && document.querySelector('main h2')?.textContent === '${name}'`);
      await openMenu();
      await clickExpression(`document.querySelector('${nav} a[href="/rankings"]')`);
      await waitForExpression("document.querySelector('main button[aria-label=\"Show planets and moons for Fixture Commander\"]') !== null");
      await clickExpressionWithTrustedPointer(`document.querySelector('main button[aria-label="Show planets and moons for Fixture Commander"]')`, width < 768 ? "touch" : "mouse");
      await waitForExpression("document.querySelectorAll('main [data-ranking-planet-row]').length === 3");
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('main [data-ranking-planet-row]')).filter(row => row.textContent.includes('[HOME]')).map(row => row.dataset.rankingPlanetRow)`), ["101"]);
      await clickExpression(`document.querySelector('main [data-ranking-planet-row="${id}"] button')`);
      await waitForExpression(`location.pathname === '${route}' && document.querySelector('main h2')?.textContent === '${name}'`);
    }
    // Fresh route hydration cannot badge a colony, even before selector interaction.
    await loadInspectorFixture("/planet/1/2/4", width, { homeIdentityProbe: "true" });
    await waitForExpression("document.querySelector('main h2')?.textContent?.includes('Owned Delta') === true");
    assert.doesNotMatch((await inspectorSnapshot()).text, /Home world/);
  });
}

test("desktop sidebar first clicks commit Infrastructure and Shipyard routes", async () => {
  await loadInspectorFixture("/planet/9/9/9", 1280);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");

  await clickExpression("document.querySelector('nav.hidden a[href=\"/infrastructure\"]')");
  await waitForExpression("location.pathname === '/infrastructure' && document.querySelector('nav.hidden a[href=\"/infrastructure\"][aria-current=\"page\"]') !== null");

  const shipyardRender = await clickSectionAndReadRender("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasEmpire: false,
    path: "/shipyard",
  });
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('nav.hidden a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Empire"]') === null`);
});

for (const width of [1280, 390]) {
  const layout = width < 768 ? "mobile" : "desktop";

  test(`${layout} Overview to Alliance click commits the route and Alliance UI`, async () => {
    await loadInspectorFixture("/", width, { audioContextFailure: "true" });
    await waitForExpression("location.pathname === '/' && document.querySelector('main section[aria-label=\"Empire\"]') !== null");

    if (width < 768) {
      await clickExpressionWithTrustedPointer("document.querySelector('summary[aria-label=\"Open navigation menu\"]')", "touch");
      await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
      await clickExpressionWithTrustedPointer("document.querySelector('#mobile-navigation-menu a[href=\"/alliance\"]')", "touch");
    } else {
      await clickExpressionWithTrustedPointer("document.querySelector('nav.hidden a[href=\"/alliance\"]')");
    }

    const activeSelector = width < 768 ? '#mobile-navigation-menu a[href="/alliance"][aria-current="page"]' : 'nav.hidden a[href="/alliance"][aria-current="page"]';
    await waitForExpression(`location.pathname === '/alliance'
      && document.querySelector('${activeSelector}') !== null
      && document.querySelector('main [data-alliance-page]') !== null
      && document.querySelector('main')?.textContent?.includes('Alliance directory') === true
      && document.querySelector('main [aria-label="Create alliance"]') !== null
      && document.querySelector('main section[aria-label="Empire"]') === null
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

for (const width of [390, 1280]) {
  test(`direct Shipyard load hydrates game content at ${width}px`, async () => {
    await loadInspectorFixture("/shipyard", width);
    await waitForExpression(`location.pathname === '/shipyard'
      && document.querySelector('main')?.textContent?.includes('Syncing planetfall') === false
      && document.querySelector('main [data-production-catalog]') !== null`);
  });

  test(`direct Research load settles its canonical state once at ${width}px`, async () => {
    await loadInspectorFixture("/research", width, { shell: "settlement" });
    await waitForExpression(`location.pathname === '/research'
      && document.querySelector('main')?.textContent?.includes('Loading research state') === false
      && document.querySelector('main')?.textContent?.includes('Energy Technology') === true`);

    await new Promise((resolve) => setTimeout(resolve, 250));
    const rendered = await evaluate(`({
      errors: window.inspectorProof.errors,
      researchRequests: window.inspectorProof.requests.filter((request) => request.includes('/research')).length,
      text: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim(),
    })`);
    assert.equal(rendered.researchRequests, 1, JSON.stringify(rendered));
    assert.deepEqual(rendered.errors, []);
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
        await new Promise((resolve) => setTimeout(resolve, 250));
        const rendered = await evaluate(`({
          bodyText: document.body.textContent?.replace(/\\s+/g, ' ').trim(),
          errors: window.inspectorProof.errors,
          mainText: document.querySelector('main')?.textContent?.replace(/\\s+/g, ' ').trim(),
          requests: window.inspectorProof.requests,
        })`);
        assert.match(rendered.mainText ?? "", /Level 4/);
        assert.match(rendered.bodyText ?? "", /\+620\/h/);
        assert.ok(rendered.requests.filter((request) => request.includes("/infrastructure")).length <= 2, JSON.stringify(rendered));
        assert.ok(rendered.requests.filter((request) => request.includes("/moon")).length <= 2, JSON.stringify(rendered));
        assert.deepEqual(rendered.errors, []);
      }
    });
  }
}

for (const outcome of ["not-submitted", "reverted"]) {
  test(`${outcome} Infrastructure start never fabricates construction`, async () => {
    await loadInspectorFixture("/infrastructure", 1280, { shell: "settlement" });
    const result = await evaluate(`(async () => {
      const url = performance.getEntriesByType('resource').map(r => r.name).find(name => name.includes('/src/backendDataStore.ts'));
      const { backendDataStoreFor } = await import(url);
      const store = backendDataStoreFor('/local-api');
      window.inspectorProof.setConstructionPhase('reverted');
      const result = await store.runWriteTransaction({
        key: 'building:start:deuteriumSynthesizer', label: 'Building upgrade', chainId: '0x2105',
        invalidateTags: ['wallet:' + window.inspectorProof.account, 'planet:101'],
        send: async beforeSend => {
          if (${JSON.stringify(outcome)} === 'not-submitted') throw new Error('Preflight failed');
          beforeSend(); return '0xconstruction';
        },
        indexing: store.indexing.production(window.inspectorProof.account, '101', 'infrastructure'),
      });
      await store.invalidate(['wallet:' + window.inspectorProof.account]);
      return { outcome: result.outcome, pending: store.isTransactionPending(window.inspectorProof.account) };
    })()`);
    assert.deepEqual(result, { outcome, pending: false });
    assert.equal(await evaluate(`document.querySelector('main [aria-label="Construction: Deuterium Synth 3"]') !== null`), false);
    assert.equal(await evaluate(`document.querySelector('[data-planet-selector-progress="building"]') !== null`), false);
    assert.deepEqual(await evaluate("window.inspectorProof.errors"), []);
  });
}

test("Infrastructure Supply opens for the current planet with its exact missing resources prefilled", async () => {
  await loadInspectorFixture("/infrastructure", 1280, {
    shell: "settlement",
    shortResources: "true",
  });
  await waitForExpression(`location.pathname === '/infrastructure'
    && document.querySelector('main button[aria-label^="Supply missing resources for"]') !== null`);

  const actionLayout = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('main button')];
    const upgrade = buttons.find((button) => button.textContent?.trim() === 'Upgrade Level 5');
    const supply = document.querySelector('main button[aria-label^="Supply missing resources for"]');
    const upgradeRect = upgrade?.getBoundingClientRect();
    const supplyRect = supply?.getBoundingClientRect();
    return {
      supplyLeft: Math.round(supplyRect?.left ?? -1),
      supplySizeDelta: Math.abs((supplyRect?.width ?? -1) - (supplyRect?.height ?? -1)),
      supplyText: supply?.textContent?.trim(),
      supplyWidth: Math.round(supplyRect?.width ?? -1),
      upgradeRight: Math.round(upgradeRect?.right ?? -1),
      upgradeWidth: Math.round(upgradeRect?.width ?? -1),
    };
  })()`);
  assert.equal(actionLayout.supplyText, "");
  assert.ok(actionLayout.supplyLeft >= actionLayout.upgradeRight, JSON.stringify(actionLayout));
  assert.ok(actionLayout.supplySizeDelta <= 1, JSON.stringify(actionLayout));
  assert.ok(actionLayout.supplyWidth < actionLayout.upgradeWidth, JSON.stringify(actionLayout));

  await clickExpression("document.querySelector('main button[aria-label^=\"Supply missing resources for\"]')");
  await waitForExpression("document.querySelector('[role=dialog][aria-label=\"Supply Owned Alpha\"]') !== null");
  const request = await evaluate(`({
    crystal: document.querySelector('input[aria-label="crystal to send"]')?.value,
    deuterium: document.querySelector('input[aria-label="deuterium to send"]')?.value,
    metal: document.querySelector('input[aria-label="metal to send"]')?.value,
  })`);
  assert.deepEqual(request, { crystal: "25", deuterium: "", metal: "110" });
});

for (const body of ["planet", "moon"]) {
  test(`${body} Shipyard and Defenses add to one real mounted build plan without an early wallet send`, async () => {
    const moon = body === "moon";
    await loadInspectorFixture(moon ? "/" : "/shipyard", 390, {
      batchPlanProbe: "true", moonOverview: "true", shell: "settlement",
    });
    if (moon) {
      await waitForExpression(`document.querySelector('main section[aria-label="Empire"] button[title="Select Moon"]') !== null`);
      await clickExpression(`document.querySelector('main section[aria-label="Empire"] button[title="Select Moon"]')`);
      await waitForExpression(`document.querySelector('main section[aria-label="Empire"] [aria-current="true"][data-body-kind="moon"]') !== null`);
      await clickExpression('document.querySelector(\'summary[aria-label="Open navigation menu"]\')');
      await clickExpression('document.querySelector(\'#mobile-navigation-menu a[href="/moon"]\')');
      await waitForExpression(`location.pathname === '/moon' && document.querySelector('main [data-production-catalog]') !== null`);
    }
    const addShip = 'main button[aria-label="Add Small Cargo to build plan"]:not(:disabled)';
    const addDefense = 'main button[aria-label="Add Rocket Launcher to build plan"]:not(:disabled)';
    await waitForExpression(`document.querySelector(${JSON.stringify(addShip)}) !== null`);
    await clickExpression(`document.querySelector(${JSON.stringify(addShip)})`);
    await waitForExpression(`document.querySelector('main [data-build-plan][aria-label="${body} build plan"] button[aria-label="Remove Small Cargo from build plan"]') !== null`);
    if (!moon) {
      await clickExpression('document.querySelector(\'summary[aria-label="Open navigation menu"]\')');
      await clickExpression('document.querySelector(\'#mobile-navigation-menu a[href="/defenses"]\')');
      await waitForExpression(`location.pathname === '/defenses' && document.querySelector('main [data-build-plan] button[aria-label="Remove Small Cargo from build plan"]') !== null`);
    }
    await waitForExpression(`document.querySelector(${JSON.stringify(addDefense)}) !== null`);
    await clickExpression(`document.querySelector(${JSON.stringify(addDefense)})`);
    await waitForExpression(`document.querySelectorAll('main [data-build-plan] button[aria-label^="Remove "]').length === 2`);
    assert.equal(await evaluate(`document.querySelectorAll('main [data-build-plan]').length`), 1);
    const countIs = count => `document.querySelector('main [aria-label="Build plan ${count} of 15 orders"]')?.textContent === '${count}/15'`;
    await waitForExpression(countIs(2));
    for (let count = 3; count <= 15; count++) {
      await clickExpression(`document.querySelector(${JSON.stringify(addDefense)})`);
      await waitForExpression(countIs(count));
    }
    assert.equal(await evaluate(`document.querySelector('main button[aria-label="Add Rocket Launcher to build plan"]')?.disabled`), true);
    await evaluate(`document.querySelector('main button[aria-label="Add Rocket Launcher to build plan"]').click()`);
    assert.equal(await evaluate(countIs(15)), true, "disabled sixteenth Add preserves 15 rows");
    await clickExpression(`document.querySelector('main button[aria-label="Remove Rocket Launcher from build plan"]')`);
    await waitForExpression(countIs(14));
    await waitForExpression(`document.querySelector(${JSON.stringify(addDefense)}) !== null`);
    await clickExpression(`document.querySelector(${JSON.stringify(addDefense)})`);
    await waitForExpression(countIs(15));
    await clickExpression(`document.querySelector('main button[aria-label="Clear build plan"]')`);
    await waitForExpression(`document.querySelector('main [data-build-plan]') === null`);
    // Rebuild a valid 15-row plan through the real app handler, then verify one exact-calldata send.
    for (let count = 1; count <= 15; count++) {
      await clickExpression(`document.querySelector(${JSON.stringify(addDefense)})`);
      await waitForExpression(countIs(count));
    }
    assert.equal(await evaluate(`window.inspectorProof.walletRequests.filter(request => request.method === 'eth_sendTransaction').length`), 0);
    await waitForExpression(`document.querySelector('main [data-build-plan] button[aria-label="Confirm build plan"]:not(:disabled)') !== null`);
    await clickExpression('document.querySelector(\'main [data-build-plan] button[aria-label="Confirm build plan"]:not(:disabled)\')');
    await waitForExpression(`window.inspectorProof.walletRequests.filter(request => request.method === 'eth_sendTransaction').length === 1`);
    const preflight = await evaluate(`(() => {
      const requests = window.inspectorProof.rpcRequests.slice(-3);
      const call = requests[1], estimate = requests[2];
      const sent = window.inspectorProof.walletRequests.find(request => request.method === 'eth_sendTransaction')?.params?.[0];
      return {
        methods: requests.map(request => request.method),
        pendingSimulation: call?.params?.[1] === 'pending',
        validCalldata: typeof sent?.data === 'string' && /^0x[0-9a-f]+$/i.test(sent.data) && sent.data.length > 10,
        orderCount: Number.parseInt(sent?.data?.slice(138, 202), 16), // selector + two head words, then array length
        sameCalldata: call?.params?.[0]?.data === estimate?.params?.[0]?.data && estimate?.params?.[0]?.data === sent?.data,
        sameAccountAndContract: estimate?.params?.[0]?.from === sent?.from && estimate?.params?.[0]?.to === sent?.to,
        expectedAccountAndContract: sent?.from === '0x1111111111111111111111111111111111111111' && sent?.to === '${moon ? "0x3333333333333333333333333333333333333333" : "0x2222222222222222222222222222222222222222"}',
      };
    })()`);
    assert.deepEqual(preflight, { methods: ['eth_chainId', 'eth_call', 'eth_estimateGas'], pendingSimulation: true, validCalldata: true, orderCount: 15, sameCalldata: true, sameAccountAndContract: true, expectedAccountAndContract: true });
    assert.equal(await evaluate(`document.querySelectorAll('main [data-build-plan] button[aria-label^="Remove "]').length`), 15, "pending wallet confirmation retains all fifteen rows");
    assert.equal(await evaluate(countIs(15)), true);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]') === null`), true, "confirm must not open another review dialog");
    assert.deepEqual(await evaluate("window.inspectorProof.errors"), []);
  });
}

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
      && !window.inspectorProof.requests.some((request) => request.includes('/overview'))
      && window.inspectorProof.requests.some((request) => request.includes('/settlement'))`);

    const initialSnapshot = await evaluate(`({
      overviewRequests: window.inspectorProof.requests.filter((request) => request.includes('/overview')).length,
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
          && document.querySelector('[data-resource-status="ready"] [data-resource="M"] summary') !== null
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
      syncingPlanetfall: document.querySelector('main')?.textContent?.includes('Syncing planetfall') ?? false,
    })`);
    assert.equal(rendered.overviewRequests, initialSnapshot.overviewRequests, JSON.stringify(rendered.requests));
    assert.ok(
      rendered.requests.some((request) => request.includes("/settlement")),
      JSON.stringify(rendered.requests),
    );
    assert.ok(
      rendered.requests.some((request) => request.includes("/wallet/0x1111111111111111111111111111111111111111/missions?status=completed")),
      JSON.stringify(rendered.requests),
    );
    assert.ok(
      rendered.requests.some((request) => request.includes("/wallet/0x1111111111111111111111111111111111111111/missile-attacks?")),
      JSON.stringify(rendered.requests),
    );
    assert.ok(
      rendered.requests.some((request) => request.includes("/missions?status=completed") && request.includes("summaryOnly=true")),
      JSON.stringify(rendered.requests),
    );
    assert.equal(rendered.resourceStatus, "ready");
    assert.match(rendered.resourceTitle ?? "", /^Metal: 10,313\b/);
    assert.equal(rendered.syncingPlanetfall, false);
    assert.deepEqual(rendered.errors, []);
  });
}

test("slow route chunks use matching skeletons while navigation stays usable", async () => {
  await loadInspectorFixture("/", 1280);
  await waitForExpression("document.querySelector('main section[aria-label=\"Empire\"]') !== null");
  await evaluate("window.routeShellProof = document.querySelector('nav.hidden')");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  // Hold only route modules until assertions finish; elapsed network latency is not a gate.
  let releaseChunks;
  gatedRouteChunkRequests = [];
  routeChunkGate = new Promise(resolve => { releaseChunks = resolve; });
  try {
    await clickExpression("document.querySelector('nav.hidden a[href=\"/mission-control\"]')");
    await waitForExpression("document.querySelector('main')?.textContent.includes('Loading active missions') === true");
    assert.equal(await evaluate("document.querySelector('main')?.textContent.includes('Loading planet details')"), false);
    assert.equal(await evaluate("document.querySelector('nav.hidden') === window.routeShellProof"), true);
    await clickExpression("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
    try {
      await waitForExpression("location.pathname === '/shipyard' && document.querySelector('main .skeleton-region[role=status][aria-busy=true] .sr-only')?.textContent === 'Loading shipyard'");
    } catch (error) {
      const state = await evaluate(`({ path: location.pathname, status: document.querySelector('main [role=status]')?.textContent, errors: window.inspectorProof.errors })`);
      throw new Error(`${error.message}\nRoute chunk gate: ${JSON.stringify(gatedRouteChunkRequests)}; visible route: ${JSON.stringify(state)}`);
    }
  } finally {
    routeChunkGate = undefined;
    releaseChunks();
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  }
  await waitForExpression("document.querySelector('main [data-production-catalog]') !== null", 20_000);
  assert.equal(await evaluate("document.querySelector('nav.hidden') === window.routeShellProof"), true);
});

test("desktop Overview to Shipyard click atomically replaces the rendered page", async () => {
  await loadInspectorFixture("/", 1280);
  await waitForExpression("location.pathname === '/' && document.querySelector('main section[aria-label=\"Empire\"]') !== null");

  const shipyardRender = await clickSectionAndReadRender("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasEmpire: false,
    path: "/shipyard",
  });
  await waitForExpression(`document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Empire"]') === null`);
});

for (const outcome of ["resolve", "reject"]) {
  test(`wallet manual network switch cannot ${outcome} into an obsolete account`, async () => {
    await loadInspectorFixture("/", 1280, { shell: "settlement", manualNetworkSwitch: "true", waitForPlanetSelectors: "false" });
    const switchButton = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Switch network')`;
    await waitForExpression(`${switchButton} !== undefined`);
    await clickExpression(switchButton);
    await waitForExpression("window.inspectorProof.walletRequests.some(r => r.method === 'wallet_switchEthereumChain')");
    await evaluate("window.inspectorProof.emitWalletAccounts([window.inspectorProof.alternateAccount])");
    await waitForExpression("window.inspectorProof.walletBindings.at(-1) === window.inspectorProof.alternateAccount && document.querySelectorAll('[data-planet-selector-item]').length >= 2");
    await evaluate(`window.manualStaleErrorSeen = false; window.manualErrorObserver = new MutationObserver(() => {
      if (document.body.textContent.includes('obsolete switch failure')) window.manualStaleErrorSeen = true;
    }); window.manualErrorObserver.observe(document.querySelector('#app'), { childList: true, subtree: true });
    window.inspectorProof.completeWalletSwitch('${outcome}')`);
    await delay(400);
    await evaluate("window.manualErrorObserver.disconnect()");
    assert.equal(await evaluate("window.inspectorProof.walletBindings.at(-1) === window.inspectorProof.alternateAccount"), true);
    assert.equal(await evaluate("document.querySelectorAll('[data-planet-selector-item]').length >= 2"), true);
    assert.equal(await evaluate("window.manualStaleErrorSeen"), false);
  });
}

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
      && [...document.querySelectorAll('main button')].some((button) => button.getAttribute('aria-label') === 'Build Small Cargo now' && !button.disabled)`);

    await clickExpressionWithTrustedPointer(
      "[...document.querySelectorAll('main button')].find((button) => button.getAttribute('aria-label') === 'Build Small Cargo now' && !button.disabled)",
      width < 768 ? "touch" : "mouse",
    );
    try {
      await waitForExpression("window.inspectorProof.walletRequests.some((request) => request.method === 'eth_sendTransaction')");
    } catch (error) {
      const diagnostics = await evaluate(`({
        buildButtons: [...document.querySelectorAll('main button')]
          .filter((button) => button.getAttribute('aria-label') === 'Build Small Cargo now')
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
        chainId: request?.params?.[0]?.chainId ?? null,
        data: request?.params?.[0]?.data ?? null,
        from: request?.params?.[0]?.from ?? null,
        interaction: window.inspectorProof.interactions.findLast((event) => event.type === 'pointerdown' && event.target === 'button:Build Small Cargo now') ?? null,
        path: location.pathname,
        syncingPlanetfall: document.querySelector('main')?.textContent?.includes('Syncing planetfall') ?? false,
        to: request?.params?.[0]?.to ?? null,
      };
    })()`);
    assert.deepEqual(result, {
      chainId: "0x14a34",
      data: "0x13aed9a2" + "0".repeat(63) + "1" + "0".repeat(64) + "0".repeat(63) + "1",
      from: "0x1111111111111111111111111111111111111111",
      interaction: {
        isTrusted: true,
        pointerType: width < 768 ? "touch" : "mouse",
        target: "button:Build Small Cargo now",
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
  await waitForExpression(
    "location.pathname === '/infrastructure' && document.querySelector('#mobile-navigation-menu a[href=\"/infrastructure\"][aria-current=\"page\"]') !== null && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false",
  );

  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  const shipyardRender = await clickSectionAndReadRender("document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"]')");
  assert.deepEqual(shipyardRender, {
    activeHref: "/shipyard",
    hasEmpire: false,
    path: "/shipyard",
  });
  await waitForExpression(`location.pathname === '/shipyard'
    && document.querySelector('#mobile-navigation-menu a[href="/shipyard"][aria-current="page"]') !== null
    && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false
    && document.querySelector('main [data-production-catalog]') !== null
    && document.querySelector('main section[aria-label="Empire"]') === null`);

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

for (const kind of ["planet", "moon"]) {
  test(`late ${kind} detail responses cannot replace the currently rendered body`, async () => {
    await loadInspectorFixture("/planet/9/9/9", 1280);
    await evaluate(`window.inspectorProof.beginDetailRace('${kind}')`);
    try {
      await waitForExpression("window.inspectorProof.pendingDetailRequests().includes('7:1') && window.inspectorProof.pendingDetailRequests().includes('8:2')");
      // Force an unrelated old-app system read during the race: it must get
      // the normal fixture payload without consuming either deferred response.
      const unrelated = await evaluate("fetch('/local-api/universe/galaxies/9/systems/9?detail=full').then(response => response.json()).then(system => system.planets[0].name)");
      assert.equal(unrelated, "Unrelated Gamma");
      assert.deepEqual(await evaluate("window.inspectorProof.pendingDetailRequests()"), ["7:1", "8:2"]);
      assert.deepEqual(await evaluate(`window.inspectorProof.requests.filter(request => request.includes('/universe/galaxies/7/systems/1?') || request.includes('/universe/galaxies/8/systems/2?')).sort()`), [
        "/local-api/universe/galaxies/7/systems/1?detail=full",
        "/local-api/universe/galaxies/8/systems/2?detail=full",
      ]);

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
    } finally {
      await evaluate("window.inspectorProof.endDetailRace()");
    }
  });
}

// These scenarios exercise the real mounted composer, canonical store and write
// coordinator. Only HTTP inventory and the external wallet send are fixtures.
async function openInventoryComposer({ spareFighter = false } = {}) {
  await loadInspectorFixture("/galaxy", 1280, { attackIntelProbe: "true", moonOverview: "true" });
  await evaluate(`(async () => {
    const url = performance.getEntriesByType('resource').map(r => r.name).find(name => name.includes('/src/backendDataStore.ts'));
    const { backendDataStoreFor } = await import(url);
    const store = backendDataStoreFor('/local-api');
    window.inventoryProof = { store, planet: 1, moon: 2, spareFighter: ${spareFighter}, sends: 0, mode: 'success', result: null, reads: [] };
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.origin);
      if (url.pathname.endsWith('/randomness-readiness')) {
        if (window.inventoryProof.holdReadiness) {
          window.inventoryProof.waitingForReadiness = true;
          await new Promise(resolve => { window.inventoryProof.releaseReadiness = resolve; });
        }
        return Response.json({ ready: true, reasons: [] });
      }
      if (url.pathname.endsWith('/transactions/0x888/status')) {
        return Response.json({ transactionHash: '0x888', phase: 'applied', events: [], indexedEventCount: 0, latestIndexedBlock: '20', receiptBlock: '20' });
      }
      const response = await originalFetch(...args);
      if (!url.pathname.endsWith('/shipyard') && !url.pathname.endsWith('/moon')) return response;
      const data = await response.json();
      const moon = url.pathname.endsWith('/moon');
      window.inventoryProof.reads.push({ moon, planetId: url.searchParams.get('planetId') });
      const fighter = !moon && window.inventoryProof.spareFighter;
      return Response.json({ ...data, planetId: url.searchParams.get('planetId'),
        ...(fighter ? { ships: [...data.ships, { id: 1, count: 1, cost: { metal: '3000', crystal: '1000', deuterium: '0' }, durationSeconds: 60 }] } : {}),
        launchableShips: [{ id: 0, count: moon ? window.inventoryProof.moon : window.inventoryProof.planet }, ...(fighter ? [{ id: 1, count: 1 }] : [])] });
    };
    const runWrite = store.runWriteTransaction.bind(store);
    store.runWriteTransaction = descriptor => runWrite({ ...descriptor, send: async beforeSend => {
      window.inventoryProof.sends++;
      if (window.inventoryProof.mode === 'revert') {
        window.inventoryProof.moon = 0;
        throw new Error('Need 1 Small Cargo, only 0 available on the origin moon. Refresh fleet state or reduce the selected ships before launching.');
      }
      beforeSend();
      window.inventoryProof.planet = 0;
      return '0x888';
    }}).then(result => { window.inventoryProof.result = result; return result; });
    await store.shipyard(window.inspectorProof.account, '101', { fresh: true });
  })()`);
  const attack = `document.querySelector('main button[aria-label="Attack"]:not(:disabled)')`;
  await waitForExpression(`${attack} !== null`);
  await clickExpression(attack);
  await waitForExpression(`document.querySelector('input[aria-label="Small Cargo quantity"]') !== null
    && document.querySelector('button[title="Origin moon"]') !== null`);
  // Wait for the composer's on-open fresh reads before mutating test inventory.
  await delay(150);
}

const cargoQuantity = `document.querySelector('input[aria-label="Small Cargo quantity"]')`;
const increaseCargo = `document.querySelector('button[aria-label="Increase Small Cargo"]')`;



async function openDelegationDialog(width = 1280, mode = "main") {
  await loadInspectorFixture("/", width, { delegation: mode, waitForPlanetSelectors: mode === "self" ? "false" : "true" });
  if (mode === "self") await waitForExpression(`document.body.textContent.includes("0x9999") || window.inspectorProof.requests.some(r => r.includes("/wallet/0x9999999999999999999999999999999999999999/"))`);
  // The commander details live in the sidebar account popover (desktop) or menu card (mobile).
  await clickExpression(`[...document.querySelectorAll('summary[aria-label="Commander account"], [aria-controls="mobile-commander-details"]')].find(el => el.getBoundingClientRect().width)`);
  await clickExpression(`[...document.querySelectorAll('[aria-label="Edit player profile"]')].find(el => el.getBoundingClientRect().width)`);
  await waitForExpression(`document.querySelector('[role="dialog"]')`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}
const delegateSection = `document.querySelector('[aria-label="Wallet delegation"]')`;
const delegateButton = label => `[...${delegateSection}.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)})`;
async function fillDelegate(address) {
  await evaluate(`(() => { const input = ${delegateSection}.querySelector('input'); input.value = ${JSON.stringify(address)}; input.dispatchEvent(new Event('input', {bubbles:true})); input.focus(); })()`);
}
async function enterKey() {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

for (const outcome of ["reverted", "rejected"]) test(`wallet delegation ${outcome} transaction stays failed after read-only retry`, async () => {
  await openDelegationDialog();
  await fillDelegate("0x3333333333333333333333333333333333333333");
  await clickExpression(delegateButton("Propose delegate"));
  await waitForExpression(`window.inspectorProof.walletRequests.some(r => r.method === 'eth_sendTransaction')`);
  await evaluate(outcome === "reverted"
    ? `window.inspectorProof.setDelegation(null, 'reverted'); window.inspectorProof.resolveWalletSend('0xdelegatereverted')`
    : `window.inspectorProof.rejectWalletSend()`);
  await waitForExpression(`${delegateSection}.textContent.includes('${outcome}')`);
  const before = await evaluate(`window.inspectorProof.requests.filter(r => r.includes('/delegation')).length`);
  await clickExpression(delegateButton("Refresh delegate status"));
  await waitForExpression(`${delegateSection}.textContent.includes('Current delegate refreshed.')`);
  assert.equal(await evaluate(`${delegateSection}.textContent.includes('${outcome}')`), true);
  assert.equal(await evaluate(`${delegateSection}.textContent.includes('Delegate proposed.')`), false);
  assert.ok(await evaluate(`window.inspectorProof.requests.filter(r => r.includes('/delegation')).length`) > before);
  assert.equal(await evaluate(`${delegateButton("Propose delegate")}.disabled`), false);
  assert.equal(await evaluate(`window.inspectorProof.walletRequests.filter(r => r.method === 'eth_sendTransaction').length`), 1);
});



