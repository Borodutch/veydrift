// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftResourceProjectionGame {
    function planet(uint256 planetId) external view returns (VeydriftGameStorage.Planet memory);

    function activeBuildingConstruction(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.BuildingConstruction memory);

    function buildingLevel(uint256 planetId, Building building) external view returns (uint16);
    function shipCount(uint256 planetId, Ship ship) external view returns (uint32);
    function technologyLevel(address player, Technology technology) external view returns (uint16);
}

contract VeydriftResourceProjectionLens {
    error NoPlanet();

    function effectiveResourceProjection(IVeydriftResourceProjectionGame game, uint256 planetId)
        external
        view
        returns (
            VeydriftGameStorage.Resources memory resources,
            VeydriftGameStorage.Resources memory caps,
            uint256 metalPerHour,
            uint256 crystalPerHour,
            uint256 deuteriumPerHour
        )
    {
        VeydriftGameStorage.Planet memory planetRef = game.planet(planetId);
        if (planetRef.owner == address(0)) revert NoPlanet();

        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        uint64 nowAt = uint64(block.timestamp);

        resources = planetRef.resources;
        if (nowAt > planetRef.lastSettledAt) {
            if (
                construction.active && construction.readyAt > planetRef.lastSettledAt
                    && construction.readyAt <= nowAt
            ) {
                resources = _accrue(
                    game,
                    planetId,
                    planetRef,
                    construction,
                    resources,
                    planetRef.lastSettledAt,
                    construction.readyAt,
                    false
                );
                resources = _accrue(
                    game,
                    planetId,
                    planetRef,
                    construction,
                    resources,
                    construction.readyAt,
                    nowAt,
                    true
                );
            } else {
                bool effective = construction.active && construction.readyAt <= nowAt;
                resources = _accrue(
                    game,
                    planetId,
                    planetRef,
                    construction,
                    resources,
                    planetRef.lastSettledAt,
                    nowAt,
                    effective
                );
            }
        }

        bool currentEffective = construction.active && construction.readyAt <= nowAt;
        (caps.metal, caps.crystal, caps.deuterium) =
            _storageCaps(game, planetId, construction, currentEffective);
        (metalPerHour, crystalPerHour, deuteriumPerHour) =
            _productionPerHour(game, planetId, planetRef, construction, currentEffective);
    }

    function _accrue(
        IVeydriftResourceProjectionGame game,
        uint256 planetId,
        VeydriftGameStorage.Planet memory planetRef,
        VeydriftGameStorage.BuildingConstruction memory construction,
        VeydriftGameStorage.Resources memory resources,
        uint64 fromAt,
        uint64 settledAt,
        bool effective
    ) private view returns (VeydriftGameStorage.Resources memory) {
        uint256 elapsed = uint256(settledAt) - fromAt;
        if (elapsed == 0) return resources;
        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) =
            _productionPerHour(game, planetId, planetRef, construction, effective);
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) =
            _storageCaps(game, planetId, construction, effective);
        resources.metal = _addCapped(resources.metal, (metalPerHour * elapsed) / 1 hours, metalCap);
        resources.crystal =
            _addCapped(resources.crystal, (crystalPerHour * elapsed) / 1 hours, crystalCap);
        resources.deuterium =
            _addCapped(resources.deuterium, (deuteriumPerHour * elapsed) / 1 hours, deuteriumCap);
        return resources;
    }

    function _productionPerHour(
        IVeydriftResourceProjectionGame game,
        uint256 planetId,
        VeydriftGameStorage.Planet memory planetRef,
        VeydriftGameStorage.BuildingConstruction memory construction,
        bool effective
    )
        private
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        return VeydriftFormulas.productionPerHour(
                _buildingLevel(game, planetId, construction, Building.MetalMine, effective),
                _buildingLevel(game, planetId, construction, Building.CrystalMine, effective),
                _buildingLevel(
                    game, planetId, construction, Building.DeuteriumSynthesizer, effective
                ),
                _buildingLevel(game, planetId, construction, Building.SolarPlant, effective),
                _buildingLevel(game, planetId, construction, Building.FusionReactor, effective),
                game.shipCount(planetId, Ship.SolarSatellite),
                game.shipCount(planetId, Ship.Crawler),
                planetRef.temperature,
                game.technologyLevel(planetRef.owner, Technology.Energy),
                planetRef.metalMultiplierBps,
                planetRef.crystalMultiplierBps,
                planetRef.deuteriumMultiplierBps
            );
    }

    function _storageCaps(
        IVeydriftResourceProjectionGame game,
        uint256 planetId,
        VeydriftGameStorage.BuildingConstruction memory construction,
        bool effective
    ) private view returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) {
        return VeydriftFormulas.storageCaps(
            _buildingLevel(game, planetId, construction, Building.MetalStorage, effective),
            _buildingLevel(game, planetId, construction, Building.CrystalStorage, effective),
            _buildingLevel(game, planetId, construction, Building.DeuteriumTank, effective)
        );
    }

    function _buildingLevel(
        IVeydriftResourceProjectionGame game,
        uint256 planetId,
        VeydriftGameStorage.BuildingConstruction memory construction,
        Building building,
        bool effective
    ) private view returns (uint16) {
        if (effective && construction.active && construction.building == building) {
            return construction.targetLevel;
        }
        return game.buildingLevel(planetId, building);
    }

    function _addCapped(uint128 current, uint256 produced, uint128 cap)
        private
        pure
        returns (uint128)
    {
        if (current >= cap) return current;
        uint256 remaining = uint256(cap) - current;
        uint256 added = produced < remaining ? produced : remaining;
        // Casting is safe because added is capped to cap - current.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(uint256(current) + added);
    }
}
