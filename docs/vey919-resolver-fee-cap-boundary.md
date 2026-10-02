# VEY-919 resolver fee-cap repair boundary

The backend quotes all single resolver writes, replacements and same-EOA stale-nonce
cancellations against a $0.50 transaction budget. Cancellation requires the full
21,000 gas self-transfer envelope to fit; it never lowers the replacement fee bump,
lets the wallet choose gas, or allocates past an unaffordable stale nonce.
Missing, stale, future-dated or invalid ETH/USD data and missing Base L1/operator
oracles fail closed. Cancellation preflight includes sender, recipient, empty data,
zero value, exact gas, nonce and EIP-1559 fees; lease ownership is fenced afterward.
Single arrival/return/moon-finalization preflight includes the exact nonce and fees too.
Quotes expire after 30 seconds or the price freshness window, including during preflight.

Batching remains disabled by default and is not enabled by this repair. Each batch
transaction is also bounded by the stricter $0.50 quoted exposure, within the existing
$1 aggregate batch ceiling. Retained batches still have no automatic replacements or
cancellations; unknown receipts retain shared-signer ownership.

## Not an absolute inclusion-time USD guarantee

The guard reserves twice the quoted Base L1 and operator fees, plus gas times the
signed EIP-1559 max fee, converted using the validated Chainlink price. EIP-1559
caps execution gas price, **not** Base L1/operator fees or the ETH/USD exchange rate
at eventual inclusion. A transaction can remain pending after the quote expires.
No off-chain quote can prove an absolute future USD spend ceiling under arbitrary
L1/operator/price changes. Therefore this repair must not be described as satisfying
an unconditional inclusion-time $0.50/$1 guarantee or authorizing activation on that
basis. That requirement remains a release blocker pending an explicitly accepted
quoted-exposure policy or a separately designed enforceable funding mechanism.
No fee limit is loosened; no real signing, broadcasting, deployment or activation is
part of this repair.

## Standalone keeper remains unavailable

The standalone battle-keeper resolver still has an uncapped 15M-gas signing path and
retained-envelope resend path. Its production entrypoint now unconditionally rejects
startup **before** configuration, signer construction, journal access, transport,
listeners or loops; there is no environment-variable enable override. Its adapter
remains available only for existing offline unit fixtures, not an approved production
writer. Do not remove the startup gate or deploy an alternate entrypoint until both
fresh and retained envelopes enforce the reviewed spend policy. No live service state
was inspected or changed here; already-running older binaries are not disabled by a
source-code change.

No Solidity sources, ABIs or upgrade scripts change in this repair. Existing exact-head
contract-upgrade approval and release gates remain in force; this is not an upgrade
approval, merge decision, deployment, or Kaneo review transition.
