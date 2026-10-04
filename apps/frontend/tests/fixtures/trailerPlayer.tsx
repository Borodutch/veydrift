// Real public surfaces, without the playable app or wallet bootstrap.
import { render } from "preact";
import { ComingSoonApp } from "../../src/ComingSoonApp";
import { PactApp } from "../../src/components/PactPage";
import "../../src/styles.css";

render(new URLSearchParams(location.search).has("pact")
  ? <PactApp />
  : <ComingSoonApp hero={<div>Landing hero</div>} />, document.getElementById("app")!);
