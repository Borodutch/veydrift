// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftProofSettlementModule as M} from "../src/VeydriftProofSettlementModule.sol";
import {VeydriftProofSettlement as S} from "../src/libraries/VeydriftProofSettlement.sol";
import {ProofSubmissionHarness as H} from "./support/ProofSubmissionHarness.sol";
import {FinalProofFixture as F} from "./support/FinalProofFixture.sol";
import {Verifier} from "./support/FinalSettlementVerifier.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {Vm} from "forge-std/Vm.sol";

contract VeydriftProofSubmissionTest is VeydriftMoonSystemTestBase {
    H private injector;
    Verifier private verifier;
    bytes private proxyCode;
    M private module;

    function _setup(bool approved) private {
        game = VeydriftGame(
            payable(address(
                    new ERC1967Proxy(
                        address(game), abi.encodeCall(VeydriftGame.initialize, (admin))
                    )
                ))
        );
        module = M(address(game));
        proxyCode = address(game).code;
        injector = new H();
        verifier = new Verifier();
        _inject(abi.encodeCall(H.seed, (100, address(verifier), approved)));
    }

    function _inject(bytes memory data) private returns (bytes memory out) {
        vm.etch(address(game), address(injector).code);
        bool ok;
        (ok, out) = address(game).call{gas: 15_000_000 - 21_000}(data);
        vm.etch(address(game), proxyCode);
        if (!ok) assembly ("memory-safe") { revert(add(out, 32), mload(out)) }
    }

    function _word(uint256[22] memory p, uint256 offset) private pure returns (uint256 n) {
        for (uint256 i; i < 4; ++i) {
            n |= p[offset + i] << (64 * i);
        }
    }

    function _boundInputs() private returns (uint256[22] memory p) {
        p = F.inputs();
        uint256 binding = uint256(abi.decode(_inject(abi.encodeCall(H.binding, (100))), (bytes32)));
        for (uint256 i; i < 4; ++i) {
            p[i] = (binding >> (64 * i)) & type(uint64).max;
        }
    }

    function _reject(uint256 id, uint256[22] memory p, bytes4 reason) private {
        (,, uint256 beforeWork) = game.stagedBattleProgress(100);
        vm.expectRevert(reason);
        module.submitBattleProof{gas: 15_000_000 - 21_000}(id, F.proof(), p);
        (S.Phase phase, uint256 next,,) = module.proofSettlementProgress(100);
        assertEq(uint8(phase), 0);
        assertEq(next, 0);
        (,, uint256 afterWork) = game.stagedBattleProgress(100);
        assertEq(afterWork, beforeWork);
    }

    function testDefaultReleaseAndLegacySelectorRemainClosed() public {
        _setup(false);
        _reject(100, F.inputs(), S.InvalidOutput.selector);
        vm.expectRevert();
        game.submitBattleProof{gas: 15_000_000 - 21_000}(100, F.proof(), bytes32(0));
        (bytes32 binding,, bytes32 root,,,,,) = module.proofBattleAcceptedSummary(100);
        assertEq(binding, 0);
        assertEq(root, 0);
        assertEq(abi.decode(game.proofBattleRecord(0, 4, 0), (uint32)), 0);
    }

    function testGenuineFixtureCannotBeReboundToLiveJob() public {
        _setup(true);
        verifier.verifyProof{gas: 15_000_000 - 21_000}(F.proof(), F.inputs());
        assertTrue(
            bytes32(_word(F.inputs(), 0))
                != abi.decode(_inject(abi.encodeCall(H.binding, (100))), (bytes32))
        );
        _reject(100, F.inputs(), S.InvalidOutput.selector);
        // Replacing only the binding passes local admission, but the REAL verifier rejects it.
        _reject(100, _boundInputs(), Verifier.ProofInvalid.selector);
    }

    function testFrozenReleaseAddressCodehashAndPhaseChangesReject() public {
        _setup(true);
        for (uint8 field; field < 7; ++field) {
            _inject(abi.encodeCall(H.seed, (100, address(verifier), true)));
            _inject(abi.encodeCall(H.change, (100, field)));
            _reject(100, F.inputs(), S.InvalidOutput.selector);
        }
    }

    function testApprovedVerifierRuntimeReplacementRejects() public {
        _setup(true);
        uint256[22] memory p = _boundInputs();
        vm.etch(address(verifier), hex"00");
        _reject(100, p, S.InvalidOutput.selector);
    }

    function testWrongChainGameAndBattleReject() public {
        _setup(true);
        uint256[22] memory p = _boundInputs();
        uint256 chain = block.chainid;
        vm.chainId(chain + 1);
        _reject(100, p, S.InvalidOutput.selector);
        vm.chainId(chain);
        _inject(abi.encodeCall(H.seed, (101, address(verifier), true)));
        _reject(101, p, S.InvalidOutput.selector);
        address other = address(0xF00D);
        vm.etch(other, address(injector).code);
        H(other).seed(100, address(verifier), true);
        bytes32 otherBinding = H(other).binding(100);
        assertTrue(otherBinding != bytes32(_word(p, 0)));
        vm.etch(other, proxyCode);
        // Proxy implementation slot copied explicitly; this is a second synthetic job, not a launch.
        bytes32 implementationSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        vm.store(other, implementationSlot, vm.load(address(game), implementationSlot));
        vm.expectRevert(S.InvalidOutput.selector);
        M(other).submitBattleProof{gas: 15_000_000 - 21_000}(100, F.proof(), p);
    }

    function testAllNoncanonicalLimbsAndRoundOutcomeBoundsReject() public {
        _setup(true);
        uint256[22] memory p;
        for (uint256 i; i < 22; ++i) {
            if (i == 12 || i == 21) continue;
            p = _boundInputs();
            p[i] = uint256(1) << 64;
            _reject(100, p, S.InvalidOutput.selector);
        }
        p = _boundInputs();
        p[12] = 7;
        _reject(100, p, S.InvalidOutput.selector);
        p = _boundInputs();
        p[21] = 3;
        _reject(100, p, S.InvalidOutput.selector);
        p = _boundInputs();
        p[21] = 2;
        _reject(100, p, S.InvalidOutput.selector);
        p = _boundInputs();
        p[8] = 4;
        _reject(100, p, S.InvalidOutput.selector);
    }

    function testWrongRootAndProofNeverEnterApplication() public {
        _setup(true);
        uint256[22] memory actual = F.inputs();
        actual[4] ^= 1;
        vm.expectRevert(Verifier.ProofInvalid.selector);
        verifier.verifyProof{gas: 15_000_000 - 21_000}(F.proof(), actual);
        uint256[22] memory p = _boundInputs();
        p[4] ^= 1;
        _reject(100, p, Verifier.ProofInvalid.selector);
        bytes memory proof = F.proof();
        proof[0] ^= bytes1(uint8(1));
        p = _boundInputs();
        vm.expectRevert();
        module.submitBattleProof{gas: 15_000_000 - 21_000}(100, proof, p);
        vm.expectRevert(S.InvalidOutput.selector);
        module.submitBattleProof{gas: 15_000_000 - 21_000}(100, hex"00", p);
        (S.Phase phase,,,) = module.proofSettlementProgress(100);
        assertEq(uint8(phase), 0);
    }

    function _leaves() private pure returns (S.Leaf[] memory leaves) {
        uint256[22] memory p = F.inputs();
        bytes32 binding = bytes32(_word(p, 0));
        leaves = new S.Leaf[](3);
        bytes32 tail = keccak256(
            abi.encode(keccak256("veydrift.proof-battle.output-tail.v1"), binding, uint256(3))
        );
        leaves[2] = S.Leaf(1, address(3), 0, 1, 0, 1, 1, 0, tail);
        leaves[1] = S.Leaf(0, address(2), 101, 0, 10, 1, 0, 1, _digest(binding, 2, leaves[2]));
        leaves[0] = S.Leaf(0, address(1), 100, 0, 10, 1, 0, 1, _digest(binding, 1, leaves[1]));
        require(_digest(binding, 0, leaves[0]) == bytes32(_word(p, 4)), "genuine root mismatch");
    }

    function _digest(bytes32 binding, uint256 i, S.Leaf memory l) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("veydrift.proof-battle.output-leaf.v1"),
                binding,
                i,
                l.cohortId,
                l.owner,
                l.source,
                l.side,
                l.unit,
                l.enrolledCount,
                l.lost,
                l.survivors,
                l.next
            )
        );
    }

    /// forge-config: default.isolate = true
    function testGenuineVerificationSyntheticPremiseThenAuthenticatedLeafProgress() public {
        _setup(true);
        S.Leaf[] memory leaves = _leaves();
        // REAL proof verification inside injector, explicitly synthetic job identity bridge.
        // This is NOT positive production submission coverage.
        _inject(abi.encodeCall(H.verifiedSyntheticPremise, (100, F.proof(), F.inputs())));
        (
            bytes32 binding,,
            bytes32 root,
            uint256 count,
            uint8 rounds,
            uint256[2] memory totals,
            uint8 outcome,
            uint32 version
        ) = module.proofBattleAcceptedSummary(100);
        assertEq(binding, bytes32(_word(F.inputs(), 0)));
        assertEq(root, bytes32(_word(F.inputs(), 4)));
        assertEq(count, 3);
        assertEq(rounds, 1);
        assertEq(totals[0], 2);
        assertEq(totals[1], 0);
        assertEq(outcome, 1);
        assertEq(version, 3);
        vm.expectRevert(S.InvalidOutput.selector);
        module.submitBattleProof{gas: 15_000_000 - 21_000}(100, F.proof(), F.inputs());
        S.Leaf[] memory one = new S.Leaf[](1);
        one[0] = leaves[0];
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000);
        assertEq(transientValue, 0);
        module.applyProofBattleLeaves{gas: 15_000_000 - 21_000}(100, one);
        Vm.Gas memory measured = vm.lastCallGas();
        emit log_named_uint(
            "genuine root cold first leaf gross gas",
            measured.gasTotalUsed + uint256(uint64(measured.gasRefunded))
        );
        (S.Phase phase, uint256 cursor,, bytes32 expected) = module.proofSettlementProgress(100);
        assertEq(uint8(phase), 1);
        assertEq(cursor, 1);
        assertEq(expected, leaves[0].next);
        vm.expectRevert(S.InvalidOutput.selector);
        module.applyProofBattleLeaves{gas: 15_000_000 - 21_000}(100, one);
        vm.expectRevert(S.InvalidOutput.selector);
        module.submitBattleProof{gas: 15_000_000 - 21_000}(100, F.proof(), F.inputs());
        one[0] = leaves[1];
        module.applyProofBattleLeaves{gas: 15_000_000 - 21_000}(100, one);
        one[0] = leaves[2];
        module.applyProofBattleLeaves{gas: 15_000_000 - 21_000}(100, one);
        (phase, cursor,,) = module.proofSettlementProgress(100);
        assertEq(uint8(phase), 2);
        assertEq(cursor, 3);
        (uint8 stage,,) = game.stagedBattleProgress(100);
        assertEq(stage, 11);
        (bytes32 finalBinding,, bytes32 finalRoot,,,,,) = module.proofBattleAcceptedSummary(100);
        assertEq(finalRoot, root);
        assertEq(finalBinding, binding);
    }
}
