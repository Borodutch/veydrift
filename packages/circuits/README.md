# @veydrift/circuits

Zero-knowledge circuit boilerplate and proof tooling.

## Decision Log

- **Proving stack:** TBD (Circom/SnarkJS, Noir, or GKR-based)
- **Curve:** TBD (BN254 for EVM compatibility, or BLS12-381)
- **Verification:** TBD (onchain verifier, recursive proofs, or aggregation)

## Structure

- `circuits/` — circuit definitions
- `inputs/` — sample witness inputs
- `scripts/` — proving/verification scripts

## Setup

Install Circom and SnarkJS:

```bash
npm install -g snarkjs
# or follow https://docs.circom.io/getting-started/installation/
```

## Scripts

- `circom circuits/placeholder.circom --r1cs --wasm --sym` — compile circuit
