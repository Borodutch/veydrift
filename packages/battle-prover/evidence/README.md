# Measured recursion probe — 2026-10-05

The terminal [recursive-pair.txt](recursive-pair.txt) records a **PASS** for actual
BN254 inner proofs plus one genuine recursive BN254 Groth16 aggregate proof and
12 adversarial aggregation cases. [short-tests.txt](short-tests.txt) records the
cheap step constraints and real leaf proof round-trip/context rejection tests.
No keys or proofs were written to disk; only metrics/test output were retained.

| Measurement | Observed |
|---|---:|
| gnark / gnark-crypto | v0.16.3 / v0.21.0 |
| Go / local platform | 1.27.0 / darwin arm64 |
| GOMAXPROCS | 4 |
| GOMEMLIMIT (soft GC target, not hard RSS cap) | 4 GiB |
| Physical host RAM | 64 GiB |
| Leaf constraints | 235 |
| Aggregate constraints | 2,513,157 |
| Aggregate compile | 5.073 s |
| Aggregate development setup | 342.628 s |
| Aggregate proof generation | 16.819 s |
| Native final verification | 1.884 ms |
| Aggregate test elapsed | 373.17 s |
| Full command wallclock (including Go runner) | 375.39 s |
| Command user / system CPU | 1160.62 / 3.52 s |
| Maximum resident set size | 6,295,830,528 bytes (~5.86 GiB) |
| Swaps reported by time | 0 |
| gnark compressed proof serialization | 196 bytes |
| Declared public scalar count | 7 |
| Exported Solidity source length | 36,314 bytes |

**196 bytes is gnark serialization, not an Ethereum calldata-size measurement.**
Solidity source length is not deployed bytecode size. Native verification time
is not Base execution gas. GOMEMLIMIT was exceeded in RSS as expected for a soft
runtime target. This is the local Mac, not a Hetzner benchmark. Setup dominated
this test and is not per-job production proof cost; production setup is absent.

Rejected cases: altered output, seed, rules, job; wrong initial counter/state;
wrong terminal counter; replayed, reordered or skipped chunk; discontinuous
state; genuine child proof under an unapproved key. The positive verifies two
actual integer-increment chunks. None are battle simulations or combat proofs.
The additional proof-under-altered-final-output native verification also failed
as expected (the test asserts that rejection).

The final aggregate was generated/verified with gnark's Solidity-target transcript
options. The leaf circuit has no commitment extension. No Ethereum VM execution,
contract export file, deployment or ceremony artifact was produced. All Setup
calls are local development Setup; no secure-erasure attestation is claimed.

Recovery notes: an initial v0.14 attempt was aborted after finding applicable
upstream soundness advisories. A patched-version intermediate attempt was
restarted before proving to set Solidity-compatible transcript options. Neither
is counted as success. The complete successful transcript here is v0.16.3.
After launching this successful run, only the test skip condition (honor -short)
and resource-budget error wording changed; circuit/proving logic was unchanged.
The final short tests were rerun. Source digests are in source-sha256.txt.
