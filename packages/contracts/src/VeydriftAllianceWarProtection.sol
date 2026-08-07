// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice On-chain score source exposed by the Game proxy. This is the same score used by the
///         game's ordinary attack-protection logic.
interface IVeydriftWarScoreGame {
    function playerScore(address player) external view returns (uint256);
}

/// @notice Minimal read surface of the Alliance proxy needed to bind a frozen war roster to the
///         current membership epoch. The module never trusts a backend-provided roster or score.
interface IVeydriftWarAlliance {
    struct Membership {
        uint256 allianceId;
        uint8 role;
        uint64 joinedAt;
    }

    function allianceMembers(uint256 allianceId) external view returns (address[] memory);
    function allianceOf(address player) external view returns (Membership memory);
    function membershipEpoch(address player) external view returns (uint64);
}

/// @notice Dedicated storage/validation module for directional alliance-war protection.
/// @dev Kept independent from the size-constrained Alliance proxy implementation. The configured
///      Alliance proxy is its sole writer; anybody may read snapshots and exception outcomes.
contract VeydriftAllianceWarProtection {
    uint32 public constant MAX_WAR_SNAPSHOT_MEMBERS = 64;
    uint16 public constant WAR_SCORE_PROTECTION_RATIO_BPS = 15_000;
    uint16 private constant BPS = 10_000;

    struct WarSnapshot {
        uint64 snapshotId;
        uint64 declaredAt;
        uint128 declarerScore;
        uint128 declareeScore;
        uint32 declarerMemberCount;
        uint32 declareeMemberCount;
    }

    address public immutable alliance;
    IVeydriftWarScoreGame public immutable game;

    mapping(bytes32 warKey => uint64 nextSnapshotId) private _snapshotNonces;
    mapping(bytes32 warKey => WarSnapshot snapshot) private _snapshots;
    mapping(bytes32 warKey => mapping(address member => uint64 snapshotId)) private _memberIds;
    mapping(bytes32 warKey => mapping(address member => uint64 membershipEpoch)) private _memberEpochs;

    error NotAlliance(address caller);
    error WarSnapshotTooLarge(uint256 allianceId, uint256 count, uint256 maximum);
    error WarScoreTooLarge(uint256 allianceId, uint256 score);

    event WarSnapshotCaptured(
        uint256 indexed declarerAllianceId,
        uint256 indexed declareeAllianceId,
        uint64 indexed snapshotId,
        uint128 declarerScore,
        uint128 declareeScore,
        uint32 declarerMemberCount,
        uint32 declareeMemberCount
    );

    constructor(address allianceAddress, address gameAddress) {
        require(allianceAddress != address(0) && gameAddress != address(0), "ZERO_ADDRESS");
        alliance = allianceAddress;
        game = IVeydriftWarScoreGame(gameAddress);
    }

    function capture(uint256 declarerAllianceId, uint256 declareeAllianceId, uint64 declaredAt)
        external
        returns (WarSnapshot memory snapshot)
    {
        if (msg.sender != alliance) revert NotAlliance(msg.sender);

        address[] memory declarerMembers = IVeydriftWarAlliance(alliance).allianceMembers(declarerAllianceId);
        address[] memory declareeMembers = IVeydriftWarAlliance(alliance).allianceMembers(declareeAllianceId);
        if (declarerMembers.length > MAX_WAR_SNAPSHOT_MEMBERS) {
            revert WarSnapshotTooLarge(
                declarerAllianceId, declarerMembers.length, MAX_WAR_SNAPSHOT_MEMBERS
            );
        }
        if (declareeMembers.length > MAX_WAR_SNAPSHOT_MEMBERS) {
            revert WarSnapshotTooLarge(
                declareeAllianceId, declareeMembers.length, MAX_WAR_SNAPSHOT_MEMBERS
            );
        }

        bytes32 key = _warKey(declarerAllianceId, declareeAllianceId);
        uint64 snapshotId = _snapshotNonces[key] + 1;
        _snapshotNonces[key] = snapshotId;
        uint256 declarerScore = _recordMembers(key, snapshotId, declarerMembers);
        uint256 declareeScore = _recordMembers(key, snapshotId, declareeMembers);
        if (declarerScore > type(uint128).max) revert WarScoreTooLarge(declarerAllianceId, declarerScore);
        if (declareeScore > type(uint128).max) revert WarScoreTooLarge(declareeAllianceId, declareeScore);

        snapshot = WarSnapshot({
            snapshotId: snapshotId,
            declaredAt: declaredAt,
            // forge-lint: disable-next-line(unsafe-typecast) -- checked against uint128.max above.
            declarerScore: uint128(declarerScore),
            // forge-lint: disable-next-line(unsafe-typecast) -- checked against uint128.max above.
            declareeScore: uint128(declareeScore),
            declarerMemberCount: uint32(declarerMembers.length),
            declareeMemberCount: uint32(declareeMembers.length)
        });
        _snapshots[key] = snapshot;
        emit WarSnapshotCaptured(
            declarerAllianceId,
            declareeAllianceId,
            snapshotId,
            snapshot.declarerScore,
            snapshot.declareeScore,
            snapshot.declarerMemberCount,
            snapshot.declareeMemberCount
        );
    }

    function warSnapshot(uint256 allianceA, uint256 allianceB) external view returns (WarSnapshot memory) {
        return _snapshots[_warKey(allianceA, allianceB)];
    }

    function memberAtStart(uint256 allianceA, uint256 allianceB, address member)
        external
        view
        returns (bool)
    {
        bytes32 key = _warKey(allianceA, allianceB);
        WarSnapshot memory snapshot = _snapshots[key];
        return snapshot.snapshotId != 0 && _memberIds[key][member] == snapshot.snapshotId;
    }

    /// @notice Returns the directional exceptions, but only for original members that have never
    ///         left/rejoined and are still on their original side.
    function attackExceptions(
        uint256 declarerAllianceId,
        uint256 declareeAllianceId,
        address attacker,
        address defender,
        uint256 attackerAllianceId,
        uint256 defenderAllianceId
    ) external view returns (bool bashingException, bool scoreProtectionException) {
        bytes32 key = _warKey(declarerAllianceId, declareeAllianceId);
        WarSnapshot memory snapshot = _snapshots[key];
        if (snapshot.snapshotId == 0) return (false, false);
        if (
            !_isCurrentOriginalMember(key, snapshot.snapshotId, attacker, attackerAllianceId)
                || !_isCurrentOriginalMember(key, snapshot.snapshotId, defender, defenderAllianceId)
        ) return (false, false);

        bashingException = true;
        if (attackerAllianceId == declareeAllianceId && defenderAllianceId == declarerAllianceId) {
            // The declaring side never receives a score-protection exception during this war.
            return (true, true);
        }
        if (attackerAllianceId != declarerAllianceId || defenderAllianceId != declareeAllianceId) {
            return (false, false);
        }
        if (!_withinRatio(snapshot.declarerScore, snapshot.declareeScore)) return (true, false);
        return (true, _withinRatio(game.playerScore(attacker), game.playerScore(defender)));
    }

    function _recordMembers(bytes32 key, uint64 snapshotId, address[] memory members)
        private
        returns (uint256 score)
    {
        IVeydriftWarAlliance allianceSystem = IVeydriftWarAlliance(alliance);
        for (uint256 index = 0; index < members.length;) {
            address member = members[index];
            _memberIds[key][member] = snapshotId;
            _memberEpochs[key][member] = allianceSystem.membershipEpoch(member);
            score += game.playerScore(member);
            unchecked {
                ++index;
            }
        }
    }

    function _isCurrentOriginalMember(bytes32 key, uint64 snapshotId, address player, uint256 allianceId)
        private
        view
        returns (bool)
    {
        if (_memberIds[key][player] != snapshotId) return false;
        IVeydriftWarAlliance allianceSystem = IVeydriftWarAlliance(alliance);
        return allianceSystem.allianceOf(player).allianceId == allianceId
            && allianceSystem.membershipEpoch(player) == _memberEpochs[key][player];
    }

    function _withinRatio(uint256 attackerScore, uint256 defenderScore) private pure returns (bool) {
        return defenderScore != 0 && attackerScore * BPS <= defenderScore * WAR_SCORE_PROTECTION_RATIO_BPS;
    }

    function _warKey(uint256 allianceA, uint256 allianceB) private pure returns (bytes32) {
        return allianceA < allianceB
            ? keccak256(abi.encode(allianceA, allianceB))
            : keccak256(abi.encode(allianceB, allianceA));
    }
}
