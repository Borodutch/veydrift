// Real public surfaces, without the playable app or wallet bootstrap.
import { render } from "preact";
import { ComingSoonApp } from "../../src/ComingSoonApp";
import { CcaApp } from "../../src/components/CcaPage";
import "../../src/styles.css";

render(new URLSearchParams(location.search).has("cca")
  ? <CcaApp />
  : <ComingSoonApp hero={<div>Landing hero</div>} />, document.getElementById("app")!);
