// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftRaidStorage} from "./libraries/VeydriftRaidStorage.sol";
import {Building, Resource} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for the planet-bound Rift extraction lifecycle.
contract VeydriftRiftModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

    /// @notice Moves the alliance treasury liability onto a manager-owned planet. External
    /// withdrawal still uses the ordinary delayed, raidable Rift extraction lifecycle.
    function creditAllianceBonusToPlanet(
        uint256 planetId,
        address manager,
        Resources calldata amount
    ) external {
        if (msg.sender != _allianceSystem) revert Unauthorized(msg.sender);
        if (_planets[planetId].owner != manager) revert Unauthorized(manager);
        _planets[planetId].resources = _add(_planets[planetId].resources, amount);
        _emitPlanetSettled(planetId);
        emit AllianceBonusCreditedToPlanet(
            manager, planetId, amount.metal, amount.crystal, amount.deuterium
        );
    }

    function startRiftExtraction(uint256 planetId, Resource resource, uint128 amount) external {
        _touchPlayer(msg.sender);
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        _requireRiftUnlocked(planetId);
        if (amount == 0) revert InvalidQuantity();
        _requireReserveResource(resource);
        RiftExtraction storage extraction = riftExtractions[planetId][resource];
        if (extraction.active) revert RiftExtractionActive(planetId, resource);

        _settleActionPlanet(planetId);
        Resources memory resourceAmount = _resourceAmount(resource, amount);
        _spend(planetId, resourceAmount);
        _lockedWithdrawalResources = _add(_lockedWithdrawalResources, resourceAmount);
        _riftLockedResources[planetId] = _add(_riftLockedResources[planetId], resourceAmount);
        uint64 startedAt = _currentTimestamp();
        uint64 unlocksAt = uint64(uint256(startedAt) + RIFT_EXTRACTION_DELAY);
        riftExtractions[planetId][resource] = RiftExtraction({
            active: true, amount: amount, startedAt: startedAt, unlocksAt: unlocksAt
        });
        emit RiftExtractionStarted(msg.sender, planetId, resource, amount, startedAt, unlocksAt);
    }

    function finalizeRiftExtraction(uint256 planetId, Resource resource) external {
        _touchPlayer(msg.sender);
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        RiftExtraction memory extraction = riftExtractions[planetId][resource];
        if (!extraction.active) revert RiftExtractionInactive(planetId, resource);
        if (_currentTimestamp() < extraction.unlocksAt) {
            revert WithdrawalNotReady(extraction.unlocksAt);
        }
        delete riftExtractions[planetId][resource];
        Resources memory resourceAmount = _resourceAmount(resource, extraction.amount);
        _lockedWithdrawalResources = _subtract(_lockedWithdrawalResources, resourceAmount);
        _riftLockedResources[planetId] = _subtract(_riftLockedResources[planetId], resourceAmount);
        if (
            extraction.amount != 0
                && !_requireReserveResource(resource).transfer(msg.sender, extraction.amount)
        ) {
            revert ResourceTransferFailed(
                resource, address(_resourceTokens[resource]), extraction.amount
            );
        }
        emit RiftExtractionFinalized(msg.sender, planetId, resource, extraction.amount);
    }

    function riftLockedResources(uint256 planetId) external view returns (Resources memory) {
        return _riftLockedResources[planetId];
    }

    /// @dev A live Rift lock is 100% contestable: it bypasses score/newbie and bashing protection,
    ///      while self-attack and same-alliance protection remain non-negotiable.
    function enforceRiftAttackProtection(address attacker, uint256 planetId) external view {
        _enforceBodyAttackProtection(attacker, planetId, false);
    }

    /// @dev Moon attacks cannot inherit their parent planet's Rift exception because they cannot
    ///      loot a planet-bound Rift lock.
    function enforceBodyAttackProtection(address attacker, uint256 planetId, bool targetIsMoon)
        external
        view
    {
        _enforceBodyAttackProtection(attacker, planetId, targetIsMoon);
    }

    function _enforceBodyAttackProtection(address attacker, uint256 planetId, bool targetIsMoon)
        private
        view
    {
        if (_planets[planetId].owner == attacker) revert SelfAttack();
        (bool ok, bytes memory data) = address(this)
            .staticcall(abi.encodeWithSelector(0xdca08aaf, attacker, planetId, targetIsMoon));
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        if (data.length < 32) return;
        (AttackBlockReason reason,,) = abi.decode(data, (AttackBlockReason, uint8, uint16));
        Resources storage locked = _riftLockedResources[planetId];
        bool hasLiveRift = locked.metal != 0 || locked.crystal != 0 || locked.deuterium != 0;
        if (reason == AttackBlockReason.SameAlliance) revert SameAllianceAttack();
        if ((targetIsMoon || !hasLiveRift) && reason == AttackBlockReason.BashingLimit) {
            revert AttackBashingLimitReached();
        }
        if ((targetIsMoon || !hasLiveRift) && reason == AttackBlockReason.ScoreProtection) {
            revert AttackScoreProtection();
        }
    }

    function raidRiftExtraction(
        address attacker,
        uint256 planetId,
        uint256 capacity,
        uint16 metalBps,
        uint16 crystalBps,
        uint16 deuteriumBps
    ) external returns (Resources memory raided) {
        // This is an internal combat-settlement endpoint reached by the combat module's
        // `address(this).call(...)`. It must never be a public proxy entrypoint: otherwise a
        // caller can choose arbitrary capacity/ratios and erase another planet's live Rift lock.
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        (raided.metal, raided.crystal, raided.deuterium) = VeydriftRaidStorage.raidRift(
            _riftLockedResources[planetId], capacity, metalBps, crystalBps, deuteriumBps
        );
        if (raided.metal == 0 && raided.crystal == 0 && raided.deuterium == 0) return raided;
        _lockedWithdrawalResources = _subtract(_lockedWithdrawalResources, raided);
        _increaseInternalResources(raided);
        _riftExtractionSubtract(planetId, Resource.Metal, raided.metal);
        _riftExtractionSubtract(planetId, Resource.Crystal, raided.crystal);
        _riftExtractionSubtract(planetId, Resource.Deuterium, raided.deuterium);
        emit RiftExtractionLooted(
            attacker, planetId, raided.metal, raided.crystal, raided.deuterium
        );
    }

    function _riftExtractionSubtract(uint256 planetId, Resource resource, uint128 amount) private {
        if (amount != 0) riftExtractions[planetId][resource].amount -= amount;
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

    function _spend(uint256 planetId, Resources memory cost) private {
        _settleActionPlanet(planetId);
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

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _subtract(Resources memory left, Resources memory right)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: left.metal - right.metal,
            crystal: left.crystal - right.crystal,
            deuterium: left.deuterium - right.deuterium
        });
    }
}
