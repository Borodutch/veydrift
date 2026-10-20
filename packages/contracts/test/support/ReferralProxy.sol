// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftReferralSystem} from "../../src/VeydriftReferralSystem.sol";

/// @dev The referral system is deployed like production: implementation behind an ERC1967 proxy.
library ReferralProxy {
    function deploy(address owner) internal returns (VeydriftReferralSystem) {
        return VeydriftReferralSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftReferralSystem()),
                    abi.encodeCall(VeydriftReferralSystem.initialize, (owner))
                )
            )
        );
    }
}
