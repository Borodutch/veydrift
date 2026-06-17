// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftEffectiveStateGame {
    function planet(uint256 planetId) external view returns (VeydriftGameStorage.Planet memory);

    function activeBuildingConstruction(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.BuildingConstruction memory);

    function shipQueue(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.ShipQueue memory);

    function shipQueueBacklog(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.ShipQueue[] memory);

    function defenseQueue(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.DefenseQueue memory);

    function defenseQueueBacklog(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.DefenseQueue[] memory);

    function researchQueue(address player)
        external
        view
        returns (VeydriftGameStorage.ResearchQueue memory);

    function buildingLevel(uint256 planetId, Building building) external view returns (uint16);
    function shipCount(uint256 planetId, Ship ship) external view returns (uint32);
    function defenseCount(uint256 planetId, Defense defense) external view returns (uint32);
    function technologyLevel(address player, Technology technology) external view returns (uint16);
}

contract VeydriftEffectiveStateLens {
    error NoPlanet();

    uint8 private constant MAX_BUILDING_ID = uint8(type(Building).max);
    uint8 private constant MAX_DEFENSE_ID = uint8(type(Defense).max);
    uint8 private constant MAX_SHIP_ID = uint8(type(Ship).max);
    uint8 private constant MAX_TECHNOLOGY_ID = uint8(type(Technology).max);

    function effectivePlanetState(IVeydriftEffectiveStateGame game, uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.EffectivePlanetState memory state)
    {
        state.planet = game.planet(planetId);
        if (state.planet.owner == address(0)) revert NoPlanet();
        state.asOf = uint64(block.timestamp);

        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        VeydriftGameStorage.ShipQueue memory activeShip = game.shipQueue(planetId);
        VeydriftGameStorage.ShipQueue[] memory shipBacklog = game.shipQueueBacklog(planetId);
        VeydriftGameStorage.DefenseQueue memory activeDefense = game.defenseQueue(planetId);
        VeydriftGameStorage.DefenseQueue[] memory defenseBacklog =
            game.defenseQueueBacklog(planetId);
        VeydriftGameStorage.ResearchQueue memory research = game.researchQueue(state.planet.owner);

        for (uint256 i = 0; i <= MAX_BUILDING_ID;) {
            Building building = Building(i);
            state.buildingLevels[i] = game.buildingLevel(planetId, building);
            if (
                construction.active && construction.building == building
                    && construction.readyAt <= state.asOf
            ) {
                state.buildingLevels[i] = construction.targetLevel;
                if (building == Building.Terraformer) {
                    state.planet.fields += 5;
                }
            }
            unchecked {
                ++i;
            }
        }
        for (uint256 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            state.shipCounts[i] = game.shipCount(planetId, ship);
            unchecked {
                ++i;
            }
        }
        if (activeShip.active && activeShip.readyAt <= state.asOf) {
            state.shipCounts[uint8(activeShip.ship)] += activeShip.quantity;
            for (uint256 i = 0; i < shipBacklog.length;) {
                if (shipBacklog[i].readyAt > state.asOf) break;
                state.shipCounts[uint8(shipBacklog[i].ship)] += shipBacklog[i].quantity;
                unchecked {
                    ++i;
                }
            }
        }
        for (uint256 i = 0; i <= MAX_DEFENSE_ID;) {
            Defense defense = Defense(i);
            state.defenseCounts[i] = game.defenseCount(planetId, defense);
            unchecked {
                ++i;
            }
        }
        if (activeDefense.active && activeDefense.readyAt <= state.asOf) {
            state.defenseCounts[uint8(activeDefense.defense)] += activeDefense.quantity;
            for (uint256 i = 0; i < defenseBacklog.length;) {
                if (defenseBacklog[i].readyAt > state.asOf) break;
                state.defenseCounts[uint8(defenseBacklog[i].defense)] += defenseBacklog[i].quantity;
                unchecked {
                    ++i;
                }
            }
        }
        for (uint256 i = 0; i <= MAX_TECHNOLOGY_ID;) {
            Technology technology = Technology(i);
            state.technologyLevels[i] = game.technologyLevel(state.planet.owner, technology);
            if (
                research.active && research.technology == technology
                    && research.readyAt <= state.asOf
            ) {
                state.technologyLevels[i] = research.targetLevel;
            }
            unchecked {
                ++i;
            }
        }

        (state.metalPerHour, state.crystalPerHour, state.deuteriumPerHour) =
            VeydriftFormulas.productionPerHour(
                state.buildingLevels[uint8(Building.MetalMine)],
                state.buildingLevels[uint8(Building.CrystalMine)],
                state.buildingLevels[uint8(Building.DeuteriumSynthesizer)],
                state.buildingLevels[uint8(Building.SolarPlant)],
                state.buildingLevels[uint8(Building.FusionReactor)],
                state.shipCounts[uint8(Ship.SolarSatellite)],
                state.shipCounts[uint8(Ship.Crawler)],
                state.planet.temperature,
                state.technologyLevels[uint8(Technology.Energy)],
                state.planet.metalMultiplierBps,
                state.planet.crystalMultiplierBps,
                state.planet.deuteriumMultiplierBps
            );
        (state.producedEnergy, state.requiredEnergy, state.energyScaleBps) =
            VeydriftFormulas.energyBalance(
                state.buildingLevels[uint8(Building.MetalMine)],
                state.buildingLevels[uint8(Building.CrystalMine)],
                state.buildingLevels[uint8(Building.DeuteriumSynthesizer)],
                state.buildingLevels[uint8(Building.SolarPlant)],
                state.buildingLevels[uint8(Building.FusionReactor)],
                state.shipCounts[uint8(Ship.SolarSatellite)],
                state.planet.temperature,
                state.technologyLevels[uint8(Technology.Energy)]
            );
        (state.storageCaps.metal, state.storageCaps.crystal, state.storageCaps.deuterium) =
            VeydriftFormulas.storageCaps(
                state.buildingLevels[uint8(Building.MetalStorage)],
                state.buildingLevels[uint8(Building.CrystalStorage)],
                state.buildingLevels[uint8(Building.DeuteriumTank)]
            );
    }
}
