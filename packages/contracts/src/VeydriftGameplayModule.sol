// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftDefenseHoldStorage} from "./libraries/VeydriftDefenseHoldStorage.sol";
import {VeydriftFleetFuel} from "./libraries/VeydriftFleetFuel.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {IVeydriftAttackRandomnessEngine} from "./interfaces/IVeydriftAttackRandomnessEngine.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftProductionSettler {
    function settleProductionUntil(uint256 planetId, uint64 settledAt) external;
}

interface IVeydriftCounterplayAllianceSystem {
    function counterplayDefenseFuelContext(
        address viewer,
        uint256 defenderPlanetId,
        uint256 hostileMissionId,
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) external view returns (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport);
}

interface IVeydriftAttackTargetQueueSettler {
    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external;
}

interface IVeydriftArrivalOrderPreparer {
    function launchInterplanetaryMissileAttack(
        uint256 missionId,
        uint256 planetId,
        Defense internalMarker,
        uint32 quantity
    ) external returns (uint256);
}

/// @notice Delegatecall target for stateful gameplay paths that would push VeydriftGame over EIP-170.
contract VeydriftGameplayModule is VeydriftResourceReserves {
    bytes4 private constant LAUNCH_FLEET_MISSION_SELECTOR = bytes4(
        keccak256(
            "launchFleetMission(uint256,uint256,uint8,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16,uint256)"
        )
    );
    bytes4 private constant RESOLVE_COMBAT_ROUND_SELECTOR =
        bytes4(keccak256("resolveFleetMissionCombatRound(uint256)"));
    // Leave enough gas in the parent frame to catch an out-of-gas child round and return the
    // already-committed rounds successfully. EIP-150 also retains 1/64 of forwarded gas.
    uint256 private constant COMBAT_ROUND_PARENT_GAS_RESERVE = 500_000;
    bytes4 private constant LAUNCH_BODY_FLEET_MISSION_SELECTOR = bytes4(
        keccak256(
            "launchBodyFleetMission(uint256,uint256,uint8,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16,bool,bool)"
        )
    );

    using SafeCast for uint256;

    address private immutable _combatModule;

    constructor(address combatModule) VeydriftResourceReserves(address(0)) {
        _combatModule = combatModule;
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        return _launchFleetMission(
            originPlanetId,
            targetPlanetId,
            missionType,
            ships,
            cargo,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            randomnessRequestId
        );
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint16 speedPercent,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        return _launchFleetMission(
            originPlanetId,
            targetPlanetId,
            missionType,
            ships,
            cargo,
            speedPercent,
            randomnessRequestId
        );
    }

    /// @notice Launch an Attack mission with a player-selected loot ratio (metal/crystal/deuterium
    ///         bps split applied to cargo capacity, with capacity rollover for unfillable shares).
    /// @dev The three bps shares must sum to exactly `BPS`. The mission itself is created by reusing
    ///      the standard launch path: this call's calldata is re-dispatched as `launchFleetMission`
    ///      (with the `Attack` mission type spliced in and the trailing loot ratio dropped) through
    ///      the game facade, avoiding both a third inlined copy of the large launch routine and any
    ///      costly struct re-encoding here. The loot ratio is then recorded on the created mission.
    function launchAttackMission(
        uint256,
        uint256,
        MissionShips calldata,
        Resources calldata,
        uint16,
        uint256,
        LootRatio calldata lootRatio
    ) external returns (uint256 missionId) {
        if (uint256(lootRatio.metalBps) + lootRatio.crystalBps + lootRatio.deuteriumBps != BPS) {
            revert InvalidLootRatio();
        }
        bytes4 selector = LAUNCH_FLEET_MISSION_SELECTOR;
        bool ok;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            // origin + target (two words) copied verbatim after the selector
            calldatacopy(add(ptr, 0x04), 0x04, 0x40)
            // splice in the Attack mission type as the third argument
            mstore(add(ptr, 0x44), 3)
            // remaining args (ships, cargo, speed, randomnessRequestId), dropping the loot ratio tail
            let restLen := sub(calldatasize(), 0xA4)
            calldatacopy(add(ptr, 0x64), 0x44, restLen)
            ok := delegatecall(gas(), address(), ptr, add(restLen, 0x64), ptr, 0x20)
            missionId := mload(ptr)
            if iszero(ok) {
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
        }
        _fleetMissions[missionId].lootRatio = lootRatio;
        emit FleetMissionLootRatio(
            missionId, lootRatio.metalBps, lootRatio.crystalBps, lootRatio.deuteriumBps
        );
    }

    /// @notice Launch a planet/moon Attack mission with the same player-selected loot ratio used
    ///         by planet-to-planet attacks.
    /// @dev Re-dispatches to the established body-aware launch path, then records the ratio on the
    ///      created mission. The facade routes that nested call to VeydriftDefenseHoldModule, so
    ///      body validation, fuel, inventory, and randomness continue to have one implementation.
    function launchBodyAttackMission(
        uint256,
        uint256,
        MissionShips calldata,
        Resources calldata,
        uint16,
        bool,
        bool,
        LootRatio calldata lootRatio
    ) external returns (uint256 missionId) {
        if (uint256(lootRatio.metalBps) + lootRatio.crystalBps + lootRatio.deuteriumBps != BPS) {
            revert InvalidLootRatio();
        }
        bytes4 selector = LAUNCH_BODY_FLEET_MISSION_SELECTOR;
        bool ok;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            calldatacopy(add(ptr, 0x04), 0x04, 0x40)
            mstore(add(ptr, 0x44), 3)
            let restLen := sub(calldatasize(), 0xA4)
            calldatacopy(add(ptr, 0x64), 0x44, restLen)
            ok := delegatecall(gas(), address(), ptr, add(restLen, 0x64), ptr, 0x20)
            missionId := mload(ptr)
            if iszero(ok) {
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
        }
        _fleetMissions[missionId].lootRatio = lootRatio;
        emit FleetMissionLootRatio(
            missionId, lootRatio.metalBps, lootRatio.crystalBps, lootRatio.deuteriumBps
        );
    }

    function _launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips memory ships,
        Resources memory cargo,
        uint16 speedPercent,
        uint256 randomnessRequestId
    ) private returns (uint256 missionId) {
        _requirePlanetOwner(originPlanetId);
        uint256 hostileMissionId;
        bool counterplayMission =
            missionType == FleetMissionType.AcsDefend || missionType == FleetMissionType.Intercept;
        if (counterplayMission) {
            hostileMissionId = targetPlanetId;
            FleetMission storage hostile = _fleetMissions[hostileMissionId];
            if (
                hostile.status != FleetMissionStatus.Outbound
                    || hostile.missionType != FleetMissionType.Attack
            ) {
                revert InvalidMissionType(missionType);
            }
            targetPlanetId = hostile.targetPlanetId;
        }
        if (
            !counterplayMission && originPlanetId == targetPlanetId
                && missionType != FleetMissionType.Harvest
        ) {
            revert SamePlanet();
        }
        if (_planets[targetPlanetId].owner == address(0)) revert NoPlanet();
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        _settleActionPlanet(originPlanetId);
        if (
            missionType == FleetMissionType.Colonize
                || uint8(missionType) > uint8(FleetMissionType.Intercept)
        ) {
            // DefenseHold (OGame-style ACS Defend) is launched via the planet-management module.
            revert InvalidMissionType(missionType);
        }
        if (missionType == FleetMissionType.Attack) {
            _enforceAttackProtection(msg.sender, targetPlanetId, false);
        }
        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[msg.sender][Technology.Computer]
        );
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        (uint256 capacity, uint256 slowestSpeed) = _missionMovement(msg.sender, ships);
        if (capacity == 0) revert InvalidQuantity();
        if (missionType == FleetMissionType.Harvest) {
            if (ships.recycler == 0) revert InvalidQuantity();
            DebrisField storage field = _debrisFields[targetPlanetId];
            if (field.metal == 0 && field.crystal == 0) revert DebrisFieldEmpty();
        }
        _requireMissionShips(originPlanetId, ships);

        if (missionType == FleetMissionType.Transport || missionType == FleetMissionType.Deploy) {
            _requirePlanetOwner(targetPlanetId);
        }

        uint256 travelDistance = originPlanetId == targetPlanetId
            && missionType == FleetMissionType.Harvest
            ? LOCAL_HARVEST_DISTANCE
            : _planetDistance(originPlanetId, targetPlanetId);
        uint128 fuelCost = _toUint128(
            _ogameMissionFuelCost(msg.sender, ships, travelDistance, speedPercent, slowestSpeed)
        );
        uint64 departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            travelDistance, slowestSpeed, speedPercent, FLEET_UNIVERSE_SPEED
        );
        uint64 arrivalAt = (uint256(departureAt) + travelSeconds).toUint64();
        if (counterplayMission) {
            FleetMission storage hostile = _fleetMissions[hostileMissionId];
            if (arrivalAt > hostile.arrivalAt) {
                revert FleetAlreadyArrived();
            }
            (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport) = IVeydriftCounterplayAllianceSystem(
                    _allianceSystem
                )
                .counterplayDefenseFuelContext(
                    msg.sender,
                    targetPlanetId,
                    hostileMissionId,
                    ships,
                    hostile.arrivalAt - arrivalAt
                );
            if (!canCoordinate) {
                revert InvalidQuantity();
            }
            if (depotSupport != 0) {
                _settleResources(targetPlanetId);
                _spend(targetPlanetId, Resources({metal: 0, crystal: 0, deuterium: depotSupport}));
            }
            fuelCost = _toUint128(uint256(fuelCost) + netHoldingFuelCost);
            arrivalAt = hostile.arrivalAt;
            randomnessRequestId = hostileMissionId;
        }
        uint256 cargoTotal =
            uint256(cargo.metal) + uint256(cargo.crystal) + uint256(cargo.deuterium);
        uint256 committedCapacity = cargoTotal + fuelCost;
        if (committedCapacity > capacity) {
            revert CargoCapacityExceeded(capacity, committedCapacity);
        }
        _spend(
            originPlanetId,
            Resources({
                metal: cargo.metal,
                crystal: cargo.crystal,
                deuterium: _toUint128(uint256(cargo.deuterium) + fuelCost)
            })
        );
        _increaseInternalResources(cargo);
        _debitMissionShips(originPlanetId, ships);

        uint64 returnAt = (uint256(arrivalAt) + travelSeconds).toUint64();
        missionId = nextFleetId++;
        if (missionType == FleetMissionType.Attack) {
            randomnessRequestId = _requestAttackBattleRandomness(missionId);
        }
        activeFleetMissionCount[msg.sender] += 1;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: missionType,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: targetPlanetId,
            departureAt: departureAt,
            arrivalAt: arrivalAt,
            returnAt: returnAt,
            fuelCost: fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: randomnessRequestId,
            lootRatio: LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 0}),
            originIsMoon: false,
            targetIsMoon: false
        });
        _trackMissionResolution(missionId, _fleetMissions[missionId]);
        if (missionType == FleetMissionType.Attack) {
            _recordAttack(msg.sender, targetPlanetId);
        } else if (counterplayMission) {
            _fleetCounterplayMissions[hostileMissionId].push(missionId);
            _trackCounterplayMissionResolution(hostileMissionId, _fleetMissions[missionId]);
        }

        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            missionType,
            originPlanetId,
            targetPlanetId,
            arrivalAt,
            returnAt,
            randomnessRequestId
        );
        emit FleetMissionCargo(missionId, cargo.metal, cargo.crystal, cargo.deuterium, fuelCost);
        _emitFleetMissionShips(missionId, ships);
    }

    function _enforceAttackProtection(address attacker, uint256 targetPlanetId, bool targetIsMoon)
        private
        view
    {
        (bool ok, bytes memory data) = address(this)
            .staticcall(abi.encodeWithSelector(0xcc4cc1ea, attacker, targetPlanetId, targetIsMoon));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(data, 32), mload(data))
            }
        }
    }

    function _requestAttackBattleRandomness(uint256 missionId) private returns (uint256 requestId) {
        address randomnessEngine = _randomnessEngine;
        if (randomnessEngine == address(0)) revert RandomnessEngineUnset();
        return IVeydriftAttackRandomnessEngine(randomnessEngine)
            .requestRandomness(_attackBattlePurposeHash(missionId));
    }

    function _emitFleetMissionShips(uint256 missionId, MissionShips memory ships) private {
        emit FleetMissionShips(
            missionId,
            ships.smallCargo,
            ships.lightFighter,
            ships.recycler,
            ships.colonyShip,
            ships.largeCargo,
            ships.heavyFighter,
            ships.cruiser,
            ships.battleship,
            ships.bomber,
            ships.destroyer,
            ships.deathstar,
            ships.battlecruiser,
            ships.reaper,
            ships.pathfinder
        );
    }

    function recallFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.missionType == FleetMissionType.MissileAttack) {
            revert InvalidMissionType(mission.missionType);
        }
        _requireActiveMissionOwner(mission);
        if (mission.status == FleetMissionStatus.Returning) revert FleetAlreadyReturning();
        if (mission.status != FleetMissionStatus.Outbound) {
            revert FleetMissionNotResolved(mission.returnAt);
        }
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(mission.originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(mission.targetPlanetId);
        uint64 currentTime = _currentTimestamp();
        if (currentTime >= mission.arrivalAt) revert FleetAlreadyArrived();
        uint64 recallDeadline = mission.arrivalAt - FLEET_RECALL_CUTOFF_SECONDS;
        if (currentTime > recallDeadline) revert FleetRecallCutoffPassed(recallDeadline);

        _settleResources(mission.originPlanetId);

        uint64 elapsed = uint64(
            VeydriftAntiRaidPrimitives.recallReturnSeconds(currentTime - mission.departureAt)
        );
        mission.status = FleetMissionStatus.Recalled;
        mission.returnAt = uint64(currentTime + elapsed);
        _untrackMissionResolution(missionId, mission);
        if (_isCounterplayMissionType(mission.missionType)) {
            _untrackCounterplayMissionResolution(mission.randomnessRequestId, mission);
        }

        // OGame parity: mission fuel is paid in full at dispatch. Recalling only turns the fleet
        // around; it neither refunds fuel nor charges the origin any additional deuterium.
        emit FleetMissionRecalled(missionId, msg.sender, mission.returnAt, 0);
        emit FleetMissionReturnExposed(
            missionId,
            msg.sender,
            FleetMissionStatus.Recalled,
            mission.originPlanetId,
            mission.targetPlanetId,
            mission.returnAt,
            mission.cargo.metal,
            mission.cargo.crystal,
            mission.cargo.deuterium
        );
    }

    function resolveFleetMission(uint256 missionId) external {
        // Resolution mutates balances, fleets, and (for attacks) Rift-locked claims. It must obey
        // the emergency pause just like every player-triggered state transition.
        _requireGameNotPaused();
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);
        FleetMissionType missionType = mission.missionType;

        // Any planet arrival that settles target queues must respect an earlier missile impact.
        // Otherwise a later Transport/Deploy could complete ABMs through the resolver's current
        // timestamp before the earlier missile snapshots defenses at its historical arrival time.
        // The helper only orders pairs where either mission is a MissileAttack, so ordinary fleet
        // missions retain their existing permissionless resolution behavior.
        if (
            IVeydriftArrivalOrderPreparer(address(this))
                    .launchInterplanetaryMissileAttack(
                        missionId, mission.targetPlanetId, Defense.RocketLauncher, 0
                    ) == 0
        ) return;

        if (missionType == FleetMissionType.Attack) {
            _settleAttackTargetSnapshot(mission.targetPlanetId, mission.arrivalAt);
            // OGame-style ACS Defend: pull every fleet stationed over this attack's arrival into the
            // attack's counterplay roster so the battle machinery fights them as defenders.
            // DefenseHold is body-scoped. A fleet stationed over the parent planet must not
            // silently join combat against its moon.
            VeydriftDefenseHoldStorage.linkQualifiedDefenders(
                _stationedDefenseMissions[mission.targetPlanetId],
                _fleetCounterplayMissions[missionId],
                _fleetMissions,
                _defenseHoldUntil,
                mission.arrivalAt,
                mission.targetIsMoon
            );
        } else {
            _settleResources(mission.targetPlanetId);
        }
        if (missionType == FleetMissionType.Transport || missionType == FleetMissionType.Deploy) {
            // Both transport and deploy credit the target's cargo on arrival; share the credit + the
            // single authoritative `_emitPlanetSettled` (VEY-KANEO-475) and branch only on the
            // mission-type-specific bookkeeping that follows.
            _planets[mission.targetPlanetId].resources =
                _add(_planets[mission.targetPlanetId].resources, mission.cargo);
            _emitPlanetSettled(mission.targetPlanetId);
            if (missionType == FleetMissionType.Transport) {
                mission.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
                mission.status = FleetMissionStatus.Returning;
            } else {
                _creditMissionShips(mission.targetPlanetId, mission.ships);
                mission.status = FleetMissionStatus.Resolved;
                mission.returnAt = _currentTimestamp();
                activeFleetMissionCount[mission.owner] -= 1;
                // Deploy is terminal at arrival (ships stay at target, no return leg): untrack now.
                _untrackMissionResolution(missionId, mission);
            }
        } else if (missionType == FleetMissionType.Attack) {
            if (!_resolveCombatInLargestGasSafeChunk(missionId)) return;
            // Lazy reconcile (VEY-KANEO-468 Phase 2c): untrack only the terminal no-survivor
            // (Resolved) battle here. A surviving fleet becomes Returning and stays enumerable until
            // its return lands, so the lazy return settler can complete it with no keeper tx.
            if (mission.status == FleetMissionStatus.Resolved) {
                _untrackMissionResolution(missionId, mission);
            }
        } else if (missionType == FleetMissionType.Harvest) {
            _harvestDebris(mission);
            mission.status = FleetMissionStatus.Returning;
            emit FleetMissionReturnExposed(
                missionId,
                mission.owner,
                FleetMissionStatus.Returning,
                mission.originPlanetId,
                mission.targetPlanetId,
                mission.returnAt,
                mission.cargo.metal,
                mission.cargo.crystal,
                mission.cargo.deuterium
            );
            emit FleetMissionResolved(missionId, msg.sender, missionType, mission.returnAt);
        } else {
            if (_fleetMissions[mission.randomnessRequestId].status == FleetMissionStatus.Outbound) {
                return;
            }
            mission.status = FleetMissionStatus.Returning;
        }

        emit FleetMissionResolved(missionId, msg.sender, missionType, mission.returnAt);
        if (mission.status == FleetMissionStatus.Returning) {
            emit FleetMissionReturnExposed(
                missionId,
                mission.owner,
                FleetMissionStatus.Returning,
                mission.originPlanetId,
                mission.targetPlanetId,
                mission.returnAt,
                mission.cargo.metal,
                mission.cargo.crystal,
                mission.cargo.deuterium
            );
        }
    }

    /// @dev Self-only round entrypoint. The outer resolver calls this through the Game facade so each
    ///      round has its own revert boundary while all successful rounds remain in one transaction.
    function resolveFleetMissionCombatRound(uint256) external returns (bool complete) {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        address module = _combatModule;
        (bool ok, bytes memory result) = module.delegatecall(msg.data);
        if (!ok) {
            if (result.length != 0) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
            // Preserve an empty revert so the outer chunker can distinguish a child-frame
            // out-of-gas boundary from a semantic combat failure. Reverting this frame rolls back
            // only the attempted round; previously completed rounds in the parent transaction stay.
            assembly ("memory-safe") {
                revert(0, 0)
            }
        }
        if (result.length != 32) revert UnsupportedGameplayModule();
        complete = abi.decode(result, (bool));
    }

    function _resolveCombatInLargestGasSafeChunk(uint256 missionId)
        private
        returns (bool complete)
    {
        while (_fleetMissions[missionId].status == FleetMissionStatus.Outbound) {
            uint256 availableGas = gasleft();
            if (availableGas <= COMBAT_ROUND_PARENT_GAS_RESERVE) return false;
            (bool ok, bytes memory result) = address(this)
            .call{gas: availableGas - COMBAT_ROUND_PARENT_GAS_RESERVE}(
                abi.encodeWithSelector(RESOLVE_COMBAT_ROUND_SELECTOR, missionId)
            );
            if (!ok) {
                // Empty returndata is the expected signal when the next complete round cannot fit.
                // Any semantic revert (pending randomness, pause, bad state) must remain visible.
                if (result.length != 0) {
                    assembly ("memory-safe") {
                        revert(add(result, 0x20), mload(result))
                    }
                }
                return false;
            }
            if (result.length != 32) revert UnsupportedGameplayModule();
            complete = abi.decode(result, (bool));
            if (complete) return true;
        }
        return true;
    }

    function _harvestDebris(FleetMission storage mission) private {
        DebrisField storage field = _debrisFields[mission.targetPlanetId];
        (uint256 capacity,) = VeydriftFleetFuel.missionMovement(mission.ships, 0, 0, 0);
        uint256 cargoTotal =
            uint256(mission.cargo.metal) + mission.cargo.crystal + mission.cargo.deuterium;

        unchecked {
            capacity -= cargoTotal;
        }
        uint128 metal;
        uint128 crystal;
        if (field.metal < field.crystal) {
            metal = _toUint128(_min(field.metal, capacity / 2));
            unchecked {
                crystal = _toUint128(_min(field.crystal, capacity - metal));
            }
        } else {
            crystal = _toUint128(_min(field.crystal, capacity / 2));
            unchecked {
                metal = _toUint128(_min(field.metal, capacity - crystal));
            }
        }

        unchecked {
            field.metal -= metal;
            field.crystal -= crystal;
            mission.cargo.metal += metal;
            mission.cargo.crystal += crystal;
        }
        emit DebrisFieldUpdated(mission.targetPlanetId, field.metal, field.crystal);
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireShips(uint256 planetId, Ship ship, uint32 quantity) private view {
        uint32 available = _shipCounts[planetId][ship];
        if (available < quantity) revert InsufficientShips(ship, available, quantity);
    }

    function _settleResources(uint256 planetId) private {
        uint64 currentTime = _currentTimestamp();
        _settleResourcesUntil(planetId, currentTime);
        _settleDuePlanet(planetId);
    }

    function _settleAttackTargetSnapshot(uint256 planetId, uint64 impactAt) private {
        _settleResourcesUntil(planetId, impactAt);
        IVeydriftAttackTargetQueueSettler(address(this))
            .completeAttackTargetSnapshotQueues(planetId, impactAt);
    }

    function _settleResourcesUntil(uint256 planetId, uint64 settledAt) private {
        IVeydriftProductionSettler(address(this)).settleProductionUntil(planetId, settledAt);
    }

    function _productionPerHour(uint256 planetId)
        private
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        Planet storage planetRef = _planets[planetId];
        return VeydriftFormulas.productionPerHour(
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
            _buildingLevels[planetId][Building.FusionReactor],
            _shipCounts[planetId][Ship.SolarSatellite],
            _shipCounts[planetId][Ship.Crawler],
            planetRef.temperature,
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
    }

    function _spend(uint256 planetId, Resources memory cost) private {
        _settleResources(planetId);
        Resources storage available = _planets[planetId].resources;
        if (
            available.metal < cost.metal || available.crystal < cost.crystal
                || available.deuterium < cost.deuterium
        ) {
            revert InsufficientResources(available.metal, available.crystal, available.deuterium);
        }
        available.metal -= cost.metal;
        available.crystal -= cost.crystal;
        available.deuterium -= cost.deuterium;
        _decreaseInternalResources(cost);
        _emitPlanetSettled(planetId);
    }

    function _cappedResourceIncrease(
        uint256 planetId,
        Resources memory currentResources,
        Resources memory produced
    ) private view returns (Resources memory capped, Resources memory added) {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = _storageCaps(planetId);
        capped = Resources({
            metal: _addWithCap(currentResources.metal, produced.metal, metalCap),
            crystal: _addWithCap(currentResources.crystal, produced.crystal, crystalCap),
            deuterium: _addWithCap(currentResources.deuterium, produced.deuterium, deuteriumCap)
        });
        added = Resources({
            metal: capped.metal - currentResources.metal,
            crystal: capped.crystal - currentResources.crystal,
            deuterium: capped.deuterium - currentResources.deuterium
        });
    }

    function _storageCaps(uint256 planetId)
        private
        view
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        if (_planets[planetId].owner == address(0)) revert NoPlanet();
        return VeydriftFormulas.storageCaps(
            _buildingLevels[planetId][Building.MetalStorage],
            _buildingLevels[planetId][Building.CrystalStorage],
            _buildingLevels[planetId][Building.DeuteriumTank]
        );
    }

    function _addWithCap(uint128 current, uint128 addition, uint128 cap)
        private
        pure
        returns (uint128)
    {
        uint256 total = uint256(current) + addition;
        uint256 effectiveCap = current > cap ? current : cap;
        return _toUint128(total > effectiveCap ? effectiveCap : total);
    }

    function _requireActiveMissionOwner(FleetMission storage mission) private view {
        if (
            mission.status == FleetMissionStatus.None
                || mission.status == FleetMissionStatus.Returned
        ) {
            revert FleetInactive();
        }
        if (mission.owner != msg.sender) revert FleetNotOwner();
    }

    function _requireMissionShips(uint256 planetId, MissionShips memory ships) private view {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) _requireShips(planetId, ship, quantity);
            unchecked {
                ++i;
            }
        }
    }

    function _debitMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            _debitPlanetShips(planetId, ship, _missionShipQuantity(ships, ship));
            unchecked {
                ++i;
            }
        }
    }

    function _creditMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            _creditPlanetShips(planetId, ship, _missionShipQuantity(ships, ship));
            unchecked {
                ++i;
            }
        }
    }

    function _missionMovement(address player, MissionShips memory ships)
        private
        view
        returns (uint256 capacity, uint256 slowestSpeed)
    {
        return VeydriftFleetFuel.missionMovement(
            ships,
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive]
        );
    }

    function _ogameMissionFuelCost(
        address player,
        MissionShips memory ships,
        uint256 distance,
        uint16 speedPercent,
        uint256 slowestSpeed
    ) private view returns (uint256) {
        return VeydriftFleetFuel.ogameMissionFuelCost(
            ships,
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive],
            distance,
            speedPercent,
            slowestSpeed
        );
    }

    function _missionShipQuantity(MissionShips memory ships, Ship ship)
        private
        pure
        returns (uint32)
    {
        if (ship == Ship.SmallCargo) return ships.smallCargo;
        if (ship == Ship.LightFighter) return ships.lightFighter;
        if (ship == Ship.Recycler) return ships.recycler;
        if (ship == Ship.ColonyShip) return ships.colonyShip;
        if (ship == Ship.LargeCargo) return ships.largeCargo;
        if (ship == Ship.HeavyFighter) return ships.heavyFighter;
        if (ship == Ship.Cruiser) return ships.cruiser;
        if (ship == Ship.Battleship) return ships.battleship;
        if (ship == Ship.Bomber) return ships.bomber;
        if (ship == Ship.Destroyer) return ships.destroyer;
        if (ship == Ship.Deathstar) return ships.deathstar;
        if (ship == Ship.Battlecruiser) return ships.battlecruiser;
        if (ship == Ship.Reaper) return ships.reaper;
        if (ship == Ship.Pathfinder) return ships.pathfinder;
        return 0;
    }

    function _delegateToCombatModule() private {
        address module = _combatModule;
        (bool ok, bytes memory result) = module.delegatecall(msg.data);
        if (ok) return;
        if (result.length != 0) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        revert UnsupportedGameplayModule();
    }

    function _isCounterplayMissionType(FleetMissionType missionType) private pure returns (bool) {
        return missionType == FleetMissionType.AcsAttack
            || missionType == FleetMissionType.AcsDefend
            || missionType == FleetMissionType.Intercept;
    }

    function _planetDistance(uint256 originPlanetId, uint256 destinationPlanetId)
        private
        view
        returns (uint256)
    {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        uint256 galaxyDistance = _absoluteDifference(origin.galaxy, destination.galaxy);
        if (galaxyDistance != 0) return galaxyDistance * 20_000;
        uint256 systemDistance = _absoluteDifference(origin.system, destination.system);
        if (systemDistance != 0) return 2_700 + systemDistance * 95;
        uint256 positionDistance = _absoluteDifference(origin.position, destination.position);
        if (positionDistance != 0) return 1_000 + positionDistance * 5;
        return 0;
    }

    function _absoluteDifference(uint256 left, uint256 right) private pure returns (uint256) {
        return left > right ? left - right : right - left;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
