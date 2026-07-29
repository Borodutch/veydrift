// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @notice Veydrift randomness oracle for MVP/testnet game flows.
/// @dev The default mode requires the configured Veydrift oracle account to commit to a
///      random word before a request exists, then reveal that exact word during fulfillment.
///      This does not remove oracle liveness/censorship trust, but it prevents arbitrary
///      post-request word selection when precommit enforcement is enabled.
contract RandomnessEngine is OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    bytes32 private constant RANDOMNESS_COMMITMENT_DOMAIN =
        keccak256("veydrift.randomness-commitment.v1");
    uint256 public constant MAX_COMMITMENT_INVENTORY = 16;
    /// @notice Maximum time a lost precommit can block the game before owner recovery is allowed.
    /// @dev Recovery remains expected-value guarded, owner-only, and subject to a one-block reveal
    ///      delay; the shorter window limits player-facing mission lockups.
    uint256 public constant STALE_REQUEST_RECOVERY_DELAY = 1 hours;

    struct Request {
        address requester;
        bytes32 purposeHash;
        bytes32 randomnessCommitment;
        uint64 createdAt;
        uint64 fulfilledAt;
        uint256 randomWord;
    }

    uint256 public nextRequestId = 1;
    address public fulfiller;
    bool public precommitRequired = true;
    bytes32 public pendingCommitment;
    uint64 public pendingCommitmentBlock;

    mapping(address requester => bool authorized) public authorizedRequesters;
    mapping(uint256 requestId => Request request) private _requests;

    // Appended for UUPS storage compatibility. `pendingCommitment` stays the FIFO front so an
    // upgrade preserves the commitment that was already live on the proxy.
    mapping(uint256 index => bytes32 commitment) private _queuedCommitments;
    mapping(uint256 index => uint64 committedAtBlock) private _queuedCommitmentBlocks;
    uint256 private _queuedCommitmentHead;
    uint256 private _queuedCommitmentTail;
    mapping(uint256 requestId => uint64 committedAtBlock) private _recoveryCommitmentBlocks;

    error UnauthorizedRequester(address requester);
    error UnauthorizedFulfiller(address account);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error PendingRandomness(uint256 requestId);
    error PurposeMismatch(bytes32 expected, bytes32 actual);
    error NoRandomnessCommitment();
    error RandomnessCommitmentAlreadyPending(bytes32 commitment);
    error RandomnessCommitmentInventoryFull(uint256 maximum);
    error RandomnessCommitmentNotActive(bytes32 commitment, uint64 committedAtBlock);
    error RandomnessCommitmentMismatch(bytes32 expected, bytes32 actual);
    error UnexpectedRandomnessCommitment(bytes32 expected, bytes32 actual);
    error RandomnessRequestNotStale(uint256 requestId, uint256 recoverableAt);
    error RandomnessRecoveryAlreadyScheduled(uint256 requestId);
    error ZeroAddress();
    error ZeroRandomnessCommitment();
    error ZeroPurpose();
    error ZeroRandomWord();

    event RequesterAuthorizationUpdated(address indexed requester, bool authorized);
    event FulfillerUpdated(address indexed oldFulfiller, address indexed newFulfiller);
    event PrecommitRequirementUpdated(bool required);
    event RandomnessCommitted(
        address indexed fulfiller, bytes32 indexed commitment, uint64 committedAtBlock
    );
    event RandomnessRequested(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed purposeHash,
        uint64 createdAt
    );
    event RandomnessFulfilled(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed purposeHash,
        uint64 fulfilledAt,
        uint256 randomWord
    );
    event StaleRandomnessRequestRecovered(
        uint256 indexed requestId,
        bytes32 indexed oldCommitment,
        bytes32 indexed replacementCommitment,
        uint64 committedAtBlock
    );

    constructor(address initialOwner, address initialFulfiller) {
        initialize(initialOwner, initialFulfiller);
        _disableInitializers();
    }

    function initialize(address initialOwner, address initialFulfiller) public initializer {
        if (initialOwner == address(0) || initialFulfiller == address(0)) revert ZeroAddress();
        __Ownable_init(initialOwner);
        __Pausable_init();
        nextRequestId = 1;
        precommitRequired = true;
        fulfiller = initialFulfiller;
        emit FulfillerUpdated(address(0), initialFulfiller);
    }

    modifier onlyAuthorizedRequester() {
        if (!authorizedRequesters[msg.sender]) revert UnauthorizedRequester(msg.sender);
        _;
    }

    modifier onlyFulfiller() {
        if (msg.sender != fulfiller) revert UnauthorizedFulfiller(msg.sender);
        _;
    }

    function setRequesterAuthorization(address requester, bool authorized) external onlyOwner {
        if (requester == address(0)) revert ZeroAddress();
        authorizedRequesters[requester] = authorized;
        emit RequesterAuthorizationUpdated(requester, authorized);
    }

    function setFulfiller(address nextFulfiller) external onlyOwner {
        if (nextFulfiller == address(0)) revert ZeroAddress();
        address oldFulfiller = fulfiller;
        fulfiller = nextFulfiller;
        emit FulfillerUpdated(oldFulfiller, nextFulfiller);
    }

    function setPrecommitRequired(bool required) external onlyOwner {
        precommitRequired = required;
        emit PrecommitRequirementUpdated(required);
    }

    function commitRandomness(bytes32 commitment) external whenNotPaused onlyFulfiller {
        _commitRandomness(commitment);
    }

    /// @notice Atomically fill future request slots so bursty attacks do not drain randomness
    ///         between backend polling cycles.
    function commitRandomnessBatch(bytes32[] calldata commitments)
        external
        whenNotPaused
        onlyFulfiller
    {
        for (uint256 i; i < commitments.length; ++i) {
            _commitRandomness(commitments[i]);
        }
    }

    function randomnessCommitmentInventory()
        external
        view
        returns (
            bytes32[] memory commitments,
            uint64[] memory committedAtBlocks,
            uint256 readyCount
        )
    {
        uint256 count = commitmentInventoryCount();
        commitments = new bytes32[](count);
        committedAtBlocks = new uint64[](count);
        if (count == 0) return (commitments, committedAtBlocks, 0);

        commitments[0] = pendingCommitment;
        committedAtBlocks[0] = pendingCommitmentBlock;
        if (block.number > pendingCommitmentBlock) ++readyCount;

        uint256 outputIndex = 1;
        for (uint256 index = _queuedCommitmentHead; index < _queuedCommitmentTail; ++index) {
            commitments[outputIndex] = _queuedCommitments[index];
            uint64 committedAtBlock = _queuedCommitmentBlocks[index];
            committedAtBlocks[outputIndex] = committedAtBlock;
            if (block.number > committedAtBlock) ++readyCount;
            ++outputIndex;
        }
    }

    function commitmentInventoryCount() public view returns (uint256) {
        if (pendingCommitment == bytes32(0)) return 0;
        return 1 + (_queuedCommitmentTail - _queuedCommitmentHead);
    }

    function readyCommitmentCount() external view returns (uint256 readyCount) {
        if (pendingCommitment == bytes32(0)) return 0;
        if (block.number > pendingCommitmentBlock) ++readyCount;
        for (uint256 index = _queuedCommitmentHead; index < _queuedCommitmentTail; ++index) {
            if (block.number > _queuedCommitmentBlocks[index]) ++readyCount;
        }
    }

    function _commitRandomness(bytes32 commitment) private {
        if (commitment == bytes32(0)) revert ZeroRandomnessCommitment();
        if (_containsCommitment(commitment)) {
            revert RandomnessCommitmentAlreadyPending(commitment);
        }
        if (commitmentInventoryCount() >= MAX_COMMITMENT_INVENTORY) {
            revert RandomnessCommitmentInventoryFull(MAX_COMMITMENT_INVENTORY);
        }

        uint64 committedAtBlock = uint64(block.number);
        if (pendingCommitment == bytes32(0)) {
            pendingCommitment = commitment;
            pendingCommitmentBlock = committedAtBlock;
        } else {
            _queuedCommitments[_queuedCommitmentTail] = commitment;
            _queuedCommitmentBlocks[_queuedCommitmentTail] = committedAtBlock;
            ++_queuedCommitmentTail;
        }
        emit RandomnessCommitted(msg.sender, commitment, committedAtBlock);
    }

    function _containsCommitment(bytes32 commitment) private view returns (bool) {
        if (pendingCommitment == commitment) return true;
        for (uint256 index = _queuedCommitmentHead; index < _queuedCommitmentTail; ++index) {
            if (_queuedCommitments[index] == commitment) return true;
        }
        return false;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function requestRandomness(bytes32 purposeHash)
        external
        whenNotPaused
        onlyAuthorizedRequester
        returns (uint256 requestId)
    {
        if (purposeHash == bytes32(0)) revert ZeroPurpose();

        bytes32 commitment = _consumeRandomnessCommitment();
        requestId = nextRequestId++;
        _requests[requestId] = Request({
            requester: msg.sender,
            purposeHash: purposeHash,
            randomnessCommitment: commitment,
            createdAt: uint64(block.timestamp),
            fulfilledAt: 0,
            randomWord: 0
        });

        emit RandomnessRequested(requestId, msg.sender, purposeHash, uint64(block.timestamp));
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord)
        external
        whenNotPaused
        onlyFulfiller
    {
        if (randomWord == 0) revert ZeroRandomWord();
        Request storage stored = _requests[requestId];
        if (stored.requester == address(0)) revert UnknownRequest(requestId);
        if (stored.fulfilledAt != 0) revert AlreadyFulfilled(requestId);
        uint64 recoveryCommitmentBlock = _recoveryCommitmentBlocks[requestId];
        if (recoveryCommitmentBlock != 0 && block.number <= recoveryCommitmentBlock) {
            revert RandomnessCommitmentNotActive(
                stored.randomnessCommitment, recoveryCommitmentBlock
            );
        }
        if (stored.randomnessCommitment != bytes32(0)) {
            bytes32 actualCommitment = randomnessCommitment(randomWord);
            if (actualCommitment != stored.randomnessCommitment) {
                revert RandomnessCommitmentMismatch(stored.randomnessCommitment, actualCommitment);
            }
        }

        stored.fulfilledAt = uint64(block.timestamp);
        stored.randomWord = randomWord;
        if (recoveryCommitmentBlock != 0) delete _recoveryCommitmentBlocks[requestId];

        emit RandomnessFulfilled(
            requestId, stored.requester, stored.purposeHash, uint64(block.timestamp), randomWord
        );
    }

    /// @notice Re-precommit a reveal for an irrecoverably lost, stale request secret.
    /// @dev This is deliberately owner-only, delayed, expected-value guarded, and requires the
    ///      replacement to remain on-chain for at least one block before the fulfiller may reveal it.
    function recoverStaleRequestCommitment(
        uint256 requestId,
        bytes32 expectedCommitment,
        bytes32 replacementCommitment
    ) external onlyOwner {
        if (replacementCommitment == bytes32(0)) {
            revert ZeroRandomnessCommitment();
        }

        Request storage stored = _requests[requestId];
        if (stored.requester == address(0)) revert UnknownRequest(requestId);
        if (stored.fulfilledAt != 0) revert AlreadyFulfilled(requestId);
        if (_recoveryCommitmentBlocks[requestId] != 0) {
            revert RandomnessRecoveryAlreadyScheduled(requestId);
        }
        if (stored.randomnessCommitment != expectedCommitment) {
            revert UnexpectedRandomnessCommitment(expectedCommitment, stored.randomnessCommitment);
        }

        uint256 recoverableAt = uint256(stored.createdAt) + STALE_REQUEST_RECOVERY_DELAY;
        // This timestamp is intentionally a one-hour liveness delay; validator skew cannot
        // bypass the expected-commitment, owner, unfulfilled, or one-block reveal guards.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < recoverableAt) {
            revert RandomnessRequestNotStale(requestId, recoverableAt);
        }

        stored.randomnessCommitment = replacementCommitment;
        _recoveryCommitmentBlocks[requestId] = uint64(block.number);
        emit StaleRandomnessRequestRecovered(
            requestId, expectedCommitment, replacementCommitment, uint64(block.number)
        );
    }

    function request(uint256 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    function isFulfilled(uint256 requestId) public view returns (bool) {
        return _requests[requestId].fulfilledAt != 0;
    }

    function randomnessCommitment(uint256 randomWord) public view returns (bytes32) {
        if (randomWord == 0) revert ZeroRandomWord();
        return keccak256(
            abi.encode(RANDOMNESS_COMMITMENT_DOMAIN, block.chainid, address(this), randomWord)
        );
    }

    /// @notice Read a fulfilled random word for a specific requester and purpose.
    /// @dev Consumers call this during resolution. It reverts while pending, so downtime blocks
    ///      randomness-dependent resolution instead of falling back to unsafe entropy.
    function consumeRandomness(uint256 requestId, bytes32 purposeHash)
        external
        view
        returns (uint256 randomWord)
    {
        Request memory stored = _requests[requestId];
        if (stored.requester == address(0)) revert UnknownRequest(requestId);
        if (stored.requester != msg.sender) revert UnauthorizedRequester(msg.sender);
        if (stored.purposeHash != purposeHash) {
            revert PurposeMismatch(stored.purposeHash, purposeHash);
        }
        if (stored.fulfilledAt == 0) revert PendingRandomness(requestId);

        return stored.randomWord;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _consumeRandomnessCommitment() private returns (bytes32 commitment) {
        if (!precommitRequired) return bytes32(0);

        commitment = pendingCommitment;
        if (commitment == bytes32(0)) revert NoRandomnessCommitment();
        if (block.number <= pendingCommitmentBlock) {
            revert RandomnessCommitmentNotActive(commitment, pendingCommitmentBlock);
        }

        if (_queuedCommitmentHead < _queuedCommitmentTail) {
            pendingCommitment = _queuedCommitments[_queuedCommitmentHead];
            pendingCommitmentBlock = _queuedCommitmentBlocks[_queuedCommitmentHead];
            delete _queuedCommitments[_queuedCommitmentHead];
            delete _queuedCommitmentBlocks[_queuedCommitmentHead];
            ++_queuedCommitmentHead;
        } else {
            delete pendingCommitment;
            delete pendingCommitmentBlock;
        }
    }
}
