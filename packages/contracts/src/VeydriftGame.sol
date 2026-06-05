// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Deployable Base Sepolia test MVP for first-planet settlement and resource-token wiring.
/// @dev Advanced gameplay entrypoints stay in the ABI and fail explicitly until they are split into modules.
contract VeydriftGame is VeydriftResourceReserves {
    address private immutable _gameplayModule;
    address private immutable _planetManagementModule;
    address private immutable _attackProtectionModule;
    address private immutable _colonizationModule;

    constructor(
        address admin,
        address gameplayModule,
        address planetManagementModule,
        address attackProtectionModule,
        address colonizationModule
    ) VeydriftResourceReserves(admin) {
        if (
            gameplayModule == address(0) || planetManagementModule == address(0)
                || attackProtectionModule == address(0) || colonizationModule == address(0)
        ) revert UnsupportedGameplayModule();
        _gameplayModule = gameplayModule;
        _planetManagementModule = planetManagementModule;
        _attackProtectionModule = attackProtectionModule;
        _colonizationModule = colonizationModule;
    }

    function startPlanet() external payable returns (uint256 planetId) {
        planetId = _startPlanet(msg.sender, msg.value);
    }

    function settleFirstPlanet() external payable returns (FirstPlanet memory settledPlanet) {
        uint256 planetId = _startPlanet(msg.sender, msg.value);
        return _firstPlanetFrom(planetId);
    }

    function hasFirstPlanet(address player) external view returns (bool) {
        return homePlanetOf[player] != 0;
    }

    function firstPlanetOf(address player)
        external
        view
        returns (FirstPlanet memory settledPlanet)
    {
        uint256 planetId = homePlanetOf[player];
        if (planetId == 0) revert NoFirstPlanet(player);
        return _firstPlanetFrom(planetId);
    }

    function previewFirstPlanet(address player)
        external
        view
        returns (FirstPlanet memory planetPreview)
    {
        uint256 planetId = homePlanetOf[player];
        if (planetId != 0) return _firstPlanetFrom(planetId);

        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) =
            _previewFirstPlanet(player);
        return FirstPlanet({
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            settledAt: 0,
            settledBlock: 0
        });
    }

    function settlePlanet(uint256 planetId) external {
        _touchPlayer(msg.sender);
        _collectPlanetResources(planetId);
    }

    function collectResources(uint256 planetId) external {
        _touchPlayer(msg.sender);
        _collectPlanetResources(planetId);
    }

    function startBuildingUpgrade(uint256 planetId, Building building) external {
        _touchPlayer(msg.sender);
        _requirePlanetOwner(planetId);
        if (buildingConstructions[planetId].active) revert ConstructionActive();

        uint16 currentLevel = _buildingLevels[planetId][building];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();
        if (building == Building.InterdimensionalRiftStabilizer && currentLevel != 0) {
            revert LevelTooHigh();
        }
        if (_usedFields(planetId) >= _planets[planetId].fields) {
            if (building != Building.Terraformer) revert FieldCapacityReached();
        }

        _requireBuildingDependencies(planetId, building);
        _settleResources(planetId);

        Resources memory cost = buildingUpgradeCost(planetId, building);
        _spend(planetId, cost);

        uint64 readyAt = uint64(block.timestamp + _buildingDuration(planetId, cost));
        uint16 targetLevel = currentLevel + 1;
        buildingConstructions[planetId] = BuildingConstruction({
            active: true, building: building, targetLevel: targetLevel, readyAt: readyAt, cost: cost
        });

        emit BuildingStarted(
            planetId, building, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishBuildingUpgrade(uint256 planetId) external {
        _touchPlayer(msg.sender);
        _requirePlanetOwner(planetId);
        BuildingConstruction memory construction = buildingConstructions[planetId];
        if (!construction.active) revert ConstructionInactive();
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < construction.readyAt) {
            revert ConstructionNotReady(construction.readyAt);
        }

        _settleResources(planetId);
    }

    function startDefenseProduction(uint256, Defense, uint32) external {
        _touchPlayer(msg.sender);
        _delegateToColonizationModule();
    }

    function finishDefenseProduction(uint256) external {
        _touchPlayer(msg.sender);
        _delegateToColonizationModule();
    }

    function startShipProduction(uint256, Ship, uint32) external {
        _touchPlayer(msg.sender);
        _delegateToColonizationModule();
    }

    function finishShipProduction(uint256) external {
        _touchPlayer(msg.sender);
        _delegateToColonizationModule();
    }

    function startResearch(uint256, Technology) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function finishResearch() external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function setMoonSystem(address nextMoonSystem) external onlyOwner {
        _moonSystem = nextMoonSystem;
    }

    function setRandomnessEngine(address nextRandomnessEngine) external onlyOwner {
        address oldRandomnessEngine = _randomnessEngine;
        _randomnessEngine = nextRandomnessEngine;
        emit RandomnessEngineUpdated(oldRandomnessEngine, nextRandomnessEngine);
    }

    function setSpaceDockSystem(address) external {
        _delegateToColonizationModule();
    }

    function setAllianceSystem(address nextAllianceSystem) external onlyOwner {
        _allianceSystem = nextAllianceSystem;
    }

    function spendMoonResources(uint256 planetId, Resources calldata cost) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        _settleResources(planetId);
        _spend(planetId, cost);
    }

    function moveMoonGateShips(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        address owner_,
        MissionShips calldata ships
    ) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        if (
            _planets[originPlanetId].owner != owner_
                || _planets[destinationPlanetId].owner != owner_
        ) {
            revert NotPlanetOwner();
        }
        uint256 shipTotal;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (ship != Ship.SolarSatellite) {
                uint32 quantity = _missionShipQuantity(ships, ship);
                if (quantity != 0) {
                    uint32 available = _shipCounts[originPlanetId][ship];
                    if (available < quantity) revert InsufficientShips(ship, available, quantity);
                    shipTotal += quantity;
                    _shipCounts[originPlanetId][ship] = available - quantity;
                    _shipCounts[destinationPlanetId][ship] += quantity;
                }
            }
            unchecked {
                ++i;
            }
        }
        if (shipTotal == 0) revert InvalidQuantity();
    }

    function renamePlanet(uint256, string calldata) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function abandonPlanet(uint256) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function launchFleetMission(
        uint256,
        uint256,
        FleetMissionType,
        MissionShips calldata,
        Resources calldata,
        uint256
    ) external returns (uint256) {
        _touchPlayer(msg.sender);
        uint256 missionType;
        assembly ("memory-safe") {
            missionType := calldataload(0x44)
        }
        if (missionType == uint8(FleetMissionType.Colonize)) {
            return _launchColonizeMission();
        }
        _delegateToPlayModule();
    }

    function launchFleetMission(
        uint256,
        uint256,
        FleetMissionType,
        MissionShips calldata,
        Resources calldata,
        uint16,
        uint256
    ) external returns (uint256) {
        _touchPlayer(msg.sender);
        uint256 missionType;
        assembly ("memory-safe") {
            missionType := calldataload(0x44)
        }
        if (missionType == uint8(FleetMissionType.Colonize)) {
            return _launchColonizeMission();
        }
        _delegateToPlayModule();
    }

    function joinAttackMission(uint256, uint256, uint256, MissionShips calldata, Resources calldata)
        external
        returns (uint256)
    {
        _touchPlayer(msg.sender);
        _delegateToPlayModule();
    }

    function recallFleetMission(uint256) external {
        _touchPlayer(msg.sender);
        _delegateToPlayModule();
    }

    function resolveFleetMission(uint256 missionId) external {
        if (_fleetMissions[missionId].missionType == FleetMissionType.Colonize) {
            _delegateToColonizationModule();
        }
        _delegateToPlayModule();
    }

    function completeFleetMissionReturn(uint256) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function launchInterplanetaryMissileAttack(uint256, uint256, Defense, uint32) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function attackProtectionStatus(address, uint256)
        external
        returns (AttackBlockReason, uint8, uint16)
    {
        _delegateToAttackProtectionModule();
    }

    function depositMarketResource(uint256, Resource, uint128) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function requestMarketResourceWithdrawal(uint256, Resource, uint128) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function finishMarketResourceWithdrawal(Resource) external {
        _touchPlayer(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function planet(uint256 planetId) external view returns (Planet memory) {
        return _planets[planetId];
    }

    function fleetMission(uint256 missionId)
        external
        view
        returns (
            FleetMissionStatus status,
            FleetMissionType missionType,
            address owner,
            uint256 originPlanetId,
            uint256 targetPlanetId,
            uint64 departureAt,
            uint64 arrivalAt,
            uint64 returnAt,
            uint128 fuelCost,
            Resources memory cargo,
            uint256 randomnessRequestId
        )
    {
        FleetMission storage mission = _fleetMissions[missionId];
        return (
            mission.status,
            mission.missionType,
            mission.owner,
            mission.originPlanetId,
            mission.targetPlanetId,
            mission.departureAt,
            mission.arrivalAt,
            mission.returnAt,
            mission.fuelCost,
            mission.cargo,
            mission.randomnessRequestId
        );
    }

    function debrisField(uint256) external returns (uint128, uint128) {
        _delegateToPlanetManagementModule();
    }

    function randomnessEngine() external view returns (address) {
        return _randomnessEngine;
    }

    function activeBuildingConstruction(uint256 planetId)
        external
        view
        returns (BuildingConstruction memory)
    {
        return buildingConstructions[planetId];
    }

    function defenseQueue(uint256 planetId) external view returns (DefenseQueue memory) {
        return defenseQueues[planetId];
    }

    function defenseQueueBacklog(uint256 planetId) external view returns (DefenseQueue[] memory) {
        return _defenseQueueBacklogs[planetId];
    }

    function shipQueue(uint256 planetId) external view returns (ShipQueue memory) {
        return shipQueues[planetId];
    }

    function shipQueueBacklog(uint256 planetId) external view returns (ShipQueue[] memory) {
        return _shipQueueBacklogs[planetId];
    }

    function researchQueue(address player) external view returns (ResearchQueue memory) {
        return researchQueues[player];
    }

    function buildingLevel(uint256 planetId, Building building) external view returns (uint16) {
        return _buildingLevels[planetId][building];
    }

    function defenseCount(uint256 planetId, Defense defense) external view returns (uint32) {
        return _defenseCounts[planetId][defense];
    }

    function shipCount(uint256 planetId, Ship ship) external view returns (uint32) {
        return _shipCounts[planetId][ship];
    }

    function technologyLevel(address player, Technology technology) external view returns (uint16) {
        return _technologyLevels[player][technology];
    }

    function maxPlanets(address player) public view returns (uint256) {
        return 1 + _technologyLevels[player][Technology.Astrophysics];
    }

    function coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.coordinateKey(
            block.chainid, galaxy, system, position, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION
        );
    }

    function planetSeed(uint16 galaxy, uint16 system, uint8 position)
        public
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

    function isCoordinateAvailable(uint16 galaxy, uint16 system, uint8 position)
        external
        view
        returns (bool)
    {
        return !occupiedCoordinates[coordinateKey(galaxy, system, position)];
    }

    function previewResources(uint256 planetId) public view returns (Resources memory resources) {
        Planet storage planetRef = _planets[planetId];
        resources = planetRef.resources;
        uint256 elapsed = block.timestamp - planetRef.lastSettledAt;
        if (elapsed == 0) return resources;

        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deutPerHour) =
            productionPerHour(planetId);
        Resources memory produced = Resources({
            metal: _toUint128((metalPerHour * elapsed) / 1 hours),
            crystal: _toUint128((crystalPerHour * elapsed) / 1 hours),
            deuterium: _toUint128((deutPerHour * elapsed) / 1 hours)
        });
        (, Resources memory added) = _cappedResourceIncrease(planetId, resources, produced);
        resources = _add(resources, _reserveLimitedIncrease(added));
    }

    function productionPerHour(uint256 planetId)
        public
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
            planetRef.temperature,
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
    }

    function energyBalance(uint256 planetId)
        public
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
            _shipCounts[planetId][Ship.SolarSatellite],
            planetRef.temperature,
            _technologyLevels[planetRef.owner][Technology.Energy]
        );
    }

    function storageCaps(uint256 planetId)
        public
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

    function protectedResources(uint256) external returns (Resources memory) {
        _delegateToPlanetManagementModule();
    }

    function raidableResources(uint256) external returns (Resources memory) {
        _delegateToPlanetManagementModule();
    }

    function maxRaidLoot(uint256, uint256) external returns (Resources memory) {
        _delegateToPlanetManagementModule();
    }

    function buildingUpgradeCost(uint256 planetId, Building building)
        public
        view
        returns (Resources memory)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.buildingBaseCost(building);
        return _scaleByLevel(
            building, Resources(metal, crystal, deuterium), _buildingLevels[planetId][building]
        );
    }

    function defenseCost(Defense defense) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
    }

    function shipCost(Ship ship) external pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function researchCost(address player, Technology technology)
        public
        view
        returns (Resources memory)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchCost(technology, _technologyLevels[player][technology]);
        return Resources(metal, crystal, deuterium);
    }

    function _startPlanet(address player, uint256 payment) private returns (uint256 planetId) {
        if (homePlanetOf[player] != 0) revert AlreadyStarted();
        if (payment != startPrice) revert BadStartPayment();
        _touchPlayer(player);

        Resources memory startingResources = Resources({metal: 500, crystal: 500, deuterium: 0});
        _increaseInternalResources(startingResources);

        planetId = nextPlanetId++;
        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) =
            _previewFirstPlanet(player);
        occupiedCoordinates[coordinateKey(galaxy, system, position)] = true;

        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);

        homePlanetOf[player] = planetId;
        planetCountOf[player] = 1;
        _registerOwnedPlanet(player, planetId);
        _planets[planetId] = Planet({
            owner: player,
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: uint64(block.timestamp),
            resources: startingResources
        });

        emit PlanetStarted(player, planetId, galaxy, system, position, fields, temperature);
        emit FirstPlanetSettled(
            player,
            planetId,
            galaxy,
            system,
            position,
            coordinateKey(galaxy, system, position),
            planetSeed(galaxy, system, position)
        );
    }

    function _missionShipQuantity(MissionShips calldata ships, Ship ship)
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

    function _firstPlanetFrom(uint256 planetId) private view returns (FirstPlanet memory) {
        Planet storage planetRef = _planets[planetId];
        return FirstPlanet({
            galaxy: planetRef.galaxy,
            system: planetRef.system,
            position: planetRef.position,
            fields: planetRef.fields,
            temperature: planetRef.temperature,
            settledAt: planetRef.lastSettledAt,
            settledBlock: 0
        });
    }

    function _previewFirstPlanet(address player)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            (galaxy, system, position, fields, temperature) =
                VeydriftPlanetGeneration.firstPlanetCandidate(
                    FIRST_PLANET_DOMAIN,
                    block.chainid,
                    player,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    attempt,
                    MAX_GALAXY,
                    MAX_SYSTEM,
                    MAX_POSITION
                );
            if (!occupiedCoordinates[coordinateKey(galaxy, system, position)]) {
                return (galaxy, system, position, fields, temperature);
            }
        }
        revert CoordinatesExhausted();
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireBuildingDependencies(uint256 planetId, Building building) private view {
        VeydriftDependencies.requireBuilding(
            building,
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.RoboticsFactory],
            _buildingLevels[planetId][Building.Shipyard],
            _buildingLevels[planetId][Building.ResearchLab],
            _buildingLevels[planetId][Building.NaniteFactory],
            _technologyLevels[msg.sender][Technology.Energy],
            _technologyLevels[msg.sender][Technology.Computer],
            _technologyLevels[msg.sender][Technology.Hyperspace]
        );
    }

    function _settleResources(uint256 planetId) private {
        _requireNoPendingMissionResolutionForPlanet(planetId);
        uint64 currentTime = uint64(block.timestamp);
        BuildingConstruction memory construction = buildingConstructions[planetId];
        if (construction.active && currentTime >= construction.readyAt) {
            _settleResourcesUntil(planetId, construction.readyAt);
            _completeBuilding(planetId, construction);
            _settleResourcesUntil(planetId, currentTime);
            return;
        }

        _settleResourcesUntil(planetId, currentTime);
    }

    function _collectPlanetResources(uint256 planetId) private {
        _requirePlanetOwner(planetId);
        _settleResources(planetId);
        Resources memory resources = _planets[planetId].resources;
        emit PlanetSettled(
            planetId,
            resources.metal,
            resources.crystal,
            resources.deuterium,
            _planets[planetId].lastSettledAt
        );
    }

    function _settleResourcesUntil(uint256 planetId, uint64 settledAt) private {
        Planet storage planetRef = _planets[planetId];
        if (settledAt > planetRef.lastSettledAt) {
            uint256 elapsed = uint256(settledAt) - planetRef.lastSettledAt;
            (uint256 metalPerHour, uint256 crystalPerHour, uint256 deutPerHour) =
                productionPerHour(planetId);
            Resources memory produced = Resources({
                metal: _toUint128((metalPerHour * elapsed) / 1 hours),
                crystal: _toUint128((crystalPerHour * elapsed) / 1 hours),
                deuterium: _toUint128((deutPerHour * elapsed) / 1 hours)
            });
            (Resources memory capped, Resources memory added) =
                _cappedResourceIncrease(planetId, planetRef.resources, produced);
            added = _reserveLimitedIncrease(added);
            _increaseInternalResources(added);
            planetRef.resources = _add(planetRef.resources, added);
            if (
                planetRef.resources.metal > capped.metal
                    || planetRef.resources.crystal > capped.crystal
                    || planetRef.resources.deuterium > capped.deuterium
            ) {
                planetRef.resources = capped;
            }
            planetRef.lastSettledAt = settledAt;
        }
    }

    function _completeBuilding(uint256 planetId, BuildingConstruction memory construction) private {
        Building building = construction.building;
        delete buildingConstructions[planetId];
        _buildingLevels[planetId][building] = construction.targetLevel;
        if (building == Building.Terraformer) {
            unchecked {
                _planets[planetId].fields += 5;
            }
        }
        emit BuildingCompleted(planetId, building, construction.targetLevel);
    }

    function _buildingDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.buildingDuration(
            _buildingLevels[planetId][Building.RoboticsFactory],
            _buildingLevels[planetId][Building.NaniteFactory],
            cost.metal,
            cost.crystal,
            QUEUE_UNIVERSE_SPEED,
            MIN_QUEUE_SECONDS
        );
    }

    function _usedFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= MAX_BUILDING_ID; i++) {
            used += _buildingLevels[planetId][Building(i)];
        }
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
    }

    function _cappedResourceIncrease(
        uint256 planetId,
        Resources memory currentResources,
        Resources memory produced
    ) private view returns (Resources memory capped, Resources memory added) {
        capped = _addWithCaps(planetId, currentResources, produced);
        added = Resources({
            metal: capped.metal - currentResources.metal,
            crystal: capped.crystal - currentResources.crystal,
            deuterium: capped.deuterium - currentResources.deuterium
        });
    }

    function _addWithCaps(uint256 planetId, Resources memory resources, Resources memory addition)
        private
        view
        returns (Resources memory)
    {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = storageCaps(planetId);
        return Resources({
            metal: _addWithCap(resources.metal, addition.metal, metalCap),
            crystal: _addWithCap(resources.crystal, addition.crystal, crystalCap),
            deuterium: _addWithCap(resources.deuterium, addition.deuterium, deuteriumCap)
        });
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

    function _scaleByLevel(Building building, Resources memory baseCost, uint16 currentLevel)
        private
        pure
        returns (Resources memory)
    {
        (uint8 numerator, uint8 denominator) = VeydriftCatalog.buildingCostFactor(building);
        return Resources({
            metal: _toUint128(
                VeydriftFormulas.scaleByFactor(baseCost.metal, currentLevel, numerator, denominator)
            ),
            crystal: _toUint128(
                VeydriftFormulas.scaleByFactor(
                    baseCost.crystal, currentLevel, numerator, denominator
                )
            ),
            deuterium: _toUint128(
                VeydriftFormulas.scaleByFactor(
                    baseCost.deuterium, currentLevel, numerator, denominator
                )
            )
        });
    }

    function _delegateToPlayModule() private {
        (bool ok, bytes memory result) = _gameplayModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _delegateToPlanetManagementModule() private {
        (bool ok, bytes memory result) = _planetManagementModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _delegateToAttackProtectionModule() private {
        (bool ok, bytes memory result) = _attackProtectionModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _launchColonizeMission() private returns (uint256 missionId) {
        (bool ok, bytes memory result) = _colonizationModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        missionId = abi.decode(result, (uint256));
        _trackMissionResolution(missionId, _fleetMissions[missionId]);
    }

    function _delegateToColonizationModule() private {
        (bool ok, bytes memory result) = _colonizationModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }
}
