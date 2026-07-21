// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {VestingWalletCliff} from "@openzeppelin/contracts/finance/VestingWalletCliff.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Non-upgradeable, fixed-supply coordination token for the Veydrift economy.
/// @dev The constructor performs the complete genesis allocation. There is deliberately no owner,
///      minter, proxy, pause authority, or post-genesis issuance path.
contract VeydriftToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant LAUNCH_BOOTSTRAP_ALLOCATION = 500_000_000 ether;
    uint256 public constant CCA_ALLOCATION = 250_000_000 ether;
    uint256 public constant V4_MAIN_LIQUIDITY_ALLOCATION = 250_000_000 ether;
    uint256 public constant RESOURCE_LIQUIDITY_ALLOCATION = 150_000_000 ether;
    uint256 public constant DEVELOPMENT_ALLOCATION = 150_000_000 ether;
    uint256 public constant CONTRIBUTOR_ALLOCATION = 100_000_000 ether;
    uint256 public constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;

    error InvalidAllocationRecipient();

    constructor(
        address launchBootstrapRecipient,
        address resourceLiquidityRecipient,
        address developmentVestingWallet,
        address contributorVestingWallet,
        address ecosystemVestingWallet
    ) ERC20("Veydrift", "VEYDRIFT") {
        if (
            launchBootstrapRecipient == address(0) || resourceLiquidityRecipient == address(0)
                || developmentVestingWallet == address(0) || contributorVestingWallet == address(0)
                || ecosystemVestingWallet == address(0)
        ) revert InvalidAllocationRecipient();

        _mint(launchBootstrapRecipient, LAUNCH_BOOTSTRAP_ALLOCATION);
        _mint(resourceLiquidityRecipient, RESOURCE_LIQUIDITY_ALLOCATION);
        _mint(developmentVestingWallet, DEVELOPMENT_ALLOCATION);
        _mint(contributorVestingWallet, CONTRIBUTOR_ALLOCATION);
        _mint(ecosystemVestingWallet, ECOSYSTEM_ALLOCATION);

        assert(CCA_ALLOCATION + V4_MAIN_LIQUIDITY_ALLOCATION == LAUNCH_BOOTSTRAP_ALLOCATION);
        assert(totalSupply() == MAX_SUPPLY);
    }
}

/// @notice Five-year linear development release, beginning at the configured genesis timestamp.
contract VeydriftDevelopmentVestingWallet is VestingWallet {
    uint64 public constant RELEASE_DURATION = uint64(5 * 365 days);

    constructor(address beneficiary, uint64 startTimestamp)
        VestingWallet(beneficiary, startTimestamp, RELEASE_DURATION)
    {}
}

/// @notice Four-year contributor vesting with a one-year cliff from genesis.
contract VeydriftContributorVestingWallet is VestingWalletCliff {
    uint64 public constant RELEASE_DURATION = uint64(4 * 365 days);
    uint64 public constant CLIFF_DURATION = uint64(365 days);

    constructor(address beneficiary, uint64 startTimestamp)
        VestingWallet(beneficiary, startTimestamp, RELEASE_DURATION)
        VestingWalletCliff(CLIFF_DURATION)
    {}
}

/// @notice Six-year linear ecosystem and strategic release from genesis.
contract VeydriftEcosystemVestingWallet is VestingWallet {
    uint64 public constant RELEASE_DURATION = uint64(6 * 365 days);

    constructor(address beneficiary, uint64 startTimestamp)
        VestingWallet(beneficiary, startTimestamp, RELEASE_DURATION)
    {}
}
