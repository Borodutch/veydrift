// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

interface IVeydriftReserveGame {
    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    function owner() external view returns (address);
    function setResourceTokens(address metal, address crystal, address deuterium) external;
    function resourceToken(Resource resource) external view returns (address);
    function resourceReserveBalance(Resource resource) external view returns (uint256);
    function resourceReserveRequirement() external view returns (Resources memory);
}

/// @notice Points the live Game at the fixed-supply resource tokens from DeployVeydriftResources.
///         The Game itself reverts unless its new-token balances already cover every liability.
contract SwitchGameResourceTokens is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        IVeydriftReserveGame game =
            IVeydriftReserveGame(vm.envAddress("VEYDRIFT_GAME_CONTRACT_ADDRESS"));
        address metal = vm.envAddress("VEYDRIFT_METAL_TOKEN_ADDRESS");
        address crystal = vm.envAddress("VEYDRIFT_CRYSTAL_TOKEN_ADDRESS");
        address deuterium = vm.envAddress("VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS");
        require(game.owner() == vm.addr(privateKey), "NOT_GAME_OWNER");

        vm.startBroadcast(privateKey);
        game.setResourceTokens(metal, crystal, deuterium);
        vm.stopBroadcast();

        require(game.resourceToken(Resource.Metal) == metal, "METAL_NOT_SET");
        require(game.resourceToken(Resource.Crystal) == crystal, "CRYSTAL_NOT_SET");
        require(game.resourceToken(Resource.Deuterium) == deuterium, "DEUT_NOT_SET");
        IVeydriftReserveGame.Resources memory required = game.resourceReserveRequirement();
        console2.log(
            "metal reserve / required", game.resourceReserveBalance(Resource.Metal), required.metal
        );
        console2.log(
            "crystal reserve / required",
            game.resourceReserveBalance(Resource.Crystal),
            required.crystal
        );
        console2.log(
            "deut reserve / required",
            game.resourceReserveBalance(Resource.Deuterium),
            required.deuterium
        );
    }
}
