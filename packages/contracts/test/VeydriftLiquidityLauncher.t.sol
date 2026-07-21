// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IAerodromePoolFactory,
    IAerodromeRouter,
    VeydriftLPLock,
    VeydriftLiquidityLauncher
} from "../src/VeydriftLiquidityLauncher.sol";
import {
    VeydriftContributorVestingWallet,
    VeydriftDevelopmentVestingWallet,
    VeydriftEcosystemVestingWallet,
    VeydriftToken
} from "../src/VeydriftToken.sol";

contract MockLaunchToken is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 supply)
        ERC20(name_, symbol_)
    {
        _tokenDecimals = decimals_;
        _mint(msg.sender, supply);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}

contract MockAerodromePool is ERC20 {
    constructor() ERC20("Aerodrome LP", "AERO-LP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAerodromeFactory is IAerodromePoolFactory {
    mapping(bytes32 key => address pool) internal _pools;

    function getPool(address tokenA, address tokenB, bool stable) external view returns (address) {
        return _pools[_key(tokenA, tokenB, stable)];
    }

    function createPool(address tokenA, address tokenB, bool stable)
        external
        returns (address pool)
    {
        bytes32 key = _key(tokenA, tokenB, stable);
        require(_pools[key] == address(0), "POOL_EXISTS");
        pool = address(new MockAerodromePool());
        _pools[key] = pool;
    }

    function _key(address tokenA, address tokenB, bool stable) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, stable));
    }
}

