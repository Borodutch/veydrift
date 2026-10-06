// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../../src/VeydriftGameStorage.sol";

// Fixture-only layout introspection; never deployed in production or used as a verifier.
contract ProofFixtureSlots is G {
    constructor() G(address(1)) {}

    function slots()
        external
        pure
        returns (uint256 linked, uint256 held, uint256 until, uint256 missions)
    {
        assembly ("memory-safe") {
            linked := _fleetCounterplayMissions.slot
            held := _stationedDefenseMissions.slot
            until := _defenseHoldUntil.slot
            missions := _fleetMissions.slot
        }
    }
}
