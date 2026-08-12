// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftBatchTransportModule} from "./VeydriftBatchTransportModule.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftGameProductionSettler {
    function settleProductionUntil(uint256 planetId, uint64 settledAt) external;
}

/// @notice Deployable Base Sepolia test MVP for first-planet settlement and resource-token wiring.
/// @dev Advanced gameplay entrypoints stay in the ABI and fail explicitly until they are split into modules.
contract VeydriftGame is VeydriftResourceReserves {
    address private immutable _firstPlanetSettlementModule;
    address private immutable _gameplayModule;
    address private immutable _planetManagementModule;
    address private immutable _attackProtectionModule;
    address private immutable _colonizationModule;
    address private immutable _defenseHoldModule;
    address private immutable _stateMigrationModule;
    address private immutable _batchTransportModule;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @dev Paid alliance invite fees enter the same proxy balance as first-planet fees.
    function depositPaidAllianceInviteFee() external payable {}

    constructor(
        address admin,
        address firstPlanetSettlementModule,
        address gameplayModule,
        address planetManagementModule,
        address attackProtectionModule,
        address colonizationModule,
        address defenseHoldModule,
        address stateMigrationModule
    ) VeydriftResourceReserves(admin) {
        if (
            firstPlanetSettlementModule == address(0) || gameplayModule == address(0)
                || planetManagementModule == address(0) || attackProtectionModule == address(0)
                || colonizationModule == address(0) || defenseHoldModule == address(0)
                || stateMigrationModule == address(0)
        ) revert UnsupportedGameplayModule();
        _firstPlanetSettlementModule = firstPlanetSettlementModule;
        _gameplayModule = gameplayModule;
        _planetManagementModule = planetManagementModule;
        _attackProtectionModule = attackProtectionModule;
        _colonizationModule = colonizationModule;
        _defenseHoldModule = defenseHoldModule;
        _stateMigrationModule = stateMigrationModule;
        _batchTransportModule = address(new VeydriftBatchTransportModule());
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert Unauthorized(admin);
        __VeydriftGameStorage_init(admin);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert Unauthorized(nextOwner);
        address oldOwner = _owner;
        _owner = nextOwner;
        emit OwnershipTransferred(oldOwner, nextOwner);
    }

    function startPlanet() external payable returns (uint256) {
        _delegateToFirstPlanetSettlementModule();
    }

    function startPlanetWithReferral(bytes32, uint8, bytes32, bytes32)
        external
        payable
        returns (uint256)
    {
        _delegateToFirstPlanetSettlementModule();
    }

    function settleFirstPlanet() external payable returns (FirstPlanet memory) {
        _delegateToFirstPlanetSettlementModule();
    }

    function settleFirstPlanetWithReferral(bytes32, uint8, bytes32, bytes32)
        external
        payable
        returns (FirstPlanet memory)
    {
        _delegateToFirstPlanetSettlementModule();
    }

    function startPlanetWithAllianceInvite(bytes32, uint64, uint8, bytes32, bytes32)
        external
        payable
        returns (uint256)
    {
        _delegateToFirstPlanetSettlementModule();
    }

    /// @notice Canonical score used for alliance-war declaration snapshots.
    /// @dev Exposes the same calculation already used by attack score protection; no oracle or
    /// off-chain ranking can influence a war exemption.
    function playerScore(address player) external view returns (uint256) {
        return _totalUserScore(player);
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
        // Lazy on-chain reconciliation (VEY-KANEO-477): settle BEFORE the active check so a construction
        // whose `readyAt` has elapsed completes here and clears `active`, letting the owner immediately
        // queue the next upgrade without a finish tx. Mirrors `startMoonBuildingUpgrade`. A construction
        // that is genuinely still in progress stays active and correctly trips `ConstructionActive`.
        _settleResources(planetId);
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

    /// @notice Back-compat wrapper (VEY-KANEO-468): building upgrades auto-settle inside
    ///         `_settleResources` like every other completion, so this no longer gates on the
    ///         construction being ready — it simply runs the lazy reconcile, which completes the
    ///         upgrade once `readyAt` has elapsed (and is a no-op before then or when idle).
    function finishBuildingUpgrade(uint256 planetId) external {
        _touchPlayer(msg.sender);
        _requirePlanetOwner(planetId);
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

    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        if (cutoffAt == type(uint64).max) {
            _settleResources(planetId);
        } else {
            _delegateToColonizationModule();
        }
    }

    function settleProductionUntil(uint256, uint64) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        _delegateToFirstPlanetSettlementModule();
    }

    /// @notice Cuts every owned planet's canonical production interval immediately before an
    /// alliance roster transition, so paid-invite bonuses follow actual membership time rather
    /// than membership at a later lazy collection.
    function settleAllianceMembershipBoundary(address player) external {
        if (msg.sender != _allianceSystem) revert Unauthorized(msg.sender);
        uint256[] storage planetIds = _ownedPlanetIds[player];
        uint64 settledAt = uint64(block.timestamp);
        for (uint256 i = 0; i < planetIds.length;) {
            _settleResourcesUpTo(planetIds[i], settledAt);
            unchecked {
                ++i;
            }
        }
    }

    function settleDuePlayerColonizeArrivals(address) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        _delegateToColonizationModule();
    }

    function settleDuePlayerCombatArrivals(address) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        _delegateToPlanetManagementModule();
    }

    function untrackResolvedFleetMission(uint256) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
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

    function setRandomnessEngine(address) external {
        _delegateToFirstPlanetSettlementModule();
    }

    function setMigrationSettlement(address) external {
        _delegateToFirstPlanetSettlementModule();
    }

    function setGamePaused(bool) external {
        _delegateToFirstPlanetSettlementModule();
    }

    function reserveMigrationCoordinates(
        uint16[] calldata galaxies,
        uint16[] calldata systems,
        uint8[] calldata positions
    ) external {
        if (msg.sender != _owner && msg.sender != _migrationSettlement) {
            revert Unauthorized(msg.sender);
        }
        uint256 count = galaxies.length;
        if (systems.length != count || positions.length != count) revert InvalidCoordinates();
        for (uint256 i = 0; i < count; i++) {
            occupiedCoordinates[coordinateKey(galaxies[i], systems[i], positions[i])] = true;
        }
    }

    function importMigratedState(address, bytes calldata) external payable {
        _delegateToStateMigrationModule();
    }

    function importMigratedStateWithReferral(
        address player,
        bytes calldata,
        bytes32,
        uint8,
        bytes32,
        bytes32
    ) external payable {
        _delegateToStateMigrationModuleWithoutReturn();
        _activateInviteeProductionBoost(player);
    }

    function releaseExcessResourceReserves(address, Resources calldata, Resources calldata)
        external
    {
        _delegateToStateMigrationModule();
    }

    /// @dev UNUSED / DORMANT: SpaceDock is never set on the live deployment, so `_spaceDockSystem`
    ///      stays `address(0)` and combat wreckage recording no-ops. See VeydriftSpaceDockSystem and
    ///      closed issue #804 before wiring this up.
    function setSpaceDockSystem(address) external {
        _delegateToColonizationModule();
    }

    function setAllianceSystem(address nextAllianceSystem) external onlyOwner {
        _allianceSystem = nextAllianceSystem;
    }

    function spendMoonResources(uint256, Resources calldata) external {
        _delegateToColonizationModule();
    }

    function grantMoonResources(uint256, Resources calldata) external {
        _delegateToColonizationModule();
    }

    function setMoonShipCount(uint256, Ship, uint32) external {
        _delegateToColonizationModule();
    }

    function moveMoonGateShips(uint256, uint256, address, MissionShips calldata) external {
        _delegateToColonizationModule();
    }

    function clearMoonState(uint256) external {
        _delegateToColonizationModule();
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

    function launchBodyFleetMission(
        uint256,
        uint256,
        FleetMissionType,
        MissionShips calldata,
        Resources calldata,
        uint16,
        bool,
        bool
    ) external returns (uint256) {
        _touchPlayer(msg.sender);
        _delegateToDefenseHoldModule();
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

    /// @notice Launch an Attack mission with a player-selected loot ratio.
    /// @dev Implemented in the gameplay module, which has the EIP-170 headroom for the launch and
    ///      loot-ratio bookkeeping; the facade only forwards the call via delegatecall.
    function launchAttackMission(
        uint256,
        uint256,
        MissionShips calldata,
        Resources calldata,
        uint16,
        uint256,
        LootRatio calldata
    ) external returns (uint256) {
        _touchPlayer(msg.sender);
        _delegateToPlayModule();
    }

    function joinAttackMission(uint256, uint256, uint256, MissionShips calldata, Resources calldata)
        external
        returns (uint256)
    {
        _touchPlayer(msg.sender);
        _delegateToPlayModule();
    }

    /// @notice Launch an OGame-style ACS Defend (DefenseHold) mission: station a fleet at a planet
    ///         for a chosen hold window so it defends any attack that lands during the hold.
    function launchDefenseHold(
        uint256,
        uint256,
        MissionShips calldata,
        Resources calldata,
        uint16,
        uint256
    ) external returns (uint256) {
        _touchPlayer(msg.sender);
        _delegateToDefenseHoldModule();
    }

    function recallFleetMission(uint256 missionId) external {
        _touchPlayer(msg.sender);
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.missionType == FleetMissionType.DefenseHold) {
            _delegateToDefenseHoldModule();
        }
        _delegateToPlayModule();
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        FleetMissionType missionType = mission.missionType;
        if (
            missionType == FleetMissionType.Colonize
                || ((missionType == FleetMissionType.Transport
                        || missionType == FleetMissionType.Deploy)
                    && mission.targetIsMoon)
        ) {
            _delegateToColonizationModule();
        }
        if (missionType == FleetMissionType.DefenseHold) {
            _delegateToDefenseHoldModule();
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

    fallback() external {
        // First-planet preview selectors stay in the proxy surface through fallback to keep the
        // size-constrained implementation below EIP-170's 24 KiB limit.
        if (msg.sig == 0xf5a25efb) {
            // The view ABI for production reads must remain stable even though the production
            // code lives in a module. Only an internal staticcall may use this unlisted router;
            // otherwise a regular caller could route arbitrary module calldata through it.
            if (msg.sender != address(this)) revert Unauthorized(msg.sender);
            _delegateToFirstPlanetSettlementModule(msg.data[4:]);
        } else if (msg.sig == 0x29147f24 || msg.sig == 0x729b082f || msg.sig == 0x1d750846) {
            _delegateToFirstPlanetSettlementModule();
        } else if (msg.sig == 0x9c26e0be) {
            (bool ok, bytes memory result) = _batchTransportModule.delegatecall(msg.data);
            assembly ("memory-safe") {
                switch ok
                case 0 { revert(add(result, 32), mload(result)) }
                default { return(add(result, 32), mload(result)) }
            }
        } else {
            _delegateToStateMigrationModule();
        }
    }

    function planet(uint256 planetId) external view returns (Planet memory) {
        return _planets[planetId];
    }

    function moonResources(uint256 planetId) external view returns (Resources memory) {
        return _moonResources[planetId];
    }

    function moonShipCount(uint256 planetId, Ship ship) external view returns (uint32) {
        return _moonShipCounts[planetId][ship];
    }

    function requireNoPendingMoonAttackResolution(uint256 planetId) external view {
        _requireNoPendingMissionResolutionForPlanet(planetId);
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

    /// @dev Staticcall enters the proxy's internal read router, which delegatecalls the module
    ///      under a static context. This retains the historical `view` ABI on the Game facade.
    function previewResources(uint256 planetId) external view returns (Resources memory) {
        bytes memory result = _readFromFirstPlanetSettlementModule(
            abi.encodeWithSelector(this.previewResources.selector, planetId)
        );
        return abi.decode(result, (Resources));
    }

    function productionPerHour(uint256 planetId)
        external
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        bytes memory result = _readFromFirstPlanetSettlementModule(
            abi.encodeWithSelector(this.productionPerHour.selector, planetId)
        );
        return abi.decode(result, (uint256, uint256, uint256));
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
        _settleResourcesUpTo(planetId, uint64(block.timestamp));
        _settleDuePlanet(planetId);
    }

    /// @dev Advances production (and any due building completion) up to `ceiling`. Callers that must
    ///      not proceed while a mission is unresolved gate this behind
    ///      `_requireNoPendingMissionResolutionForPlanet`; passive collection instead caps `ceiling`
    ///      at the earliest unresolved arrival so it never reverts and never settles across it.
    function _settleResourcesUpTo(uint256 planetId, uint64 ceiling) private {
        BuildingConstruction memory construction = buildingConstructions[planetId];
        if (construction.active && ceiling >= construction.readyAt) {
            _settleResourcesUntil(planetId, construction.readyAt);
            _completeBuilding(planetId, construction);
            _settleResourcesUntil(planetId, ceiling);
            return;
        }

        _settleResourcesUntil(planetId, ceiling);
    }

    function _collectPlanetResources(uint256 planetId) private {
        _requirePlanetOwner(planetId);
        uint64 ceiling = uint64(block.timestamp);
        uint64 pendingArrival = _earliestPendingMissionArrivalForPlanet(planetId);
        if (pendingArrival < ceiling) {
            ceiling = pendingArrival;
        }
        _settleResourcesUpTo(planetId, ceiling);
        _emitPlanetSettled(planetId);
    }

    function _settleResourcesUntil(uint256 planetId, uint64 settledAt) private {
        IVeydriftGameProductionSettler(address(this)).settleProductionUntil(planetId, settledAt);
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
        _emitPlanetSettled(planetId);
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
        _requireGameNotPaused();
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

    function _delegateToFirstPlanetSettlementModule() private {
        _delegateToFirstPlanetSettlementModule(msg.data);
    }

    function _delegateToFirstPlanetSettlementModule(bytes calldata data) private {
        (bool ok, bytes memory result) = _firstPlanetSettlementModule.delegatecall(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _readFromFirstPlanetSettlementModule(bytes memory data)
        private
        view
        returns (bytes memory result)
    {
        (bool ok, bytes memory response) =
            address(this).staticcall(abi.encodePacked(bytes4(0xf5a25efb), data));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(response, 32), mload(response))
            }
        }
        return response;
    }

    function _delegateToPlanetManagementModule() private {
        _requireGameNotPaused();
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
        _requireGameNotPaused();
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

    function _delegateToDefenseHoldModule() private {
        _requireGameNotPaused();
        (bool ok, bytes memory result) = _defenseHoldModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _delegateToStateMigrationModule() private {
        _requireGameNotPaused();
        (bool ok, bytes memory result) = _stateMigrationModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function _delegateToStateMigrationModuleWithoutReturn() private {
        _requireGameNotPaused();
        (bool ok, bytes memory result) = _stateMigrationModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