contract MockAerodromeRouter is IAerodromeRouter {
    address public immutable override defaultFactory;
    address public immutable override weth;

    constructor(address factory_, address weth_) {
        defaultFactory = factory_;
        weth = weth_;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(block.timestamp <= deadline, "EXPIRED");
        require(!stable, "STABLE_DISABLED");
        require(amountADesired >= amountAMin && amountBDesired >= amountBMin, "BAD_MINIMUM");

        MockAerodromeFactory factory = MockAerodromeFactory(defaultFactory);
        address pool = factory.getPool(tokenA, tokenB, false);
        if (pool == address(0)) pool = factory.createPool(tokenA, tokenB, false);
        IERC20(tokenA).transferFrom(msg.sender, pool, amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, pool, amountBDesired);
        liquidity = amountADesired < amountBDesired ? amountADesired : amountBDesired;
        MockAerodromePool(pool).mint(to, liquidity);
        return (amountADesired, amountBDesired, liquidity);
    }
}

    contract VeydriftLiquidityLauncherTest is Test {
        uint256 internal constant RESOURCE_SUPPLY = 10_000_000_000 * 1e6;

        address internal authority = address(0xA11CE);
        address internal lpBeneficiary = address(0xBEEF);
        uint64 internal unlockAt;

        VeydriftToken internal veydrift;
        MockLaunchToken internal weth;
        MockLaunchToken internal metal;
        MockLaunchToken internal crystal;
        MockLaunchToken internal deuterium;
        MockAerodromeFactory internal factory;
        MockAerodromeRouter internal router;
        VeydriftLPLock internal lpLock;
        VeydriftLiquidityLauncher internal launcher;

        function setUp() public {
            vm.chainId(8453);
            vm.warp(2_000_000_000);
            unlockAt = uint64(block.timestamp + 2 * 365 days);

            VeydriftDevelopmentVestingWallet development =
                new VeydriftDevelopmentVestingWallet(address(0xD1), uint64(block.timestamp));
            VeydriftContributorVestingWallet contributor =
                new VeydriftContributorVestingWallet(address(0xC1), uint64(block.timestamp));
            VeydriftEcosystemVestingWallet ecosystem =
                new VeydriftEcosystemVestingWallet(address(0xE1), uint64(block.timestamp));
            veydrift = new VeydriftToken(
                authority, authority, address(development), address(contributor), address(ecosystem)
            );
            weth = new MockLaunchToken("Wrapped Ether", "WETH", 18, 10 ether);
            metal = new MockLaunchToken("Veydrift Metal", "vMETAL", 6, RESOURCE_SUPPLY);
            crystal = new MockLaunchToken("Veydrift Crystal", "vCRYSTAL", 6, RESOURCE_SUPPLY);
            deuterium = new MockLaunchToken("Veydrift Deuterium", "vDEUT", 6, RESOURCE_SUPPLY);
            weth.transfer(authority, 2 ether);
            metal.transfer(authority, 333_333_000);
            crystal.transfer(authority, 222_222_000);
            deuterium.transfer(authority, 133_333_000);

            factory = new MockAerodromeFactory();
            router = new MockAerodromeRouter(address(factory), address(weth));
            lpLock = new VeydriftLPLock(lpBeneficiary, unlockAt);
            launcher = new VeydriftLiquidityLauncher(authority, address(router), address(lpLock));
            _approveLaunchAmounts();
        }

        function testWhitepaperLaunchCreatesExactlyFourVolatilePoolsAtExactRatios() public {
            address[4] memory pools = _launch();

            assertEq(factory.getPool(address(veydrift), address(weth), false), pools[0]);
            assertEq(factory.getPool(address(metal), address(veydrift), false), pools[1]);
            assertEq(factory.getPool(address(crystal), address(veydrift), false), pools[2]);
            assertEq(factory.getPool(address(deuterium), address(veydrift), false), pools[3]);
            assertEq(factory.getPool(address(metal), address(weth), false), address(0));
            assertEq(factory.getPool(address(crystal), address(weth), false), address(0));
            assertEq(factory.getPool(address(deuterium), address(weth), false), address(0));

            assertEq(veydrift.balanceOf(pools[0]), 500_000_000 ether);
            assertEq(weth.balanceOf(pools[0]), 2 ether);
            assertEq(metal.balanceOf(pools[1]), 333_333_000);
            assertEq(crystal.balanceOf(pools[2]), 222_222_000);
            assertEq(deuterium.balanceOf(pools[3]), 133_333_000);
            assertEq(veydrift.balanceOf(pools[1]), 50_000_000 ether);
            assertEq(veydrift.balanceOf(pools[2]), 50_000_000 ether);
            assertEq(veydrift.balanceOf(pools[3]), 50_000_000 ether);
            for (uint256 i = 0; i < pools.length; ++i) {
                assertGt(IERC20(pools[i]).balanceOf(address(lpLock)), 0);
            }
            assertTrue(launcher.launched());
        }

        function testLaunchIsAtomicAndRejectsAnExistingCanonicalPool() public {
            address existing = factory.createPool(address(metal), address(veydrift), false);
            uint256 veyBefore = veydrift.balanceOf(authority);

            vm.prank(authority);
            vm.expectRevert(
                abi.encodeWithSelector(
                    VeydriftLiquidityLauncher.ExistingCanonicalPool.selector,
                    address(metal),
                    address(veydrift),
                    existing
                )
            );
            launcher.launch(
                address(veydrift),
                address(metal),
                address(crystal),
                address(deuterium),
                2 ether,
                block.timestamp + 1
            );

            assertEq(veydrift.balanceOf(authority), veyBefore);
            assertFalse(launcher.launched());
        }

        function testLaunchRejectsOverApprovalAndLeavesAllBalancesUntouched() public {
            vm.prank(authority);
            veydrift.approve(address(launcher), 650_000_000 ether + 1);
            uint256 veyBefore = veydrift.balanceOf(authority);

            vm.prank(authority);
            vm.expectRevert(
                abi.encodeWithSelector(
                    VeydriftLiquidityLauncher.ResidualApproval.selector,
                    address(veydrift),
                    authority,
                    address(launcher),
                    1
                )
            );
            launcher.launch(
                address(veydrift),
                address(metal),
                address(crystal),
                address(deuterium),
                2 ether,
                block.timestamp + 1
            );

            assertEq(veydrift.balanceOf(authority), veyBefore);
            assertFalse(launcher.launched());
        }

        function testLaunchCanExecuteOnlyOnceAndOnlyByAuthority() public {
            vm.prank(address(0xBAD));
            vm.expectRevert(
                abi.encodeWithSelector(
                    VeydriftLiquidityLauncher.UnauthorizedLaunch.selector, address(0xBAD)
                )
            );
            launcher.launch(
                address(veydrift),
                address(metal),
                address(crystal),
                address(deuterium),
                2 ether,
                block.timestamp + 1
            );

            _launch();
            vm.prank(authority);
            vm.expectRevert(VeydriftLiquidityLauncher.AlreadyLaunched.selector);
            launcher.launch(
                address(veydrift),
                address(metal),
                address(crystal),
                address(deuterium),
                2 ether,
                block.timestamp + 1
            );
        }

        function testClassicLpTokensStayLockedUntilApprovedTimestamp() public {
            address[4] memory pools = _launch();
            uint256 amount = IERC20(pools[0]).balanceOf(address(lpLock));

            vm.expectRevert(abi.encodeWithSelector(VeydriftLPLock.LPLockActive.selector, unlockAt));
            lpLock.release(pools[0]);

            vm.warp(unlockAt);
            lpLock.release(pools[0]);
            assertEq(IERC20(pools[0]).balanceOf(lpBeneficiary), amount);
            assertEq(IERC20(pools[0]).balanceOf(address(lpLock)), 0);
        }

        function _approveLaunchAmounts() private {
            vm.startPrank(authority);
            veydrift.approve(address(launcher), 650_000_000 ether);
            weth.approve(address(launcher), 2 ether);
            metal.approve(address(launcher), 333_333_000);
            crystal.approve(address(launcher), 222_222_000);
            deuterium.approve(address(launcher), 133_333_000);
            vm.stopPrank();
        }

        function _launch() private returns (address[4] memory pools) {
            vm.prank(authority);
            pools = launcher.launch(
                address(veydrift),
                address(metal),
                address(crystal),
                address(deuterium),
                2 ether,
                block.timestamp + 1
            );
        }
    }
