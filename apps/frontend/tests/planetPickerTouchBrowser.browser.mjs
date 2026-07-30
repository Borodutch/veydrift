import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

let browser;
let server;
let fixtureUrl;

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
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function dispatchTouch(cdp, type, x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd"
      ? []
      : [{ force: 1, id: 1, radiusX: 4, radiusY: 4, x, y }],
  });
}

async function proofState(page) {
  return page.evaluate(() => ({
    activations: window.touchProof.activations,
    pointerCancels: window.touchProof.pointerCancels,
    pointerMovesAfterActivation: window.touchProof.pointerMovesAfterActivation,
    preventedTouchMoves: window.touchProof.preventedTouchMoves,
    scrollLeft: document.querySelector("#scroller").scrollLeft,
    scrollTop: document.querySelector("#scroller").scrollTop,
    touchMoves: window.touchProof.touchMoves,
  }));
}

test("native two-axis touch scroll works before the hold and post-hold movement stays reorderable", async () => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 720, width: 390 },
  });
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => window.touchProofReady === true);
  const cdp = await context.newCDPSession(page);
  let box = await page.locator("#planet").boundingBox();
  assert.ok(box);
  let x = box.x + box.width / 2;
  let y = box.y + box.height - 30;

  await dispatchTouch(cdp, "touchStart", x, y);
  await page.waitForTimeout(30);
  for (const offset of [15, 30, 50, 75, 105]) {
    await dispatchTouch(cdp, "touchMove", x, y - offset);
    await page.waitForTimeout(30);
  }
  await dispatchTouch(cdp, "touchEnd", x, y - 110);
  await page.waitForTimeout(250);

  const scrollState = await proofState(page);
  assert.equal(scrollState.activations, 0);
  assert.equal(scrollState.preventedTouchMoves, 0);
  assert.ok(scrollState.scrollTop > 0, `expected native scroll, got scrollTop=${scrollState.scrollTop}`);

  await page.reload();
  await page.waitForFunction(() => window.touchProofReady === true);
  box = await page.locator("#planet").boundingBox();
  assert.ok(box);
  x = box.x + box.width / 2;
  y = box.y + box.height - 30;
  await dispatchTouch(cdp, "touchStart", x, y);
  await page.waitForTimeout(30);
  for (const offset of [15, 30, 50, 75, 105]) {
    await dispatchTouch(cdp, "touchMove", x - offset, y);
    await page.waitForTimeout(30);
  }
  await dispatchTouch(cdp, "touchEnd", x - 105, y);
  await page.waitForTimeout(250);

  const horizontalScrollState = await proofState(page);
  assert.equal(horizontalScrollState.activations, 0);
  assert.equal(horizontalScrollState.preventedTouchMoves, 0);
  assert.ok(
    horizontalScrollState.scrollLeft > 0,
    `expected native horizontal scroll, got scrollLeft=${horizontalScrollState.scrollLeft}`,
  );

  await page.reload();
  await page.waitForFunction(() => window.touchProofReady === true);
  box = await page.locator("#planet").boundingBox();
  assert.ok(box);
  x = box.x + box.width / 2;
  y = box.y + box.height - 30;
  await dispatchTouch(cdp, "touchStart", x, y);
  await page.waitForTimeout(550);
  for (const offset of [15, 30, 50, 70]) {
    await dispatchTouch(cdp, "touchMove", x - offset, y);
    await page.waitForTimeout(30);
  }
  await dispatchTouch(cdp, "touchEnd", x - 70, y);
  await page.waitForTimeout(100);

  const reorderState = await proofState(page);
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

  await context.close();
});
