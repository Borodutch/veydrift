import { expect, test } from "bun:test";
import { deterministicFleetEffects } from "./currentFleet";
import type { FleetMissionSummary } from "./evm";
const mission = (overrides: Partial<FleetMissionSummary> = {}): FleetMissionSummary => ({
  missionId: "1", status: "Outbound", missionType: "Transport", owner: "0x123", originPlanetId: "1", targetPlanetId: "2",
  originIsMoon: false, targetIsMoon: false, arrivalAt: "100", returnAt: "200", ships: { smallCargo: "3" },
  cargo: { metal: "10", crystal: "20", deuterium: "30" }, returnCargo: null, ...overrides
} as FleetMissionSummary);
const exists = () => true;
test.each(["Transport", "Deploy", "Harvest", "Colonize", "Attack", "DefenseHold"] as const)("%s scalar return never certifies a retained launch manifest", missionType => {
  for (const status of ["Returning", "Recalled"] as const) {
    const returning = mission({ missionType, status, returnCargo: { metal: "0", crystal: "0", deuterium: "0" } });
    expect(deterministicFleetEffects([returning], 200, exists)).toEqual([]);
    expect(deterministicFleetEffects([{ ...returning, survivingShips: { largeCargo: "6" } }], 200, exists)).toMatchObject([{ ships: { largeCargo: "6" } }]);
    expect(deterministicFleetEffects([{ ...returning, survivingShips: {} }], 200, exists)).toMatchObject([{ ships: {} }]);
    expect(deterministicFleetEffects([{ ...returning, survivingShips: { largeCargo: "6" }, returnCargo: undefined } as unknown as FleetMissionSummary], 200, exists)).toEqual([]);
  }
});
test("unknown moon Deploy retains its possible return dependency", () => {
  const deploy=mission({missionType:"Deploy", targetIsMoon:true});
  const later=mission({missionId:"2",originPlanetId:"3",targetPlanetId:"1",arrivalAt:"300",returnAt:"400"});
  expect(deterministicFleetEffects([deploy,later],350,(_id,moon)=>moon?null:true)).toEqual([]);
});
test("unknown origin incarnation reserves moon and parent return surfaces", () => {
  const returning=mission({status:"Returning",originIsMoon:true,returnCargo:{metal:"1",crystal:"0",deuterium:"0"}});
  for(const targetIsMoon of [true,false]) {
    const later=mission({missionId:"2",originPlanetId:"3",targetPlanetId:"1",targetIsMoon,arrivalAt:"300",returnAt:"400"});
    expect(deterministicFleetEffects([returning,later],350,(id,moon,_owner,m)=>id==="1"&&moon&&m?.missionId==="1"?null:true)).toEqual([]);
  }
});
test("staged planet locks also block moon arrivals and their dependent returns", () => {
  const m = mission({targetIsMoon: true});
  expect(deterministicFleetEffects([m], 300, exists, new Map([["2", "9"]]))).toEqual([]);
  expect(deterministicFleetEffects([m], 300, exists)).toHaveLength(2);
});
test("unknown moon identity is not a destroyed moon or a return fallback", () => {
  expect(deterministicFleetEffects([mission({missionType:"Deploy",targetIsMoon:true})], 300, (_id, moon) => moon ? null : true)).toEqual([]);
  expect(deterministicFleetEffects([mission({status:"Returning",originIsMoon:true,returnCargo:{metal:"0",crystal:"0",deuterium:"0"}})],300,(_id,moon)=>moon?null:true)).toEqual([]);
});
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
  const returning = mission({ status: "Returning", survivingShips: { smallCargo: "3" }, returnCargo: { metal: "2", crystal: "0", deuterium: "0" } });
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
  expect(deterministicFleetEffects([mission({ status: "Recalled", survivingShips: { smallCargo: "3" }, returnCargo: returning.returnCargo })], 200, exists)).toHaveLength(1);
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
  expect(deterministicFleetEffects([mission({ status: "Returning", originIsMoon: true, survivingShips: { smallCargo: "3" }, returnCargo: { metal: "5", crystal: "0", deuterium: "0" } })], 200, (_id, moon) => !moon)).toMatchObject([{ planetId: "1", isMoon: false }]);
});
