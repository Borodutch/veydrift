import { render } from "preact";
import { App } from "./App";
import { scheduleFarcasterReady } from "./farcasterReady";
import { canonicalEntityPathForLegacyHashLocation } from "./inspectRoutes";
import "./styles.css";

const canonicalPath = canonicalEntityPathForLegacyHashLocation(window.location);
if (canonicalPath) {
  window.history.replaceState(null, "", canonicalPath);
}

document.documentElement.dataset.veydriftSurface = import.meta.env.MODE;
render(<App />, document.querySelector("#app") as HTMLElement);
scheduleFarcasterReady();
