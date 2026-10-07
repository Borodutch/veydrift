// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {Verifier} from "../public/Verifier.sol";
interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonStringArray(string calldata, string calldata) external pure returns (string[] memory);
    function parseUint(string calldata) external pure returns (uint256);
    function projectRoot() external view returns (string memory);
    function cool(address) external;
}
// Genuine public development receipt only. No mocks, RPC, proving or setup.
contract SettlementVerifierTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 constant CALL_CAP = 1_000_000;
    Verifier verifier;
    bytes proof;
    uint256[22] inputs;
    event log_named_uint(string key, uint256 val);
    event log_named_bytes32(string key, bytes32 val);
    function setUp() public {
        string memory fixture = vm.readFile(string.concat(vm.projectRoot(), "/public/fixture.json"));
        proof = vm.parseJsonBytes(fixture, ".proof");
        string[] memory values = vm.parseJsonStringArray(fixture, ".public");
        require(proof.length == 384 && values.length == 22, "wrong fixture shape");
        for (uint256 i; i < 22; i++) {
            inputs[i] = vm.parseUint(values[i]);
            require(inputs[i] <= type(uint64).max, "fixture not LE64");
        }
        require(inputs[8] == 3 && inputs[12] == 1 && inputs[13] == 2 && inputs[17] == 0 && inputs[21] == 1, "wrong fixture");
        verifier = new Verifier();
    }
    function testActualSettlementProofAndGas() public {
        bytes memory payload = abi.encodeCall(Verifier.verifyProof, (proof, inputs));
        address target = address(verifier);
        vm.cool(target);
        uint256 beforeGas = gasleft();
        (bool success, bytes memory result) = target.staticcall{gas: CALL_CAP}(payload);
        uint256 callGas = beforeGas - gasleft();
        require(success && result.length == 0, "genuine settlement proof rejected");
        require(callGas < CALL_CAP, "successful call exceeds envelope");
        emit log_named_uint("successful_cold_staticcall_gas", callGas);
        emit log_named_uint("proof_bytes", proof.length);
        emit log_named_uint("abi_calldata_bytes", payload.length);
        emit log_named_uint("verifier_runtime_bytes", target.code.length);
        emit log_named_uint("verifier_init_bytes", type(Verifier).creationCode.length);
        emit log_named_bytes32("verifier_runtime_keccak256", target.codehash);
        uint256 intrinsic = 21000;
        for (uint256 i; i < payload.length; i++) intrinsic += payload[i] == 0 ? 4 : 16;
        emit log_named_uint("cancun_transaction_intrinsic_gas", intrinsic);
    }
    function testDeploymentGasSeparate() public {
        uint256 beforeGas = gasleft();
        Verifier deployed = new Verifier();
        uint256 deploymentGas = beforeGas - gasleft();
        require(address(deployed).code.length <= 24576, "EIP170");
        require(type(Verifier).creationCode.length <= 49152, "EIP3860");
        require(deploymentGas < 5_000_000, "deployment envelope");
        emit log_named_uint("local_create_gas", deploymentGas);
    }
    function assertRejected(bytes memory p, uint256[22] memory values, bytes4 selector) internal view {
        (bool success, bytes memory reason) = address(verifier).staticcall{gas: CALL_CAP}(abi.encodeCall(Verifier.verifyProof, (p, values)));
        require(!success && reason.length == 4 && bytes4(reason) == selector, "not explicit expected rejection");
    }
    function testRejectAll22InRangeScalarMutations() public {
        for (uint256 i; i < 22; i++) {
            uint256[22] memory changed = inputs;
            changed[i] += 1;
            require(changed[i] < R && changed[i] <= type(uint64).max, "mutation range");
            // Rounds 1->2 and outcome 1->2 are also within semantic ranges.
            assertRejected(proof, changed, Verifier.ProofInvalid.selector);
            emit log_named_uint("rejected_scalar_index", i);
        }
    }
    function testRejectCorruptedProofOnCurve() public view {
        bytes memory changed = proof;
        // Negate A.y: remains a canonical, on-curve G1 point. This tests the
        // pairing equation rather than an out-of-range or malformed-point error.
        uint256 y;
        assembly { y := mload(add(changed, 64)) }
        require(y > 0 && y < P, "noncanonical original point");
        y = P - y;
        assembly { mstore(add(changed, 64), y) }
        assertRejected(changed, inputs, Verifier.ProofInvalid.selector);
    }
    function testRejectCorruptedCommitmentOnCurve() public view {
        bytes memory changed = proof;
        uint256 y;
        assembly { y := mload(add(changed, 320)) }
        require(y > 0 && y < P, "noncanonical original commitment");
        y = P - y;
        assembly { mstore(add(changed, 320), y) }
        assertRejected(changed, inputs, Verifier.CommitmentInvalid.selector);
    }
}
