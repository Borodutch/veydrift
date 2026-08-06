// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {Building} from "./libraries/VeydriftTypes.sol";

interface IVeydriftAllianceGame {
    function buildingLevel(uint256 planetId, Building building) external view returns (uint16);
    function homePlanetOf(address player) external view returns (uint256);
    function settleAllianceMembershipBoundary(address player) external;
    function creditAllianceBonusToPlanet(
        uint256 planetId,
        address manager,
        VeydriftGameStorage.Resources calldata amount
    ) external;
    function planet(uint256 planetId) external view returns (VeydriftGameStorage.Planet memory);
    function fleetMission(uint256 missionId)
        external
        view
        returns (
            VeydriftGameStorage.FleetMissionStatus status,
            VeydriftGameStorage.FleetMissionType missionType,
            address owner,
            uint256 originPlanetId,
            uint256 targetPlanetId,
            uint64 departureAt,
            uint64 arrivalAt,
            uint64 returnAt,
            uint128 fuelCost,
            VeydriftGameStorage.Resources memory cargo,
            uint256 randomnessRequestId
        );
}

interface IVeydriftPaidAllianceInvites {
    function redeem(
        address invitee,
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (address purchaser, uint256 allianceId);

    function creditProduction(address invitee, VeydriftGameStorage.Resources calldata produced)
        external
        returns (VeydriftGameStorage.Resources memory bonus);
}

/// @notice Canonical on-chain alliance roster and public profile authority.
contract VeydriftAllianceSystem is Initializable, UUPSUpgradeable {
    uint128 private constant ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL = 20_000;
    uint64 public constant WAR_MINIMUM_DURATION = 48 hours;

    enum AllianceRole {
        None,
        Member,
        Officer,
        Owner
    }

    enum DiplomacyStatus {
        None,
        Ally,
        NonAggressionPact,
        War
    }

    struct Alliance {
        bool active;
        string tag;
        string name;
        string description;
        address owner;
        uint64 createdAt;
        uint32 memberCount;
    }

    struct Membership {
        uint256 allianceId;
        AllianceRole role;
        uint64 joinedAt;
    }

    struct Invite {
        bool active;
        uint256 allianceId;
        address inviter;
        uint64 invitedAt;
    }

    struct JoinRequest {
        bool active;
        uint256 allianceId;
        address requester;
        uint64 requestedAt;
    }

    struct DefenseIntent {
        bool active;
        uint256 allianceId;
        uint256 defenderPlanetId;
        uint256 hostileMissionId;
        address coordinator;
        uint64 openedAt;
        uint64 joinCutoffAt;
    }

    IVeydriftAllianceGame public game;
    address public owner;
    uint256 public nextAllianceId;
    uint256 public nextDefenseIntentId;

    mapping(uint256 allianceId => Alliance alliance) internal _alliances;
    mapping(address player => Membership membership) internal _memberships;
    mapping(uint256 allianceId => address[] members) internal _memberLists;
    mapping(uint256 allianceId => mapping(address player => uint256 indexPlusOne)) internal
        _memberIndexes;
    mapping(address player => mapping(uint256 allianceId => Invite invite)) internal _invites;
    mapping(uint256 allianceId => address[] requesters) internal _joinRequestLists;
    mapping(uint256 allianceId => mapping(address player => uint256 indexPlusOne)) internal
        _joinRequestIndexes;
    mapping(uint256 allianceId => mapping(address player => JoinRequest request)) internal
        _joinRequests;
    mapping(uint256 allianceId => mapping(uint256 otherAllianceId => DiplomacyStatus status))
        internal _diplomacy;
    mapping(uint256 intentId => DefenseIntent intent) internal _defenseIntents;
    // Appended storage: the canonical declaration direction stores the start time.
    // Reciprocal getters resolve this value for either alliance ordering. Existing
    // wars without a historical timestamp use the activation time below.
    mapping(uint256 allianceId => mapping(uint256 otherAllianceId => uint64 startedAt)) internal
        _warStartedAts;
    uint64 public warMinimumDurationActivatedAt;
    // Appended storage for declarations whose raw pre-upgrade diplomacy rows are
    // mirrored and therefore cannot identify the original declarer by direction.
    // New declarations populate both orderings so reads and cleanup are atomic.
    mapping(
        uint256 allianceId => mapping(uint256 otherAllianceId => uint256 declarerAllianceId)
    ) internal _warDeclarers;
    // VEY-KANEO-818 append-only bridge to the independently deployable paid-invite treasury.
    address public paidInviteSystem;

    error AllianceInactive(uint256 allianceId);
    error AlreadyInAlliance(address player, uint256 allianceId);
    error EmptyAllianceProfile();
    error InvalidAlliance(uint256 allianceId);
    error InvalidInvite(address player, uint256 allianceId);
    error InvalidJoinRequest(address player, uint256 allianceId);
    error InvalidRole(AllianceRole role);
    error NewOwnerMustBeOfficer(address account, uint256 allianceId);
    error NoAlliance(address player);
    error NoPlanet(address player);
    error NotAllianceMember(address player, uint256 allianceId);
    error NotAuthorized(address player, uint256 allianceId);
    error NotOwner(address account);
    error NotPlanetOwner(uint256 planetId, address player);
    error SelfDiplomacy(uint256 allianceId);
    error SnapshotLengthMismatch();
    error WarAlreadyActive(uint256 allianceId, uint256 otherAllianceId);
    error WarDeclarerAlreadyRecorded(uint256 allianceId, uint256 otherAllianceId);
    error WarDeclarerUnknown(uint256 allianceId, uint256 otherAllianceId);
    error WarEndLocked(uint64 unlocksAt);
    error InvalidWarMigration(
        uint256 allianceId, uint256 otherAllianceId, uint256 declarerAllianceId, uint64 declaredAt
    );
    error ZeroAddress();
    error NotGame(address caller);
    error NotPaidInviteSystem(address caller);
    error PaidInviteSystemUnset();

    event AllianceCreated(
        uint256 indexed allianceId, address indexed owner, string tag, string name
    );
    event AllianceProfileUpdated(
        uint256 indexed allianceId, string tag, string name, string description
    );
    event AllianceInviteCreated(
        uint256 indexed allianceId, address indexed inviter, address indexed player
    );
    event AllianceInviteCancelled(uint256 indexed allianceId, address indexed player);
    event AllianceJoinRequested(
        uint256 indexed allianceId, address indexed requester, uint64 requestedAt
    );
    event AllianceJoinRequestCancelled(uint256 indexed allianceId, address indexed requester);
    event AllianceJoinRequestDismissed(
        uint256 indexed allianceId, address indexed manager, address indexed requester
    );
    event AllianceJoinRequestApproved(
        uint256 indexed allianceId, address indexed approver, address indexed requester
    );
    event AllianceJoined(uint256 indexed allianceId, address indexed player, AllianceRole role);
    event AllianceLeft(uint256 indexed allianceId, address indexed player);
    event AllianceRoleUpdated(
        uint256 indexed allianceId, address indexed player, AllianceRole role
    );
    event AllianceOwnershipTransferred(
        uint256 indexed allianceId, address indexed previousOwner, address indexed newOwner
    );
    event AllianceDiplomacyUpdated(
        uint256 indexed allianceId, uint256 indexed otherAllianceId, DiplomacyStatus status
    );
    event AllianceWarMetadataMigrated(
        uint256 indexed allianceId,
        uint256 indexed otherAllianceId,
        uint256 indexed declarerAllianceId,
        uint64 declaredAt
    );
    event AllianceDefenseIntentOpened(
        uint256 indexed intentId,
        uint256 indexed allianceId,
        uint256 indexed defenderPlanetId,
        uint256 hostileMissionId,
        address coordinator,
        uint64 joinCutoffAt
    );
    event AllianceSnapshotImported(uint256 indexed allianceId, uint32 memberCount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event PaidInviteSystemUpdated(address indexed oldSystem, address indexed newSystem);

    constructor(IVeydriftAllianceGame gameContract) {
        _initializeAllianceSystem(gameContract, msg.sender);
        _disableInitializers();
    }

    function initialize(IVeydriftAllianceGame gameContract, address initialOwner)
        external
        initializer
    {
        _initializeAllianceSystem(gameContract, initialOwner);
    }

    /// @notice Initializes the 48-hour war lock during the UUPS upgrade.
    /// Existing wars have no on-chain declaration timestamp in the old layout,
    /// so they are conservatively locked from this activation time.
    function initializeWarMinimumDuration() external reinitializer(2) onlyOwner {
        warMinimumDurationActivatedAt = _now();
    }

    /// @notice Records the verified original declarer for an ambiguous mirrored
    /// pre-upgrade war. Each pair can be migrated once and only while active.
    function migrateLegacyWarMetadata(
        uint256 allianceId,
        uint256 otherAllianceId,
        uint256 declarerAllianceId,
        uint64 declaredAt
    ) external onlyOwner {
        _requireAlliance(allianceId);
        _requireAlliance(otherAllianceId);
        if (_relationship(allianceId, otherAllianceId) != DiplomacyStatus.War) {
            revert InvalidWarMigration(allianceId, otherAllianceId, declarerAllianceId, declaredAt);
        }
        if (_warDeclarers[allianceId][otherAllianceId] != 0) {
            revert WarDeclarerAlreadyRecorded(allianceId, otherAllianceId);
        }
        uint256 targetAllianceId;
        if (declarerAllianceId == allianceId) {
            targetAllianceId = otherAllianceId;
        } else if (declarerAllianceId == otherAllianceId) {
            targetAllianceId = allianceId;
        } else {
            revert InvalidWarMigration(allianceId, otherAllianceId, declarerAllianceId, declaredAt);
        }
        if (
            _diplomacy[declarerAllianceId][targetAllianceId] != DiplomacyStatus.War
                || declaredAt == 0 || declaredAt > _now()
        ) {
            revert InvalidWarMigration(allianceId, otherAllianceId, declarerAllianceId, declaredAt);
        }

        delete _warStartedAts[allianceId][otherAllianceId];
        delete _warStartedAts[otherAllianceId][allianceId];
        _setWarMetadata(allianceId, otherAllianceId, declarerAllianceId, declaredAt);
        emit AllianceWarMetadataMigrated(
            allianceId, otherAllianceId, declarerAllianceId, declaredAt
        );
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(oldOwner, nextOwner);
    }

    function setPaidInviteSystem(address nextSystem) external onlyOwner {
        if (nextSystem == address(0)) revert ZeroAddress();
        address oldSystem = paidInviteSystem;
        paidInviteSystem = nextSystem;
        emit PaidInviteSystemUpdated(oldSystem, nextSystem);
    }

    /// @dev Small trusted bridge: the game remains wired to this canonical alliance system while
    /// feature-heavy invite accounting lives in its own EIP-170-safe contract.
    function creditPaidInviteProduction(
        address invitee,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    ) external returns (VeydriftGameStorage.Resources memory bonus) {
        if (msg.sender != address(game)) revert NotGame(msg.sender);
        address system = paidInviteSystem;
        if (system == address(0)) return bonus;
        VeydriftGameStorage.Resources memory produced =
            VeydriftGameStorage.Resources({metal: metal, crystal: crystal, deuterium: deuterium});
        return IVeydriftPaidAllianceInvites(system).creditProduction(invitee, produced);
    }

    function redeemPaidInvite(
        address invitee,
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (address purchaser, uint256 allianceId) {
        if (msg.sender != address(game)) revert NotGame(msg.sender);
        address system = paidInviteSystem;
        if (system == address(0)) revert PaidInviteSystemUnset();
        return IVeydriftPaidAllianceInvites(system).redeem(invitee, commitment, expiresAt, v, r, s);
    }

    function joinFromPaidInvite(uint256 allianceId, address invitee) external {
        if (msg.sender != paidInviteSystem) revert NotPaidInviteSystem(msg.sender);
        _requireAlliance(allianceId);
        if (game.homePlanetOf(invitee) != 0 || _memberships[invitee].allianceId != 0) {
            revert AlreadyInAlliance(invitee, _memberships[invitee].allianceId);
        }
        _addMember(allianceId, invitee, AllianceRole.Member);
    }

    function creditPaidInviteBonusToPlanet(
        uint256 planetId,
        address manager,
        VeydriftGameStorage.Resources calldata amount
    ) external {
        if (msg.sender != paidInviteSystem) {
            revert NotPaidInviteSystem(msg.sender);
        }
        game.creditAllianceBonusToPlanet(planetId, manager, amount);
    }

    function importAllianceSnapshot(
        uint256 allianceId,
        Alliance calldata profile,
        address[] calldata members,
        AllianceRole[] calldata roles,
        uint64[] calldata joinedAts
    ) external onlyOwner {
        if (allianceId == 0 || !profile.active || profile.owner == address(0)) {
            revert InvalidAlliance(allianceId);
        }
        if (_alliances[allianceId].active) revert InvalidAlliance(allianceId);
        if (
            members.length != roles.length || roles.length != joinedAts.length
                || members.length != profile.memberCount
        ) {
            revert SnapshotLengthMismatch();
        }

        _alliances[allianceId] = Alliance({
            active: true,
            tag: profile.tag,
            name: profile.name,
            description: profile.description,
            owner: profile.owner,
            createdAt: profile.createdAt,
            memberCount: 0
        });
        if (allianceId >= nextAllianceId) nextAllianceId = allianceId + 1;

        bool ownerImported = false;
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == address(0)) revert ZeroAddress();
            if (_memberships[members[i]].allianceId != 0) {
                revert AlreadyInAlliance(members[i], _memberships[members[i]].allianceId);
            }
            if (
                roles[i] != AllianceRole.Member && roles[i] != AllianceRole.Officer
                    && roles[i] != AllianceRole.Owner
            ) {
                revert InvalidRole(roles[i]);
            }
            if (members[i] == profile.owner) {
                if (roles[i] != AllianceRole.Owner) revert InvalidRole(roles[i]);
                ownerImported = true;
            } else if (roles[i] == AllianceRole.Owner) {
                revert InvalidRole(roles[i]);
            }
            _importMember(allianceId, members[i], roles[i], joinedAts[i]);
        }
        if (!ownerImported) revert NotAllianceMember(profile.owner, allianceId);

        emit AllianceSnapshotImported(allianceId, uint32(members.length));
    }

    function importDiplomacy(uint256 allianceId, uint256 otherAllianceId, DiplomacyStatus status)
        external
        onlyOwner
    {
        _requireAlliance(allianceId);
        _requireAlliance(otherAllianceId);
        if (allianceId == otherAllianceId) revert SelfDiplomacy(allianceId);

        _clearDiplomacyPair(allianceId, otherAllianceId);
        if (status == DiplomacyStatus.War) {
            _diplomacy[allianceId][otherAllianceId] = status;
            _setWarMetadata(allianceId, otherAllianceId, allianceId, _now());
        } else {
            _diplomacy[allianceId][otherAllianceId] = status;
            _diplomacy[otherAllianceId][allianceId] = status;
        }
        emit AllianceDiplomacyUpdated(allianceId, otherAllianceId, status);
    }

    function createAlliance(string calldata tag, string calldata name, string calldata description)
        external
        returns (uint256 allianceId)
    {
        _requireSettledPlayer(msg.sender);
        if (_memberships[msg.sender].allianceId != 0) {
            revert AlreadyInAlliance(msg.sender, _memberships[msg.sender].allianceId);
        }
        _requireProfile(tag, name);

        allianceId = nextAllianceId++;
        _alliances[allianceId] = Alliance({
            active: true,
            tag: tag,
            name: name,
            description: description,
            owner: msg.sender,
            createdAt: _now(),
            memberCount: 0
        });
        _addMember(allianceId, msg.sender, AllianceRole.Owner);

        emit AllianceCreated(allianceId, msg.sender, tag, name);
    }

    function updateAllianceProfile(
        uint256 allianceId,
        string calldata tag,
        string calldata name,
        string calldata description
    ) external {
        _requireOwner(allianceId, msg.sender);
        _requireProfile(tag, name);

        Alliance storage target = _requireAlliance(allianceId);
        target.tag = tag;
        target.name = name;
        target.description = description;

        emit AllianceProfileUpdated(allianceId, tag, name, description);
    }

    function inviteMember(uint256 allianceId, address player) external {
        _requireOfficer(allianceId, msg.sender);
        _requireSettledPlayer(player);
        if (_memberships[player].allianceId != 0) {
            revert AlreadyInAlliance(player, _memberships[player].allianceId);
        }

        _invites[player][allianceId] =
            Invite({active: true, allianceId: allianceId, inviter: msg.sender, invitedAt: _now()});
        emit AllianceInviteCreated(allianceId, msg.sender, player);
    }

    function cancelInvite(uint256 allianceId, address player) external {
        _requireOfficer(allianceId, msg.sender);
        delete _invites[player][allianceId];
        emit AllianceInviteCancelled(allianceId, player);
    }

    function acceptInvite(uint256 allianceId) external {
        _requireAlliance(allianceId);
        Invite memory invite = _invites[msg.sender][allianceId];
        if (!invite.active) revert InvalidInvite(msg.sender, allianceId);
        if (_memberships[msg.sender].allianceId != 0) {
            revert AlreadyInAlliance(msg.sender, _memberships[msg.sender].allianceId);
        }

        delete _invites[msg.sender][allianceId];
        if (_joinRequestIndexes[allianceId][msg.sender] != 0) {
            _removeJoinRequest(allianceId, msg.sender);
        }
        _addMember(allianceId, msg.sender, AllianceRole.Member);
    }

    function requestJoinAlliance(uint256 allianceId) external {
        _requireAlliance(allianceId);
        _requireSettledPlayer(msg.sender);
        if (_memberships[msg.sender].allianceId != 0) {
            revert AlreadyInAlliance(msg.sender, _memberships[msg.sender].allianceId);
        }

        if (_joinRequestIndexes[allianceId][msg.sender] == 0) {
            _joinRequestIndexes[allianceId][msg.sender] = _joinRequestLists[allianceId].length + 1;
            _joinRequestLists[allianceId].push(msg.sender);
        }
        uint64 requestedAt = _now();
        _joinRequests[allianceId][msg.sender] = JoinRequest({
            active: true, allianceId: allianceId, requester: msg.sender, requestedAt: requestedAt
        });
        emit AllianceJoinRequested(allianceId, msg.sender, requestedAt);
    }

    function cancelJoinRequest(uint256 allianceId) external {
        _removeJoinRequest(allianceId, msg.sender);
        emit AllianceJoinRequestCancelled(allianceId, msg.sender);
    }

    function dismissJoinRequest(uint256 allianceId, address player) external {
        _requireOfficer(allianceId, msg.sender);
        _removeJoinRequest(allianceId, player);
        emit AllianceJoinRequestDismissed(allianceId, msg.sender, player);
    }

    function approveJoinRequest(uint256 allianceId, address player) external {
        _requireOfficer(allianceId, msg.sender);
        JoinRequest memory request = _joinRequests[allianceId][player];
        if (!request.active) revert InvalidJoinRequest(player, allianceId);
        if (_memberships[player].allianceId != 0) {
            revert AlreadyInAlliance(player, _memberships[player].allianceId);
        }

        _removeJoinRequest(allianceId, player);
        _addMember(allianceId, player, AllianceRole.Member);
        emit AllianceJoinRequestApproved(allianceId, msg.sender, player);
    }

    function kickMember(uint256 allianceId, address player) external {
        _requireOfficer(allianceId, msg.sender);
        Membership memory kicker = _memberships[msg.sender];
        _kickMember(allianceId, kicker, player);
    }

    function kickMembers(uint256 allianceId, address[] calldata players) external {
        _requireOfficer(allianceId, msg.sender);
        Membership memory kicker = _memberships[msg.sender];
        for (uint256 i = 0; i < players.length; i++) {
            _kickMember(allianceId, kicker, players[i]);
        }
    }

    function leaveAlliance() external {
        Membership memory membership = _memberships[msg.sender];
        if (membership.allianceId == 0) revert NoAlliance(msg.sender);
        if (
            membership.role == AllianceRole.Owner
                && _alliances[membership.allianceId].memberCount > 1
        ) {
            revert NotAuthorized(msg.sender, membership.allianceId);
        }

        _removeMember(membership.allianceId, msg.sender);
    }

    function setMemberRole(uint256 allianceId, address player, AllianceRole role) external {
        _requireOwner(allianceId, msg.sender);
        _setMemberRole(allianceId, player, role);
    }

    function setMembersRole(uint256 allianceId, address[] calldata players, AllianceRole role)
        external
    {
        _requireOwner(allianceId, msg.sender);
        for (uint256 i = 0; i < players.length; i++) {
            _setMemberRole(allianceId, players[i], role);
        }
    }

    function _setMemberRole(uint256 allianceId, address player, AllianceRole role) private {
        if (role != AllianceRole.Member && role != AllianceRole.Officer) revert InvalidRole(role);
        Membership storage membership = _memberships[player];
        if (membership.allianceId != allianceId) revert NotAllianceMember(player, allianceId);
        if (membership.role == AllianceRole.Owner) revert NotAuthorized(msg.sender, allianceId);

        membership.role = role;
        emit AllianceRoleUpdated(allianceId, player, role);
    }

    /// @notice Hand the alliance owner role to one of the alliance's officers,
    /// demoting the previous owner to officer so the alliance always keeps
    /// exactly one owner.
    function transferAllianceOwnership(uint256 allianceId, address newOwner) external {
        _requireOwner(allianceId, msg.sender);
        if (newOwner == msg.sender) revert NotAuthorized(msg.sender, allianceId);
        Membership storage incoming = _memberships[newOwner];
        if (incoming.allianceId != allianceId) revert NotAllianceMember(newOwner, allianceId);
        if (incoming.role != AllianceRole.Officer) {
            revert NewOwnerMustBeOfficer(newOwner, allianceId);
        }

        _memberships[msg.sender].role = AllianceRole.Officer;
        incoming.role = AllianceRole.Owner;
        _alliances[allianceId].owner = newOwner;

        emit AllianceRoleUpdated(allianceId, msg.sender, AllianceRole.Officer);
        emit AllianceRoleUpdated(allianceId, newOwner, AllianceRole.Owner);
        emit AllianceOwnershipTransferred(allianceId, msg.sender, newOwner);
    }

    function setDiplomacy(uint256 allianceId, uint256 otherAllianceId, DiplomacyStatus status)
        external
    {
        _requireAlliance(allianceId);
        _requireAlliance(otherAllianceId);
        if (allianceId == otherAllianceId) revert SelfDiplomacy(allianceId);

        DiplomacyStatus currentStatus = _diplomacy[allianceId][otherAllianceId];
        DiplomacyStatus reciprocalStatus = _diplomacy[otherAllianceId][allianceId];
        if (status == DiplomacyStatus.War) {
            _requireOwner(allianceId, msg.sender);
            if (currentStatus == DiplomacyStatus.War || reciprocalStatus == DiplomacyStatus.War) {
                revert WarAlreadyActive(allianceId, otherAllianceId);
            }
            _clearDiplomacyPair(allianceId, otherAllianceId);
            _diplomacy[allianceId][otherAllianceId] = DiplomacyStatus.War;
            _setWarMetadata(allianceId, otherAllianceId, allianceId, _now());
            emit AllianceDiplomacyUpdated(allianceId, otherAllianceId, DiplomacyStatus.War);
            return;
        }

        if (currentStatus == DiplomacyStatus.War || reciprocalStatus == DiplomacyStatus.War) {
            if (status != DiplomacyStatus.None) {
                revert NotAuthorized(msg.sender, allianceId);
            }
            uint256 declarerAllianceId = _warDeclarer(allianceId, otherAllianceId);
            if (declarerAllianceId == 0) {
                revert WarDeclarerUnknown(allianceId, otherAllianceId);
            }
            if (allianceId != declarerAllianceId) {
                revert NotAuthorized(msg.sender, allianceId);
            }
            _requireOfficer(allianceId, msg.sender);
            uint64 startedAt = _warStart(allianceId, otherAllianceId);
            uint64 unlocksAt = startedAt + WAR_MINIMUM_DURATION;
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp < unlocksAt) revert WarEndLocked(unlocksAt);
            _clearDiplomacyPair(allianceId, otherAllianceId);
            emit AllianceDiplomacyUpdated(allianceId, otherAllianceId, DiplomacyStatus.None);
            return;
        }

        _requireOfficer(allianceId, msg.sender);
        _clearDiplomacyPair(allianceId, otherAllianceId);
        _diplomacy[allianceId][otherAllianceId] = status;
        _diplomacy[otherAllianceId][allianceId] = status;
        emit AllianceDiplomacyUpdated(allianceId, otherAllianceId, status);
    }

