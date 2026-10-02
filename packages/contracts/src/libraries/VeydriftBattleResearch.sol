// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";
import {VeydriftResearchHistory} from "./VeydriftResearchHistory.sol";
import {Technology} from "./VeydriftTypes.sol";

/// @dev Option B: only newly LAUNCHED Attack leaders use impact history. No timestamp floor,
/// initializer or import/track hook can relabel an already-existing mission. Default=false.
library VeydriftBattleResearch {
    bytes32 private constant SLOT = keccak256("veydrift.storage.battle-research.v1");

    struct Levels {
        bool captured;
        uint16 weapons;
        uint16 shielding;
        uint16 armor;
    }

    struct Layout {
        mapping(uint256 => uint256) impactTimed;
        mapping(uint256 => mapping(address => Levels)) owners;
    }

    function layout() private pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { l.slot := slot }
    }

    function markLaunchedAttack(uint256 id) internal {
        // This mapping value occupies its own full word; no adjacent packed state is overwritten.
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, slot)
            sstore(keccak256(0, 64), 1)
        }
    }

    function impactTimed(uint256 leader) internal view returns (bool) {
        return layout().impactTimed[leader] != 0;
    }

    /// @dev Freeze each owner's selected triple once, shared by all their cohorts and missions.
    /// Old leaders intentionally use stored values at first enrollment, never queue overlays.
    function capture(
        uint256 leader,
        address owner,
        uint64 impact,
        uint16 weapons,
        uint16 shielding,
        uint16 armor,
        G.ResearchQueue memory queue
    ) internal returns (Levels memory result) {
        Levels storage saved = layout().owners[leader][owner];
        if (!saved.captured) {
            if (impactTimed(leader)) {
                weapons = VeydriftResearchHistory.levelAt(
                    owner, Technology.Weapons, weapons, queue, impact
                );
                shielding = VeydriftResearchHistory.levelAt(
                    owner, Technology.Shielding, shielding, queue, impact
                );
                armor =
                    VeydriftResearchHistory.levelAt(owner, Technology.Armor, armor, queue, impact);
            }
            saved.captured = true;
            saved.weapons = weapons;
            saved.shielding = shielding;
            saved.armor = armor;
        }
        result = saved;
    }
}
