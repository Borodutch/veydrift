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
