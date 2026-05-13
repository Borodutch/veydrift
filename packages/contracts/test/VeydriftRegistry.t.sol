// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftRegistry} from "../src/VeydriftRegistry.sol";

contract VeydriftRegistryAttacker {
    function update(VeydriftRegistry registry, bytes32 nextCommitment) external {
        registry.setPublicCommitment(nextCommitment);
    }
}

contract VeydriftRegistryTest {
    function testOwnerCanUpdatePublicCommitment() public {
        VeydriftRegistry registry = new VeydriftRegistry(keccak256("initial"));
        bytes32 nextCommitment = keccak256("next");

        registry.setPublicCommitment(nextCommitment);

        assert(registry.publicCommitment() == nextCommitment);
    }

    function testNonOwnerCannotUpdatePublicCommitment() public {
        VeydriftRegistry registry = new VeydriftRegistry(keccak256("initial"));
        VeydriftRegistryAttacker attacker = new VeydriftRegistryAttacker();
        bool reverted;

        try attacker.update(registry, keccak256("next")) {
            assert(false);
        } catch {
            reverted = true;
        }

        assert(reverted);
    }
}
