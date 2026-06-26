# Action Mechanics

## Build Infrastructure

Starting a building upgrade spends the required resources, records the target level and ready time, and occupies the main queue. When the ready time has passed, the upgrade can be completed or lazily settled by a later relevant action.

## Start Research

Starting research spends resources from the active research planet context and occupies the research queue. The completed level affects every planet for that player.

## Build Ships And Defenses

Shipyard production spends resources, queues the quantity, and completes into the selected planet or moon inventory. Defenses stay on the body. Ships become available for missions from that body.

## Launch Attack

Attack debits ships and fuel from the origin, creates an outbound mission, resolves combat at arrival, records loot and debris, and returns survivors with cargo. The target state, protection gates, bashing window, fleet inventory, fuel, and cargo are checked before launch.

## Launch Transport

Transport debits selected resources and fuel from origin, sends ships to the target, credits resources on arrival, and returns ships to origin when the return leg completes.

## Launch Deploy

Deploy moves selected ships and cargo from one owned body to another. After arrival, the destination owns the fleet and cargo. Deploy is the normal way to reposition ships between owned planets or moons.

## Launch Harvest

Harvest sends recyclers to a debris field. On arrival, recyclers collect metal and crystal debris up to available cargo, then return with the collected resources.

## Launch Colonize

Colonize spends a colony ship and sends it to a target slot. If the slot is valid and the player has colony capacity, arrival creates a new planet and the colony ship is consumed.

## Launch Missile

Missile attacks use interplanetary missiles from the origin silo and target defenses at another planet. Anti-ballistic missiles intercept according to contract rules. Missiles are not fleet ships and do not return.

## ACS Attack

ACS Attack lets additional allied fleets join an existing attack group when the join window and route rules allow it. Joined fleets resolve with the main attack and receive their share of outcome state.

## ACS Defend

ACS Defend stations an allied fleet at the defended planet until the hostile attack lands or the hold is otherwise reconciled. Holding fuel is computed from fleet fuel, hold time, and Alliance Depot support. Stationed defenders participate in combat while present.

## Moon Actions

Moon buildings and defenses use moon resources and moon queues. Jump Gate transfers move moon ships between owned moons after both gates are ready. Chicken moon grants are testnet-limited: the user types a Chicken ID, the app verifies ownership on Base mainnet, sends the burn, and waits for indexed moon state.
