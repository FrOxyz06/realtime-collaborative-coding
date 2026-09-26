# Live sharing and solution comparison — v0.3.0

The host shares one Python document with explicit opt-in. Guests can watch it,
create independent copies, and benchmark their current solution against a captured
host revision. The original proposal acceptance workflow remains separate.

## Recorded local demonstration

`node scripts/benchmark-demo.cjs` starts a real loopback host, copies its initial
snapshot, publishes the set-based implementation, fetches revision 2 and compares
both sources with identical cases and explicit expected outputs. The scripts are
`deduplicate.py` and `deduplicate-fast.py` (function `unique`).

All three supplied cases passed. With 12,000 integers and 3,000 distinct values:

| Measurement | List-membership solution | Set-membership solution |
|---|---:|---:|
| Median function runtime | 105.3511 ms | 0.9878 ms |
| Peak traced Python allocations | 26,384 bytes | 174,408 bytes |

The set-based version was about 106.7× faster in this
one local measurement, while using more traced allocation memory. The empty and
100-element cases were marked inconclusive for runtime; tiny timings are not a
reliable winner. There is deliberately no single combined efficiency score.

Raw results, source hashes, individual samples and the measured environment are
in [comparison-demo.json](comparison-demo.json). Warm-up is excluded; seven timed
repeats are used. Profiling and memory diagnostics run separately. This is an
illustrative local measurement, not a statistical significance or universal
performance claim. Tracemalloc does not measure total process RAM.

## Validation

- Baseline: 16 Node tests and 18 Python tests passed before changes.
- Updated: 24 Node tests pass, including real HTTP clients, pause/revocation,
  snapshot identity, polling shutdown, mismatch/noise handling and a real Python
  comparison.
- Real VS Code 1.138.0 workflow passed: host live edits; pause; guest read-only
  updates; independent copies; compare; export; stop watch; original proposal
  benchmark, accept and Undo.
- Cross-machine SSH tunneling remains documented but was not tested here.

## Boundaries

Live source is never executed merely by joining or watching. Comparing requires a
trusted workspace, a captured diff and explicit execution approval. Code runs
with the user's local permissions. Invitation holders are not authenticated
people; keep the invite private. Use an SSH tunnel for another computer; the
listener still binds to loopback only. A matching result supports only the
supplied cases; add expected outputs to catch both solutions making the same error.
