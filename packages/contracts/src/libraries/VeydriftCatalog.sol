// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Static MVP catalog data for buildables and research.
library VeydriftCatalog {
    error InvalidId();

    function buildingBaseCost(uint8 buildingId) internal pure returns (uint128, uint128, uint128) {
        if (buildingId == 0) return (60, 15, 0);
        if (buildingId == 1) return (48, 24, 0);
        if (buildingId == 2) return (225, 75, 0);
        if (buildingId == 3) return (75, 30, 0);
        if (buildingId == 4) return (400, 120, 0);
        if (buildingId == 5) return (400, 200, 100);
        if (buildingId == 6) return (200, 400, 200);
        if (buildingId == 7) return (1_000, 0, 0);
        if (buildingId == 8) return (1_000, 500, 0);
        if (buildingId == 9) return (1_000, 1_000, 0);
        revert InvalidId();
    }

    function defenseCost(uint8 defenseId) internal pure returns (uint128, uint128, uint128) {
        if (defenseId == 0) return (200, 0, 0);
        if (defenseId == 1) return (1_500, 500, 0);
        if (defenseId == 2) return (6_000, 2_000, 0);
        if (defenseId == 3) return (10_000, 10_000, 0);
        revert InvalidId();
    }

    function shipCost(uint8 shipId) internal pure returns (uint128, uint128, uint128) {
        if (shipId == 0) return (2_000, 2_000, 0);
        if (shipId == 1) return (3_000, 1_000, 0);
        if (shipId == 2) return (10_000, 6_000, 2_000);
        if (shipId == 3) return (10_000, 20_000, 10_000);
        revert InvalidId();
    }

    function researchBaseCost(uint8 technologyId)
        internal
        pure
        returns (uint128, uint128, uint128)
    {
        if (technologyId == 0) return (0, 800, 400);
        if (technologyId == 1) return (200, 100, 0);
        if (technologyId == 2) return (1_000, 300, 100);
        if (technologyId == 3) return (400, 0, 600);
        if (technologyId == 4) return (200, 1_000, 200);
        if (technologyId == 5) return (0, 400, 600);
        if (technologyId == 6) return (800, 200, 0);
        if (technologyId == 7) return (200, 600, 0);
        if (technologyId == 8) return (1_000, 0, 0);
        revert InvalidId();
    }
}
