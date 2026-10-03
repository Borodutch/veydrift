// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";

/// @notice External pure helper for staged combat; keeps defense repair out of module bytecode.
contract VeydriftCombatRapidfire {
    function repairedDefenseCounts(uint256 destroyedDefenses, uint256 seed)
        external
        pure
        returns (uint256)
    {
        return VeydriftCatalog.repairedDefenseCounts(destroyedDefenses, seed);
    }
}

contract VeydriftCombatModule is VeydriftResourceReserves {
    address private immutable _stagedModule;
    address private immutable _legacyModule;

    constructor(address rapidfireModule, address stagedModule, address legacyModule)
        VeydriftResourceReserves(address(0))
    {
        if (
            rapidfireModule == address(0) || stagedModule == address(0)
                || legacyModule == address(0)
        ) {
            revert UnsupportedGameplayModule();
        }
        _stagedModule = stagedModule;
        _legacyModule = legacyModule;
    }

    function resolveFleetMissionCombatRound(uint256 missionId) external returns (bool) {
        // Pre-staged battles with committed rounds must finish their historical model.
        // Newly prepared battles always enter staged v2; an existing staged battle
        // keeps its stored version (zero for v1) through every remaining round.
        address module = Store.battle(missionId).phase == 0
            && _battleResolutionProgress[missionId].rounds != 0
            ? _legacyModule
            : _stagedModule;
        (bool ok, bytes memory data) = module.delegatecall(msg.data);
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        return abi.decode(data, (bool));
    }
}
