// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DeployResourceTokens} from "../script/DeployResourceTokens.s.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";
import {
    VeydriftCrystal,
    VeydriftDeuterium,
    VeydriftMetal,
    VeydriftResourceToken
} from "../src/VeydriftResourceToken.sol";

contract VeydriftResourceTokenTest is Test {
    uint256 internal constant INITIAL_SUPPLY = 10_000_000_000 * 10 ** 6;
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    address internal admin = address(0xA11CE);
    address internal game = address(0x9A3E);
    address internal player = address(0xB0B);
    address internal treasury = address(0x7EA5);

    VeydriftMetal internal metal;
    VeydriftCrystal internal crystal;
    VeydriftDeuterium internal deuterium;

    function setUp() public {
        metal = VeydriftMetal(
            _deployProxy(
                address(new VeydriftMetal()),
                abi.encodeCall(VeydriftMetal.initialize, (admin, game))
            )
        );
        crystal = VeydriftCrystal(
            _deployProxy(
                address(new VeydriftCrystal()),
                abi.encodeCall(VeydriftCrystal.initialize, (admin, game))
            )
        );
        deuterium = VeydriftDeuterium(
            _deployProxy(
                address(new VeydriftDeuterium()),
                abi.encodeCall(VeydriftDeuterium.initialize, (admin, game))
            )
        );
    }

    function testInitializesAllResourceTokensWithSixDecimalsAndGameCustody() public view {
        _assertResourceToken(metal, "Veydrift Metal", "vMETAL");
        _assertResourceToken(crystal, "Veydrift Crystal", "vCRYSTAL");
        _assertResourceToken(deuterium, "Veydrift Deuterium", "vDEUT");
    }

    function testOwnerCanMintAdditionalSupply() public {
        uint256 mintAmount = 25_000_000;

        vm.prank(admin);
        metal.mint(treasury, mintAmount);

        assertEq(metal.balanceOf(treasury), mintAmount);
        assertEq(metal.totalSupply(), INITIAL_SUPPLY + mintAmount);
    }

    function testNonOwnerCannotMintAdditionalSupply() public {
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player)
        );
        crystal.mint(player, 1);
    }

    function testResourceTokensRemainTransferableERC20s() public {
        uint256 amount = 1_500_000;

        vm.prank(game);
        assertTrue(deuterium.transfer(player, amount));

        assertEq(deuterium.balanceOf(player), amount);
        assertEq(deuterium.balanceOf(game), INITIAL_SUPPLY - amount);
    }

    function testPlayersCannotDirectlyDrainGameHeldReserveTokens() public {
        vm.prank(player);
        (bool success,) = address(metal)
            .call(
                abi.encodeWithSelector(
                    bytes4(keccak256("transferFrom(address,address,uint256)")), game, player, 1
                )
            );

        assertFalse(success);
        assertEq(metal.balanceOf(game), INITIAL_SUPPLY);
        assertEq(metal.balanceOf(player), 0);
    }

    function testInitializerCannotBeReused() public {
        vm.expectRevert();
        metal.initialize(admin, game);
    }

    function testImplementationCannotBeInitializedDirectly() public {
        VeydriftMetal implementation = new VeydriftMetal();

        vm.expectRevert();
        implementation.initialize(admin, game);
    }

    function testInitialHolderCannotBeZeroAddress() public {
        VeydriftMetal implementation = new VeydriftMetal();

        vm.expectRevert(VeydriftResourceToken.InvalidInitialHolder.selector);
        new ERC1967Proxy(
            address(implementation), abi.encodeCall(VeydriftMetal.initialize, (admin, address(0)))
        );
    }

    function testOnlyOwnerCanAuthorizeUpgrade() public {
        VeydriftMetal nextImplementation = new VeydriftMetal();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player)
        );
        metal.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(admin);
        metal.upgradeToAndCall(address(nextImplementation), "");
        assertEq(metal.owner(), admin);
        assertEq(metal.balanceOf(game), INITIAL_SUPPLY);
    }

    function testFullDeployScriptWiresGameAndResourceTokenReserves() public {
        address deployer = _setDeployEnv();
        vm.setEnv(
            "VEYDRIFT_ALPHA_REDEPLOY_ACK",
            "I have verified Veydrift alpha state migration requirements"
        );

        (
            address gameAddress,
            address settlementAddress,
            address allianceSystemAddress,
            address moonSystemAddress,
            address randomnessEngineAddress,
            address metalToken,
            address crystalToken,
            address deuteriumToken
        ) = new Deploy().run();

        VeydriftGame deployedGame = VeydriftGame(gameAddress);
        VeydriftGame.Resources memory available = deployedGame.resourceReserveAvailable();

        assertEq(deployedGame.owner(), deployer);
        assertEq(VeydriftSettlement(settlementAddress).owner(), deployer);
        assertTrue(settlementAddress.code.length > 0);
        assertTrue(allianceSystemAddress.code.length > 0);
        assertTrue(moonSystemAddress.code.length > 0);
        assertTrue(randomnessEngineAddress.code.length > 0);
        assertEq(deployedGame.resourceToken(Resource.Metal), metalToken);
        assertEq(deployedGame.resourceToken(Resource.Crystal), crystalToken);
        assertEq(deployedGame.resourceToken(Resource.Deuterium), deuteriumToken);
        _assertErc1967Proxy(gameAddress);
        _assertErc1967Proxy(settlementAddress);
        _assertErc1967Proxy(allianceSystemAddress);
        _assertErc1967Proxy(moonSystemAddress);
        _assertErc1967Proxy(randomnessEngineAddress);
        _assertErc1967Proxy(metalToken);
        _assertErc1967Proxy(crystalToken);
        _assertErc1967Proxy(deuteriumToken);
        assertEq(VeydriftMetal(metalToken).owner(), deployer);
        assertEq(VeydriftCrystal(crystalToken).owner(), deployer);
        assertEq(VeydriftDeuterium(deuteriumToken).owner(), deployer);
        assertEq(VeydriftMetal(metalToken).balanceOf(gameAddress), INITIAL_SUPPLY);
        assertEq(VeydriftCrystal(crystalToken).balanceOf(gameAddress), INITIAL_SUPPLY);
        assertEq(VeydriftDeuterium(deuteriumToken).balanceOf(gameAddress), INITIAL_SUPPLY);
        assertEq(available.metal, INITIAL_SUPPLY);
        assertEq(available.crystal, INITIAL_SUPPLY);
        assertEq(available.deuterium, INITIAL_SUPPLY);

        vm.deal(player, 1 ether);
        vm.prank(player);
        deployedGame.startPlanet{value: 0.05 ether}();
        VeydriftGame.Resources memory required = deployedGame.resourceReserveRequirement();
        available = deployedGame.resourceReserveAvailable();
        assertEq(required.metal, 500);
        assertEq(required.crystal, 500);
        assertEq(required.deuterium, 0);
        assertEq(available.metal, INITIAL_SUPPLY - 500);
        assertEq(available.crystal, INITIAL_SUPPLY - 500);
        assertEq(available.deuterium, INITIAL_SUPPLY);
    }

    function testBaseSepoliaDeployScriptAcceptsExplicitAlphaStatePreservationAck() public {
        address deployer = _setDeployEnv();
        vm.chainId(84532);
        vm.setEnv(
            "VEYDRIFT_ALPHA_REDEPLOY_ACK",
            "I have verified Veydrift alpha state migration requirements"
        );

        (
            address gameAddress,
            address settlementAddress,
            address allianceSystemAddress,
            address moonSystemAddress,
            address randomnessEngineAddress,
            address metalToken,
            address crystalToken,
            address deuteriumToken
        ) = new Deploy().run();

        assertEq(VeydriftGame(gameAddress).owner(), deployer);
        assertEq(VeydriftSettlement(settlementAddress).owner(), deployer);
        assertTrue(allianceSystemAddress.code.length > 0);
        assertTrue(moonSystemAddress.code.length > 0);
        assertTrue(randomnessEngineAddress.code.length > 0);
        _assertErc1967Proxy(gameAddress);
        _assertErc1967Proxy(settlementAddress);
        _assertErc1967Proxy(allianceSystemAddress);
        _assertErc1967Proxy(moonSystemAddress);
        _assertErc1967Proxy(randomnessEngineAddress);
        _assertErc1967Proxy(metalToken);
        _assertErc1967Proxy(crystalToken);
        _assertErc1967Proxy(deuteriumToken);
        assertEq(VeydriftMetal(metalToken).balanceOf(gameAddress), INITIAL_SUPPLY);
        assertEq(VeydriftCrystal(crystalToken).balanceOf(gameAddress), INITIAL_SUPPLY);
        assertEq(VeydriftDeuterium(deuteriumToken).balanceOf(gameAddress), INITIAL_SUPPLY);
    }

    function testResourceTokenDeployScriptMintsInitialSupplyToExistingGame() public {
        address deployer = _setDeployEnv();
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftGame existingGame = new VeydriftGame(
            deployer,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule)
        );
        vm.setEnv("VEYDRIFT_GAME_CONTRACT_ADDRESS", vm.toString(address(existingGame)));

        (address metalToken, address crystalToken, address deuteriumToken) =
            new DeployResourceTokens().run();

        assertEq(VeydriftMetal(metalToken).owner(), deployer);
        assertEq(VeydriftCrystal(crystalToken).owner(), deployer);
        assertEq(VeydriftDeuterium(deuteriumToken).owner(), deployer);
        assertEq(VeydriftMetal(metalToken).balanceOf(address(existingGame)), INITIAL_SUPPLY);
        assertEq(VeydriftCrystal(crystalToken).balanceOf(address(existingGame)), INITIAL_SUPPLY);
        assertEq(VeydriftDeuterium(deuteriumToken).balanceOf(address(existingGame)), INITIAL_SUPPLY);
    }

    function _assertResourceToken(
        VeydriftResourceToken token,
        string memory expectedName,
        string memory expectedSymbol
    ) internal view {
        assertEq(token.name(), expectedName);
        assertEq(token.symbol(), expectedSymbol);
        assertEq(token.decimals(), 6);
        assertEq(token.owner(), admin);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(game), INITIAL_SUPPLY);
    }

    function _deployProxy(address implementation, bytes memory initializer)
        internal
        returns (address)
    {
        return address(new ERC1967Proxy(implementation, initializer));
    }

    function _assertErc1967Proxy(address proxy) internal view {
        address implementation =
            address(uint160(uint256(vm.load(proxy, ERC1967_IMPLEMENTATION_SLOT))));
        assertNotEq(implementation, address(0));
        assertTrue(implementation.code.length > 0);
    }

    function _setDeployEnv() internal returns (address deployer) {
        uint256 deployerPrivateKey = 0xA11CE;
        deployer = vm.addr(deployerPrivateKey);
        vm.setEnv("PRIVATE_KEY", vm.toString(deployerPrivateKey));
        vm.setEnv("ADMIN_ADDRESS", vm.toString(deployer));
    }
}
