// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Exact Base-mainnet upgrade proof for moon fleet score parity.
/// @dev Pins a recent production block where the witness player has two Large Cargo stationed on
///      separate moons and no active missions. The old implementation reports 66,058; the upgraded
///      implementation must preserve all sampled state and add exactly 40 ship-score points.
contract VeydriftMoonScoreMainnetForkTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint256 private constant FORK_BLOCK = 50_052_120;

    address private constant GAME_PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address private constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address private constant PROXY_ADMIN_OWNER = 0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B;
    address private constant REFERRAL_SYSTEM = 0x3246Df19Fa850E27eAC5292232aC2a51bbB7b835;
    address private constant WITNESS_PLAYER = 0xC77dA8cB158BA77BaC765625745a766Af3111A69;

    function testLiveUpgradePreservesStateAndRestoresMoonFleetScore() public {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);

        VeydriftGame game = VeydriftGame(payable(GAME_PROXY));
        address oldImplementation = _implementation();
        address ownerBefore = game.owner();
        uint256 startPriceBefore = game.startPrice();
        uint256 nextPlanetIdBefore = game.nextPlanetId();
        uint256 nextFleetIdBefore = game.nextFleetId();
        address randomnessBefore = game.randomnessEngine();
        bytes32 planet41Before = keccak256(abi.encode(game.planet(41)));
        bytes32 planet301Before = keccak256(abi.encode(game.planet(301)));

        assertEq(ProxyAdmin(PROXY_ADMIN).owner(), PROXY_ADMIN_OWNER);
        assertEq(ownerBefore, PROXY_ADMIN_OWNER);
        assertEq(game.activeFleetMissionCount(WITNESS_PLAYER), 0);
        assertEq(game.moonShipCount(41, Ship.LargeCargo), 1);
        assertEq(game.moonShipCount(301, Ship.LargeCargo), 1);
        assertEq(game.playerScore(WITNESS_PLAYER), 66_058);

        VeydriftGame newImplementation = _deployImplementation();
        vm.prank(PROXY_ADMIN_OWNER);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(
                ITransparentUpgradeableProxy(GAME_PROXY), address(newImplementation), ""
            );

        assertNotEq(_implementation(), oldImplementation);
        assertEq(_implementation(), address(newImplementation));
        assertEq(game.owner(), ownerBefore);
        assertEq(game.startPrice(), startPriceBefore);
        assertEq(game.nextPlanetId(), nextPlanetIdBefore);
        assertEq(game.nextFleetId(), nextFleetIdBefore);
        assertEq(game.randomnessEngine(), randomnessBefore);
        assertEq(keccak256(abi.encode(game.planet(41))), planet41Before);
        assertEq(keccak256(abi.encode(game.planet(301))), planet301Before);
        assertEq(game.moonShipCount(41, Ship.LargeCargo), 1);
        assertEq(game.moonShipCount(301, Ship.LargeCargo), 1);
        assertEq(game.playerScore(WITNESS_PLAYER), 66_098);
    }

    function _implementation() private view returns (address) {
        return address(uint160(uint256(vm.load(GAME_PROXY, IMPLEMENTATION_SLOT))));
    }

    function _deployImplementation() private returns (VeydriftGame implementation) {
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(REFERRAL_SYSTEM);
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(REFERRAL_SYSTEM);
        implementation = new VeydriftGame(
            PROXY_ADMIN_OWNER,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule)
        );
    }
}
