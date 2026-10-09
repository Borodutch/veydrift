// Run from apps/frontend: node --test tests/supplyActions.browser.mjs
// Optional BATCH_SUPPLY_ARTIFACTS writes screenshots and layout evidence. Local disposable Chrome only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import { freePort } from "./freePort.mjs";

test("Mounted production Supply handlers enforce goal, context and wallet parity", { timeout: 120_000 }, async () => {
  const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(executable, "Chrome required for rendered sizing regression");
  const profile = mkdtempSync(join(tmpdir(), "veydrift-batch-supply-"));
  const server = await createServer({ cacheDir: join(profile, "vite-cache"),
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
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplyActions.html`;
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

    const state = () => evaluate('actionsFixture.status()');
    const waitFor = async (expression) => { const end=Date.now()+10000; while(!(await evaluate(expression))) {if(Date.now()>=end) assert.fail(expression+' '+JSON.stringify(await evaluate('window.actionsFixture?.status()'))); await new Promise(r=>setTimeout(r,20));} await settle(); };
    const load = async () => {
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:568,deviceScaleFactor:1,mobile:true});
      await send('Page.navigate',{url});
      await waitFor('Boolean(window.actionsFixture && document.querySelector("footer button") && !document.querySelector("footer button").disabled)');
    };
    const launch = () => evaluate('document.querySelector("footer button").click()');
    const idle = () => waitFor('!actionsFixture.status().pending && !actionsFixture.status().loading');
    for (const count of [2, 15]) for (const mission of ['transport', 'deploy']) {
      await load();
      await evaluate('actionsFixture.multiMoon(' + count + ')'); await settle();
      await waitFor('!document.querySelector("footer button").disabled');
      if (mission === 'deploy') { await evaluate(`document.querySelector('[aria-label="Mission type"] button:last-child').click()`); await settle(); }
      await launch(); await idle();
      const result = await state();
      assert.equal(result.sent.length, 1, 'atomic moon ' + mission + ' sends once');
      const data = result.sent[0][0].data;
      const words = data.slice(10).match(/.{64}/g).map(x => BigInt('0x' + x));
      assert.deepEqual(words.slice(0, 3), [831n, 64n, BigInt(count)]);
      assert.equal(result.walletCalls.filter(method => method === 'eth_call').length, 2, 'capability + exact batch simulation');
    }
    for (const appRpc of [false, true]) for (const stage of ['simulation', 'gas', 'chain']) for (const change of ['account', 'body', 'close']) {
      await load(); await evaluate('actionsFixture.multiMoon()'); await settle();
      await evaluate('actionsFixture.coordinate(10000,' + appRpc + '); actionsFixture.holdStage(' + JSON.stringify(stage) + ')');
      await launch(); await waitFor('actionsFixture.status().stagePending');
      await evaluate('actionsFixture.change(' + JSON.stringify(change) + '); actionsFixture.releaseStage()');
      await waitFor('actionsFixture.status().outcomes.length > 0');
      assert.equal((await state()).sent.length, 0, 'moon context fence: ' + stage + '/' + change);
    }
    for (const failure of ['capability', 'revert']) {
      await load(); await evaluate('actionsFixture.multiMoon()'); await settle();
      await evaluate(failure === 'capability' ? 'actionsFixture.capability(false)' : 'actionsFixture.revert()');
      await launch(); await idle(); assert.equal((await state()).sent.length, 0);
    }
    // First preflight publishes increased shortfall; second identical attempt must
    // remain blocked even though the parent now has that new preview.
    await load();
    await evaluate('document.querySelector("[data-supply-details]").open=true');
    await evaluate('(() => {const i=document.querySelector(\'input[aria-label="New Zion metal to send"]\');i.value="12300";i.dispatchEvent(new Event("input",{bubbles:true}));})()'); await settle();
    await evaluate('actionsFixture.spend()'); await launch(); await idle();
    assert.equal((await state()).sent.length,0);
    assert.deepEqual((await state()).preview.missing,{metal:12800,crystal:3840,deuterium:6400});
    assert.equal(await evaluate('document.querySelector("footer button").disabled'),true);
    assert.equal(await evaluate('document.querySelector(\'input[aria-label="New Zion metal to send"]\').value'),'12300');
    assert.ok(await evaluate('document.querySelector(\'[aria-label="Supply totals"]\').textContent.includes("RemainingM 500 · C 500 · D 0")'));
    await evaluate('actionsFixture.retryOriginal()'); await idle();
    assert.equal((await state()).sent.length,0,'unchanged second confirmation cannot accept incomplete cargo');
    await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Refresh destination and shortfall").click()');await idle();
    assert.equal(await evaluate('document.querySelector("footer button").disabled'),false);
    await launch(); await idle();
    let result=await state();assert.equal(result.sent.length,1);
    const data=result.sent[0][0].data;
    assert.equal(data.slice(0,10),'0x9c26e0be');
    const words=data.slice(10).match(/.{64}/g).map(x=>BigInt('0x'+x));
    assert.deepEqual(words.slice(0,4),[831n,64n,1n,1n]);
    assert.deepEqual(words.slice(18),[12800n,3840n,6400n,100n]);
    console.log('PASS mounted two-confirm shortfall guard, preserved edits, explicit review and exact actual wallet calldata');

    await load();await evaluate('actionsFixture.defer(); document.querySelector("footer button").click(); document.querySelector("footer button").click()');await settle();
    result=await state(); assert.equal(result.runs,1,'same-frame production lock');assert.equal(result.reads.length,1);
    await evaluate('actionsFixture.defer(false); actionsFixture.resolve(0)');await idle();
    assert.equal((await state()).sent.length,1);

    await load();await evaluate('actionsFixture.defer();actionsFixture.refresh();actionsFixture.refresh()');await settle();
    assert.equal((await state()).reads.length,2);
    await evaluate('actionsFixture.resolve(1,"100")');await idle();
    assert.equal((await state()).preview.missing.metal,12700);
    await evaluate('actionsFixture.resolve(0,"0")');await settle();
    assert.equal((await state()).preview.missing.metal,12700,'older destination response discarded');
    console.log('PASS mounted same-frame duplicate and reversed destination refresh completion');

    for(const change of ['close','reopen','account','body','target','unmount']) {
      await load();await evaluate('actionsFixture.defer();document.querySelector("footer button").click()');await settle();
      if(change==='unmount') await evaluate('actionsFixture.unmount()');
      else if(change==='reopen') {await evaluate('actionsFixture.change("close")');await settle();await evaluate('actionsFixture.change("reopen")');}
      else await evaluate('actionsFixture.change('+JSON.stringify(change)+')');
      await settle();await evaluate('actionsFixture.defer(false);actionsFixture.resolve(0)');
      await waitFor('actionsFixture.status().failures.length>0');
      assert.equal((await state()).sent.length,0,change+': obsolete preflight never sends');
    }
    for(const change of ['close','reopen','account','body','target']) {
      await load();await evaluate('actionsFixture.defer();actionsFixture.refresh()');await settle();
      await evaluate('actionsFixture.change('+JSON.stringify(change)+')');await settle();
      await evaluate('actionsFixture.resolve(0,"0")');await settle();
      assert.equal((await state()).preview,undefined,change+': obsolete refresh cannot publish');
    }
    for (const change of ['account', 'target']) {
    await load();await evaluate('actionsFixture.holdSend()');await launch();
    await waitFor('actionsFixture.status().readyToSend');
    await evaluate('actionsFixture.change('+JSON.stringify(change)+')');await settle();await evaluate('actionsFixture.releaseSend()');
    await waitFor('actionsFixture.status().failures.length>0');
    assert.equal((await state()).sent.length,0,'context checked again between preflight and transport');
    }
    console.log('PASS mounted close/reopen/account/body/target/unmount and delayed wallet send guards');

    // Hold actual wallet awaits with the real coordinator, not just its scheduling.
    const changeContext = async change => {
      if (change === 'unmount') await evaluate('actionsFixture.unmount()');
      else if (change === 'reopen') {
        await evaluate('actionsFixture.change("close")'); await settle();
        await evaluate('actionsFixture.change("reopen")');
      } else await evaluate('actionsFixture.change('+JSON.stringify(change)+')');
      await settle();
    };
    for (const appRpc of [false, true]) {
      for (const stage of ['simulation', 'gas', 'chain']) {
        for (const change of ['close', 'reopen', 'account', 'target', 'body', 'unmount']) {
          await load();
          await evaluate('actionsFixture.coordinate(10000,'+appRpc+');actionsFixture.holdStage('+JSON.stringify(stage)+')');
          await launch(); await waitFor('actionsFixture.status().stagePending');
          await changeContext(change);
          await evaluate('actionsFixture.releaseStage()');
          await waitFor('actionsFixture.status().outcomes.length===1');
          result = await state();
          assert.equal(result.sent.length, 0, stage+'/'+change+': obsolete draft cannot reach wallet');
          assert.deepEqual(result.outcomes, ['not-submitted']);
          assert.ok(result.failures.some(message => message.includes('Supply selection changed')));
          assert.deepEqual(result.recovered, []);
          assert.equal(result.transaction.phase, 'error');
          if (appRpc) {
            assert.ok(result.rpcCalls.includes('eth_call'));
            assert.ok(result.rpcCalls.includes('eth_estimateGas'));
            assert.ok(!result.walletCalls.includes('eth_call') && !result.walletCalls.includes('eth_estimateGas'));
          }
        }
      }
    }
    console.log('PASS 36 real-coordinator simulation/gas/final-chain context races, including configured app RPC');

    // An unchanged draft still cannot outlive the existing coordinator deadline.
    await load();await evaluate('actionsFixture.coordinate(500,true);actionsFixture.holdStage("simulation")');
    await launch();await waitFor('actionsFixture.status().stagePending');
    await waitFor('actionsFixture.status().outcomes.length===1');
    assert.deepEqual((await state()).outcomes,['not-submitted']);
    await evaluate('actionsFixture.releaseStage()');
    await waitFor('actionsFixture.status().walletCalls.filter(method=>method==="eth_chainId").length===2');
    await settle(); assert.equal((await state()).sent.length,0,'deadline survives nested provider guard');

    // Once send started, changing the draft must not discard a late hash.
    // Expire foreground to prove background recovery, not a fixture return.
    for (const change of ['close', 'reopen', 'account', 'target', 'body', 'unmount']) {
      await load();await evaluate('actionsFixture.coordinate(500,true);actionsFixture.holdStage("send")');
      await launch();await waitFor('actionsFixture.status().stagePending');
      assert.equal((await state()).sent.length,1);
      await changeContext(change);
      await waitFor('actionsFixture.status().outcomes.length===1');
      assert.deepEqual((await state()).outcomes,['unknown']);
      await evaluate('actionsFixture.releaseStage()');
      await waitFor('actionsFixture.status().transaction?.phase==="success"');
      result=await state();
      assert.deepEqual(result.recovered,['0xfixture']);
      assert.equal(result.transaction.txHash,'0xfixture');
      assert.equal(result.sent.length,1);
      if (change==='reopen' || change==='account' || change==='body') assert.equal(result.target,'831','old completion cannot close replacement draft');
      if (change==='target') assert.equal(result.target,'832');
    }
    console.log('PASS preserved coordinator deadline and late-hash recovery after six post-send context changes');

    await load();await evaluate('document.querySelector("[data-supply-amounts]").open=true;window.Worker=class {constructor(){window.heldMax=this}postMessage(){}terminate(){this.terminated=true}}');
    await evaluate('document.querySelector(\'input[aria-label="metal to send"]\').closest("label").querySelector("button").click()');await settle();
    for(const kind of ['unselected']) {
      await evaluate('actionsFixture.stock('+JSON.stringify(kind)+')');await settle();
      assert.equal(await evaluate('Boolean(heldMax.terminated)'),false,kind+' cannot cancel reviewed Max');
      assert.equal(await evaluate('document.body.textContent.includes("Source inventory changed")'),false);
    }
    await evaluate('heldMax.onmessage({data:{maximum:12300}})');await settle();
    assert.equal(await evaluate('document.querySelector("footer button").disabled'),false,'identical reviewed plan remains launchable');
    await launch();await idle();assert.equal((await state()).sent.length,1);
    // A selected source's resource reserve is an input to Max even when the
    // current smaller shipment is unchanged. An old worker must not apply it.
    await load();await evaluate('document.querySelector("[data-supply-amounts]").open=true;window.Worker=class {constructor(){window.heldMax=this}postMessage(){}terminate(){this.terminated=true}}');
    await evaluate('document.querySelector(' + JSON.stringify('input[aria-label="metal to send"]') + ').closest("label").querySelector("button").click()');await settle();
    await evaluate('actionsFixture.stock("irrelevant")');await settle();
    assert.equal(await evaluate('Boolean(heldMax.terminated)'),true,'selected resource changes invalidate an old Max snapshot');
    assert.equal(await evaluate('document.body.textContent.includes("Source inventory changed")'),false,'unchanged reviewed shipment remains valid');
    assert.equal((await state()).sent.length,0);
    for (const kind of ['fuel','lock','drive','fleet']) {
      await load();await evaluate('document.querySelector("[data-supply-amounts]").open=true;window.Worker=class {constructor(){window.heldMax=this}postMessage(){}terminate(){this.terminated=true}}');
      await evaluate('document.querySelector(' + JSON.stringify('input[aria-label="metal to send"]') + ').closest("label").querySelector("button").click()');await settle();
      await evaluate('actionsFixture.stock('+JSON.stringify(kind)+')');await settle();
      assert.equal(await evaluate('document.querySelector("footer button").disabled'),true,kind+': invalid reviewed fleet blocks');
      assert.equal(await evaluate('heldMax.terminated'),true,kind+': relevant feasibility change cancels worker');
      assert.equal((await state()).sent.length,0);
    }
    console.log('PASS unselected inventory preserves Max; selected reserves invalidate Max without resetting unchanged shipment; insufficient fuel blocks');
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
