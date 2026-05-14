// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";

/// @notice Playable Veydrift MVP: one home planet, lazy resources, queues, units, and research.
/// @dev MVP simplifications: no colonies, fleet movement, combat, espionage reports, markets, or NFTs.
contract VeydriftGame is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 public constant DEFAULT_START_PRICE = 0.05 ether;
    uint8 public constant MAX_BUILDING_ID = uint8(type(Building).max);
    uint8 public constant MAX_DEFENSE_ID = uint8(type(Defense).max);
    uint8 public constant MAX_SHIP_ID = uint8(type(Ship).max);
    uint8 public constant MAX_TECHNOLOGY_ID = uint8(type(Technology).max);
    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant BPS = 10_000;
    uint32 public constant MIN_QUEUE_SECONDS = 60;

    enum Building {
        MetalMine,
        CrystalMine,
        DeuteriumSynthesizer,
        SolarPlant,
        RoboticsFactory,
        Shipyard,
        ResearchLab,
        MetalStorage,
        CrystalStorage,
        DeuteriumTank
    }

    enum Defense {
        RocketLauncher,
        LightLaser,
        HeavyLaser,
        SmallShieldDome
    }

    enum Ship {
        SmallCargo,
        LightFighter,
        Recycler,
        ColonyShip
    }

    enum Technology {
        Energy,
        Laser,
        Ion,
        CombustionDrive,
        Espionage,
        Computer,
        Weapons,
        Shielding,
        Armor
    }

    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    struct Planet {
        address owner;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        uint16 metalMultiplierBps;
        uint16 crystalMultiplierBps;
        uint16 deuteriumMultiplierBps;
        uint64 lastSettledAt;
        Resources resources;
    }

    struct BuildQueue {
        bool active;
        uint8 buildingId;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct UnitQueue {
        bool active;
        uint8 unitId;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct ResearchQueue {
        bool active;
        uint8 technologyId;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    uint256 public startPrice;
    uint256 public nextPlanetId;

    mapping(address player => uint256 planetId) public homePlanetOf;
    mapping(uint256 planetId => Planet planet) private _planets;
    mapping(bytes32 coordinateKey => bool occupied) public occupiedCoordinates;
    mapping(uint256 planetId => mapping(uint8 buildingId => uint16 level)) private _buildingLevels;
    mapping(uint256 planetId => mapping(uint8 defenseId => uint32 count)) private _defenseCounts;
    mapping(uint256 planetId => mapping(uint8 shipId => uint32 count)) private _shipCounts;
    mapping(address player => mapping(uint8 technologyId => uint16 level)) private
        _technologyLevels;
    mapping(uint256 planetId => BuildQueue queue) public buildingQueues;
    mapping(uint256 planetId => UnitQueue queue) public defenseQueues;
    mapping(uint256 planetId => UnitQueue queue) public shipQueues;
    mapping(address player => ResearchQueue queue) public researchQueues;

    error AlreadyStarted();
    error BadStartPayment();
    error CoordinatesExhausted();
    error InvalidId();
    error InvalidQuantity();
    error NoPlanet();
    error NotPlanetOwner();
    error QueueActive();
    error QueueInactive();
    error QueueNotReady(uint64 readyAt);
    error InsufficientResources(uint128 metal, uint128 crystal, uint128 deuterium);
    error MissingDependency(bytes32 dependency);
    error FieldCapacityReached();
    error LevelTooHigh();
    error TransferFailed();

    event StartPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event PlanetStarted(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        int16 temperature
    );
    event PlanetSettled(
        uint256 indexed planetId, uint128 metal, uint128 crystal, uint128 deuterium
    );
    event BuildingQueued(
        uint256 indexed planetId,
        uint8 indexed buildingId,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event BuildingCompleted(uint256 indexed planetId, uint8 indexed buildingId, uint16 level);
    event DefenseQueued(
        uint256 indexed planetId,
        uint8 indexed defenseId,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event DefenseCompleted(
        uint256 indexed planetId, uint8 indexed defenseId, uint32 quantity, uint32 total
    );
    event ShipQueued(
        uint256 indexed planetId,
        uint8 indexed shipId,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ShipCompleted(
        uint256 indexed planetId, uint8 indexed shipId, uint32 quantity, uint32 total
    );
    event ResearchQueued(
        address indexed player,
        uint8 indexed technologyId,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ResearchCompleted(address indexed player, uint8 indexed technologyId, uint16 level);
    event FeesWithdrawn(address indexed to, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __Ownable_init(admin);
        startPrice = DEFAULT_START_PRICE;
        nextPlanetId = 1;
    }

    function setStartPrice(uint256 nextPrice) external onlyOwner {
        uint256 oldPrice = startPrice;
        startPrice = nextPrice;
        emit StartPriceUpdated(oldPrice, nextPrice);
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            revert TransferFailed();
        }
        emit FeesWithdrawn(to, amount);
    }

    function startPlanet() external payable returns (uint256 planetId) {
        if (homePlanetOf[msg.sender] != 0) {
            revert AlreadyStarted();
        }
        if (msg.value != startPrice) {
            revert BadStartPayment();
        }

        planetId = nextPlanetId++;
        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) =
            _generatePlanet(msg.sender, planetId);

        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);

        homePlanetOf[msg.sender] = planetId;
        _planets[planetId] = Planet({
            owner: msg.sender,
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: uint64(block.timestamp),
            resources: Resources({metal: 5_000, crystal: 5_000, deuterium: 5_000})
        });

        emit PlanetStarted(msg.sender, planetId, galaxy, system, position, fields, temperature);
    }

    function settlePlanet(uint256 planetId) public {
        _requirePlanetOwner(planetId);
        _collectReadyOutputs(planetId, msg.sender);
    }

    function collectResources(uint256 planetId) external {
        settlePlanet(planetId);
    }

    function collectShips(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _settleResources(planetId);
        _collectReadyShips(planetId);
    }

    function startBuildingUpgrade(uint256 planetId, uint8 buildingId) external {
        _requirePlanetOwner(planetId);
        _validateId(buildingId, MAX_BUILDING_ID);
        if (buildingQueues[planetId].active) {
            revert QueueActive();
        }
        uint16 currentLevel = _buildingLevels[planetId][buildingId];
        if (currentLevel >= MAX_LEVEL) {
            revert LevelTooHigh();
        }
        if (_usedFields(planetId) >= _planets[planetId].fields) {
            revert FieldCapacityReached();
        }

        _requireBuildingDependencies(planetId, buildingId);
        settlePlanet(planetId);

        Resources memory cost = buildingUpgradeCost(planetId, buildingId);
        _spend(planetId, cost);

        uint64 readyAt = uint64(block.timestamp + _buildingDuration(planetId, cost));
        uint16 targetLevel = currentLevel + 1;
        buildingQueues[planetId] = BuildQueue({
            active: true,
            buildingId: buildingId,
            targetLevel: targetLevel,
            readyAt: readyAt,
            cost: cost
        });

        emit BuildingQueued(
            planetId, buildingId, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishBuildingUpgrade(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        BuildQueue memory queue = buildingQueues[planetId];
        if (!queue.active) {
            revert QueueInactive();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete buildingQueues[planetId];
        _buildingLevels[planetId][queue.buildingId] = queue.targetLevel;
        emit BuildingCompleted(planetId, queue.buildingId, queue.targetLevel);
    }

    function startDefenseProduction(uint256 planetId, uint8 defenseId, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _validateId(defenseId, MAX_DEFENSE_ID);
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (defenseQueues[planetId].active) {
            revert QueueActive();
        }

        _requireDefenseDependencies(planetId, defenseId);
        settlePlanet(planetId);

        Resources memory cost = _multiply(defenseCost(defenseId), quantity);
        _spend(planetId, cost);
        uint64 readyAt = uint64(block.timestamp + _unitDuration(planetId, cost, quantity));
        defenseQueues[planetId] = UnitQueue({
            active: true, unitId: defenseId, quantity: quantity, readyAt: readyAt, cost: cost
        });

        emit DefenseQueued(
            planetId, defenseId, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        UnitQueue memory queue = defenseQueues[planetId];
        if (!queue.active) {
            revert QueueInactive();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete defenseQueues[planetId];
        _defenseCounts[planetId][queue.unitId] += queue.quantity;
        emit DefenseCompleted(
            planetId, queue.unitId, queue.quantity, _defenseCounts[planetId][queue.unitId]
        );
    }

    function startShipProduction(uint256 planetId, uint8 shipId, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _validateId(shipId, MAX_SHIP_ID);
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (shipQueues[planetId].active) {
            revert QueueActive();
        }

        _requireShipDependencies(planetId, shipId);
        settlePlanet(planetId);

        Resources memory cost = _multiply(shipCost(shipId), quantity);
        _spend(planetId, cost);
        uint64 readyAt = uint64(block.timestamp + _unitDuration(planetId, cost, quantity));
        shipQueues[planetId] = UnitQueue({
            active: true, unitId: shipId, quantity: quantity, readyAt: readyAt, cost: cost
        });

        emit ShipQueued(
            planetId, shipId, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishShipProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        UnitQueue memory queue = shipQueues[planetId];
        if (!queue.active) {
            revert QueueInactive();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete shipQueues[planetId];
        _shipCounts[planetId][queue.unitId] += queue.quantity;
        emit ShipCompleted(
            planetId, queue.unitId, queue.quantity, _shipCounts[planetId][queue.unitId]
        );
    }

    function startResearch(uint256 planetId, uint8 technologyId) external {
        _requirePlanetOwner(planetId);
        _validateId(technologyId, MAX_TECHNOLOGY_ID);
        if (researchQueues[msg.sender].active) {
            revert QueueActive();
        }
        if (_buildingLevels[planetId][uint8(Building.ResearchLab)] == 0) {
            revert MissingDependency("RESEARCH_LAB");
        }
        uint16 currentLevel = _technologyLevels[msg.sender][technologyId];
        if (currentLevel >= MAX_LEVEL) {
            revert LevelTooHigh();
        }

        _requireResearchDependencies(msg.sender, planetId, technologyId);
        settlePlanet(planetId);

        Resources memory cost = researchCost(msg.sender, technologyId);
        _spend(planetId, cost);
        uint64 readyAt = uint64(block.timestamp + _researchDuration(planetId, cost));
        uint16 targetLevel = currentLevel + 1;
        researchQueues[msg.sender] = ResearchQueue({
            active: true,
            technologyId: technologyId,
            targetLevel: targetLevel,
            readyAt: readyAt,
            cost: cost
        });

        emit ResearchQueued(
            msg.sender, technologyId, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishResearch() external {
        ResearchQueue memory queue = researchQueues[msg.sender];
        if (!queue.active) {
            revert QueueInactive();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete researchQueues[msg.sender];
        _technologyLevels[msg.sender][queue.technologyId] = queue.targetLevel;
        emit ResearchCompleted(msg.sender, queue.technologyId, queue.targetLevel);
    }

    function planet(uint256 planetId) external view returns (Planet memory) {
        return _planets[planetId];
    }

    function buildingQueue(uint256 planetId) external view returns (BuildQueue memory) {
        return buildingQueues[planetId];
    }

    function defenseQueue(uint256 planetId) external view returns (UnitQueue memory) {
        return defenseQueues[planetId];
    }

    function shipQueue(uint256 planetId) external view returns (UnitQueue memory) {
        return shipQueues[planetId];
    }

    function researchQueue(address player) external view returns (ResearchQueue memory) {
        return researchQueues[player];
    }

    function buildingLevel(uint256 planetId, uint8 buildingId) external view returns (uint16) {
        _validateId(buildingId, MAX_BUILDING_ID);
        return _buildingLevels[planetId][buildingId];
    }

    function defenseCount(uint256 planetId, uint8 defenseId) external view returns (uint32) {
        _validateId(defenseId, MAX_DEFENSE_ID);
        return _defenseCounts[planetId][defenseId];
    }

    function shipCount(uint256 planetId, uint8 shipId) external view returns (uint32) {
        _validateId(shipId, MAX_SHIP_ID);
        return _shipCounts[planetId][shipId];
    }

    function technologyLevel(address player, uint8 technologyId) external view returns (uint16) {
        _validateId(technologyId, MAX_TECHNOLOGY_ID);
        return _technologyLevels[player][technologyId];
    }

    function previewResources(uint256 planetId) public view returns (Resources memory resources) {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) {
            revert NoPlanet();
        }

        resources = planetRef.resources;
        uint256 elapsed = block.timestamp - planetRef.lastSettledAt;
        if (elapsed == 0) {
            return resources;
        }

        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deutPerHour) =
            productionPerHour(planetId);
        Resources memory produced = Resources({
            metal: _toUint128((metalPerHour * elapsed) / 1 hours),
            crystal: _toUint128((crystalPerHour * elapsed) / 1 hours),
            deuterium: _toUint128((deutPerHour * elapsed) / 1 hours)
        });
        resources = _capResources(planetId, _add(resources, produced));
    }

    function productionPerHour(uint256 planetId)
        public
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) {
            revert NoPlanet();
        }

        return VeydriftFormulas.productionPerHour(
            _buildingLevels[planetId][uint8(Building.MetalMine)],
            _buildingLevels[planetId][uint8(Building.CrystalMine)],
            _buildingLevels[planetId][uint8(Building.DeuteriumSynthesizer)],
            _buildingLevels[planetId][uint8(Building.SolarPlant)],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps,
            BPS
        );
    }

    function storageCaps(uint256 planetId)
        public
        view
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        if (_planets[planetId].owner == address(0)) {
            revert NoPlanet();
        }
        return VeydriftFormulas.storageCaps(
            _buildingLevels[planetId][uint8(Building.MetalStorage)],
            _buildingLevels[planetId][uint8(Building.CrystalStorage)],
            _buildingLevels[planetId][uint8(Building.DeuteriumTank)]
        );
    }

    function buildingUpgradeCost(uint256 planetId, uint8 buildingId)
        public
        view
        returns (Resources memory)
    {
        _validateId(buildingId, MAX_BUILDING_ID);
        uint16 currentLevel = _buildingLevels[planetId][buildingId];
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.buildingBaseCost(buildingId);
        return _scaleByLevel(Resources(metal, crystal, deuterium), currentLevel);
    }

    function defenseCost(uint8 defenseId) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defenseId);
        return Resources(metal, crystal, deuterium);
    }

    function shipCost(uint8 shipId) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(shipId);
        return Resources(metal, crystal, deuterium);
    }

    function researchCost(address player, uint8 technologyId)
        public
        view
        returns (Resources memory)
    {
        _validateId(technologyId, MAX_TECHNOLOGY_ID);
        uint16 currentLevel = _technologyLevels[player][technologyId];
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchBaseCost(technologyId);
        return _scaleByLevel(Resources(metal, crystal, deuterium), currentLevel);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _collectReadyOutputs(uint256 planetId, address player) private {
        _settleResources(planetId);
        _collectReadyBuilding(planetId);
        _collectReadyDefense(planetId);
        _collectReadyShips(planetId);
        _collectReadyResearch(player);
    }

    function _settleResources(uint256 planetId) private {
        Planet storage planetRef = _planets[planetId];
        planetRef.resources = previewResources(planetId);
        planetRef.lastSettledAt = uint64(block.timestamp);
        emit PlanetSettled(
            planetId,
            planetRef.resources.metal,
            planetRef.resources.crystal,
            planetRef.resources.deuterium
        );
    }

    function _collectReadyBuilding(uint256 planetId) private {
        BuildQueue memory queue = buildingQueues[planetId];
        // forge-lint: disable-next-line(block-timestamp)
        if (!queue.active || block.timestamp < queue.readyAt) {
            return;
        }

        delete buildingQueues[planetId];
        _buildingLevels[planetId][queue.buildingId] = queue.targetLevel;
        emit BuildingCompleted(planetId, queue.buildingId, queue.targetLevel);
    }

    function _collectReadyDefense(uint256 planetId) private {
        UnitQueue memory queue = defenseQueues[planetId];
        // forge-lint: disable-next-line(block-timestamp)
        if (!queue.active || block.timestamp < queue.readyAt) {
            return;
        }

        delete defenseQueues[planetId];
        _defenseCounts[planetId][queue.unitId] += queue.quantity;
        emit DefenseCompleted(
            planetId, queue.unitId, queue.quantity, _defenseCounts[planetId][queue.unitId]
        );
    }

    function _collectReadyShips(uint256 planetId) private {
        UnitQueue memory queue = shipQueues[planetId];
        // forge-lint: disable-next-line(block-timestamp)
        if (!queue.active || block.timestamp < queue.readyAt) {
            return;
        }

        delete shipQueues[planetId];
        _shipCounts[planetId][queue.unitId] += queue.quantity;
        emit ShipCompleted(
            planetId, queue.unitId, queue.quantity, _shipCounts[planetId][queue.unitId]
        );
    }

    function _collectReadyResearch(address player) private {
        ResearchQueue memory queue = researchQueues[player];
        // forge-lint: disable-next-line(block-timestamp)
        if (!queue.active || block.timestamp < queue.readyAt) {
            return;
        }

        delete researchQueues[player];
        _technologyLevels[player][queue.technologyId] = queue.targetLevel;
        emit ResearchCompleted(player, queue.technologyId, queue.targetLevel);
    }

    function _generatePlanet(address player, uint256 planetId)
        private
        returns (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed =
                keccak256(abi.encode(block.chainid, address(this), player, planetId, attempt));
            galaxy = uint16((uint256(seed) % 9) + 1);
            system = uint16(((uint256(seed) >> 16) % 499) + 1);
            position = uint8(((uint256(seed) >> 32) % 15) + 1);
            bytes32 key = keccak256(abi.encode(galaxy, system, position));
            if (!occupiedCoordinates[key]) {
                occupiedCoordinates[key] = true;
                fields = uint16(160 + ((uint256(seed) >> 48) % 80));
                temperature = int16(
                    int256(20) - int256(uint256(position) * 5) + int256((uint256(seed) >> 64) % 21)
                );
                return (galaxy, system, position, fields, temperature);
            }
        }
        revert CoordinatesExhausted();
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) {
            revert NoPlanet();
        }
        if (planetRef.owner != msg.sender) {
            revert NotPlanetOwner();
        }
    }

    function _requireBuildingDependencies(uint256 planetId, uint8 buildingId) private view {
        VeydriftDependencies.requireBuilding(
            buildingId, _buildingLevels[planetId][uint8(Building.RoboticsFactory)]
        );
    }

    function _requireDefenseDependencies(uint256 planetId, uint8 defenseId) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireDefense(
            defenseId,
            _buildingLevels[planetId][uint8(Building.Shipyard)],
            _technologyLevels[player][uint8(Technology.Laser)],
            _technologyLevels[player][uint8(Technology.Shielding)]
        );
    }

    function _requireShipDependencies(uint256 planetId, uint8 shipId) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireShip(
            shipId,
            _buildingLevels[planetId][uint8(Building.Shipyard)],
            _technologyLevels[player][uint8(Technology.CombustionDrive)]
        );
    }

    function _requireResearchDependencies(address player, uint256, uint8 technologyId)
        private
        view
    {
        VeydriftDependencies.requireResearch(
            technologyId,
            _technologyLevels[player][uint8(Technology.Energy)],
            _technologyLevels[player][uint8(Technology.Laser)]
        );
    }

    function _buildingDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.buildingDuration(
            _buildingLevels[planetId][uint8(Building.RoboticsFactory)],
            cost.metal,
            cost.crystal,
            MIN_QUEUE_SECONDS
        );
    }

    function _unitDuration(uint256 planetId, Resources memory cost, uint32 quantity)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.unitDuration(
            _buildingLevels[planetId][uint8(Building.Shipyard)],
            cost.metal,
            cost.crystal,
            cost.deuterium,
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
            _buildingLevels[planetId][uint8(Building.ResearchLab)],
            cost.metal,
            cost.crystal,
            cost.deuterium,
            MIN_QUEUE_SECONDS
        );
    }

    function _usedFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= MAX_BUILDING_ID; i++) {
            used += _buildingLevels[planetId][i];
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
    }

    function _capResources(uint256 planetId, Resources memory resources)
        private
        view
        returns (Resources memory)
    {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = storageCaps(planetId);
        if (resources.metal > metalCap) resources.metal = metalCap;
        if (resources.crystal > crystalCap) resources.crystal = crystalCap;
        if (resources.deuterium > deuteriumCap) resources.deuterium = deuteriumCap;
        return resources;
    }

    function _add(Resources memory a, Resources memory b) private pure returns (Resources memory) {
        return Resources({
            metal: a.metal + b.metal,
            crystal: a.crystal + b.crystal,
            deuterium: a.deuterium + b.deuterium
        });
    }

    function _multiply(Resources memory resources, uint256 quantity)
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

    function _scaleByLevel(Resources memory baseCost, uint16 currentLevel)
        private
        pure
        returns (Resources memory)
    {
        uint256 multiplier = 2 ** uint256(currentLevel);
        return _multiply(baseCost, multiplier);
    }

    function _validateId(uint8 id, uint8 maxId) private pure {
        if (id > maxId) {
            revert InvalidId();
        }
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) {
            revert LevelTooHigh();
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(value);
    }
}