    function openDefenseIntent(uint256 defenderPlanetId, uint256 hostileMissionId)
        external
        returns (uint256 intentId)
    {
        VeydriftGameStorage.Planet memory target = game.planet(defenderPlanetId);
        if (target.owner == address(0)) revert InvalidAlliance(defenderPlanetId);
        if (target.owner != msg.sender) revert NotPlanetOwner(defenderPlanetId, msg.sender);

        Membership memory membership = _memberships[msg.sender];
        if (membership.allianceId == 0) revert NoAlliance(msg.sender);

        (
            VeydriftGameStorage.FleetMissionStatus status,
            VeydriftGameStorage.FleetMissionType missionType,
            address attacker,,
            uint256 targetPlanetId,,
            uint64 arrivalAt,,,,
        ) = game.fleetMission(hostileMissionId);
        if (
            status != VeydriftGameStorage.FleetMissionStatus.Outbound
                || targetPlanetId != defenderPlanetId || !_isHostileMission(missionType)
                || attacker == address(0)
                || !VeydriftAntiRaidPrimitives.canJoinAcsDefense(block.timestamp, arrivalAt)
        ) {
            revert InvalidAlliance(hostileMissionId);
        }

        intentId = nextDefenseIntentId++;
        uint64 joinCutoffAt =
            uint64(arrivalAt - VeydriftAntiRaidPrimitives.ACS_DEFEND_JOIN_CUTOFF_SECONDS);
        _defenseIntents[intentId] = DefenseIntent({
            active: true,
            allianceId: membership.allianceId,
            defenderPlanetId: defenderPlanetId,
            hostileMissionId: hostileMissionId,
            coordinator: msg.sender,
            openedAt: _now(),
            joinCutoffAt: joinCutoffAt
        });

        emit AllianceDefenseIntentOpened(
            intentId,
            membership.allianceId,
            defenderPlanetId,
            hostileMissionId,
            msg.sender,
            joinCutoffAt
        );
    }

