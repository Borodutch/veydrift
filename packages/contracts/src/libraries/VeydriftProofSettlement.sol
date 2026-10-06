// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftProofBattle as Proof} from "./VeydriftProofBattle.sol";

/// @dev Application state is separate from both frozen raw input and legacy staged storage.
library VeydriftProofSettlement {
    bytes32 private constant SLOT = keccak256("veydrift.storage.proof-settlement.v1");
    bytes32 internal constant LEAF_DOMAIN = keccak256("veydrift.proof-battle.output-leaf.v1");
    bytes32 internal constant TAIL_DOMAIN = keccak256("veydrift.proof-battle.output-tail.v1");
    enum Phase {
        Unaccepted,
        Applying,
        Economics
    }

    struct Leaf {
        uint256 cohortId;
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
        mapping(uint256 => uint256) appliedUnits;
    }

    struct Layout {
        mapping(uint256 => Application) jobs;
    }
    error InvalidOutput();
    error InsufficientLiveInventory();

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { l.slot := slot }
    }

    function chainRecord(uint256 id) internal view returns (bytes32) {
        Proof.Job storage j = Proof.layout().jobs[id];
        uint256[17] memory words;
        words[0] = uint256(keccak256("veydrift.proof-battle.public-record.v1"));
        words[1] = block.chainid;
        words[2] = uint160(address(this));
        words[3] = id;
        words[4] = j.frozen.version;
        words[5] = uint256(j.frozen.rules);
        words[6] = uint256(j.frozen.catalog);
        words[7] = uint160(j.frozen.verifier);
        words[8] = uint256(j.frozen.verifierCodehash);
        words[9] = uint160(j.engine);
        words[10] = j.requestId;
        words[11] = uint256(j.purpose);
        words[12] = uint256(j.snapshot);
        words[13] = uint256(j.randomnessContext);
        words[14] = j.seed;
        words[15] = j.rows.length;
        words[16] = uint256(j.phase);
        return keccak256(abi.encode(words));
    }

    /// @dev NO production caller. Only a future authenticated final verifier may call this.
    /// Tests use an explicitly trusted harness, never a mock-verifier acceptance route.
    function accept(
        uint256 id,
        bytes32 root,
        uint256 members,
        uint8 rounds,
        uint256[2] memory totals
    ) internal {
        Application storage a = layout().jobs[id];
        Proof.Job storage j = Proof.layout().jobs[id];
        if (
            a.phase != Phase.Unaccepted || j.phase != Proof.Phase.AwaitingProof
                || members != j.rows.length || rounds > 6
        ) revert InvalidOutput();
        a.phase = Phase.Applying;
        a.binding = chainRecord(id);
        a.root = root;
        a.expectedDigest = root;
        a.memberCount = members;
        a.finalTotals = totals;
        a.rounds = rounds;
    }

    function tail(Application storage a) internal view returns (bytes32) {
        return keccak256(abi.encode(TAIL_DOMAIN, a.binding, a.memberCount));
    }

    function consume(Application storage a, Leaf calldata leaf) internal {
        if (
            a.phase != Phase.Applying || a.nextIndex >= a.memberCount || leaf.side > 1
                || leaf.unit >= 24 || leaf.enrolledCount == 0
                || uint256(leaf.lost) + leaf.survivors != leaf.enrolledCount
                || (a.appliedUnits[leaf.source] & (uint256(1) << leaf.unit)) != 0
                || keccak256(
                        abi.encode(
                            LEAF_DOMAIN,
                            a.binding,
                            a.nextIndex,
                            leaf.cohortId,
                            leaf.owner,
                            leaf.source,
                            leaf.side,
                            leaf.unit,
                            leaf.enrolledCount,
                            leaf.lost,
                            leaf.survivors,
                            leaf.next
                        )
                    ) != a.expectedDigest
        ) revert InvalidOutput();
        a.appliedUnits[leaf.source] |= uint256(1) << leaf.unit;
        a.expectedDigest = leaf.next;
        ++a.nextIndex;
        a.appliedTotals[leaf.side] += leaf.survivors;
    }
}
