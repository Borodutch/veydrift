// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Centralized Veydrift randomness oracle for MVP/testnet game flows.
/// @dev This is explicitly not trustless randomness. A configured Veydrift oracle account
///      fulfills requests with server-generated entropy. Consumers must block resolution while
///      a request is pending and bind each consumption to the original purpose hash.
contract RandomnessEngine is Ownable, Pausable {
    struct Request {
        address requester;
        bytes32 purposeHash;
        uint64 createdAt;
        uint64 fulfilledAt;
        uint256 randomWord;
    }

    uint256 public nextRequestId = 1;
    address public fulfiller;

    mapping(address requester => bool authorized) public authorizedRequesters;
    mapping(uint256 requestId => Request request) private _requests;

    error UnauthorizedRequester(address requester);
    error UnauthorizedFulfiller(address account);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error PendingRandomness(uint256 requestId);
    error PurposeMismatch(bytes32 expected, bytes32 actual);
    error ZeroAddress();
    error ZeroPurpose();
    error ZeroRandomWord();

    event RequesterAuthorizationUpdated(address indexed requester, bool authorized);
    event FulfillerUpdated(address indexed oldFulfiller, address indexed newFulfiller);
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

    constructor(address initialOwner, address initialFulfiller) Ownable(initialOwner) {
        if (initialOwner == address(0) || initialFulfiller == address(0)) revert ZeroAddress();
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

        requestId = nextRequestId++;
        _requests[requestId] = Request({
            requester: msg.sender,
            purposeHash: purposeHash,
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
}
