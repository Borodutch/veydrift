# Veydrift Highscore Ranking Model

Veydrift highscores are derived from public canonical game state. The backend may
index and sort rankings for speed, but the score inputs are contract-readable
planet ownership, completed building levels, completed research levels, current
fleet counts, and current defense counts.

## Categories

- Total score: economy + research + fleet + defense.
- Economy score: completed building investment across indexed owned planets.
- Research score: completed account-wide research investment.
- Fleet score: current owned ship value across indexed owned planets.
- Defense score: current owned defense and missile value across indexed owned
  planets.

Each category uses classic OGame-style points:

```text
score = floor(resource_value / 1000)
resource_value = metal + crystal + deuterium
```

Completed building and research investment is computed by summing every finished
level from level 0 to the current level minus one using the same catalog scaling
as `VeydriftCatalog`. Fleet and defense scores use current unit counts multiplied
by catalog unit costs. Queued but unfinished construction is not counted until it
is complete in contract state.

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

Moon building value should be added once moon ownership and building state are
enumerable through the same public indexing path. Unspent resources are not
counted in the ranking model because current classic rankings are based on
owned completed value, not temporary wallet/planet balances.
