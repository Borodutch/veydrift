// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";
import {VeydriftBattleResearch} from "./VeydriftBattleResearch.sol";
import {IVeydriftAttackRandomnessEngine} from "../interfaces/IVeydriftAttackRandomnessEngine.sol";

interface IProofBattleRandomness {
    function requestBattleRandomness(bytes32 purpose) external returns (uint256);
    function sealBattleSnapshot(uint256 id, bytes32 snapshot) external;
    function consumeRandomness(uint256 id, bytes32 purpose) external view returns (uint256);
    function battlePurposeContext(uint256 id) external view returns (bytes32);
}

/// @notice Qualified PUBLIC raw witness journal, NOT the MiMC preparation circuit root.
/// @dev No production setter exists for configuration. Activation requires a separately reviewed
/// release implementing the raw->preparation bridge, final verifier and complete settlement.
library VeydriftProofBattle {
    bytes32 private constant SLOT = keccak256("veydrift.storage.proof-battle.v1");
    bytes32 internal constant RAW_DOMAIN = keccak256("veydrift.qualified-raw-battle.v1");
    enum Phase {
        Legacy,
        Preparing,
        AwaitingRandomness,
        AwaitingProof,
        Bypassed
    }

    struct Version {
        uint32 version;
        bytes32 rules;
        bytes32 catalog;
        address verifier;
        bytes32 verifierCodehash;
    }

    struct Row {
        uint256 source;
        address owner;
        uint32 count;
        uint8 side;
        uint8 unit;
        uint16 weapons;
        uint16 shielding;
        uint16 armor;
    }

    struct Job {
        Version frozen;
        Phase phase;
        address engine;
        uint256 requestId;
        bytes32 purpose;
        bytes32 rawHash;
        bytes32 snapshot;
        bytes32 randomnessContext;
        uint256 seed;
        bytes header;
        Row[] rows;
        mapping(uint256 => bytes) sources;
    }

    struct Layout {
        Version prospective;
        mapping(uint256 => Job) jobs;
    }
    error ProofPipelineUnavailable();
    error InvalidProofLifecycle();
    event ProofBattleLaunched(
        uint256 indexed battleId,
        uint32 version,
        address verifier,
        bytes32 rules,
        bytes32 catalog,
        address engine,
        uint256 requestId
    );
    event ProofBattleHeader(uint256 indexed battleId, bytes header);
    event ProofBattleSource(uint256 indexed battleId, uint256 indexed source, bytes mission);
    event ProofBattleRow(uint256 indexed battleId, uint256 indexed index, Row row);
    event ProofBattleSealed(uint256 indexed battleId, bytes32 snapshot, uint256 rows);
    event ProofBattleAwaitingProof(
        uint256 indexed battleId, bytes32 snapshot, bytes32 randomnessContext, uint256 seed
    );

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { l.slot := slot }
    }

    function record(uint256 id, uint8 kind, uint256 index) public view returns (bytes memory) {
        Job storage j = layout().jobs[id];
        if (kind == 0) {
            return
                abi.encode(
                    j.frozen, j.phase, j.snapshot, j.randomnessContext, j.seed, j.rows.length
                );
        }
        if (kind == 1) return j.header;
        if (kind == 2) return abi.encode(j.rows[index]);
        if (kind == 3) return j.sources[index];
        if (kind == 4) return abi.encode(layout().prospective.version);
        if (kind == 5) return abi.encode(j.engine, j.requestId, j.purpose);
        revert InvalidProofLifecycle();
    }

    function request(uint256 id, address engine, bytes32 purpose) public returns (uint256) {
        VeydriftBattleResearch.markLaunchedAttack(id);
        if (engine == address(0)) revert G.RandomnessEngineUnset();
        if (layout().prospective.version != 0) return launch(id, engine, purpose);
        return IVeydriftAttackRandomnessEngine(engine).requestRandomness(purpose);
    }

    function active(uint256 id) internal view returns (bool) {
        Job storage j = layout().jobs[id];
        return j.frozen.version != 0 && j.phase != Phase.Bypassed;
    }

    event ProofBattleBypassed(uint256 indexed battleId);

    /// @dev Protection established no combat before enrollment. Existing bounded bounce/return
    /// settlement remains authoritative; the unused request can never be resealed or rerolled.
    function bypass(uint256 id) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length != 0) revert InvalidProofLifecycle();
        j.phase = Phase.Bypassed;
        emit ProofBattleBypassed(id);
    }

    function launch(uint256 id, address engine, bytes32 purpose)
        public
        returns (uint256 requestId)
    {
        Layout storage l = layout();
        if (l.prospective.version < 3 || l.jobs[id].frozen.version != 0) {
            revert InvalidProofLifecycle();
        }
        Version memory v = l.prospective;
        if (
            v.verifier.code.length == 0 || v.verifier.codehash != v.verifierCodehash || v.rules == 0
                || v.catalog == 0
        ) revert InvalidProofLifecycle();
        Job storage j = l.jobs[id];
        j.frozen = v;
        j.phase = Phase.Preparing;
        j.engine = engine;
        j.purpose = purpose;
        requestId = IProofBattleRandomness(engine).requestBattleRandomness(purpose);
        j.requestId = requestId;
        emit ProofBattleLaunched(id, v.version, v.verifier, v.rules, v.catalog, engine, requestId);
    }

    function begin(uint256 id, bytes memory header) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length != 0) revert InvalidProofLifecycle();
        j.header = header;
        j.rawHash = keccak256(
            abi.encode(
                RAW_DOMAIN,
                block.chainid,
                address(this),
                id,
                j.frozen,
                j.engine,
                j.requestId,
                j.purpose,
                header
            )
        );
        emit ProofBattleHeader(id, header);
    }

    function source(uint256 id, uint256 sourceId, G.FleetMission memory mission) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0 || j.sources[sourceId].length != 0) {
            revert InvalidProofLifecycle();
        }
        bytes memory data = abi.encode(mission);
        j.sources[sourceId] = data;
        j.rawHash = keccak256(abi.encode(j.rawHash, uint8(1), sourceId, data));
        emit ProofBattleSource(id, sourceId, data);
    }

    function enroll(uint256 id, Row memory row) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0 || row.count == 0) {
            revert InvalidProofLifecycle();
        }
        uint256 index = j.rows.length;
        j.rows.push(row);
        j.rawHash = keccak256(abi.encode(j.rawHash, uint8(2), index, row));
        emit ProofBattleRow(id, index, row);
    }

    function seal(uint256 id) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0) revert InvalidProofLifecycle();
        j.snapshot = keccak256(abi.encode(j.rawHash, uint8(3), j.rows.length));
        j.phase = Phase.AwaitingRandomness;
        IProofBattleRandomness(j.engine).sealBattleSnapshot(j.requestId, j.snapshot);
        emit ProofBattleSealed(id, j.snapshot, j.rows.length);
    }

    function awaitProof(uint256 id) public returns (bool ready) {
        Job storage j = layout().jobs[id];
        if (j.phase == Phase.AwaitingProof) return true;
        if (j.phase != Phase.AwaitingRandomness) revert InvalidProofLifecycle();
        try IProofBattleRandomness(j.engine).consumeRandomness(j.requestId, j.purpose) returns (
            uint256 word
        ) {
            bytes32 context = IProofBattleRandomness(j.engine).battlePurposeContext(j.requestId);
            if (context == 0) revert InvalidProofLifecycle();
            j.randomnessContext = context;
            // Qualification policy v1 uses the committed word unchanged as seed32 BE.
            j.seed = word;
            j.phase = Phase.AwaitingProof;
            emit ProofBattleAwaitingProof(id, j.snapshot, context, j.seed);
            return true;
        } catch {
            return false;
        }
    }
}
