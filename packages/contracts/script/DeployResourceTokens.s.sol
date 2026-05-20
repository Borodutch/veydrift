// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftCrystal, VeydriftDeuterium, VeydriftMetal} from "../src/VeydriftResourceToken.sol";

contract DeployResourceTokens is Script {
    event ResourceTokenProxyDeployed(
        string resource, address indexed proxy, address indexed implementation
    );

    event VeydriftResourceTokensDeployed(
        address indexed game,
        address indexed metalToken,
        address indexed crystalToken,
        address deuteriumToken
    );

    function run()
        external
        returns (address metalToken, address crystalToken, address deuteriumToken)
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));
        address gameAddress = vm.envAddress("VEYDRIFT_GAME_CONTRACT_ADDRESS");

        vm.startBroadcast(privateKey);
        metalToken = _deployMetal(admin, gameAddress);
        crystalToken = _deployCrystal(admin, gameAddress);
        deuteriumToken = _deployDeuterium(admin, gameAddress);
        emit VeydriftResourceTokensDeployed(gameAddress, metalToken, crystalToken, deuteriumToken);
        vm.stopBroadcast();
    }

    function _deployMetal(address admin, address initialHolder) private returns (address token) {
        VeydriftMetal implementation = new VeydriftMetal();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftMetal.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("metal", token, address(implementation));
    }

    function _deployCrystal(address admin, address initialHolder) private returns (address token) {
        VeydriftCrystal implementation = new VeydriftCrystal();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftCrystal.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("crystal", token, address(implementation));
    }

    function _deployDeuterium(address admin, address initialHolder)
        private
        returns (address token)
    {
        VeydriftDeuterium implementation = new VeydriftDeuterium();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftDeuterium.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("deuterium", token, address(implementation));
    }
}
