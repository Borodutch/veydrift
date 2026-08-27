// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";

contract LiveUpgradeGameMock {
    bool public gamePaused;
    uint64 public moonAttackParityActivatedAt;
    uint8 public planetTemperatureGenerationVersion;

    function configure(bool paused, uint64 parityActivatedAt, uint8 temperatureVersion) external {
        gamePaused = paused;
        moonAttackParityActivatedAt = parityActivatedAt;
        planetTemperatureGenerationVersion = temperatureVersion;
    }
}

contract LiveUpgradePolicyHarness {
    function requireGameUpgradeReady(address game) external view {
        VeydriftLiveUpgradePolicy.requireGameUpgradeReady(game);
    }

    function requireMoonUpgradeReady(address game) external view {
        VeydriftLiveUpgradePolicy.requireMoonUpgradeReady(game);
    }
}

contract VeydriftLiveUpgradePolicyTest is Test {
    LiveUpgradeGameMock private game;
    LiveUpgradePolicyHarness private harness;

    function setUp() external {
        game = new LiveUpgradeGameMock();
        harness = new LiveUpgradePolicyHarness();
        game.configure(false, 1, 2);
    }

    function testGameAndMoonUpgradesAcceptLiveReadyGame() external view {
        harness.requireGameUpgradeReady(address(game));
        harness.requireMoonUpgradeReady(address(game));
    }

    function testGameAndMoonUpgradesRejectPausedGame() external {
        game.configure(true, 1, 2);

        vm.expectRevert(VeydriftLiveUpgradePolicy.GameMustRemainLive.selector);
        harness.requireGameUpgradeReady(address(game));
        vm.expectRevert(VeydriftLiveUpgradePolicy.GameMustRemainLive.selector);
        harness.requireMoonUpgradeReady(address(game));
    }

    function testGameUpgradeRejectsPauseOnlyMoonParityMigration() external {
        game.configure(false, 0, 2);

        vm.expectRevert(VeydriftLiveUpgradePolicy.LiveMoonParityMigrationRequired.selector);
        harness.requireGameUpgradeReady(address(game));
    }

    function testGameUpgradeRejectsPauseOnlyTemperatureMigration() external {
        game.configure(false, 1, 1);

        vm.expectRevert(VeydriftLiveUpgradePolicy.LiveTemperatureMigrationRequired.selector);
        harness.requireGameUpgradeReady(address(game));
    }
}
