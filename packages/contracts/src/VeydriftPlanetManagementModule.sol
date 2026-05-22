// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for colony and planet metadata/destruction paths.
contract VeydriftPlanetManagementModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

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

    function renamePlanet(uint256 planetId, string calldata name) external {
        _requirePlanetOwner(planetId);
        uint256 length = bytes(name).length;
        if (length == 0 || length > 32) revert InvalidPlanetName();

        planetNames[planetId] = name;
    }

    function abandonPlanet(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        if (homePlanetOf[msg.sender] == planetId) revert CannotAbandonHomePlanet();
        if (
            buildingConstructions[planetId].active || defenseQueues[planetId].active
                || shipQueues[planetId].active
        ) {
            revert PlanetHasActiveQueues();
        }
        if (activeFleetMissionCount[msg.sender] != 0) revert PlanetHasActiveFleetMissions();

        _settleResources(planetId);
        Planet memory planetRef = _planets[planetId];
        if (
            planetRef.resources.metal != 0 || planetRef.resources.crystal != 0
                || planetRef.resources.deuterium != 0
        ) {
            revert PlanetHasResources();
        }

        delete _planets[planetId];
        delete planetNames[planetId];
        occupiedCoordinates[
            _coordinateKey(planetRef.galaxy, planetRef.system, planetRef.position)
        ] = false;
        planetCountOf[msg.sender] -= 1;
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
        _requireReserveResource(resource);
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

    function _requireRiftUnlocked(uint256 planetId) private view {
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
    }

    function _spend(uint256 planetId, Resources memory cost) private {
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
    }

    function _resourceAmount(Resource resource, uint128 amount)
        private
        pure
        returns (Resources memory)
    {
        if (resource == Resource.Metal) return Resources(amount, 0, 0);
        if (resource == Resource.Crystal) return Resources(0, amount, 0);
        if (resource == Resource.Deuterium) return Resources(0, 0, amount);
        revert InvalidResource(resource);
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
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
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

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
