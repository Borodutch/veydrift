// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";

/// @dev Byte-for-byte inventory result of legacy per-field saturating subtraction. No combat
/// arithmetic or RNG change. Fourteen uint32 mobile counts occupy two slots; the high two unused
/// lanes of slot 1 are preserved. G.MissionShips memory fields are fourteen consecutive words.
library VeydriftLegacyCombatMutation {
    function subtract(G.MissionShips storage ships, G.MissionShips memory losses) public {
        assembly ("memory-safe") {
            let mask := 0xffffffff
            for { let slotIndex := 0 } lt(slotIndex, 2) { slotIndex := add(slotIndex, 1) } {
                let value := sload(add(ships.slot, slotIndex))
                let limit := 8
                if eq(slotIndex, 1) { limit := 6 }
                for { let lane := 0 } lt(lane, limit) { lane := add(lane, 1) } {
                    let shift := mul(lane, 32)
                    let count := and(shr(shift, value), mask)
                    let lost := mload(add(losses, mul(add(mul(slotIndex, 8), lane), 32)))
                    let remaining := 0
                    if gt(count, lost) { remaining := sub(count, lost) }
                    value := or(and(value, not(shl(shift, mask))), shl(shift, remaining))
                }
                sstore(add(ships.slot, slotIndex), value)
            }
        }
    }
}
