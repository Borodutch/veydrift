import { render } from "preact";
import { BackendDataStore } from "../../src/backendDataStore";
import { useBackendDataQuery } from "../../src/useBackendDataQuery";

const store = new BackendDataStore("https://supply-preload.invalid");
store.setContext("0xaaa", "7", "8453");
const query = store.queries.supplySources("0xaaa", "7");
const requests: Array<(response: Response) => void> = [];
const originalFetch = window.fetch;
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("https://supply-preload.invalid/")
  ? new Promise<Response>(resolve => requests.push(resolve)) : originalFetch(input, init)) as typeof fetch;
function Readiness() {
  const { snapshot, isInitialLoading } = useBackendDataQuery(query);
  return <output id="supply-readiness">{isInitialLoading ? "loading" : snapshot?.error ? "error" : String(snapshot?.data?.technologyLevels?.["3"])}</output>;
}
render(<Readiness />, document.getElementById("app")!);
Object.assign(window, { supplyPreload: {
  calls: () => requests.length,
  chain: (chain: string) => store.setContext("0xaaa", "7", chain),
  finish: (index: number, level: number) => requests[index]!(Response.json({ wallet: "0xaaa", technologyLevels: { "3": level }, sources: [], fleetSlots: { active: 0, limit: 10 }, fleetLaunchAvailable: true })),
  dispose: () => { render(null, document.getElementById("app")!); store.dispose(); window.fetch = originalFetch; },
} });
