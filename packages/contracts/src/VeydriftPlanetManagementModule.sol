// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for colony and planet metadata/destruction paths.
contract VeydriftPlanetManagementModule is VeydriftResourceReserves {
    bytes4 private constant ATTACK_PROTECTION_STATUS_SELECTOR = 0x8a6b2246;

    constructor() VeydriftResourceReserves(address(0)) {}

    function launchInterplanetaryMissileAttack(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        Defense primaryTarget,
        uint32 quantity
    ) external {
        Planet storage origin = _planets[originPlanetId];
        if (origin.owner == address(0)) revert NoPlanet();
        if (origin.owner != msg.sender) revert NotPlanetOwner();
        if (originPlanetId == targetPlanetId) revert SamePlanet();
        Planet storage target = _planets[targetPlanetId];
        if (target.owner == address(0)) revert NoPlanet();
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        if (primaryTarget > Defense.LargeShieldDome) revert InvalidMissileTarget(primaryTarget);
        _enforceAttackProtection(msg.sender, targetPlanetId, false);

        uint256 range = _interplanetaryMissileRange(msg.sender);
        if (
            origin.galaxy != target.galaxy
                || _systemDistanceForMissiles(origin.system, target.system) > range
        ) {
            revert InterplanetaryMissileOutOfRange(origin.system, target.system, range);
        }

        uint32 available = _defenseCounts[originPlanetId][Defense.InterplanetaryMissile];
        if (quantity == 0 || available < quantity) revert InvalidQuantity();
        _defenseCounts[originPlanetId][Defense.InterplanetaryMissile] = available - quantity;

        uint32 antiBallistic = _defenseCounts[targetPlanetId][Defense.AntiBallisticMissile];
        uint32 intercepted = antiBallistic < quantity ? antiBallistic : quantity;
        _defenseCounts[targetPlanetId][Defense.AntiBallisticMissile] = antiBallistic - intercepted;

        uint32 hits = quantity - intercepted;
        uint32 targetDefense = _defenseCounts[targetPlanetId][primaryTarget];
        uint32 destroyedPrimary = targetDefense < hits ? targetDefense : hits;
        _defenseCounts[targetPlanetId][primaryTarget] = targetDefense - destroyedPrimary;

        emit InterplanetaryMissileAttack(
            msg.sender,
            originPlanetId,
            targetPlanetId,
            primaryTarget,
            quantity,
            intercepted,
            hits,
            destroyedPrimary
        );
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

    function renamePlanet(uint256 planetId, string calldata name) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        uint256 length = bytes(name).length;
        if (length == 0 || length > 32) revert InvalidPlanetName();

        planetNames[planetId] = name;
    }

    function abandonPlanet(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
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
        _requireNoPendingMissionResolutionForPlanet(planetId);
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
        _requireNoPendingMissionResolutionForPlanet(planetId);
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
        _requireNoPendingMissionResolutionForPlanet(withdrawal.planetId);
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

    function protectedResources(uint256 planetId) external view returns (Resources memory) {
        return _protectedResources(planetId);
    }

    function raidableResources(uint256 planetId) external view returns (Resources memory) {
        Resources memory protected = _protectedResources(planetId);
        return _unprotectedResources(_planets[planetId].resources, protected);
    }

    function maxRaidLoot(uint256 planetId, uint256 cargoCapacity)
        external
        view
        returns (Resources memory)
    {
        Resources memory protected = _protectedResources(planetId);
        return _selectRaidLoot(
            _unprotectedResources(_planets[planetId].resources, protected), cargoCapacity
        );
    }

    function debrisField(uint256 planetId) external view returns (uint128 metal, uint128 crystal) {
        DebrisField storage field = _debrisFields[planetId];
        return (field.metal, field.crystal);
    }

    function completeFleetMissionReturn(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (
            mission.status != FleetMissionStatus.Returning
                && mission.status != FleetMissionStatus.Recalled
        ) {
            revert FleetMissionNotResolved(mission.returnAt);
        }
        _requireNoPendingMissionResolutionForPlanet(mission.originPlanetId);
        if (_currentTimestamp() < mission.returnAt) revert FleetNotArrived(mission.returnAt);

        _planets[mission.originPlanetId].resources =
            _add(_planets[mission.originPlanetId].resources, mission.cargo);
        _creditMissionShips(mission.originPlanetId, mission.ships);
        mission.status = FleetMissionStatus.Returned;
        activeFleetMissionCount[mission.owner] -= 1;
        emit FleetMissionReturned(missionId, mission.owner, mission.originPlanetId);
    }

    function startResearch(uint256 planetId, Technology technology) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlayer(msg.sender);
        if (researchQueues[msg.sender].active) revert QueueActive();

        uint16 currentLevel = _technologyLevels[msg.sender][technology];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();

        _settleResources(planetId);
        _requireResearchDependencies(planetId, msg.sender, technology, currentLevel);

        Resources memory cost = _researchCost(msg.sender, technology);
        _spend(planetId, cost);

        uint64 readyAt = uint64(uint256(_currentTimestamp()) + _researchDuration(planetId, cost));
        uint16 targetLevel = currentLevel + 1;
        researchQueues[msg.sender] = ResearchQueue({
            active: true,
            technology: technology,
            targetLevel: targetLevel,
            readyAt: readyAt,
            cost: cost
        });

        emit ResearchQueued(
            msg.sender, technology, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishResearch() external {
        _requireNoPendingMissionResolutionForPlayer(msg.sender);
        ResearchQueue memory queue = researchQueues[msg.sender];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete researchQueues[msg.sender];
        _technologyLevels[msg.sender][queue.technology] = queue.targetLevel;
        emit ResearchCompleted(msg.sender, queue.technology, queue.targetLevel);
    }

    function _validateColonyCreation(uint256 originPlanetId) private view {
        _requirePlanetOwner(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
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

    function _researchCost(address player, Technology technology)
        private
        view
        returns (Resources memory)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchCost(technology, _technologyLevels[player][technology]);
        return Resources(metal, crystal, deuterium);
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

    function _researchDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.researchDuration(
            _buildingLevels[planetId][Building.ResearchLab],
            cost.metal,
            cost.crystal,
            cost.deuterium,
            MIN_QUEUE_SECONDS
        );
    }

    function _requireResearchDependencies(
        uint256 planetId,
        address player,
        Technology technology,
        uint16 currentLevel
    ) private view {
        VeydriftDependencies.requireResearch(
            technology,
            _buildingLevels[planetId][Building.ResearchLab],
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Hyperspace],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.Computer],
            _technologyLevels[player][Technology.Shielding]
        );

        uint256 energyRequirement =
            VeydriftCatalog.researchEnergyRequirement(technology, currentLevel);
        if (energyRequirement == 0) return;

        (uint256 producedEnergy,,) = _energyBalance(planetId);
        if (producedEnergy < energyRequirement) {
            revert MissingDependency("GRAVITON_ENERGY");
        }
    }

    function _energyBalance(uint256 planetId)
        private
        view
        returns (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps)
    {
        Planet storage planetRef = _planets[planetId];
        return VeydriftFormulas.energyBalance(
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
            _buildingLevels[planetId][Building.FusionReactor],
            _technologyLevels[planetRef.owner][Technology.Energy]
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

    function _protectedResources(uint256 planetId) private view returns (Resources memory) {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = _storageCaps(planetId);
        return Resources({
            metal: _toUint128((uint256(metalCap) * RAID_PROTECTED_STORAGE_BPS) / BPS),
            crystal: _toUint128((uint256(crystalCap) * RAID_PROTECTED_STORAGE_BPS) / BPS),
            deuterium: _toUint128((uint256(deuteriumCap) * RAID_PROTECTED_STORAGE_BPS) / BPS)
        });
    }

    function _unprotectedResources(Resources storage resources, Resources memory protected)
        private
        view
        returns (Resources memory)
    {
        return Resources({
            metal: resources.metal > protected.metal ? resources.metal - protected.metal : 0,
            crystal: resources.crystal > protected.crystal
                ? resources.crystal - protected.crystal
                : 0,
            deuterium: resources.deuterium > protected.deuterium
                ? resources.deuterium - protected.deuterium
                : 0
        });
    }

    function _selectRaidLoot(Resources memory unprotected, uint256 capacity)
        private
        pure
        returns (Resources memory)
    {
        uint128 metalCap = _toUint128((uint256(unprotected.metal) * RAID_LOOT_BPS) / BPS);
        uint128 metal = _toUint128(_min(metalCap, capacity));
        capacity -= metal;

        uint128 crystalCap = _toUint128((uint256(unprotected.crystal) * RAID_LOOT_BPS) / BPS);
        uint128 crystal = _toUint128(_min(crystalCap, capacity));
        capacity -= crystal;

        uint128 deuteriumCap = _toUint128((uint256(unprotected.deuterium) * RAID_LOOT_BPS) / BPS);
        uint128 deuterium = _toUint128(_min(deuteriumCap, capacity));
        return Resources({metal: metal, crystal: crystal, deuterium: deuterium});
    }

    function _creditMissionShips(uint256 planetId, MissionShips memory ships) private {
        _shipCounts[planetId][Ship.SmallCargo] += ships.smallCargo;
        _shipCounts[planetId][Ship.LightFighter] += ships.lightFighter;
        _shipCounts[planetId][Ship.Recycler] += ships.recycler;
        _shipCounts[planetId][Ship.ColonyShip] += ships.colonyShip;
        _shipCounts[planetId][Ship.LargeCargo] += ships.largeCargo;
        _shipCounts[planetId][Ship.HeavyFighter] += ships.heavyFighter;
        _shipCounts[planetId][Ship.Cruiser] += ships.cruiser;
        _shipCounts[planetId][Ship.Battleship] += ships.battleship;
        _shipCounts[planetId][Ship.Bomber] += ships.bomber;
        _shipCounts[planetId][Ship.Destroyer] += ships.destroyer;
        _shipCounts[planetId][Ship.Deathstar] += ships.deathstar;
        _shipCounts[planetId][Ship.Battlecruiser] += ships.battlecruiser;
        _shipCounts[planetId][Ship.Reaper] += ships.reaper;
        _shipCounts[planetId][Ship.Pathfinder] += ships.pathfinder;
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

    function _enforceAttackProtection(address attacker, uint256 targetPlanetId, bool countsBashing)
        private
        view
    {
        if (_planets[targetPlanetId].owner == attacker) revert SelfAttack();
        (bool ok, bytes memory data) = address(this)
            .staticcall(
                abi.encodeWithSelector(ATTACK_PROTECTION_STATUS_SELECTOR, attacker, targetPlanetId)
            );
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(data, 32), mload(data))
            }
        }
        if (data.length < 32) return;
        AttackBlockReason reason = abi.decode(data, (AttackBlockReason));
        if (countsBashing && reason == AttackBlockReason.BashingLimit) {
            revert AttackBashingLimitReached();
        }
        if (reason == AttackBlockReason.ScoreProtection) revert AttackScoreProtection();
        if (reason == AttackBlockReason.SameAlliance) revert SameAllianceAttack();
    }

    function _interplanetaryMissileRange(address attacker) private view returns (uint256) {
        uint16 impulseDrive = _technologyLevels[attacker][Technology.ImpulseDrive];
        if (impulseDrive == 0) return 0;
        return uint256(impulseDrive) * 5 - 1;
    }

    function _systemDistanceForMissiles(uint16 originSystem, uint16 targetSystem)
        private
        pure
        returns (uint256)
    {
        return originSystem > targetSystem
            ? uint256(originSystem - targetSystem)
            : uint256(targetSystem - originSystem);
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
