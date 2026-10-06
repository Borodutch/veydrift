// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftProofBattle as P} from "../src/libraries/VeydriftProofBattle.sol";
import {IdentityReleaseProvisioner} from "./support/IdentityReleaseProvisioner.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftBodyAttackWindow} from "../src/libraries/VeydriftBodyAttackWindow.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftCombatAttribution} from "../src/libraries/VeydriftCombatAttribution.sol";
import {VeydriftCombatPreparation} from "../src/libraries/VeydriftCombatPreparation.sol";
import {VeydriftCombatStats} from "../src/libraries/VeydriftCombatStats.sol";
import {VeydriftDefenseHoldStorage} from "../src/libraries/VeydriftDefenseHoldStorage.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFleetFuel} from "../src/libraries/VeydriftFleetFuel.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {VeydriftLegacyCombatMutation} from "../src/libraries/VeydriftLegacyCombatMutation.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonDefenseProduction} from "../src/libraries/VeydriftMoonDefenseProduction.sol";
import {VeydriftMoonGateShips} from "../src/libraries/VeydriftMoonGateShips.sol";
import {VeydriftMoonIncarnation} from "../src/libraries/VeydriftMoonIncarnation.sol";
import {VeydriftMoonMath} from "../src/libraries/VeydriftMoonMath.sol";
import {VeydriftMoonProductionBatch} from "../src/libraries/VeydriftMoonProductionBatch.sol";
import {VeydriftMoonShipBacklog} from "../src/libraries/VeydriftMoonShipBacklog.sol";
import {VeydriftMoonShipDependencies} from "../src/libraries/VeydriftMoonShipDependencies.sol";
import {VeydriftMoonShipProduction} from "../src/libraries/VeydriftMoonShipProduction.sol";
import {VeydriftRaidStorage} from "../src/libraries/VeydriftRaidStorage.sol";
import {VeydriftReserveRelease} from "../src/libraries/VeydriftReserveRelease.sol";
import {VeydriftScoreSnapshot} from "../src/libraries/VeydriftScoreSnapshot.sol";
import {VeydriftStagedCohorts} from "../src/libraries/VeydriftStagedCohorts.sol";

