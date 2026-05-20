// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

abstract contract VeydriftResourceToken is ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    uint8 public constant RESOURCE_DECIMALS = 6;
    uint256 public constant INITIAL_SUPPLY = 10_000_000_000 * 10 ** RESOURCE_DECIMALS;

    error InvalidInitialHolder();

    event ResourceTokenInitialized(
        address indexed initialOwner, address indexed initialHolder, uint256 initialSupply
    );

    constructor() {
        _disableInitializers();
    }

    function decimals() public pure override returns (uint8) {
        return RESOURCE_DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function __VeydriftResourceToken_init(
        string memory tokenName,
        string memory tokenSymbol,
        address initialOwner,
        address initialHolder
    ) internal onlyInitializing {
        if (initialHolder == address(0)) {
            revert InvalidInitialHolder();
        }

        __ERC20_init(tokenName, tokenSymbol);
        __Ownable_init(initialOwner);
        _mint(initialHolder, INITIAL_SUPPLY);

        emit ResourceTokenInitialized(initialOwner, initialHolder, INITIAL_SUPPLY);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}

contract VeydriftMetal is VeydriftResourceToken {
    function initialize(address initialOwner, address initialHolder) public initializer {
        __VeydriftResourceToken_init("Veydrift Metal", "vMETAL", initialOwner, initialHolder);
    }
}

contract VeydriftCrystal is VeydriftResourceToken {
    function initialize(address initialOwner, address initialHolder) public initializer {
        __VeydriftResourceToken_init("Veydrift Crystal", "vCRYSTAL", initialOwner, initialHolder);
    }
}

contract VeydriftDeuterium is VeydriftResourceToken {
    function initialize(address initialOwner, address initialHolder) public initializer {
        __VeydriftResourceToken_init("Veydrift Deuterium", "vDEUT", initialOwner, initialHolder);
    }
}
