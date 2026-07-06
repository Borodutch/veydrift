import { describe, expect, test } from "bun:test";
import {
  landingAllianceRefreshMs,
  landingFeedRefreshMs,
  landingFeedFromMissions,
  landingLaunchCtaForLocation,
  topAlliancesFromHighscores,
} from "../src/ComingSoonApp";

const landingSource = await Bun.file(new URL("../src/ComingSoonApp.tsx", import.meta.url)).text();

describe("landing backend data", () => {
  test("polls landing backend panels while the page remains open", () => {
    expect(landingFeedRefreshMs).toBe(60_000);
    expect(landingAllianceRefreshMs).toBe(300_000);
    expect(landingSource).toContain("window.setInterval(loadLandingFeed, landingFeedRefreshMs)");
    expect(landingSource).toContain("window.setInterval(loadLandingAlliances, landingAllianceRefreshMs)");
    expect(landingSource).toContain("window.clearInterval(intervalId)");
  });

  test("points production visitors at the mainnet play surface", () => {
    expect(landingLaunchCtaForLocation({ hostname: "veydrift.com" })).toMatchObject({
      eyebrow: "Mainnet live on Base",
      primaryHref: "/play",
      primaryLabel: "Play",
      secondaryHref: "https://test.veydrift.com",
      showFaucet: false,
    });
  });

  test("keeps non-production visitors on the Base Sepolia alpha flow", () => {
    expect(landingLaunchCtaForLocation({ hostname: "test.veydrift.com" })).toMatchObject({
      eyebrow: "Alpha test live on Base Sepolia",
      primaryHref: "https://test.veydrift.com",
      primaryLabel: "Join the alpha test",
      secondaryHref: "#how-it-works",
      showFaucet: true,
    });
  });

  test("builds the live alpha feed from active backend missions", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const feed = landingFeedFromMissions([
      {
        arrivalAt: String(Math.floor((now + 90 * 60 * 1_000) / 1_000)),
        missionId: "2",
        missionType: "Transport",
        originPlanet: { coordinates: "1:11:4", name: "Foundry" },
        originPlanetId: "4",
        owner: "0x2222222222222222222222222222222222222222",
        returnAt: String(Math.floor((now + 180 * 60 * 1_000) / 1_000)),
        status: "Outbound",
        targetPlanet: { coordinates: "1:12:5" },
        targetPlanetId: "5",
      },
      {
        arrivalAt: String(Math.floor((now + 30 * 60 * 1_000) / 1_000)),
        missionId: "1",
        missionType: "Attack",
        originPlanet: { coordinates: "2:40:7" },
        originPlanetId: "7",
        owner: "0x1111111111111111111111111111111111111111",
        returnAt: String(Math.floor((now + 120 * 60 * 1_000) / 1_000)),
        status: "Outbound",
        targetPlanet: { coordinates: "2:41:8", name: "Vey Prime" },
        targetPlanetId: "8",
      },
    ], now);

    expect(feed).toEqual([
      {
        label: "Attack",
        tone: "rose",
        value: "0x1111...1111: strike fleet inbound to Vey Prime, arrives in 30m",
      },
      {
        label: "Transport",
        tone: "cyan",
        value: "0x2222...2222: transport convoy crossing from Foundry to 1:12:5, arrives in 1h 30m",
      },
    ]);
  });

  test("leaves the live alpha feed empty instead of inventing activity rows", () => {
    expect(landingFeedFromMissions([])).toEqual([]);
  });

  test("aggregates the alliance board from highscore rows", () => {
    const alliances = topAlliancesFromHighscores([
      {
        alliance: { allianceId: "1", name: "Veydrift Union", tag: "VDFT" },
        score: { total: "1000" },
        wallet: "0x1111111111111111111111111111111111111111",
      },
      {
        alliance: { allianceId: "2", name: "Outer Belt", tag: "BELT" },
        score: { total: "2500" },
        wallet: "0x2222222222222222222222222222222222222222",
      },
      {
        alliance: { allianceId: "1", name: "Veydrift Union", tag: "VDFT" },
        score: { total: "2000" },
        wallet: "0x3333333333333333333333333333333333333333",
      },
      {
        alliance: null,
        score: { total: "9999" },
        wallet: "0x4444444444444444444444444444444444444444",
      },
    ]);

    expect(alliances).toEqual([
      { members: 2, name: "Veydrift Union", score: "3000", tag: "VDFT" },
      { members: 1, name: "Outer Belt", score: "2500", tag: "BELT" },
    ]);
  });
});
