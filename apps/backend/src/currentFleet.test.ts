import { expect, test } from "bun:test";
import { deterministicFleetEffects } from "./currentFleet";
import type { FleetMissionSummary } from "./evm";
const mission = (overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary => ({
  missionId: "1", status: "Outbound", missionType: "Transport", owner: "0x123", originPlanetId: "1", targetPlanetId: "2",
  originIsMoon: false, targetIsMoon: false, arrivalAt: "100", returnAt: "200", ships: { smallCargo: "3" },
  cargo: { metal: "10", crystal: "20", deuterium: "30" }, returnCargo: null, ...overrides
} as FleetMissionSummary);
const exists = () => true;
test("transport credits only cargo at arrival, ships and slot at return, never cargo twice", () => {
  expect(deterministicFleetEffects([mission()], 99, exists)).toEqual([]);
  const arrival = deterministicFleetEffects([mission()], 100, exists);
  expect(arrival).toMatchObject([{ planetId: "2", terminal: false, ships: {}, cargo: { metal: "10" } }]);
  expect(deterministicFleetEffects([mission()], 200, exists)).toMatchObject([
    { leg: "arrival", terminal: false }, { leg: "return", planetId: "1", terminal: true, ships: { smallCargo: "3" }, cargo: { metal: "0" } }
  ]);
});
test("deploy credits destination ships, cargo, slot at exact boundary", () => {
  for (const targetIsMoon of [false, true]) expect(deterministicFleetEffects([mission({ missionType: "Deploy", targetIsMoon })], 100, exists)).toMatchObject([
    { planetId: "2", isMoon: targetIsMoon, terminal: true, ships: { smallCargo: "3" }, cargo: { metal: "10" } }
  ]);
});
test("earlier unknown impact blocks a later return but not a different body", () => {
  const returning = mission({ status: "Returning", returnCargo: { metal: "2", crystal: "0", deuterium: "0" } });
  const attack = mission({ missionId: "2", missionType: "Attack", targetPlanetId: "1", originPlanetId: "3" });
  expect(deterministicFleetEffects([returning, attack], 200, exists)).toEqual([]);
  expect(deterministicFleetEffects([returning, { ...attack, targetIsMoon: true }], 200, exists)).toMatchObject([{ leg: "return" }]);
});
test("unknown attack, harvest and hold outcomes never invent ships or loot", () => {
  for (const missionType of ["Attack", "Harvest", "DefenseHold", "AcsAttack", "Intercept"]) {
    expect(deterministicFleetEffects([mission({ missionType })], 1000, exists)).toEqual([]);
  }
});
test("combat returns require survivor and cargo provenance; recalled known fleets are deterministic", () => {
  const returning = mission({ status: "Returning", missionType: "Attack", returnCargo: { metal: "5", crystal: "0", deuterium: "0" } });
  expect(deterministicFleetEffects([returning], 200, exists)).toEqual([]);
  expect(deterministicFleetEffects([{ ...returning, survivingShips: { smallCargo: "1" } }], 200, exists)).toMatchObject([{ ships: { smallCargo: "1" }, cargo: { metal: "5" } }]);
  expect(deterministicFleetEffects([mission({ status: "Recalled", returnCargo: returning.returnCargo })], 200, exists)).toHaveLength(1);
});
test("missing body provenance and terminal stale legs cannot create inventory", () => {
  const missing = mission({ missionType: "Deploy" }); delete missing.targetIsMoon;
  expect(deterministicFleetEffects([missing], 200, exists)).toEqual([]);
  expect(deterministicFleetEffects([mission({ status: "Returned" })], 200, exists)).toEqual([]);
});
test("missing destination moon Deploy returns original cargo and ships without ghost credit", () => {
  const m = mission({missionType: "Deploy", targetIsMoon: true});
  expect(deterministicFleetEffects([m], 100, (_id, moon) => !moon)).toEqual([]);
  expect(deterministicFleetEffects([m], 200, (_id, moon) => !moon)).toMatchObject([{leg: "return", planetId: "1", terminal: true, ships: {smallCargo: "3"}, cargo: {metal: "10"}}]);
});
test("destroyed origin moon falls back to parent without crediting destroyed moon", () => {
  expect(deterministicFleetEffects([mission({ status: "Returning", originIsMoon: true, returnCargo: { metal: "5", crystal: "0", deuterium: "0" } })], 200, (_id, moon) => !moon)).toMatchObject([{ planetId: "1", isMoon: false }]);
});
