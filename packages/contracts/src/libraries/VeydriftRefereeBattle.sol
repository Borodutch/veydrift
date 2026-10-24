// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";
import {VeydriftBattleResearch} from "./VeydriftBattleResearch.sol";
import {VeydriftStagedBattleStorage as Store} from "./VeydriftStagedBattleStorage.sol";
import {IVeydriftAttackRandomnessEngine} from "../interfaces/IVeydriftAttackRandomnessEngine.sol";

interface IRefereeBattleRandomness {
    function requestBattleRandomness(bytes32 purpose) external returns (uint256);
    function sealBattleSnapshot(uint256 id, bytes32 snapshot) external;
    function consumeRandomness(uint256 id, bytes32 purpose) external view returns (uint256);
    function battlePurposeContext(uint256 id) external view returns (bytes32);
}

/// @notice Public battle input journal for trusted-referee settlement (ticket #44).
/// @dev Anyone can rebuild the exact roster, header and seed from records/events and replay the
/// published rules (packages/battle-oracle) to audit a submitted result. Launches use this path
/// only while the owner-configured prospective version is nonzero; existing battles stay legacy.
library VeydriftRefereeBattle {
    bytes32 private constant SLOT = keccak256("veydrift.storage.referee-battle.v1");
    bytes32 internal constant RAW_DOMAIN = keccak256("veydrift.referee-battle.input.v1");
    // Must equal VeydriftGameStorage.ATTACK_BATTLE_DOMAIN (model-2 seeds consume this purpose).
    bytes32 private constant ATTACK_BATTLE_DOMAIN = keccak256("veydrift.attack-battle.v1");
    enum Phase {
        Legacy,
        Preparing,
        AwaitingRandomness,
        AwaitingResult,
        Bypassed
    }

    struct Version {
        uint32 version;
        bytes32 rules;
        bytes32 catalog;
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
        address resolver;
    }
    error InvalidRefereeLifecycle();
    event RefereeBattleLaunched(
        uint256 indexed battleId,
        uint32 version,
        bytes32 rules,
        bytes32 catalog,
        address engine,
        uint256 requestId
    );
    event RefereeBattleHeader(uint256 indexed battleId, bytes header);
    event RefereeBattleSource(uint256 indexed battleId, uint256 indexed source, bytes mission);
    event RefereeBattleRow(uint256 indexed battleId, uint256 indexed index, Row row);
    event RefereeBattleSealed(uint256 indexed battleId, bytes32 snapshot, uint256 rows);
    event RefereeBattleAwaitingResult(
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
        if (kind == 4) return abi.encode(layout().prospective, layout().resolver);
        if (kind == 5) return abi.encode(j.engine, j.requestId, j.purpose);
        revert InvalidRefereeLifecycle();
    }

    /// @dev Attack launch hook for both launch paths. Records the launch-time protection verdict
    /// (preparation never re-scores it) and either freezes a referee battle, whose gated
    /// randomness is requested only at `begin`, or requests legacy model-2 randomness.
    function request(uint256 id, address engine, bool scoreProtected) public returns (uint256) {
        VeydriftBattleResearch.markLaunchedAttack(id);
        if (engine == address(0)) revert G.RandomnessEngineUnset();
        Store.layout().launchVerdict[id] = scoreProtected ? 2 : 1;
        bytes32 purpose = keccak256(abi.encode(ATTACK_BATTLE_DOMAIN, block.chainid, id));
        if (layout().prospective.version == 0) {
            return IVeydriftAttackRandomnessEngine(engine).requestRandomness(purpose);
        }
        launch(id, engine, purpose);
        return 0;
    }

    function active(uint256 id) internal view returns (bool) {
        Job storage j = layout().jobs[id];
        return j.frozen.version != 0 && j.phase != Phase.Bypassed;
    }

    event RefereeBattleBypassed(uint256 indexed battleId);

    /// @dev Protection established no combat before enrollment. Existing bounded bounce/return
    /// settlement remains authoritative; no randomness was ever requested for this battle.
    function bypass(uint256 id) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length != 0) revert InvalidRefereeLifecycle();
        j.phase = Phase.Bypassed;
        emit RefereeBattleBypassed(id);
    }

    /// @dev Freezes rules, engine and purpose only. A recalled or bypassed battle never reaches
    /// `begin`, so it never consumes a precommitted FIFO word (event requestId stays zero).
    function launch(uint256 id, address engine, bytes32 purpose) public {
        Layout storage l = layout();
        if (l.prospective.version == 0 || l.jobs[id].frozen.version != 0) {
            revert InvalidRefereeLifecycle();
        }
        Version memory v = l.prospective;
        Job storage j = l.jobs[id];
        j.frozen = v;
        j.phase = Phase.Preparing;
        j.engine = engine;
        j.purpose = purpose;
        emit RefereeBattleLaunched(id, v.version, v.rules, v.catalog, engine, 0);
    }

    /// @dev Protection has admitted the battle and enrollment starts next: reserve the gated
    /// request now, strictly before `seal`, so no reveal is possible until the roster is frozen.
    function begin(uint256 id, bytes memory header) public returns (uint256 requestId) {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length != 0) revert InvalidRefereeLifecycle();
        requestId = IRefereeBattleRandomness(j.engine).requestBattleRandomness(j.purpose);
        j.requestId = requestId;
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
        emit RefereeBattleHeader(id, header);
    }

    function source(uint256 id, uint256 sourceId, G.FleetMission memory mission) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0 || j.sources[sourceId].length != 0) {
            revert InvalidRefereeLifecycle();
        }
        bytes memory data = abi.encode(mission);
        j.sources[sourceId] = data;
        j.rawHash = keccak256(abi.encode(j.rawHash, uint8(1), sourceId, data));
        emit RefereeBattleSource(id, sourceId, data);
    }

    function enroll(uint256 id, Row memory row) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0 || row.count == 0) {
            revert InvalidRefereeLifecycle();
        }
        uint256 index = j.rows.length;
        j.rows.push(row);
        j.rawHash = keccak256(abi.encode(j.rawHash, uint8(2), index, row));
        emit RefereeBattleRow(id, index, row);
    }

    function seal(uint256 id) public {
        Job storage j = layout().jobs[id];
        if (j.phase != Phase.Preparing || j.header.length == 0) revert InvalidRefereeLifecycle();
        j.snapshot = keccak256(abi.encode(j.rawHash, uint8(3), j.rows.length));
        j.phase = Phase.AwaitingRandomness;
        IRefereeBattleRandomness(j.engine).sealBattleSnapshot(j.requestId, j.snapshot);
        emit RefereeBattleSealed(id, j.snapshot, j.rows.length);
    }

    function awaitResult(uint256 id) public returns (bool ready) {
        Job storage j = layout().jobs[id];
        if (j.phase == Phase.AwaitingResult) return true;
        if (j.phase != Phase.AwaitingRandomness) revert InvalidRefereeLifecycle();
        try IRefereeBattleRandomness(j.engine).consumeRandomness(j.requestId, j.purpose) returns (
            uint256 word
        ) {
            bytes32 context = IRefereeBattleRandomness(j.engine).battlePurposeContext(j.requestId);
            if (context == 0) revert InvalidRefereeLifecycle();
            j.randomnessContext = context;
            // The committed word is used unchanged as the oracle's bytes32 seed.
            j.seed = word;
            j.phase = Phase.AwaitingResult;
            emit RefereeBattleAwaitingResult(id, j.snapshot, context, j.seed);
            return true;
        } catch {
            return false;
        }
    }

    event BattleRefereeConfigured(uint32 version, bytes32 rules, bytes32 catalog, address resolver);

    /// @dev version 0 stops new referee launches; already launched battles keep their frozen rules.
    function configure(Version memory v, address resolver) internal {
        // A resolver stays required after rollback (version 0): launched battles still need it.
        if (resolver == address(0) || (v.version != 0 && (v.rules == 0 || v.catalog == 0))) {
            revert InvalidRefereeLifecycle();
        }
        Layout storage l = layout();
        l.prospective = v;
        l.resolver = resolver;
        emit BattleRefereeConfigured(v.version, v.rules, v.catalog, resolver);
    }
}