    function allianceProfile(uint256 allianceId) external view returns (Alliance memory) {
        return _alliances[allianceId];
    }

    function allianceOf(address player) external view returns (Membership memory) {
        return _memberships[player];
    }

    function allianceMemberAt(uint256 allianceId, uint256 index) external view returns (address) {
        return _memberLists[allianceId][index];
    }

    function allianceMembers(uint256 allianceId) external view returns (address[] memory) {
        return _memberLists[allianceId];
    }

    function allianceIds() external view returns (uint256[] memory) {
        uint256 count = nextAllianceId - 1;
        uint256[] memory ids = new uint256[](count);
        for (uint256 allianceId = 1; allianceId <= count; allianceId++) {
            ids[allianceId - 1] = allianceId;
        }
        return ids;
    }

    function allianceInvite(address player, uint256 allianceId)
        external
        view
        returns (Invite memory)
    {
        return _invites[player][allianceId];
    }

    function allianceJoinRequest(address player, uint256 allianceId)
        external
        view
        returns (JoinRequest memory)
    {
        return _joinRequests[allianceId][player];
    }

    function allianceJoinRequests(uint256 allianceId) external view returns (address[] memory) {
        return _joinRequestLists[allianceId];
    }

    function diplomacyStatus(uint256 allianceId, uint256 otherAllianceId)
        external
        view
        returns (DiplomacyStatus)
    {
        return _relationship(allianceId, otherAllianceId);
    }

