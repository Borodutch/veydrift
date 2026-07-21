// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    VeydriftAuctionParameters,
    VeydriftMigratorParameters,
    VeydriftUniswapCCALauncher,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";

contract UniswapLaunchMockToken is ERC20 {
    constructor(address recipient) ERC20("Veydrift", "VEYDRIFT") {
        _mint(recipient, 1_000_000_000 ether);
    }
}

contract UniswapLaunchMockAuction {
    address public currency;
    address public token;
    uint128 public totalSupply;
    address public tokensRecipient;
    address public fundsRecipient;
    uint64 public startBlock;
    uint64 public endBlock;
    uint64 public claimBlock;
    address public validationHook;
    uint256 public tickSpacing;
    uint256 public floorPrice;
    uint128 public requiredCurrencyRaised;
    uint256 public clearingPrice;
    bool public isGraduated;

    function initialize(
        address token_,
        uint128 amount,
        VeydriftAuctionParameters calldata params,
        address strategy
    ) external {
        require(token == address(0), "INITIALIZED");
        token = token_;
        totalSupply = amount;
        currency = params.currency;
        tokensRecipient = params.tokensRecipient;
        fundsRecipient = strategy;
        startBlock = params.startBlock;
        endBlock = params.endBlock;
        claimBlock = params.claimBlock;
        validationHook = params.validationHook;
        tickSpacing = params.tickSpacing;
        floorPrice = params.floorPrice;
        requiredCurrencyRaised = params.requiredCurrencyRaised;
    }
}

contract UniswapLaunchMockFactory {
    address public auction;

    function initialize(address auction_) external {
        auction = auction_;
    }

    function protocolFeeController() external pure returns (address) {
        return address(0);
    }

    function getAddress(address, uint256, bytes calldata, bytes32, address)
        external
        view
        returns (address)
    {
        return auction;
    }
}

contract UniswapLaunchMockPositionManager {
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public ownerOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    uint256 public nextTokenId = 1;

    function initialize() external {
        nextTokenId = 1;
    }

    function mint(address recipient) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function modifyLiquidities(bytes calldata, uint256) external pure {
        revert("NOT_USED");
    }
}

contract UniswapLaunchMockStateView {
    function getSlot0(bytes32) external pure returns (uint160, int24, uint24, uint24) {
        return (0, 0, 0, 0);
    }
}

contract UniswapLaunchMockStrategy {
    address public initializerFactory;
    address public poolManager;
    address public positionManager;
    address public auction;
    address public positionRecipient;
    uint128 public reservedForLP;
    uint256 public initializedSupply;

    function initialize(
        address factory_,
        address poolManager_,
        address positionManager_,
        address auction_
    ) external {
        initializerFactory = factory_;
        poolManager = poolManager_;
        positionManager = positionManager_;
        auction = auction_;
    }

    function initializeDistribution(
        address token,
        uint256 totalSupply,
        bytes calldata configData,
        bytes32
    ) external {
        require(IERC20(token).transferFrom(msg.sender, address(this), totalSupply));
        (VeydriftMigratorParameters memory migrator, bytes memory initializerData) =
            abi.decode(configData, (VeydriftMigratorParameters, bytes));
        VeydriftAuctionParameters memory params =
            abi.decode(initializerData, (VeydriftAuctionParameters));
        initializedSupply = totalSupply;
        reservedForLP = migrator.reservedTokenAmountForLP;
        positionRecipient = migrator.positionRecipient;
        uint256 rawAuctionSupply = totalSupply - migrator.reservedTokenAmountForLP;
        require(IERC20(token).transfer(auction, rawAuctionSupply));
        require(rawAuctionSupply <= type(uint128).max);
        // Bound checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 auctionSupply = uint128(rawAuctionSupply);
        UniswapLaunchMockAuction(auction).initialize(token, auctionSupply, params, address(this));
    }

    function migrate(address initializer) external {
        require(initializer == auction, "WRONG_AUCTION");
        UniswapLaunchMockPositionManager(positionManager).mint(positionRecipient);
    }
}

contract VeydriftUniswapCCALauncherHarness is VeydriftUniswapCCALauncher {
    address internal constant MOCK_WETH = address(0x1101);
    address internal constant MOCK_FACTORY = address(0x1102);
    address internal constant MOCK_STRATEGY = address(0x1103);
    address internal constant MOCK_POOL_MANAGER = address(0x1104);
    address internal constant MOCK_POSITION_MANAGER = address(0x1105);
    address internal constant MOCK_STATE_VIEW = address(0x1106);

    constructor(address authority, VeydriftV4PositionLock lock)
        VeydriftUniswapCCALauncher(authority, lock)
    {}

    function _assertOfficialDeployments() internal pure override {}

    function _expectedChainId() internal pure override returns (uint256) {
        return 8453;
    }

    function _weth() internal pure override returns (address) {
        return MOCK_WETH;
    }

    function _ccaFactory() internal pure override returns (address) {
        return MOCK_FACTORY;
    }

    function _lbpStrategy() internal pure override returns (address) {
        return MOCK_STRATEGY;
    }

    function _poolManager() internal pure override returns (address) {
        return MOCK_POOL_MANAGER;
    }

    function _positionManager() internal pure override returns (address) {
        return MOCK_POSITION_MANAGER;
    }

    function _stateView() internal pure override returns (address) {
        return MOCK_STATE_VIEW;
    }
}

