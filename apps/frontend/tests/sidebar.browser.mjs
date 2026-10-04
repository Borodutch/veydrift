// Run from apps/frontend: node --test tests/sidebar.browser.mjs
// Optional SIDEBAR_ARTIFACTS writes screenshots + measured styles for review.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import preact from "@preact/preset-vite";
import { freePort } from "./freePort.mjs";

test("Desktop sidebar persists and stays accessible independently of mobile navigation", { timeout: 300_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-sidebar-"));
  const server = await createServer({ configFile: false, plugins: [preact()], logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  let chrome;
  const pending = new Map();
  const artifacts = process.env.SIDEBAR_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const measurements = [];
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/sidebar.html`;
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

    const desktop = 'nav[aria-label="Desktop app sections"]';
    const toggle = desktop + ' button[aria-controls="desktop-navigation-links"]';
    const account = desktop + ' summary';
    const key = 'veydrift.sidebar.collapsed.v1';
    const frame = () => evaluate('new Promise(requestAnimationFrame)');
    async function mounted() {
      const deadline = Date.now() + 20000;
      while (!await evaluate('Boolean(window.fixture && document.querySelector('+JSON.stringify(desktop)+'))').catch(() => false)) {
        assert.ok(Date.now() < deadline, 'fixture did not mount');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await frame();
    }
    async function click(selector) {
      const point = await evaluate('(() => {const n=document.querySelector('+JSON.stringify(selector)+'); n.scrollIntoView({block:"nearest"});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button,summary,a")===n};})()');
      assert.ok(point.hit, selector + ': unobstructed');
      await send('Input.dispatchMouseEvent', { type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1 });
      await send('Input.dispatchMouseEvent', { type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1 });
      await frame();
    }
    async function press(key) {
      const code=key===' ' ? 'Space' : key, vk=key===' ' ? 32 : key==='Enter' ? 13 : 27;
      await send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:vk,...(key==='Enter'?{text:'\r'}:{})});
      await send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:vk});
      await frame();
    }
    const expanded = () => evaluate('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-expanded")');
    const measure = () => evaluate('(() => {const n=document.querySelector('+JSON.stringify(desktop)+').getBoundingClientRect(),m=document.querySelector("main").getBoundingClientRect(),r=document.querySelector("[data-right-rail]").getBoundingClientRect();return {nav:n.width,main:m.width,x:m.x,right:r.x,overlap:m.right>r.x,overflow:document.documentElement.scrollWidth>innerWidth};})()');
    await send('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate', {url});
    await mounted();
    assert.equal(await expanded(), 'true');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-label")'), "Collapse sidebar");
    for(const width of [768,1024,1280]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height:800,deviceScaleFactor:1,mobile:false});
      const before=await measure();
      assert.equal(before.nav,208);
      if (artifacts && width === 1280) writeFileSync(join(artifacts, "expanded.png"), Buffer.from((await send("Page.captureScreenshot", {format:"png"})).data, "base64"));
      await click(toggle);
      const after=await measure();
      assert.equal(after.nav,64); assert.equal(after.main-before.main,144);
      assert.equal(after.overlap,false); assert.equal(after.overflow,false);
      assert.equal(after.right,before.right);
      measurements.push({ width, before, after });
      if (artifacts && width === 1280) writeFileSync(join(artifacts, "collapsed.png"), Buffer.from((await send("Page.captureScreenshot", {format:"png"})).data, "base64"));
      assert.equal(await expanded(),'false');
      await click(toggle);
    }
    await evaluate('document.querySelector('+JSON.stringify(toggle)+').focus()');
    await press('Enter'); assert.equal(await expanded(),'false');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(toggle)+').getAttribute("aria-label")'), "Expand sidebar");
    await press(' '); assert.equal(await expanded(),'true');
    await press('Enter'); assert.equal(await expanded(),'false');
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(key)+')'),'1');
    await evaluate('fixture.remount()'); await frame();
    assert.equal(await expanded(),'false');
    // Restore after full document reload, not merely a Preact rerender.
    await send('Page.reload'); await new Promise(resolve=>setTimeout(resolve,150)); await mounted();
    assert.equal(await expanded(),'false');
    // Close the tab and reopen a fresh document on the same origin.
    await send('Target.closeTarget', {targetId}, false);
    const reopened=await send('Target.createTarget', {url:'about:blank'}, false);
    ({sessionId}=await send('Target.attachToTarget',{targetId:reopened.targetId,flatten:true},false));
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url}); await mounted();
    assert.equal(await expanded(),'false');
    const research=desktop+' a[aria-label="Research"]';
    await evaluate('document.querySelector('+JSON.stringify(research)+').focus()');
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await evaluate('document.querySelector("[role=tooltip]")?.textContent'),'Research');
    assert.ok(await evaluate('document.querySelector("[role=tooltip]").getBoundingClientRect().x>64'));
    await press('Escape'); assert.equal(await evaluate('Boolean(document.querySelector("[role=tooltip]"))'),false);
    await press('Enter');
    assert.equal(await evaluate('document.querySelector("main h1").textContent'),'research');
    assert.equal(await expanded(),'false');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(research)+').getAttribute("aria-current")'),'page');
    assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(desktop+' a[aria-label]')+').length'),13);
    // Hover shows the same tooltip outside the scroll container.
    const point=await evaluate('(() => {const r=document.querySelector('+JSON.stringify(desktop+' a[aria-label="Overview"]')+').getBoundingClientRect();return {x:r.x+10,y:r.y+10};})()');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point}); await frame();
    assert.equal(await evaluate('document.querySelector("[role=tooltip]")?.textContent'),'Overview');
    const tooltipPoint=await evaluate('(() => {const r=document.querySelector("[role=tooltip]").getBoundingClientRect();return {x:r.x+8,y:r.y+8};})()');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...tooltipPoint});
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(await evaluate('document.querySelector("[role=tooltip]")?.textContent'),'Overview');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:20});
    await evaluate('document.querySelector('+JSON.stringify(account)+').focus()'); await press('Enter');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(account)+').parentElement.open'),true);
    await click(desktop+' button[aria-label="Expand Commander profile"]');
    for (const [width,height] of [[768,480],[1024,600],[1280,800]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); await frame();
      const geometry=await evaluate('(() => {const r=document.querySelector('+JSON.stringify(account)+').nextElementSibling.getBoundingClientRect();return {x:r.x,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()');
      assert.ok(geometry.x>=64 && geometry.right<=geometry.width && geometry.top>=44 && geometry.bottom<=geometry.height, JSON.stringify(geometry));
      await click(desktop+' button[aria-label="Copy wallet"]');
    }
    await click(desktop+' button[aria-label="Edit player profile"]');
    assert.ok(await evaluate('Boolean(document.querySelector("#commander-name-editor"))'));
    await click('button[aria-label="Cancel player display name edit"]');
    await click(account);
    await click(desktop+' button[aria-haspopup="dialog"]:not([aria-label])');
    assert.equal(await evaluate('fixture.activity()'),1);
    await evaluate('document.querySelector('+JSON.stringify(account)+').focus()'); await press('Escape');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(account)+').parentElement.open'),false);
    await evaluate('fixture.disconnect()'); await frame();
    await click(account); await click(desktop+' aside button');
    assert.equal(await evaluate('fixture.connects()'),1);
    for(const width of [320,390,767]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true}); await frame();
      assert.equal(await evaluate('getComputedStyle(document.querySelector('+JSON.stringify(desktop)+')).display'),'none');
      await click('summary[aria-controls="mobile-navigation-menu"]');
      assert.equal(await evaluate('document.querySelector("#mobile-navigation-menu").getBoundingClientRect().width>0'),true);
      assert.equal(await evaluate('document.querySelectorAll("#mobile-navigation-menu nav a").length'),13);
      const mobilePage=width === 390 ? "overview" : "galaxy";
      const mobileLink = await evaluate('[...document.querySelectorAll("#mobile-navigation-menu nav a")].find(a=>a.textContent==='+JSON.stringify(mobilePage === "galaxy" ? "Galaxy" : "Overview")+').getAttribute("href")');
      await click('nav[aria-label="Mobile app sections"] a[href="'+mobileLink+'"]');
      assert.equal(await evaluate('document.querySelector("main h1").textContent'), mobilePage);
      await frame();
      assert.equal(await evaluate('document.querySelector("summary[aria-controls=mobile-navigation-menu]").parentElement.open'),false);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1024,height:800,deviceScaleFactor:1,mobile:false}); await frame();
    assert.equal(await expanded(),'false');
    await click(toggle);
    await evaluate('fixture.remount()'); await frame();
    assert.equal(await expanded(),'true');
    await evaluate('localStorage.setItem('+JSON.stringify(key)+',"broken");fixture.remount()'); await frame();
    assert.equal(await expanded(),'true');
    await evaluate('Storage.prototype.setItem = () => { throw new Error("quota"); }');
    await click(toggle); assert.equal(await expanded(),'false');
    await click(toggle); assert.equal(await expanded(),'true');
    await evaluate('Object.defineProperty(window,"localStorage",{configurable:true,get(){throw new Error("blocked")}});fixture.remount()'); await frame();
    assert.equal(await expanded(),'true'); await click(toggle); assert.equal(await expanded(),'false');
    await click(toggle); assert.equal(await expanded(),'true');
    if (artifacts) writeFileSync(join(artifacts, "measurements.json"), JSON.stringify(measurements, null, 2));
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
