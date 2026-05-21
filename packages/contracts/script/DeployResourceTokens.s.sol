// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";

contract DeployResourceTokens is ResourceTokenDeployment {
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
        (metalToken, crystalToken, deuteriumToken) = _deployResourceTokens(admin, gameAddress);
        emit VeydriftResourceTokensDeployed(gameAddress, metalToken, crystalToken, deuteriumToken);
        vm.stopBroadcast();
    }
}
