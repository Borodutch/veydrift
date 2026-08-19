// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice On-chain score source exposed by the Game proxy. This is the same score used by the
///         game's ordinary attack-protection logic.
interface IVeydriftWarScoreGame {
    function playerScore(address player) external view returns (uint256);
}

/// @notice Minimal read surface of the Alliance proxy needed to bind a frozen war roster to the
///         current alliance side. The module never trusts a backend-provided roster or score.
interface IVeydriftWarAlliance {
    struct Membership {
        uint256 allianceId;
        uint8 role;
        uint64 joinedAt;
    }

    function allianceMembers(uint256 allianceId) external view returns (address[] memory);
    function allianceOf(address player) external view returns (Membership memory);
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
    address public immutable migrationAuthority;
    /// @notice Previous module used only to preserve snapshots for wars that were active while a
    ///         protection-policy replacement was deployed. New captures always take precedence.
    VeydriftAllianceWarProtection public immutable legacyProtection;

    mapping(bytes32 warKey => uint64 nextSnapshotId) private _snapshotNonces;
    mapping(bytes32 warKey => WarSnapshot snapshot) private _snapshots;
    mapping(bytes32 warKey => mapping(address member => uint64 snapshotId)) private _memberIds;
    mapping(bytes32 warKey => mapping(address member => uint8 side)) private _memberSides;
    mapping(bytes32 warKey => bool seeded) private _legacyRostersSeeded;
    mapping(bytes32 warKey => mapping(address member => uint8 side)) private _legacyMemberSides;

    error NotAlliance(address caller);
    error NotMigrationAuthority(address caller);
    error InvalidLegacyProtection(address candidate);
    error LegacyWarRosterAlreadySeeded(uint256 declarerAllianceId, uint256 declareeAllianceId);
    error LegacyWarSnapshotMissing(uint256 declarerAllianceId, uint256 declareeAllianceId);
    error LegacyWarRosterCountMismatch(
        uint256 declarerAllianceId,
        uint256 declareeAllianceId,
        uint256 suppliedDeclarerMembers,
        uint256 expectedDeclarerMembers,
        uint256 suppliedDeclareeMembers,
        uint256 expectedDeclareeMembers
    );
    error LegacyMemberMissing(
        uint256 declarerAllianceId, uint256 declareeAllianceId, address member
    );
    error LegacyMemberOnBothSides(address member);
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
    event LegacyWarRosterSeeded(
        uint256 indexed declarerAllianceId,
        uint256 indexed declareeAllianceId,
        uint32 declarerMemberCount,
        uint32 declareeMemberCount
    );

    constructor(
        address allianceAddress,
        address gameAddress,
        address legacyProtectionAddress,
        address migrationAuthorityAddress
    ) {
        require(
            allianceAddress != address(0) && gameAddress != address(0)
                && migrationAuthorityAddress != address(0),
            "ZERO_ADDRESS"
        );
        alliance = allianceAddress;
        game = IVeydriftWarScoreGame(gameAddress);
        migrationAuthority = migrationAuthorityAddress;
        if (legacyProtectionAddress != address(0)) {
            VeydriftAllianceWarProtection candidate =
                VeydriftAllianceWarProtection(legacyProtectionAddress);
            if (candidate.alliance() != allianceAddress || address(candidate.game()) != gameAddress)
            {
                revert InvalidLegacyProtection(legacyProtectionAddress);
            }
            legacyProtection = candidate;
        }
    }

