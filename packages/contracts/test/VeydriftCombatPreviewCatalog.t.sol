// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Defense, Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Makes the frontend combat artifact fail closed when Solidity catalog rules change.
contract VeydriftCombatPreviewCatalogTest is Test {
    struct RapidfireRule {
        uint256 attacker;
        uint256 defender;
        uint256 value;
    }

    string private catalogJson;

    function setUp() public {
        catalogJson = vm.readFile(string.concat(vm.projectRoot(), "/combat-preview-catalog.json"));
    }

    function testPreviewArtifactMatchesEveryShipCombatStatAndCost() public view {
        for (uint8 id = 0; id < 16; ++id) {
            Ship ship = Ship(id);
            string memory path = string.concat(".ships[", vm.toString(id), "]");
            (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);

            assertEq(_uint(path, "id"), id, "ship id");
            assertEq(_uint(path, "attack"), VeydriftCatalog.shipBattleAttack(ship), "ship attack");
            assertEq(_uint(path, "shield"), VeydriftCatalog.shipBattleShield(ship), "ship shield");
            assertEq(_uint(path, "hull"), VeydriftCatalog.shipBattleHull(ship), "ship hull");
            assertEq(_uint(path, "metal"), metal, "ship metal");
            assertEq(_uint(path, "crystal"), crystal, "ship crystal");
            assertEq(_uint(path, "deuterium"), deuterium, "ship deuterium");
        }
    }

    function testPreviewArtifactMatchesEveryDefenseCombatStatAndCost() public view {
        for (uint8 id = 0; id < 8; ++id) {
            Defense defense = Defense(id);
            string memory path = string.concat(".defenses[", vm.toString(id), "]");
            (uint128 metal, uint128 crystal, uint128 deuterium) =
                VeydriftCatalog.defenseCost(defense);

            assertEq(_uint(path, "id"), id, "defense id");
            assertEq(
                _uint(path, "attack"),
                VeydriftCatalog.defenseBattleAttack(defense),
                "defense attack"
            );
            assertEq(
                _uint(path, "shield"),
                VeydriftCatalog.defenseBattleShield(defense),
                "defense shield"
            );
            assertEq(
                _uint(path, "hull"), VeydriftCatalog.defenseBattleHull(defense), "defense hull"
            );
            assertEq(_uint(path, "metal"), metal, "defense metal");
            assertEq(_uint(path, "crystal"), crystal, "defense crystal");
            assertEq(_uint(path, "deuterium"), deuterium, "defense deuterium");
        }
    }

    function testPreviewArtifactMatchesEveryRapidfireLane() public view {
        RapidfireRule[] memory shipRules =
            abi.decode(vm.parseJson(catalogJson, ".shipRapidfire"), (RapidfireRule[]));
        RapidfireRule[] memory defenseRules =
            abi.decode(vm.parseJson(catalogJson, ".defenseRapidfire"), (RapidfireRule[]));

        for (uint8 attacker = 0; attacker < 16; ++attacker) {
            for (uint8 defender = 0; defender < 16; ++defender) {
                assertEq(
                    VeydriftCatalog.shipRapidfireAgainstShip(Ship(attacker), Ship(defender)),
                    _rapidfire(shipRules, attacker, defender),
                    "ship rapidfire"
                );
            }
            for (uint8 defender = 0; defender < 8; ++defender) {
                assertEq(
                    VeydriftCatalog.shipRapidfireAgainstDefense(Ship(attacker), Defense(defender)),
                    _rapidfire(defenseRules, attacker, defender),
                    "defense rapidfire"
                );
            }
        }
    }

    function _uint(string memory parent, string memory key) private view returns (uint256) {
        return vm.parseJsonUint(catalogJson, string.concat(parent, ".", key));
    }

    function _rapidfire(RapidfireRule[] memory rules, uint8 attacker, uint8 defender)
        private
        pure
        returns (uint256)
    {
        for (uint256 i = 0; i < rules.length; ++i) {
            if (rules[i].attacker == attacker && rules[i].defender == defender) {
                return rules[i].value;
            }
        }
        return 1;
    }
}
