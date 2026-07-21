// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IUniswapV4PositionManager,
    VeydriftV4PoolKey,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";
import {
    IVeydriftMainLaunch,
    VeydriftUniswapResourcePools
} from "../src/VeydriftUniswapResourcePools.sol";

contract ResourcePoolsMockToken is ERC20 {
    uint8 internal immutable tokenDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply,
        address to
    ) ERC20(name_, symbol_) {
        tokenDecimals = decimals_;
        _mint(to, supply);
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}

contract ResourcePoolsMockMainLaunch is IVeydriftMainLaunch {
    bool public migrationSucceeded;
    address public launchToken;
    address public positionLock;

    constructor(address token_, address lock_) {
        launchToken = token_;
        positionLock = lock_;
    }

    function setMigrationSucceeded(bool value) external {
        migrationSucceeded = value;
    }
}

contract ResourcePoolsMockPermit2 {
    struct PackedAllowance {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    mapping(address => mapping(address => mapping(address => PackedAllowance))) internal approvals;

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        approvals[msg.sender][token][spender] = PackedAllowance(amount, expiration, 0);
    }

    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce)
    {
        PackedAllowance memory approval = approvals[owner][token][spender];
        return (approval.amount, approval.expiration, approval.nonce);
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        PackedAllowance storage approval = approvals[from][token][msg.sender];
        require(approval.amount >= amount, "PERMIT_AMOUNT");
        approval.amount -= amount;
        require(IERC20(token).transferFrom(from, to, amount), "TRANSFER");
    }
}

contract ResourcePoolsMockPoolManager {
    mapping(bytes32 => uint160) public prices;

    function initialize(VeydriftV4PoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (int24)
    {
        bytes32 id = keccak256(abi.encode(key));
        require(prices[id] == 0, "EXISTS");
        prices[id] = sqrtPriceX96;
        return 0;
    }
}

contract ResourcePoolsMockStateView {
    function getSlot0(bytes32) external pure returns (uint160, int24, uint24, uint24) {
        return (0, 0, 0, 0);
    }
}

contract ResourcePoolsMockPositionManager {
    address internal constant PERMIT2 = address(0x2101);
    address internal constant POOL_MANAGER = address(0x2102);

    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public ownerOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    uint256 public nextTokenId;
    mapping(uint256 => VeydriftV4PoolKey) internal poolKeys;
    mapping(uint256 => uint256) internal positionInfos;
    mapping(uint256 => uint128) internal liquidities;

    function initialize() external {
        nextTokenId = 1;
    }

    function poolManager() external pure returns (address) {
        return POOL_MANAGER;
    }

    function permit2() external pure returns (address) {
        return PERMIT2;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"020b0b11"), "ACTIONS");
        (
            VeydriftV4PoolKey memory key,
            int24 tickLower,
            int24 tickUpper,
            uint256 liquidity,
            uint128 amount0Max,
            uint128 amount1Max,
            address recipient,
            bytes memory hookData
        ) = abi.decode(
            params[0], (VeydriftV4PoolKey, int24, int24, uint256, uint128, uint128, address, bytes)
        );
        require(
            tickLower < 0 && tickUpper > 0 && liquidity != 0 && liquidity <= type(uint128).max
                && hookData.length == 0,
            "POSITION"
        );
        require(IERC20(key.currency0).transfer(POOL_MANAGER, amount0Max), "TRANSFER_0");
        require(IERC20(key.currency1).transfer(POOL_MANAGER, amount1Max), "TRANSFER_1");
        uint256 tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
        poolKeys[tokenId] = key;
        uint256 packedInfo;
        assembly ("memory-safe") {
            packedInfo := or(shl(8, and(tickLower, 0xffffff)), shl(32, and(tickUpper, 0xffffff)))
        }
        positionInfos[tokenId] = packedInfo;
        // Safe because the mock rejected values above uint128.max before this cast.
        // forge-lint: disable-next-line(unsafe-typecast)
        liquidities[tokenId] = uint128(liquidity);
    }

    function mintUnrelated(address recipient) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return liquidities[tokenId];
    }

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (VeydriftV4PoolKey memory, uint256)
    {
        return (poolKeys[tokenId], positionInfos[tokenId]);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }
}

contract VeydriftUniswapResourcePoolsHarness is VeydriftUniswapResourcePools {
    constructor(
        address authority,
        address recovery,
        IVeydriftMainLaunch mainLaunch,
        address metal,
        address crystal,
        address deuterium,
        VeydriftV4PositionLock lock
    )
        VeydriftUniswapResourcePools(
            authority, recovery, mainLaunch, metal, crystal, deuterium, lock
        )
    {}

    function _assertOfficialDeployments() internal pure override {}

    function _expectedChainId() internal pure override returns (uint256) {
        return 8453;
    }

    function _permit2() internal pure override returns (address) {
        return address(0x2101);
    }

    function _poolManager() internal pure override returns (address) {
        return address(0x2102);
    }

    function _positionManager() internal pure override returns (address) {
        return address(0x2103);
    }

    function _stateView() internal pure override returns (address) {
        return address(0x2104);
    }
}

