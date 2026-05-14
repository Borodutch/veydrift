# @veydrift/contracts

EVM smart contracts targeting Base.

## Setup

Install Foundry and dependencies:

```bash
forge install
```

Copy `.env.example` to `.env` and configure your deployer key:

```bash
cp .env.example .env
```

The deployer wallet is stored in Vaultwarden under **"Veydrift deployer wallet"**:
- **Address:** `0x87C47Fa2c7747f73E0cA19232615CA4F6B92328c`
- **Networks:** Base Sepolia (testnet) and Base mainnet

## Scripts

- `forge build` — compile contracts
- `forge test` — run tests
- `forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast` — deploy to testnet
- `forge script script/Deploy.s.sol --rpc-url base_mainnet --broadcast` — deploy to mainnet
