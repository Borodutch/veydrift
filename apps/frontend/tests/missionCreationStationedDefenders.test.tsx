import { describe, expect, test } from "bun:test";
import { stationedDefenderAttackWarningRows } from "../src/components/MissionCreationPage";

describe("MissionCreationPage stationed defender warning", () => {
  test("summarizes active DefenseHold defenders for the attack compose warning", () => {
    const rows = stationedDefenderAttackWarningRows([
      {
        missionId: "41",
        defender: "0x4444444444444444444444444444444444444444",
        defenderDisplayName: "Ally Shield",
        ships: { lightFighter: "15" },
        holdUntil: "1770003600",
        allianceDepotLevel: 2,
      },
    ]);

    expect(rows).toEqual([
      {
        missionId: "41",
        label: "Ally Shield",
        value: expect.stringContaining("15 ships until"),
      },
    ]);
  });
});