    function warStartedAt(uint256 allianceId, uint256 otherAllianceId)
        external
        view
        returns (uint64)
    {
        if (_relationship(allianceId, otherAllianceId) != DiplomacyStatus.War) return 0;
        return _warStart(allianceId, otherAllianceId);
    }

    function warDeclarer(uint256 allianceId, uint256 otherAllianceId)
        external
        view
        returns (uint256)
    {
        if (_relationship(allianceId, otherAllianceId) != DiplomacyStatus.War) return 0;
        return _warDeclarer(allianceId, otherAllianceId);
    }

    function defenseIntent(uint256 intentId) external view returns (DefenseIntent memory) {
        return _defenseIntents[intentId];
    }

    function attackLimitAllianceContext(address attacker, address defender)
        external
        view
        returns (
            uint256 attackerAllianceId,
            uint256 defenderAllianceId,
            bool sameAlliance,
            bool atWar,
            bool bashingWarException,
            bool scoreProtectionException
        )
    {
        attackerAllianceId = _memberships[attacker].allianceId;
        defenderAllianceId = _memberships[defender].allianceId;
        sameAlliance = attackerAllianceId != 0 && attackerAllianceId == defenderAllianceId;
        atWar = _relationship(attackerAllianceId, defenderAllianceId) == DiplomacyStatus.War;
        bashingWarException = atWar;
        scoreProtectionException = sameAlliance || atWar;
    }

