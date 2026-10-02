// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {CombatCohort} from "./VeydriftCombatCohorts.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {VeydriftBattleResearch} from "./VeydriftBattleResearch.sol";
import {VeydriftResearchHistory} from "./VeydriftResearchHistory.sol";
import {Ship, Defense, Technology} from "./VeydriftTypes.sol";

library VeydriftCombatStats {
    event ResearchCompleted(address indexed player, Technology indexed technology, uint16 level);

    function settleResearch(
        mapping(address => VeydriftGameStorage.ResearchQueue) storage queues,
        mapping(
            address => mapping(Technology => uint16)
        ) storage levels,
        address player,
        uint64 cutoff
    ) public {
        VeydriftGameStorage.ResearchQueue memory q = queues[player];
        if (q.active && q.readyAt <= cutoff) {
            VeydriftResearchHistory.recordCompletion(
                player, q.technology, levels[player][q.technology], q.targetLevel, q.readyAt
            );
            delete queues[player];
            levels[player][q.technology] = q.targetLevel;
            emit ResearchCompleted(player, q.technology, q.targetLevel);
        }
    }

    function setMissionShipQuantity(
        VeydriftGameStorage.MissionShips storage ships,
        Ship ship,
        uint32 quantity
    ) public {
        if (ship == Ship.SmallCargo) ships.smallCargo = quantity;
        else if (ship == Ship.LightFighter) ships.lightFighter = quantity;
        else if (ship == Ship.Recycler) ships.recycler = quantity;
        else if (ship == Ship.ColonyShip) ships.colonyShip = quantity;
        else if (ship == Ship.LargeCargo) ships.largeCargo = quantity;
        else if (ship == Ship.HeavyFighter) ships.heavyFighter = quantity;
        else if (ship == Ship.Cruiser) ships.cruiser = quantity;
        else if (ship == Ship.Battleship) ships.battleship = quantity;
        else if (ship == Ship.Bomber) ships.bomber = quantity;
        else if (ship == Ship.Destroyer) ships.destroyer = quantity;
        else if (ship == Ship.Deathstar) ships.deathstar = quantity;
        else if (ship == Ship.Battlecruiser) ships.battlecruiser = quantity;
        else if (ship == Ship.Reaper) ships.reaper = quantity;
        else if (ship == Ship.Pathfinder) ships.pathfinder = quantity;
    }

    function cohort(
        address owner,
        uint8 unit,
        uint32 count,
        uint64 impact,
        uint16 weapons,
        uint16 shielding,
        uint16 armor,
        VeydriftGameStorage.ResearchQueue memory queue
    ) public view returns (CombatCohort memory c) {
        c.unit = unit;
        c.count = count;
        VeydriftGameStorage.ResearchQueue memory q = queue;
        uint16 w = VeydriftResearchHistory.levelAt(owner, Technology.Weapons, weapons, q, impact);
        uint16 s =
            VeydriftResearchHistory.levelAt(owner, Technology.Shielding, shielding, q, impact);
        uint16 a = VeydriftResearchHistory.levelAt(owner, Technology.Armor, armor, q, impact);
        c.attack = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleAttack(Ship(unit))
                : VeydriftCatalog.defenseBattleAttack(Defense(unit - 16)),
            w
        );
        c.shield = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleShield(Ship(unit))
                : VeydriftCatalog.defenseBattleShield(Defense(unit - 16)),
            s
        );
        c.hull = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleHull(Ship(unit))
                : VeydriftCatalog.defenseBattleHull(Defense(unit - 16)),
            a
        );
    }

    function battleCohort(
        uint256 leader,
        address owner,
        uint8 unit,
        uint32 count,
        uint64 impact,
        uint16 weapons,
        uint16 shielding,
        uint16 armor,
        VeydriftGameStorage.ResearchQueue memory queue
    ) public returns (CombatCohort memory c) {
        VeydriftBattleResearch.Levels memory levels =
            VeydriftBattleResearch.capture(leader, owner, impact, weapons, shielding, armor, queue);
        c.unit = unit;
        c.count = count;
        c.attack = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleAttack(Ship(unit))
                : VeydriftCatalog.defenseBattleAttack(Defense(unit - 16)),
            levels.weapons
        );
        c.shield = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleShield(Ship(unit))
                : VeydriftCatalog.defenseBattleShield(Defense(unit - 16)),
            levels.shielding
        );
        c.hull = scaled(
            unit < 16
                ? VeydriftCatalog.shipBattleHull(Ship(unit))
                : VeydriftCatalog.defenseBattleHull(Defense(unit - 16)),
            levels.armor
        );
    }

    function scaled(uint256 value, uint16 level) private pure returns (uint256) {
        return value * (10 + uint256(level)) / 10;
    }
}
