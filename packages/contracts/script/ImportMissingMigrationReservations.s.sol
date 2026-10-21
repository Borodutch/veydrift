// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

interface IMigrationReservationSettlement {
    function owner() external view returns (address);
    function game() external view returns (address);
    function migrationReservation(address player)
        external
        view
        returns (bool, bool, uint16, uint16, uint8, uint16, int16);
    function importReservations(
        address[] calldata players,
        uint16[] calldata galaxies,
        uint16[] calldata systems,
        uint8[] calldata positions,
        uint16[] calldata fields,
        int16[] calldata temperatures
    ) external;
}

interface IMigrationReservationGame {
    function homePlanetOf(address player) external view returns (uint256);
    function isCoordinateAvailable(uint16 galaxy, uint16 system, uint8 position)
        external
        view
        returns (bool);
}

/// @notice One owner transaction that registers the claim reservations the live migration snapshot
///         serves but Base never got (#155): the snapshot's late entries, planet ids 579 and 581-584.
///         Without a reservation their signed claims revert `MigrationReservationMissing`.
///
///      Required env:
///        PRIVATE_KEY               MigrationSettlement owner
///        UPGRADE_DRY_RUN_OWNER     optional PUBLIC owner for a signer-free plan; when set,
///                                  PRIVATE_KEY is never read
///        GAME_PROXY_ADDRESS        Veydrift Game proxy
///        MIGRATION_PROXY_ADDRESS   optional; defaults to the Base MigrationSettlement proxy
contract ImportMissingMigrationReservations is Script {
    address internal constant BASE_MIGRATION_SETTLEMENT =
        0x33A56B6f6354D32Edeef43baECC3C94a316bf7d3;

    struct Row {
        address player;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        /// Coordinates already reserved on their own by #151 L4 (tx 0xddfcd700...38b5bc).
        bool coordinatesReserved;
    }

    /// Reservations exactly as the live snapshot file lists them (`reservedPlanets[0]`).
    function rows() public pure returns (Row[] memory list) {
        list = new Row[](5);
        list[0] = Row(0x5a256958b7E6c98410B99d6FA1670A9aBcE58733, 6, 135, 10, 217, -59, false); // 579
        list[1] = Row(0x967d3Fc0D3A6587224a0a5dD35a156D5B711b984, 2, 466, 4, 162, 22, true); // 581
        list[2] = Row(0x38847ED47aD69D227989660eCE6994EE3E10c4D8, 8, 260, 2, 211, 59, false); // 582
        list[3] = Row(0x76a1d22519DdA869b70d86992b69a5E635869a4C, 2, 31, 8, 180, -17, false); // 583
        list[4] = Row(0x073b0B1f5D0e5b30f6a067F25Ad33BD6C21b0F62, 8, 293, 12, 174, -72, false); // 584
    }

    function run() external {
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        IMigrationReservationSettlement settlement = IMigrationReservationSettlement(
            vm.envOr("MIGRATION_PROXY_ADDRESS", BASE_MIGRATION_SETTLEMENT)
        );
        IMigrationReservationGame game =
            IMigrationReservationGame(vm.envAddress("GAME_PROXY_ADDRESS"));
        require(settlement.game() == address(game), "SETTLEMENT_GAME_MISMATCH");
        require(settlement.owner() == broadcaster, "BROADCASTER_NOT_SETTLEMENT_OWNER");

        Row[] memory list = rows();
        uint256 count = list.length;
        address[] memory players = new address[](count);
        uint16[] memory galaxies = new uint16[](count);
        uint16[] memory systems = new uint16[](count);
        uint8[] memory positions = new uint8[](count);
        uint16[] memory fields = new uint16[](count);
        int16[] memory temperatures = new int16[](count);
        for (uint256 i = 0; i < count; i++) {
            Row memory row = list[i];
            (bool exists,,,,,,) = settlement.migrationReservation(row.player);
            require(!exists, "RESERVATION_ALREADY_EXISTS");
            require(game.homePlanetOf(row.player) == 0, "PLAYER_ALREADY_HAS_A_PLANET");
            // The Game marks reserved coordinates without checking them, so a planet settled there
            // since the snapshot would end up sharing them with the import.
            require(
                game.isCoordinateAvailable(row.galaxy, row.system, row.position)
                    != row.coordinatesReserved,
                "COORDINATE_STATE_CHANGED"
            );
            players[i] = row.player;
            galaxies[i] = row.galaxy;
            systems[i] = row.system;
            positions[i] = row.position;
            fields[i] = row.fields;
            temperatures[i] = row.temperature;
        }

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        settlement.importReservations(players, galaxies, systems, positions, fields, temperatures);
        vm.stopBroadcast();

        for (uint256 i = 0; i < count; i++) {
            (bool exists, bool claimed, uint16 galaxy, uint16 system, uint8 position,,) =
                settlement.migrationReservation(players[i]);
            require(
                exists && !claimed && galaxy == galaxies[i] && system == systems[i]
                    && position == positions[i],
                "RESERVATION_NOT_APPLIED"
            );
            require(
                !game.isCoordinateAvailable(galaxy, system, position), "COORDINATE_NOT_RESERVED"
            );
        }
        console2.log("Migration reservations imported:", count);
    }
}
