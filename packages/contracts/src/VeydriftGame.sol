// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IERC20ReserveToken {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Deployable Base Sepolia test MVP for first-planet settlement and resource-token wiring.
/// @dev Advanced gameplay entrypoints stay in the ABI and fail explicitly until they are split into modules.
contract VeydriftGame {
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
    uint64 public constant MARKET_WITHDRAWAL_DELAY = 30 days;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    uint8 public constant MAX_POSITION = 15;
    bytes32 public constant FIRST_PLANET_DOMAIN = keccak256("veydrift.first-planet.v1");
    bytes32 public constant PLANET_SEED_DOMAIN = keccak256("veydrift.planet.v1");

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

    struct FirstPlanet {
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        uint64 settledAt;
        uint64 settledBlock;
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

    struct ResourceWithdrawal {
        bool active;
        uint256 planetId;
        Resource resource;
        uint128 amount;
        uint64 unlocksAt;
    }

    uint256 public startPrice;
    uint256 public nextPlanetId;
    address private _owner;

    mapping(address player => uint256 planetId) public homePlanetOf;
    mapping(uint256 planetId => Planet planet) private _planets;
    mapping(bytes32 coordinateKey => bool occupied) public occupiedCoordinates;
    mapping(uint256 planetId => mapping(Building building => uint16 level)) private _buildingLevels;
    mapping(uint256 planetId => BuildingConstruction construction) public buildingConstructions;
    mapping(uint256 planetId => DefenseQueue queue) public defenseQueues;
    mapping(uint256 planetId => ShipQueue queue) public shipQueues;
    mapping(address player => ResearchQueue queue) public researchQueues;
    uint256 public nextFleetId;
    mapping(address player => uint256 count) public planetCountOf;
    mapping(Resource resource => IERC20ReserveToken token) private _resourceTokens;
    Resources private _totalInternalResources;
    Resources private _lockedWithdrawalResources;
    mapping(address player => mapping(Resource resource => ResourceWithdrawal withdrawal)) public
        resourceWithdrawals;

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
    error NoFirstPlanet(address player);
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
    error RiftStabilizerRequired(uint256 planetId);
    error ResourceTokenNotConfigured(Resource resource);
    error WithdrawalActive(Resource resource);
    error WithdrawalInactive(Resource resource);
    error WithdrawalNotReady(uint64 unlocksAt);
    error TransferFailed();
    error Unauthorized(address account);
    error InvalidResource(Resource resource);
    error ResourceTokenUnset(Resource resource);
    error ResourceTransferFailed(Resource resource, address token, uint256 amount);
    error InsufficientResourceReserve(Resource resource, uint256 required, uint256 available);
    error UnsupportedGameplayModule();

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
    event FirstPlanetSettled(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        bytes32 coordinateKey,
        bytes32 planetSeed
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
    event ResourceTokenUpdated(
        Resource indexed resource, address indexed oldToken, address indexed newToken
    );
    event ResourceTokensUpdated(address metalToken, address crystalToken, address deuteriumToken);
    event ResourceReservesDeposited(
        address indexed depositor, uint128 metal, uint128 crystal, uint128 deuterium
    );
    event MarketResourceDeposited(
        address indexed player, uint256 indexed planetId, Resource indexed resource, uint128 amount
    );
    event MarketResourceWithdrawalRequested(
        address indexed player,
        uint256 indexed planetId,
        Resource indexed resource,
        uint128 amount,
        uint64 unlocksAt
    );
    event MarketResourceWithdrawalFinished(
        address indexed player, uint256 indexed planetId, Resource indexed resource, uint128 amount
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address admin) {
        _owner = admin;
        startPrice = DEFAULT_START_PRICE;
        nextPlanetId = 1;
        nextFleetId = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function setStartPrice(uint256 nextPrice) external onlyOwner {
        uint256 oldPrice = startPrice;
        startPrice = nextPrice;
        emit StartPriceUpdated(oldPrice, nextPrice);
    }

    function setResourceTokens(address metalToken, address crystalToken, address deuteriumToken)
        external
        onlyOwner
    {
        if (metalToken == address(0)) revert ResourceTokenUnset(Resource.Metal);
        if (crystalToken == address(0)) revert ResourceTokenUnset(Resource.Crystal);
        if (deuteriumToken == address(0)) revert ResourceTokenUnset(Resource.Deuterium);

        _resourceTokens[Resource.Metal] = IERC20ReserveToken(metalToken);
        _resourceTokens[Resource.Crystal] = IERC20ReserveToken(crystalToken);
        _resourceTokens[Resource.Deuterium] = IERC20ReserveToken(deuteriumToken);
        _requireCurrentReserveBacking();

        emit ResourceTokensUpdated(metalToken, crystalToken, deuteriumToken);
    }

    function setResourceToken(Resource resource, address token) external onlyOwner {
        _requireReserveResourceId(resource);
        if (token == address(0)) revert ResourceTokenUnset(resource);
        address oldToken = address(_resourceTokens[resource]);
        _resourceTokens[resource] = IERC20ReserveToken(token);
        _requireCurrentReserveBacking();
        emit ResourceTokenUpdated(resource, oldToken, token);
    }

    function depositResourceReserves(Resources calldata amount) external onlyOwner {
        _transferReserveIn(Resource.Metal, amount.metal);
        _transferReserveIn(Resource.Crystal, amount.crystal);
        _transferReserveIn(Resource.Deuterium, amount.deuterium);
        emit ResourceReservesDeposited(msg.sender, amount.metal, amount.crystal, amount.deuterium);
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(to, amount);
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

    function settlePlanet(uint256 planetId) public {
        _requirePlanetOwner(planetId);
        _settleResources(planetId);
    }

    function collectResources(uint256 planetId) external {
        settlePlanet(planetId);
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
        if (!construction.active) revert ConstructionInactive();
        if (_currentTimestamp() < construction.readyAt) {
            revert ConstructionNotReady(construction.readyAt);
        }

        _settleResources(planetId);
    }

    function startDefenseProduction(uint256, Defense, uint32) external pure {
        revert UnsupportedGameplayModule();
    }

    function finishDefenseProduction(uint256) external pure {
        revert UnsupportedGameplayModule();
    }

    function startShipProduction(uint256, Ship, uint32) external pure {
        revert UnsupportedGameplayModule();
    }

    function finishShipProduction(uint256) external pure {
        revert UnsupportedGameplayModule();
    }

    function startResearch(uint256, Technology) external pure {
        revert UnsupportedGameplayModule();
    }

    function finishResearch() external pure {
        revert UnsupportedGameplayModule();
    }

    function createColonyAtNextSlot(uint256, uint256) external pure returns (uint256) {
        revert UnsupportedGameplayModule();
    }

    function createColony(uint256, uint16, uint16, uint8) external pure returns (uint256) {
        revert UnsupportedGameplayModule();
    }

    function dispatchTransport(uint256, uint256, uint32, uint32, uint32, Resources calldata)
        external
        pure
        returns (uint256)
    {
        revert UnsupportedGameplayModule();
    }

    function recallFleet(uint256) external pure {
        revert UnsupportedGameplayModule();
    }

    function settleFleetArrival(uint256) external pure {
        revert UnsupportedGameplayModule();
    }

    function depositMarketResource(uint256, Resource, uint128) external pure {
        revert UnsupportedGameplayModule();
    }

    function requestMarketResourceWithdrawal(uint256, Resource, uint128) external pure {
        revert UnsupportedGameplayModule();
    }

    function finishMarketResourceWithdrawal(Resource) external pure {
        revert UnsupportedGameplayModule();
    }

    function planet(uint256 planetId) external view returns (Planet memory) {
        return _planets[planetId];
    }

    function resourceToken(Resource resource) external view returns (address) {
        return address(_requireReserveResource(resource));
    }

    function totalInternalResources() external view returns (Resources memory) {
        return _totalInternalResources;
    }

    function lockedWithdrawalResources() external view returns (Resources memory) {
        return _lockedWithdrawalResources;
    }

    function resourceReserveBalance(Resource resource) public view returns (uint256) {
        IERC20ReserveToken token = _requireReserveResource(resource);
        return token.balanceOf(address(this));
    }

    function resourceReserveRequirement() public view returns (Resources memory) {
        return _add(_totalInternalResources, _lockedWithdrawalResources);
    }

    function resourceReserveAvailable() public view returns (Resources memory) {
        Resources memory required = resourceReserveRequirement();
        return Resources({
            metal: _toUint128(_availableReserve(Resource.Metal, required.metal)),
            crystal: _toUint128(_availableReserve(Resource.Crystal, required.crystal)),
            deuterium: _toUint128(_availableReserve(Resource.Deuterium, required.deuterium))
        });
    }

    function fleet(uint256) external pure returns (Fleet memory fleetData) {
        return fleetData;
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

    function defenseCount(uint256, Defense) external pure returns (uint32) {
        return 0;
    }

    function shipCount(uint256, Ship) external pure returns (uint32) {
        return 0;
    }

    function technologyLevel(address, Technology) external pure returns (uint16) {
        return 0;
    }

    function maxPlanets(address) public pure returns (uint256) {
        return 1;
    }

    function coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        _validateCoordinates(galaxy, system, position);
        return keccak256(abi.encode(block.chainid, galaxy, system, position));
    }

    function planetSeed(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        _validateCoordinates(galaxy, system, position);
        return keccak256(abi.encode(PLANET_SEED_DOMAIN, block.chainid, galaxy, system, position));
    }

    function isCoordinateAvailable(uint16 galaxy, uint16 system, uint8 position)
        external
        view
        returns (bool)
    {
        return !occupiedCoordinates[coordinateKey(galaxy, system, position)];
    }

    function nextColonyCoordinates(address, uint256) external pure returns (uint16, uint16, uint8) {
        revert UnsupportedGameplayModule();
    }

    function shipCargoCapacity(Ship ship) public pure returns (uint256) {
        return VeydriftCatalog.shipCargoCapacity(ship);
    }

    function transportCargoCapacity(uint32 smallCargo, uint32 recycler, uint32 colonyShip)
        public
        pure
        returns (uint256)
    {
        return smallCargo * shipCargoCapacity(Ship.SmallCargo) + recycler
            * shipCargoCapacity(Ship.Recycler) + colonyShip * shipCargoCapacity(Ship.ColonyShip);
    }

    function transportTravelSeconds(uint256, uint256) public pure returns (uint256) {
        revert UnsupportedGameplayModule();
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
        if (ships == 0) return 0;
        return _toUint128(ships);
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
        return
            _scaleByLevel(Resources(metal, crystal, deuterium), _buildingLevels[planetId][building]);
    }

    function defenseCost(Defense defense) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
    }

    function shipCost(Ship ship) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function researchCost(address, Technology technology) public pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchBaseCost(technology);
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
            bytes32 seed = keccak256(
                abi.encode(
                    FIRST_PLANET_DOMAIN,
                    block.chainid,
                    player,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    attempt
                )
            );
            galaxy = uint16((uint256(seed) % MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % MAX_POSITION) + 1);
            if (!occupiedCoordinates[coordinateKey(galaxy, system, position)]) {
                fields = uint16(160 + ((uint256(seed) >> 48) % 80));
                temperature = _slotTemperature(
                    position, (uint256(seed) >> 64) % 21, (uint256(seed) >> 72) % 21
                );
                return (galaxy, system, position, fields, temperature);
            }
        }
        revert CoordinatesExhausted();
    }

    function _slotTemperature(uint8 position, uint256 lowRoll, uint256 highRoll)
        private
        pure
        returns (int16)
    {
        (int16 minValue, int16 maxValue) = _slotMaxTemperatureProfile(position);
        return _intInRange(minValue, maxValue, lowRoll + highRoll);
    }

    function _slotMaxTemperatureProfile(uint8 position)
        private
        pure
        returns (int16 minValue, int16 maxValue)
    {
        if (position <= 3) return (40, 120);
        if (position <= 6) return (-10, 80);
        if (position <= 9) return (-40, 40);
        if (position <= 12) return (-80, 10);
        return (-120, -20);
    }

    function _intInRange(int16 minValue, int16 maxValue, uint256 roll)
        private
        pure
        returns (int16)
    {
        uint256 span = (int256(maxValue) - int256(minValue)).toUint256() + 1;
        return (int256(minValue) + (roll % span).toInt256()).toInt16();
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireBuildingDependencies(uint256 planetId, Building building) private view {
        uint16 roboticsFactoryLevel = _buildingLevels[planetId][Building.RoboticsFactory];
        uint16 researchLabLevel = _buildingLevels[planetId][Building.ResearchLab];

        if (building == Building.Shipyard && roboticsFactoryLevel < 2) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (building == Building.ResearchLab && roboticsFactoryLevel < 1) {
            revert MissingDependency("ROBOTICS_FACTORY_1");
        }
        if (building == Building.NaniteFactory && roboticsFactoryLevel < 10) {
            revert MissingDependency("ROBOTICS_FACTORY_10");
        }
        if (building == Building.InterdimensionalRiftStabilizer && roboticsFactoryLevel < 4) {
            revert MissingDependency("ROBOTICS_FACTORY_4");
        }
        if (building == Building.InterdimensionalRiftStabilizer && researchLabLevel < 2) {
            revert MissingDependency("RESEARCH_LAB_2");
        }
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
            cost.metal,
            cost.crystal,
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

    function _reserveLimitedIncrease(Resources memory amount)
        private
        view
        returns (Resources memory)
    {
        Resources memory required = resourceReserveRequirement();
        return Resources({
            metal: _toUint128(
                _min(amount.metal, _availableReserve(Resource.Metal, required.metal))
            ),
            crystal: _toUint128(
                _min(amount.crystal, _availableReserve(Resource.Crystal, required.crystal))
            ),
            deuterium: _toUint128(
                _min(amount.deuterium, _availableReserve(Resource.Deuterium, required.deuterium))
            )
        });
    }

    function _transferReserveIn(Resource resource, uint128 amount) private {
        if (amount == 0) return;
        IERC20ReserveToken token = _requireReserveResource(resource);
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert ResourceTransferFailed(resource, address(token), amount);
        }
    }

    function _increaseInternalResources(Resources memory amount) private {
        _requireReserveCapacity(amount);
        _totalInternalResources = _add(_totalInternalResources, amount);
    }

    function _decreaseInternalResources(Resources memory amount) private {
        _totalInternalResources = Resources({
            metal: _totalInternalResources.metal - amount.metal,
            crystal: _totalInternalResources.crystal - amount.crystal,
            deuterium: _totalInternalResources.deuterium - amount.deuterium
        });
    }

    function _add(Resources memory a, Resources memory b) private pure returns (Resources memory) {
        return Resources({
            metal: a.metal + b.metal,
            crystal: a.crystal + b.crystal,
            deuterium: a.deuterium + b.deuterium
        });
    }

    function _scaleByLevel(Resources memory baseCost, uint16 currentLevel)
        private
        pure
        returns (Resources memory)
    {
        uint256 multiplier = 2 ** currentLevel;
        return Resources({
            metal: _toUint128(uint256(baseCost.metal) * multiplier),
            crystal: _toUint128(uint256(baseCost.crystal) * multiplier),
            deuterium: _toUint128(uint256(baseCost.deuterium) * multiplier)
        });
    }

    function _requireReserveCapacity(Resources memory increase) private view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserve(Resource.Metal, required.metal, increase.metal);
        _requireResourceReserve(Resource.Crystal, required.crystal, increase.crystal);
        _requireResourceReserve(Resource.Deuterium, required.deuterium, increase.deuterium);
    }

    function _requireResourceReserve(Resource resource, uint128 currentRequired, uint128 increase)
        private
        view
    {
        if (increase == 0) return;
        _requireResourceReserveBalance(resource, uint256(currentRequired) + uint256(increase));
    }

    function _availableReserve(Resource resource, uint128 currentRequired)
        private
        view
        returns (uint256)
    {
        if (!_isReserveTokenConfigured(resource)) return 0;
        uint256 available = resourceReserveBalance(resource);
        return available <= currentRequired ? 0 : available - currentRequired;
    }

    function _requireCurrentReserveBacking() private view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserveBalance(Resource.Metal, required.metal);
        _requireResourceReserveBalance(Resource.Crystal, required.crystal);
        _requireResourceReserveBalance(Resource.Deuterium, required.deuterium);
    }

    function _requireResourceReserveBalance(Resource resource, uint256 required) private view {
        uint256 available = resourceReserveBalance(resource);
        if (available < required) {
            revert InsufficientResourceReserve(resource, required, available);
        }
    }

    function _isReserveTokenConfigured(Resource resource) private view returns (bool) {
        _requireReserveResourceId(resource);
        return address(_resourceTokens[resource]) != address(0);
    }

    function _requireReserveResource(Resource resource) private view returns (IERC20ReserveToken) {
        _requireReserveResourceId(resource);
        IERC20ReserveToken token = _resourceTokens[resource];
        if (address(token) == address(0)) revert ResourceTokenUnset(resource);
        return token;
    }

    function _requireReserveResourceId(Resource resource) private pure {
        if (
            resource != Resource.Metal && resource != Resource.Crystal
                && resource != Resource.Deuterium
        ) {
            revert InvalidResource(resource);
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

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert LevelTooHigh();
        return value.toUint128();
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
