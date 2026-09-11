# Public onchain state architecture

Veydrift gameplay is public blockchain state. This is a product constraint,
not a temporary shortcut.

## Authority

Contracts enforce ownership, authorization, spending, reserves, progression,
queue/fleet timing, combat, alliances, anti-abuse rules and randomness boundaries.
Frontends and backends may preview those rules but cannot replace enforcement.

Everything affecting gameplay validity, wallet actions, rankings, combat,
resource movement or player risk must be contract-readable or reconstructable
from public events. This includes:

- Ownership, permissions, coordinates and deterministic planet/moon metadata.
- Resource balances, production, storage, reserve backing and withdrawal locks.
- Buildings, research, units, queues and their completion state.
- Mission manifests, timing, recall, resolution, randomness references and outcomes.
- Combat losses, debris, wreckage, repair, moon rolls, scores and protection counters.

Canonical state must be reconstructable without privileged backend knowledge.
Do not store hidden fleet intent, enemy state, battle inputs or authoritative
offchain outcomes.

## Backend and frontend

The backend indexes public logs and serves consistent read models and time projections.
RPC is for ingestion, explicit repair and operation-specific validation/status;
ordinary gameplay reads must not fall back to live RPC repair.
Authenticated off-chain profile/media metadata is separate from canonical gameplay.

The frontend renders indexed state through one runtime store. Caches may accelerate
reads but never become a second authority. Implementation rules belong in
[Backend and indexer](backend-indexer.md) and [Frontend state](frontend-data-store.md).

## Product scope and public counterplay

There is no espionage, fog of war, hidden gameplay commitment, private-preimage,
zk privacy or private-orderflow roadmap. Preserve required ABI/ID compatibility
without adding Spy/Probe/Scan missions, probe units, reveal research or spy reports.
There is no circuit workspace or gameplay proving pipeline.

Attackers can inspect targets and in-flight missions. Counterplay remains public:

- Fleet slots, fuel, travel, recall deadlines and visible return exposure.
- Contract-enforced score protection, bashing limits, protected storage and loot caps.
- Alliance defense, intercept and hold missions with authorization, timing and fuel costs.
- Public combat, missile, debris and moon outcomes; recovery only where implemented and enabled.

The Rift resource bridge and Veydrift catalog naming are deliberate product choices,
not missing classic-game parity. Formula or catalog changes must preserve them.
Describe actual Veydrift rules rather than implying exact parity with another game.

Markets and transferable planet ownership need separate product approval.
Token-launch contracts do not imply a gameplay marketplace commitment.
Any new reconnaissance mechanic must remain public unless this product decision changes.

Randomness precommit/reveal and private service credentials are not hidden gameplay.
Keep their security boundaries; public game state is not permission to publish secrets.
