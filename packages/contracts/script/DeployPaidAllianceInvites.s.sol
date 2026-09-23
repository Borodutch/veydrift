// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {
    IVeydriftPaidInviteAlliance,
    VeydriftPaidAllianceInvites
} from "../src/VeydriftPaidAllianceInvites.sol";

/// @notice First-time deployment for an Alliance proxy that has never configured a paid-invite
/// treasury. Existing stateful deployments must use the reviewed migration flow instead.
contract DeployPaidAllianceInvites is Script {
    function run() external returns (address paidInviteSystem) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address allianceProxy = vm.envAddress("ALLIANCE_PROXY_ADDRESS");
        address signer = vm.envAddress("PAID_ALLIANCE_INVITE_SIGNER_ADDRESS");
        address owner = vm.envOr("PAID_ALLIANCE_INVITE_OWNER_ADDRESS", broadcaster);
        VeydriftAllianceSystem alliances = VeydriftAllianceSystem(payable(allianceProxy));
        require(alliances.owner() == broadcaster, "BROADCASTER_MUST_BE_ALLIANCE_OWNER");
        require(address(alliances.game()) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(alliances.paidInviteSystem() == address(0), "PAID_INVITES_ALREADY_CONFIGURED");

        vm.startBroadcast(privateKey);
        VeydriftPaidAllianceInvites implementation = new VeydriftPaidAllianceInvites();
        VeydriftPaidAllianceInvites deployed = VeydriftPaidAllianceInvites(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        VeydriftPaidAllianceInvites.initialize,
                        (IVeydriftPaidInviteAlliance(allianceProxy), owner, signer)
                    )
                )
            )
        );
        paidInviteSystem = address(deployed);
        alliances.setPaidInviteSystem(paidInviteSystem);
        vm.stopBroadcast();

        console2.log("Paid alliance invite system:", paidInviteSystem);
        console2.log("Alliance proxy:", allianceProxy);
        console2.log("Invite owner:", owner);
        console2.log("Authorization signer:", signer);
    }
}