    /// @notice Seeds original alliance sides for an active snapshot held by the previous module.
    /// @dev Every supplied member is verified against the old snapshot. This one-time migration
    ///      prevents an original member from switching sides and inheriting the other side's privilege.
    function seedLegacyWarRoster(
        uint256 declarerAllianceId,
        uint256 declareeAllianceId,
        address[] calldata declarerMembers,
        address[] calldata declareeMembers
    ) external {
        if (msg.sender != migrationAuthority) {
            revert NotMigrationAuthority(msg.sender);
        }
        bytes32 key = _warKey(declarerAllianceId, declareeAllianceId);
        if (_snapshots[key].snapshotId != 0 || _legacyRostersSeeded[key]) {
            revert LegacyWarRosterAlreadySeeded(declarerAllianceId, declareeAllianceId);
        }
        if (address(legacyProtection) == address(0)) {
            revert LegacyWarSnapshotMissing(declarerAllianceId, declareeAllianceId);
        }
        WarSnapshot memory legacySnapshot =
            legacyProtection.warSnapshot(declarerAllianceId, declareeAllianceId);
        if (legacySnapshot.snapshotId == 0) {
            revert LegacyWarSnapshotMissing(declarerAllianceId, declareeAllianceId);
        }
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
        if (
            declarerMembers.length != legacySnapshot.declarerMemberCount
                || declareeMembers.length != legacySnapshot.declareeMemberCount
        ) {
            revert LegacyWarRosterCountMismatch(
                declarerAllianceId,
                declareeAllianceId,
                declarerMembers.length,
                legacySnapshot.declarerMemberCount,
                declareeMembers.length,
                legacySnapshot.declareeMemberCount
            );
        }
        _seedLegacySide(key, declarerAllianceId, declareeAllianceId, declarerMembers, 1);
        _seedLegacySide(key, declarerAllianceId, declareeAllianceId, declareeMembers, 2);
        _legacyRostersSeeded[key] = true;
        emit LegacyWarRosterSeeded(
            declarerAllianceId,
            declareeAllianceId,
            uint32(declarerMembers.length),
            uint32(declareeMembers.length)
        );
    }

    function capture(uint256 declarerAllianceId, uint256 declareeAllianceId, uint64 declaredAt)
        external
        returns (WarSnapshot memory snapshot)
    {
        if (msg.sender != alliance) revert NotAlliance(msg.sender);

        address[] memory declarerMembers =
            IVeydriftWarAlliance(alliance).allianceMembers(declarerAllianceId);
        address[] memory declareeMembers =
            IVeydriftWarAlliance(alliance).allianceMembers(declareeAllianceId);
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
        // A replacement module inherits a live snapshot only until this pair starts a new war.
        // Keep snapshot IDs monotonic across that transition for external consumers.
        if (_snapshotNonces[key] == 0 && address(legacyProtection) != address(0)) {
            uint64 legacySnapshotId =
                legacyProtection.warSnapshot(declarerAllianceId, declareeAllianceId).snapshotId;
            _snapshotNonces[key] = legacySnapshotId;
        }
        uint64 snapshotId = _snapshotNonces[key] + 1;
        _snapshotNonces[key] = snapshotId;
        uint256 declarerScore = _recordMembers(key, snapshotId, declarerMembers, 1);
        uint256 declareeScore = _recordMembers(key, snapshotId, declareeMembers, 2);
        if (declarerScore > type(uint128).max) {
            revert WarScoreTooLarge(declarerAllianceId, declarerScore);
        }
        if (declareeScore > type(uint128).max) {
            revert WarScoreTooLarge(declareeAllianceId, declareeScore);
        }

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

    function warSnapshot(uint256 allianceA, uint256 allianceB)
        external
        view
        returns (WarSnapshot memory)
    {
        WarSnapshot memory snapshot = _snapshots[_warKey(allianceA, allianceB)];
        if (snapshot.snapshotId != 0 || address(legacyProtection) == address(0)) return snapshot;
        return legacyProtection.warSnapshot(allianceA, allianceB);
    }

    function memberAtStart(uint256 allianceA, uint256 allianceB, address member)
        external
        view
        returns (bool)
    {
        bytes32 key = _warKey(allianceA, allianceB);
        WarSnapshot memory snapshot = _snapshots[key];
        if (snapshot.snapshotId != 0) return _memberIds[key][member] == snapshot.snapshotId;
        return address(legacyProtection) != address(0)
            && legacyProtection.memberAtStart(allianceA, allianceB, member);
    }

    /// @notice Whether an inherited snapshot's two complete original rosters have been seeded.
    function legacyWarRosterSeeded(uint256 allianceA, uint256 allianceB)
        external
        view
        returns (bool)
    {
        return _legacyRostersSeeded[_warKey(allianceA, allianceB)];
    }

    /// @notice Returns directional war exceptions using frozen alliance totals and original rosters.
    /// @dev Members regain this privilege when they rejoin their original alliance: the snapshot is
    ///      about who was present at declaration, not a one-time membership epoch.
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
        bool useLegacySnapshot = snapshot.snapshotId == 0 && address(legacyProtection) != address(0);
        if (useLegacySnapshot) {
            snapshot = legacyProtection.warSnapshot(declarerAllianceId, declareeAllianceId);
        }
        if (snapshot.snapshotId == 0) return (false, false);
        if (useLegacySnapshot && !_legacyRostersSeeded[key]) return (false, false);
        if (
            !_isCurrentOriginalMember(
                    key,
                    snapshot.snapshotId,
                    declarerAllianceId,
                    declareeAllianceId,
                    attacker,
                    attackerAllianceId,
                    useLegacySnapshot
                )
                || !_isCurrentOriginalMember(
                    key,
                    snapshot.snapshotId,
                    declarerAllianceId,
                    declareeAllianceId,
                    defender,
                    defenderAllianceId,
                    useLegacySnapshot
                )
        ) return (false, false);

        // A weaker/equal alliance may declare upward with no score-ratio restriction. A stronger
        // declarer gets bilateral exceptions only while it was within the frozen 1.5x alliance
        // ratio. If it declared more than 1.5x stronger, only the declared-on side may retaliate.
        if (
            snapshot.declarerScore <= snapshot.declareeScore
                || _withinRatio(snapshot.declarerScore, snapshot.declareeScore)
        ) return (true, true);
        if (attackerAllianceId == declareeAllianceId && defenderAllianceId == declarerAllianceId) {
            return (true, true);
        }
        return (false, false);
    }

