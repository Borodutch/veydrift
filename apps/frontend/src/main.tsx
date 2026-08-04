import { render } from "preact";
import { App } from "./App";
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
render(<App />, document.querySelector("#app") as HTMLElement);
scheduleFarcasterReady();
initSfx();
