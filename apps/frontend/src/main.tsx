import { render } from "preact";
import { App, preloadPage } from "./App";
import { scheduleFarcasterReady } from "./farcasterReady";
import { canonicalPathForLegacyHashLocation } from "./inspectRoutes";
import { resetDocumentTitle } from "./pageTitle";
import { initSfx } from "./sfx";
import "./styles.css";

const canonicalPath = canonicalPathForLegacyHashLocation(window.location);
if (canonicalPath) {
  window.history.replaceState(null, "", canonicalPath);
}

resetDocumentTitle();
document.documentElement.dataset.veydriftSurface = import.meta.env.MODE;
// A lazy page's chunk loads before the first render, so the app takes over the copy prerendered for
// crawlers (scripts/prerender.mjs) in place instead of showing its loading fallback first.
const root = document.querySelector("#app") as HTMLElement;
// The page's modules run in one task as the chunk arrives; the first render waits for the next task, so neither is
// a long task that holds up a tap (Lighthouse's Total Blocking Time).
const boot = () => void preloadPage().catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve))).then(() => {
  render(<App />, root);
  scheduleFarcasterReady();
  initSfx();
});
// A prerendered page is already on screen, so its code waits for the page to finish loading instead of
// competing with the stylesheet and the first images for the connection.
if (root.hasChildNodes() && document.readyState !== "complete") addEventListener("load", boot, { once: true });
else boot();
