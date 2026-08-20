// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {
    IUniswapCCAAuction,
    IUniswapLBPStrategy,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments,
    VeydriftV4PoolKey,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";
import {
    IVeydriftMainLaunch,
    VeydriftUniswapResourcePools
} from "../src/VeydriftUniswapResourcePools.sol";
import {VeydriftToken} from "../src/VeydriftToken.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {
    VeydriftCrystal,
    VeydriftDeuterium,
    VeydriftMetal,
    VeydriftResourceToken
} from "../src/VeydriftResourceToken.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

interface IUniswapCCAForkBidder {
    function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes calldata hookData)
        external
        payable
        returns (uint256 bidId);
}

interface IUniswapPermit2Fork {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

contract VeydriftUniswapForkResource is ERC20 {
    constructor(string memory name_, string memory symbol_, address recipient)
        ERC20(name_, symbol_)
    {
        _mint(recipient, 10_000_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract VeydriftUniswapForkMainLaunch is IVeydriftMainLaunch {
    bool public constant migrationSucceeded = true;
    address public immutable launchToken;
    address public immutable positionLock;

    constructor(address token_, address lock_) {
        launchToken = token_;
        positionLock = lock_;
    }
}

/// @dev This test deliberately creates only fork-local contracts and never broadcasts.
contract VeydriftUniswapLaunchMainnetForkTest is Test {
    uint256 internal constant FORK_BLOCK = 48_937_745;
    address internal constant LAUNCH_AUTHORITY = 0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4;
    address internal constant LP_FEE_BENEFICIARY = 0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE;
    uint64 internal constant LP_UNLOCK_AT = 1_816_801_200; // 2027-07-28 19:00 UTC
    uint128 internal constant REQUIRED_WETH_RAISED = 27 ether;
    uint128 internal constant FORK_BID_WETH = 54 ether;
    // 27 WETH / 250M VEYDRIFT, represented as WETH-per-VEYDRIFT Q96. This is the
    // approved $0.00020 reference floor at the approval-time ETH reference price.
    uint256 internal constant FLOOR_PRICE_Q96 = 8_556_641_551_540_548_460_102;
    bytes32 internal constant FORK_BLOCK_HASH =
        0x2c24db6fbd731f5bf6690544e6d77aabfefc8e9fbf76b166f3668b0bc0246051;
    bytes32 internal constant COMPILER_SETTINGS_HASH =
        0x3b1b21744b923b65a0a22a2373d2aecd494b9ff8824328b868465c4097885145;
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    address internal constant GAME_PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant METAL_PROXY = 0x91A4f8A9D05F21E010dc1eE0B17Ab644D433cB41;
    address internal constant CRYSTAL_PROXY = 0xC6881a2C4C50E28AdCaC4D5577cD8e211E806B76;
    address internal constant DEUTERIUM_PROXY = 0x5A6027DE1C7E52B4b1AD0c13c3eC3Ad5FCb481e2;

    struct ReserveEvidence {
        VeydriftGameStorage.Resources requirement;
        VeydriftGameStorage.Resources balanceBefore;
        VeydriftGameStorage.Resources releaseAmount;
        VeydriftGameStorage.Resources margin;
        VeydriftGameStorage.Resources balanceAfter;
    }

    struct MainAssetBalances {
        uint256 veydriftStrategy;
        uint256 wethStrategy;
        uint256 veydriftAuction;
        uint256 wethAuction;
        uint256 veydriftPoolManager;
        uint256 wethPoolManager;
        uint256 veydriftPositionManager;
        uint256 wethPositionManager;
        uint256 veydriftRecoveryRecipient;
        uint256 wethRecoveryRecipient;
    }

    struct MainMigrationEvidence {
        MainAssetBalances beforeBalances;
        MainAssetBalances afterBalances;
        bytes32 receiptAndDeltaHash;
    }

    struct ManifestContext {
        address authority;
        VeydriftToken token;
        VeydriftV4PositionLock lock;
        VeydriftUniswapCCALauncher launcher;
        IUniswapCCAAuction auction;
        VeydriftUniswapResourcePools resourceLauncher;
        VeydriftUniswapCCALauncher.LaunchConfig config;
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] resourceConfigs;
        uint256 mainPositionId;
        uint256[3] resourcePositionIds;
        ReserveEvidence reserveEvidence;
        MainMigrationEvidence mainMigrationEvidence;
        uint256[4] positionManagerDonations;
    }

    function testBaseForkOfficialCCARegistrationAndAllocation() public {
        string memory rpcUrl = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl, FORK_BLOCK);
        assertEq(block.chainid, VeydriftUniswapDeployments.BASE_CHAIN_ID);

        address authority = LAUNCH_AUTHORITY;
        address tokenDonor = makeAddr("fork-token-donor");
        VeydriftToken token = new VeydriftToken(
            authority,
            authority,
            tokenDonor,
            makeAddr("fork-contributor-vesting"),
            makeAddr("fork-ecosystem-vesting")
        );
        VeydriftV4PositionLock lock = new VeydriftV4PositionLock(
            VeydriftUniswapDeployments.POSITION_MANAGER, LP_FEE_BENEFICIARY, LP_UNLOCK_AT
        );
        VeydriftUniswapCCALauncher launcher = new VeydriftUniswapCCALauncher(authority, lock);

        uint64 startBlock = uint64(block.number + 20);
        VeydriftUniswapCCALauncher.LaunchConfig memory config =
            VeydriftUniswapCCALauncher.LaunchConfig({
                tokensRecipient: authority,
                recoveryRecipient: authority,
                startBlock: startBlock,
                endBlock: startBlock + 86_400,
                claimBlock: startBlock + 86_400,
                migrationBlock: startBlock + 86_410,
                auctionTickSpacingQ96: 2,
                floorPriceQ96: FLOOR_PRICE_Q96,
                requiredWethRaised: REQUIRED_WETH_RAISED,
                auctionStepsData: abi.encodePacked(
                    uint24(115), uint40(22_400), uint24(116), uint40(64_000)
                ),
                v4Fee: 3_000,
                v4TickSpacing: 60,
                lpCurrencyRateMps: 10_000_000
            });
        bytes32 salt = keccak256("VEY-KANEO-741-BASE-FORK");

        (address predictedAuction,, bytes32 mainPoolId) =
            launcher.preflight(address(token), config, salt);
        assertEq(predictedAuction.code.length, 0);
        assertTrue(mainPoolId != bytes32(0));

        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        address auction = launcher.launch(address(token), config, salt);
        vm.stopPrank();

        assertEq(auction, predictedAuction);
        assertGt(auction.code.length, 0);
        assertEq(token.balanceOf(auction), 250_000_000 ether);
        assertEq(token.balanceOf(VeydriftUniswapDeployments.LBP_STRATEGY), 250_000_000 ether);
        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.allowance(authority, address(launcher)), 0);
        assertEq(token.allowance(address(launcher), VeydriftUniswapDeployments.LBP_STRATEGY), 0);

        IUniswapCCAAuction registered = IUniswapCCAAuction(auction);
        assertEq(registered.token(), address(token));
        assertEq(registered.currency(), VeydriftUniswapDeployments.WETH);
        assertEq(registered.totalSupply(), 250_000_000 ether);
        assertEq(registered.fundsRecipient(), VeydriftUniswapDeployments.LBP_STRATEGY);
        assertEq(registered.tokensRecipient(), config.tokensRecipient);
        assertEq(registered.startBlock(), config.startBlock);
        assertEq(launcher.BASE_48_HOUR_BLOCKS(), 86_400);
        assertEq(registered.endBlock() - registered.startBlock(), 86_400);
        assertEq(registered.validationHook(), address(0));

        address bidder = makeAddr("fork-weth-bidder");
        deal(VeydriftUniswapDeployments.WETH, bidder, FORK_BID_WETH);
        vm.roll(config.startBlock);
        vm.startPrank(bidder);
        IERC20(VeydriftUniswapDeployments.WETH)
            .approve(VeydriftUniswapDeployments.PERMIT2, FORK_BID_WETH);
        IUniswapPermit2Fork(VeydriftUniswapDeployments.PERMIT2)
            .approve(VeydriftUniswapDeployments.WETH, auction, FORK_BID_WETH, type(uint48).max);
        IUniswapCCAForkBidder(auction).submitBid(1 << 96, FORK_BID_WETH, bidder, bytes(""));
        vm.stopPrank();

        vm.roll(config.endBlock);
        (bool checkpointed,) = auction.call(abi.encodeWithSignature("checkpoint()"));
        assertTrue(checkpointed);
        assertTrue(registered.isGraduated());
        assertGt(registered.clearingPrice(), config.floorPriceQ96);

        uint256 expectedPositionId =
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER).nextTokenId();
        MainMigrationEvidence memory mainMigrationEvidence;
        mainMigrationEvidence.beforeBalances =
            _mainAssetBalances(address(token), auction, config.recoveryRecipient);
        vm.roll(config.migrationBlock);
        vm.prank(makeAddr("fork-permissionless-migrator"));
        IUniswapLBPStrategy(VeydriftUniswapDeployments.LBP_STRATEGY).migrate(auction);
        mainMigrationEvidence.afterBalances =
            _mainAssetBalances(address(token), auction, config.recoveryRecipient);
        mainMigrationEvidence.receiptAndDeltaHash = keccak256(
            abi.encode(
                block.chainid,
                auction,
                expectedPositionId,
                mainMigrationEvidence.beforeBalances,
                mainMigrationEvidence.afterBalances
            )
        );
        _assertMainMigrationFlows(mainMigrationEvidence);
        assertFalse(launcher.migrationAttempted());
        vm.prank(authority);
        assertTrue(
            launcher.reconcileMigration(
                expectedPositionId, mainMigrationEvidence.receiptAndDeltaHash
            )
        );
        assertTrue(launcher.migrationSucceeded());
        assertEq(launcher.reconciliationEvidenceHash(), mainMigrationEvidence.receiptAndDeltaHash);
        assertEq(launcher.mainPositionTokenId(), expectedPositionId);
        assertEq(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .ownerOf(expectedPositionId),
            address(lock)
        );
        assertEq(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .balanceOf(address(lock)),
            1
        );

        _launchUnrelatedResourcePositions(authority, lock, config.recoveryRecipient);
        assertEq(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .balanceOf(address(lock)),
            4
        );

        ReserveEvidence memory reserveEvidence = _upgradeAndReleaseResources(authority);
        VeydriftResourceToken metal = VeydriftResourceToken(METAL_PROXY);
        VeydriftResourceToken crystal = VeydriftResourceToken(CRYSTAL_PROXY);
        VeydriftResourceToken deuterium = VeydriftResourceToken(DEUTERIUM_PROXY);
        uint256 donatedVeydrift = 7 ether;
        uint256 donatedMetal = 11;
        uint256 donatedCrystal = 13;
        uint256 donatedDeuterium = 17;
        vm.prank(tokenDonor);
        assertTrue(token.transfer(VeydriftUniswapDeployments.POSITION_MANAGER, donatedVeydrift));
        deal(METAL_PROXY, VeydriftUniswapDeployments.POSITION_MANAGER, donatedMetal, false);
        deal(CRYSTAL_PROXY, VeydriftUniswapDeployments.POSITION_MANAGER, donatedCrystal, false);
        deal(DEUTERIUM_PROXY, VeydriftUniswapDeployments.POSITION_MANAGER, donatedDeuterium, false);
        VeydriftUniswapResourcePools resourceLauncher = new VeydriftUniswapResourcePools(
            authority,
            config.recoveryRecipient,
            IVeydriftMainLaunch(address(launcher)),
            address(metal),
            address(crystal),
            address(deuterium),
            lock
        );
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory resourceConfigs;
        resourceConfigs[0] = _resourceConfig(address(token), address(metal), 333_333_000);
        resourceConfigs[1] = _resourceConfig(address(token), address(crystal), 222_222_000);
        resourceConfigs[2] = _resourceConfig(address(token), address(deuterium), 133_333_000);

        vm.startPrank(authority);
        token.approve(address(resourceLauncher), 150_000_000 ether);
        metal.approve(address(resourceLauncher), 333_333_000);
        crystal.approve(address(resourceLauncher), 222_222_000);
        deuterium.approve(address(resourceLauncher), 133_333_000);
        (, uint256[3] memory resourcePositionIds) =
            resourceLauncher.launchResourcePools(resourceConfigs, block.timestamp + 30 minutes);
        vm.stopPrank();

        assertEq(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .balanceOf(address(lock)),
            7
        );
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                    .ownerOf(resourcePositionIds[i]),
                address(lock)
            );
        }

        // The lock may realize and forward accrued fees during the lock, but a fee collection
        // must not reduce principal liquidity or transfer the position NFT.
        IUniswapV4PositionManager manager =
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER);
        uint256 mainLiquidityBefore = manager.getPositionLiquidity(expectedPositionId);
        vm.prank(makeAddr("fork-permissionless-fee-collector"));
        lock.collectFees(expectedPositionId);
        assertEq(manager.getPositionLiquidity(expectedPositionId), mainLiquidityBefore);
        assertEq(manager.ownerOf(expectedPositionId), address(lock));

        assertEq(token.allowance(authority, address(resourceLauncher)), 0);
        assertEq(metal.allowance(authority, address(resourceLauncher)), 0);
        assertEq(crystal.allowance(authority, address(resourceLauncher)), 0);
        assertEq(deuterium.allowance(authority, address(resourceLauncher)), 0);
        assertEq(token.balanceOf(address(resourceLauncher)), 0);
        assertEq(token.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER), donatedVeydrift);
        assertEq(metal.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER), donatedMetal);
        assertEq(crystal.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER), donatedCrystal);
        assertEq(deuterium.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER), donatedDeuterium);
        uint256 expectedResourceVeydriftDust;
        for (uint256 i = 0; i < 3; i++) {
            address resourceToken =
                i == 0 ? address(metal) : i == 1 ? address(crystal) : address(deuterium);
            bool veydriftIsCurrency0 = address(token) < resourceToken;
            uint256 maximum =
                veydriftIsCurrency0 ? resourceConfigs[i].amount0Max : resourceConfigs[i].amount1Max;
            uint256 used = veydriftIsCurrency0
                ? resourceLauncher.amount0Used(i)
                : resourceLauncher.amount1Used(i);
            expectedResourceVeydriftDust += maximum - used;
        }
        uint256 expectedMainRecoveryVeydrift =
            mainMigrationEvidence.afterBalances.veydriftRecoveryRecipient
                - mainMigrationEvidence.beforeBalances.veydriftRecoveryRecipient;
        assertEq(
            token.balanceOf(authority), expectedMainRecoveryVeydrift + expectedResourceVeydriftDust
        );
        assertGe(
            reserveEvidence.balanceAfter.metal,
            uint256(reserveEvidence.requirement.metal) + reserveEvidence.margin.metal
        );
        assertGe(
            reserveEvidence.balanceAfter.crystal,
            uint256(reserveEvidence.requirement.crystal) + reserveEvidence.margin.crystal
        );
        assertGe(
            reserveEvidence.balanceAfter.deuterium,
            uint256(reserveEvidence.requirement.deuterium) + reserveEvidence.margin.deuterium
        );

        ManifestContext memory manifest;
        manifest.authority = authority;
        manifest.token = token;
        manifest.lock = lock;
        manifest.launcher = launcher;
        manifest.auction = registered;
        manifest.resourceLauncher = resourceLauncher;
        manifest.config = config;
        manifest.resourceConfigs = resourceConfigs;
        manifest.mainPositionId = expectedPositionId;
        manifest.resourcePositionIds = resourcePositionIds;
        manifest.reserveEvidence = reserveEvidence;
        manifest.mainMigrationEvidence = mainMigrationEvidence;
        manifest.positionManagerDonations =
            [donatedVeydrift, donatedMetal, donatedCrystal, donatedDeuterium];
        _writeManifestIfRequested(manifest);
    }

    function _mainAssetBalances(address token, address auction_, address recoveryRecipient)
        private
        view
        returns (MainAssetBalances memory balances)
    {
        IERC20 veydrift = IERC20(token);
        IERC20 weth = IERC20(VeydriftUniswapDeployments.WETH);
        balances.veydriftStrategy = veydrift.balanceOf(VeydriftUniswapDeployments.LBP_STRATEGY);
        balances.wethStrategy = weth.balanceOf(VeydriftUniswapDeployments.LBP_STRATEGY);
        balances.veydriftAuction = veydrift.balanceOf(auction_);
        balances.wethAuction = weth.balanceOf(auction_);
        balances.veydriftPoolManager = veydrift.balanceOf(VeydriftUniswapDeployments.POOL_MANAGER);
        balances.wethPoolManager = weth.balanceOf(VeydriftUniswapDeployments.POOL_MANAGER);
        balances.veydriftPositionManager =
            veydrift.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER);
        balances.wethPositionManager = weth.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER);
        balances.veydriftRecoveryRecipient = veydrift.balanceOf(recoveryRecipient);
        balances.wethRecoveryRecipient = weth.balanceOf(recoveryRecipient);
    }

    function _assertMainMigrationFlows(MainMigrationEvidence memory evidence) private pure {
        MainAssetBalances memory beforeBalances = evidence.beforeBalances;
        MainAssetBalances memory afterBalances = evidence.afterBalances;
        uint256 veydriftOutflow = beforeBalances.veydriftStrategy - afterBalances.veydriftStrategy;
        uint256 veydriftDestinations = afterBalances.veydriftPoolManager
            - beforeBalances.veydriftPoolManager + afterBalances.veydriftPositionManager
            - beforeBalances.veydriftPositionManager + afterBalances.veydriftRecoveryRecipient
            - beforeBalances.veydriftRecoveryRecipient;
        uint256 wethOutflow = beforeBalances.wethAuction - afterBalances.wethAuction;
        uint256 wethDestinations = afterBalances.wethPoolManager - beforeBalances.wethPoolManager
            + afterBalances.wethPositionManager - beforeBalances.wethPositionManager
            + afterBalances.wethRecoveryRecipient - beforeBalances.wethRecoveryRecipient
            + afterBalances.wethStrategy - beforeBalances.wethStrategy;
        assertEq(veydriftOutflow, 250_000_000 ether);
        assertEq(veydriftOutflow, veydriftDestinations);
        assertEq(wethOutflow, FORK_BID_WETH);
        assertEq(wethOutflow, wethDestinations);
        assertGt(afterBalances.veydriftPoolManager - beforeBalances.veydriftPoolManager, 0);
        assertGt(afterBalances.wethPoolManager - beforeBalances.wethPoolManager, 0);
        assertEq(afterBalances.veydriftPositionManager, beforeBalances.veydriftPositionManager);
        assertEq(afterBalances.wethPositionManager, beforeBalances.wethPositionManager);
        assertTrue(evidence.receiptAndDeltaHash != bytes32(0));
    }

    function _writeManifestIfRequested(ManifestContext memory context) private {
        string memory outputPath = vm.envOr("VEYDRIFT_MANIFEST_PATH", string(""));
        if (bytes(outputPath).length == 0) return;
        string memory sourceCommit = vm.envOr("VEYDRIFT_SOURCE_COMMIT", string(""));
        require(bytes(sourceCommit).length == 40, "VEYDRIFT_SOURCE_COMMIT_REQUIRED");

        string memory object = "vey741-deterministic-fork-manifest";
        vm.serializeString(object, "schema", "veydrift.uniswap-launch-manifest.v2");
        vm.serializeString(object, "task", "VEY-KANEO-741");
        vm.serializeString(object, "environment", "base-mainnet-fork");
        vm.serializeBool(object, "broadcast", false);
        vm.serializeBool(object, "statusPassed", true);
        vm.serializeString(object, "sourceCommit", sourceCommit);
        vm.serializeString(object, "compilerVersion", "0.8.28");
        vm.serializeBytes32(object, "compilerSettingsHash", COMPILER_SETTINGS_HASH);
        vm.serializeUint(object, "chainId", block.chainid);
        vm.serializeString(object, "chainName", "Base");
        vm.serializeUint(object, "forkBlockNumber", FORK_BLOCK);
        vm.serializeBytes32(object, "forkBlockHash", FORK_BLOCK_HASH);
        vm.serializeUint(object, "forkBlockTimestamp", 1_784_664_837);

        _serializeOfficialDeployments(object);
        vm.serializeAddress(object, "tokenAddress", address(context.token));
        vm.serializeBytes32(object, "tokenRuntimeCodehash", address(context.token).codehash);
        _serializeUintString(object, "tokenTotalSupplyWei", context.token.totalSupply());
        vm.serializeAddress(object, "launchAuthority", context.authority);
        vm.serializeAddress(object, "mainLauncherAddress", address(context.launcher));
        vm.serializeAddress(object, "resourceLauncherAddress", address(context.resourceLauncher));
        vm.serializeAddress(object, "positionLockAddress", address(context.lock));
        vm.serializeAddress(object, "positionLockBeneficiary", context.lock.beneficiary());
        vm.serializeUint(object, "positionLockUnlockAt", context.lock.unlockAt());

        _serializeAllocation(object);
        _serializeAuction(object, context);
        _serializeMainPool(object, context);
        for (uint256 i = 0; i < 3; i++) {
            _serializeResourcePool(object, context, i);
        }
        _serializeReserveEvidence(object, context.reserveEvidence);
        _serializeApprovals(object, context);

        _serializeUintString(
            object,
            "mainLauncherResidualTokenWei",
            context.token.balanceOf(address(context.launcher))
        );
        _serializeUintString(
            object,
            "resourceLauncherResidualTokenWei",
            context.token.balanceOf(address(context.resourceLauncher))
        );
        vm.serializeUint(
            object, "positionLockCanonicalPositionCount", 1 + context.resourcePositionIds.length
        );
        vm.serializeUint(
            object,
            "positionLockObservedPositionCount",
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .balanceOf(address(context.lock))
        );
        vm.serializeBool(object, "aerodromeSeededByDryRun", false);
        vm.serializeBool(object, "resourceWethSeededByDryRun", false);
        vm.serializeBool(object, "resourceStableSeededByDryRun", false);
        vm.serializeBool(object, "duplicateVenueSeededByDryRun", false);
        vm.serializeString(
            object,
            "generationCommand",
            "BASE_MAINNET_RPC_URL=<public-or-redacted> VEYDRIFT_SOURCE_COMMIT=<40-hex> VEYDRIFT_MANIFEST_PATH=manifests/vey-741-base-fork-dry-run.json forge test --match-path test/VeydriftUniswapLaunchMainnetFork.t.sol -vv"
        );
        string memory json = vm.serializeString(object, "testResult", "1 passed; 0 failed");
        vm.writeJson(json, outputPath);
    }

    function _serializeOfficialDeployments(string memory object) private {
        _serializeDeployment(
            object,
            "officialWeth",
            VeydriftUniswapDeployments.WETH,
            VeydriftUniswapDeployments.WETH_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialCcaFactory",
            VeydriftUniswapDeployments.CCA_FACTORY,
            VeydriftUniswapDeployments.CCA_FACTORY_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialLbpStrategy",
            VeydriftUniswapDeployments.LBP_STRATEGY,
            VeydriftUniswapDeployments.LBP_STRATEGY_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialPoolManager",
            VeydriftUniswapDeployments.POOL_MANAGER,
            VeydriftUniswapDeployments.POOL_MANAGER_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialPositionManager",
            VeydriftUniswapDeployments.POSITION_MANAGER,
            VeydriftUniswapDeployments.POSITION_MANAGER_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialStateView",
            VeydriftUniswapDeployments.STATE_VIEW,
            VeydriftUniswapDeployments.STATE_VIEW_CODEHASH
        );
        _serializeDeployment(
            object,
            "officialPermit2",
            VeydriftUniswapDeployments.PERMIT2,
            VeydriftUniswapDeployments.PERMIT2_CODEHASH
        );
    }

    function _serializeDeployment(
        string memory object,
        string memory prefix,
        address deployment,
        bytes32 expectedCodehash
    ) private {
        vm.serializeAddress(object, string.concat(prefix, "Address"), deployment);
        vm.serializeBytes32(object, string.concat(prefix, "Codehash"), deployment.codehash);
        vm.serializeBytes32(object, string.concat(prefix, "ExpectedCodehash"), expectedCodehash);
    }

    function _serializeAllocation(string memory object) private {
        _serializeUintString(object, "allocationTotalWei", 1_000_000_000 ether);
        _serializeUintString(object, "allocationLaunchBootstrapWei", 500_000_000 ether);
        _serializeUintString(object, "allocationCcaWei", 250_000_000 ether);
        _serializeUintString(object, "allocationV4MainWei", 250_000_000 ether);
        _serializeUintString(object, "allocationResourcePoolsWei", 150_000_000 ether);
        _serializeUintString(object, "allocationDevelopmentWei", 150_000_000 ether);
        _serializeUintString(object, "allocationContributorsWei", 100_000_000 ether);
        _serializeUintString(object, "allocationEcosystemWei", 100_000_000 ether);
    }

    function _serializeAuction(string memory object, ManifestContext memory context) private {
        vm.serializeAddress(object, "auctionAddress", address(context.auction));
        vm.serializeAddress(object, "auctionToken", context.auction.token());
        vm.serializeAddress(object, "auctionCurrency", context.auction.currency());
        vm.serializeAddress(object, "auctionTokensRecipient", context.auction.tokensRecipient());
        vm.serializeAddress(object, "auctionFundsRecipient", context.auction.fundsRecipient());
        _serializeUintString(object, "auctionSupplyWei", context.auction.totalSupply());
        vm.serializeUint(object, "auctionStartBlock", context.auction.startBlock());
        vm.serializeUint(object, "auctionEndBlock", context.auction.endBlock());
        vm.serializeUint(object, "auctionClaimBlock", context.auction.claimBlock());
        vm.serializeUint(object, "auctionMigrationBlock", context.config.migrationBlock);
        vm.serializeUint(
            object,
            "auctionDurationBlocks",
            context.auction.endBlock() - context.auction.startBlock()
        );
        vm.serializeUint(object, "auctionDurationHoursTarget", 48);
        vm.serializeAddress(object, "auctionValidationHook", context.auction.validationHook());
        _serializeUintString(object, "auctionTickSpacingQ96", context.auction.tickSpacing());
        _serializeUintString(object, "auctionFloorPriceQ96", context.auction.floorPrice());
        _serializeUintString(object, "auctionRequiredWethWei", context.config.requiredWethRaised);
        _serializeUintString(object, "auctionTestBidWethWei", FORK_BID_WETH);
        _serializeUintString(object, "auctionClearingPriceQ96", context.auction.clearingPrice());
        vm.serializeBool(object, "auctionGraduated", context.auction.isGraduated());
        vm.serializeBool(object, "migrationAttempted", context.launcher.migrationAttempted());
        vm.serializeBool(object, "migrationSucceeded", context.launcher.migrationSucceeded());
        vm.serializeBytes32(object, "launchConfigurationHash", context.launcher.configurationHash());
        vm.serializeBytes32(
            object, "migrationParametersHash", context.launcher.migrationParametersHash()
        );
        vm.serializeBytes32(
            object, "reconciliationEvidenceHash", context.launcher.reconciliationEvidenceHash()
        );
    }

    function _serializeMainPool(string memory object, ManifestContext memory context) private {
        IUniswapV4PositionManager manager =
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER);
        (VeydriftV4PoolKey memory key, uint256 info) =
            manager.getPoolAndPositionInfo(context.mainPositionId);
        bytes32 poolId = keccak256(abi.encode(key));
        (uint160 sqrtPriceX96,,,) =
            IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(poolId);
        _serializePosition(object, "main", context.mainPositionId, poolId, key, info, sqrtPriceX96);
        _serializeUintString(
            object, "mainPositionLiquidity", manager.getPositionLiquidity(context.mainPositionId)
        );
        _serializeMainMigrationEvidence(object, context.mainMigrationEvidence);
        _serializeUintString(
            object, "veydriftPositionManagerDonationBefore", context.positionManagerDonations[0]
        );
        _serializeUintString(
            object,
            "veydriftPositionManagerDonationAfter",
            context.token.balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER)
        );
    }

    function _serializeMainMigrationEvidence(
        string memory object,
        MainMigrationEvidence memory evidence
    ) private {
        MainAssetBalances memory beforeBalances = evidence.beforeBalances;
        MainAssetBalances memory afterBalances = evidence.afterBalances;
        vm.serializeBytes32(object, "mainMigrationEvidenceHash", evidence.receiptAndDeltaHash);
        _serializeObservedOutflow(
            object,
            "mainVeydriftStrategy",
            beforeBalances.veydriftStrategy,
            afterBalances.veydriftStrategy
        );
        _serializeObservedOutflow(
            object, "mainWethAuction", beforeBalances.wethAuction, afterBalances.wethAuction
        );
        _serializeObservedInflow(
            object,
            "mainVeydriftPoolManager",
            beforeBalances.veydriftPoolManager,
            afterBalances.veydriftPoolManager
        );
        _serializeObservedInflow(
            object,
            "mainWethPoolManager",
            beforeBalances.wethPoolManager,
            afterBalances.wethPoolManager
        );
        _serializeObservedInflow(
            object,
            "mainVeydriftPositionManager",
            beforeBalances.veydriftPositionManager,
            afterBalances.veydriftPositionManager
        );
        _serializeObservedInflow(
            object,
            "mainWethPositionManager",
            beforeBalances.wethPositionManager,
            afterBalances.wethPositionManager
        );
        _serializeObservedInflow(
            object,
            "mainVeydriftRecoveryRecipient",
            beforeBalances.veydriftRecoveryRecipient,
            afterBalances.veydriftRecoveryRecipient
        );
        _serializeObservedInflow(
            object,
            "mainWethRecoveryRecipient",
            beforeBalances.wethRecoveryRecipient,
            afterBalances.wethRecoveryRecipient
        );
        _serializeObservedInflow(
            object, "mainWethStrategy", beforeBalances.wethStrategy, afterBalances.wethStrategy
        );
        _serializeUintString(
            object,
            "mainVeydriftReservedWei",
            beforeBalances.veydriftStrategy - afterBalances.veydriftStrategy
        );
        _serializeUintString(
            object, "mainWethBidInputWei", beforeBalances.wethAuction - afterBalances.wethAuction
        );
    }

    function _serializeObservedOutflow(
        string memory object,
        string memory prefix,
        uint256 beforeBalance,
        uint256 afterBalance
    ) private {
        _serializeUintString(object, string.concat(prefix, "BeforeWei"), beforeBalance);
        _serializeUintString(object, string.concat(prefix, "AfterWei"), afterBalance);
        _serializeUintString(
            object, string.concat(prefix, "OutflowWei"), beforeBalance - afterBalance
        );
    }

    function _serializeObservedInflow(
        string memory object,
        string memory prefix,
        uint256 beforeBalance,
        uint256 afterBalance
    ) private {
        _serializeUintString(object, string.concat(prefix, "BeforeWei"), beforeBalance);
        _serializeUintString(object, string.concat(prefix, "AfterWei"), afterBalance);
        _serializeUintString(
            object, string.concat(prefix, "InflowWei"), afterBalance - beforeBalance
        );
    }

    function _serializeResourcePool(
        string memory object,
        ManifestContext memory context,
        uint256 index
    ) private {
        string memory prefix = string.concat("resource", vm.toString(index));
        address resourceToken = index == 0
            ? context.resourceLauncher.metal()
            : index == 1 ? context.resourceLauncher.crystal() : context.resourceLauncher.deuterium();
        vm.serializeAddress(object, string.concat(prefix, "Token"), resourceToken);
        vm.serializeBytes32(object, string.concat(prefix, "TokenCodehash"), resourceToken.codehash);
        _serializeUintString(
            object,
            string.concat(prefix, "TokenTotalSupplyRaw"),
            IERC20(resourceToken).totalSupply()
        );
        VeydriftUniswapResourcePools.ResourcePoolConfig memory config =
            context.resourceConfigs[index];
        _serializeUintString(object, string.concat(prefix, "Amount0Max"), config.amount0Max);
        _serializeUintString(object, string.concat(prefix, "Amount1Max"), config.amount1Max);
        _serializeUintString(object, string.concat(prefix, "Amount0Min"), config.amount0Min);
        _serializeUintString(object, string.concat(prefix, "Amount1Min"), config.amount1Min);
        uint256 used0 = context.resourceLauncher.amount0Used(index);
        uint256 used1 = context.resourceLauncher.amount1Used(index);
        _serializeUintString(object, string.concat(prefix, "Amount0Used"), used0);
        _serializeUintString(object, string.concat(prefix, "Amount1Used"), used1);
        _serializeUintString(
            object, string.concat(prefix, "Amount0Dust"), config.amount0Max - used0
        );
        _serializeUintString(
            object, string.concat(prefix, "Amount1Dust"), config.amount1Max - used1
        );
        _serializeUintString(
            object, string.concat(prefix, "ConfiguredSqrtPriceX96"), config.sqrtPriceX96
        );
        IUniswapV4PositionManager manager =
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER);
        uint256 tokenId = context.resourcePositionIds[index];
        (VeydriftV4PoolKey memory key, uint256 info) = manager.getPoolAndPositionInfo(tokenId);
        bytes32 poolId = context.resourceLauncher.poolIds(index);
        (uint160 sqrtPriceX96,,,) =
            IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(poolId);
        _serializePosition(object, prefix, tokenId, poolId, key, info, sqrtPriceX96);
        _serializeUintString(
            object,
            string.concat(prefix, "PositionLiquidity"),
            manager.getPositionLiquidity(tokenId)
        );
        _serializeUintString(
            object,
            string.concat(prefix, "PositionManagerDonationBefore"),
            context.positionManagerDonations[index + 1]
        );
        _serializeUintString(
            object,
            string.concat(prefix, "PositionManagerDonationAfter"),
            IERC20(resourceToken).balanceOf(VeydriftUniswapDeployments.POSITION_MANAGER)
        );
    }

    function _serializePosition(
        string memory object,
        string memory prefix,
        uint256 tokenId,
        bytes32 poolId,
        VeydriftV4PoolKey memory key,
        uint256 info,
        uint160 sqrtPriceX96
    ) private {
        vm.serializeBytes32(object, string.concat(prefix, "PoolId"), poolId);
        vm.serializeAddress(object, string.concat(prefix, "Currency0"), key.currency0);
        vm.serializeAddress(object, string.concat(prefix, "Currency1"), key.currency1);
        vm.serializeUint(object, string.concat(prefix, "Fee"), key.fee);
        vm.serializeInt(object, string.concat(prefix, "TickSpacing"), key.tickSpacing);
        vm.serializeAddress(object, string.concat(prefix, "Hook"), key.hooks);
        _serializeUintString(object, string.concat(prefix, "SqrtPriceX96"), sqrtPriceX96);
        _serializeUintString(object, string.concat(prefix, "PositionTokenId"), tokenId);
        vm.serializeAddress(
            object,
            string.concat(prefix, "PositionOwner"),
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER).ownerOf(tokenId)
        );
        int24 tickLower;
        int24 tickUpper;
        assembly ("memory-safe") {
            tickLower := signextend(2, shr(8, info))
            tickUpper := signextend(2, shr(32, info))
        }
        vm.serializeInt(object, string.concat(prefix, "TickLower"), tickLower);
        vm.serializeInt(object, string.concat(prefix, "TickUpper"), tickUpper);
    }

    function _serializeReserveEvidence(string memory object, ReserveEvidence memory evidence)
        private
    {
        address[3] memory proxies = [METAL_PROXY, CRYSTAL_PROXY, DEUTERIUM_PROXY];
        uint128[3] memory requirement = [
            evidence.requirement.metal, evidence.requirement.crystal, evidence.requirement.deuterium
        ];
        uint128[3] memory beforeBalance = [
            evidence.balanceBefore.metal,
            evidence.balanceBefore.crystal,
            evidence.balanceBefore.deuterium
        ];
        uint128[3] memory releases = [
            evidence.releaseAmount.metal,
            evidence.releaseAmount.crystal,
            evidence.releaseAmount.deuterium
        ];
        uint128[3] memory margins =
            [evidence.margin.metal, evidence.margin.crystal, evidence.margin.deuterium];
        uint128[3] memory afterBalance = [
            evidence.balanceAfter.metal,
            evidence.balanceAfter.crystal,
            evidence.balanceAfter.deuterium
        ];
        for (uint256 i = 0; i < 3; i++) {
            string memory prefix = string.concat("reserve", vm.toString(i));
            vm.serializeAddress(object, string.concat(prefix, "TokenProxy"), proxies[i]);
            address implementation = _addressFromSlot(proxies[i], IMPLEMENTATION_SLOT);
            vm.serializeAddress(
                object, string.concat(prefix, "TokenImplementation"), implementation
            );
            vm.serializeBytes32(
                object,
                string.concat(prefix, "TokenImplementationCodehash"),
                implementation.codehash
            );
            _serializeUintString(object, string.concat(prefix, "LiabilityRaw"), requirement[i]);
            _serializeUintString(
                object, string.concat(prefix, "BalanceBeforeRaw"), beforeBalance[i]
            );
            _serializeUintString(object, string.concat(prefix, "ReleaseRaw"), releases[i]);
            _serializeUintString(object, string.concat(prefix, "ApprovedMarginRaw"), margins[i]);
            _serializeUintString(object, string.concat(prefix, "BalanceAfterRaw"), afterBalance[i]);
        }
    }

    function _serializeApprovals(string memory object, ManifestContext memory context) private {
        uint256 index;
        index = _serializeApproval(
            object, index, address(context.token), context.authority, address(context.launcher)
        );
        index = _serializeApproval(
            object,
            index,
            address(context.token),
            address(context.launcher),
            VeydriftUniswapDeployments.LBP_STRATEGY
        );
        address[4] memory tokens = [
            address(context.token),
            context.resourceLauncher.metal(),
            context.resourceLauncher.crystal(),
            context.resourceLauncher.deuterium()
        ];
        for (uint256 i = 0; i < tokens.length; i++) {
            index = _serializeApproval(
                object, index, tokens[i], context.authority, address(context.resourceLauncher)
            );
            index = _serializeApproval(
                object,
                index,
                tokens[i],
                address(context.resourceLauncher),
                VeydriftUniswapDeployments.PERMIT2
            );
            index = _serializeApproval(
                object,
                index,
                tokens[i],
                address(context.resourceLauncher),
                VeydriftUniswapDeployments.POSITION_MANAGER
            );
        }
        vm.serializeUint(object, "approvalTupleCount", index);
    }

    function _serializeApproval(
        string memory object,
        uint256 index,
        address token,
        address owner,
        address spender
    ) private returns (uint256) {
        string memory prefix = string.concat("approval", vm.toString(index));
        vm.serializeAddress(object, string.concat(prefix, "Token"), token);
        vm.serializeAddress(object, string.concat(prefix, "Owner"), owner);
        vm.serializeAddress(object, string.concat(prefix, "Spender"), spender);
        _serializeUintString(
            object, string.concat(prefix, "Value"), IERC20(token).allowance(owner, spender)
        );
        return index + 1;
    }

    function _serializeUintString(string memory object, string memory key, uint256 value) private {
        vm.serializeString(object, key, vm.toString(value));
    }

    function _launchUnrelatedResourcePositions(
        address authority,
        VeydriftV4PositionLock lock,
        address recoveryRecipient
    ) private {
        VeydriftToken noiseToken = new VeydriftToken(
            authority, authority, authority, authority, authority
        );
        VeydriftUniswapForkMainLaunch noiseMainLaunch =
            new VeydriftUniswapForkMainLaunch(address(noiseToken), address(lock));
        VeydriftUniswapForkResource noiseA =
            new VeydriftUniswapForkResource("Noise A", "nA", authority);
        VeydriftUniswapForkResource noiseB =
            new VeydriftUniswapForkResource("Noise B", "nB", authority);
        VeydriftUniswapForkResource noiseC =
            new VeydriftUniswapForkResource("Noise C", "nC", authority);
        VeydriftUniswapResourcePools noiseLauncher = new VeydriftUniswapResourcePools(
            authority,
            recoveryRecipient,
            noiseMainLaunch,
            address(noiseA),
            address(noiseB),
            address(noiseC),
            lock
        );
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory noiseConfigs;
        noiseConfigs[0] = _resourceConfig(address(noiseToken), address(noiseA), 333_333_000);
        noiseConfigs[1] = _resourceConfig(address(noiseToken), address(noiseB), 222_222_000);
        noiseConfigs[2] = _resourceConfig(address(noiseToken), address(noiseC), 133_333_000);
        vm.startPrank(authority);
        noiseToken.approve(address(noiseLauncher), 150_000_000 ether);
        noiseA.approve(address(noiseLauncher), 333_333_000);
        noiseB.approve(address(noiseLauncher), 222_222_000);
        noiseC.approve(address(noiseLauncher), 133_333_000);
        noiseLauncher.launchResourcePools(noiseConfigs, block.timestamp + 30 minutes);
        vm.stopPrank();
    }

    function _upgradeAndReleaseResources(address recipient)
        private
        returns (ReserveEvidence memory evidence)
    {
        _upgradeResourceToken(VeydriftResourceToken(METAL_PROXY), address(new VeydriftMetal()));
        _upgradeResourceToken(VeydriftResourceToken(CRYSTAL_PROXY), address(new VeydriftCrystal()));
        _upgradeResourceToken(
            VeydriftResourceToken(DEUTERIUM_PROXY), address(new VeydriftDeuterium())
        );

        VeydriftGame game = VeydriftGame(GAME_PROXY);
        evidence.requirement = game.resourceReserveRequirement();
        evidence.balanceBefore = _reserveBalances(game);
        address proxyAdminAddress = _addressFromSlot(GAME_PROXY, ADMIN_SLOT);
        address proxyAdminOwner = ProxyAdmin(proxyAdminAddress).owner();
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGame newImplementation = new VeydriftGame(
            proxyAdminOwner,
            address(new VeydriftFirstPlanetSettlementModule(address(0xBEEF))),
            address(new VeydriftGameplayModule(address(combatModule))),
            address(new VeydriftPlanetManagementModule()),
            address(new VeydriftAttackProtectionModule()),
            address(new VeydriftColonizationModule(address(new VeydriftShipProductionModule()))),
            address(new VeydriftDefenseHoldModule()),
            address(new VeydriftStateMigrationModule(address(0xBEEF))),
            address(new VeydriftAcsAttackModule())
        );
        vm.prank(proxyAdminOwner);
        ProxyAdmin(proxyAdminAddress)
            .upgradeAndCall(
                ITransparentUpgradeableProxy(GAME_PROXY),
                address(newImplementation),
                abi.encodeCall(VeydriftGame.initializeMoonAttackParity, ())
            );

        evidence.releaseAmount = VeydriftGameStorage.Resources({
            metal: 333_333_000, crystal: 222_222_000, deuterium: 133_333_000
        });
        evidence.margin = VeydriftGameStorage.Resources({
            metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000
        });
        vm.prank(game.owner());
        game.releaseExcessResourceReserves(recipient, evidence.releaseAmount, evidence.margin);
        evidence.balanceAfter = _reserveBalances(game);
    }

    function _upgradeResourceToken(VeydriftResourceToken token, address newImplementation) private {
        uint256 supplyBefore = token.totalSupply();
        vm.prank(token.owner());
        token.upgradeToAndCall(newImplementation, "");
        assertEq(token.totalSupply(), supplyBefore);
    }

    function _addressFromSlot(address target, bytes32 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(target, slot))));
    }

    function _reserveBalances(VeydriftGame game)
        private
        view
        returns (VeydriftGameStorage.Resources memory balances)
    {
        uint256 metalBalance = game.resourceReserveBalance(Resource.Metal);
        uint256 crystalBalance = game.resourceReserveBalance(Resource.Crystal);
        uint256 deuteriumBalance = game.resourceReserveBalance(Resource.Deuterium);
        assert(
            metalBalance <= type(uint128).max && crystalBalance <= type(uint128).max
                && deuteriumBalance <= type(uint128).max
        );
        // Bounds asserted above make all three casts lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        balances.metal = uint128(metalBalance);
        // forge-lint: disable-next-line(unsafe-typecast)
        balances.crystal = uint128(crystalBalance);
        // forge-lint: disable-next-line(unsafe-typecast)
        balances.deuterium = uint128(deuteriumBalance);
    }

    function _resourceConfig(address veydrift, address resource, uint256 resourceAmount)
        private
        pure
        returns (VeydriftUniswapResourcePools.ResourcePoolConfig memory config)
    {
        (uint256 amount0, uint256 amount1) = veydrift < resource
            ? (uint256(50_000_000 ether), resourceAmount)
            : (resourceAmount, uint256(50_000_000 ether));
        uint256 geometricMean = Math.sqrt(amount0 * amount1);
        uint160 sqrtPriceX96 = uint160(Math.mulDiv(1 << 96, geometricMean, amount0));
        uint128 liquidity = uint128(Math.mulDiv(geometricMean, 999_999, 1_000_000));
        config = VeydriftUniswapResourcePools.ResourcePoolConfig({
            resourceToken: resource,
            sqrtPriceX96: sqrtPriceX96,
            fee: 3_000,
            tickSpacing: 60,
            liquidity: liquidity,
            amount0Max: amount0,
            amount1Max: amount1,
            amount0Min: Math.mulDiv(amount0, 99, 100),
            amount1Min: Math.mulDiv(amount1, 99, 100)
        });
    }
}
