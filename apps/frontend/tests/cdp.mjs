import assert from "node:assert/strict";

// Chrome DevTools Protocol over --remote-debugging-pipe, shared by the *.browser.mjs tests.
// Under a loaded CI Mac one command can take tens of seconds (a cold Vite transform, a starved
// renderer), so the per-command cap is generous; waits that poll use a short cap and retry instead
// (until()). Commands slower than 5 s, and ones that time out (including retried tries), are
// reported as test diagnostics with their expression and page. Pending commands are rejected
// at once if Chrome exits or the test is aborted (its own timeout), naming what was in flight.
export function connect(t, chrome) {
  const pending = new Map();
  let id = 0, buffered = "", sessionId, closed;
  // The page's current URL (from main-frame navigations), so a stalled command says where it stalled.
  let pageUrl = "about:blank";
  const describe = (method, params) => method + (params.expression ? "(" + JSON.stringify(params.expression.length > 200 ? params.expression.slice(0, 80) + "…" + params.expression.slice(-120) : params.expression) + ")" : "");
  function failAll(reason) {
    if (closed) return;
    closed = reason;
    for (const [commandId, command] of pending) {
      pending.delete(commandId); clearTimeout(command.timer);
      command.reject(new Error(command.what + " on " + pageUrl + ": " + reason));
    }
  }
  chrome.once("exit", (code, signal) => failAll("Chrome exited (" + (signal ?? code) + ")"));
  chrome.once("error", error => failAll("Chrome failed: " + error.message));
  // A write that lands after Chrome died but before its exit event is EPIPE: fail, don't crash.
  chrome.stdio[3].on("error", error => failAll("CDP pipe failed: " + error.message));
  const onAbort = () => {
    for (const command of pending.values()) t.diagnostic("still pending at test abort, on " + pageUrl + ": " + command.what);
    failAll("test aborted");
  };
  t.signal.addEventListener("abort", onAbort, { once: true });
  chrome.stdio[4].on("data", chunk => {
    buffered += chunk.toString();
    let end;
    while ((end = buffered.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (message.method === "Page.frameNavigated" && !message.params.frame.parentId) pageUrl = message.params.frame.url.replace(/^https?:\/\/[^/]+/, "");
      const command = pending.get(message.id);
      if (!command) continue;
      pending.delete(message.id); clearTimeout(command.timer);
      const ms = Date.now() - command.started;
      if (ms > 5_000) t.diagnostic("slow CDP command (" + ms + " ms) on " + pageUrl + ": " + command.what);
      if (message.error) command.reject(new Error(command.what + ": " + JSON.stringify(message.error)));
      else command.resolve(message.result);
    }
  });

  // `page: false` sends a browser-level command (no session).
  function send(method, params = {}, { page = true, timeout = 60_000 } = {}) {
    const what = describe(method, params);
    if (closed) return Promise.reject(new Error(what + " on " + pageUrl + ": " + closed));
    const commandId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(commandId);
        const error = Object.assign(new Error(what + " timed out after " + timeout / 1000 + "s on " + pageUrl), { timedOut: true });
        t.diagnostic(error.message);
        reject(error);
      }, timeout);
      pending.set(commandId, { resolve, reject, timer, what, started: Date.now() });
      chrome.stdio[3].write(JSON.stringify({ id: commandId, method, params, ...(page && sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  async function evaluate(expression, timeout) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, { timeout });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  // Polls a short expression until it's true. A try that stalls or fails (a navigation or reload in
  // flight, a starved renderer) is abandoned and retried, so only the wait's own deadline (well
  // inside the test's) can fail it, with the expression, page and last error. Tries get 5 s, doubled
  // after each timeout up to 20 s, so a renderer that stays slow still gets to answer.
  async function until(expression, deadline = 90_000) {
    const end = Date.now() + deadline;
    let last, cap = 5_000;
    for (;;) {
      try {
        if (await evaluate(expression, Math.max(1_000, Math.min(cap, end - Date.now())))) return;
        last = undefined;
      } catch (error) {
        if (closed) throw error;
        last = error;
        if (error.timedOut) cap = Math.min(cap * 2, 20_000);
      }
      t.signal.throwIfAborted();
      if (Date.now() > end) throw new Error("Not true after " + deadline / 1000 + "s on " + pageUrl + ": " + expression + (last ? "\nLast try: " + last.message : ""));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  // Opens a fresh about:blank tab and points page commands at it; returns its targetId.
  async function openPage() {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, { page: false });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }, { page: false }));
    await send("Page.enable");
    return targetId;
  }
  // For the test's finally block, before Chrome is killed: stops timers and listeners. Commands
  // still pending are dropped, not rejected, so nothing surfaces as an unhandled rejection.
  function close() {
    closed ??= "CDP connection closed";
    t.signal.removeEventListener("abort", onAbort);
    for (const command of pending.values()) clearTimeout(command.timer);
    pending.clear();
  }
  return { send, evaluate, until, openPage, close, get pageUrl() { return pageUrl; } };
}
