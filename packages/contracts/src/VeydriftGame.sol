// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameplayModule} from "./VeydriftGameplayModule.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Deployable Base Sepolia test MVP for first-planet settlement and resource-token wiring.
/// @dev Advanced gameplay entrypoints stay in the ABI and fail explicitly until they are split into modules.
contract VeydriftGame is VeydriftResourceReserves {
    using SafeCast for uint256;

    address private immutable _gameplayModule;

    constructor(address admin) VeydriftResourceReserves(admin) {
        _gameplayModule = address(new VeydriftGameplayModule());
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
        _requirePlanetOwner(planetId);
        _settleResources(planetId);
    }

    function collectResources(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _settleResources(planetId);
    }

    function collectShips(uint256 planetId) external view {
        _requirePlanetOwner(planetId);
    }

    function startBuildingUpgrade(uint256 planetId, Building building) external {
        _requirePlanetOwner(planetId);
        if (buildingConstructions[planetId].active) revert ConstructionActive();

        uint16 currentLevel = _buildingLevels[planetId][building];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();
        if (_usedFields(planetId) >= _planets[planetId].fields) revert FieldCapacityReached();

        _requireBuildingDependencies(planetId, building);
        _settleResources(planetId);

        Resources memory cost = buildingUpgradeCost(planetId, building);
        _spend(planetId, cost);

        uint64 readyAt =
            (uint256(_currentTimestamp()) + _buildingDuration(planetId, cost)).toUint64();
        uint16 targetLevel = currentLevel + 1;
        buildingConstructions[planetId] = BuildingConstruction({
            active: true, building: building, targetLevel: targetLevel, readyAt: readyAt, cost: cost
        });

        emit BuildingStarted(
            planetId, building, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishBuildingUpgrade(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        BuildingConstruction memory construction = buildingConstructions[planetId];
        if (!construction.active) revert ConstructionInactive();
        if (_currentTimestamp() < construction.readyAt) {
            revert ConstructionNotReady(construction.readyAt);
        }

        _settleResources(planetId);
    }

    function startDefenseProduction(uint256 planetId, Defense defense, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        if (quantity == 0) revert InvalidQuantity();
        if (defenseQueues[planetId].active) revert QueueActive();

        _requireDefenseDependencies(planetId, defense);
        _requireDefenseCapacity(planetId, defense, quantity);
        _settleResources(planetId);

        Resources memory unitCost = defenseCost(defense);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint64 readyAt = (uint256(_currentTimestamp())
                + _defenseDuration(planetId, unitCost, quantity))
        .toUint64();
        defenseQueues[planetId] = DefenseQueue({
            active: true, defense: defense, quantity: quantity, readyAt: readyAt, cost: totalCost
        });

        emit DefenseQueued(
            planetId,
            defense,
            quantity,
            readyAt,
            totalCost.metal,
            totalCost.crystal,
            totalCost.deuterium
        );
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        DefenseQueue memory queue = defenseQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete defenseQueues[planetId];
        uint32 total = _defenseCounts[planetId][queue.defense] + queue.quantity;
        _defenseCounts[planetId][queue.defense] = total;
        emit DefenseCompleted(planetId, queue.defense, queue.quantity, total);
    }

    function startShipProduction(uint256, Ship, uint32) external {
        _delegateToGameplayModule();
    }

    function finishShipProduction(uint256) external {
        _delegateToGameplayModule();
    }

    function startResearch(uint256 planetId, Technology technology) external {
        _requirePlanetOwner(planetId);
        if (researchQueues[msg.sender].active) revert QueueActive();

        uint16 currentLevel = _technologyLevels[msg.sender][technology];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();

        _settleResources(planetId);
        _requireResearchDependencies(planetId, msg.sender, technology, currentLevel);

        Resources memory cost = researchCost(msg.sender, technology);
        _spend(planetId, cost);

        uint64 readyAt =
            (uint256(_currentTimestamp()) + _researchDuration(planetId, cost)).toUint64();
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
        ResearchQueue memory queue = researchQueues[msg.sender];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete researchQueues[msg.sender];
        _technologyLevels[msg.sender][queue.technology] = queue.targetLevel;
        emit ResearchCompleted(msg.sender, queue.technology, queue.targetLevel);
    }

    function setMoonSystem(address nextMoonSystem) external onlyOwner {
        _moonSystem = nextMoonSystem;
    }

    function setSpaceDockSystem(address nextSpaceDockSystem) external onlyOwner {
        _spaceDockSystem = nextSpaceDockSystem;
    }

    function spendMoonResources(uint256 planetId, Resources calldata cost) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        _settleResources(planetId);
        _spend(planetId, cost);
    }

    function createColonyAtNextSlot(uint256, uint256) external returns (uint256) {
        _delegateToGameplayModule();
    }

    function createColony(uint256, uint16, uint16, uint8) external returns (uint256) {
        _delegateToGameplayModule();
    }

    function launchFleetMission(
        uint256,
        uint256,
        FleetMissionType,
        MissionShips calldata,
        Resources calldata,
        uint256
    ) external returns (uint256) {
        _delegateToGameplayModule();
    }

    function recallFleetMission(uint256) external {
        _delegateToGameplayModule();
    }

    function resolveFleetMission(uint256) external {
        _delegateToGameplayModule();
    }

    function completeFleetMissionReturn(uint256) external {
        _delegateToGameplayModule();
    }

    function depositMarketResource(uint256, Resource, uint128) external {
        _delegateToGameplayModule();
    }

    function requestMarketResourceWithdrawal(uint256, Resource, uint128) external {
        _delegateToGameplayModule();
    }

    function finishMarketResourceWithdrawal(Resource) external {
        _delegateToGameplayModule();
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

    function debrisField(uint256 planetId) external view returns (DebrisField memory) {
        return _debrisFields[planetId];
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

    function shipQueue(uint256 planetId) external view returns (ShipQueue memory) {
        return shipQueues[planetId];
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

    function nextColonyCoordinates(address, uint256) external returns (uint16, uint16, uint8) {
        _delegateToGameplayModule();
    }

    function shipCargoCapacity(Ship ship) external pure returns (uint256) {
        return VeydriftCatalog.shipCargoCapacity(ship);
    }

    function transportCargoCapacity(uint32 smallCargo, uint32 recycler, uint32 colonyShip)
        external
        pure
        returns (uint256)
    {
        return smallCargo * VeydriftCatalog.shipCargoCapacity(Ship.SmallCargo) + recycler
            * VeydriftCatalog.shipCargoCapacity(Ship.Recycler) + colonyShip
            * VeydriftCatalog.shipCargoCapacity(Ship.ColonyShip);
    }

    function transportTravelSeconds(uint256, uint256) public returns (uint256) {
        _delegateToGameplayModule();
    }

    function transportFuelCost(
        uint256,
        uint256,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip
    ) public pure returns (uint128) {
        uint256 ships =
            uint256(smallCargo) + uint256(recycler) + uint256(colonyShip);
        return _toUint128(VeydriftAntiRaidPrimitives.missionFuelCost(ships, 0));
    }

    function fleetSlotLimit(uint16 computerLevel) external pure returns (uint256) {
        return VeydriftAntiRaidPrimitives.fleetSlotLimit(computerLevel);
    }

    function protectedStorageAmount(uint256 storageCap) external pure returns (uint256) {
        return VeydriftAntiRaidPrimitives.protectedStorageAmount(storageCap);
    }

    function raidableResource(
        uint256 balance,
        uint256 cargoRemaining,
        uint256 protectedAmount,
        uint16 lootCapBps
    ) external pure returns (uint256) {
        return VeydriftAntiRaidPrimitives.raidableResource(
            balance, cargoRemaining, protectedAmount, lootCapBps
        );
    }

    function previewResources(uint256 planetId) public view returns (Resources memory resources) {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();

        resources = planetRef.resources;
        uint256 elapsed = uint256(_currentTimestamp()) - planetRef.lastSettledAt;
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

    function energyBalance(uint256 planetId)
        public
        view
        returns (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps)
    {
        return VeydriftFormulas.energyBalance(
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
            _buildingLevels[planetId][Building.FusionReactor],
            BPS
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
            lastSettledAt: _currentTimestamp(),
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
        uint64 currentTime = _currentTimestamp();
        BuildingConstruction memory construction = buildingConstructions[planetId];
        if (construction.active && currentTime >= construction.readyAt) {
            _settleResourcesUntil(planetId, construction.readyAt);
            _completeBuilding(planetId, construction);
            _settleResourcesUntil(planetId, currentTime);
            return;
        }

        _settleResourcesUntil(planetId, currentTime);
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

        emit PlanetSettled(
            planetId,
            planetRef.resources.metal,
            planetRef.resources.crystal,
            planetRef.resources.deuterium
        );
    }

    function _completeBuilding(uint256 planetId, BuildingConstruction memory construction) private {
        delete buildingConstructions[planetId];
        _buildingLevels[planetId][construction.building] = construction.targetLevel;
        emit BuildingCompleted(planetId, construction.building, construction.targetLevel);
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
            MIN_QUEUE_SECONDS
        );
    }

    function _defenseDuration(uint256 planetId, Resources memory unitCost, uint32 quantity)
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
            _technologyLevels[player][Technology.Espionage],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.Computer],
            _technologyLevels[player][Technology.Shielding]
        );

        uint256 energyRequirement =
            VeydriftCatalog.researchEnergyRequirement(technology, currentLevel);
        if (energyRequirement == 0) return;

        (uint256 producedEnergy,,) = energyBalance(planetId);
        if (producedEnergy < energyRequirement) {
            revert MissingDependency("GRAVITON_ENERGY");
        }
    }

    function _requireDefenseDependencies(uint256 planetId, Defense defense) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireDefense(
            defense,
            _buildingLevels[planetId][Building.Shipyard],
            _buildingLevels[planetId][Building.MissileSilo],
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Weapons],
            _technologyLevels[player][Technology.Shielding],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.Plasma]
        );
    }

    function _requireDefenseCapacity(uint256 planetId, Defense defense, uint32 quantity)
        private
        view
    {
        if (VeydriftCatalog.isShieldDome(defense)) {
            if (quantity != 1 || _defenseCounts[planetId][defense] != 0) {
                revert DefenseLimitReached(defense);
            }
        }

        uint8 slotsPerUnit = VeydriftCatalog.missileSlots(defense);
        if (slotsPerUnit == 0) return;

        uint32 usedSlots = _missileSiloSlotsUsed(planetId);
        uint32 requestedSlots = uint32(slotsPerUnit) * quantity;
        uint32 capacity =
            VeydriftCatalog.missileSiloCapacity(_buildingLevels[planetId][Building.MissileSilo]);
        if (usedSlots + requestedSlots > capacity) {
            revert MissileSiloCapacityExceeded(usedSlots + requestedSlots, capacity);
        }
    }

    function _missileSiloSlotsUsed(uint256 planetId) private view returns (uint32) {
        return _defenseCounts[planetId][Defense.AntiBallisticMissile]
            + (_defenseCounts[planetId][Defense.InterplanetaryMissile] * 2);
    }

    function _usedFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= MAX_BUILDING_ID; i++) {
            used += _buildingLevels[planetId][Building(i)];
        }
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

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _delegateToGameplayModule() private {
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
}
