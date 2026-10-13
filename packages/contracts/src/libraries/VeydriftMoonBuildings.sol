// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {IVeydriftMoonGame, VeydriftMoonSystem} from "../VeydriftMoonSystem.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {VeydriftDependencies} from "./VeydriftDependencies.sol";
import {VeydriftFormulas} from "./VeydriftFormulas.sol";
import {VeydriftMoonDefenseBacklog} from "./VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonShipBacklog} from "./VeydriftMoonShipBacklog.sol";
import {MoonBuilding, Technology} from "./VeydriftTypes.sol";

/// @notice Moon building-slot actions (upgrade, demolition, demolition cancel).
/// @dev Public library calls execute by delegatecall, so the Moon proxy's storage is mutated and
///      events are logged by the proxy, while this bytecode stays outside the EIP-170-limited Moon
///      implementation. Callers own the moon-owner check and the due-state settlement.
library VeydriftMoonBuildings {
    using SafeCast for uint256;

    uint16 private constant MAX_LEVEL = 50;
    uint16 private constant QUEUE_UNIVERSE_SPEED = 1;
    uint32 private constant MIN_QUEUE_SECONDS = 1;

    error ConstructionActive();
    error ConstructionInactive();
    error LevelTooHigh();
    error MoonFieldCapacityReached();
    error MoonBuildingNotDemolishable(MoonBuilding building);
    error MoonBuildingInUse(MoonBuilding building);

    event MoonBuildingStarted(
        uint256 indexed planetId,
        MoonBuilding indexed building,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event MoonBuildingDemolitionStarted(
        uint256 indexed planetId,
        MoonBuilding indexed building,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event MoonBuildingDemolitionCancelled(
        uint256 indexed planetId,
        MoonBuilding indexed building,
        uint16 targetLevel,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event MoonResourcesSettled(
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
    );

    function startUpgrade(
        mapping(uint256 => VeydriftMoonSystem.MoonBuildingConstruction) storage constructions,
        mapping(uint256 => mapping(MoonBuilding => uint16)) storage levels,
        mapping(uint256 => VeydriftMoonSystem.Moon) storage moons,
        IVeydriftMoonGame game,
        address player,
        uint256 planetId,
        MoonBuilding building,
        uint64 timestamp
    ) public {
        if (constructions[planetId].active) revert ConstructionActive();

        uint16 currentLevel = levels[planetId][building];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();
        uint256 usedFields;
        for (uint8 i = 0; i <= uint8(type(MoonBuilding).max); i++) {
            usedFields += levels[planetId][MoonBuilding(i)];
        }
        if (usedFields >= moons[planetId].fields) revert MoonFieldCapacityReached();

        VeydriftDependencies.requireMoonBuilding(
            building,
            levels[planetId][MoonBuilding.LunarBase],
            levels[planetId][MoonBuilding.RoboticsFactory],
            game.technologyLevel(player, Technology.Hyperspace)
        );
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.moonBuildingUpgradeCost(building, currentLevel);
        VeydriftGameStorage.Resources memory cost =
            VeydriftGameStorage.Resources(metal, crystal, deuterium);
        _spend(game, planetId, cost, timestamp);

        uint64 readyAt = _readyAt(levels, planetId, cost, timestamp);
        uint16 targetLevel;
        // currentLevel is checked against MAX_LEVEL above.
        unchecked {
            targetLevel = currentLevel + 1;
        }
        constructions[planetId] = VeydriftMoonSystem.MoonBuildingConstruction({
            active: true, building: building, targetLevel: targetLevel, readyAt: readyAt, cost: cost
        });
        emit MoonBuildingStarted(
            planetId, building, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    /// @notice OGame demolition: one level down through the moon's building slot, at the previous
    ///         level's build price less 4% per Ion Technology level. The Lunar Base provides the
    ///         moon's fields and the Shipyard is busy while the moon produces ships or defenses.
    function startDemolition(
        mapping(uint256 => VeydriftMoonSystem.MoonBuildingConstruction) storage constructions,
        mapping(uint256 => mapping(MoonBuilding => uint16)) storage levels,
        mapping(uint256 => VeydriftMoonDefenseBacklog.Entry) storage defenseQueues,
        IVeydriftMoonGame game,
        address player,
        uint256 planetId,
        MoonBuilding building,
        uint64 timestamp
    ) public {
        if (constructions[planetId].active) revert ConstructionActive();

        uint16 currentLevel = levels[planetId][building];
        if (currentLevel == 0 || building == MoonBuilding.LunarBase) {
            revert MoonBuildingNotDemolishable(building);
        }
        if (
            building == MoonBuilding.Shipyard
                && (VeydriftMoonShipBacklog.active(planetId).active
                    || defenseQueues[planetId].active)
        ) {
            revert MoonBuildingInUse(building);
        }

        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.moonBuildingBaseCost(building);
        uint16 ionLevel = _effectiveIonLevel(game, player, timestamp);
        VeydriftGameStorage.Resources memory cost;
        VeydriftGameStorage.Resources memory fullCost;
        (cost.metal, fullCost.metal) = _demolitionCost(metal, currentLevel, ionLevel);
        (cost.crystal, fullCost.crystal) = _demolitionCost(crystal, currentLevel, ionLevel);
        (cost.deuterium, fullCost.deuterium) = _demolitionCost(deuterium, currentLevel, ionLevel);
        _spend(game, planetId, cost, timestamp);

        // Ion Technology lowers the price only; the duration uses the undiscounted cost.
        uint64 readyAt = _readyAt(levels, planetId, fullCost, timestamp);
        uint16 targetLevel = currentLevel - 1;
        constructions[planetId] = VeydriftMoonSystem.MoonBuildingConstruction({
            active: true, building: building, targetLevel: targetLevel, readyAt: readyAt, cost: cost
        });
        emit MoonBuildingDemolitionStarted(
            planetId, building, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    /// @notice Cancels a queued moon demolition before it completes and refunds its full price.
    function cancelDemolition(
        mapping(uint256 => VeydriftMoonSystem.MoonBuildingConstruction) storage constructions,
        mapping(uint256 => mapping(MoonBuilding => uint16)) storage levels,
        IVeydriftMoonGame game,
        uint256 planetId,
        uint64 timestamp
    ) public {
        VeydriftMoonSystem.MoonBuildingConstruction memory construction = constructions[planetId];
        if (
            !construction.active
                || construction.targetLevel >= levels[planetId][construction.building]
        ) {
            revert ConstructionInactive();
        }

        delete constructions[planetId];
        game.grantMoonResources(planetId, construction.cost);
        _emitSettled(game, planetId, timestamp);
        emit MoonBuildingDemolitionCancelled(
            planetId,
            construction.building,
            construction.targetLevel,
            construction.cost.metal,
            construction.cost.crystal,
            construction.cost.deuterium
        );
    }

    /// @dev Moons don't settle the owner's research, so count an Ion level whose research is
    ///      already due, as the planet path does after settling.
    function _effectiveIonLevel(IVeydriftMoonGame game, address player, uint64 timestamp)
        private
        view
        returns (uint16 ionLevel)
    {
        ionLevel = game.technologyLevel(player, Technology.Ion);
        VeydriftGameStorage.ResearchQueue memory research = game.researchQueue(player);
        if (
            research.active && research.technology == Technology.Ion
                && research.readyAt <= timestamp && research.targetLevel > ionLevel
        ) {
            ionLevel = research.targetLevel;
        }
    }

    function _demolitionCost(uint128 base, uint16 currentLevel, uint16 ionLevel)
        private
        pure
        returns (uint128 cost, uint128 fullCost)
    {
        // Moon buildings use the catalog's flat 2x per-level factor.
        (uint256 discounted, uint256 full) =
            VeydriftFormulas.demolitionCost(base, currentLevel, 2, 1, ionLevel);
        return (discounted.toUint128(), full.toUint128());
    }

    function _readyAt(
        mapping(uint256 => mapping(MoonBuilding => uint16)) storage levels,
        uint256 planetId,
        VeydriftGameStorage.Resources memory cost,
        uint64 timestamp
    ) private view returns (uint64) {
        return (uint256(timestamp)
                + VeydriftFormulas.buildingDuration(
                    levels[planetId][MoonBuilding.RoboticsFactory],
                    0,
                    cost.metal,
                    cost.crystal,
                    QUEUE_UNIVERSE_SPEED,
                    MIN_QUEUE_SECONDS
                ))
        .toUint64();
    }

    function _spend(
        IVeydriftMoonGame game,
        uint256 planetId,
        VeydriftGameStorage.Resources memory cost,
        uint64 timestamp
    ) private {
        VeydriftGameStorage.Resources memory available = game.moonResources(planetId);
        if (
            available.metal < cost.metal || available.crystal < cost.crystal
                || available.deuterium < cost.deuterium
        ) {
            revert VeydriftGameStorage.InsufficientResources(
                available.metal, available.crystal, available.deuterium
            );
        }
        game.spendMoonResources(planetId, cost);
        _emitSettled(game, planetId, timestamp);
    }

    function _emitSettled(IVeydriftMoonGame game, uint256 planetId, uint64 timestamp) private {
        VeydriftGameStorage.Resources memory balance = game.moonResources(planetId);
        emit MoonResourcesSettled(
            planetId, balance.metal, balance.crystal, balance.deuterium, timestamp
        );
    }
}
