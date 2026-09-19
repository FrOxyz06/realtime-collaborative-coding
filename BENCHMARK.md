# Shared benchmark format (v1)

Both extensions ship the same `benchmark.py` and `benchmark.cjs`. Python uses only its standard library; no Python packages or remote services are required.

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

- `function`: one top-level synchronous function name, present in both versions.
- `cases`: 1–20 objects with an `args` array, optional `kwargs` object, optional `name`, and optional `expected` result.
- `repeats`: 1–10 calls per case, default 5. Each call gets a deep copy of its inputs.
- `expected`: when present, both versions must return this value. Without it, the original is the reference. Include meaningful boundary cases, not just a fast happy path.

The JavaScript bridge adds `before` and `after` source strings and sends the request to `benchmark.py` over standard input. The Python runner returns JSON:

```json
{
  "schemaVersion": 1,
  "passed": true,
  "cases": [{"name": "mixed values", "passed": true, "beforeMs": 0.01, "afterMs": 0.009}]
}
```

These numbers illustrate the format; they are not measured performance claims. Failures may instead contain `passed: false` and an `error` string.

## What is checked

Each version loads in its own subprocess. Every case compares the return value, argument mutation, stdout, and stderr. Repeated calls must give consistent observations. Return values support finite JSON values and tuples, with types preserved. Exceptions fail the run.

The runner measures only each function call, excluding module loading, input copying, and comparison. It reports the median in milliseconds. It runs the original first, then the candidate; timing order and process noise can affect small differences. There is no speed threshold for acceptance.

## Execution limits

Each version has a 5-second limit for all cases and repeats combined. Source strings are limited to 200,000 characters, the request to 1 MB, and captured Python output to 16,000 characters per call. Functions run in the original file's directory, so ordinary local imports can work. Package-relative imports and scripts relying on their exact `__file__` path are not supported.

This is a timeout wrapper, not a security sandbox. Run only code you trust, including imported modules. Filesystem/network effects, native writes, spawned processes, memory use, and all untested inputs are outside the equivalence check. Use a separate sandbox before accepting untrusted code.
