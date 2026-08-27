// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeydriftLiveUpgradeGame {
    function gamePaused() external view returns (bool);
    function moonAttackParityActivatedAt() external view returns (uint64);
    function planetTemperatureGenerationVersion() external view returns (uint8);
}

/// @notice Shared fail-fast checks for upgrades that must never interrupt gameplay.
library VeydriftLiveUpgradePolicy {
    error GameMustRemainLive();
    error LiveMoonParityMigrationRequired();
    error LiveTemperatureMigrationRequired();

    function requireGameUpgradeReady(address gameAddress) internal view {
        IVeydriftLiveUpgradeGame game = IVeydriftLiveUpgradeGame(gameAddress);
        _requireGameLive(game);
        if (game.moonAttackParityActivatedAt() == 0) revert LiveMoonParityMigrationRequired();
        if (game.planetTemperatureGenerationVersion() < 2) {
            revert LiveTemperatureMigrationRequired();
        }
    }

    function requireMoonUpgradeReady(address gameAddress) internal view {
        _requireGameLive(IVeydriftLiveUpgradeGame(gameAddress));
    }

    function _requireGameLive(IVeydriftLiveUpgradeGame game) private view {
        if (game.gamePaused()) revert GameMustRemainLive();
    }
}
