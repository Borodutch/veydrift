// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

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
    uint32 public constant MIN_FLEET_TRAVEL_SECONDS = 5 minutes;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    uint8 public constant MAX_POSITION = 15;

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

    struct Fleet {
        bool active;
        bool returning;
        address owner;
        uint256 originPlanetId;
        uint256 destinationPlanetId;
        uint64 dispatchedAt;
        uint64 arrivesAt;
        uint128 fuelCost;
        Resources cargo;
        uint32 smallCargo;
        uint32 recycler;
        uint32 colonyShip;
    }

    uint256 public startPrice;
    uint256 public nextPlanetId;
    uint256 public nextFleetId;

    mapping(address player => uint256 planetId) public homePlanetOf;
    mapping(address player => uint256 count) public planetCountOf;
    mapping(uint256 planetId => Planet planet) private _planets;
    mapping(uint256 fleetId => Fleet fleet) private _fleets;
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
    event ColonyCreated(
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 indexed colonyPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        int16 temperature
    );
    event FleetDispatched(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 destinationPlanetId,
        uint64 arrivesAt,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 fuelCost
    );
    event FleetRecalled(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 destinationPlanetId,
        uint64 arrivesAt
    );
    event FleetArrived(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed destinationPlanetId,
        bool returning
    );
    event ResourcesTransferred(
        uint256 indexed fleetId,
        uint256 indexed originPlanetId,
        uint256 indexed destinationPlanetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

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
    error InvalidCoordinates();
    error CoordinatesOccupied();
    error PlanetLimitReached(uint256 limit);
    error InsufficientShips(uint8 shipId, uint32 available, uint32 required);
    error SamePlanet();
    error CargoCapacityExceeded(uint256 capacity, uint256 cargo);
    error FleetInactive();
    error FleetNotOwner();
    error FleetNotArrived(uint64 arrivesAt);
    error FleetAlreadyReturning();
    error FleetAlreadyArrived();
    error TransferFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __Ownable_init(admin);
        startPrice = DEFAULT_START_PRICE;
        nextPlanetId = 1;
        nextFleetId = 1;
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

        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 temperatureIndex = uint256(int256(temperature) + 80);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 metalMultiplier = uint16(9_500 + ((temperatureIndex * 4) % 1_000));
        uint16 crystalMultiplier = uint16(9_600 + (uint256(fields) * 3) % 800);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 deuteriumMultiplier = uint16(10_800 - temperatureIndex * 3);

        homePlanetOf[msg.sender] = planetId;
        planetCountOf[msg.sender] = 1;
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

    function collectResources(uint256 planetId) external {
        settlePlanet(planetId);
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

    function createColonyAtNextSlot(uint256 originPlanetId, uint256 salt)
        external
        returns (uint256 colonyPlanetId)
    {
        (uint16 galaxy, uint16 system, uint8 position) = nextColonyCoordinates(msg.sender, salt);
        colonyPlanetId = _createColony(originPlanetId, galaxy, system, position);
    }

    function createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        external
        returns (uint256 colonyPlanetId)
    {
        colonyPlanetId = _createColony(originPlanetId, galaxy, system, position);
    }

    function dispatchTransport(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip,
        Resources calldata cargo
    ) external returns (uint256 fleetId) {
        _requirePlanetOwner(originPlanetId);
        _requirePlanetOwner(destinationPlanetId);
        if (originPlanetId == destinationPlanetId) {
            revert SamePlanet();
        }
        if (smallCargo == 0 && recycler == 0 && colonyShip == 0) {
            revert InvalidQuantity();
        }

        settlePlanet(originPlanetId);
        settlePlanet(destinationPlanetId);

        uint128 fuelCost = _debitTransportDeparture(
            originPlanetId, destinationPlanetId, smallCargo, recycler, colonyShip, cargo
        );
        _spend(
            originPlanetId,
            Resources({
                metal: cargo.metal,
                crystal: cargo.crystal,
                deuterium: _toUint128(uint256(cargo.deuterium) + uint256(fuelCost))
            })
        );

        uint64 arrivesAt =
            uint64(block.timestamp + transportTravelSeconds(originPlanetId, destinationPlanetId));
        fleetId = nextFleetId++;
        Fleet memory launched = Fleet({
            active: true,
            returning: false,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            destinationPlanetId: destinationPlanetId,
            dispatchedAt: uint64(block.timestamp),
            arrivesAt: arrivesAt,
            fuelCost: fuelCost,
            cargo: cargo,
            smallCargo: smallCargo,
            recycler: recycler,
            colonyShip: colonyShip
        });
        _fleets[fleetId] = launched;

        _emitFleetDispatched(fleetId, launched);
    }

    function recallFleet(uint256 fleetId) external {
        Fleet storage fleetRef = _fleets[fleetId];
        _requireActiveFleetOwner(fleetRef);
        if (fleetRef.returning) {
            revert FleetAlreadyReturning();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= fleetRef.arrivesAt) {
            revert FleetAlreadyArrived();
        }

        uint256 elapsed = block.timestamp - fleetRef.dispatchedAt;
        if (elapsed < MIN_QUEUE_SECONDS) {
            elapsed = MIN_QUEUE_SECONDS;
        }
        fleetRef.returning = true;
        fleetRef.dispatchedAt = uint64(block.timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        fleetRef.arrivesAt = uint64(block.timestamp + elapsed);

        emit FleetRecalled(
            fleetId,
            msg.sender,
            fleetRef.originPlanetId,
            fleetRef.destinationPlanetId,
            fleetRef.arrivesAt
        );
    }

    function settleFleetArrival(uint256 fleetId) external {
        Fleet storage fleetRef = _fleets[fleetId];
        _requireActiveFleetOwner(fleetRef);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < fleetRef.arrivesAt) {
            revert FleetNotArrived(fleetRef.arrivesAt);
        }

        uint256 arrivalPlanetId =
            fleetRef.returning ? fleetRef.originPlanetId : fleetRef.destinationPlanetId;
        settlePlanet(arrivalPlanetId);

        Resources memory nextResources = _add(_planets[arrivalPlanetId].resources, fleetRef.cargo);
        _planets[arrivalPlanetId].resources = _capResources(arrivalPlanetId, nextResources);
        _shipCounts[arrivalPlanetId][uint8(Ship.SmallCargo)] += fleetRef.smallCargo;
        _shipCounts[arrivalPlanetId][uint8(Ship.Recycler)] += fleetRef.recycler;
        _shipCounts[arrivalPlanetId][uint8(Ship.ColonyShip)] += fleetRef.colonyShip;

        fleetRef.active = false;

        emit FleetArrived(fleetId, msg.sender, arrivalPlanetId, fleetRef.returning);
        emit ResourcesTransferred(
            fleetId,
            fleetRef.originPlanetId,
            arrivalPlanetId,
            fleetRef.cargo.metal,
            fleetRef.cargo.crystal,
            fleetRef.cargo.deuterium
        );
    }

    function planet(uint256 planetId) external view returns (Planet memory) {
        return _planets[planetId];
    }

    function fleet(uint256 fleetId) external view returns (Fleet memory) {
        return _fleets[fleetId];
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

    function maxPlanets(address player) public view returns (uint256) {
        return 1 + uint256(_technologyLevels[player][uint8(Technology.Computer)]);
    }

    function coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(galaxy, system, position));
    }

    function isCoordinateAvailable(uint16 galaxy, uint16 system, uint8 position)
        external
        view
        returns (bool)
    {
        _validateCoordinates(galaxy, system, position);
        return !occupiedCoordinates[coordinateKey(galaxy, system, position)];
    }

    function nextColonyCoordinates(address player, uint256 salt)
        public
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed = keccak256(
                abi.encode(block.chainid, address(this), player, nextPlanetId, salt, attempt)
            );
            galaxy = uint16((uint256(seed) % MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % MAX_POSITION) + 1);
            if (!occupiedCoordinates[coordinateKey(galaxy, system, position)]) {
                return (galaxy, system, position);
            }
        }
        revert CoordinatesExhausted();
    }

    function shipCargoCapacity(uint8 shipId) public pure returns (uint256) {
        if (shipId == uint8(Ship.SmallCargo)) return 5_000;
        if (shipId == uint8(Ship.LightFighter)) return 50;
        if (shipId == uint8(Ship.Recycler)) return 20_000;
        if (shipId == uint8(Ship.ColonyShip)) return 7_500;
        revert InvalidId();
    }

    function transportCargoCapacity(uint32 smallCargo, uint32 recycler, uint32 colonyShip)
        public
        pure
        returns (uint256)
    {
        return uint256(smallCargo) * shipCargoCapacity(uint8(Ship.SmallCargo)) + uint256(recycler)
            * shipCargoCapacity(uint8(Ship.Recycler)) + uint256(colonyShip)
            * shipCargoCapacity(uint8(Ship.ColonyShip));
    }

    function transportTravelSeconds(uint256 originPlanetId, uint256 destinationPlanetId)
        public
        view
        returns (uint256)
    {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        if (origin.owner == address(0) || destination.owner == address(0)) {
            revert NoPlanet();
        }
        uint256 driveLevel = _technologyLevels[origin.owner][uint8(Technology.CombustionDrive)];
        return MIN_FLEET_TRAVEL_SECONDS + (_coordinateDistance(origin, destination) * 60)
            / (driveLevel + 1);
    }

    function transportFuelCost(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip
    ) public view returns (uint128) {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        if (origin.owner == address(0) || destination.owner == address(0)) {
            revert NoPlanet();
        }
        uint256 ships = uint256(smallCargo) + uint256(recycler) + uint256(colonyShip);
        if (ships == 0) {
            return 0;
        }
        uint256 consumption =
            uint256(smallCargo) * 10 + uint256(recycler) * 50 + uint256(colonyShip) * 100;
        uint256 cost = (consumption * _coordinateDistance(origin, destination)) / 1_000;
        if (cost < ships) {
            cost = ships;
        }
        return _toUint128(cost);
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

        uint256 metalLevel = _buildingLevels[planetId][uint8(Building.MetalMine)];
        uint256 crystalLevel = _buildingLevels[planetId][uint8(Building.CrystalMine)];
        uint256 deutLevel = _buildingLevels[planetId][uint8(Building.DeuteriumSynthesizer)];
        uint256 requiredEnergy = (metalLevel * 10) + (crystalLevel * 12) + (deutLevel * 20);
        uint256 producedEnergy = _buildingLevels[planetId][uint8(Building.SolarPlant)] * 30;
        uint256 energyScale = requiredEnergy == 0 || producedEnergy >= requiredEnergy
            ? BPS
            : (producedEnergy * BPS) / requiredEnergy;

        metalPerHour = _scaleByBps(
            (30 + (metalLevel * 20) + (metalLevel * metalLevel * 5)), planetRef.metalMultiplierBps
        );
        crystalPerHour = _scaleByBps(
            (15 + (crystalLevel * 15) + (crystalLevel * crystalLevel * 4)),
            planetRef.crystalMultiplierBps
        );
        deuteriumPerHour = _scaleByBps(
            (8 + (deutLevel * 10) + (deutLevel * deutLevel * 3)), planetRef.deuteriumMultiplierBps
        );

        if (requiredEnergy != 0) {
            metalPerHour = _scaleByBps(metalPerHour, energyScale);
            crystalPerHour = _scaleByBps(crystalPerHour, energyScale);
            deuteriumPerHour = _scaleByBps(deuteriumPerHour, energyScale);
        }
    }

    function storageCaps(uint256 planetId)
        public
        view
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        if (_planets[planetId].owner == address(0)) {
            revert NoPlanet();
        }
        metalCap = _toUint128(
            10_000 + uint256(_buildingLevels[planetId][uint8(Building.MetalStorage)]) * 10_000
        );
        crystalCap = _toUint128(
            10_000 + uint256(_buildingLevels[planetId][uint8(Building.CrystalStorage)]) * 10_000
        );
        deuteriumCap = _toUint128(
            10_000 + uint256(_buildingLevels[planetId][uint8(Building.DeuteriumTank)]) * 10_000
        );
    }

    function buildingUpgradeCost(uint256 planetId, uint8 buildingId)
        public
        view
        returns (Resources memory)
    {
        _validateId(buildingId, MAX_BUILDING_ID);
        uint16 currentLevel = _buildingLevels[planetId][buildingId];
        return _scaleByLevel(_buildingBaseCost(buildingId), currentLevel);
    }

    function defenseCost(uint8 defenseId) public pure returns (Resources memory) {
        if (defenseId == uint8(Defense.RocketLauncher)) return Resources(200, 0, 0);
        if (defenseId == uint8(Defense.LightLaser)) return Resources(1_500, 500, 0);
        if (defenseId == uint8(Defense.HeavyLaser)) return Resources(6_000, 2_000, 0);
        if (defenseId == uint8(Defense.SmallShieldDome)) return Resources(10_000, 10_000, 0);
        revert InvalidId();
    }

    function shipCost(uint8 shipId) public pure returns (Resources memory) {
        if (shipId == uint8(Ship.SmallCargo)) return Resources(2_000, 2_000, 0);
        if (shipId == uint8(Ship.LightFighter)) return Resources(3_000, 1_000, 0);
        if (shipId == uint8(Ship.Recycler)) return Resources(10_000, 6_000, 2_000);
        if (shipId == uint8(Ship.ColonyShip)) return Resources(10_000, 20_000, 10_000);
        revert InvalidId();
    }

    function researchCost(address player, uint8 technologyId)
        public
        view
        returns (Resources memory)
    {
        _validateId(technologyId, MAX_TECHNOLOGY_ID);
        uint16 currentLevel = _technologyLevels[player][technologyId];
        return _scaleByLevel(_researchBaseCost(technologyId), currentLevel);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        private
        returns (uint256 colonyPlanetId)
    {
        _requirePlanetOwner(originPlanetId);
        _validateCoordinates(galaxy, system, position);

        uint256 limit = maxPlanets(msg.sender);
        if (planetCountOf[msg.sender] >= limit) {
            revert PlanetLimitReached(limit);
        }

        bytes32 key = coordinateKey(galaxy, system, position);
        if (occupiedCoordinates[key]) {
            revert CoordinatesOccupied();
        }

        settlePlanet(originPlanetId);
        _removeShips(originPlanetId, uint8(Ship.ColonyShip), 1);

        colonyPlanetId = nextPlanetId++;
        (
            uint16 fields,
            int16 temperature,
            uint16 metalMultiplier,
            uint16 crystalMultiplier,
            uint16 deuteriumMultiplier
        ) = _planetTraits(msg.sender, colonyPlanetId, galaxy, system, position);

        occupiedCoordinates[key] = true;
        planetCountOf[msg.sender] += 1;
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
            lastSettledAt: uint64(block.timestamp),
            resources: Resources({metal: 500, crystal: 500, deuterium: 0})
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

    function _planetTraits(
        address player,
        uint256 planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position
    )
        private
        view
        returns (
            uint16 fields,
            int16 temperature,
            uint16 metalMultiplier,
            uint16 crystalMultiplier,
            uint16 deuteriumMultiplier
        )
    {
        bytes32 seed = keccak256(
            abi.encode(block.chainid, address(this), player, planetId, galaxy, system, position)
        );
        fields = uint16(160 + (uint256(seed) % 80));
        temperature =
            int16(int256(20) - int256(uint256(position) * 5) + int256((uint256(seed) >> 16) % 21));
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 temperatureIndex = uint256(int256(temperature) + 80);
        metalMultiplier = uint16(9_500 + ((temperatureIndex * 4) % 1_000));
        crystalMultiplier = uint16(9_600 + (uint256(fields) * 3) % 800);
        // forge-lint: disable-next-line(unsafe-typecast)
        deuteriumMultiplier = uint16(10_800 - temperatureIndex * 3);
    }

    function _generatePlanet(address player, uint256 planetId)
        private
        returns (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed =
                keccak256(abi.encode(block.chainid, address(this), player, planetId, attempt));
            galaxy = uint16((uint256(seed) % MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % MAX_POSITION) + 1);
            bytes32 key = coordinateKey(galaxy, system, position);
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

    function _requireActiveFleetOwner(Fleet storage fleetRef) private view {
        if (!fleetRef.active) {
            revert FleetInactive();
        }
        if (fleetRef.owner != msg.sender) {
            revert FleetNotOwner();
        }
    }

    function _validateCoordinates(uint16 galaxy, uint16 system, uint8 position) private pure {
        if (
            galaxy == 0 || galaxy > MAX_GALAXY || system == 0 || system > MAX_SYSTEM
                || position == 0 || position > MAX_POSITION
        ) {
            revert InvalidCoordinates();
        }
    }

    function _removeShips(uint256 planetId, uint8 shipId, uint32 quantity) private {
        if (quantity == 0) {
            return;
        }
        uint32 available = _shipCounts[planetId][shipId];
        if (available < quantity) {
            revert InsufficientShips(shipId, available, quantity);
        }
        _shipCounts[planetId][shipId] = available - quantity;
    }

    function _debitTransportDeparture(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip,
        Resources calldata cargo
    ) private returns (uint128 fuelCost) {
        uint256 cargoAmount = uint256(cargo.metal) + uint256(cargo.crystal)
            + uint256(cargo.deuterium);
        uint256 capacity = transportCargoCapacity(smallCargo, recycler, colonyShip);
        if (cargoAmount > capacity) {
            revert CargoCapacityExceeded(capacity, cargoAmount);
        }

        _removeShips(originPlanetId, uint8(Ship.SmallCargo), smallCargo);
        _removeShips(originPlanetId, uint8(Ship.Recycler), recycler);
        _removeShips(originPlanetId, uint8(Ship.ColonyShip), colonyShip);

        fuelCost = transportFuelCost(
            originPlanetId, destinationPlanetId, smallCargo, recycler, colonyShip
        );
    }

    function _emitFleetDispatched(uint256 fleetId, Fleet memory fleetData) private {
        emit FleetDispatched(
            fleetId,
            fleetData.owner,
            fleetData.originPlanetId,
            fleetData.destinationPlanetId,
            fleetData.arrivesAt,
            fleetData.smallCargo,
            fleetData.recycler,
            fleetData.colonyShip,
            fleetData.cargo.metal,
            fleetData.cargo.crystal,
            fleetData.cargo.deuterium,
            fleetData.fuelCost
        );
    }

    function _requireBuildingDependencies(uint256 planetId, uint8 buildingId) private view {
        if (
            buildingId == uint8(Building.Shipyard)
                && _buildingLevels[planetId][uint8(Building.RoboticsFactory)] < 2
        ) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (
            buildingId == uint8(Building.ResearchLab)
                && _buildingLevels[planetId][uint8(Building.RoboticsFactory)] < 1
        ) {
            revert MissingDependency("ROBOTICS_FACTORY_1");
        }
    }

    function _requireDefenseDependencies(uint256 planetId, uint8 defenseId) private view {
        if (_buildingLevels[planetId][uint8(Building.Shipyard)] == 0) {
            revert MissingDependency("SHIPYARD");
        }
        address player = _planets[planetId].owner;
        if (
            defenseId == uint8(Defense.LightLaser)
                && _technologyLevels[player][uint8(Technology.Laser)] < 1
        ) {
            revert MissingDependency("LASER_1");
        }
        if (
            defenseId == uint8(Defense.HeavyLaser)
                && _technologyLevels[player][uint8(Technology.Laser)] < 3
        ) {
            revert MissingDependency("LASER_3");
        }
        if (
            defenseId == uint8(Defense.SmallShieldDome)
                && _technologyLevels[player][uint8(Technology.Shielding)] < 2
        ) {
            revert MissingDependency("SHIELDING_2");
        }
    }

    function _requireShipDependencies(uint256 planetId, uint8 shipId) private view {
        if (_buildingLevels[planetId][uint8(Building.Shipyard)] == 0) {
            revert MissingDependency("SHIPYARD");
        }
        address player = _planets[planetId].owner;
        if (
            (shipId == uint8(Ship.SmallCargo) || shipId == uint8(Ship.LightFighter))
                && _technologyLevels[player][uint8(Technology.CombustionDrive)] < 1
        ) {
            revert MissingDependency("COMBUSTION_1");
        }
        if (
            shipId == uint8(Ship.Recycler)
                && _technologyLevels[player][uint8(Technology.CombustionDrive)] < 2
        ) {
            revert MissingDependency("COMBUSTION_2");
        }
        if (
            shipId == uint8(Ship.ColonyShip)
                && _technologyLevels[player][uint8(Technology.CombustionDrive)] < 3
        ) {
            revert MissingDependency("COMBUSTION_3");
        }
    }

    function _requireResearchDependencies(address player, uint256, uint8 technologyId)
        private
        view
    {
        if (
            technologyId == uint8(Technology.Laser)
                && _technologyLevels[player][uint8(Technology.Energy)] < 1
        ) {
            revert MissingDependency("ENERGY_1");
        }
        if (
            technologyId == uint8(Technology.Ion)
                && _technologyLevels[player][uint8(Technology.Laser)] < 2
        ) {
            revert MissingDependency("LASER_2");
        }
        if (
            technologyId == uint8(Technology.Shielding)
                && _technologyLevels[player][uint8(Technology.Energy)] < 1
        ) {
            revert MissingDependency("ENERGY_1");
        }
    }

    function _buildingBaseCost(uint8 buildingId) private pure returns (Resources memory) {
        if (buildingId == uint8(Building.MetalMine)) return Resources(60, 15, 0);
        if (buildingId == uint8(Building.CrystalMine)) return Resources(48, 24, 0);
        if (buildingId == uint8(Building.DeuteriumSynthesizer)) return Resources(225, 75, 0);
        if (buildingId == uint8(Building.SolarPlant)) return Resources(75, 30, 0);
        if (buildingId == uint8(Building.RoboticsFactory)) return Resources(400, 120, 0);
        if (buildingId == uint8(Building.Shipyard)) return Resources(400, 200, 100);
        if (buildingId == uint8(Building.ResearchLab)) return Resources(200, 400, 200);
        if (buildingId == uint8(Building.MetalStorage)) return Resources(1_000, 0, 0);
        if (buildingId == uint8(Building.CrystalStorage)) return Resources(1_000, 500, 0);
        if (buildingId == uint8(Building.DeuteriumTank)) return Resources(1_000, 1_000, 0);
        revert InvalidId();
    }

    function _researchBaseCost(uint8 technologyId) private pure returns (Resources memory) {
        if (technologyId == uint8(Technology.Energy)) return Resources(0, 800, 400);
        if (technologyId == uint8(Technology.Laser)) return Resources(200, 100, 0);
        if (technologyId == uint8(Technology.Ion)) return Resources(1_000, 300, 100);
        if (technologyId == uint8(Technology.CombustionDrive)) return Resources(400, 0, 600);
        if (technologyId == uint8(Technology.Espionage)) return Resources(200, 1_000, 200);
        if (technologyId == uint8(Technology.Computer)) return Resources(0, 400, 600);
        if (technologyId == uint8(Technology.Weapons)) return Resources(800, 200, 0);
        if (technologyId == uint8(Technology.Shielding)) return Resources(200, 600, 0);
        if (technologyId == uint8(Technology.Armor)) return Resources(1_000, 0, 0);
        revert InvalidId();
    }

    function _buildingDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        uint256 robotics = _buildingLevels[planetId][uint8(Building.RoboticsFactory)];
        uint256 raw = (uint256(cost.metal) + uint256(cost.crystal)) / (100 * (robotics + 1));
        return raw < MIN_QUEUE_SECONDS ? MIN_QUEUE_SECONDS : raw;
    }

    function _unitDuration(uint256 planetId, Resources memory cost, uint32 quantity)
        private
        view
        returns (uint256)
    {
        uint256 shipyard = _buildingLevels[planetId][uint8(Building.Shipyard)];
        uint256 raw = (uint256(cost.metal) + uint256(cost.crystal) + uint256(cost.deuterium))
            / (200 * (shipyard + 1));
        raw += quantity * 10;
        return raw < MIN_QUEUE_SECONDS ? MIN_QUEUE_SECONDS : raw;
    }

    function _researchDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        uint256 lab = _buildingLevels[planetId][uint8(Building.ResearchLab)];
        uint256 raw = (uint256(cost.metal) + uint256(cost.crystal) + uint256(cost.deuterium))
            / (120 * (lab + 1));
        return raw < MIN_QUEUE_SECONDS ? MIN_QUEUE_SECONDS : raw;
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

    function _scaleByBps(uint256 value, uint256 multiplierBps) private pure returns (uint256) {
        return (value * multiplierBps) / BPS;
    }

    function _coordinateDistance(Planet storage origin, Planet storage destination)
        private
        view
        returns (uint256)
    {
        uint256 distance = _absDiff(origin.galaxy, destination.galaxy) * 20_000
            + _absDiff(origin.system, destination.system) * 95
            + _absDiff(origin.position, destination.position) * 5;
        if (distance == 0) {
            return 5;
        }
        return distance;
    }

    function _absDiff(uint256 a, uint256 b) private pure returns (uint256) {
        return a >= b ? a - b : b - a;
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
