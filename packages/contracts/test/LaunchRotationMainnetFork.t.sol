// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftResource} from "../src/VeydriftResource.sol";
import {
    VeydriftContributorVestingWallet,
    VeydriftDevelopmentVestingWallet,
    VeydriftEcosystemVestingWallet,
    VeydriftToken
} from "../src/VeydriftToken.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

interface IRotatable {
    function owner() external view returns (address);
    function transferOwnership(address nextOwner) external;
    function renounceOwnership() external;
    function mint(address to, uint256 amount) external;
    function setStateSigner(address nextSigner) external;
    function stateSigner() external view returns (address);
}

interface IReserveGame {
    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    function setResourceTokens(address metal, address crystal, address deuterium) external;
    function resourceToken(Resource resource) external view returns (address);
    function resourceReserveAvailable() external view returns (Resources memory);
    function totalInternalResources() external view returns (Resources memory);
    function homePlanetOf(address player) external view returns (uint256);
    function collectResources(uint256 planetId) external;
}

/// @notice Rehearses the 2026-10 launch prep on live Base state with impersonated owners (no keys):
///         Moon granter upgrade, owner rotation, legacy resource renounce, fixed-supply token deploys
///         and the Game switch.
contract LaunchRotationMainnetForkTest is Test {
    address internal constant NEW_OWNER = 0xc2ae8c98099E4B9BBB661D1B306e1C70915eFC02;
    address internal constant TREASURY = 0x2732e87c9b9A9Ce3C1C78968B12F56Ec74D1c9d7;
    address internal constant GAME = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address internal constant MOON = 0x4935f1E0024F1Ea07877a583F89A51BF3d91Cf5C;
    address internal constant MIGRATION = 0x33A56B6f6354D32Edeef43baECC3C94a316bf7d3;
    uint256 internal constant GAME_RESERVE = 1_000_000 * 10 ** 6;
    uint64 internal constant VESTING_START = 1_792_699_200; // 2026-10-22 20:00 UTC, the CCA start

    function testRotationTokenSwitchAndGenesis() external {
        // `plain test --fork base` starts on Base already; forge forks from the env RPC.
        if (block.chainid != 8453) {
            string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
            if (bytes(rpc).length == 0) {
                emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping launch rotation fork");
                return;
            }
            vm.createSelectFork(rpc);
        }

        // Each old owner hands over what it owns (same lists as the RotateOwnership runs).
        _transfer(0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B, GAME);
        _transfer(0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B, PROXY_ADMIN);
        // Moon: upgrade to the granter-role build, keep the listener key as granter only, then rotate.
        VeydriftMoonSystem moon = VeydriftMoonSystem(payable(MOON));
        address listener = 0x735ac9Ec44B6Eb9010C61e3227631f37b39F6DDC;
        address moonImplementation =
            address(new VeydriftMoonSystem(address(moon.game()), address(moon.randomness())));
        vm.startPrank(listener);
        moon.upgradeToAndCall(moonImplementation, "");
        moon.setChickenBurnGranter(listener);
        vm.stopPrank();
        _transfer(listener, MOON);
        vm.prank(listener);
        vm.expectRevert(VeydriftMoonSystem.ZeroAddress.selector);
        moon.grantMoonFromChickenBurn(bytes32(0), address(0), 0); // past the auth check
        vm.prank(listener);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, listener));
        moon.createMoon(1);
        _transfer(
            0x7637888E9AAaD9c3941803414084A032324476De, 0x0E5a6210482B15780cf5Ec036107031dcA702001
        );
        _transfer(
            0x7637888E9AAaD9c3941803414084A032324476De, 0x01771E2608C35d1C5966FC8556584EEe7d4128f0
        );
        _transfer(
            0xC7f7EB2cA489c2B2b4D5a38b446c829e3987386d, 0xdc7d3388bfb07E2cC8DD3Be265d7C1182D34d069
        );
        vm.prank(0x496494cB54153e97e4D28454092e0cf293A97088);
        IRotatable(MIGRATION).setStateSigner(NEW_OWNER);
        assertEq(IRotatable(MIGRATION).stateSigner(), NEW_OWNER);
        _transfer(0x496494cB54153e97e4D28454092e0cf293A97088, MIGRATION);
        _renounce(
            0x41aE0a1095D93BC7BFbcBB5A0382912fA3a044Ac, 0x91A4f8A9D05F21E010dc1eE0B17Ab644D433cB41
        );
        _renounce(
            0xc22A65B25E9311f7E3F877A19a0a1FF0cdb6A46b, 0xC6881a2C4C50E28AdCaC4D5577cD8e211E806B76
        );
        _renounce(
            0x3C14cAf0bdf4855b8eFC681e01a3c18CC281b80E, 0x5A6027DE1C7E52B4b1AD0c13c3eC3Ad5FCb481e2
        );

        // The new owner controls Game upgrades; the old one no longer does.
        address implementation = address(
            uint160(
                uint256(
                    vm.load(
                        GAME, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
                    )
                )
            )
        );
        vm.prank(0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B);
        vm.expectRevert();
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(GAME), implementation, "");
        vm.prank(NEW_OWNER);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(GAME), implementation, "");

        // Fixed-supply resources: treasury holds the supply, funds the Game, the new owner switches.
        vm.startPrank(TREASURY);
        VeydriftResource metal = new VeydriftResource("Veydrift Metal", "vMETAL", TREASURY);
        VeydriftResource crystal = new VeydriftResource("Veydrift Crystal", "vCRYSTAL", TREASURY);
        VeydriftResource deuterium = new VeydriftResource("Veydrift Deuterium", "vDEUT", TREASURY);
        assertTrue(metal.transfer(GAME, GAME_RESERVE));
        assertTrue(crystal.transfer(GAME, GAME_RESERVE));
        assertTrue(deuterium.transfer(GAME, GAME_RESERVE));
        vm.stopPrank();

        IReserveGame game = IReserveGame(GAME);
        vm.prank(0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B);
        vm.expectRevert();
        game.setResourceTokens(address(metal), address(crystal), address(deuterium));
        vm.prank(NEW_OWNER);
        game.setResourceTokens(address(metal), address(crystal), address(deuterium));
        assertEq(game.resourceToken(Resource.Metal), address(metal));
        assertEq(game.resourceToken(Resource.Deuterium), address(deuterium));
        IReserveGame.Resources memory available = game.resourceReserveAvailable();
        assertGt(available.metal, GAME_RESERVE / 2, "reserve headroom");

        // A live player keeps producing against the new reserve.
        address player = 0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE;
        uint256 planetId = game.homePlanetOf(player);
        assertGt(planetId, 0, "player has a home planet");
        uint128 before = game.totalInternalResources().metal;
        vm.warp(block.timestamp + 1 days);
        vm.prank(player);
        game.collectResources(planetId);
        assertGt(game.totalInternalResources().metal, before, "production credited");

        // VEYDRIFT genesis: everything to the treasury, vesting wallets owned by it.
        vm.startPrank(TREASURY);
        VeydriftDevelopmentVestingWallet development =
            new VeydriftDevelopmentVestingWallet(TREASURY, VESTING_START);
        VeydriftContributorVestingWallet contributor =
            new VeydriftContributorVestingWallet(TREASURY, VESTING_START);
        VeydriftEcosystemVestingWallet ecosystem =
            new VeydriftEcosystemVestingWallet(TREASURY, VESTING_START);
        VeydriftToken token = new VeydriftToken(
            TREASURY, TREASURY, address(development), address(contributor), address(ecosystem)
        );
        vm.stopPrank();
        assertEq(token.balanceOf(TREASURY), 650_000_000 ether);
        assertEq(token.balanceOf(address(development)), 150_000_000 ether);
        assertEq(contributor.cliff(), uint256(VESTING_START) + 365 days);
    }

    function _transfer(address oldOwner, address target) internal {
        assertEq(IRotatable(target).owner(), oldOwner, "unexpected live owner");
        vm.prank(oldOwner);
        IRotatable(target).transferOwnership(NEW_OWNER);
        assertEq(IRotatable(target).owner(), NEW_OWNER);
    }

    function _renounce(address oldOwner, address token) internal {
        assertEq(IRotatable(token).owner(), oldOwner, "unexpected live owner");
        vm.prank(oldOwner);
        IRotatable(token).renounceOwnership();
        vm.prank(oldOwner);
        vm.expectRevert();
        IRotatable(token).mint(oldOwner, 1);
    }
}
