// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";

/// @notice Deterministic universe slot population rules shared by colonization.
contract VeydriftUniverseRules {
    function isPopulatedPlanetSlot(
        uint256 chainId,
        address universeAddress,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) external pure returns (bool) {
        return VeydriftPlanetGeneration.isPopulatedPlanetSlot(
            chainId, universeAddress, galaxy, system, position, maxGalaxy, maxSystem, maxPosition
        );
    }
}