contract VeydriftUniswapResourcePoolsTest is Test {
    address internal constant PERMIT2 = address(0x2101);
    address internal constant POOL_MANAGER = address(0x2102);
    address internal constant POSITION_MANAGER = address(0x2103);
    address internal constant STATE_VIEW = address(0x2104);

    address internal authority = makeAddr("resource-authority");
    address internal recovery = makeAddr("resource-recovery");
    address internal beneficiary = makeAddr("position-beneficiary");

    ResourcePoolsMockToken internal veydrift;
    ResourcePoolsMockToken internal metal;
    ResourcePoolsMockToken internal crystal;
    ResourcePoolsMockToken internal deuterium;
    VeydriftV4PositionLock internal lock;
    ResourcePoolsMockMainLaunch internal mainLaunch;
    VeydriftUniswapResourcePoolsHarness internal launcher;

    function setUp() public {
        vm.chainId(8453);
        vm.warp(2_000_000_000);
        vm.etch(PERMIT2, type(ResourcePoolsMockPermit2).runtimeCode);
        vm.etch(POOL_MANAGER, type(ResourcePoolsMockPoolManager).runtimeCode);
        vm.etch(POSITION_MANAGER, type(ResourcePoolsMockPositionManager).runtimeCode);
        vm.etch(STATE_VIEW, type(ResourcePoolsMockStateView).runtimeCode);
        ResourcePoolsMockPositionManager(POSITION_MANAGER).initialize();

        veydrift =
            new ResourcePoolsMockToken("Veydrift", "VEYDRIFT", 18, 1_000_000_000 ether, authority);
        metal = new ResourcePoolsMockToken(
            "Veydrift Metal", "vMETAL", 6, 10_000_000_000 * 1e6, authority
        );
        crystal = new ResourcePoolsMockToken(
            "Veydrift Crystal", "vCRYSTAL", 6, 10_000_000_000 * 1e6, authority
        );
        deuterium = new ResourcePoolsMockToken(
            "Veydrift Deuterium", "vDEUT", 6, 10_000_000_000 * 1e6, authority
        );
        lock = new VeydriftV4PositionLock(
            POSITION_MANAGER, beneficiary, uint64(block.timestamp + 365 days)
        );
        mainLaunch = new ResourcePoolsMockMainLaunch(address(veydrift), address(lock));
        mainLaunch.setMigrationSucceeded(true);
        launcher = new VeydriftUniswapResourcePoolsHarness(
            authority,
            recovery,
            mainLaunch,
            address(metal),
            address(crystal),
            address(deuterium),
            lock
        );
    }

    function testCreatesOnlyThreeFullRangeResourcePoolsAndClearsApprovals() public {
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory configs = _configs();
        ResourcePoolsMockPositionManager(POSITION_MANAGER).mintUnrelated(address(lock));
        vm.startPrank(authority);
        veydrift.approve(address(launcher), 150_000_000 ether);
        metal.approve(address(launcher), 333_333_000);
        crystal.approve(address(launcher), 222_222_000);
        deuterium.approve(address(launcher), 133_333_000);
        (bytes32[3] memory poolIds, uint256[3] memory tokenIds) =
            launcher.launchResourcePools(configs, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(poolIds[0] != poolIds[1] && poolIds[0] != poolIds[2] && poolIds[1] != poolIds[2]);
        assertEq(ResourcePoolsMockPositionManager(POSITION_MANAGER).balanceOf(address(lock)), 4);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(tokenIds[i], i + 2);
            assertEq(
                ResourcePoolsMockPositionManager(POSITION_MANAGER).ownerOf(tokenIds[i]),
                address(lock)
            );
            assertEq(launcher.poolIds(i), poolIds[i]);
        }
        assertEq(veydrift.balanceOf(POOL_MANAGER), 150_000_000 ether);
        assertEq(metal.balanceOf(POOL_MANAGER), 333_333_000);
        assertEq(crystal.balanceOf(POOL_MANAGER), 222_222_000);
        assertEq(deuterium.balanceOf(POOL_MANAGER), 133_333_000);
        assertEq(veydrift.allowance(authority, address(launcher)), 0);
        assertEq(veydrift.allowance(address(launcher), PERMIT2), 0);
        assertEq(metal.allowance(address(launcher), PERMIT2), 0);
        assertEq(crystal.allowance(address(launcher), PERMIT2), 0);
        assertEq(deuterium.allowance(address(launcher), PERMIT2), 0);
        assertEq(veydrift.balanceOf(address(launcher)), 0);
    }

    function testResourcePoolsRemainBlockedUntilMainMigrationSucceeds() public {
        mainLaunch.setMigrationSucceeded(false);
        vm.expectRevert(VeydriftUniswapResourcePools.MainMigrationIncomplete.selector);
        launcher.preflight(_configs());
    }

    function testRejectsWrongResourceTopology() public {
        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory configs = _configs();
        configs[0].resourceToken = address(crystal);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapResourcePools.InvalidToken.selector, address(crystal)
            )
        );
        launcher.preflight(configs);
    }

    function testFullRangeTicksAreUsableForSpacing() public view {
        (int24 lower, int24 upper) = launcher.fullRangeTicks(60);
        assertEq(lower, -887_220);
        assertEq(upper, 887_220);
        assertEq(lower % 60, 0);
        assertEq(upper % 60, 0);
    }

    function _configs()
        private
        view
        returns (VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory configs)
    {
        address[3] memory resources = [address(metal), address(crystal), address(deuterium)];
        uint256[3] memory amounts = [uint256(333_333_000), 222_222_000, 133_333_000];
        for (uint256 i = 0; i < 3; i++) {
            (uint256 amount0, uint256 amount1) = address(veydrift) < resources[i]
                ? (uint256(50_000_000 ether), amounts[i])
                : (amounts[i], uint256(50_000_000 ether));
            configs[i] = VeydriftUniswapResourcePools.ResourcePoolConfig({
                resourceToken: resources[i],
                sqrtPriceX96: uint160(1 << 96),
                fee: 3_000,
                tickSpacing: 60,
                liquidity: 1,
                amount0Max: amount0,
                amount1Max: amount1,
                amount0Min: amount0,
                amount1Min: amount1
            });
        }
    }
}
