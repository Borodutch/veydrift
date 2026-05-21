# Veydrift Randomness Engine

VEY-116 adds a Veydrift-owned centralized randomness oracle for MVP/testnet flows that need
random outcomes before an external VRF integration is ready.

## Trust Model

This is not trustless randomness. Authorized game modules request randomness from
RandomnessEngine, and the configured Veydrift fulfiller account submits a server-generated uint256
random word. The backend must generate entropy from a secure server source and keep operational
monitoring around stalled or failed fulfillments.

The future migration path is to keep the request/fulfillment consumer boundary and swap the
fulfiller to a VRF or proof-backed randomness provider.

## Contract Behavior

- Only owner-authorized requester contracts can call requestRandomness(bytes32 purposeHash).
- Only the configured fulfiller can call fulfillRandomness(requestId, randomWord).
- Every request stores requester, purpose hash, created time, fulfilled time, and random word.
- Consumers call consumeRandomness(requestId, purposeHash) from the same requester contract.
- Pending requests revert with PendingRandomness, so oracle downtime blocks affected resolution
  instead of falling back to unsafe entropy.
- Unknown requests, double fulfillment, unauthorized request/fulfillment, zero purpose, zero
  random word, and cross-purpose consumption all revert.
- The owner can rotate requester authorization, rotate the fulfiller, and pause/unpause the engine.

## Backend Worker

apps/backend/src/randomness.ts contains the testable fulfillment loop:

- polls a chain client for pending RandomnessRequested events;
- generates a non-zero uint256 using node:crypto;
- submits fulfillment through the injected client;
- records fulfilled and failed attempts;
- exposes alert strings for pending request age and failed fulfillments.

Production wiring should provide a signing chain client for Base Sepolia/mainnet and surface the
returned RandomnessOperationalStatus in service health/monitoring.
