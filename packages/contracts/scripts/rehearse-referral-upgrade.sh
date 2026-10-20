#!/usr/bin/env bash
# Keyless rehearsal of the referral replacement on a local fork of Base mainnet. Nothing is signed:
# anvil impersonates the owners. It pauses the Game, freezes 0x9B9A with the production Freeze
# script and unpauses, builds the inventory and manifest with the production generators against
# the fork, then runs test/ReferralUpgradeMainnetFork.t.sol on it (deploy, migrate, per-getter
# parity, Game switch, redemption of an existing code, top-up, upgrade/ownership checks).
#
#   BASE_RPC_URL=<Base RPC with archive eth_getLogs> packages/contracts/scripts/rehearse-referral-upgrade.sh
#
# Optional: REHEARSAL_PREVIOUS_INPUT=<inventory built earlier with veydrift-referral-migration-input.mjs>
# to rescan only the newer blocks; REHEARSAL_PORT (default 8547); REHEARSAL_LOG_CHUNK_SIZE (1000).
set -euo pipefail
: "${BASE_RPC_URL:?set BASE_RPC_URL to a Base mainnet RPC}"
cd "$(dirname "$0")/.."

GAME=0xf397910F005151b09644228573a4353818D3755d
SOURCE=0x9B9A94836eaa715A3b801e91Aa409099FC1393B3
SOURCE_OWNER=0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B
NEW_OWNER=0xc2ae8c98099E4B9BBB661D1B306e1C70915eFC02
SOURCE_DEPLOY_BLOCK=51671660
LOCAL="http://127.0.0.1:${REHEARSAL_PORT:-8547}"
CHUNK="${REHEARSAL_LOG_CHUNK_SIZE:-1000}"
INPUT=manifests/private-referral-rehearsal-input.json
MANIFEST=manifests/private-referral-rehearsal.json

anvil --fork-url "$BASE_RPC_URL" --port "${REHEARSAL_PORT:-8547}" --auto-impersonate --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
until cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1; do
  kill -0 "$ANVIL_PID" 2>/dev/null || { echo "anvil did not start (port in use?)" >&2; exit 1; }
  sleep 1
done
echo "anvil fork of Base at block $(cast block-number --rpc-url "$LOCAL")"

cast send --unlocked --from "$NEW_OWNER" "$GAME" "setGamePaused(bool)" true --rpc-url "$LOCAL" >/dev/null
UPGRADE_DRY_RUN_OWNER="$SOURCE_OWNER" GAME_PROXY_ADDRESS="$GAME" SOURCE_REFERRAL_SYSTEM_ADDRESS="$SOURCE" \
  forge script script/FreezeReferralSystem.s.sol:FreezeReferralSystem \
  --rpc-url "$LOCAL" --broadcast --unlocked --sender "$SOURCE_OWNER"
cast send --unlocked --from "$NEW_OWNER" "$GAME" "setGamePaused(bool)" false --rpc-url "$LOCAL" >/dev/null

node ../../scripts/veydrift-referral-migration-input.mjs --rpc-url "$LOCAL" --source "$SOURCE" \
  --index-from-block "$SOURCE_DEPLOY_BLOCK" --log-chunk-size "$CHUNK" --out "$INPUT" \
  ${REHEARSAL_PREVIOUS_INPUT:+--previous "$REHEARSAL_PREVIOUS_INPUT"}
node ../../scripts/veydrift-referral-migration-manifest.mjs --rpc-url "$LOCAL" --input "$INPUT" \
  --log-chunk-size "$CHUNK" --out "$MANIFEST"

REFERRAL_MIGRATION_MANIFEST_FILE="$MANIFEST" forge test \
  --match-path test/ReferralUpgradeMainnetFork.t.sol --fork-url "$LOCAL" -vv
