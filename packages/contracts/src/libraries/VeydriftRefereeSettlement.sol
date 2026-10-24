// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftRefereeBattle as Referee} from "./VeydriftRefereeBattle.sol";

/// @dev Application state is separate from both frozen raw input and legacy staged storage.
library VeydriftRefereeSettlement {
    bytes32 private constant SLOT = keccak256("veydrift.storage.referee-settlement.v1");
    bytes32 internal constant RECORD_DOMAIN = keccak256("veydrift.referee-battle.record.v1");
    bytes32 internal constant LEAF_DOMAIN = keccak256("veydrift.referee-battle.result-leaf.v1");
    bytes32 internal constant TAIL_DOMAIN = keccak256("veydrift.referee-battle.result-tail.v1");
    enum Phase {
        Unaccepted,
        Applying,
        Economics
    }

    /// @dev Leaf i must describe journaled roster row i exactly; only `lost` is referee-chosen.
    /// Sequential row matching makes every enrolled row applied exactly once.
    struct Leaf {
        address owner;
        uint256 source;
        uint8 side;
        uint8 unit;
        uint32 enrolledCount;
        uint32 lost;
        uint32 survivors;
        bytes32 next;
    }

    struct Application {
        Phase phase;
        bytes32 binding;
        bytes32 root;
        bytes32 expectedDigest;
        uint256 memberCount;
        uint256 nextIndex;
        uint256[2] finalTotals;
        uint256[2] appliedTotals;
        uint8 rounds;
        bytes32 reportHash;
    }

    struct Layout {
        mapping(uint256 => Application) jobs;
    }
    error InvalidOutput();

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { l.slot := slot }
    }

    /// @notice Commitment to everything the referee consumed: chain/game/battle identity, frozen
    /// rules, randomness binding, sealed roster snapshot and seed.
    function chainRecord(uint256 id) internal view returns (bytes32) {
        Referee.Job storage j = Referee.layout().jobs[id];
        return keccak256(
            abi.encode(
                RECORD_DOMAIN,
                block.chainid,
                address(this),
                id,
                j.frozen,
                j.engine,
                j.requestId,
                j.purpose,
                j.snapshot,
                j.randomnessContext,
                j.seed,
                j.rows.length
            )
        );
    }

    function outcome(uint256[2] memory totals) internal pure returns (uint8) {
        if (totals[0] != 0 && totals[1] == 0) return 1;
        if (totals[0] == 0 && totals[1] != 0) return 2;
        return 0;
    }

    function accept(
        uint256 id,
        bytes32 root,
        uint8 rounds,
        uint256[2] memory totals,
        bytes32 reportHash
    ) internal {
        Application storage a = layout().jobs[id];
        Referee.Job storage j = Referee.layout().jobs[id];
        if (
            a.phase != Phase.Unaccepted || j.phase != Referee.Phase.AwaitingResult || rounds > 6
                || root == 0 || reportHash == 0
        ) revert InvalidOutput();
        a.phase = Phase.Applying;
        a.binding = chainRecord(id);
        a.root = root;
        a.expectedDigest = root;
        a.memberCount = j.rows.length;
        a.finalTotals = totals;
        a.rounds = rounds;
        a.reportHash = reportHash;
    }

    function leafHash(bytes32 binding, uint256 index, Leaf calldata leaf)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LEAF_DOMAIN,
                binding,
                index,
                leaf.owner,
                leaf.source,
                leaf.side,
                leaf.unit,
                leaf.enrolledCount,
                leaf.lost,
                leaf.survivors,
                leaf.next
            )
        );
    }

    function tail(Application storage a) internal view returns (bytes32) {
        return keccak256(abi.encode(TAIL_DOMAIN, a.binding, a.memberCount));
    }

    function consume(uint256 id, Application storage a, Leaf calldata leaf) internal {
        if (a.phase != Phase.Applying || a.nextIndex >= a.memberCount) revert InvalidOutput();
        Referee.Row storage row = Referee.layout().jobs[id].rows[a.nextIndex];
        if (
            row.source != leaf.source || row.owner != leaf.owner || row.side != leaf.side
                || row.unit != leaf.unit || row.count != leaf.enrolledCount
                || uint256(leaf.lost) + leaf.survivors != leaf.enrolledCount
                || leafHash(a.binding, a.nextIndex, leaf) != a.expectedDigest
        ) revert InvalidOutput();
        a.expectedDigest = leaf.next;
        ++a.nextIndex;
        a.appliedTotals[leaf.side] += leaf.survivors;
    }
}
