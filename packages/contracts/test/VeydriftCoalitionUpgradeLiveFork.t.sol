// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UpgradeGame} from "../script/UpgradeGame.s.sol";
import {UpgradeMoonSystem} from "../script/UpgradeMoonSystem.s.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";

/// @notice Opt-in LIVE persisted-state canonical rehearsal. No setup mutation, mocks, resources,
/// migration or signer. Missing inputs are a visible skip, never a passed live proof.
contract VeydriftCoalitionUpgradeLiveForkTest is Test {
    bytes32 constant IMPLEMENTATION =
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    function _assertPinnedHash(uint256 pin) private {
        // The fork block itself is outside BLOCKHASH range; roll one local block only to read it.
        vm.roll(pin + 1);
        assertEq(blockhash(pin), vm.envBytes32("VEY919_LIVE_BLOCK_HASH"));
        vm.roll(pin);
    }

    function testCanonicalLiveGameThenMoonWithoutPrerequisiteMutation() public {
        if (!vm.envOr("VEY919_LIVE_CANONICAL", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envString("VEY919_LIVE_RPC"), vm.envUint("VEY919_LIVE_BLOCK"));
        assertEq(block.chainid, 8453);
        _assertPinnedHash(block.number);
        // Public owners are required; never fall through to the PRIVATE_KEY path.
        address owner = vm.envAddress("UPGRADE_DRY_RUN_OWNER");
        assertNotEq(owner, address(0));
        vm.setEnv("PRIVATE_KEY", "not-a-private-key");
        VeydriftGame game = VeydriftGame(payable(vm.envAddress("GAME_PROXY_ADDRESS")));
        VeydriftMoonSystem moon = VeydriftMoonSystem(vm.envAddress("MOON_PROXY_ADDRESS"));
        address moonOwner = moon.owner();
        uint64 parity = game.moonAttackParityActivatedAt();
        uint8 temperature = game.planetTemperatureGenerationVersion();
        address randomness = address(moon.randomness());
        address gameImpl = (new UpgradeGame()).run();
        assertEq(vm.load(address(game), IMPLEMENTATION), bytes32(uint256(uint160(gameImpl))));
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(moonOwner));
        address moonImpl = (new UpgradeMoonSystem()).run();
        assertEq(vm.load(address(moon), IMPLEMENTATION), bytes32(uint256(uint160(moonImpl))));
        assertEq(game.owner(), owner);
        assertEq(moon.owner(), moonOwner);
        assertEq(address(moon.game()), address(game));
        assertEq(address(moon.randomness()), randomness);
        assertEq(game.moonAttackParityActivatedAt(), parity);
        assertEq(game.planetTemperatureGenerationVersion(), temperature);
        assertFalse(game.gamePaused());
    }
}
