import { render } from "preact";
import { App } from "./App";
import { scheduleFarcasterReady } from "./farcasterReady";
import "./styles.css";

document.documentElement.dataset.veydriftSurface = import.meta.env.MODE;
render(<App />, document.querySelector("#app") as HTMLElement);
scheduleFarcasterReady();
