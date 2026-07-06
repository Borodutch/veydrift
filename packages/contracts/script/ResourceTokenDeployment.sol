// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftCrystal, VeydriftDeuterium, VeydriftMetal} from "../src/VeydriftResourceToken.sol";

abstract contract ResourceTokenDeployment is Script {
    event ResourceTokenProxyDeployed(
        string resource, address indexed proxy, address indexed implementation
    );

    event VeydriftResourceTokenReservesVerified(
        address indexed game, uint256 metalBalance, uint256 crystalBalance, uint256 deuteriumBalance
    );

    function _deployResourceTokens(address admin, address gameAddress)
        internal
        returns (address metalToken, address crystalToken, address deuteriumToken)
    {
        return _deployResourceTokens(gameAddress, admin, admin, admin);
    }

    function _deployResourceTokens(
        address gameAddress,
        address metalAdmin,
        address crystalAdmin,
        address deuteriumAdmin
    ) internal returns (address metalToken, address crystalToken, address deuteriumToken) {
        require(gameAddress != address(0), "GAME_ADDRESS_REQUIRED");

        metalToken = _deployMetal(metalAdmin, gameAddress);
        crystalToken = _deployCrystal(crystalAdmin, gameAddress);
        deuteriumToken = _deployDeuterium(deuteriumAdmin, gameAddress);
        _verifyInitialReserves(gameAddress, metalToken, crystalToken, deuteriumToken);
    }

    function _deployMetal(address admin, address initialHolder) private returns (address token) {
        VeydriftMetal implementation = new VeydriftMetal();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftMetal.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("metal", token, address(implementation));
    }

    function _deployCrystal(address admin, address initialHolder) private returns (address token) {
        VeydriftCrystal implementation = new VeydriftCrystal();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftCrystal.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("crystal", token, address(implementation));
    }

    function _deployDeuterium(address admin, address initialHolder)
        private
        returns (address token)
    {
        VeydriftDeuterium implementation = new VeydriftDeuterium();
        token = address(
            new ERC1967Proxy(
                address(implementation),
                abi.encodeCall(VeydriftDeuterium.initialize, (admin, initialHolder))
            )
        );
        emit ResourceTokenProxyDeployed("deuterium", token, address(implementation));
    }

    function _verifyInitialReserves(
        address gameAddress,
        address metalToken,
        address crystalToken,
        address deuteriumToken
    ) private {
        uint256 metalBalance = VeydriftMetal(metalToken).balanceOf(gameAddress);
        uint256 crystalBalance = VeydriftCrystal(crystalToken).balanceOf(gameAddress);
        uint256 deuteriumBalance = VeydriftDeuterium(deuteriumToken).balanceOf(gameAddress);
        uint256 initialSupply = VeydriftMetal(metalToken).totalSupply();

        require(initialSupply == VeydriftMetal(metalToken).INITIAL_SUPPLY(), "BAD_INITIAL_SUPPLY");
        require(VeydriftCrystal(crystalToken).totalSupply() == initialSupply, "BAD_CRYSTAL_SUPPLY");
        require(
            VeydriftDeuterium(deuteriumToken).totalSupply() == initialSupply, "BAD_DEUTERIUM_SUPPLY"
        );
        require(crystalBalance == initialSupply, "CRYSTAL_RESERVE_NOT_GAME_HELD");
        require(deuteriumBalance == initialSupply, "DEUTERIUM_RESERVE_NOT_GAME_HELD");
        require(metalBalance == initialSupply, "METAL_RESERVE_NOT_GAME_HELD");

        emit VeydriftResourceTokenReservesVerified(
            gameAddress, metalBalance, crystalBalance, deuteriumBalance
        );
    }
}