    function attackProtectionFlags(address attacker, address defender)
        external
        view
        returns (uint256 flags)
    {
        if (attacker == defender) return 0;
        uint256 attackerAllianceId = _memberships[attacker].allianceId;
        uint256 defenderAllianceId = _memberships[defender].allianceId;
        bool sameAlliance = attackerAllianceId != 0 && attackerAllianceId == defenderAllianceId;
        bool atWar = _relationship(attackerAllianceId, defenderAllianceId) == DiplomacyStatus.War;
        if (sameAlliance) flags |= 1;
        if (atWar) flags |= 2;
    }

    function canCoordinateDefense(
        address viewer,
        uint256 defenderPlanetId,
        uint256 hostileMissionId
    ) external view returns (bool) {
        return _canCoordinateDefense(viewer, defenderPlanetId, hostileMissionId);
    }

    function counterplayDefenseFuelContext(
        address viewer,
        uint256 defenderPlanetId,
        uint256 hostileMissionId,
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) external view returns (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport) {
        canCoordinate = _canCoordinateDefense(viewer, defenderPlanetId, hostileMissionId);
        if (!canCoordinate) return (false, 0, 0);

        uint128 holdingFuelCost = _acsHoldingFuelCost(ships, holdSeconds);
        uint128 supportCapacity = uint128(
            uint256(game.buildingLevel(defenderPlanetId, Building.AllianceDepot))
                * ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL
        );
        depotSupport = holdingFuelCost < supportCapacity ? holdingFuelCost : supportCapacity;
        netHoldingFuelCost = holdingFuelCost - depotSupport;
    }

