// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {UpgradeGame} from "../script/UpgradeGame.s.sol";
import {UpgradeMoonSystem} from "../script/UpgradeMoonSystem.s.sol";
import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

/// @dev LOCAL fixture only. This is deliberately not persisted mainnet-state evidence.
contract VeydriftCoalitionUpgradeKeylessTest is Test {
    bytes32 constant IMPLEMENTATION =
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
    bytes32 constant ADMIN = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
    address constant OWNER = address(0x919919);
    VeydriftGame game;
    VeydriftMoonSystem moon;
    VeydriftReferralSystem source;
    VeydriftReferralSystem target;
    UpgradeGame gameScript;
    UpgradeMoonSystem moonScript;
    address admin;

    function setUp() public {
        // An invalid non-key proves that the canonical public-address path never reads it.
        vm.setEnv("PRIVATE_KEY", "not-a-private-key");
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(OWNER));
        vm.setEnv("ADMIN_ADDRESS", vm.toString(OWNER));
        vm.deal(OWNER, 100 ether);
        source = new VeydriftReferralSystem(OWNER);
        target = new VeydriftReferralSystem(OWNER);
        vm.startPrank(OWNER);
        source.setReferralSigner(address(0xCAFE));
        target.setReferralSigner(address(0xCAFE));
        // A genuinely empty LOCAL migration, not a waived live migration prerequisite.
        target.configureReferralCodeMigration(bytes32(0), 0, bytes32(0), 0);
        target.configureReferralRedemptionMigration(bytes32(0), 0);
        target.configureReferralRewardMigration(bytes32(0), 0);
        target.configureReferralRewardClaimMigration(bytes32(0), 0);
        target.finalizeReferralCodeMigration();
        vm.stopPrank();
        // The pre-upgrade fixture only needs storage/getters. The ACTUAL script creates every
        // replacement dependency; no mocked call or vm.etch substitutes for its upgrade.
        VeydriftGame initial = new VeydriftGame(
            OWNER,
            address(1),
            address(1),
            address(1),
            address(1),
            address(1),
            address(1),
            address(1),
            address(1)
        );
        game = VeydriftGame(
            payable(address(
                    new TransparentUpgradeableProxy(
                        address(initial), OWNER, abi.encodeCall(VeydriftGame.initialize, (OWNER))
                    )
                ))
        );
        admin = address(uint160(uint256(vm.load(address(game), ADMIN))));
        VeydriftMoonSystem initialMoon = new VeydriftMoonSystem(address(game), address(0xBEEF));
        moon = VeydriftMoonSystem(
            address(
                new ERC1967Proxy(
                    address(initialMoon),
                    abi.encodeCall(
                        VeydriftMoonSystem.initialize, (address(game), address(0xBEEF), OWNER)
                    )
                )
            )
        );
        vm.prank(OWNER);
        game.setMoonSystem(address(moon));
        vm.setEnv("GAME_PROXY_ADDRESS", vm.toString(address(game)));
        vm.setEnv("GAME_PROXY_ADMIN", vm.toString(admin));
        vm.setEnv("MOON_PROXY_ADDRESS", vm.toString(address(moon)));
        vm.setEnv("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS", vm.toString(address(target)));
        vm.setEnv("VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS", vm.toString(address(source)));
        gameScript = new UpgradeGame();
        moonScript = new UpgradeMoonSystem();
    }

    function testCanonicalKeylessGameThenMoonPreservesStateAndAncillaryWrite() public {
        uint64 parity = game.moonAttackParityActivatedAt();
        uint8 temperature = game.planetTemperatureGenerationVersion();
        bytes32 oldGame = vm.load(address(game), IMPLEMENTATION);
        bytes32 oldMoon = vm.load(address(moon), IMPLEMENTATION);
        address implementation = gameScript.run();
        assertNotEq(bytes32(uint256(uint160(implementation))), oldGame);
        assertEq(vm.load(address(game), IMPLEMENTATION), bytes32(uint256(uint160(implementation))));
        assertEq(target.game(), address(game));
        address moonImplementation = moonScript.run();
        assertNotEq(bytes32(uint256(uint160(moonImplementation))), oldMoon);
        assertEq(
            vm.load(address(moon), IMPLEMENTATION), bytes32(uint256(uint160(moonImplementation)))
        );
        assertEq(game.owner(), OWNER);
        assertEq(ProxyAdmin(admin).owner(), OWNER);
        assertEq(moon.owner(), OWNER);
        assertEq(address(moon.game()), address(game));
        assertEq(address(moon.randomness()), address(0xBEEF));
        assertEq(game.moonAttackParityActivatedAt(), parity);
        assertEq(game.planetTemperatureGenerationVersion(), temperature);
        assertFalse(game.gamePaused());
        assertTrue(target.referralMigrationFinalized());
        assertEq(source.game(), address(0));
    }

    function testCanonicalKeylessAlreadyConfiguredReferral() public {
        vm.prank(OWNER);
        target.setGame(address(game));
        gameScript.run();
        assertEq(target.game(), address(game));
    }

    function testCanonicalKeylessRejectsWrongOwnerBeforeDeploy() public {
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(address(0xBAD)));
        vm.expectRevert(bytes("BROADCASTER_NOT_PROXY_ADMIN_OWNER"));
        gameScript.run();
        vm.expectRevert(bytes("BROADCASTER_MUST_BE_PROXY_OWNER"));
        moonScript.run();
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(OWNER));
    }

    function testCanonicalKeylessRejectsUnfinalizedMigrationBeforeDeploy() public {
        VeydriftReferralSystem unfinished = new VeydriftReferralSystem(OWNER);
        vm.setEnv("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS", vm.toString(address(unfinished)));
        vm.expectRevert(bytes("REFERRAL_MIGRATION_PENDING"));
        gameScript.run();
        // Environment variables are process-global, not reset by Foundry test snapshots.
        vm.setEnv("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS", vm.toString(address(target)));
    }

    function testCanonicalKeylessRejectsUnfrozenSourceBeforeDeploy() public {
        vm.prank(OWNER);
        source.setGame(address(game));
        vm.expectRevert(bytes("SOURCE_REFERRAL_NOT_FROZEN"));
        gameScript.run();
    }

    function testCanonicalKeylessRejectsSourceEscrowBeforeDeploy() public {
        vm.deal(address(source), 1);
        vm.expectRevert(bytes("SOURCE_REFERRAL_ESCROW_NONZERO"));
        gameScript.run();
    }

    function testCanonicalKeylessRejectsSignerMismatchBeforeDeploy() public {
        vm.prank(OWNER);
        target.setReferralSigner(address(0xBAD));
        vm.expectRevert(bytes("REFERRAL_SIGNER_MISMATCH"));
        gameScript.run();
    }
}
