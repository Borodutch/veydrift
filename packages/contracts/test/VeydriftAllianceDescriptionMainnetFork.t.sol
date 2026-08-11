// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";

contract VeydriftAllianceDescriptionMainnetForkTest is Test {
    address private constant ALLIANCE_PROXY = 0x0E5a6210482B15780cf5Ec036107031dcA702001;
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function testLiveUpgradePreservesAllianceState() public {
        string memory rpcUrl = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(payable(ALLIANCE_PROXY));
        address owner = proxied.owner();
        address game = address(proxied.game());
        address warProtection = address(proxied.warProtection());
        address paidInviteSystem = proxied.paidInviteSystem();
        uint256 nextAllianceId = proxied.nextAllianceId();
        uint64 warMinimumDurationActivatedAt = proxied.warMinimumDurationActivatedAt();
        uint256[] memory ids = proxied.allianceIds();
        bytes32[] memory profileHashes = new bytes32[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            profileHashes[i] = keccak256(abi.encode(proxied.allianceProfile(ids[i])));
        }

        address oldImplementation =
            address(uint160(uint256(vm.load(ALLIANCE_PROXY, IMPLEMENTATION_SLOT))));
        VeydriftAllianceSystem implementation =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(game));
        vm.prank(owner);
        proxied.upgradeToAndCall(address(implementation), "");

        assertNotEq(address(implementation), oldImplementation);
        assertEq(
            address(uint160(uint256(vm.load(ALLIANCE_PROXY, IMPLEMENTATION_SLOT)))),
            address(implementation)
        );
        assertEq(proxied.owner(), owner);
        assertEq(address(proxied.game()), game);
        assertEq(address(proxied.warProtection()), warProtection);
        assertEq(proxied.paidInviteSystem(), paidInviteSystem);
        assertEq(proxied.nextAllianceId(), nextAllianceId);
        assertEq(proxied.warMinimumDurationActivatedAt(), warMinimumDurationActivatedAt);
        assertEq(keccak256(abi.encode(proxied.allianceIds())), keccak256(abi.encode(ids)));
        for (uint256 i = 0; i < ids.length; i++) {
            assertEq(keccak256(abi.encode(proxied.allianceProfile(ids[i]))), profileHashes[i]);
        }
    }
}
