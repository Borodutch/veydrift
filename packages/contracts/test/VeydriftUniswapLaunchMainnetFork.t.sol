// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    IUniswapCCAAuction,
    IUniswapLBPStrategy,
    IUniswapV4PositionManager,
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";
import {
    IVeydriftMainLaunch,
    VeydriftUniswapResourcePools
} from "../src/VeydriftUniswapResourcePools.sol";

interface IUniswapCCAForkBidder {
    function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes calldata hookData)
        external
        payable
        returns (uint256 bidId);
}

interface IUniswapPermit2Fork {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

contract VeydriftUniswapForkToken is ERC20 {
    constructor(address recipient) ERC20("Veydrift Fork", "fVEY") {
        _mint(recipient, 1_000_000_000 ether);
    }
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

/// @dev This test deliberately creates only fork-local contracts and never broadcasts.
contract VeydriftUniswapLaunchMainnetForkTest is Test {
    function testBaseForkOfficialCCARegistrationAndAllocation() public {
        string memory rpcUrl = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        assertEq(block.chainid, VeydriftUniswapDeployments.BASE_CHAIN_ID);

        address authority = makeAddr("fork-launch-authority");
        VeydriftUniswapForkToken token = new VeydriftUniswapForkToken(authority);
        VeydriftV4PositionLock lock = new VeydriftV4PositionLock(
            VeydriftUniswapDeployments.POSITION_MANAGER,
            makeAddr("fork-lock-beneficiary"),
            uint64(block.timestamp + 365 days)
        );
        VeydriftUniswapCCALauncher launcher = new VeydriftUniswapCCALauncher(authority, lock);

        uint64 startBlock = uint64(block.number + 20);
        VeydriftUniswapCCALauncher.LaunchConfig memory config =
            VeydriftUniswapCCALauncher.LaunchConfig({
                tokensRecipient: makeAddr("fork-unsold-recipient"),
                recoveryRecipient: makeAddr("fork-recovery-recipient"),
                startBlock: startBlock,
                endBlock: startBlock + 1_800,
                claimBlock: startBlock + 1_800,
                migrationBlock: startBlock + 1_810,
                auctionTickSpacingQ96: 2,
                floorPriceQ96: (1 << 32) + 2,
                requiredWethRaised: 1 ether,
                auctionStepsData: abi.encodePacked(
                    uint24(5_555), uint40(1_799), uint24(6_555), uint40(1)
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
        assertEq(registered.endBlock() - registered.startBlock(), 1_800);
        assertEq(registered.validationHook(), address(0));

        address bidder = makeAddr("fork-weth-bidder");
        deal(VeydriftUniswapDeployments.WETH, bidder, 10 ether);
        vm.roll(config.startBlock);
        vm.startPrank(bidder);
        IERC20(VeydriftUniswapDeployments.WETH)
            .approve(VeydriftUniswapDeployments.PERMIT2, 10 ether);
        IUniswapPermit2Fork(VeydriftUniswapDeployments.PERMIT2)
            .approve(VeydriftUniswapDeployments.WETH, auction, 10 ether, type(uint48).max);
        IUniswapCCAForkBidder(auction).submitBid(1 << 96, 10 ether, bidder, bytes(""));
        vm.stopPrank();

        vm.roll(config.endBlock);
        (bool checkpointed,) = auction.call(abi.encodeWithSignature("checkpoint()"));
        assertTrue(checkpointed);
        assertTrue(registered.isGraduated());
        assertGt(registered.clearingPrice(), config.floorPriceQ96);

        uint256 expectedPositionId =
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER).nextTokenId();
        vm.roll(config.migrationBlock);
        vm.prank(makeAddr("fork-permissionless-migrator"));
        IUniswapLBPStrategy(VeydriftUniswapDeployments.LBP_STRATEGY).migrate(auction);
        assertFalse(launcher.migrationAttempted());
        assertTrue(launcher.reconcileMigration(expectedPositionId));
        assertTrue(launcher.migrationSucceeded());
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

        _launchUnrelatedResourcePositions(
            authority, token, launcher, lock, config.recoveryRecipient
        );
        assertEq(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                .balanceOf(address(lock)),
            4
        );

        VeydriftUniswapForkResource metal =
            new VeydriftUniswapForkResource("Fork Metal", "fvMETAL", authority);
        VeydriftUniswapForkResource crystal =
            new VeydriftUniswapForkResource("Fork Crystal", "fvCRYSTAL", authority);
        VeydriftUniswapForkResource deuterium =
            new VeydriftUniswapForkResource("Fork Deuterium", "fvDEUT", authority);
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
        assertEq(token.allowance(authority, address(resourceLauncher)), 0);
        assertEq(metal.allowance(authority, address(resourceLauncher)), 0);
        assertEq(crystal.allowance(authority, address(resourceLauncher)), 0);
        assertEq(deuterium.allowance(authority, address(resourceLauncher)), 0);
        assertEq(token.balanceOf(address(resourceLauncher)), 0);
    }

    function _launchUnrelatedResourcePositions(
        address authority,
        VeydriftUniswapForkToken token,
        VeydriftUniswapCCALauncher mainLauncher,
        VeydriftV4PositionLock lock,
        address recoveryRecipient
    ) private {
        VeydriftUniswapForkResource noiseA =
            new VeydriftUniswapForkResource("Noise A", "nA", authority);
        VeydriftUniswapForkResource noiseB =
            new VeydriftUniswapForkResource("Noise B", "nB", authority);
        VeydriftUniswapForkResource noiseC =
            new VeydriftUniswapForkResource("Noise C", "nC", authority);
        VeydriftUniswapResourcePools noiseLauncher = new VeydriftUniswapResourcePools(
            authority,
            recoveryRecipient,
            IVeydriftMainLaunch(address(mainLauncher)),
            address(noiseA),
            address(noiseB),
            address(noiseC),
            lock
        );
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory noiseConfigs;
        noiseConfigs[0] = _resourceConfig(address(token), address(noiseA), 333_333_000);
        noiseConfigs[1] = _resourceConfig(address(token), address(noiseB), 222_222_000);
        noiseConfigs[2] = _resourceConfig(address(token), address(noiseC), 133_333_000);
        vm.startPrank(authority);
        token.approve(address(noiseLauncher), 150_000_000 ether);
        noiseA.approve(address(noiseLauncher), 333_333_000);
        noiseB.approve(address(noiseLauncher), 222_222_000);
        noiseC.approve(address(noiseLauncher), 133_333_000);
        noiseLauncher.launchResourcePools(noiseConfigs, block.timestamp + 30 minutes);
        vm.stopPrank();
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
