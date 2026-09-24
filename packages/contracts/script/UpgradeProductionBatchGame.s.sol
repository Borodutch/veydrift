// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";

/// @notice Minimal Game upgrade for VEY-897: reuse independently verified existing modules.
/// @dev Operator MUST verify eight module addresses/code hashes against the LIVE implementation
///      immutables and independently check the Moon proxy before execution. No initializer or storage writes to the proxy are performed.
contract UpgradeProductionBatchGame is Script {
    function run() external returns (address implementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address signer = vm.addr(privateKey);
        address proxy = vm.envAddress("GAME_PROXY_ADDRESS");
        address admin = vm.envAddress("GAME_PROXY_ADMIN");
        address[9] memory modules = [
            vm.envAddress("LIVE_FIRST_PLANET_SETTLEMENT_MODULE"),
            vm.envAddress("LIVE_GAMEPLAY_MODULE"),
            vm.envAddress("LIVE_PLANET_MANAGEMENT_MODULE"),
            vm.envAddress("LIVE_ATTACK_PROTECTION_MODULE"),
            vm.envAddress("LIVE_COLONIZATION_MODULE"),
            vm.envAddress("LIVE_DEFENSE_HOLD_MODULE"),
            vm.envAddress("LIVE_STATE_MIGRATION_MODULE"),
            vm.envAddress("LIVE_ACS_ATTACK_MODULE"),
            vm.envAddress("MOON_PROXY_ADDRESS")
        ];
        require(ProxyAdmin(admin).owner() == signer, "PROXY_ADMIN_OWNER_MISMATCH");
        require(VeydriftGame(payable(proxy)).owner() == signer, "GAME_OWNER_MISMATCH");
        VeydriftLiveUpgradePolicy.requireGameUpgradeReady(proxy);
        for (uint256 i; i < modules.length; ++i) {
            require(modules[i].code.length > 0, "MISSING_MODULE_CODE");
        }
        (bool moonOk, bytes memory moonGame) =
            modules[8].staticcall(abi.encodeWithSignature("game()"));
        require(
            moonOk && moonGame.length == 32 && abi.decode(moonGame, (address)) == proxy,
            "MOON_GAME_MISMATCH"
        );

        vm.startBroadcast(privateKey);
        implementation = address(
            new VeydriftGame(
                signer,
                modules[0],
                modules[1],
                modules[2],
                modules[3],
                modules[4],
                modules[5],
                modules[6],
                modules[7]
            )
        );
        ProxyAdmin(admin)
            .upgradeAndCall(ITransparentUpgradeableProxy(proxy), implementation, bytes(""));
        vm.stopBroadcast();
        console2.log("Game proxy:", proxy);
        console2.log("Production-batch Game implementation:", implementation);
    }
}
