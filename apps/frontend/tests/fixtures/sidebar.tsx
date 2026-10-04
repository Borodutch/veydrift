// Real navigation, presentation-only callbacks. No wallet/provider or API access.
import { render } from "preact";
import { NavBar, type Page } from "../../src/components/NavBar";
import { buildInspectPath } from "../../src/inspectRoutes";
import "../../src/styles.css";
const root = document.getElementById("app")!;
const wallet = "0x1111111111111111111111111111111111111111";
let active: Page = "overview", connected = true, activity = 0, connects = 0;
function show() {
  render(<><header style={{ height: 44 }}>Resources</header>
    <div className="relative z-10 mx-auto flex w-full max-w-[96rem] flex-col overflow-x-clip md:h-[calc(100dvh-var(--topbar-h,2.75rem))] md:flex-row">
      <NavBar active={active} account={connected ? wallet : undefined} signerAccount={wallet}
        coordinates="1:2:3" canEditPlayerProfile onUpdatePlayerProfile={() => {}}
        onConnectWallet={() => { connects++; }} onOpenActivity={() => { activity++; }}
        onNavigate={page => { active = page; history.pushState(null, "", buildInspectPath({ kind: "page", page })); show(); }}
        planetPicker={<button type="button">Fixture planet</button>} />
      <main className="min-w-0 max-w-full flex-1 overflow-visible p-3 md:min-h-0 md:overflow-y-auto" data-app-scrollport><h1>{active}</h1></main>
      <aside className="hidden w-52 shrink-0 md:flex" data-right-rail>Planets</aside>
    </div></>, root);
}
Object.assign(window, { fixture: { show, remount: () => { render(null, root); show(); }, disconnect: () => { connected = false; show(); }, activity: () => activity, connects: () => connects } });
show();
document.body.style.background = "#05070d";