    /// @notice Authorization and holding-fuel context for an OGame-style ACS Defend (DefenseHold)
    ///         stationing mission. Unlike counterplay defense, this is not tied to a specific hostile
    ///         mission: a player may station a fleet at their own planet or at any same-alliance
    ///         member's planet for a chosen hold window. Holding fuel scales with the hold duration
    ///         and is offset by the defended planet's Alliance Depot, mirroring counterplay holding.
    function defenseHoldFuelContext(
        address viewer,
        uint256 defenderPlanetId,
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) external view returns (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport) {
        VeydriftGameStorage.Planet memory target = game.planet(defenderPlanetId);
        if (target.owner == address(0)) return (false, 0, 0);

        if (target.owner != viewer) {
            uint256 targetAllianceId = _memberships[target.owner].allianceId;
            uint256 viewerAllianceId = _memberships[viewer].allianceId;
            if (targetAllianceId == 0 || targetAllianceId != viewerAllianceId) {
                return (false, 0, 0);
            }
        }
        canCoordinate = true;

        uint128 holdingFuelCost = _acsHoldingFuelCost(ships, holdSeconds);
        uint128 supportCapacity = uint128(
            uint256(game.buildingLevel(defenderPlanetId, Building.AllianceDepot))
                * ALLIANCE_DEPOT_SUPPORT_DEUTERIUM_PER_LEVEL
        );
        depotSupport = holdingFuelCost < supportCapacity ? holdingFuelCost : supportCapacity;
        netHoldingFuelCost = holdingFuelCost - depotSupport;
    }

