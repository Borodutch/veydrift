// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IVeydriftMigrationGame {
    function reserveMigrationCoordinates(
        uint16[] calldata galaxies,
        uint16[] calldata systems,
        uint8[] calldata positions
    ) external;

    function importMigratedState(address player, bytes calldata payload) external payable;
}

contract VeydriftMigrationSettlement is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct Reservation {
        bool exists;
        bool claimed;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
    }

    IVeydriftMigrationGame public game;
    mapping(address player => Reservation reservation) public reservations;
    address public stateSigner;

    event MigrationReserved(
        address indexed player,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        int16 temperature
    );
    event MigrationStateSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FullStateMigrationClaimed(address indexed player, bytes32 indexed stateHash);
    event MigrationCoordinatesReserved(uint256 count);

    error BadReservationInput();
    error BadMigrationSignature();
    error FullStateMigrationRequired();
    error MigrationReservationMissing(address player);
    error MigrationReservationClaimed(address player);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address gameAddress) external initializer {
        if (gameAddress == address(0)) revert BadReservationInput();
        __Ownable_init(initialOwner);
        game = IVeydriftMigrationGame(gameAddress);
        stateSigner = initialOwner;
    }

    function importReservations(
        address[] calldata players,
        uint16[] calldata galaxies,
        uint16[] calldata systems,
        uint8[] calldata positions,
        uint16[] calldata fields,
        int16[] calldata temperatures
    ) external onlyOwner {
        uint256 count = players.length;
        if (
            galaxies.length != count || systems.length != count || positions.length != count
                || fields.length != count || temperatures.length != count
        ) revert BadReservationInput();

        for (uint256 i = 0; i < count; i++) {
            address player = players[i];
            if (player == address(0)) revert BadReservationInput();
            Reservation storage reservation = reservations[player];
            if (reservation.claimed) revert MigrationReservationClaimed(player);
            reservation.exists = true;
            reservation.galaxy = galaxies[i];
            reservation.system = systems[i];
            reservation.position = positions[i];
            reservation.fields = fields[i];
            reservation.temperature = temperatures[i];
            emit MigrationReserved(
                player, galaxies[i], systems[i], positions[i], fields[i], temperatures[i]
            );
        }

        game.reserveMigrationCoordinates(galaxies, systems, positions);
    }

    function reserveCoordinates(
        uint16[] calldata galaxies,
        uint16[] calldata systems,
        uint8[] calldata positions
    ) external onlyOwner {
        uint256 count = galaxies.length;
        if (systems.length != count || positions.length != count) revert BadReservationInput();
        game.reserveMigrationCoordinates(galaxies, systems, positions);
        emit MigrationCoordinatesReserved(count);
    }

    function setStateSigner(address nextSigner) external onlyOwner {
        if (nextSigner == address(0)) revert BadReservationInput();
        address oldSigner = stateSigner;
        stateSigner = nextSigner;
        emit MigrationStateSignerUpdated(oldSigner, nextSigner);
    }

    function claim() external payable returns (uint256) {
        revert FullStateMigrationRequired();
    }

    function claim(bytes calldata statePayload, bytes calldata signature)
        external
        payable
        returns (bytes32 stateHash)
    {
        Reservation storage reservation = reservations[msg.sender];
        if (!reservation.exists) revert MigrationReservationMissing(msg.sender);
        if (reservation.claimed) revert MigrationReservationClaimed(msg.sender);

        stateHash = migrationStateHash(msg.sender, statePayload);
        address recovered =
            ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(stateHash), signature);
        if (recovered != stateSigner) revert BadMigrationSignature();

        reservation.claimed = true;
        game.importMigratedState{value: msg.value}(msg.sender, statePayload);
        emit FullStateMigrationClaimed(msg.sender, stateHash);
    }

    function migrationStateHash(address player, bytes calldata statePayload)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), player, statePayload));
    }

    function migrationReservation(address player)
        external
        view
        returns (
            bool exists,
            bool claimed,
            uint16 galaxy,
            uint16 system,
            uint8 position,
            uint16 fields,
            int16 temperature
        )
    {
        Reservation storage reservation = reservations[player];
        return (
            reservation.exists,
            reservation.claimed,
            reservation.galaxy,
            reservation.system,
            reservation.position,
            reservation.fields,
            reservation.temperature
        );
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
