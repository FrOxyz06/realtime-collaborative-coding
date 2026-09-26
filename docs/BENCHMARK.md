# Shared benchmark format (v1)

Both extensions ship the same standard-library Python runner and Node bridge.

```json
{
  "schemaVersion": 1,
  "function": "total",
  "repeats": 5,
  "cases": [
    {"name": "mixed values", "args": [[1, -2, 3]], "expected": 2}
  ]
}
```

`function` names a top-level synchronous function. Supply 1-20 cases, each with optional `args`, `kwargs`, and `name`. `repeats` is 1-10 (default 5). Each call gets a fresh deep copy of its inputs. Use `expected` for an independent expected return value, or `expectedError` for an exact exception class name; never both. Without either, the original is the reference.

The bridge adds `before`/`after` source text and `mode` (`compare` by default, or `profile`). The result retains `schemaVersion`, `passed`, and `cases`. Comparison cases include `beforeMs`, `afterMs`, nested `before`/`after` measurements, and `timingNote`. Profile cases contain measurements directly. Failures can instead contain `passed: false` and `error`.

## Checks and measurements

Each version runs in its own process. Return values/types, positional and keyword argument mutation, stdout, stderr, and expected exception messages must agree. Warm-up, timed, and diagnostic calls must give consistent observations. Supported returned values are finite JSON values and tuples; dictionary keys must be strings.

One checked warm-up is excluded. Runtime samples include the function invocation wrapper, excluding input copying, result comparison, and module loading. Reports include median, minimum, maximum, raw samples, and median absolute deviation (MAD). Separate calls gather the five largest cumulative-time source functions with `cProfile`, and peak Python-traced allocation with `tracemalloc`. These instrumented calls do not contribute timing samples. Peak bytes are not process RSS or all native allocations.

A comparison is labeled `noisy` if either MAD exceeds 10% of its median, or `too short` if either median is below 0.1 ms. A speedup ratio appears only for passing, measurable comparisons. These are simple heuristics, not confidence intervals. The original runs first, so machine load and order can bias results. There is no speed threshold for accepting proposals.

JSON exports include recording time, Python/OS/machine, source SHA-256 hashes, and a config hash so results can be traced to inputs. Raw source is not included. Markdown export is a readable summary.

## Limits

Each worker has five seconds total for all cases, repeats, and diagnostics. Source text is capped at 200,000 characters, the input at 1,000,000 characters, and captured Python output at 16,000 characters per call. The Node bridge also caps output and execution time. Functions run in the original file's directory; normal local imports can work, but package-relative imports and exact `__file__` assumptions are unsupported.

This is a timeout wrapper, not a sandbox. It does not isolate filesystem/network access, native writes, spawned processes, or memory consumption. Run only trusted code, including imports. Passing cases do not prove behavior on every input.
