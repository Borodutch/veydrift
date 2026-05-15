import { useMemo, useState } from "preact/hooks";
import heroUrl from "./assets/veydrift-hero.webp";

type SlotStatus = "free" | "allied" | "hostile" | "ruins";

type SystemSlot = {
  slot: number;
  name: string;
  commander: string;
  alliance: string;
  status: SlotStatus;
  planetClass: string;
  activity: string;
  loot: number;
  debris: number;
  defenses: number;
  fleet: number;
};

type StarSystem = {
  galaxy: number;
  system: number;
  name: string;
  richness: number;
  threat: "low" | "guarded" | "high";
  slots: SystemSlot[];
};

const systems: StarSystem[] = [
  {
    galaxy: 1,
    system: 248,
    name: "Iris Belt",
    richness: 82,
    threat: "guarded",
    slots: [
      {
        slot: 1,
        name: "Kairo Forge",
        commander: "Vega",
        alliance: "Astra",
        status: "allied",
        planetClass: "Iron world",
        activity: "12 min",
        loot: 54,
        debris: 8,
        defenses: 41,
        fleet: 28
      },
      {
        slot: 2,
        name: "Mordane",
        commander: "Umbra",
        alliance: "Null",
        status: "hostile",
        planetClass: "Gas giant",
        activity: "3 min",
        loot: 88,
        debris: 23,
        defenses: 76,
        fleet: 64
      },
      {
        slot: 3,
        name: "Open orbit",
        commander: "-",
        alliance: "-",
        status: "free",
        planetClass: "Temperate",
        activity: "-",
        loot: 0,
        debris: 0,
        defenses: 0,
        fleet: 0
      },
      {
        slot: 4,
        name: "Cinder Reach",
        commander: "Rook",
        alliance: "Drift",
        status: "ruins",
        planetClass: "Ash moon",
        activity: "1 h",
        loot: 36,
        debris: 92,
        defenses: 13,
        fleet: 7
      },
      {
        slot: 5,
        name: "Marrow IX",
        commander: "Yuna",
        alliance: "VY",
        status: "allied",
        planetClass: "Crystal field",
        activity: "34 min",
        loot: 49,
        debris: 15,
        defenses: 58,
        fleet: 40
      },
      {
        slot: 6,
        name: "Black Wake",
        commander: "Axis",
        alliance: "Null",
        status: "hostile",
        planetClass: "Dead rock",
        activity: "online",
        loot: 64,
        debris: 31,
        defenses: 90,
        fleet: 82
      }
    ]
  },
  {
    galaxy: 1,
    system: 249,
    name: "Sable Corridor",
    richness: 61,
    threat: "low",
    slots: [
      {
        slot: 1,
        name: "Lumen Hold",
        commander: "Kade",
        alliance: "VY",
        status: "allied",
        planetClass: "Oceanic",
        activity: "6 min",
        loot: 39,
        debris: 4,
        defenses: 52,
        fleet: 34
      },
      {
        slot: 2,
        name: "Empty slot",
        commander: "-",
        alliance: "-",
        status: "free",
        planetClass: "Arid",
        activity: "-",
        loot: 0,
        debris: 0,
        defenses: 0,
        fleet: 0
      },
      {
        slot: 3,
        name: "Orison",
        commander: "Mara",
        alliance: "Astra",
        status: "allied",
        planetClass: "Forest world",
        activity: "51 min",
        loot: 45,
        debris: 12,
        defenses: 46,
        fleet: 25
      },
      {
        slot: 4,
        name: "Derelict ring",
        commander: "-",
        alliance: "-",
        status: "ruins",
        planetClass: "Debris belt",
        activity: "2 h",
        loot: 15,
        debris: 84,
        defenses: 0,
        fleet: 0
      }
    ]
  },
  {
    galaxy: 2,
    system: 118,
    name: "Copper Dusk",
    richness: 74,
    threat: "high",
    slots: [
      {
        slot: 1,
        name: "Kharon Prime",
        commander: "Hex",
        alliance: "Null",
        status: "hostile",
        planetClass: "Volcanic",
        activity: "online",
        loot: 91,
        debris: 45,
        defenses: 81,
        fleet: 95
      },
      {
        slot: 2,
        name: "Warden",
        commander: "Nox",
        alliance: "Null",
        status: "hostile",
        planetClass: "Fortress moon",
        activity: "8 min",
        loot: 70,
        debris: 18,
        defenses: 96,
        fleet: 72
      },
      {
        slot: 3,
        name: "Open orbit",
        commander: "-",
        alliance: "-",
        status: "free",
        planetClass: "Ice world",
        activity: "-",
        loot: 0,
        debris: 0,
        defenses: 0,
        fleet: 0
      },
      {
        slot: 4,
        name: "Tessera",
        commander: "Sol",
        alliance: "Astra",
        status: "allied",
        planetClass: "Crystal field",
        activity: "25 min",
        loot: 57,
        debris: 9,
        defenses: 62,
        fleet: 48
      }
    ]
  }
];

