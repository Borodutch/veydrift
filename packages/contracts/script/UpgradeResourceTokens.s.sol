// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftCrystal,
    VeydriftDeuterium,
    VeydriftMetal,
    VeydriftResourceToken
} from "../src/VeydriftResourceToken.sol";

/// @notice Upgrades the three live UUPS resource proxies to no-mint implementations.
/// @dev Dry-run before broadcast and use only after storage-layout, owner, and fork checks pass.
contract UpgradeResourceTokens is Script {
    function run()
        external
        returns (
            address metalImplementation,
            address crystalImplementation,
            address deutImplementation
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        VeydriftResourceToken metal =
            VeydriftResourceToken(vm.envAddress("VEYDRIFT_METAL_TOKEN_ADDRESS"));
        VeydriftResourceToken crystal =
            VeydriftResourceToken(vm.envAddress("VEYDRIFT_CRYSTAL_TOKEN_ADDRESS"));
        VeydriftResourceToken deuterium =
            VeydriftResourceToken(vm.envAddress("VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS"));
        require(metal.owner() == broadcaster, "METAL_OWNER_MISMATCH");
        require(crystal.owner() == broadcaster, "CRYSTAL_OWNER_MISMATCH");
        require(deuterium.owner() == broadcaster, "DEUT_OWNER_MISMATCH");

        uint256 metalSupply = metal.totalSupply();
        uint256 crystalSupply = crystal.totalSupply();
        uint256 deutSupply = deuterium.totalSupply();
        require(metalSupply == metal.INITIAL_SUPPLY(), "METAL_SUPPLY_DRIFT");
        require(crystalSupply == crystal.INITIAL_SUPPLY(), "CRYSTAL_SUPPLY_DRIFT");
        require(deutSupply == deuterium.INITIAL_SUPPLY(), "DEUT_SUPPLY_DRIFT");

        vm.startBroadcast(privateKey);
        metalImplementation = address(new VeydriftMetal());
        crystalImplementation = address(new VeydriftCrystal());
        deutImplementation = address(new VeydriftDeuterium());
        metal.upgradeToAndCall(metalImplementation, "");
        crystal.upgradeToAndCall(crystalImplementation, "");
        deuterium.upgradeToAndCall(deutImplementation, "");
        vm.stopBroadcast();

        require(metal.totalSupply() == metalSupply, "METAL_SUPPLY_CHANGED");
        require(crystal.totalSupply() == crystalSupply, "CRYSTAL_SUPPLY_CHANGED");
        require(deuterium.totalSupply() == deutSupply, "DEUT_SUPPLY_CHANGED");
        console2.log("Metal implementation:    ", metalImplementation);
        console2.log("Crystal implementation:  ", crystalImplementation);
        console2.log("Deuterium implementation:", deutImplementation);
    }
}