    function _recordMembers(bytes32 key, uint64 snapshotId, address[] memory members, uint8 side)
        private
        returns (uint256 score)
    {
        for (uint256 index = 0; index < members.length;) {
            address member = members[index];
            _memberIds[key][member] = snapshotId;
            _memberSides[key][member] = side;
            score += game.playerScore(member);
            unchecked {
                ++index;
            }
        }
    }

    function _isCurrentOriginalMember(
        bytes32 key,
        uint64 snapshotId,
        uint256 declarerAllianceId,
        uint256 declareeAllianceId,
        address player,
        uint256 allianceId,
        bool useLegacySnapshot
    ) private view returns (bool) {
        if (allianceId != declarerAllianceId && allianceId != declareeAllianceId) return false;
        uint8 expectedSide = allianceId == declarerAllianceId ? 1 : 2;
        bool originalMember = useLegacySnapshot
            ? _legacyMemberSides[key][player] == expectedSide
            : _memberIds[key][player] == snapshotId && _memberSides[key][player] == expectedSide;
        return originalMember
            && IVeydriftWarAlliance(alliance).allianceOf(player).allianceId == allianceId;
    }

    function _seedLegacySide(
        bytes32 key,
        uint256 declarerAllianceId,
        uint256 declareeAllianceId,
        address[] calldata members,
        uint8 side
    ) private {
        for (uint256 index = 0; index < members.length;) {
            address member = members[index];
            if (!legacyProtection.memberAtStart(declarerAllianceId, declareeAllianceId, member)) {
                revert LegacyMemberMissing(declarerAllianceId, declareeAllianceId, member);
            }
            if (_legacyMemberSides[key][member] != 0) revert LegacyMemberOnBothSides(member);
            _legacyMemberSides[key][member] = side;
            unchecked {
                ++index;
            }
        }
    }

    function _withinRatio(uint256 attackerScore, uint256 defenderScore)
        private
        pure
        returns (bool)
    {
        return defenderScore != 0
            && attackerScore * BPS <= defenderScore * WAR_SCORE_PROTECTION_RATIO_BPS;
    }

    function _warKey(uint256 allianceA, uint256 allianceB) private pure returns (bytes32) {
        return allianceA < allianceB
            ? keccak256(abi.encode(allianceA, allianceB))
            : keccak256(abi.encode(allianceB, allianceA));
    }
}
