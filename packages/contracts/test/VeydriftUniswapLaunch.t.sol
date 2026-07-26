// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    VeydriftAuctionParameters,
    VeydriftMigratorParameters,
    VeydriftV4PoolKey,
    VeydriftV4PoolParameters,
    VeydriftUniswapCCALauncher,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";
import {VeydriftToken} from "../src/VeydriftToken.sol";

contract UniswapLaunchMockToken is ERC20 {
    constructor(address recipient) ERC20("Veydrift", "VEYDRIFT") {
        _mint(recipient, 1_000_000_000 ether);
    }
}

contract UniswapLaunchMintableToken is ERC20 {
    constructor(address recipient) ERC20("Veydrift", "VEYDRIFT") {
        _mint(recipient, 1_000_000_000 ether);
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
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
    mapping(uint256 => VeydriftV4PoolKey) internal poolKeys;
    mapping(uint256 => uint256) internal positionInfos;
    mapping(uint256 => uint128) internal liquidities;

    function initialize() external {
        nextTokenId = 1;
    }

    function mint(
        address recipient,
        VeydriftV4PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        ownerOf[tokenId] = recipient;
        balanceOf[recipient]++;
        poolKeys[tokenId] = key;
        uint256 packedInfo;
        assembly ("memory-safe") {
            packedInfo := or(shl(8, and(tickLower, 0xffffff)), shl(32, and(tickUpper, 0xffffff)))
        }
        positionInfos[tokenId] = packedInfo;
        liquidities[tokenId] = liquidity;
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

    function modifyLiquidities(bytes calldata, uint256) external pure {
        revert("NOT_USED");
    }
}

contract UniswapLaunchMockStateView {
    mapping(bytes32 => uint160) public sqrtPrices;

    function setPool(bytes32 poolId, uint160 sqrtPriceX96) external {
        sqrtPrices[poolId] = sqrtPriceX96;
    }

    function getSlot0(bytes32 poolId) external view returns (uint160, int24, uint24, uint24) {
        return (sqrtPrices[poolId], 0, 0, 0);
    }
}

contract UniswapLaunchMockStrategy {
    address public initializerFactory;
    address public poolManager;
    address public positionManager;
    address public stateView;
    address public auction;
    address public positionRecipient;
    uint128 public reservedForLP;
    uint256 public initializedSupply;
    bool public migrated;
    bool public migrationFails;
    bytes32 public registeredPoolId;
    address public registeredInitializer;
    VeydriftMigratorParameters internal migrationParameters;

    function initialize(
        address factory_,
        address poolManager_,
        address positionManager_,
        address stateView_,
        address auction_
    ) external {
        initializerFactory = factory_;
        poolManager = poolManager_;
        positionManager = positionManager_;
        stateView = stateView_;
        auction = auction_;
    }

    function setMigrationFails(bool value) external {
        migrationFails = value;
    }

    function registeredPoolIds(bytes32 poolId) external view returns (address) {
        return poolId == registeredPoolId ? registeredInitializer : address(0);
    }

    function initializers(address) external view returns (VeydriftMigratorParameters memory) {
        return migrationParameters;
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
        migrationParameters = migrator;
        (address currency0, address currency1) =
            migrator.currency < token ? (migrator.currency, token) : (token, migrator.currency);
        registeredPoolId = keccak256(
            abi.encode(
                VeydriftV4PoolKey({
                    currency0: currency0,
                    currency1: currency1,
                    fee: migrator.poolParameters.fee,
                    tickSpacing: migrator.poolParameters.tickSpacing,
                    hooks: migrator.poolParameters.hook
                })
            )
        );
        registeredInitializer = auction;
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
        require(!migrated, "INITIALIZER_NOT_REGISTERED");
        migrated = true;
        registeredInitializer = address(0);
        if (migrationFails) return;
        VeydriftV4PoolParameters memory params = migrationParameters.poolParameters;
        (address currency0, address currency1) = migrationParameters.currency
            < migrationParameters.token
            ? (migrationParameters.currency, migrationParameters.token)
            : (migrationParameters.token, migrationParameters.currency);
        VeydriftV4PoolKey memory key = VeydriftV4PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: params.fee,
            tickSpacing: params.tickSpacing,
            hooks: params.hook
        });
        UniswapLaunchMockStateView(stateView).setPool(keccak256(abi.encode(key)), 1 << 96);
        // Mirrors the official Uniswap v4 TickMath usable-boundary formula.
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 tickLower = (-887_272 / params.tickSpacing) * params.tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 tickUpper = (887_272 / params.tickSpacing) * params.tickSpacing;
        UniswapLaunchMockPositionManager(positionManager)
            .mint(positionRecipient, key, tickLower, tickUpper, 1 ether);
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

    VeydriftToken internal token;
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
            .initialize(FACTORY, POOL_MANAGER, POSITION_MANAGER, STATE_VIEW, AUCTION);
        token = new VeydriftToken(authority, authority, authority, authority, authority);
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
        assertEq(launcher.BASE_48_HOUR_BLOCKS(), 86_400);
        assertEq(UniswapLaunchMockAuction(AUCTION).endBlock() - config.startBlock, 86_400);
        assertEq(UniswapLaunchMockStrategy(STRATEGY).reservedForLP(), 250_000_000 ether);

        vm.roll(config.migrationBlock);
        assertTrue(launcher.finalizeAndMigrate());
        assertTrue(launcher.migrationSucceeded());
        assertEq(UniswapLaunchMockPositionManager(POSITION_MANAGER).balanceOf(address(lock)), 1);
        assertEq(UniswapLaunchMockPositionManager(POSITION_MANAGER).ownerOf(1), address(lock));
    }

    function testReconcilesPermissionlessMigrationAndIsOneShot() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-race"));
        vm.stopPrank();

        vm.roll(config.migrationBlock);
        vm.prank(makeAddr("permissionless-migrator"));
        UniswapLaunchMockStrategy(STRATEGY).migrate(AUCTION);

        vm.expectRevert(VeydriftUniswapCCALauncher.InvalidReconciliationEvidence.selector);
        vm.prank(authority);
        launcher.reconcileMigration(1, bytes32(0));
        bytes32 evidenceHash = keccak256("permissionless-migration-receipt-and-deltas");
        vm.prank(authority);
        assertTrue(launcher.reconcileMigration(1, evidenceHash));
        assertTrue(launcher.migrationAttempted());
        assertTrue(launcher.migrationSucceeded());
        assertEq(launcher.reconciliationEvidenceHash(), evidenceHash);
        assertEq(launcher.mainPositionTokenId(), 1);
        assertEq(UniswapLaunchMockPositionManager(POSITION_MANAGER).balanceOf(address(lock)), 1);

        vm.expectRevert(VeydriftUniswapCCALauncher.AlreadyFinalized.selector);
        vm.prank(authority);
        launcher.reconcileMigration(1, evidenceHash);
    }

    function testUnrelatedLockedNftDoesNotBlockLaunchOrMigrationReconciliation() public {
        VeydriftV4PoolKey memory unrelated = VeydriftV4PoolKey({
            currency0: WETH < address(token) ? WETH : address(token),
            currency1: WETH < address(token) ? address(token) : WETH,
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        UniswapLaunchMockPositionManager(POSITION_MANAGER)
            .mint(address(lock), unrelated, -887_270, 887_270, 1);

        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-unrelated"));
        vm.stopPrank();

        vm.roll(config.migrationBlock);
        UniswapLaunchMockStrategy(STRATEGY).migrate(AUCTION);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftUniswapCCALauncher.InvalidMainPosition.selector, 1)
        );
        vm.prank(authority);
        launcher.reconcileMigration(1, keccak256("unrelated-nft-evidence"));
        assertFalse(launcher.migrationAttempted());
        vm.prank(authority);
        assertTrue(launcher.reconcileMigration(2, keccak256("canonical-nft-evidence")));
        assertEq(launcher.mainPositionTokenId(), 2);
    }

    function testReconciliationRejectsCandidatePoolWithoutConsumedInitializer() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-candidate-only"));
        vm.stopPrank();
        vm.roll(config.migrationBlock);

        (bytes32 hooklessPoolId,) = launcher.mainPoolIds();
        UniswapLaunchMockStateView(STATE_VIEW).setPool(hooklessPoolId, 1 << 96);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidMigrationLifecycle.selector,
                AUCTION,
                launcher.migrationParametersHash()
            )
        );
        vm.prank(authority);
        launcher.reconcileMigration(1, keccak256("candidate-only-evidence"));
    }

    function testReconciliationRejectsMixedMainPoolTopology() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-mixed"));
        vm.stopPrank();
        vm.roll(config.migrationBlock);
        UniswapLaunchMockStrategy(STRATEGY).migrate(AUCTION);

        (, bytes32 strategyHookPoolId) = launcher.mainPoolIds();
        UniswapLaunchMockStateView(STATE_VIEW).setPool(strategyHookPoolId, 1 << 96);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidMainPoolTopology.selector, true, true
            )
        );
        vm.prank(authority);
        launcher.reconcileMigration(1, keccak256("mixed-topology-evidence"));
    }

    function testDirectWrapperRecordsTerminalMigrationFailure() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-direct-failure"));
        vm.stopPrank();
        UniswapLaunchMockStrategy(STRATEGY).setMigrationFails(true);
        vm.roll(config.migrationBlock);

        assertFalse(launcher.finalizeAndMigrate());
        assertTrue(launcher.migrationAttempted());
        assertFalse(launcher.migrationSucceeded());
        vm.expectRevert(VeydriftUniswapCCALauncher.AlreadyFinalized.selector);
        launcher.finalizeAndMigrate();
    }

    function testReconcilesTerminalPermissionlessMigrationFailure() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-raced-failure"));
        vm.stopPrank();
        UniswapLaunchMockStrategy(STRATEGY).setMigrationFails(true);
        vm.roll(config.migrationBlock);
        UniswapLaunchMockStrategy(STRATEGY).migrate(AUCTION);

        VeydriftV4PoolKey memory unrelated = VeydriftV4PoolKey({
            currency0: WETH < address(token) ? WETH : address(token),
            currency1: WETH < address(token) ? address(token) : WETH,
            fee: 500,
            tickSpacing: 10,
            hooks: address(0)
        });
        UniswapLaunchMockPositionManager(POSITION_MANAGER)
            .mint(address(lock), unrelated, -887_270, 887_270, 1);

        bytes32 evidenceHash = keccak256("terminal-recovery-receipt-and-deltas");
        vm.prank(authority);
        assertFalse(launcher.reconcileMigration(0, evidenceHash));
        assertTrue(launcher.migrationAttempted());
        assertFalse(launcher.migrationSucceeded());
        assertEq(launcher.reconciliationEvidenceHash(), evidenceHash);
    }

    function testTerminalFailureCannotBeSpoofedIntoSuccessByUntrustedCaller() public {
        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        vm.startPrank(authority);
        token.approve(address(launcher), 500_000_000 ether);
        launcher.launch(address(token), config, keccak256("VEY-741-terminal-spoof"));
        vm.stopPrank();
        UniswapLaunchMockStrategy(STRATEGY).setMigrationFails(true);
        vm.roll(config.migrationBlock);
        vm.prank(makeAddr("permissionless-terminal-migrator"));
        UniswapLaunchMockStrategy(STRATEGY).migrate(AUCTION);

        VeydriftV4PoolKey memory fakeCanonicalKey = VeydriftV4PoolKey({
            currency0: WETH < address(token) ? WETH : address(token),
            currency1: WETH < address(token) ? address(token) : WETH,
            fee: config.v4Fee,
            tickSpacing: config.v4TickSpacing,
            hooks: address(0)
        });
        (bytes32 hooklessPoolId,) = launcher.mainPoolIds();
        UniswapLaunchMockStateView(STATE_VIEW).setPool(hooklessPoolId, 1 << 96);
        UniswapLaunchMockPositionManager(POSITION_MANAGER)
            .mint(address(lock), fakeCanonicalKey, -887_220, 887_220, 1);

        address attacker = makeAddr("terminal-spoof-attacker");
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftUniswapCCALauncher.Unauthorized.selector, attacker)
        );
        vm.prank(attacker);
        launcher.reconcileMigration(1, keccak256("fabricated-evidence"));
        assertFalse(launcher.migrationAttempted());
        assertFalse(launcher.migrationSucceeded());
        assertEq(launcher.mainPositionTokenId(), 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidMainPoolTopology.selector, true, false
            )
        );
        vm.prank(authority);
        launcher.reconcileMigration(0, keccak256("terminal-recovery-receipt"));
        assertFalse(launcher.migrationSucceeded());
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

    function testExactAllowanceAndFortyEightHourScheduleAreMandatory() public {
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
        config.endBlock--;
        vm.expectRevert(VeydriftUniswapCCALauncher.InvalidAuctionTiming.selector);
        launcher.preflight(address(token), config, bytes32(0));

        config = _config();
        config.auctionStepsData =
            abi.encodePacked(uint24(115), uint40(22_399), uint24(116), uint40(64_000));
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidAuctionSteps.selector, 86_399, 9_999_885
            )
        );
        launcher.preflight(address(token), config, bytes32(0));
    }

    function testRejectsWrongAndMintableOneBillionSupplyTokens() public {
        UniswapLaunchMockToken wrongToken = new UniswapLaunchMockToken(authority);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidToken.selector, address(wrongToken)
            )
        );
        launcher.preflight(address(wrongToken), _config(), bytes32(0));

        UniswapLaunchMintableToken mintableToken = new UniswapLaunchMintableToken(authority);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftUniswapCCALauncher.InvalidToken.selector, address(mintableToken)
            )
        );
        launcher.preflight(address(mintableToken), _config(), bytes32(0));
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
            endBlock: startBlock + 86_400,
            claimBlock: startBlock + 86_400,
            migrationBlock: startBlock + 86_410,
            auctionTickSpacingQ96: 2,
            floorPriceQ96: (1 << 32) + 2,
            requiredWethRaised: 1 ether,
            auctionStepsData: abi.encodePacked(
                uint24(115), uint40(22_400), uint24(116), uint40(64_000)
            ),
            v4Fee: 3_000,
            v4TickSpacing: 60,
            lpCurrencyRateMps: 10_000_000
        });
    }
}