    function _canCoordinateDefense(
        address viewer,
        uint256 defenderPlanetId,
        uint256 hostileMissionId
    ) private view returns (bool) {
        VeydriftGameStorage.Planet memory target = game.planet(defenderPlanetId);
        if (target.owner == viewer) {
            return true;
        }

        Membership memory targetMembership = _memberships[target.owner];
        Membership memory viewerMembership = _memberships[viewer];
        if (
            target.owner == address(0) || targetMembership.allianceId == 0
                || targetMembership.allianceId != viewerMembership.allianceId
        ) {
            return false;
        }

        (
            VeydriftGameStorage.FleetMissionStatus status,
            VeydriftGameStorage.FleetMissionType missionType,,,
            uint256 targetPlanetId,,
            uint64 arrivalAt,,,,
        ) = game.fleetMission(hostileMissionId);

        return status == VeydriftGameStorage.FleetMissionStatus.Outbound
            && targetPlanetId == defenderPlanetId && _isHostileMission(missionType)
            && VeydriftAntiRaidPrimitives.canJoinAcsDefense(block.timestamp, arrivalAt);
    }

    function _acsHoldingFuelCost(
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) private pure returns (uint128) {
        if (holdSeconds == 0) return 0;
        uint256 tenthsPerHour = uint256(ships.smallCargo) * 50 + uint256(ships.lightFighter) * 20
            + uint256(ships.recycler) * 300 + uint256(ships.colonyShip) * 1_000
            + uint256(ships.largeCargo) * 50 + uint256(ships.heavyFighter) * 75
            + uint256(ships.cruiser) * 300 + uint256(ships.battleship) * 500 + uint256(ships.bomber)
            * 1_000 + uint256(ships.destroyer) * 1_000 + uint256(ships.deathstar)
            + uint256(ships.battlecruiser) * 250 + uint256(ships.reaper) * 1_000
            + uint256(ships.pathfinder) * 300;
        return uint128((tenthsPerHour * holdSeconds + 10 hours - 1) / (10 hours));
    }

    function hostileMissionVisibilityContext(address viewer, uint256 missionId)
        external
        view
        returns (
            uint256 defenderAllianceId,
            bool viewerInDefenderAlliance,
            bool publicRevealWindow,
            bool canSeeForDefense
        )
    {
        (
            VeydriftGameStorage.FleetMissionStatus status,
            VeydriftGameStorage.FleetMissionType missionType,,,
            uint256 targetPlanetId,,
            uint64 arrivalAt,,,,
        ) = game.fleetMission(missionId);
        if (
            status != VeydriftGameStorage.FleetMissionStatus.Outbound
                || !_isHostileMission(missionType)
        ) {
            return (0, false, false, false);
        }

        VeydriftGameStorage.Planet memory target = game.planet(targetPlanetId);
        defenderAllianceId = _memberships[target.owner].allianceId;
        viewerInDefenderAlliance =
            defenderAllianceId != 0 && defenderAllianceId == _memberships[viewer].allianceId;
        publicRevealWindow =
            VeydriftAntiRaidPrimitives.shouldRevealHostileMission(block.timestamp, arrivalAt);
        canSeeForDefense = viewerInDefenderAlliance || publicRevealWindow;
    }

    function _addMember(uint256 allianceId, address player, AllianceRole role) private {
        game.settleAllianceMembershipBoundary(player);
        _memberships[player] = Membership({allianceId: allianceId, role: role, joinedAt: _now()});
        _memberIndexes[allianceId][player] = _memberLists[allianceId].length + 1;
        _memberLists[allianceId].push(player);
        _alliances[allianceId].memberCount += 1;
        emit AllianceJoined(allianceId, player, role);
    }

    function _importMember(uint256 allianceId, address player, AllianceRole role, uint64 joinedAt)
        private
    {
        _memberships[player] = Membership({allianceId: allianceId, role: role, joinedAt: joinedAt});
        _memberIndexes[allianceId][player] = _memberLists[allianceId].length + 1;
        _memberLists[allianceId].push(player);
        _alliances[allianceId].memberCount += 1;
        emit AllianceJoined(allianceId, player, role);
    }

    function _kickMember(uint256 allianceId, Membership memory kicker, address player) private {
        Membership memory kicked = _memberships[player];
        if (kicked.allianceId != allianceId) revert NotAllianceMember(player, allianceId);
        if (
            kicked.role == AllianceRole.Owner
                || (kicker.role == AllianceRole.Officer && kicked.role != AllianceRole.Member)
        ) {
            revert NotAuthorized(msg.sender, allianceId);
        }

        _removeMember(allianceId, player);
    }

    function _removeMember(uint256 allianceId, address player) private {
        uint256 indexPlusOne = _memberIndexes[allianceId][player];
        if (indexPlusOne == 0) revert NotAllianceMember(player, allianceId);

        game.settleAllianceMembershipBoundary(player);

        uint256 index = indexPlusOne - 1;
        address[] storage members = _memberLists[allianceId];
        address last = members[members.length - 1];
        members[index] = last;
        _memberIndexes[allianceId][last] = index + 1;
        members.pop();

        delete _memberIndexes[allianceId][player];
        delete _memberships[player];
        _alliances[allianceId].memberCount -= 1;
        emit AllianceLeft(allianceId, player);
    }

