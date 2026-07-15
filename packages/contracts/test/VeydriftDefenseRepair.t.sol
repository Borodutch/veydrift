// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Defense} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftDefenseRepairTest is Test {
    function testSingleDestroyedOrdinaryDefenseCoversBothSeedOutcomes() public pure {
        (bool sawDestroyed, bool sawRepaired) = _outcomesAcrossSeeds(Defense.RocketLauncher, 1);

        assertTrue(sawDestroyed, "one destroyed ordinary defense must sometimes stay destroyed");
        assertTrue(sawRepaired, "one destroyed ordinary defense must sometimes repair");
    }

    function testSingleDestroyedShieldDomeCoversBothSeedOutcomes() public pure {
        (bool sawDestroyed, bool sawRepaired) = _outcomesAcrossSeeds(Defense.SmallShieldDome, 1);

        assertTrue(sawDestroyed, "one destroyed dome must sometimes stay destroyed");
        assertTrue(sawRepaired, "one destroyed dome must sometimes repair");
    }

    function testMultiUnitRepairRetainsDeterministicFloorAcrossSeeds() public pure {
        for (uint256 seed = 0; seed < 128; ++seed) {
            assertEq(_repairedCount(Defense.LightLaser, 2, seed), 1);
            assertEq(_repairedCount(Defense.RocketLauncher, 10, seed), 7);
        }
    }

    function testRepairSamplingIsDeterministicAndLaneSeparated() public pure {
        uint256 seed = 4;
        uint256 destroyed = _packedLane(Defense.RocketLauncher, 1)
            | _packedLane(Defense.LightLaser, 1) | _packedLane(Defense.SmallShieldDome, 1);

        uint256 first = VeydriftCatalog.repairedDefenseCounts(destroyed, seed);
        uint256 second = VeydriftCatalog.repairedDefenseCounts(destroyed, seed);

        assertEq(first, second);
        assertEq(_lane(first, Defense.RocketLauncher), 1);
        assertEq(_lane(first, Defense.LightLaser), 1);
        assertEq(_lane(first, Defense.SmallShieldDome), 0);
    }

    function _outcomesAcrossSeeds(Defense defense, uint32 destroyed)
        private
        pure
        returns (bool sawDestroyed, bool sawRepaired)
    {
        for (uint256 seed = 0; seed < 128; ++seed) {
            uint32 repaired = _repairedCount(defense, destroyed, seed);
            if (repaired == 0) sawDestroyed = true;
            if (repaired == destroyed) sawRepaired = true;
        }
    }

    function _repairedCount(Defense defense, uint32 destroyed, uint256 seed)
        private
        pure
        returns (uint32)
    {
        return _lane(
            VeydriftCatalog.repairedDefenseCounts(_packedLane(defense, destroyed), seed), defense
        );
    }

    function _packedLane(Defense defense, uint32 count) private pure returns (uint256) {
        return uint256(count) << (uint256(uint8(defense)) * 32);
    }

    function _lane(uint256 packed, Defense defense) private pure returns (uint32) {
        // The packed representation reserves exactly one uint32 lane per defense.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(packed >> (uint256(uint8(defense)) * 32));
    }
}
