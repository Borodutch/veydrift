# Veydrift Chicken Burn Listener

Standalone service that listens to Base mainnet Chicken NFT burn events and calls
`VeydriftMoonSystem.grantMoonFromChickenBurn` on Base Sepolia.

It is intentionally separate from the normal Veydrift backend. It only watches the configured
Chicken contract, backfills missed burn logs, persists processed burn ids, and submits moon grant
transactions with the configured admin key.

## Required env

- `BASE_MAINNET_HTTP_RPC_URL`: Base mainnet HTTP RPC. Use the Alchemy URL from the private deployment
  secret, not source control.
- `BASE_MAINNET_WS_RPC_URL`: Base mainnet websocket RPC for live burn subscriptions.
- `CHICKEN_CONTRACT_ADDRESS`: Base mainnet Chicken NFT contract.
- `VEYDRIFT_RPC_URL`: Base Sepolia self-hosted Veydrift RPC endpoint.
- `VEYDRIFT_MOON_SYSTEM_ADDRESS`: Base Sepolia `VeydriftMoonSystem` proxy/contract address.
- `VEYDRIFT_GRANT_PRIVATE_KEY`: EOA authorized as the moon system owner/admin.

Optional env is listed in `.env.example`. `STATE_FILE` must be durable across restarts so replayed
logs do not resubmit already handled burns. The contract also stores `chickenBurnMoonGranted(burnId)`
as an on-chain replay guard.

## Burn event shape

By default the listener decodes:

```solidity
event ChickenBurned(
  address indexed burner,
  uint256 indexed tokenId,
  uint256 planetId,
  uint16 galaxy,
  uint16 system,
  uint8 position
);
```

Set `CHICKEN_BURN_EVENT_SIGNATURE` if the deployed contract uses another event name/signature. The
event must expose the burner, token id, planet id, galaxy, system, and position by name.

`ENABLE_TRANSFER_BURN_FALLBACK=true` also supports ERC-721 `Transfer(from, address(0), tokenId)`
burns when the burn transaction calldata is one of the documented
`burn*ForMoon(tokenId, planetId, galaxy, system, position)` shapes. Keep this off for the upgraded
Chicken contract, because `burnForMoon` emits both the Veydrift burn event and the normal ERC-721
burn Transfer in the same transaction.
