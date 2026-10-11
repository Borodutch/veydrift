import { expect, test } from "bun:test";
import preview from "../contracts/combat-preview-catalog.json";
import refereeCatalog from "./referee-catalog.json";

test("referee unit stats equal the contract-parity catalog (no drift)", () => {
  const contract = [...preview.ships.map((c) => ({ type: c.id, ...c })), ...preview.defenses.map((c) => ({ ...c, type: c.id + 16 }))];
  for (const unit of refereeCatalog.units) {
    const c = contract.find((x) => x.type === unit.type)!;
    expect([unit.key, unit.attack, unit.shield, unit.hull]).toEqual([c.key, c.attack, c.shield, c.hull]);
  }
  expect(refereeCatalog.units.length).toBe(24);
  expect(new Set(refereeCatalog.units.map((u) => u.order)).size).toBe(24);
});

test("rapidfire differs from staged model 2 only by the classic Ion Cannon/Reaper lane", () => {
  const key = (r: { shooter: number; target: number; value: number }) => `${r.shooter}>${r.target}x${r.value}`;
  const model2 = new Set([...preview.shipRapidfire.map((r) => key({ shooter: r.attacker, target: r.defender, value: r.value })),
    ...preview.defenseRapidfire.map((r) => key({ shooter: r.attacker, target: r.defender + 16, value: r.value }))]);
  const lanes = new Set(refereeCatalog.rapidfire.map(key));
  expect([...model2].filter((k) => !lanes.has(k))).toEqual(["13>21x2"]);
  expect([...lanes].filter((k) => !model2.has(k))).toEqual(["21>13x2"]);
});
