// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {VeydriftReserveRelease} from "./libraries/VeydriftReserveRelease.sol";
import {Building, Defense, MoonBuilding, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftStateMigrationMoonSystem {
    function importMigratedMoonState(
        uint256 planetId,
        address player,
        uint16 fields,
        uint16 diameterKm,
        uint64 createdAt,
        uint64 jumpGateReadyAt,
        VeydriftResourceReserves.Resources calldata resources,
        uint16[4] calldata buildingLevels,
        uint32[16] calldata shipCounts,
        uint32[10] calldata defenseCounts,
        VeydriftStateMigrationModule.MigrationMoonBuildingConstruction calldata buildingQueue,
        VeydriftStateMigrationModule.MigrationMoonDefenseQueue calldata defenseQueue
    ) external;
}

interface IVeydriftStateMigrationReferralSystem {
    function redeemReferralInvite(
        address invitee,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable returns (address inviter);
}

/// @notice Delegatecall target for signed testnet-to-mainnet state imports.
contract VeydriftStateMigrationModule is VeydriftResourceReserves {
    uint128 private constant REFERRAL_STARTING_METAL_BONUS = 500;
    uint128 private constant REFERRAL_STARTING_CRYSTAL_BONUS = 500;

    address private immutable _referralSystem;

    struct MigrationPlanetState {
        uint256 planetId;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        uint64 lastSettledAt;
        string name;
        Resources resources;
        uint16[16] buildingLevels;
        uint32[16] shipCounts;
        uint32[10] defenseCounts;
        BuildingConstruction buildingQueue;
        DefenseQueue defenseQueue;
        ShipQueue shipQueue;
        DefenseQueue[] defenseBacklog;
        ShipQueue[] shipBacklog;
        bool hasMoon;
        MigrationMoonState moon;
    }

    struct MigrationMoonBuildingConstruction {
        bool active;
        MoonBuilding building;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct MigrationMoonDefenseQueue {
        bool active;
        Defense defense;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct MigrationMoonState {
        uint16 fields;
        uint16 diameterKm;
        uint64 createdAt;
        uint64 jumpGateReadyAt;
        Resources resources;
        uint16[4] buildingLevels;
        uint32[16] shipCounts;
        uint32[10] defenseCounts;
        MigrationMoonBuildingConstruction buildingQueue;
        MigrationMoonDefenseQueue defenseQueue;
    }

    struct MigrationPlayerState {
        address player;
        uint256 homePlanetId;
        uint16[15] technologyLevels;
        ResearchQueue researchQueue;
        MigrationPlanetState[] planets;
    }

    event MigrationStateImported(address indexed player, uint256 homePlanetId, uint256 planetCount);

    constructor(address referralSystemAddress) VeydriftResourceReserves(address(0)) {
        _referralSystem = referralSystemAddress;
    }

    /// @notice Releases provably excess resource reserves to the configured launch treasury.
    /// @dev Called through the game facade's delegatecall. The explicit `safetyMargin` remains above
    ///      internal and locked-withdrawal liabilities. The batch reverts atomically if a resource
    ///      would become under-backed or the recipient is short-delivered.
    function releaseExcessResourceReserves(
        address treasury,
        Resources calldata amount,
        Resources calldata safetyMargin
    ) external onlyOwner {
        VeydriftReserveRelease.release(
            _resourceTokens,
            _totalInternalResources,
            _lockedWithdrawalResources,
            treasury,
            amount,
            safetyMargin
        );
    }

    function importMigratedState(address player, bytes calldata payload) external payable {
        MigrationPlayerState memory state = _validatedMigrationState(player, payload);
        _importMigratedState(player, state, false);
    }

    function importMigratedStateWithReferral(
        address player,
        bytes calldata payload,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        MigrationPlayerState memory state = _validatedMigrationState(player, payload);
        uint256 inviterReward = (startPrice * REFERRAL_INVITER_FEE_BPS) / BPS;
        IVeydriftStateMigrationReferralSystem(_referralSystem)
        .redeemReferralInvite{value: inviterReward}(
            player, commitment, v, r, s
        );
        _importMigratedState(player, state, true);
    }

    function _validatedMigrationState(address player, bytes calldata payload)
        private
        view
        returns (MigrationPlayerState memory state)
    {
        if (msg.sender != _migrationSettlement) revert Unauthorized(msg.sender);
        if (msg.value != startPrice) revert BadStartPayment();

        state = abi.decode(payload, (MigrationPlayerState));
        if (state.player != player || state.homePlanetId == 0 || state.planets.length == 0) {
            revert InvalidId();
        }
    }

    function _importMigratedState(address player, MigrationPlayerState memory state, bool referred)
        private
    {
        if (homePlanetOf[player] != 0) {
            _discardSingleStartedPlanetBeforeMigration(player);
        }

        if (referred) {
            _applyReferralStartingBonus(state);
        }

        Resources memory totalResources;
        for (uint256 i = 0; i < state.planets.length;) {
            totalResources = _add(totalResources, state.planets[i].resources);
            unchecked {
                ++i;
            }
        }
        _increaseInternalResources(totalResources);

        homePlanetOf[player] = state.homePlanetId;
        planetCountOf[player] = state.planets.length;
        _touchPlayer(player);

        for (uint8 techId = 0; techId <= MAX_TECHNOLOGY_ID;) {
            uint16 level = state.technologyLevels[techId];
            if (level != 0) {
                _technologyLevels[player][Technology(techId)] = level;
                emit ResearchCompleted(player, Technology(techId), level);
            }
            unchecked {
                ++techId;
            }
        }

        if (state.researchQueue.active) {
            researchQueues[player] = state.researchQueue;
            emit ResearchQueued(
                player,
                state.researchQueue.technology,
                state.researchQueue.targetLevel,
                state.researchQueue.readyAt,
                state.researchQueue.cost.metal,
                state.researchQueue.cost.crystal,
                state.researchQueue.cost.deuterium
            );
        }

        for (uint256 i = 0; i < state.planets.length;) {
            _importMigratedPlanet(player, state.planets[i]);
            unchecked {
                ++i;
            }
        }

        emit MigrationStateImported(player, state.homePlanetId, state.planets.length);
    }

    function _applyReferralStartingBonus(MigrationPlayerState memory state) private pure {
        for (uint256 i = 0; i < state.planets.length;) {
            if (state.planets[i].planetId == state.homePlanetId) {
                state.planets[i].resources.metal += REFERRAL_STARTING_METAL_BONUS;
                state.planets[i].resources.crystal += REFERRAL_STARTING_CRYSTAL_BONUS;
                return;
            }
            unchecked {
                ++i;
            }
        }
        revert InvalidId();
    }

    function _discardSingleStartedPlanetBeforeMigration(address player) private {
        if (planetCountOf[player] != 1 || activeFleetMissionCount[player] != 0) {
            revert AlreadyStarted();
        }
        uint256 planetId = homePlanetOf[player];
        Planet storage planetRef = _planets[planetId];
        if (planetId == 0 || planetRef.owner != player) revert AlreadyStarted();

        bytes32 key = VeydriftPlanetGeneration.coordinateKey(
            block.chainid,
            planetRef.galaxy,
            planetRef.system,
            planetRef.position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
        occupiedCoordinates[key] = false;
        _decreaseInternalResources(planetRef.resources);
        delete _planets[planetId];
        delete planetNames[planetId];
        delete buildingConstructions[planetId];
        delete defenseQueues[planetId];
        delete shipQueues[planetId];
        delete _defenseQueueBacklogs[planetId];
        delete _shipQueueBacklogs[planetId];
        for (uint8 id = 0; id <= MAX_BUILDING_ID;) {
            delete _buildingLevels[planetId][Building(id)];
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_SHIP_ID;) {
            _setPlanetShipCount(planetId, Ship(id), 0);
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_DEFENSE_ID;) {
            _setPlanetDefenseCount(planetId, Defense(id), 0);
            unchecked {
                ++id;
            }
        }
        _unregisterOwnedPlanet(player, planetId);
        homePlanetOf[player] = 0;
        planetCountOf[player] = 0;
    }

    function _importMigratedPlanet(address player, MigrationPlanetState memory planetState)
        private
    {
        uint256 planetId = planetState.planetId;
        if (planetId == 0 || _planets[planetId].owner != address(0)) revert InvalidId();
        bytes32 key = VeydriftPlanetGeneration.coordinateKey(
            block.chainid,
            planetState.galaxy,
            planetState.system,
            planetState.position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
        occupiedCoordinates[key] = true;
        if (planetId >= nextPlanetId) nextPlanetId = planetId + 1;

        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(planetState.temperature, planetState.fields);

        _planets[planetId] = Planet({
            owner: player,
            galaxy: planetState.galaxy,
            system: planetState.system,
            position: planetState.position,
            fields: planetState.fields,
            temperature: planetState.temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: planetState.lastSettledAt,
            resources: planetState.resources
        });
        _registerOwnedPlanet(player, planetId);

        emit PlanetStarted(
            player,
            planetId,
            planetState.galaxy,
            planetState.system,
            planetState.position,
            planetState.fields,
            planetState.temperature
        );
        if (homePlanetOf[player] == planetId) {
            emit FirstPlanetSettled(
                player,
                planetId,
                planetState.galaxy,
                planetState.system,
                planetState.position,
                key,
                VeydriftPlanetGeneration.planetSeed(
                    PLANET_SEED_DOMAIN,
                    block.chainid,
                    planetState.galaxy,
                    planetState.system,
                    planetState.position,
                    MAX_GALAXY,
                    MAX_SYSTEM,
                    MAX_POSITION
                )
            );
        }
        _emitPlanetSettled(planetId);

        if (bytes(planetState.name).length != 0) {
            planetNames[planetId] = planetState.name;
            emit PlanetRenamed(player, planetId, planetState.name);
        }

        for (uint8 id = 0; id <= MAX_BUILDING_ID;) {
            uint16 level = planetState.buildingLevels[id];
            if (level != 0) {
                _buildingLevels[planetId][Building(id)] = level;
                emit BuildingCompleted(planetId, Building(id), level);
            }
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_SHIP_ID;) {
            uint32 count = planetState.shipCounts[id];
            if (count != 0) _setPlanetShipCount(planetId, Ship(id), count);
            unchecked {
                ++id;
            }
        }
        for (uint8 id = 0; id <= MAX_DEFENSE_ID;) {
            uint32 count = planetState.defenseCounts[id];
            if (count != 0) _setPlanetDefenseCount(planetId, Defense(id), count);
            unchecked {
                ++id;
            }
        }

        _importMigratedQueues(planetId, planetState);
        if (planetState.hasMoon) {
            _importMigratedMoon(player, planetId, planetState.moon);
        }
    }

    function _importMigratedQueues(uint256 planetId, MigrationPlanetState memory planetState)
        private
    {
        if (planetState.buildingQueue.active) {
            buildingConstructions[planetId] = planetState.buildingQueue;
            emit BuildingStarted(
                planetId,
                planetState.buildingQueue.building,
                planetState.buildingQueue.targetLevel,
                planetState.buildingQueue.readyAt,
                planetState.buildingQueue.cost.metal,
                planetState.buildingQueue.cost.crystal,
                planetState.buildingQueue.cost.deuterium
            );
        }

        if (planetState.defenseQueue.active) {
            defenseQueues[planetId] = planetState.defenseQueue;
            _emitDefenseQueued(planetId, planetState.defenseQueue);
        }
        for (uint256 i = 0; i < planetState.defenseBacklog.length;) {
            _defenseQueueBacklogs[planetId].push(planetState.defenseBacklog[i]);
            unchecked {
                ++i;
            }
        }

        if (planetState.shipQueue.active) {
            shipQueues[planetId] = planetState.shipQueue;
            _emitShipQueued(planetId, planetState.shipQueue);
        }
        for (uint256 i = 0; i < planetState.shipBacklog.length;) {
            _shipQueueBacklogs[planetId].push(planetState.shipBacklog[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _emitDefenseQueued(uint256 planetId, DefenseQueue memory queue) private {
        emit DefenseQueued(
            planetId,
            queue.defense,
            queue.quantity,
            queue.readyAt,
            queue.cost.metal,
            queue.cost.crystal,
            queue.cost.deuterium
        );
    }

    function _emitShipQueued(uint256 planetId, ShipQueue memory queue) private {
        emit ShipQueued(
            planetId,
            queue.ship,
            queue.quantity,
            queue.readyAt,
            queue.cost.metal,
            queue.cost.crystal,
            queue.cost.deuterium
        );
    }

    function _importMigratedMoon(
        address player,
        uint256 planetId,
        MigrationMoonState memory moonState
    ) private {
        address moonSystem = _moonSystem;
        if (moonSystem == address(0)) revert MissingDependency("MOON_SYSTEM");
        IVeydriftStateMigrationMoonSystem(moonSystem)
            .importMigratedMoonState(
                planetId,
                player,
                moonState.fields,
                moonState.diameterKm,
                moonState.createdAt,
                moonState.jumpGateReadyAt,
                moonState.resources,
                moonState.buildingLevels,
                moonState.shipCounts,
                moonState.defenseCounts,
                moonState.buildingQueue,
                moonState.defenseQueue
            );
    }
}
