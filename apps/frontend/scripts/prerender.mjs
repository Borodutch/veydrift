// Prerenders pages for search engines and AI crawlers that don't run JavaScript. It serves the built
// bundle, opens each route in headless Chrome and saves the page it settles on as that route's HTML file
// (/ → index.html, /docs/concepts → docs/concepts.html), which serve.mjs then answers for the route.
// Media and requests to other origins never get an answer, so the saved page is the app's own first
// render rather than live data, and the app boots over it without a flash. The Dockerfile's
// frontend-prerender stage runs it.
// Usage: node scripts/prerender.mjs <build dir> <route>...   (Chrome from CHROME_PATH or the usual places)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import puppeteer from "puppeteer-core";

const [dir, ...routes] = process.argv.slice(2);
if (!dir || !routes.length) throw new Error("usage: prerender.mjs <dir> <route>...");
const chrome = [
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((file) => file && existsSync(file));
if (!chrome) throw new Error("No Chrome found: set CHROME_PATH");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
// /a is a, a.html or a/index.html; any other page gets the app, any other file a 404
const fileFor = (path) =>
  [path, `${path}.html`, join(path, "index.html")]
    .map((file) => join(dir, file))
    .find((file) => existsSync(file) && statSync(file).isFile());
const app = join(dir, existsSync(join(dir, "404.html")) ? "404.html" : "index.html");
// The chunks the build itself preloads; prerendered pages keep only these.
const builtPreloads = [...readFileSync(app, "utf8").matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((match) => match[1]);
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://x").pathname);
  const file = fileFor(path) ?? (extname(path) ? undefined : app);
  if (!file) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Containers run as root with a small /dev/shm
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let rendered;
try {
  // Every route renders from the files as built; they're all written at the end
  rendered = await Promise.all(routes.map(async (route) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const type = request.resourceType();
      if (/^(data|blob):/.test(url)) return request.continue();
      // Media and other origins' data never arrive, so the page stays as the app first draws it (still
      // loading); other origins' scripts and styles fail at once, so the page still loads.
      if (["image", "media", "font"].includes(type) || (!url.startsWith(origin) && ["fetch", "xhr", "eventsource"].includes(type))) return;
      return url.startsWith(origin) ? request.continue() : request.abort();
    });
    // What can still change the page: the bundle's documents, scripts, styles and data.
    let loading = 0;
    const counts = (request) => request.url().startsWith(origin) && !["image", "media", "font"].includes(request.resourceType());
    page.on("request", (request) => counts(request) && loading++);
    page.on("requestfinished", (request) => counts(request) && loading--);
    page.on("requestfailed", (request) => counts(request) && loading--);
    await page.evaluateOnNewDocument(() => {
      window.__changedAt = 0;
      new MutationObserver(() => (window.__changedAt = performance.now())).observe(document, { childList: true, subtree: true, characterData: true });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + route, { waitUntil: "domcontentloaded" });
    // Settled: nothing that can change the page is loading, and the DOM has been still for half a second
    for (const deadline = Date.now() + 20_000; loading || (await page.evaluate(() => performance.now() - window.__changedAt)) < 500;) {
      if (Date.now() > deadline) throw new Error(`${route}: still changing after 20 s`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Preloads the app added while loading are lazy chunks (the WalletConnect bundle among them): saved into
    // the page, every visitor would fetch them up front, competing with the stylesheet for the first paint.
    await page.evaluate((keep) => {
      for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
        if (!keep.includes(new URL(link.href).pathname)) link.remove();
      }
      // A poster downloads with the page wherever its video is; the app sets it once the player nears the screen.
      for (const video of document.querySelectorAll("video[poster]")) video.removeAttribute("poster");
    }, builtPreloads);
    // The page carries the CSS for its top (rules matching something in the first 1600 px, which covers a phone's
    // first screen too, ignoring states like :hover, plus fonts and animations), so the first paint waits only for
    // the HTML. The full stylesheet, for the rest of the page and whatever the app draws later, loads after the page
    // (below). The browser itself does the matching.
    const used = await page.evaluate(() => {
      // Drops pseudo-classes and pseudo-elements, but not the escaped colons of Tailwind variants (.sm\:px-6).
      const bare = (selector) => selector.replace(/(?<!\\)::?[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "").trim();
      const nearTop = (element) => element.getBoundingClientRect().top + window.scrollY < 1600;
      const keep = (rule) => {
        if (rule instanceof CSSStyleRule) {
          try { return [...document.querySelectorAll(bare(rule.selectorText) || "*")].some(nearTop); } catch { return true; }
        }
        if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
          const inner = [...rule.cssRules].filter(keep).map((child) => child.cssText).join("");
          return inner ? `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${inner}}` : false;
        }
        return true; // @font-face, @keyframes, @property and the like
      };
      return [...document.styleSheets].filter((sheet) => sheet.href?.endsWith(".css"))
        .map((sheet) => [...sheet.cssRules].map((rule) => { const kept = keep(rule); return kept === true ? rule.cssText : kept || ""; }).join(""))
        .join("");
    });
    // On screen the page needs only its HTML and the CSS it uses. The full stylesheet (for what the app draws later)
    // and the app itself start once the page has loaded, so nothing competes with the first paint and the first
    // images for the connection; main.tsx then boots at once. Without JavaScript the full stylesheet still applies.
    const styles = [];
    const scripts = [];
    // Links the app added while loading (like the stylesheets of lazy chunks) are absolute; make them root-relative
    const html = (await page.content()).replaceAll(`${origin}/`, "/")
      .replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/g, (_, href) => (styles.push(href), ""))
      .replace(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, src) => (scripts.push(src), ""))
      .replace(/<link rel="modulepreload"[^>]*>/g, "")
      .replace("</head>", `<style>${used}</style>${styles.map((href) => `<noscript><link rel="stylesheet" href="${href}"></noscript>`).join("")}</head>`)
      .replace("</body>", `<script>addEventListener("load",()=>{${[
        ...styles.map((href) => `document.head.append(Object.assign(document.createElement("link"),{rel:"stylesheet",href:${JSON.stringify(href)}}));`),
        ...scripts.map((src) => `document.head.append(Object.assign(document.createElement("script"),{type:"module",src:${JSON.stringify(src)}}));`),
      ].join("")}})</script></body>`);
    if (!scripts.length) throw new Error(`${route}: no app script found in the page`);
    if (errors.length) throw new Error(`${route}: ${errors.join("; ")}`);
    if (html.includes(origin)) throw new Error(`${route}: the page wrote ${origin} into its HTML`);
    await page.close();
    return [fileFor(route) ?? join(dir, `${route.replace(/\/+$/, "")}.html`), route, html];
  }));
} finally {
  await browser.close();
  server.close();
}
for (const [file, route, html] of rendered) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  console.log(`prerendered ${route} → ${file} (${Math.round(html.length / 1024)} KB)`);
}
