// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";

contract Upgrade is Script {
    event VeydriftSystemUpgraded(
        string system, address indexed proxy, address indexed implementation
    );

    function run()
        external
        returns (
            address allianceImplementation,
            address moonImplementation,
            address randomnessImplementation
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address allianceProxy = vm.envAddress("VEYDRIFT_ALLIANCE_SYSTEM_CONTRACT_ADDRESS");
        address moonProxy = vm.envAddress("VEYDRIFT_MOON_CONTRACT_ADDRESS");
        address randomnessProxy = vm.envAddress("VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS");

        vm.startBroadcast(privateKey);

        allianceImplementation = address(new VeydriftAllianceSystem());
        VeydriftAllianceSystem(allianceProxy).upgradeToAndCall(allianceImplementation, "");
        emit VeydriftSystemUpgraded("alliance", allianceProxy, allianceImplementation);

        moonImplementation = address(new VeydriftMoonSystem());
        VeydriftMoonSystem(moonProxy).upgradeToAndCall(moonImplementation, "");
        emit VeydriftSystemUpgraded("moon", moonProxy, moonImplementation);

        randomnessImplementation = address(new RandomnessEngine());
        RandomnessEngine(randomnessProxy).upgradeToAndCall(randomnessImplementation, "");
        emit VeydriftSystemUpgraded("randomness", randomnessProxy, randomnessImplementation);

        vm.stopBroadcast();
    }
}
