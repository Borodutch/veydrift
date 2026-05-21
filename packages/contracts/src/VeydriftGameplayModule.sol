// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for stateful gameplay paths that would push VeydriftGame over EIP-170.
contract VeydriftGameplayModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    constructor() VeydriftResourceReserves(address(0)) {}

    function startShipProduction(uint256 planetId, Ship ship, uint32 quantity) external {
        _validateShipProduction(planetId, ship, quantity);
        _settleResources(planetId);

        Resources memory unitCost = _shipCost(ship);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint64 readyAt =
            (uint256(_currentTimestamp()) + _shipDuration(planetId, unitCost, quantity)).toUint64();
        shipQueues[planetId] = ShipQueue({
            active: true, ship: ship, quantity: quantity, readyAt: readyAt, cost: totalCost
        });
        emit ShipQueued(
            planetId,
            ship,
            quantity,
            readyAt,
            totalCost.metal,
            totalCost.crystal,
            totalCost.deuterium
        );
    }

    function finishShipProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        ShipQueue memory queue = shipQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete shipQueues[planetId];
        uint32 total = _shipCounts[planetId][queue.ship] + queue.quantity;
        _shipCounts[planetId][queue.ship] = total;
        emit ShipCompleted(planetId, queue.ship, queue.quantity, total);
    }

    function createColonyAtNextSlot(uint256 originPlanetId, uint256 salt)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        (uint16 galaxy, uint16 system, uint8 position) = _nextColonyCoordinates(msg.sender, salt);
        return _createColony(originPlanetId, galaxy, system, position);
    }

    function createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        return _createColony(originPlanetId, galaxy, system, position);
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        _requirePlanetOwner(originPlanetId);
        if (originPlanetId == targetPlanetId) revert SamePlanet();
        if (_planets[targetPlanetId].owner == address(0)) revert NoPlanet();
        _validateMissionType(missionType);

        uint256 fleetSlots = 1 + _technologyLevels[msg.sender][Technology.Computer];
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        uint256 shipTotal = _missionShipTotal(ships);
        if (shipTotal == 0) revert InvalidQuantity();
        _requireMissionShips(originPlanetId, ships);

        uint256 cargoTotal =
            uint256(cargo.metal) + uint256(cargo.crystal) + uint256(cargo.deuterium);
        uint256 capacity = _missionCargoCapacity(ships);
        if (cargoTotal > capacity) revert CargoCapacityExceeded(capacity, cargoTotal);

        if (
            missionType == FleetMissionType.Transport || missionType == FleetMissionType.Deploy
                || missionType == FleetMissionType.Colonize
        ) {
            _requireOwnedDestination(targetPlanetId);
        }

        _settleResources(originPlanetId);
        uint128 fuelCost = _toUint128(shipTotal);
        Resources memory debit = Resources({
            metal: cargo.metal,
            crystal: cargo.crystal,
            deuterium: _toUint128(uint256(cargo.deuterium) + fuelCost)
        });
        _spend(originPlanetId, debit);
        _increaseInternalResources(cargo);
        _debitMissionShips(originPlanetId, ships);

        uint64 departureAt = _currentTimestamp();
        uint64 arrivalAt = (uint256(departureAt)
                + _transportTravelSeconds(originPlanetId, targetPlanetId))
        .toUint64();
        uint64 returnAt = (uint256(arrivalAt)
                + _transportTravelSeconds(originPlanetId, targetPlanetId))
        .toUint64();
        missionId = nextFleetId++;
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
            randomnessRequestId: randomnessRequestId
        });

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
    }

    function recallFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        _requireActiveMissionOwner(mission);
        if (mission.status == FleetMissionStatus.Returning) revert FleetAlreadyReturning();
        if (_currentTimestamp() >= mission.arrivalAt) revert FleetAlreadyArrived();

        uint64 elapsed = _currentTimestamp() - mission.departureAt;
        if (elapsed < MIN_QUEUE_SECONDS) elapsed = MIN_QUEUE_SECONDS;
        mission.status = FleetMissionStatus.Recalled;
        mission.returnAt = uint64(_currentTimestamp() + elapsed);

        emit FleetMissionRecalled(missionId, msg.sender, mission.returnAt);
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        _settleResources(mission.targetPlanetId);
        if (
            mission.missionType == FleetMissionType.Transport
                || mission.missionType == FleetMissionType.Deploy
        ) {
            _planets[mission.targetPlanetId].resources =
                _add(_planets[mission.targetPlanetId].resources, mission.cargo);
            _creditMissionShips(mission.targetPlanetId, mission.ships);
            mission.status = FleetMissionStatus.Resolved;
            mission.returnAt = _currentTimestamp();
            activeFleetMissionCount[mission.owner] -= 1;
        } else if (mission.missionType == FleetMissionType.Attack) {
            mission.cargo =
                _raidResources(mission.targetPlanetId, _missionCargoCapacity(mission.ships));
            mission.status = FleetMissionStatus.Returning;
        } else {
            mission.status = FleetMissionStatus.Returning;
        }

        emit FleetMissionResolved(missionId, msg.sender, mission.missionType, mission.returnAt);
    }

    function completeFleetMissionReturn(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (
            mission.status != FleetMissionStatus.Returning
                && mission.status != FleetMissionStatus.Recalled
        ) {
            revert FleetMissionNotResolved(mission.returnAt);
        }
        if (_currentTimestamp() < mission.returnAt) revert FleetNotArrived(mission.returnAt);

        _planets[mission.originPlanetId].resources =
            _add(_planets[mission.originPlanetId].resources, mission.cargo);
        _creditMissionShips(mission.originPlanetId, mission.ships);
        mission.status = FleetMissionStatus.Returned;
        activeFleetMissionCount[mission.owner] -= 1;
        emit FleetMissionReturned(missionId, mission.owner, mission.originPlanetId);
    }

    function depositMarketResource(uint256 planetId, Resource resource, uint128 amount) external {
        _requirePlanetOwner(planetId);
        _requireRiftUnlocked(planetId);
        if (amount == 0) revert InvalidQuantity();

        _transferReserveIn(resource, amount);
        Resources memory resourceAmount = _resourceAmount(resource, amount);
        _planets[planetId].resources = _add(_planets[planetId].resources, resourceAmount);
        _increaseInternalResources(resourceAmount);
        emit MarketResourceDeposited(msg.sender, planetId, resource, amount);
    }

    function requestMarketResourceWithdrawal(uint256 planetId, Resource resource, uint128 amount)
        external
    {
        _requirePlanetOwner(planetId);
        _requireRiftUnlocked(planetId);
        if (amount == 0) revert InvalidQuantity();
        if (resourceWithdrawals[msg.sender][resource].active) revert WithdrawalActive(resource);

        _settleResources(planetId);
        Resources memory resourceAmount = _resourceAmount(resource, amount);
        _spend(planetId, resourceAmount);
        _lockedWithdrawalResources = _add(_lockedWithdrawalResources, resourceAmount);

        uint64 unlocksAt = uint64(_currentTimestamp() + MARKET_WITHDRAWAL_DELAY);
        resourceWithdrawals[msg.sender][resource] = ResourceWithdrawal({
            active: true,
            planetId: planetId,
            resource: resource,
            amount: amount,
            unlocksAt: unlocksAt
        });
        emit MarketResourceWithdrawalRequested(msg.sender, planetId, resource, amount, unlocksAt);
    }

    function finishMarketResourceWithdrawal(Resource resource) external {
        ResourceWithdrawal memory withdrawal = resourceWithdrawals[msg.sender][resource];
        if (!withdrawal.active) revert WithdrawalInactive(resource);
        if (_currentTimestamp() < withdrawal.unlocksAt) {
            revert WithdrawalNotReady(withdrawal.unlocksAt);
        }

        delete resourceWithdrawals[msg.sender][resource];
        Resources memory amount = _resourceAmount(resource, withdrawal.amount);
        _lockedWithdrawalResources = Resources({
            metal: _lockedWithdrawalResources.metal - amount.metal,
            crystal: _lockedWithdrawalResources.crystal - amount.crystal,
            deuterium: _lockedWithdrawalResources.deuterium - amount.deuterium
        });
        if (!_requireReserveResource(resource).transfer(msg.sender, withdrawal.amount)) {
            revert ResourceTransferFailed(
                resource, address(_resourceTokens[resource]), withdrawal.amount
            );
        }
        emit MarketResourceWithdrawalFinished(
            msg.sender, withdrawal.planetId, resource, withdrawal.amount
        );
    }

    function nextColonyCoordinates(address player, uint256 salt)
        external
        view
        returns (uint16, uint16, uint8)
    {
        return _nextColonyCoordinates(player, salt);
    }

    function transportTravelSeconds(uint256 originPlanetId, uint256 destinationPlanetId)
        external
        view
        returns (uint256)
    {
        return _transportTravelSeconds(originPlanetId, destinationPlanetId);
    }

    function _validateShipProduction(uint256 planetId, Ship ship, uint32 quantity) private view {
        _requirePlanetOwner(planetId);
        if (quantity == 0) revert InvalidQuantity();
        if (shipQueues[planetId].active) revert QueueActive();
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireShip(
            ship,
            _buildingLevels[planetId][Building.Shipyard],
            _technologyLevels[player][Technology.Espionage],
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive],
            _technologyLevels[player][Technology.Hyperspace],
            _technologyLevels[player][Technology.Graviton],
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Shielding],
            _technologyLevels[player][Technology.Armor],
            _technologyLevels[player][Technology.Plasma]
        );
    }

    function _validateColonyCreation(uint256 originPlanetId) private view {
        _requirePlanetOwner(originPlanetId);
        uint256 limit = 1 + _technologyLevels[msg.sender][Technology.Astrophysics];
        if (planetCountOf[msg.sender] >= limit) revert PlanetLimitReached(limit);
        _requireShips(originPlanetId, Ship.ColonyShip, 1);
    }

    function _createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        private
        returns (uint256 colonyPlanetId)
    {
        bytes32 coordinates = _coordinateKey(galaxy, system, position);
        if (occupiedCoordinates[coordinates]) revert CoordinatesOccupied();

        _settleResources(originPlanetId);
        _shipCounts[originPlanetId][Ship.ColonyShip] -= 1;
        colonyPlanetId = nextPlanetId++;
        occupiedCoordinates[coordinates] = true;
        planetCountOf[msg.sender] += 1;

        bytes32 seed = _planetSeed(galaxy, system, position);
        uint16 fields = uint16(160 + (uint256(seed) % 80));
        int16 temperature = VeydriftPlanetGeneration.slotTemperature(
            position, (uint256(seed) >> 16) % 21, (uint256(seed) >> 24) % 21
        );
        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);
        _planets[colonyPlanetId] = Planet({
            owner: msg.sender,
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: _currentTimestamp(),
            resources: Resources({metal: 0, crystal: 0, deuterium: 0})
        });
        emit ColonyCreated(
            msg.sender,
            originPlanetId,
            colonyPlanetId,
            galaxy,
            system,
            position,
            fields,
            temperature
        );
    }

    function _nextColonyCoordinates(address player, uint256 salt)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed = keccak256(
                abi.encode(
                    PLANET_SEED_DOMAIN, block.chainid, player, salt, planetCountOf[player], attempt
                )
            );
            galaxy = uint16((uint256(seed) % MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % MAX_POSITION) + 1);
            if (!occupiedCoordinates[_coordinateKey(galaxy, system, position)]) {
                return (galaxy, system, position);
            }
        }
        revert CoordinatesExhausted();
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireOwnedDestination(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireRiftUnlocked(uint256 planetId) private view {
        _requireReserveResource(Resource.Metal);
        _requireReserveResource(Resource.Crystal);
        _requireReserveResource(Resource.Deuterium);
        if (_buildingLevels[planetId][Building.InterdimensionalRiftStabilizer] == 0) {
            revert RiftStabilizerRequired(planetId);
        }
    }

    function _requireShips(uint256 planetId, Ship ship, uint32 quantity) private view {
        uint32 available = _shipCounts[planetId][ship];
        if (available < quantity) revert InsufficientShips(ship, available, quantity);
    }

    function _settleResources(uint256 planetId) private {
        uint64 currentTime = _currentTimestamp();
        Planet storage planetRef = _planets[planetId];
        if (currentTime <= planetRef.lastSettledAt) {
            emit PlanetSettled(
                planetId,
                planetRef.resources.metal,
                planetRef.resources.crystal,
                planetRef.resources.deuterium
            );
            return;
        }

        uint256 elapsed = uint256(currentTime) - planetRef.lastSettledAt;
        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deutPerHour) =
            _productionPerHour(planetId);
        Resources memory produced = Resources({
            metal: _toUint128((metalPerHour * elapsed) / 1 hours),
            crystal: _toUint128((crystalPerHour * elapsed) / 1 hours),
            deuterium: _toUint128((deutPerHour * elapsed) / 1 hours)
        });
        (, Resources memory added) =
            _cappedResourceIncrease(planetId, planetRef.resources, produced);
        added = _reserveLimitedIncrease(added);
        _increaseInternalResources(added);
        planetRef.resources = _add(planetRef.resources, added);
        planetRef.lastSettledAt = currentTime;
        emit PlanetSettled(
            planetId,
            planetRef.resources.metal,
            planetRef.resources.crystal,
            planetRef.resources.deuterium
        );
    }

    function _productionPerHour(uint256 planetId)
        private
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        return VeydriftFormulas.productionPerHour(
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
            _buildingLevels[planetId][Building.FusionReactor],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps,
            BPS
        );
    }

    function _spend(uint256 planetId, Resources memory cost) private {
        Resources storage available = _planets[planetId].resources;
        if (
            available.metal < cost.metal || available.crystal < cost.crystal
                || available.deuterium < cost.deuterium
        ) revert InsufficientResources(available.metal, available.crystal, available.deuterium);
        available.metal -= cost.metal;
        available.crystal -= cost.crystal;
        available.deuterium -= cost.deuterium;
        _decreaseInternalResources(cost);
    }

    function _shipDuration(uint256 planetId, Resources memory unitCost, uint32 quantity)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.unitDuration(
            _buildingLevels[planetId][Building.Shipyard],
            _buildingLevels[planetId][Building.NaniteFactory],
            unitCost.metal,
            unitCost.crystal,
            unitCost.deuterium,
            quantity,
            MIN_QUEUE_SECONDS
        );
    }

    function _shipCost(Ship ship) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function _multiply(Resources memory resources, uint32 quantity)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: _toUint128(uint256(resources.metal) * quantity),
            crystal: _toUint128(uint256(resources.crystal) * quantity),
            deuterium: _toUint128(uint256(resources.deuterium) * quantity)
        });
    }

    function _resourceAmount(Resource resource, uint128 amount)
        private
        pure
        returns (Resources memory)
    {
        if (resource == Resource.Metal) {
            return Resources({metal: amount, crystal: 0, deuterium: 0});
        }
        if (resource == Resource.Crystal) {
            return Resources({metal: 0, crystal: amount, deuterium: 0});
        }
        if (resource == Resource.Deuterium) {
            return Resources({metal: 0, crystal: 0, deuterium: amount});
        }
        revert InvalidResource(resource);
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

    function _transportCargoCapacity(uint32 smallCargo, uint32 recycler, uint32 colonyShip)
        private
        pure
        returns (uint256)
    {
        return smallCargo * VeydriftCatalog.shipCargoCapacity(Ship.SmallCargo) + recycler
            * VeydriftCatalog.shipCargoCapacity(Ship.Recycler) + colonyShip
            * VeydriftCatalog.shipCargoCapacity(Ship.ColonyShip);
    }

    function _transportTravelSeconds(uint256 originPlanetId, uint256 destinationPlanetId)
        private
        view
        returns (uint256)
    {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        if (origin.owner == address(0) || destination.owner == address(0)) revert NoPlanet();
        uint256 distance = _absDiff(origin.galaxy, destination.galaxy) * MAX_SYSTEM * MAX_POSITION
            + _absDiff(origin.system, destination.system) * MAX_POSITION
            + _absDiff(origin.position, destination.position);
        return MIN_FLEET_TRAVEL_SECONDS + distance;
    }

    function _validateMissionType(FleetMissionType missionType) private pure {
        if (uint8(missionType) > uint8(FleetMissionType.MissileAttack)) {
            revert InvalidMissionType(missionType);
        }
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
        if (ships.espionageProbe != 0) revert InvalidQuantity();
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (ship != Ship.EspionageProbe && ship != Ship.SolarSatellite) {
                uint32 quantity = _missionShipQuantity(ships, ship);
                if (quantity != 0) _requireShips(planetId, ship, quantity);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _debitMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (ship != Ship.EspionageProbe && ship != Ship.SolarSatellite) {
                uint32 quantity = _missionShipQuantity(ships, ship);
                if (quantity != 0) _shipCounts[planetId][ship] -= quantity;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _creditMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (ship != Ship.EspionageProbe && ship != Ship.SolarSatellite) {
                uint32 quantity = _missionShipQuantity(ships, ship);
                if (quantity != 0) _shipCounts[planetId][ship] += quantity;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _missionCargoCapacity(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) * VeydriftCatalog.shipCargoCapacity(Ship.SmallCargo)
            + uint256(ships.recycler) * VeydriftCatalog.shipCargoCapacity(Ship.Recycler)
            + uint256(ships.colonyShip) * VeydriftCatalog.shipCargoCapacity(Ship.ColonyShip)
            + uint256(ships.largeCargo) * VeydriftCatalog.shipCargoCapacity(Ship.LargeCargo)
            + uint256(ships.pathfinder) * VeydriftCatalog.shipCargoCapacity(Ship.Pathfinder);
    }

    function _missionShipTotal(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) + ships.lightFighter + ships.recycler + ships.colonyShip
            + ships.largeCargo + ships.heavyFighter + ships.cruiser + ships.battleship
            + ships.bomber + ships.destroyer + ships.deathstar + ships.battlecruiser + ships.reaper
            + ships.pathfinder;
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

    function _raidResources(uint256 targetPlanetId, uint256 capacity)
        private
        returns (Resources memory raided)
    {
        Resources storage target = _planets[targetPlanetId].resources;
        uint128 metal = _toUint128(_min(uint256(target.metal) / 10, capacity));
        capacity -= metal;
        uint128 crystal = _toUint128(_min(uint256(target.crystal) / 10, capacity));
        capacity -= crystal;
        uint128 deuterium = _toUint128(_min(uint256(target.deuterium) / 10, capacity));
        target.metal -= metal;
        target.crystal -= crystal;
        target.deuterium -= deuterium;
        return Resources({metal: metal, crystal: crystal, deuterium: deuterium});
    }

    function _coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.coordinateKey(
            block.chainid, galaxy, system, position, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION
        );
    }

    function _planetSeed(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.planetSeed(
            PLANET_SEED_DOMAIN,
            block.chainid,
            galaxy,
            system,
            position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
    }

    function _absDiff(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
