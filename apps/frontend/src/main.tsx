import { render } from "preact";
import { App } from "./App";
import { scheduleFarcasterReady } from "./farcasterReady";
import "./styles.css";

render(<App />, document.querySelector("#app") as HTMLElement);
scheduleFarcasterReady();