const resources = [
  { label: "Metal", value: "5.84M", trend: "+42k/h" },
  { label: "Crystal", value: "2.16M", trend: "+18k/h" },
  { label: "Deuterium", value: "918k", trend: "+6k/h" },
  { label: "Energy", value: "14.2k", trend: "98%" }
];

const scannerFeed = [
  "Probe report received from [1:248:2]",
  "Debris recycler ETA 00:18:44",
  "Moon scan anomaly at [1:248:4]",
  "Fleet slot 3 returned from harvest"
];

const statusLabel: Record<SlotStatus, string> = {
  allied: "Allied",
  free: "Free",
  hostile: "Hostile",
  ruins: "Ruins"
};

const filterLabels = ["all", "allied", "hostile", "free", "ruins"] as const;
const fallbackSystem = systems[0]!;

export function App() {
  const [selectedGalaxy, setSelectedGalaxy] = useState(1);
  const [selectedSystem, setSelectedSystem] = useState(248);
  const [selectedSlot, setSelectedSlot] = useState(2);
  const [filter, setFilter] = useState<(typeof filterLabels)[number]>("all");
  const [probeCount, setProbeCount] = useState(6);
  const [cargoCount, setCargoCount] = useState(18);
  const [mission, setMission] = useState("Espionage");

  const visibleSystems = useMemo(
    () => systems.filter((system) => system.galaxy === selectedGalaxy),
    [selectedGalaxy]
  );

  const activeSystem =
    systems.find(
      (system) =>
        system.galaxy === selectedGalaxy && system.system === selectedSystem
    ) ?? fallbackSystem;

  const filteredSlots = activeSystem.slots.filter(
    (slot) => filter === "all" || slot.status === filter
  );

  const activeSlot =
    activeSystem.slots.find((slot) => slot.slot === selectedSlot) ??
    activeSystem.slots[0]!;

  const coordinate = `[${activeSystem.galaxy}:${activeSystem.system}:${activeSlot.slot}]`;

  const jumpToSystem = (system: StarSystem) => {
    setSelectedGalaxy(system.galaxy);
    setSelectedSystem(system.system);
    setSelectedSlot(system.slots[0]!.slot);
  };

  return (
    <main className="universe-shell">
      <img alt="" className="scene-backdrop" src={heroUrl} />
      <div className="scene-shade" />

      <header className="command-bar" aria-label="Command overview">
        <div>
          <p className="eyebrow">Veydrift Command</p>
          <h1>Universe Explorer</h1>
        </div>
        <dl className="resource-strip">
          {resources.map((resource) => (
            <div className="resource-tile" key={resource.label}>
              <dt>{resource.label}</dt>
              <dd>{resource.value}</dd>
              <span>{resource.trend}</span>
            </div>
          ))}
        </dl>
      </header>

      <section className="explorer-grid" aria-label="Universe exploration">
        <aside className="control-panel" aria-label="Navigation controls">
          <div className="panel-heading">
            <p className="eyebrow">Coordinates</p>
            <strong>{coordinate}</strong>
          </div>

          <div className="coordinate-controls">
            <label>
              Galaxy
              <input
                max={2}
                min={1}
                type="number"
                value={selectedGalaxy}
                onInput={(event) => {
                  const nextGalaxy = Number(
                    (event.currentTarget as HTMLInputElement).value
                  );
                  const nextSystem =
                    systems.find((system) => system.galaxy === nextGalaxy) ??
                    activeSystem;
                  jumpToSystem(nextSystem);
                }}
              />
            </label>
            <label>
              System
              <input
                max={499}
                min={1}
                type="number"
                value={selectedSystem}
                onInput={(event) => {
                  const requestedSystem = Number(
                    (event.currentTarget as HTMLInputElement).value
                  );
                  const nextSystem =
                    systems.find(
                      (system) =>
                        system.galaxy === selectedGalaxy &&
                        system.system === requestedSystem
                    ) ?? activeSystem;
                  jumpToSystem(nextSystem);
                }}
              />
            </label>
          </div>

          <div className="system-list" aria-label="Nearby systems">
            {visibleSystems.map((system) => (
              <button
                className={
                  system.system === activeSystem.system
                    ? "system-button selected"
                    : "system-button"
                }
                key={`${system.galaxy}:${system.system}`}
                onClick={() => jumpToSystem(system)}
                type="button"
              >
                <span>[{`${system.galaxy}:${system.system}`}]</span>
                <strong>{system.name}</strong>
                <em>{system.threat}</em>
              </button>
            ))}
          </div>

          <div className="scanner-panel">
            <div className="panel-heading compact">
              <p className="eyebrow">Scanner</p>
              <strong>Live Feed</strong>
            </div>
            <ol>
              {scannerFeed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </aside>

        <section className="system-panel" aria-label="System slots">
          <div className="system-header">
            <div>
              <p className="eyebrow">Galaxy View</p>
              <h2>
                {activeSystem.name}{" "}
                <span>[{`${activeSystem.galaxy}:${activeSystem.system}`}]</span>
              </h2>
            </div>
            <div className="system-stats">
              <span>Richness {activeSystem.richness}%</span>
              <span>Threat {activeSystem.threat}</span>
            </div>
          </div>

          <div className="filter-tabs" aria-label="Slot filters">
            {filterLabels.map((label) => (
              <button
                className={filter === label ? "active" : ""}
                key={label}
                onClick={() => setFilter(label)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="slot-board">
            {filteredSlots.map((slot) => (
              <button
                className={`slot-row ${slot.status} ${
                  slot.slot === activeSlot.slot ? "selected" : ""
                }`}
                key={slot.slot}
                onClick={() => setSelectedSlot(slot.slot)}
                type="button"
              >
                <span className="slot-index">{slot.slot}</span>
                <span className="planet-mark" />
                <span className="slot-main">
                  <strong>{slot.name}</strong>
                  <small>{slot.planetClass}</small>
                </span>
                <span className="slot-meta">
                  <strong>{slot.commander}</strong>
                  <small>{slot.alliance}</small>
                </span>
                <span className="slot-pill">{statusLabel[slot.status]}</span>
                <span className="activity">{slot.activity}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="intel-panel" aria-label="Selected planet intel">
          <div className="target-card">
            <p className="eyebrow">Target</p>
            <h2>{activeSlot.name}</h2>
            <span className={`target-status ${activeSlot.status}`}>
              {statusLabel[activeSlot.status]} orbit
            </span>
            <dl>
              <div>
                <dt>Commander</dt>
                <dd>{activeSlot.commander}</dd>
              </div>
              <div>
                <dt>Alliance</dt>
                <dd>{activeSlot.alliance}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>{activeSlot.activity}</dd>
              </div>
              <div>
                <dt>Class</dt>
                <dd>{activeSlot.planetClass}</dd>
              </div>
            </dl>
          </div>

          <div className="intel-bars">
            <Metric label="Loot" value={activeSlot.loot} />
            <Metric label="Debris" value={activeSlot.debris} />
            <Metric label="Defenses" value={activeSlot.defenses} />
            <Metric label="Fleet" value={activeSlot.fleet} />
          </div>

          <div className="fleet-panel">
            <div className="panel-heading compact">
              <p className="eyebrow">Fleet</p>
              <strong>Dispatch</strong>
            </div>
            <div className="mission-toggle">
              {["Espionage", "Harvest", "Raid"].map((label) => (
                <button
                  className={mission === label ? "active" : ""}
                  key={label}
                  onClick={() => setMission(label)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="range-control">
              Probes
              <input
                max={24}
                min={1}
                type="range"
                value={probeCount}
                onInput={(event) =>
                  setProbeCount(
                    Number((event.currentTarget as HTMLInputElement).value)
                  )
                }
              />
              <span>{probeCount}</span>
            </label>
            <label className="range-control">
              Cargo
              <input
                max={60}
                min={0}
                type="range"
                value={cargoCount}
                onInput={(event) =>
                  setCargoCount(
                    Number((event.currentTarget as HTMLInputElement).value)
                  )
                }
              />
              <span>{cargoCount}</span>
            </label>
            <button className="launch-button" type="button">
              Send {mission} Fleet
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <meter max={100} min={0} value={value}>
        {value}%
      </meter>
    </div>
  );
}
