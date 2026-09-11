# Synthetic stationed-defense QA

This is a non-production rendering harness, not a gameplay state source or a
production seeding procedure. See [Development](development.md) for local setup.

This harness renders a populated Stationed defenses panel deterministically on an isolated test
deployment without coordinating or signing real on-chain missions.

## Guarded synthetic read-model payload

A backend flag injects **one fully-populated synthetic incoming attack** (with two stationed
defenders) into the fleet-visibility read model for **every wallet that owns at least one planet**. It
is served exactly like a real incoming attack, so the Mission Control "Stationed defenses" panel
renders it through the normal code path — no frontend changes, no mocking in the browser.

### Configuration guard, not chain isolation

The flag is gated by **two independent conditions**, both required:

1. `VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS` is explicitly truthy (`1`/`true`/`yes`/`on`), **and**
2. `VEYDRIFT_DEPLOYMENT_MODE` is **not** `production`.

`loadBackendConfig` hard-forces the flag to `false` in production even if the env var is set
(`apps/backend/src/config.ts`), and there is a config unit test asserting exactly that. The synthetic
mission ids are prefixed `qa-synthetic-*` so they are visually unmistakable, and the synthetic attack
only targets a planet the wallet **actually owns** — it never fabricates planet ownership.

This guard checks the deployment-mode string, **not the chain ID**. A `local` backend can still
connect to Base mainnet and a real wallet. Use an isolated test deployment and test wallets for
this rendering harness; do not enable it on a backend used for real gameplay. The flag does not
sandbox other actions or make wallet approvals safe. Synthetic mission IDs are not on-chain IDs.

The flag's live state is surfaced on `GET /health` as `chain.qaSyntheticStationedDefenders`, so QA can
confirm it is **on** for the test deploy and ops can confirm it is **off** in production.

## Enable it (test deploy)

After verifying the intended test backend, chain and wallets, set the flag through that deployment's
managed environment and restart the service. See [Deployment](deployment.md); no production restart
or credential access is authorized by this procedure.

```
VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS=1
# VEYDRIFT_DEPLOYMENT_MODE must already be "test"/"staging"/"local" (NOT production)
```

Confirm it is live:

```
curl -fsS "${QA_API_URL:?Set the verified test API URL}/health" | jq '.chain.qaSyntheticStationedDefenders'
# → true
```

## Verify rendering

1. Open `/mission-control` on the intended non-production frontend with any wallet that owns ≥1 planet.
2. The **Stationed defenses** panel renders one defended planet (your lowest-id owned planet) with two
   stationed defenders:
   - **QA Ally Alpha** — Light Fighter ×12, Cruiser ×3, Battleship ×1
   - **QA Ally Beta** — Small Cargo ×20, Heavy Fighter ×8, Destroyer ×2
3. Verify each of the four required per-defender fields:
   - **Defender identity** — the display name renders ("QA Ally Alpha" / "QA Ally Beta").
   - **Unit assets + counts** — each ship type renders its proper image asset with an `×N` count.
   - **Hold countdown** — a live "stays until / holds for" countdown (Alpha holds ~6h, Beta ~18h).
   - **Deuterium upkeep / Alliance Depot sustain** — upkeep + sustain text derived from the depot level.
4. Record screenshots with the tested build and environment; do not include credentials.

The synthetic hold-until values are computed relative to request time, so the countdowns are always in
the future and tick live every reload.

## Disable it

Unset `VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS` (or set it to `0`/`false`) and restart the service.
`/health` should then report `chain.qaSyntheticStationedDefenders: false`.

## Notes / limitations

- This verifies the **rendering + as-of-now derivation** of the panel deterministically. It does **not**
  exercise the on-chain ACS Defend launch/settlement path — that remains covered by the contract +
  backend automated suites and requires separately approved multi-wallet end-to-end verification.
- The same harness generalizes to any future stationed-defender rendering work, since it drives the
  real `FleetMissionVisibility.incoming[].stationedDefenders` payload.

## Code

- `apps/backend/src/config.ts` — `qaSyntheticStationedDefenders` flag (parse + hard production guard +
  `/health` surfacing) and `config.test.ts` coverage.
- `apps/backend/src/indexer.ts` — `syntheticStationedDefenseAttack(...)` builder + injection in
  `fleetMissionVisibility`, gated on the flag and on real planet ownership; `indexer.test.ts` coverage.
- `apps/backend/src/server.ts` — threads `config.qaSyntheticStationedDefenders` into the indexer.
