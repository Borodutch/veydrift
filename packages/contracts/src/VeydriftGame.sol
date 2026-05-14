// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Playable Veydrift MVP: one home planet, lazy resources, production, units, and research.
/// @dev MVP simplifications: no colonies, fleet movement, combat, espionage reports, markets, or NFTs.
contract VeydriftGame is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeCast for int256;
    using SafeCast for uint256;

    uint256 public constant DEFAULT_START_PRICE = 0.05 ether;
    uint8 public constant MAX_BUILDING_ID = uint8(type(Building).max);
    uint8 public constant MAX_DEFENSE_ID = uint8(type(Defense).max);
    uint8 public constant MAX_SHIP_ID = uint8(type(Ship).max);
    uint8 public constant MAX_TECHNOLOGY_ID = uint8(type(Technology).max);
    uint8 public constant MAX_RESOURCE_ID = uint8(type(Resource).max);
    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant BPS = 10_000;
    uint32 public constant MIN_QUEUE_SECONDS = 60;
    uint32 public constant MIN_FLEET_TRAVEL_SECONDS = 5 minutes;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    uint8 public constant MAX_POSITION = 15;

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

    struct BuildingConstruction {
        bool active;
        Building building;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct DefenseQueue {
        bool active;
        Defense defense;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct ShipQueue {
        bool active;
        Ship ship;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct ResearchQueue {
        bool active;
        Technology technology;
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

    mapping(address player => uint256 planetId) public homePlanetOf;
    mapping(uint256 planetId => Planet planet) private _planets;
    mapping(bytes32 coordinateKey => bool occupied) public occupiedCoordinates;
    mapping(uint256 planetId => mapping(Building building => uint16 level)) private _buildingLevels;
    mapping(uint256 planetId => mapping(Defense defense => uint32 count)) private _defenseCounts;
    mapping(uint256 planetId => mapping(Ship ship => uint32 count)) private _shipCounts;
    mapping(address player => mapping(Technology technology => uint16 level)) private
        _technologyLevels;
    mapping(uint256 planetId => BuildingConstruction construction) public buildingConstructions;
    mapping(uint256 planetId => DefenseQueue queue) public defenseQueues;
    mapping(uint256 planetId => ShipQueue queue) public shipQueues;
    mapping(address player => ResearchQueue queue) public researchQueues;
    uint256 public nextFleetId;
    mapping(address player => uint256 count) public planetCountOf;
    mapping(uint256 fleetId => Fleet fleet) private _fleets;

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
    error ConstructionActive();
    error ConstructionInactive();
    error ConstructionNotReady(uint64 readyAt);
    error InsufficientResources(uint128 metal, uint128 crystal, uint128 deuterium);
    error MissingDependency(bytes32 dependency);
    error FieldCapacityReached();
    error LevelTooHigh();
    error InvalidCoordinates();
    error CoordinatesOccupied();
    error PlanetLimitReached(uint256 limit);
    error InsufficientShips(Ship ship, uint32 available, uint32 required);
    error SamePlanet();
    error CargoCapacityExceeded(uint256 capacity, uint256 cargo);
    error FleetInactive();
    error FleetNotOwner();
    error FleetNotArrived(uint64 arrivesAt);
    error FleetAlreadyReturning();
    error FleetAlreadyArrived();
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
    event BuildingStarted(
        uint256 indexed planetId,
        Building indexed building,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event BuildingCompleted(uint256 indexed planetId, Building indexed building, uint16 level);
    event DefenseQueued(
        uint256 indexed planetId,
        Defense indexed defense,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event DefenseCompleted(
        uint256 indexed planetId, Defense indexed defense, uint32 quantity, uint32 total
    );
    event ShipQueued(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ShipCompleted(uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint32 total);
    event ResearchQueued(
        address indexed player,
        Technology indexed technology,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ResearchCompleted(address indexed player, Technology indexed technology, uint16 level);
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

        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);

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
            lastSettledAt: _currentTimestamp(),
            resources: Resources({metal: 5_000, crystal: 5_000, deuterium: 5_000})
        });

        emit PlanetStarted(msg.sender, planetId, galaxy, system, position, fields, temperature);
    }

    function settlePlanet(uint256 planetId) public {
        _requirePlanetOwner(planetId);
        Planet storage planetRef = _planets[planetId];
        planetRef.resources = previewResources(planetId);
        planetRef.lastSettledAt = _currentTimestamp();
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

    function startBuildingUpgrade(uint256 planetId, Building building) external {
        _requirePlanetOwner(planetId);
        if (buildingConstructions[planetId].active) {
            revert ConstructionActive();
        }
        uint16 currentLevel = _buildingLevels[planetId][building];
        if (currentLevel >= MAX_LEVEL) {
            revert LevelTooHigh();
        }
        if (_usedFields(planetId) >= _planets[planetId].fields) {
            revert FieldCapacityReached();
        }

        _requireBuildingDependencies(planetId, building);
        settlePlanet(planetId);

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
        if (!construction.active) {
            revert ConstructionInactive();
        }
        if (_currentTimestamp() < construction.readyAt) {
            revert ConstructionNotReady(construction.readyAt);
        }

        delete buildingConstructions[planetId];
        _buildingLevels[planetId][construction.building] = construction.targetLevel;
        emit BuildingCompleted(planetId, construction.building, construction.targetLevel);
    }

    function startDefenseProduction(uint256 planetId, Defense defense, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (defenseQueues[planetId].active) {
            revert QueueActive();
        }

        _requireDefenseDependencies(planetId, defense);
        settlePlanet(planetId);

        Resources memory cost = _multiply(defenseCost(defense), quantity);
        _spend(planetId, cost);
        uint64 readyAt =
            (uint256(_currentTimestamp()) + _unitDuration(planetId, cost, quantity)).toUint64();
        defenseQueues[planetId] = DefenseQueue({
            active: true, defense: defense, quantity: quantity, readyAt: readyAt, cost: cost
        });

        emit DefenseQueued(
            planetId, defense, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        DefenseQueue memory queue = defenseQueues[planetId];
        if (!queue.active) {
            revert QueueInactive();
        }
        if (_currentTimestamp() < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete defenseQueues[planetId];
        _defenseCounts[planetId][queue.defense] += queue.quantity;
        emit DefenseCompleted(
            planetId, queue.defense, queue.quantity, _defenseCounts[planetId][queue.defense]
        );
    }

    function startShipProduction(uint256 planetId, Ship ship, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (shipQueues[planetId].active) {
            revert QueueActive();
        }

        _requireShipDependencies(planetId, ship);
        settlePlanet(planetId);

        Resources memory cost = _multiply(shipCost(ship), quantity);
        _spend(planetId, cost);
        uint64 readyAt =
            (uint256(_currentTimestamp()) + _unitDuration(planetId, cost, quantity)).toUint64();
        shipQueues[planetId] =
            ShipQueue({active: true, ship: ship, quantity: quantity, readyAt: readyAt, cost: cost});

        emit ShipQueued(planetId, ship, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium);
    }

    function finishShipProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        ShipQueue memory queue = shipQueues[planetId];
        if (!queue.active) {
            revert QueueInactive();
        }
        if (_currentTimestamp() < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete shipQueues[planetId];
        _shipCounts[planetId][queue.ship] += queue.quantity;
        emit ShipCompleted(planetId, queue.ship, queue.quantity, _shipCounts[planetId][queue.ship]);
    }

    function startResearch(uint256 planetId, Technology technology) external {
        _requirePlanetOwner(planetId);
        if (researchQueues[msg.sender].active) {
            revert QueueActive();
        }
        if (_buildingLevels[planetId][Building.ResearchLab] == 0) {
            revert MissingDependency("RESEARCH_LAB");
        }
        uint16 currentLevel = _technologyLevels[msg.sender][technology];
        if (currentLevel >= MAX_LEVEL) {
            revert LevelTooHigh();
        }

        _requireResearchDependencies(msg.sender, planetId, technology);
        settlePlanet(planetId);

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
        if (!queue.active) {
            revert QueueInactive();
        }
        if (_currentTimestamp() < queue.readyAt) {
            revert QueueNotReady(queue.readyAt);
        }

        delete researchQueues[msg.sender];
        _technologyLevels[msg.sender][queue.technology] = queue.targetLevel;
        emit ResearchCompleted(msg.sender, queue.technology, queue.targetLevel);
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

        uint64 currentTime = _currentTimestamp();
        uint256 travelSeconds = transportTravelSeconds(originPlanetId, destinationPlanetId);
        uint64 arrivesAt = (uint256(currentTime) + travelSeconds).toUint64();
        fleetId = nextFleetId++;
        Fleet memory launched = Fleet({
            active: true,
            returning: false,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            destinationPlanetId: destinationPlanetId,
            dispatchedAt: currentTime,
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
        uint64 currentTime = _currentTimestamp();
        if (currentTime >= fleetRef.arrivesAt) {
            revert FleetAlreadyArrived();
        }

        uint256 elapsed = uint256(currentTime) - fleetRef.dispatchedAt;
        if (elapsed < MIN_QUEUE_SECONDS) {
            elapsed = MIN_QUEUE_SECONDS;
        }
        fleetRef.returning = true;
        fleetRef.dispatchedAt = currentTime;
        fleetRef.arrivesAt = (uint256(currentTime) + elapsed).toUint64();

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
        if (_currentTimestamp() < fleetRef.arrivesAt) {
            revert FleetNotArrived(fleetRef.arrivesAt);
        }

        uint256 arrivalPlanetId =
            fleetRef.returning ? fleetRef.originPlanetId : fleetRef.destinationPlanetId;
        settlePlanet(arrivalPlanetId);

        Resources memory nextResources = _add(_planets[arrivalPlanetId].resources, fleetRef.cargo);
        _planets[arrivalPlanetId].resources = _capResources(arrivalPlanetId, nextResources);
        _shipCounts[arrivalPlanetId][Ship.SmallCargo] += fleetRef.smallCargo;
        _shipCounts[arrivalPlanetId][Ship.Recycler] += fleetRef.recycler;
        _shipCounts[arrivalPlanetId][Ship.ColonyShip] += fleetRef.colonyShip;

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
        return 1 + uint256(_technologyLevels[player][Technology.Computer]);
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

    function shipCargoCapacity(Ship ship) public pure returns (uint256) {
        return VeydriftCatalog.shipCargoCapacity(ship);
    }

    function transportCargoCapacity(uint32 smallCargo, uint32 recycler, uint32 colonyShip)
        public
        pure
        returns (uint256)
    {
        return uint256(smallCargo) * shipCargoCapacity(Ship.SmallCargo) + uint256(recycler)
            * shipCargoCapacity(Ship.Recycler) + uint256(colonyShip)
            * shipCargoCapacity(Ship.ColonyShip);
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
        uint256 driveLevel = _technologyLevels[origin.owner][Technology.CombustionDrive];
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
        uint256 elapsed = uint256(_currentTimestamp()) - planetRef.lastSettledAt;
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
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
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
        uint16 currentLevel = _buildingLevels[planetId][building];
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.buildingBaseCost(building);
        return _scaleByLevel(Resources(metal, crystal, deuterium), currentLevel);
    }

    function defenseCost(Defense defense) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
    }

    function shipCost(Ship ship) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function researchCost(address player, Technology technology)
        public
        view
        returns (Resources memory)
    {
        uint16 currentLevel = _technologyLevels[player][technology];
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchBaseCost(technology);
        return _scaleByLevel(Resources(metal, crystal, deuterium), currentLevel);
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
        _removeShips(originPlanetId, Ship.ColonyShip, 1);

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
            lastSettledAt: _currentTimestamp(),
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
        (metalMultiplier, crystalMultiplier, deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);
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

    function _removeShips(uint256 planetId, Ship ship, uint32 quantity) private {
        if (quantity == 0) {
            return;
        }
        uint32 available = _shipCounts[planetId][ship];
        if (available < quantity) {
            revert InsufficientShips(ship, available, quantity);
        }
        _shipCounts[planetId][ship] = available - quantity;
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

        _removeShips(originPlanetId, Ship.SmallCargo, smallCargo);
        _removeShips(originPlanetId, Ship.Recycler, recycler);
        _removeShips(originPlanetId, Ship.ColonyShip, colonyShip);

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

    function _requireBuildingDependencies(uint256 planetId, Building building) private view {
        VeydriftDependencies.requireBuilding(
            building, _buildingLevels[planetId][Building.RoboticsFactory]
        );
    }

    function _requireDefenseDependencies(uint256 planetId, Defense defense) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireDefense(
            defense,
            _buildingLevels[planetId][Building.Shipyard],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Shielding],
            _technologyLevels[player][Technology.Plasma]
        );
    }

    function _requireShipDependencies(uint256 planetId, Ship ship) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireShip(
            ship,
            _buildingLevels[planetId][Building.Shipyard],
            _technologyLevels[player][Technology.Espionage],
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive],
            _technologyLevels[player][Technology.Hyperspace],
            _technologyLevels[player][Technology.Graviton]
        );
    }

    function _requireResearchDependencies(address player, uint256, Technology technology)
        private
        view
    {
        VeydriftDependencies.requireResearch(
            technology,
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Hyperspace],
            _technologyLevels[player][Technology.Espionage],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.Computer]
        );
    }

    function _buildingDuration(uint256 planetId, Resources memory cost)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.buildingDuration(
            _buildingLevels[planetId][Building.RoboticsFactory],
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
            _buildingLevels[planetId][Building.Shipyard],
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
            _buildingLevels[planetId][Building.ResearchLab],
            cost.metal,
            cost.crystal,
            cost.deuterium,
            MIN_QUEUE_SECONDS
        );
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

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) {
            revert LevelTooHigh();
        }
        return value.toUint128();
    }

    function _currentTimestamp() private view returns (uint64) {
        return block.timestamp.toUint64();
    }
}
