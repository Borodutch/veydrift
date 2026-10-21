// Real public surfaces, without the playable app or wallet bootstrap.
import { render } from "preact";
import { ComingSoonApp } from "../../src/ComingSoonApp";
import "../../src/styles.css";

render(<ComingSoonApp hero={<div>Landing hero</div>} />, document.getElementById("app")!);
