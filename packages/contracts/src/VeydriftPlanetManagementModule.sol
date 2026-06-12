// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @dev Self-call surface used by the combat lazy reconcile to drive the existing (permissionless)
///      `resolveFleetMission` dispatch for a single due Attack/Harvest mission, wrapped in try/catch
///      so an arrival whose randomness is not yet committed cannot brick the caller's action.
interface IVeydriftCombatMissionResolver {
    function resolveFleetMission(uint256 missionId) external;
}

/// @dev Self-call surface routing the deferred return-completion untrack to the gameplay module,
///      which already carries the untrack machinery — keeping it out of this bytecode-tight module.
interface IVeydriftResolvedMissionUntracker {
    function untrackResolvedFleetMission(uint256 missionId) external;
}

/// @notice Delegatecall target for colony and planet metadata/destruction paths.
contract VeydriftPlanetManagementModule is VeydriftResourceReserves {
    bytes4 private constant ATTACK_PROTECTION_STATUS_SELECTOR = 0x8a6b2246;

    constructor() VeydriftResourceReserves(address(0)) {}

    /// @notice Lazy fleet reconcile, combat leg (VEY-KANEO-468 Phase 2b). Self-only via the facade
    ///         gate. Resolves every due Attack/Harvest mission `player` owns (attacker or targeted
    ///         defender) whose battle randomness is committed, so combat lands on the player's next
    ///         mutating call — no keeper/resolve tx.
    /// @dev Iterates a memory snapshot of the player's tracked mission ids, so the swap-and-pop
    ///      untrack inside `resolveFleetMission` cannot disturb iteration. Each resolve is wrapped in
    ///      try/catch: a `PendingRandomness` revert (seed not yet committed) is swallowed, leaving the
    ///      mission Outbound/tracked for a later call. `resolveFleetMission` is idempotent once
    ///      status != Outbound and the combat module's internal settles never re-enter a fleet
    ///      reconcile, so this is bounded and recursion-free.
    function settleDuePlayerCombatArrivals(address player) external {
        uint256[] memory missionIds = _resolutionMissionIdsByPlayer[player];
        uint64 nowTimestamp = uint64(block.timestamp);
        for (uint256 index = 0; index < missionIds.length;) {
            FleetMission storage mission = _fleetMissions[missionIds[index]];
            if (
                mission.status == FleetMissionStatus.Outbound
                    && (mission.missionType == FleetMissionType.Attack
                        || mission.missionType == FleetMissionType.Harvest)
                    && nowTimestamp >= mission.arrivalAt
            ) {
                try IVeydriftCombatMissionResolver(address(this))
                    .resolveFleetMission(missionIds[index]) {}
                    catch {}
            } else if (
                (mission.status == FleetMissionStatus.Returning
                        || mission.status == FleetMissionStatus.Recalled)
                    && nowTimestamp >= mission.returnAt
                    && _earliestPendingMissionArrivalForPlanet(mission.originPlanetId)
                        == type(uint64).max
            ) {
                // Lazy reconcile (VEY-KANEO-468 Phase 2c): land every matured return leg the player
                // owns the moment any action touches them — no `completeFleetMissionReturn` tx. The
                // pending-resolution guard preserves combat-snapshot integrity (a return never lands
                // across an unresolved Attack/Harvest arrival on the origin planet).
                _landFleetReturn(missionIds[index], mission);
            }
            unchecked {
                ++index;
            }
        }
    }

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
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        // Lazy on-chain reconciliation (VEY-KANEO-477): complete both planets' ready DEFENSE production
        // queues BEFORE reading `_defenseCounts` below, so the missile/intercept math runs against
        // current counts (an origin missile batch or a target ABM/defense that just finished is
        // included). `_settleDuePlanet` settles ship/defense/research queues only — it does NOT advance
        // resource production, so missiling a target never moves the victim's resource clock, and
        // defenses do not affect production rate, so no settled window is rescaled.
        _settleDuePlanet(originPlanetId);
        _settleDuePlanet(targetPlanetId);
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
        _debitPlanetDefenses(originPlanetId, Defense.InterplanetaryMissile, quantity);

        uint32 antiBallistic = _defenseCounts[targetPlanetId][Defense.AntiBallisticMissile];
        uint32 intercepted = antiBallistic < quantity ? antiBallistic : quantity;
        _debitPlanetDefenses(targetPlanetId, Defense.AntiBallisticMissile, intercepted);

        uint32 hits = quantity - intercepted;
        uint32 targetDefense = _defenseCounts[targetPlanetId][primaryTarget];
        uint32 destroyedPrimary = targetDefense < hits ? targetDefense : hits;
        _debitPlanetDefenses(targetPlanetId, primaryTarget, destroyedPrimary);

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

    function renamePlanet(uint256 planetId, string calldata name) external {
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        uint256 length = bytes(name).length;
        if (length == 0 || length > 32) revert InvalidPlanetName();

        planetNames[planetId] = name;
        emit PlanetRenamed(msg.sender, planetId, name);
    }

    function abandonPlanet(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        if (homePlanetOf[msg.sender] == planetId) revert CannotAbandonHomePlanet();
        // Lazy on-chain reconciliation (VEY-KANEO-477): settle BEFORE the active-queue check so ready
        // ship/defense production queues complete (via `_settleDuePlanet`) and stop reading as active —
        // a planet whose construction already finished must not be falsely blocked from abandon.
        _settleResources(planetId);
        // A ready-but-unsettled BUILDING construction is not completed by the module settle (two-window
        // building completion lives only in the main facade's `_settleResourcesUpTo`). It must not block
        // abandon either: the planet is being destroyed, so discard the due construction. `planetId` is
        // monotonic (`nextPlanetId++`) and never reused, so the cleared slot is unreachable afterwards.
        if (
            buildingConstructions[planetId].active
                && buildingConstructions[planetId].readyAt <= _currentTimestamp()
        ) {
            delete buildingConstructions[planetId];
        }
        if (
            buildingConstructions[planetId].active || defenseQueues[planetId].active
                || shipQueues[planetId].active
        ) {
            revert PlanetHasActiveQueues();
        }
        if (activeFleetMissionCount[msg.sender] != 0) revert PlanetHasActiveFleetMissions();

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
        _unregisterOwnedPlanet(msg.sender, planetId);
    }

    function depositMarketResource(uint256 planetId, Resource resource, uint128 amount) external {
        _requirePlanetOwner(planetId);
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        _requireRiftUnlocked(planetId);
        if (amount == 0) revert InvalidQuantity();

        _transferReserveIn(resource, amount);
        Resources memory resourceAmount = _resourceAmount(resource, amount);
        _increaseInternalResources(resourceAmount);
        emit MarketResourceDeposited(msg.sender, planetId, resource, amount);
        _creditResources(planetId, resourceAmount);
    }

    function requestMarketResourceWithdrawal(uint256 planetId, Resource resource, uint128 amount)
        external
    {
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
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
        _settleDueCombatArrivals(msg.sender);
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
        _settleDueCombatArrivals(msg.sender);
        // The prologue settle runs the lazy return settler, which may already have landed this very
        // mission (VEY-KANEO-468 Phase 2c). If so the leg is Returned — the credit happened this tx,
        // so report success rather than double-crediting (which would underflow activeFleetMissionCount).
        if (mission.status == FleetMissionStatus.Returned) return;
        _requireNoPendingMissionResolutionForPlanet(mission.originPlanetId);
        if (_currentTimestamp() < mission.returnAt) revert FleetNotArrived(mission.returnAt);

        _landFleetReturn(missionId, mission);
    }

    /// @dev Credits a matured return leg's cargo + ships back to its origin planet and untracks the
    ///      mission (VEY-KANEO-468 Phase 2c: deferred from arrival to return-completion so the leg
    ///      stays enumerable for the lazy return settler). Caller must have already confirmed the
    ///      mission is Returning/Recalled, its `returnAt` has elapsed, and no unresolved combat
    ///      arrival is pending on the origin planet (the combat-snapshot integrity gate).
    function _landFleetReturn(uint256 missionId, FleetMission storage mission) private {
        _creditResources(mission.originPlanetId, mission.cargo);
        _creditMissionShips(mission.originPlanetId, mission.ships);
        mission.status = FleetMissionStatus.Returned;
        activeFleetMissionCount[mission.owner] -= 1;
        IVeydriftResolvedMissionUntracker(address(this)).untrackResolvedFleetMission(missionId);
        emit FleetMissionReturned(missionId, mission.owner, mission.originPlanetId);
    }

    function startResearch(uint256 planetId, Technology technology) external {
        _requirePlanetOwner(planetId);
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlayer(msg.sender);
        if (researchQueues[msg.sender].active) revert QueueActive();

        uint16 currentLevel = _technologyLevels[msg.sender][technology];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();

        _settleResources(planetId);
        _requireResearchDependencies(planetId, msg.sender, technology, currentLevel);

        Resources memory cost = _researchCost(msg.sender, technology);
        _spend(planetId, cost);

        uint64 readyAt =
            uint64(uint256(_currentTimestamp()) + _researchDuration(planetId, technology, cost));
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
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlayer(msg.sender);
        ResearchQueue memory queue = researchQueues[msg.sender];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete researchQueues[msg.sender];
        _technologyLevels[msg.sender][queue.technology] = queue.targetLevel;
        emit ResearchCompleted(msg.sender, queue.technology, queue.targetLevel);
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
        if (currentTime > planetRef.lastSettledAt) {
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
        _settleDuePlanet(planetId);
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

    /// @dev Credit `amount` to `planetId`'s balance and emit the authoritative post-credit
    ///      `PlanetSettled` (VEY-KANEO-475). Shared by the market-deposit and fleet-return credit
    ///      paths so the `_add` + emit bytecode is compiled once in this EIP-170-bound module.
    function _creditResources(uint256 planetId, Resources memory amount) private {
        _planets[planetId].resources = _add(_planets[planetId].resources, amount);
        _emitPlanetSettled(planetId);
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
            _shipCounts[planetId][Ship.SolarSatellite],
            _shipCounts[planetId][Ship.Crawler],
            planetRef.temperature,
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
    }

    function _researchDuration(uint256 planetId, Technology technology, Resources memory cost)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.researchDuration(
            _effectiveResearchLabLevel(planetId, _planets[planetId].owner, technology),
            cost.metal,
            cost.crystal,
            cost.deuterium,
            QUEUE_UNIVERSE_SPEED,
            MIN_QUEUE_SECONDS
        );
    }

    function _effectiveResearchLabLevel(uint256 planetId, address player, Technology technology)
        private
        view
        returns (uint256)
    {
        uint16 localLabLevel = _buildingLevels[planetId][Building.ResearchLab];
        uint16 requiredLabLevel = VeydriftCatalog.researchLabRequirement(technology);
        if (localLabLevel < requiredLabLevel) return localLabLevel;

        uint16 networkLevel = _technologyLevels[player][Technology.IntergalacticResearchNetwork];
        if (networkLevel == 0) return localLabLevel;

        uint16 maxLinkedLabs = networkLevel > MAX_LEVEL ? MAX_LEVEL : networkLevel;
        uint16[50] memory linkedLabLevels;
        uint16 linkedCount = 0;

        uint256[] storage planetIds = _ownedPlanetIds[player];
        for (uint256 planetIndex = 0; planetIndex < planetIds.length;) {
            uint256 candidatePlanetId = planetIds[planetIndex];
            if (candidatePlanetId != planetId && _planets[candidatePlanetId].owner == player) {
                uint16 labLevel = _buildingLevels[candidatePlanetId][Building.ResearchLab];
                if (labLevel >= requiredLabLevel) {
                    linkedCount = _insertLinkedResearchLab(
                        linkedLabLevels, linkedCount, maxLinkedLabs, labLevel
                    );
                }
            }

            unchecked {
                ++planetIndex;
            }
        }

        uint256 effectiveLabLevel = localLabLevel;
        for (uint16 index = 0; index < linkedCount;) {
            effectiveLabLevel += linkedLabLevels[index];
            unchecked {
                ++index;
            }
        }
        return effectiveLabLevel;
    }

    function _insertLinkedResearchLab(
        uint16[50] memory linkedLabLevels,
        uint16 linkedCount,
        uint16 maxLinkedLabs,
        uint16 labLevel
    ) private pure returns (uint16) {
        if (maxLinkedLabs == 0) return linkedCount;
        if (linkedCount == maxLinkedLabs && labLevel <= linkedLabLevels[maxLinkedLabs - 1]) {
            return linkedCount;
        }

        uint16 insertionIndex = linkedCount < maxLinkedLabs ? linkedCount : maxLinkedLabs - 1;
        if (linkedCount < maxLinkedLabs) linkedCount += 1;

        while (insertionIndex > 0 && linkedLabLevels[insertionIndex - 1] < labLevel) {
            linkedLabLevels[insertionIndex] = linkedLabLevels[insertionIndex - 1];
            unchecked {
                --insertionIndex;
            }
        }
        linkedLabLevels[insertionIndex] = labLevel;
        return linkedCount;
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
            _shipCounts[planetId][Ship.SolarSatellite],
            planetRef.temperature,
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
        _creditPlanetShips(planetId, Ship.SmallCargo, ships.smallCargo);
        _creditPlanetShips(planetId, Ship.LightFighter, ships.lightFighter);
        _creditPlanetShips(planetId, Ship.Recycler, ships.recycler);
        _creditPlanetShips(planetId, Ship.ColonyShip, ships.colonyShip);
        _creditPlanetShips(planetId, Ship.LargeCargo, ships.largeCargo);
        _creditPlanetShips(planetId, Ship.HeavyFighter, ships.heavyFighter);
        _creditPlanetShips(planetId, Ship.Cruiser, ships.cruiser);
        _creditPlanetShips(planetId, Ship.Battleship, ships.battleship);
        _creditPlanetShips(planetId, Ship.Bomber, ships.bomber);
        _creditPlanetShips(planetId, Ship.Destroyer, ships.destroyer);
        _creditPlanetShips(planetId, Ship.Deathstar, ships.deathstar);
        _creditPlanetShips(planetId, Ship.Battlecruiser, ships.battlecruiser);
        _creditPlanetShips(planetId, Ship.Reaper, ships.reaper);
        _creditPlanetShips(planetId, Ship.Pathfinder, ships.pathfinder);
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
