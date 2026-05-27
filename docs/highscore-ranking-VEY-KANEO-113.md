# Veydrift Highscore Ranking Model

Veydrift highscores are derived from public canonical game state. The backend may
index and sort rankings for speed, but the score inputs are contract-readable
planet ownership, completed building levels, completed research levels, current
fleet counts, and current defense counts.

## Classic OGame Target

The selected target is classic non-lifeform OGame highscore parity for categories
that Veydrift can derive from canonical public state today:

- Total score: economy + research + military.
- Economy score: completed planet and moon building investment across indexed
  owned planets.
- Research score: completed account-wide research investment.
- Research levels: the sum of completed account-wide research levels.
- Military score: current fleet + current defense resource value.
- Fleet score: current owned ship value across indexed owned planets.
- Ships score: current owned ship count across indexed owned planets.
- Defense score: current owned defense and missile value across indexed owned
  planets.

Veydrift intentionally excludes modern OGame military built, military destroyed,
military lost, and honor rankings until contracts expose per-wallet historical
combat and honor ledgers. Lifeform and expedition categories are outside the
classic target.

## Categories

- Total score: economy + research + military.
- Economy score: completed planet and moon building investment across indexed
  owned planets.
- Research score: completed account-wide research investment.
- Research levels: completed account-wide research level count.
- Military score: current fleet + current defense value.
- Fleet score: current owned ship value across indexed owned planets.
- Ships score: current owned ship count across indexed owned planets.
- Defense score: current owned defense and missile value across indexed owned
  planets.

Each category uses canonical Veydrift points:

```text
score = floor(resource_value / 1000)
resource_value = metal + crystal + deuterium
```

Completed building and research investment is computed by summing every finished
level from level 0 to the current level minus one using the same catalog scaling
as `VeydriftCatalog`. Fleet and defense scores use current unit counts multiplied
by catalog unit costs. Moon building levels use the moon catalog's 2x per-level
scaling and count as economy. Combat-destroyed or otherwise lost units stop
contributing as soon as contract state removes them. Queued but unfinished
construction is not counted until it is complete in contract state.

## Attack Gating

VEY-129 score-ratio and newbie protection should use the `total` score from this
model, or a documented stricter derivative if combat needs a narrower score
surface. The important invariant is that score protection reads the same
canonical categories instead of frontend-only estimates.

The backend `/highscores` endpoint applies the same formula across indexed
settled planets so public rankings can include colonies as they appear in chain
events. VEY-129 can consume the backend-exposed total score immediately; if
attack gating is moved fully onchain, the formula in `apps/backend/src/highscores.ts`
is the deterministic reference to port without adding client-side estimates.

## Current Omissions

Military built, military destroyed, military lost, and honor categories are not
reported because Veydrift does not yet expose a per-wallet historical combat or
honor ledger. Unspent resources are not counted in the ranking model because
current rankings are based on owned completed value, not temporary wallet/planet
balances.
