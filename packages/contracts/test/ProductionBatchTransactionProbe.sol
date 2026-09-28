// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Fail closed if Forge stops honoring the gas tests' inline `isolate` setting.
/// A second zero -> nonzero write is dirty/cheap within one transaction, but costs
/// 5,000 gas (cold clean nonzero -> nonzero) after an actual transaction boundary.
contract ProductionBatchTransactionProbe {
    uint256 private value;

    function write(uint256 next) external returns (uint256 storageGas, uint256 transientValue) {
        uint256 beforeGas = gasleft();
        assembly {
            sstore(0, next)
        }
        storageGas = beforeGas - gasleft();
        assembly {
            transientValue := tload(0)
            tstore(0, next)
        }
    }
}
