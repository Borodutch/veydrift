// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftStagedBattleStorage as Store} from "./VeydriftStagedBattleStorage.sol";
import {VeydriftStagedCohorts as Math} from "./VeydriftStagedCohorts.sol";

library VeydriftCombatAttribution {
    function _nextCohort(Store.Battle storage b) private {
        ++b.cohortCursor;
        b.memberCursor = 0;
        b.allocated = 0;
        b.left = 0;
        b.bestRemainder = 0;
        b.phase = 7;
    }

    function floors(Store.Battle storage b) public {
        if (b.cohortCursor == Math.cohortCount(b.math, b.side)) {
            if (b.side == 0) {
                b.side = 1;
                b.cohortCursor = 0;
            } else {
                b.phase = 9;
                b.cursor = 0;
            }
            return;
        }
        uint256[] storage members = b.cohortMembers[b.side][b.cohortCursor];
        if (b.memberCursor < members.length) {
            Store.Member storage member = b.members[members[b.memberCursor++]];
            uint256 total = b.math.sides[b.side].cohorts[b.cohortCursor].count;
            uint256 weighted = Math.loss(b.math, b.side, b.cohortCursor) * member.count;
            // Cohort loss <= total, hence floor(loss * member.count / total) <= uint32 member.count.
            // forge-lint: disable-next-line(unsafe-typecast)
            member.share = total == 0 ? 0 : uint32(weighted / total);
            member.remainder = total == 0 ? 0 : weighted % total;
            b.allocated += member.share;
        } else {
            b.left = Math.loss(b.math, b.side, b.cohortCursor) - b.allocated;
            if (b.left == 0) {
                _nextCohort(b);
            } else {
                b.phase = 8;
                b.memberCursor = 0;
                b.bestRemainder = 0;
            }
        }
    }

    function remainder(Store.Battle storage b) public {
        uint256[] storage members = b.cohortMembers[b.side][b.cohortCursor];
        if (b.memberCursor < members.length) {
            uint256 index = members[b.memberCursor++];
            Store.Member storage member = b.members[index];
            Store.Member storage best = b.members[b.best];
            if (
                member.remainder > b.bestRemainder
                    || (member.remainder != 0
                        && member.remainder == b.bestRemainder
                        && (member.owner < best.owner
                            || (member.owner == best.owner && member.missionId < best.missionId)))
            ) {
                b.best = index;
                b.bestRemainder = member.remainder;
            }
        } else {
            assert(b.bestRemainder != 0);
            ++b.members[b.best].share;
            b.members[b.best].remainder = 0;
            --b.left;
            b.memberCursor = 0;
            b.bestRemainder = 0;
            if (b.left == 0) _nextCohort(b);
        }
    }
}
