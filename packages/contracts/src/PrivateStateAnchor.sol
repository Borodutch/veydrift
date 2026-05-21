// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Commitment anchor for privacy-first Veydrift game state.
/// @dev Private resources, ships, defenses, buildings, research, and sensitive mission details
///      remain in backend/oracle preimages. This contract stores only roots, public ownership,
///      public coordinates, epochs, transition references, and randomness links.
contract PrivateStateAnchor is Ownable, Pausable {
    struct PlanetAnchor {
        address owner;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        bytes32 stateRoot;
        uint64 epoch;
        bytes32 lastTransitionHash;
        uint256 randomnessRequestId;
        uint64 updatedAt;
    }

    struct PlayerAnchor {
        bytes32 stateRoot;
        uint64 epoch;
        bytes32 lastTransitionHash;
        uint64 updatedAt;
    }

    address public oracle;

    mapping(uint256 planetId => PlanetAnchor anchor) private _planetAnchors;
    mapping(address player => PlayerAnchor anchor) private _playerAnchors;
    mapping(bytes32 transitionHash => bool used) public usedTransitions;

    error UnauthorizedOracle(address account);
    error ZeroAddress();
    error ZeroRoot();
    error ZeroTransitionHash();
    error PlanetAlreadyInitialized(uint256 planetId);
    error UnknownPlanet(uint256 planetId);
    error OwnerMismatch(address expected, address actual);
    error EpochNotIncreasing(uint64 currentEpoch, uint64 nextEpoch);
    error PreviousRootMismatch(bytes32 expected, bytes32 actual);
    error TransitionAlreadyUsed(bytes32 transitionHash);
    error RandomnessPending(uint256 requestId);

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event PlanetStateInitialized(
        uint256 indexed planetId,
        address indexed owner,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        bytes32 stateRoot,
        uint64 epoch
    );
    event PlanetStateUpdated(
        uint256 indexed planetId,
        address indexed owner,
        bytes32 previousRoot,
        bytes32 nextRoot,
        uint64 epoch,
        bytes32 transitionHash,
        uint256 randomnessRequestId
    );
    event PlayerStateUpdated(
        address indexed player,
        bytes32 previousRoot,
        bytes32 nextRoot,
        uint64 epoch,
        bytes32 transitionHash
    );

    constructor(address initialOwner, address initialOracle) Ownable(initialOwner) {
        if (initialOwner == address(0) || initialOracle == address(0)) revert ZeroAddress();
        oracle = initialOracle;
        emit OracleUpdated(address(0), initialOracle);
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert UnauthorizedOracle(msg.sender);
        _;
    }

    function setOracle(address nextOracle) external onlyOwner {
        if (nextOracle == address(0)) revert ZeroAddress();
        address oldOracle = oracle;
        oracle = nextOracle;
        emit OracleUpdated(oldOracle, nextOracle);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function initializePlanetState(
        uint256 planetId,
        address owner,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        bytes32 stateRoot,
        bytes32 transitionHash
    ) external whenNotPaused onlyOracle {
        if (owner == address(0)) revert ZeroAddress();
        _requireRootAndTransition(stateRoot, transitionHash);
        if (_planetAnchors[planetId].owner != address(0)) {
            revert PlanetAlreadyInitialized(planetId);
        }
        _markTransition(transitionHash);

        _planetAnchors[planetId] = PlanetAnchor({
            owner: owner,
            galaxy: galaxy,
            system: system,
            position: position,
            stateRoot: stateRoot,
            epoch: 1,
            lastTransitionHash: transitionHash,
            randomnessRequestId: 0,
            updatedAt: uint64(block.timestamp)
        });
        emit PlanetStateInitialized(planetId, owner, galaxy, system, position, stateRoot, 1);
    }

    function updatePlanetState(
        uint256 planetId,
        address owner,
        bytes32 previousRoot,
        bytes32 nextRoot,
        uint64 nextEpoch,
        bytes32 transitionHash,
        uint256 randomnessRequestId,
        bool randomnessFulfilled
    ) external whenNotPaused onlyOracle {
        _requireRootAndTransition(nextRoot, transitionHash);
        PlanetAnchor storage anchor = _planetAnchors[planetId];
        if (anchor.owner == address(0)) revert UnknownPlanet(planetId);
        if (anchor.owner != owner) revert OwnerMismatch(anchor.owner, owner);
        if (anchor.stateRoot != previousRoot) {
            revert PreviousRootMismatch(anchor.stateRoot, previousRoot);
        }
        if (nextEpoch <= anchor.epoch) revert EpochNotIncreasing(anchor.epoch, nextEpoch);
        if (randomnessRequestId != 0 && !randomnessFulfilled) {
            revert RandomnessPending(randomnessRequestId);
        }
        _markTransition(transitionHash);

        anchor.stateRoot = nextRoot;
        anchor.epoch = nextEpoch;
        anchor.lastTransitionHash = transitionHash;
        anchor.randomnessRequestId = randomnessRequestId;
        anchor.updatedAt = uint64(block.timestamp);

        emit PlanetStateUpdated(
            planetId, owner, previousRoot, nextRoot, nextEpoch, transitionHash, randomnessRequestId
        );
    }

    function updatePlayerState(
        address player,
        bytes32 previousRoot,
        bytes32 nextRoot,
        uint64 nextEpoch,
        bytes32 transitionHash
    ) external whenNotPaused onlyOracle {
        if (player == address(0)) revert ZeroAddress();
        _requireRootAndTransition(nextRoot, transitionHash);
        PlayerAnchor storage anchor = _playerAnchors[player];
        if (anchor.stateRoot != previousRoot) {
            revert PreviousRootMismatch(anchor.stateRoot, previousRoot);
        }
        if (nextEpoch <= anchor.epoch) revert EpochNotIncreasing(anchor.epoch, nextEpoch);
        _markTransition(transitionHash);

        anchor.stateRoot = nextRoot;
        anchor.epoch = nextEpoch;
        anchor.lastTransitionHash = transitionHash;
        anchor.updatedAt = uint64(block.timestamp);

        emit PlayerStateUpdated(player, previousRoot, nextRoot, nextEpoch, transitionHash);
    }

    function planetAnchor(uint256 planetId) external view returns (PlanetAnchor memory) {
        return _planetAnchors[planetId];
    }

    function playerAnchor(address player) external view returns (PlayerAnchor memory) {
        return _playerAnchors[player];
    }

    function _requireRootAndTransition(bytes32 root, bytes32 transitionHash) private pure {
        if (root == bytes32(0)) revert ZeroRoot();
        if (transitionHash == bytes32(0)) revert ZeroTransitionHash();
    }

    function _markTransition(bytes32 transitionHash) private {
        if (usedTransitions[transitionHash]) revert TransitionAlreadyUsed(transitionHash);
        usedTransitions[transitionHash] = true;
    }
}
