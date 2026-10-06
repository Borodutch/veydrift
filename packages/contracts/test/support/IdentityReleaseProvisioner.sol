// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../../src/VeydriftGameStorage.sol";
import {VeydriftProofBattle as P} from "../../src/libraries/VeydriftProofBattle.sol";
import {VeydriftProofSettlement as S} from "../../src/libraries/VeydriftProofSettlement.sol";

/// DEV TEST ONLY: temporarily etched during genesis, removed BEFORE any mission launch.
/// Cannot seed jobs, accepted state, outputs, raw journals, requests or battle phases.
contract IdentityReleaseProvisioner is G {
    constructor() G(address(1)) {}

    function provision(P.Version calldata v) external {
        require(nextFleetId == 1 && P.layout().prospective.version == 0, "genesis only");
        require(v.version == 3 && v.rules != 0 && v.catalog != 0, "release");
        require(v.verifier.code.length > 0 && v.verifier.codehash == v.verifierCodehash, "verifier");
        P.layout().prospective = v;
        S.layout().approvedReleases[S.releaseId(v)] = true;
    }
}