/// PRE-JOB genesis only. Not a proof, deployment or accepted battle fixture.
contract VeydriftIdentityGenesisTest is VeydriftMoonSystemTestBase {
    string constant BASE = "manifests/ticket44-identity/";
    uint256 constant CLOCK = 1_800_000_000;

    function testExportIdentityGenesis() public {
        if (!vm.envOr("VEY44_EXPORT_IDENTITY_GENESIS", false)) {
            vm.skip(true);
            return;
        }
        string memory key = vm.readFile(string.concat(BASE, "approved-key.json"));
        require(
            vm.parseJsonBool(key, ".developmentOnly") && vm.parseJsonBool(key, ".parentApproved"),
            "parent DEV gate"
        );
        require(vm.parseJsonUint(key, ".version") == 3, "version");
        bytes32 rules = vm.parseJsonBytes32(key, ".rules");
        bytes32 catalog = vm.parseJsonBytes32(key, ".catalog");
        require(rules == keccak256("veydrift-individual-shot-candidate-2"), "rules");
        require(
            catalog == 0x86290965991ad030826bb0ae7d65f767940d1cbf7c37f0f76fcaaf11309e8ae1, "catalog"
        );
        bytes32 manifest = vm.parseJsonBytes32(key, ".manifestSHA256");
        require(manifest != 0, "manifest");
        bytes memory creation = vm.parseJsonBytes(key, ".creationCode");
        require(creation.length > 0 && creation.length <= 49152, "creation code bound");
        vm.chainId(31344);
        vm.warp(CLOCK);
        vm.roll(1);
        address verifier;
        assembly ("memory-safe") { verifier := create(0, add(creation, 32), mload(creation)) }
        require(verifier.code.length > 0 && verifier.code.length <= 24576, "verifier deployment");
        require(
            verifier.codehash == vm.parseJsonBytes32(key, ".runtimeCodehash"), "approved runtime"
        );
        address implementation = address(game);
        game = VeydriftGame(
            payable(address(
                    new ERC1967Proxy(
                        implementation, abi.encodeCall(VeydriftGame.initialize, (admin))
                    )
                ))
        );
        metalToken.mint(address(game), RESERVE_FUNDING);
        crystalToken.mint(address(game), RESERVE_FUNDING);
        deuteriumToken.mint(address(game), RESERVE_FUNDING);
        vm.startPrank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        randomness.setPrecommitRequired(true);
        vm.stopPrank();
        vm.deal(fulfiller, 10 ether);
        address[] memory owners = new address[](4);
        uint256[] memory planets = new uint256[](4);
        for (uint160 i; i < 4; ++i) {
            address owner = address(uint160(0x440100) + i);
            owners[i] = owner;
            vm.deal(owner, 10 ether);
            vm.prank(owner);
            uint256 id = game.startPlanet{value: 0.05 ether}();
            planets[i] = id;
            _setPlanetLocation(
                id,
                owner,
                1,
                uint16((100 + i / 2) & type(uint16).max),
                uint8((8 + i % 2) & type(uint8).max)
            );
            _setTechnologyLevel(owner, Technology.IntergalacticResearchNetwork, 3000);
            _setTechnologyLevel(owner, Technology.Computer, 10);
            _fundPlanet(id, 1_000_000, 1_000_000, 1_000_000);
            if (i % 2 == 0) _setShipCount(id, Ship.Destroyer, i == 0 ? 2 : 1);
            else _setShipCount(id, Ship.SmallCargo, 1);
        }
        // Only development release provisioning. Restore real proxy code before export/jobs.
        bytes memory proxy = address(game).code;
        IdentityReleaseProvisioner provisioner = new IdentityReleaseProvisioner();
        vm.etch(address(game), address(provisioner).code);
        IdentityReleaseProvisioner(address(game))
            .provision(P.Version(3, rules, catalog, verifier, verifier.codehash));
        vm.etch(address(game), proxy);
        assertEq(game.nextFleetId(), 1);
        string memory object = "identityGenesis";
        vm.serializeAddress(object, "game", address(game));
        vm.serializeAddress(object, "implementation", implementation);
        vm.serializeAddress(object, "verifier", verifier);
        vm.serializeBytes32(object, "verifierCodehash", verifier.codehash);
        vm.serializeAddress(object, "engine", address(randomness));
        vm.serializeAddress(object, "fulfiller", fulfiller);
        vm.serializeAddress(object, "owners", owners);
        vm.serializeUint(object, "planets", planets);
        vm.serializeUint(object, "chainId", block.chainid);
        vm.serializeUint(object, "timestamp", CLOCK);
        vm.serializeBytes32(object, "rules", rules);
        vm.serializeBytes32(object, "catalog", catalog);
        vm.serializeBytes32(object, "manifestSHA256", manifest);
        string memory meta = vm.serializeBool(object, "developmentOnly", true);
        _touchLinkedLibraries();
        _touchChildren(address(this));
        vm.etch(implementation, implementation.code);
        vm.dumpState(string.concat(BASE, "genesis-alloc.json"));
        vm.writeJson(meta, string.concat(BASE, "genesis-meta.json"));
    }

    function _touchChildren(address creator) private {
        uint64 nonce = vm.getNonce(creator);
        for (uint256 n = 1; n < nonce; ++n) {
            address child = vm.computeCreateAddress(creator, n);
            if (child.code.length == 0) continue;
            vm.etch(child, child.code);
            _touchChildren(child);
        }
    }

    function _touchLinkedLibraries() private {
        vm.etch(address(VeydriftAntiRaidPrimitives), address(VeydriftAntiRaidPrimitives).code);
        vm.etch(address(VeydriftBodyAttackWindow), address(VeydriftBodyAttackWindow).code);
        vm.etch(address(VeydriftCatalog), address(VeydriftCatalog).code);
        vm.etch(address(VeydriftCombatAttribution), address(VeydriftCombatAttribution).code);
        vm.etch(address(VeydriftCombatPreparation), address(VeydriftCombatPreparation).code);
        vm.etch(address(VeydriftCombatStats), address(VeydriftCombatStats).code);
        vm.etch(address(VeydriftDefenseHoldStorage), address(VeydriftDefenseHoldStorage).code);
        vm.etch(address(VeydriftDependencies), address(VeydriftDependencies).code);
        vm.etch(address(VeydriftFleetFuel), address(VeydriftFleetFuel).code);
        vm.etch(address(VeydriftFormulas), address(VeydriftFormulas).code);
        vm.etch(address(VeydriftLegacyCombatMutation), address(VeydriftLegacyCombatMutation).code);
        vm.etch(address(VeydriftMoonDefenseBacklog), address(VeydriftMoonDefenseBacklog).code);
        vm.etch(address(VeydriftMoonDefenseProduction), address(VeydriftMoonDefenseProduction).code);
        vm.etch(address(VeydriftMoonGateShips), address(VeydriftMoonGateShips).code);
        vm.etch(address(VeydriftMoonIncarnation), address(VeydriftMoonIncarnation).code);
        vm.etch(address(VeydriftMoonMath), address(VeydriftMoonMath).code);
        vm.etch(address(VeydriftMoonProductionBatch), address(VeydriftMoonProductionBatch).code);
        vm.etch(address(VeydriftMoonShipBacklog), address(VeydriftMoonShipBacklog).code);
        vm.etch(address(VeydriftMoonShipDependencies), address(VeydriftMoonShipDependencies).code);
        vm.etch(address(VeydriftMoonShipProduction), address(VeydriftMoonShipProduction).code);
        vm.etch(address(P), address(P).code);
        vm.etch(address(VeydriftRaidStorage), address(VeydriftRaidStorage).code);
        vm.etch(address(VeydriftReserveRelease), address(VeydriftReserveRelease).code);
        vm.etch(address(VeydriftScoreSnapshot), address(VeydriftScoreSnapshot).code);
        vm.etch(address(VeydriftStagedCohorts), address(VeydriftStagedCohorts).code);
    }
}
