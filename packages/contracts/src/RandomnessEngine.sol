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

    struct Request {
        address requester;
        bytes32 purposeHash;
        bytes32 randomnessCommitment;
        uint64 createdAt;
        uint64 fulfilledAt;
        uint256 randomWord;
    }

    uint256 public nextRequestId;
    address public fulfiller;
    bool public precommitRequired;
    bytes32 public pendingCommitment;
    uint64 public pendingCommitmentBlock;

    mapping(address requester => bool authorized) public authorizedRequesters;
    mapping(uint256 requestId => Request request) private _requests;

    error UnauthorizedRequester(address requester);
    error UnauthorizedFulfiller(address account);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error PendingRandomness(uint256 requestId);
    error PurposeMismatch(bytes32 expected, bytes32 actual);
    error NoRandomnessCommitment();
    error RandomnessCommitmentAlreadyPending(bytes32 commitment);
    error RandomnessCommitmentNotActive(bytes32 commitment, uint64 committedAtBlock);
    error RandomnessCommitmentMismatch(bytes32 expected, bytes32 actual);
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

    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address initialFulfiller) public initializer {
        if (initialOwner == address(0) || initialFulfiller == address(0)) revert ZeroAddress();
        __Ownable_init(initialOwner);
        __Pausable_init();
        nextRequestId = 1;
        fulfiller = initialFulfiller;
        precommitRequired = true;
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
        if (commitment == bytes32(0)) revert ZeroRandomnessCommitment();
        if (pendingCommitment != bytes32(0)) {
            revert RandomnessCommitmentAlreadyPending(pendingCommitment);
        }

        pendingCommitment = commitment;
        pendingCommitmentBlock = uint64(block.number);
        emit RandomnessCommitted(msg.sender, commitment, uint64(block.number));
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
        if (stored.randomnessCommitment != bytes32(0)) {
            bytes32 actualCommitment = randomnessCommitment(randomWord);
            if (actualCommitment != stored.randomnessCommitment) {
                revert RandomnessCommitmentMismatch(stored.randomnessCommitment, actualCommitment);
            }
        }

        stored.fulfilledAt = uint64(block.timestamp);
        stored.randomWord = randomWord;

        emit RandomnessFulfilled(
            requestId, stored.requester, stored.purposeHash, uint64(block.timestamp), randomWord
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

    function _consumeRandomnessCommitment() private returns (bytes32 commitment) {
        if (!precommitRequired) return bytes32(0);

        commitment = pendingCommitment;
        if (commitment == bytes32(0)) revert NoRandomnessCommitment();
        if (block.number <= pendingCommitmentBlock) {
            revert RandomnessCommitmentNotActive(commitment, pendingCommitmentBlock);
        }

        delete pendingCommitment;
        delete pendingCommitmentBlock;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
