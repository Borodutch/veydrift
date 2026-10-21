// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftResource} from "../src/VeydriftResource.sol";

/// @notice Deploys fixed-supply vMETAL, vCRYSTAL and vDEUT with the whole supply on the broadcaster
///         (the token treasury), then funds the Game's reserve so `setResourceTokens` can switch to them.
/// @dev The switch itself is the Game owner's job: SwitchGameResourceTokens.s.sol.
contract DeployVeydriftResources is Script {
    function run() external returns (address metal, address crystal, address deuterium) {
        // UPGRADE_DRY_RUN_OWNER = the treasury's address plans the deploy keylessly; never --broadcast it.
        address rehearsal = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address treasury = rehearsal;
        if (rehearsal == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            treasury = vm.addr(privateKey);
        }
        address game = vm.envAddress("VEYDRIFT_GAME_CONTRACT_ADDRESS");
        // ponytail: one fixed top-up; the treasury can transfer more to the Game whenever needed.
        uint256 reserve = vm.envUint("VEYDRIFT_GAME_RESOURCE_RESERVE");
        require(reserve > 0 && reserve <= 50_000_000_000, "BAD_RESERVE");

        if (rehearsal != address(0)) vm.startBroadcast(rehearsal);
        else vm.startBroadcast(privateKey);
        metal = address(new VeydriftResource("Veydrift Metal", "vMETAL", treasury));
        crystal = address(new VeydriftResource("Veydrift Crystal", "vCRYSTAL", treasury));
        deuterium = address(new VeydriftResource("Veydrift Deuterium", "vDEUT", treasury));
        require(VeydriftResource(metal).transfer(game, reserve), "METAL_RESERVE");
        require(VeydriftResource(crystal).transfer(game, reserve), "CRYSTAL_RESERVE");
        require(VeydriftResource(deuterium).transfer(game, reserve), "DEUT_RESERVE");
        vm.stopBroadcast();

        address[3] memory tokens = [metal, crystal, deuterium];
        for (uint256 i; i < 3; ++i) {
            VeydriftResource token = VeydriftResource(tokens[i]);
            require(token.totalSupply() == token.INITIAL_SUPPLY(), "BAD_SUPPLY");
            require(token.decimals() == 0, "BAD_DECIMALS");
            require(token.balanceOf(game) == reserve, "BAD_GAME_RESERVE");
            require(token.balanceOf(treasury) == token.INITIAL_SUPPLY() - reserve, "BAD_TREASURY");
        }
        console2.log("vMETAL:  ", metal);
        console2.log("vCRYSTAL:", crystal);
        console2.log("vDEUT:   ", deuterium);
    }
}
