// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Deployed moon-incarnation bookkeeping and validation for size-constrained game modules.
/// @dev Public library calls execute by delegatecall. The generation mappings therefore remain in
///      the Game proxy while the wide MoonSystem tuple decoding is kept out of each module's
///      EIP-170-limited runtime.
library VeydriftMoonIncarnation {
    function existsForOwner(address moonSystem, uint256 planetId, address owner_)
        public
        view
        returns (bool)
    {
        if (moonSystem == address(0)) return false;
        (bool ok, bytes memory data) =
            moonSystem.staticcall(abi.encodeWithSignature("moon(uint256)", planetId));
        if (!ok || data.length < 96) return false;
        (bool exists,, address moonOwner,,,,) =
            abi.decode(data, (bool, uint256, address, uint16, uint16, uint64, uint64));
        return exists && moonOwner == owner_;
    }

    function recordMission(
        mapping(uint256 missionId => uint64 generation) storage originGeneration,
        mapping(
            uint256 missionId => uint64 generation
        ) storage targetGeneration,
        mapping(uint256 missionId => bool recorded) storage originRecorded,
        mapping(uint256 missionId => bool recorded) storage targetRecorded,
        address moonSystem,
        uint256 missionId,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        bool originIsMoon,
        bool targetIsMoon
    ) public {
        if (originIsMoon) {
            originGeneration[missionId] = _moonGeneration(moonSystem, originPlanetId);
            originRecorded[missionId] = true;
        }
        if (targetIsMoon) {
            targetGeneration[missionId] = _moonGeneration(moonSystem, targetPlanetId);
            targetRecorded[missionId] = true;
        }
    }

    function existsForMissionOwner(
        address moonSystem,
        uint256 planetId,
        address owner_,
        uint64 departedAt,
        uint64 expectedGeneration,
        bool generationRecorded
    ) public view returns (bool) {
        if (moonSystem == address(0)) return false;
        (bool ok, bytes memory data) =
            moonSystem.staticcall(abi.encodeWithSignature("moon(uint256)", planetId));
        if (!ok || data.length < 96) return false;
        (bool exists,, address moonOwner,,, uint64 createdAt,) =
            abi.decode(data, (bool, uint256, address, uint16, uint16, uint64, uint64));
        if (!exists || moonOwner != owner_ || createdAt > departedAt) return false;
        if (!generationRecorded) return true;
        return _moonGeneration(moonSystem, planetId) == expectedGeneration;
    }

    function _moonGeneration(address moonSystem, uint256 planetId)
        private
        view
        returns (uint64 generation)
    {
        if (moonSystem == address(0)) return 0;
        (bool ok, bytes memory data) =
            moonSystem.staticcall(abi.encodeWithSignature("moonGeneration(uint256)", planetId));
        if (ok && data.length >= 32) generation = abi.decode(data, (uint64));
    }
}
