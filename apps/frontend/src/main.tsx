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
void preloadPage().catch(() => undefined).then(() => {
  render(<App />, document.querySelector("#app") as HTMLElement);
  scheduleFarcasterReady();
  initSfx();
});
