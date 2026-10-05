// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Verifier} from "../public/Verifier.sol";

interface Vm {
    function readFile(string calldata) external view returns (string memory);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonStringArray(string calldata, string calldata) external pure returns (string[] memory);
    function parseUint(string calldata) external pure returns (uint256);
    function projectRoot() external view returns (string memory);
}

// Local EVM only. Reads the actual opt-in combat export; no mock verifier,
// replacement proof, RPC, broadcast, or main contract project dependency.
contract CombatVerifierTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    Verifier verifier;
    bytes proof;
    uint256[7] inputs;
    event log_named_uint(string key, uint256 val);

    function setUp() public {
        string memory fixture = vm.readFile(string.concat(vm.projectRoot(), "/public/fixture.json"));
        proof = vm.parseJsonBytes(fixture, ".proof");
        string[] memory values = vm.parseJsonStringArray(fixture, ".public");
        require(values.length == 7, "seven scalars required");
        for (uint256 i; i < 7; i++) {
            inputs[i] = vm.parseUint(values[i]);
            require(inputs[i] < R, "noncanonical scalar");
        }
        require(inputs[3] == 0 && inputs[4] == 30 && inputs[5] == 0 && inputs[6] == 1, "wrong combat range");
        verifier = new Verifier();
    }

    function testActualCombatProofAndGas() public {
        bytes memory payload = abi.encodeCall(Verifier.verifyProof, (proof, inputs));
        address target = address(verifier);
        // Measurement excludes payload construction, deployment, test setup,
        // transaction envelope/intrinsic calldata charges and rollup L1 fees.
        // Includes staticcall boundary + returndata handling; verifier was
        // deployed during setup. The trace reports callee execution separately.
        uint256 beforeGas = gasleft();
        (bool success, bytes memory result) = target.staticcall(payload);
        uint256 callGas = beforeGas - gasleft();
        require(success && result.length == 0, "actual combat proof rejected");
        emit log_named_uint("successful_verification_staticcall_gas", callGas);
        emit log_named_uint("proof_bytes", proof.length);
        emit log_named_uint("abi_calldata_bytes", payload.length);
        emit log_named_uint("verifier_runtime_bytes", target.code.length);
    }

    function testDeploymentGasSeparate() public {
        uint256 beforeGas = gasleft();
        Verifier deployed = new Verifier();
        uint256 deploymentGas = beforeGas - gasleft();
        require(address(deployed).code.length > 0, "deployment failed");
        emit log_named_uint("local_create_gas", deploymentGas);
    }

    function assertRejected(bytes memory p, uint256[7] memory values) internal view {
        // Bound malformed-point precompile consumption; require a verifier
        // error, not an empty out-of-gas failure. Success needs <400k here.
        (bool success, bytes memory reason) = address(verifier).staticcall{gas: 1_000_000}(abi.encodeCall(Verifier.verifyProof, (p, values)));
        require(!success, "altered fixture accepted");
        require(reason.length == 4 && bytes4(reason) == Verifier.ProofInvalid.selector, "not explicit proof rejection");
    }

    function testRejectAlteredContext() public view {
        uint256[7] memory changed = inputs;
        changed[0] = addmod(changed[0], 1, R);
        assertRejected(proof, changed);
    }

    function testRejectAlteredResultCommitment() public view {
        uint256[7] memory changed = inputs;
        changed[2] = addmod(changed[2], 1, R);
        assertRejected(proof, changed);
    }

    function testRejectCorruptedProof() public view {
        bytes memory changed = proof;
        require(changed.length > 0, "empty proof");
        changed[0] = bytes1(uint8(changed[0]) ^ 1);
        assertRejected(changed, inputs);
    }
}
