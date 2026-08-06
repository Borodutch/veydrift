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
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let cdp;
let browserCdp;
let chrome;
let chromeProfile;
let fixtureUrl;
let inspectorFixtureUrl;
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

async function launchChrome() {
  const executable = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`Chrome executable not found. Checked: ${chromeCandidates.join(", ")}`);
  }

  chromeProfile = mkdtempSync(join(tmpdir(), "veydrift-touch-browser-"));
  chrome = spawn(executable, [
    "--headless=new",
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
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools endpoint timed out.")), 10_000);
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
  const targetsUrl = browserWebSocketUrl
    .replace(/^ws:/, "http:")
    .replace(/\/devtools\/browser\/.*$/, "/json/list");
  const targets = await (await fetch(targetsUrl)).json();
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("Chrome did not expose a page target.");
  }
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
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 720,
    mobile: true,
    width: 390,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
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
    touchPoints: type === "touchEnd"
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

async function loadInspectorFixture(route, width) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 900,
    mobile: width < 768,
    width,
  });
  await cdp.send("Page.navigate", {
    url: `${inspectorFixtureUrl}?route=${encodeURIComponent(route)}`,
  });
  await waitForExpression("window.inspectorProof?.appReady === true", 10_000);
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

  await clickExpression("document.querySelector('nav.hidden a[href=\"/shipyard\"]')");
  await waitForExpression("location.pathname === '/shipyard' && document.querySelector('nav.hidden a[href=\"/shipyard\"][aria-current=\"page\"]') !== null");
});

test("mobile sidebar first clicks commit routes and close the menu", async () => {
  await loadInspectorFixture("/planet/9/9/9", 390);
  await waitForExpression("document.querySelector('main h2')?.textContent === 'Unrelated Gamma'");

  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  await clickExpression("document.querySelector('#mobile-navigation-menu a[href=\"/infrastructure\"]')");
  await waitForExpression("location.pathname === '/infrastructure' && document.querySelector('#mobile-navigation-menu a[href=\"/infrastructure\"][aria-current=\"page\"]') !== null && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false");

  await clickExpression("document.querySelector('summary[aria-label=\"Open navigation menu\"]')");
  await waitForExpression("document.querySelector('details:has(#mobile-navigation-menu)')?.open === true");
  await clickExpression("document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"]')");
  await waitForExpression("location.pathname === '/shipyard' && document.querySelector('#mobile-navigation-menu a[href=\"/shipyard\"][aria-current=\"page\"]') !== null && document.querySelector('details:has(#mobile-navigation-menu)')?.open === false");
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
