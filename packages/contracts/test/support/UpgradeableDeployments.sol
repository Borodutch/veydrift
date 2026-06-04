// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../../src/VeydriftAllianceSystem.sol";
import {VeydriftMoonSystem} from "../../src/VeydriftMoonSystem.sol";

abstract contract UpgradeableDeployments {
    function _deployAllianceSystem(IVeydriftAllianceGame game, address initialOwner)
        internal
        returns (VeydriftAllianceSystem)
    {
        return VeydriftAllianceSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftAllianceSystem()),
                    abi.encodeCall(VeydriftAllianceSystem.initialize, (game, initialOwner))
                )
            )
        );
    }

    function _deployMoonSystem(address gameAddress, address randomnessAddress, address initialOwner)
        internal
        returns (VeydriftMoonSystem)
    {
        return VeydriftMoonSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftMoonSystem()),
                    abi.encodeCall(
                        VeydriftMoonSystem.initialize,
                        (gameAddress, randomnessAddress, initialOwner)
                    )
                )
            )
        );
    }

    function _deployRandomnessEngine(address initialOwner, address initialFulfiller)
        internal
        returns (RandomnessEngine)
    {
        return RandomnessEngine(
            address(
                new ERC1967Proxy(
                    address(new RandomnessEngine()),
                    abi.encodeCall(RandomnessEngine.initialize, (initialOwner, initialFulfiller))
                )
            )
        );
    }
}
