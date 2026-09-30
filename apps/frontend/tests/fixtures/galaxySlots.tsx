// Local regression fixture: real Galaxy component, captured API data, no wallet.
import { render } from "preact";
import { useState } from "preact/hooks";
import { GalaxyView } from "../../src/components/GalaxyView";
import captures from "./galaxySlots.json";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/galaxy-fixture-api/")) return nativeFetch(input, init);
  const parts = url.pathname.split("/");
  const captured = captures.find(row => row.galaxy === Number(parts[4]) && row.system === Number(parts[6]));
  if (!captured) return new Response("Unknown fixture system", { status: 404 });
  let planets = [...captured.planets];
  if (params.has("trailing")) planets = planets.filter(planet => planet.position < 13);
  if (params.has("empty")) planets = [];
  if (params.has("reverse")) planets.reverse();
  return Response.json({ ...captured, planets });
};
function Fixture() {
  const [coords, setCoords] = useState({ galaxy: 5, system: 199 });
  const [selected, setSelected] = useState("");
  return <main style={{ maxWidth: "1100px", margin: "20px auto", padding: "0 16px" }}>
    <GalaxyView {...coords} apiBaseUrl={location.origin + "/galaxy-fixture-api"}
      onNavigate={(galaxy, system) => setCoords({ galaxy, system })}
      onSelectPlanet={coords => setSelected(JSON.stringify(coords))} />
    <output aria-label="Selected coordinates">{selected}</output>
  </main>;
}
document.body.style.background = "#05070d";
render(<Fixture />, document.getElementById("app")!);
