// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage, IERC20ReserveToken} from "./VeydriftGameStorage.sol";
import {Resource} from "./libraries/VeydriftTypes.sol";

/// @notice ERC-20 reserve backing and internal resource accounting shared by gameplay modules.
abstract contract VeydriftResourceReserves is VeydriftGameStorage {
    using SafeCast for uint256;

    constructor(address admin) VeydriftGameStorage(admin) {}

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

    function _transferReserveIn(Resource resource, uint128 amount) internal {
        if (amount == 0) return;
        IERC20ReserveToken token = _requireReserveResource(resource);
        uint256 beforeBalance = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert ResourceTransferFailed(resource, address(token), amount);
        }
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance < amount) {
            revert ResourceTransferFailed(resource, address(token), amount);
        }
    }

    function _increaseInternalResources(Resources memory amount) internal {
        _requireReserveCapacity(amount);
        _totalInternalResources = _add(_totalInternalResources, amount);
    }

    function _decreaseInternalResources(Resources memory amount) internal {
        _totalInternalResources = Resources({
            metal: _totalInternalResources.metal - amount.metal,
            crystal: _totalInternalResources.crystal - amount.crystal,
            deuterium: _totalInternalResources.deuterium - amount.deuterium
        });
    }

    function _add(Resources memory a, Resources memory b) internal pure returns (Resources memory) {
        return Resources({
            metal: a.metal + b.metal,
            crystal: a.crystal + b.crystal,
            deuterium: a.deuterium + b.deuterium
        });
    }

    function _reserveLimitedIncrease(Resources memory amount)
        internal
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

    function _requireReserveCapacity(Resources memory increase) internal view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserve(Resource.Metal, required.metal, increase.metal);
        _requireResourceReserve(Resource.Crystal, required.crystal, increase.crystal);
        _requireResourceReserve(Resource.Deuterium, required.deuterium, increase.deuterium);
    }

    function _requireNoPendingMissionResolutionForPlanet(uint256 planetId) internal view {
        uint256 missionId = _pendingMissionResolutionForPlanet(planetId);
        if (missionId != 0) revert FleetMissionNotResolved(_fleetMissions[missionId].arrivalAt);
    }

    function _requireNoPendingMissionResolutionForPlayer(address player) internal view {
        uint256 missionId = _pendingMissionResolutionForPlayer(player);
        if (missionId != 0) revert FleetMissionNotResolved(_fleetMissions[missionId].arrivalAt);
    }

    function _requireResourceReserve(Resource resource, uint128 currentRequired, uint128 increase)
        internal
        view
    {
        if (increase == 0) return;
        _requireResourceReserveBalance(resource, uint256(currentRequired) + uint256(increase));
    }

    function _availableReserve(Resource resource, uint128 currentRequired)
        internal
        view
        returns (uint256)
    {
        if (!_isReserveTokenConfigured(resource)) return 0;
        uint256 available = resourceReserveBalance(resource);
        return available <= currentRequired ? 0 : available - currentRequired;
    }

    function _requireCurrentReserveBacking() internal view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserveBalance(Resource.Metal, required.metal);
        _requireResourceReserveBalance(Resource.Crystal, required.crystal);
        _requireResourceReserveBalance(Resource.Deuterium, required.deuterium);
    }

    function _requireResourceReserveBalance(Resource resource, uint256 required) internal view {
        uint256 available = resourceReserveBalance(resource);
        if (available < required) {
            revert InsufficientResourceReserve(resource, required, available);
        }
    }

    function _isReserveTokenConfigured(Resource resource) internal view returns (bool) {
        _requireReserveResourceId(resource);
        return address(_resourceTokens[resource]) != address(0);
    }

    function _requireReserveResource(Resource resource) internal view returns (IERC20ReserveToken) {
        _requireReserveResourceId(resource);
        IERC20ReserveToken token = _resourceTokens[resource];
        if (address(token) == address(0)) revert ResourceTokenUnset(resource);
        return token;
    }

    function _requireReserveResourceId(Resource resource) internal pure {
        if (
            resource != Resource.Metal && resource != Resource.Crystal
                && resource != Resource.Deuterium
        ) {
            revert InvalidResource(resource);
        }
    }

    function _toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert LevelTooHigh();
        return value.toUint128();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _pendingMissionResolutionForPlanet(uint256 planetId) private view returns (uint256) {
        for (uint256 missionId = 1; missionId < nextFleetId; missionId++) {
            FleetMission storage mission = _fleetMissions[missionId];
            if (!_isPendingResolutionMission(mission)) continue;
            if (mission.originPlanetId == planetId || mission.targetPlanetId == planetId) {
                return missionId;
            }
            if (_pendingMissionResolutionTouchesCounterplayPlanet(missionId, planetId)) {
                return missionId;
            }
        }
        return 0;
    }

    function _pendingMissionResolutionForPlayer(address player) private view returns (uint256) {
        for (uint256 missionId = 1; missionId < nextFleetId; missionId++) {
            FleetMission storage mission = _fleetMissions[missionId];
            if (!_isPendingResolutionMission(mission)) continue;
            if (mission.owner == player || _planets[mission.targetPlanetId].owner == player) {
                return missionId;
            }
            if (_pendingMissionResolutionTouchesCounterplayPlayer(missionId, player)) {
                return missionId;
            }
        }
        return 0;
    }

    function _pendingMissionResolutionTouchesCounterplayPlanet(uint256 missionId, uint256 planetId)
        private
        view
        returns (bool)
    {
        uint256[] storage counterplayMissions = _fleetCounterplayMissions[missionId];
        for (uint256 index = 0; index < counterplayMissions.length; index++) {
            FleetMission storage counterplay = _fleetMissions[counterplayMissions[index]];
            if (counterplay.originPlanetId == planetId || counterplay.targetPlanetId == planetId) {
                return true;
            }
        }
        return false;
    }

    function _pendingMissionResolutionTouchesCounterplayPlayer(uint256 missionId, address player)
        private
        view
        returns (bool)
    {
        uint256[] storage counterplayMissions = _fleetCounterplayMissions[missionId];
        for (uint256 index = 0; index < counterplayMissions.length; index++) {
            FleetMission storage counterplay = _fleetMissions[counterplayMissions[index]];
            if (counterplay.owner == player || _planets[counterplay.targetPlanetId].owner == player)
            {
                return true;
            }
        }
        return false;
    }

    function _isPendingResolutionMission(FleetMission storage mission)
        internal
        view
        returns (bool)
    {
        return mission.status == FleetMissionStatus.Outbound
            && (mission.missionType == FleetMissionType.Attack
                || mission.missionType == FleetMissionType.Harvest)
            && block.timestamp >= mission.arrivalAt;
    }
}
