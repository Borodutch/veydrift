// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DeployResourceTokens} from "../script/DeployResourceTokens.s.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftPaidAllianceInvites} from "../src/VeydriftPaidAllianceInvites.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {
    VeydriftCrystal,
    VeydriftDeuterium,
    VeydriftMetal,
    VeydriftResourceToken
} from "../src/VeydriftResourceToken.sol";

/// @dev Models the currently live owner-upgradeable/mintable implementation for upgrade proof.
contract LegacyVeydriftMetal is ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 internal constant INITIAL_SUPPLY = 10_000_000_000 * 1e6;

    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address initialHolder) public initializer {
        __ERC20_init("Veydrift Metal", "vMETAL");
        __Ownable_init(initialOwner);
        _mint(initialHolder, INITIAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

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

    function testResourceTokensExposeNoPostGenesisMintAuthority() public {
        bytes memory mintCall = abi.encodeWithSignature("mint(address,uint256)", treasury, 1);

        vm.prank(admin);
        (bool ownerSuccess,) = address(metal).call(mintCall);
        vm.prank(player);
        (bool playerSuccess,) = address(crystal).call(mintCall);

        assertFalse(ownerSuccess);
        assertFalse(playerSuccess);
        assertEq(metal.totalSupply(), INITIAL_SUPPLY);
        assertEq(crystal.totalSupply(), INITIAL_SUPPLY);
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

    function testFinalUpgradeRemovesMintAndPermanentlyDisablesUups() public {
        LegacyVeydriftMetal legacyImplementation = new LegacyVeydriftMetal();
        LegacyVeydriftMetal legacy = LegacyVeydriftMetal(
            _deployProxy(
                address(legacyImplementation),
                abi.encodeCall(LegacyVeydriftMetal.initialize, (admin, game))
            )
        );
        vm.prank(admin);
        legacy.mint(treasury, 25_000_000);
        uint256 supplyBefore = legacy.totalSupply();

        VeydriftMetal noMintImplementation = new VeydriftMetal();
        vm.prank(admin);
        legacy.upgradeToAndCall(address(noMintImplementation), "");
        VeydriftMetal frozen = VeydriftMetal(address(legacy));
        assertEq(frozen.owner(), admin);
        assertEq(frozen.totalSupply(), supplyBefore);

        vm.prank(admin);
        (bool mintSucceeded,) =
            address(frozen).call(abi.encodeWithSignature("mint(address,uint256)", treasury, 1));
        assertFalse(mintSucceeded);
        VeydriftMetal forbiddenImplementation = new VeydriftMetal();
        vm.expectRevert(VeydriftResourceToken.ResourceTokenUpgradesDisabled.selector);
        vm.prank(admin);
        frozen.upgradeToAndCall(address(forbiddenImplementation), "");
        assertEq(frozen.totalSupply(), supplyBefore);
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
        address paidInviteSystem = VeydriftAllianceSystem(allianceSystemAddress).paidInviteSystem();
        assertTrue(paidInviteSystem.code.length > 0);
        assertEq(VeydriftPaidAllianceInvites(paidInviteSystem).INVITE_PRICE(), 0.006 ether);
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
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(address(0xBEEF));
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF), address(colonizationModule));
        VeydriftGame existingGame = new VeydriftGame(
            deployer,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(new VeydriftAcsAttackModule())
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
        vm.setEnv("PAID_ALLIANCE_INVITE_SIGNER_ADDRESS", vm.toString(address(0x51A9E7)));
    }
}