    function _removeJoinRequest(uint256 allianceId, address player) private {
        uint256 indexPlusOne = _joinRequestIndexes[allianceId][player];
        if (indexPlusOne == 0) revert InvalidJoinRequest(player, allianceId);

        uint256 index = indexPlusOne - 1;
        address[] storage requesters = _joinRequestLists[allianceId];
        address last = requesters[requesters.length - 1];
        requesters[index] = last;
        _joinRequestIndexes[allianceId][last] = index + 1;
        requesters.pop();

        delete _joinRequestIndexes[allianceId][player];
        delete _joinRequests[allianceId][player];
    }

    function _requireAlliance(uint256 allianceId) private view returns (Alliance storage alliance) {
        alliance = _alliances[allianceId];
        if (!alliance.active) revert AllianceInactive(allianceId);
    }

    function _requireOfficer(uint256 allianceId, address player) private view {
        _requireAlliance(allianceId);
        Membership memory membership = _memberships[player];
        if (
            membership.allianceId != allianceId
                || (membership.role != AllianceRole.Officer
                    && membership.role != AllianceRole.Owner)
        ) {
            revert NotAuthorized(player, allianceId);
        }
    }

    function _requireOwner(uint256 allianceId, address player) private view {
        _requireAlliance(allianceId);
        Membership memory membership = _memberships[player];
        if (membership.allianceId != allianceId || membership.role != AllianceRole.Owner) {
            revert NotAuthorized(player, allianceId);
        }
    }

    function _requireSettledPlayer(address player) private view {
        if (game.homePlanetOf(player) == 0) revert NoPlanet(player);
    }

    function _requireProfile(string calldata tag, string calldata name) private pure {
        if (bytes(tag).length == 0 || bytes(name).length == 0) revert EmptyAllianceProfile();
    }

    function _relationship(uint256 allianceId, uint256 otherAllianceId)
        private
        view
        returns (DiplomacyStatus)
    {
        if (allianceId == 0 || otherAllianceId == 0 || allianceId == otherAllianceId) {
            return DiplomacyStatus.None;
        }
        DiplomacyStatus directStatus = _diplomacy[allianceId][otherAllianceId];
        if (directStatus == DiplomacyStatus.War) return DiplomacyStatus.War;
        DiplomacyStatus reciprocalStatus = _diplomacy[otherAllianceId][allianceId];
        if (reciprocalStatus == DiplomacyStatus.War) return DiplomacyStatus.War;
        return directStatus;
    }

    function _clearDiplomacyPair(uint256 allianceId, uint256 otherAllianceId) private {
        delete _diplomacy[allianceId][otherAllianceId];
        delete _diplomacy[otherAllianceId][allianceId];
        delete _warStartedAts[allianceId][otherAllianceId];
        delete _warStartedAts[otherAllianceId][allianceId];
        delete _warDeclarers[allianceId][otherAllianceId];
        delete _warDeclarers[otherAllianceId][allianceId];
    }

    function _setWarMetadata(
        uint256 allianceId,
        uint256 otherAllianceId,
        uint256 declarerAllianceId,
        uint64 declaredAt
    ) private {
        uint256 targetAllianceId = declarerAllianceId == allianceId ? otherAllianceId : allianceId;
        _warStartedAts[declarerAllianceId][targetAllianceId] = declaredAt;
        _warDeclarers[allianceId][otherAllianceId] = declarerAllianceId;
        _warDeclarers[otherAllianceId][allianceId] = declarerAllianceId;
    }

    function _warDeclarer(uint256 allianceId, uint256 otherAllianceId)
        private
        view
        returns (uint256)
    {
        uint256 recorded = _warDeclarers[allianceId][otherAllianceId];
        if (recorded != 0) return recorded;

        bool directWar = _diplomacy[allianceId][otherAllianceId] == DiplomacyStatus.War;
        bool reciprocalWar = _diplomacy[otherAllianceId][allianceId] == DiplomacyStatus.War;
        if (directWar && !reciprocalWar) return allianceId;
        if (reciprocalWar && !directWar) return otherAllianceId;

        uint64 directStartedAt = _warStartedAts[allianceId][otherAllianceId];
        uint64 reciprocalStartedAt = _warStartedAts[otherAllianceId][allianceId];
        if (directStartedAt != 0 && reciprocalStartedAt == 0) return allianceId;
        if (reciprocalStartedAt != 0 && directStartedAt == 0) return otherAllianceId;
        return 0;
    }

    function _warStart(uint256 allianceId, uint256 otherAllianceId) private view returns (uint64) {
        uint64 directStartedAt = _warStartedAts[allianceId][otherAllianceId];
        uint64 reciprocalStartedAt = _warStartedAts[otherAllianceId][allianceId];
        if (directStartedAt != 0 && reciprocalStartedAt != 0) {
            return directStartedAt < reciprocalStartedAt ? directStartedAt : reciprocalStartedAt;
        }
        if (directStartedAt != 0) return directStartedAt;
        if (reciprocalStartedAt != 0) return reciprocalStartedAt;
        return warMinimumDurationActivatedAt;
    }

    function _isHostileMission(VeydriftGameStorage.FleetMissionType missionType)
        private
        pure
        returns (bool)
    {
        return missionType == VeydriftGameStorage.FleetMissionType.Attack
            || missionType == VeydriftGameStorage.FleetMissionType.Intercept
            || missionType == VeydriftGameStorage.FleetMissionType.MissileAttack;
    }

    function _now() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _initializeAllianceSystem(IVeydriftAllianceGame gameContract, address initialOwner)
        private
    {
        if (address(gameContract) == address(0) || initialOwner == address(0)) {
            revert ZeroAddress();
        }
        game = gameContract;
        owner = initialOwner;
        nextAllianceId = 1;
        nextDefenseIntentId = 1;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
