# VEY-471 — QA staging harness for stationed-defense / multi-party fleet scenarios

Unblocks live QA of VEY-456 ("Stationed defenses panel"). The populated panel only renders when ≥1
allied **ACS Defend** fleet is actively stationed against an incoming hostile attack — a scenario that
needs ≥2 cooperating funded alliance wallets signing on-chain, which the bounded QA workers cannot
produce. This harness lets QA render the populated panel **deterministically** on a non-production
deployment, with **zero on-chain choreography**.

## Approach (option b from the ticket): guarded synthetic read-model payload

A backend flag injects **one fully-populated synthetic incoming attack** (with two stationed
defenders) into the fleet-visibility read model for **every wallet that owns at least one planet**. It
is served exactly like a real incoming attack, so the Mission Control "Stationed defenses" panel
renders it through the existing (VEY-456) code path — no frontend changes, no mocking in the browser.

### Why it is safe (never production-reachable)

The flag is gated by **two independent conditions**, both required:

1. `VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS` is explicitly truthy (`1`/`true`/`yes`/`on`), **and**
2. `VEYDRIFT_DEPLOYMENT_MODE` is **not** `production`.

`loadBackendConfig` hard-forces the flag to `false` in production even if the env var is set
(`apps/backend/src/config.ts`), and there is a config unit test asserting exactly that. The synthetic
mission ids are prefixed `qa-synthetic-*` so they are visually unmistakable, and the synthetic attack
only targets a planet the wallet **actually owns** — it never fabricates planet ownership.

The flag's live state is surfaced on `GET /health` as `chain.qaSyntheticStationedDefenders`, so QA can
confirm it is **on** for the test deploy and ops can confirm it is **off** in production.

## Enable it (test deploy)

Set the env var on the test backend (swarm service `veydrift_backend-test`, api-test.veydrift.com) and
restart the service:

```
VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS=1
# VEYDRIFT_DEPLOYMENT_MODE must already be "test"/"staging"/"local" (NOT production)
```

Confirm it is live:

```
curl -s https://api-test.veydrift.com/health | jq '.chain.qaSyntheticStationedDefenders'
# → true
```

## Verify VEY-456 (QA procedure)

1. Open `https://test.veydrift.com/#/mission-control` with any wallet that owns ≥1 planet.
2. The **Stationed defenses** panel renders one defended planet (your lowest-id owned planet) with two
   stationed defenders:
   - **QA Ally Alpha** — Light Fighter ×12, Cruiser ×3, Battleship ×1
   - **QA Ally Beta** — Small Cargo ×20, Heavy Fighter ×8, Destroyer ×2
3. Verify each of the four required per-defender fields:
   - **Defender identity** — the display name renders ("QA Ally Alpha" / "QA Ally Beta").
   - **Unit assets + counts** — each ship type renders its proper image asset with an `×N` count.
   - **Hold countdown** — a live "stays until / holds for" countdown (Alpha holds ~6h, Beta ~18h).
   - **Deuterium upkeep / Alliance Depot sustain** — upkeep + sustain text derived from the depot level.
4. Capture screenshot evidence → Telegram + Kaneo VEY-456.

The synthetic hold-until values are computed relative to request time, so the countdowns are always in
the future and tick live every reload.

## Disable it

Unset `VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS` (or set it to `0`/`false`) and restart the service.
`/health` should then report `chain.qaSyntheticStationedDefenders: false`.

## Notes / limitations

- This verifies the **rendering + as-of-now derivation** of the panel deterministically. It does **not**
  exercise the on-chain ACS Defend launch/settlement path — that remains covered by the contract +
  backend automated suites. A real multi-wallet end-to-end run (option a: seeding runbook with funded
  alliance wallets) can be layered on later if a full on-chain dress rehearsal is wanted.
- The same harness generalizes to any future stationed-defender rendering work, since it drives the
  real `FleetMissionVisibility.incoming[].stationedDefenders` payload.

## Code

- `apps/backend/src/config.ts` — `qaSyntheticStationedDefenders` flag (parse + hard production guard +
  `/health` surfacing) and `config.test.ts` coverage.
- `apps/backend/src/indexer.ts` — `syntheticStationedDefenseAttack(...)` builder + injection in
  `fleetMissionVisibility`, gated on the flag and on real planet ownership; `indexer.test.ts` coverage.
- `apps/backend/src/server.ts` — threads `config.qaSyntheticStationedDefenders` into the indexer.
