// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Ship, Defense} from "./libraries/VeydriftTypes.sol";

/// @dev Size-only extraction of the existing authorized import replacement path. Adds no upgrade
/// migration: inbound arrivals prevent discarding their target and COW captures precede deletion.
contract VeydriftMigrationDiscardModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

    function discardSingleStartedPlanet(address player) external payable {
        if (planetCountOf[player] != 1 || activeFleetMissionCount[player] != 0) {
            revert AlreadyStarted();
        }
        uint256 planetId = homePlanetOf[player];
        Planet storage planetRef = _planets[planetId];
        if (planetId == 0 || planetRef.owner != player) revert AlreadyStarted();
        _requireNoInboundMissionForPlanet(planetId);

        bytes32 key = VeydriftPlanetGeneration.coordinateKey(
            block.chainid,
            planetRef.galaxy,
            planetRef.system,
            planetRef.position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
        occupiedCoordinates[key] = false;
        _decreaseInternalResources(planetRef.resources);
        _snapshotPlanetScore(planetId);
        delete _planets[planetId];
        delete planetNames[planetId];
        delete buildingConstructions[planetId];
        delete defenseQueues[planetId];
        delete shipQueues[planetId];
        delete _defenseQueueBacklogs[planetId];
        delete _shipQueueBacklogs[planetId];
        for (uint8 id = 0; id <= MAX_BUILDING_ID;) {
            delete _buildingLevels[planetId][Building(id)];
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_SHIP_ID;) {
            _setPlanetShipCount(planetId, Ship(id), 0);
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_DEFENSE_ID;) {
            _setPlanetDefenseCount(planetId, Defense(id), 0);
            unchecked {
                ++id;
            }
        }
        _unregisterOwnedPlanet(player, planetId);
        homePlanetOf[player] = 0;
        planetCountOf[player] = 0;
    }
}
