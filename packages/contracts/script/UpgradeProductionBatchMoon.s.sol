// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftMoonSystem,
    IVeydriftMoonGame,
    IVeydriftRandomnessEngine
} from "../src/VeydriftMoonSystem.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";

/// @notice VEY-897 MoonSystem upgrade only AFTER the Game cutoff hook is live and verified.
/// @dev Forge deploys linked libraries when constructing the implementation; capture/verify all
///      linked addresses and code hashes before sending the UUPS upgrade transaction.
contract UpgradeProductionBatchMoon is Script {
    function run() external returns (address implementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address signer = vm.addr(privateKey);
        address payable proxy = payable(vm.envAddress("MOON_PROXY_ADDRESS"));
        VeydriftMoonSystem moon = VeydriftMoonSystem(proxy);
        IVeydriftMoonGame game = moon.game();
        IVeydriftRandomnessEngine randomness = moon.randomness();
        require(moon.owner() == signer, "MOON_OWNER_MISMATCH");
        require(
            address(game).code.length > 0 && address(randomness).code.length > 0,
            "MISSING_DEPENDENCY"
        );
        VeydriftLiveUpgradePolicy.requireMoonUpgradeReady(address(game));
        require(game.moonShipProductionVersion() == 1, "GAME_CUTOFF_NOT_UPGRADED");

        vm.startBroadcast(privateKey);
        implementation = address(new VeydriftMoonSystem(address(game), address(randomness)));
        moon.upgradeToAndCall(implementation, "");
        vm.stopBroadcast();
        console2.log("Moon proxy:", proxy);
        console2.log("Production-batch Moon implementation:", implementation);
    }
}