contract VeydriftUniswapLaunchTest is Test {
    address internal constant WETH = address(0x1101);
    address internal constant FACTORY = address(0x1102);
    address internal constant STRATEGY = address(0x1103);
    address internal constant POOL_MANAGER = address(0x1104);
    address internal constant POSITION_MANAGER = address(0x1105);
    address internal constant STATE_VIEW = address(0x1106);
    address internal constant AUCTION = address(0x1107);

    address internal authority = makeAddr("launch-authority");
    address internal buyerTokens = makeAddr("buyer-token-recipient");
    address internal recovery = makeAddr("recovery");
    address internal lockBeneficiary = makeAddr("lock-beneficiary");

    UniswapLaunchMockToken internal token;
    VeydriftV4PositionLock internal lock;
    VeydriftUniswapCCALauncherHarness internal launcher;

    function setUp() public {
        vm.chainId(8453);
        vm.roll(10_000_000);
        vm.warp(2_000_000_000);

        vm.etch(WETH, type(UniswapLaunchMockToken).runtimeCode);
        vm.etch(FACTORY, type(UniswapLaunchMockFactory).runtimeCode);
        vm.etch(STRATEGY, type(UniswapLaunchMockStrategy).runtimeCode);
        vm.etch(POOL_MANAGER, hex"00");
        vm.etch(POSITION_MANAGER, type(UniswapLaunchMockPositionManager).runtimeCode);
        vm.etch(STATE_VIEW, type(UniswapLaunchMockStateView).runtimeCode);
        vm.etch(AUCTION, type(UniswapLaunchMockAuction).runtimeCode);

        UniswapLaunchMockFactory(FACTORY).initialize(AUCTION);
        UniswapLaunchMockPositionManager(POSITION_MANAGER).initialize();
        UniswapLaunchMockStrategy(STRATEGY)
            .initialize(FACTORY, POOL_MANAGER, POSITION_MANAGER, AUCTION);
        token = new UniswapLaunchMockToken(authority);
        lock = new VeydriftV4PositionLock(
            POSITION_MANAGER, lockBeneficiary, uint64(block.timestamp + 365 days)
        );
        launcher = new VeydriftUniswapCCALauncherHarness(authority, lock);
    }

    function testLaunchSplitsAllocationAndMigratesOneLockedPosition() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        address registeredAuction = launcher.launch(address(token), config, keccak256("VEY-741"));
        vm.stopPrank();

        assertEq(registeredAuction, AUCTION);
        assertEq(token.balanceOf(AUCTION), 250_000_000 ether);
        assertEq(token.balanceOf(STRATEGY), 250_000_000 ether);
        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.allowance(authority, address(launcher)), 0);
        assertEq(token.allowance(address(launcher), STRATEGY), 0);
        assertEq(UniswapLaunchMockAuction(AUCTION).currency(), WETH);
        assertEq(UniswapLaunchMockAuction(AUCTION).fundsRecipient(), STRATEGY);
        assertEq(UniswapLaunchMockAuction(AUCTION).tokensRecipient(), buyerTokens);
        assertEq(UniswapLaunchMockAuction(AUCTION).endBlock() - config.startBlock, 1_800);
        assertEq(UniswapLaunchMockStrategy(STRATEGY).reservedForLP(), 250_000_000 ether);

        vm.roll(config.migrationBlock);
        assertTrue(launcher.finalizeAndMigrate());
        assertTrue(launcher.migrationSucceeded());
        assertEq(UniswapLaunchMockPositionManager(POSITION_MANAGER).balanceOf(address(lock)), 1);
        assertEq(UniswapLaunchMockPositionManager(POSITION_MANAGER).ownerOf(1), address(lock));
    }

    function testAbortIsTerminalAndPreventsLaunch() public {
        vm.prank(authority);
        launcher.abort(keccak256("OWNER_CANCELLED"));
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        vm.expectRevert(VeydriftUniswapCCALauncher.LaunchAborted.selector);
        launcher.launch(address(token), _config(), bytes32(0));
        vm.stopPrank();
        assertEq(token.balanceOf(authority), 1_000_000_000 ether);
    }

    function testExactAllowanceAndSixtyMinuteScheduleAreMandatory() public {
        vm.startPrank(authority);
        token.approve(address(launcher), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidAllowance.selector,
                address(token),
                authority,
                address(launcher),
                500_000_000 ether,
                type(uint256).max
            )
        );
        launcher.launch(address(token), _config(), bytes32(0));
        vm.stopPrank();

        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        config.endBlock++;
        vm.expectRevert(VeydriftUniswapCCALauncher.InvalidAuctionTiming.selector);
        launcher.preflight(address(token), config, bytes32(0));
    }

    function testLockCannotReleaseBeforeTimestamp() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftV4PositionLock.PositionLockActive.selector, lock.unlockAt()
            )
        );
        lock.approveBeneficiary();
        vm.warp(lock.unlockAt());
        lock.approveBeneficiary();
        assertTrue(
            UniswapLaunchMockPositionManager(POSITION_MANAGER)
                .isApprovedForAll(address(lock), lockBeneficiary)
        );
    }

    function _config()
        private
        view
        returns (VeydriftUniswapCCALauncher.LaunchConfig memory config)
    {
        uint64 startBlock = uint64(block.number + 10);
        config = VeydriftUniswapCCALauncher.LaunchConfig({
            tokensRecipient: buyerTokens,
            recoveryRecipient: recovery,
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
    }
}
