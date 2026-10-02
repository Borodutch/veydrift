# VEY-919 resolver fee-cap policy

Owner decision Telegram 22011 (2026-10-01 21:02 PDT) supersedes the earlier
USD/ETH conjunction: **ETH-only quote-time limits**, with no ETH/USD price feed.

- Each mission arrival, return, moon finalization, replacement and same-EOA
  cancellation quotes at most **200000000000000 wei (0.0002 ETH)** total.
- Total quote = signed gas × signed EIP-1559 maximum fee + **2×** the Base L1
  upper-bound fee + **2×** the Base operator fee at the requested gas envelope.
  Batch quoting also reads the exact unsigned-envelope L1 estimate and reserves
  the larger of that estimate and the L1 upper bound.
- Gas shrinks within the fixed budget, then the exact funded envelope is simulated.
  The replacement bump is never reduced to fit. A cancellation requires all 21000
  gas; unaffordable cancellation retains the old attempt and nonce without a send.
- All automatic cancellation callers (mission and randomness commit/fulfill)
  use one capped helper. A sibling cannot bypass a rejected mission cancellation.
- Missing/invalid fee estimates, missing Base L1/operator oracle responses,
  unsupported chains, or fee-block quotes older than 30 seconds fail closed.
  The block-age fence is checked after preflight and before the wallet/RPC call.
- No runtime price lookup, no constant USD valuation, and no currency fallback.
  Retired MAX_USD, ETH_USD_FEED and PRICE_MAX_AGE_SECONDS settings do not determine
  spending or block resolution. The batch override is MAX_FEE_WEI, which must be
  a positive integer no greater than 400000000000000 wei (0.0004 ETH).

## Batch and signer boundaries

Batching remains disabled by default; this change does not enable it. The current
batch API emits exactly **one** transaction, bounded by both its configured
aggregate budget (at most 0.0004 ETH) and the stricter 0.0002 ETH transaction cap.
It has no multi-transaction fan-out, automatic replacements, or cancellations.
Thus one invocation cannot exceed the aggregate ceiling. Any future multi-envelope
batch must reserve at most 0.0004 ETH across the whole batch, while preserving the
0.0002 ETH limit for every constituent transaction, before it may be activated.
An unknown batch receipt retains the shared signer and never causes another send.

Single initial/replacement preflight includes sender, target, data, zero value,
exact nonce, gas and both EIP-1559 fee fields. Sends are lease-fenced after the last
await, and submission journal writes atomically recheck ownership. Late results
cannot overwrite a successor. Randomness commit/fulfill payload pricing remains
a separate writer policy; their shared-nonce cancellation uses this ETH cap.

The manual nonce-gap recovery CLI refuses broadcast before configuration is read;
read-only planning remains available. Its multi-nonce aggregate budget is not an
approved alternative write path.

## Quote-time, not an inclusion-time guarantee

Base L1/operator charges can change before inclusion. EIP-1559 caps execution
fees, not those variable Base charges. The 2× reserve is conservative quote-time
headroom, **not a guaranteed bound on the eventual receipt's ETH or USD cost**.
The owner accepted this quote-time policy; the earlier absolute-USD-proof blocker
is superseded. That decision is not a contract-upgrade/broadcast approval.

## Standalone keeper stays disabled

The standalone battle-keeper retains uncapped 15M-gas fresh/retained-envelope
adapters for offline tests. Its production entrypoint unconditionally rejects
startup before configuration, signer, journal, transport, listeners or loops;
there is no environment enable override. Do not activate an alternate entrypoint
or remove that guard without implementing and reviewing the same spend policy.
Already-running older deployments are not disabled by a source change.

No Solidity source, ABI or upgrade script changes here. Legacy combat semantics
and the separate persisted mission #95855 keyless liveness replay are unchanged.
Exact-head independent review, CI and the separate upgrades-topic approval still
apply. This repair is not a merge, upgrade, signing, deployment or activation.
