// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftBatchFixtureExportTest} from "./VeydriftBatchFixtureExport.t.sol";
import {VeydriftCombatReferenceSimulator} from "./support/VeydriftCombatReferenceSimulator.sol";
import {IRefereeGame} from "./support/IRefereeGame.sol";
import {VeydriftRefereeBattle as P} from "../src/libraries/VeydriftRefereeBattle.sol";
import {Ship, Defense} from "../src/libraries/VeydriftTypes.sol";

/// Synthetic genesis for scripts/battle-referee-anvil-proof.ts (ticket #44): a launched real ACS
/// attack with alliance defender and resident fleet/defenses on the real proxy, exported before
/// arrival. The script drives preparation, reveal, referee result and settlement on Anvil.
contract VeydriftRefereeFixtureExportTest is VeydriftBatchFixtureExportTest {
    // Anvil's first well-known development account; never a production signer.
    address constant RESOLVER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function testExportRefereeFixture() external {
        if (!vm.envOr("VEY44_EXPORT_FIXTURE", false)) return;
        vm.chainId(8453);
        vm.prank(address(0xA11CE));
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(
                    1,
                    keccak256("veydrift-classic-combat-1"),
                    keccak256(bytes(vm.readFile("../battle-oracle/referee-catalog.json")))
                ),
                RESOLVER
            );
        uint256 word = 0x5eed;
        bytes32 commitment = randomness.randomnessCommitment(word);
        vm.prank(address(0xF111));
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);

        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.attackerShips[uint8(Ship.Cruiser)] = 30;
        fixture.attackerShips[uint8(Ship.Battleship)] = 6;
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 10;
        fixture.joinedAttackerShips[uint8(Ship.HeavyFighter)] = 25;
        fixture.defenderShips[uint8(Ship.LightFighter)] = 120;
        fixture.defenderShips[uint8(Ship.Cruiser)] = 4;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 60;
        fixture.defenderDefenses[uint8(Defense.HeavyLaser)] = 8;
        fixture.defenderDefenses[uint8(Defense.SmallShieldDome)] = 1;
        fixture.counterplayShips[uint8(Ship.Battleship)] = 3;
        fixture.attackerTech = VeydriftCombatReferenceSimulator.CombatTech(3, 2, 4);
        fixture.joinedAttackerTech = VeydriftCombatReferenceSimulator.CombatTech(1, 1, 1);
        fixture.defenderTech = VeydriftCombatReferenceSimulator.CombatTech(2, 5, 3);
        fixture.counterplayTech = VeydriftCombatReferenceSimulator.CombatTech(0, 0, 6);
        LaunchedBattle memory battle = _launchFixtureAttack(fixture);
        // Export before arrival so preparation, sealing, reveal and every report event run on Anvil.
        // The gated request is made there at `begin`, so load the engine slots it reads:
        // dumpState exports only journal-touched storage.
        assertTrue(randomness.authorizedRequesters(address(game)));
        assertEq(randomness.readyCommitmentCount(), 1);
        assertEq(randomness.nextRequestId(), 1);
        _touchLinkedLibraries();
        _touchCreatedChildren(address(this));
        vm.dumpState("manifests/ticket44-referee-alloc.json");

        string memory key = "referee";
        vm.serializeAddress(key, "game", address(game));
        vm.serializeUint(key, "battleId", battle.missionId);
        vm.serializeUint(key, "joinedId", battle.joinedMissionId);
        vm.serializeUint(key, "counterplayId", battle.counterplayMissionId);
        vm.serializeUint(key, "origin", battle.originPlanetId);
        vm.serializeUint(key, "target", battle.targetPlanetId);
        vm.serializeUint(key, "seed", word);
        vm.serializeAddress(key, "randomness", address(randomness));
        vm.serializeAddress(key, "fulfiller", address(0xF111));
        string memory json = vm.serializeAddress(key, "resolver", RESOLVER);
        vm.writeJson(json, "manifests/ticket44-referee-meta.json");
    }
}
