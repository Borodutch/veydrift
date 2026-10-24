// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftRefereeBattle as P} from "../../src/libraries/VeydriftRefereeBattle.sol";
import {VeydriftRefereeSettlement as S} from "../../src/libraries/VeydriftRefereeSettlement.sol";
import {
    VeydriftRefereeSettlementModule as RefereeSettlementModule
} from "../../src/VeydriftRefereeSettlementModule.sol";

/// Referee selectors reached through Game -> StateMigration -> CombatRaid fallbacks.
interface IRefereeGame {
    function refereeBattleRecord(uint256 id, uint8 kind, uint256 index)
        external
        view
        returns (bytes memory);
    function battleResultBinding(uint256 id) external view returns (bytes32);
    function configureBattleReferee(P.Version calldata version, address resolver) external;
    function submitBattleResult(
        uint256 id,
        bytes32 root,
        uint256[2] calldata totals,
        bytes32 reportHash,
        RefereeSettlementModule.RoundSummary[] calldata summary
    ) external;
    function battleResultSummary(uint256 id)
        external
        view
        returns (bytes32, bytes32, bytes32, uint256, uint8, uint256[2] memory, uint8, uint32);
    function battleResultProgress(uint256 id)
        external
        view
        returns (S.Phase, uint256, uint256, bytes32);
    function applyBattleResultLeaves(uint256 id, S.Leaf[] calldata leaves) external;
    function resetBattleResult(uint256 id) external;
    function voidRefereeBattle(uint256 id) external;
}

/// `count` summaries whose final entry carries the declared survivor totals.
function refereeRounds(uint256 count, uint256[2] memory totals)
    pure
    returns (RefereeSettlementModule.RoundSummary[] memory summary)
{
    summary = new RefereeSettlementModule.RoundSummary[](count);
    if (count != 0) {
        summary[count - 1].attackerUnits = totals[0];
        summary[count - 1].defenderUnits = totals[1];
    }
}
