// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../../src/VeydriftGameStorage.sol";
import {VeydriftProofBattle as P} from "../../src/libraries/VeydriftProofBattle.sol";
import {VeydriftProofSettlement as S} from "../../src/libraries/VeydriftProofSettlement.sol";
import {
    VeydriftStagedBattleStorage as B
} from "../../src/libraries/VeydriftStagedBattleStorage.sol";
import {Ship} from "../../src/libraries/VeydriftTypes.sol";
import {IFinalBattleVerifier} from "../../src/VeydriftProofSettlementModule.sol";

/// TEST ONLY. Temporarily etched into a real proxy then removed before real module calls.
contract ProofSubmissionHarness is G {
    constructor() G(address(1)) {}

    function seed(uint256 id, address verifier, bool approved) external {
        P.Job storage j = P.layout().jobs[id];
        j.frozen = P.Version(
            3, keccak256("DEV rules"), keccak256("DEV catalog"), verifier, verifier.codehash
        );
        j.phase = P.Phase.AwaitingProof;
        j.engine = address(88);
        j.requestId = 4;
        j.purpose = keccak256("DEV purpose");
        j.snapshot = keccak256("DEV snapshot");
        j.randomnessContext = keccak256("DEV context");
        j.seed = 1;
        delete j.rows;
        j.rows.push(P.Row(0, address(3), 1, 1, 0, 0, 0, 0));
        j.rows.push(P.Row(100, address(1), 1, 0, 10, 0, 0, 0));
        j.rows.push(P.Row(101, address(2), 1, 0, 10, 0, 0, 0));
        B.Battle storage b = B.battle(id);
        b.phase = 17;
        b.enrolled[100] = true;
        b.enrolled[101] = true;
        _fleetMissions[100].owner = address(1);
        _fleetMissions[100].targetPlanetId = 3;
        _fleetMissions[100].ships.destroyer = 1;
        _fleetMissions[101].owner = address(2);
        _fleetMissions[101].ships.destroyer = 1;
        _planets[3].owner = address(3);
        _shipCounts[3][Ship.SmallCargo] = 1;
        S.layout().approvedReleases[S.releaseId(j.frozen)] = approved;
    }

    function binding(uint256 id) external view returns (bytes32) {
        return S.chainRecord(id);
    }

    function change(uint256 id, uint8 field) external {
        P.Job storage j = P.layout().jobs[id];
        if (field == 0) j.frozen.version++;
        if (field == 1) j.frozen.rules = bytes32(uint256(9));
        if (field == 2) j.frozen.catalog = bytes32(uint256(9));
        if (field == 3) j.frozen.verifier = address(99);
        if (field == 4) j.frozen.verifierCodehash = bytes32(uint256(77));
        if (field == 5) j.phase = P.Phase.AwaitingRandomness;
        if (field == 6) B.battle(id).phase = 16;
    }

    /// The proof is REAL. Its job premise is NOT this live proxy's ChainRecord.
    /// This explicit trusted test injection cannot evidence submitBattleProof success.
    function verifiedSyntheticPremise(uint256 id, bytes calldata proof, uint256[22] calldata inputs)
        external
    {
        IFinalBattleVerifier(P.layout().jobs[id].frozen.verifier).verifyProof(proof, inputs);
        S.accept(
            id,
            bytes32(S.word(inputs, 4)),
            S.word(inputs, 8),
            uint8(inputs[12] & 255),
            [S.word(inputs, 13), S.word(inputs, 17)]
        );
        // Bridge the impossible fixture identity ONLY in this test injector.
        S.layout().jobs[id].binding = bytes32(S.word(inputs, 0));
    }
}
