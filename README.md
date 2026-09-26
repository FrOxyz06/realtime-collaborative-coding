# Collab Review

A VS Code extension for solving Python problems with a friend: watch their shared edits, take your own copy, and compare both solutions for correctness, runtime and memory. Owner-reviewed proposals remain available.

v0.3.0 adds opt-in live snapshots over HTTP. Watching is read-only; each editable copy stays independent. This is not simultaneous editing or a merge engine. Both participants need v0.3.0 for the new snapshot commands.

## Run it

Requires Node.js 22+, Python 3.10+, and VS Code 1.100+.

```sh
npm ci
npm run compile
code --extensionDevelopmentPath="/absolute/path/to/this/repo"
```

Open this repo as one workspace folder in the new window. Set **Collab: Python Path** if needed. Use the Command Palette for these commands.

## Watch, copy, and compare with a friend

1. **Host:** open a saved Python file and run **Collab: Host Session**. Share the invite privately.
2. **Host:** run **Collab: Start Live Sharing** and confirm that edits, including unsaved changes to this one file, may be shared.
3. **Guest:** run **Collab: Join Session**. An independent editable copy of the latest snapshot opens.
4. **Guest:** run **Collab: Watch Shared File** for a read-only view. It shows the revision and LIVE/PAUSED state; updates poll about once a second. Host changes are debounced by 250 ms.
5. **Guest:** use **Collab: Copy Shared File** whenever you want a fresh separate copy. Existing copies are never overwritten. Work on your solution independently.
6. When both have a solution, focus **your own editable Python document** and run **Collab: Compare My Solution with Friend**. Inspect the captured diff, choose one benchmark JSON with the same function/inputs for both, then approve running the reviewed code.
7. The output labels **yours** and **friend**, checks supplied behavior, reports median timing and peak traced Python allocations, and identifies an observed runtime advantage only when timings are measurable, stable, non-overlapping and differ by more than 5%. Otherwise the conclusion is inconclusive.
8. **Collab: Export Comparison** saves JSON with both source hashes, snapshot revision, environment and per-case measurements. It excludes source text and the invite token.

Run **Collab: Pause Live Sharing** to stop updates; the last shared snapshot remains readable. **Collab: End Session** revokes a hosted invite and stops a guest watch. Expiry or a network error stops the watch with an explicit message; restart Watch or rejoin after reconnecting.

Comparisons use immutable snapshots. If either side changes while the benchmark runs, the result says it refers to the earlier hashes. Nothing is automatically applied or saved. Both solutions run on the guest computer with the same interpreter, inputs and working directory; install any required dependencies there first. Use the same top-level function name on both sides. An untitled copy requires one local workspace folder.

Start with `deduplicate.py`, `deduplicate-fast.py` and `deduplicate-benchmark.json`.
See [the measured demo](docs/LIVE_COMPARISON.md) and [benchmark format](BENCHMARK.md).

## Owner-reviewed proposal demo

1. Owner: open the saved `deduplicate.py`, run **Collab: Host Session**, confirm the file, and copy the invite.
2. Guest: launch a second extension window, run **Collab: Join Session**, and paste the invite. An editable copy opens.
3. Guest: replace that copy with the contents of `deduplicate-fast.py`, then run **Collab: Send Session Proposal**.
4. Owner: run **Collab: Review Session Proposal**. Inspect the read-only proposed side of the diff.
5. Owner: run **Collab: Benchmark Proposal** and select `deduplicate-benchmark.json`. Review the code before approving execution.
6. Owner: inspect correctness, runtime variation, hotspots, and Python allocation results. Run **Collab: Accept Proposal** or **Collab: Reject Proposal**.
7. Guest: run **Collab: Session Status** to see the outcome. Owner: **Collab: End Session** revokes access.

Acceptance changes the owner's editor buffer; saving remains their decision. Focus the source editor to Undo. A slower but correct proposal can still be accepted. Competing proposals become stale once one is applied; start a new session for another round.

## Another computer

The listener binds only to `127.0.0.1`. For two computers, use an existing SSH connection to the owner's machine. If the invitation port is `12345`, the guest can forward it with:

```sh
ssh -N -L 12345:127.0.0.1:12345 user@owner-host
```

Replace the port and SSH destination with the actual values, keep the tunnel open, then join with the invite. SSH setup is outside this extension. Automated tests cover loopback transport; a cross-machine SSH demo has not been verified here.

Anyone with the invite can read that one baseline and submit proposals until it expires (15 minutes) or the owner ends it. There are no accounts or verified guest identities. Keep the invite private. Guests cannot apply or save changes through the session API.

## Offline proposals

Open the saved original, run **Collab: Create Proposal**, select a candidate file, and save a `.collab-proposal.json`. The owner opens it with **Collab: Review Proposal**, then benchmarks and accepts/rejects using the same commands. This works without a running session.

## Design

`session.cjs` handles short-lived access, versioned snapshots and proposal status using Node's built-in HTTP server. `watch.cjs` serializes polling and stops late callbacks. `comparison.cjs` verifies source hashes and explains runtime/memory tradeoffs. `proposal.cjs` validates paths and hashes. `extension.ts` handles review and editor changes. `benchmark.py` and `benchmark.cjs` are shared with [Performance Analyzer](https://github.com/FrOxyz06/ai-code-performance-analyzer-vscode). Both accept the same [benchmark format](BENCHMARK.md); neither extension needs the other installed.

For accepting proposals, a changed original, dirty editor, failed behavior check, expired session, or path outside the workspace blocks acceptance. Live snapshots do not change the original proposal baseline; start a new session to accept proposals against a changed baseline. Standalone friend comparisons can compare the latest solutions without applying either. Each session permits at most 20 proposals. The owner reviews only one proposal at a time.

## Tests

```sh
npm test
npm run test:python
npm run test:editor
```

Tests exercise real HTTP clients, access expiry, wrong tokens, file scope, stale proposals, path checks, and the Node/Python bridge. The editor test launches VS Code 1.138.0 and exercises review, benchmarking, apply, Undo, and a guest proposal through a real session. Dialog answers are automated. On Linux use `xvfb-run -a npm run test:editor`. On Windows, set `VSCODE_TEST_CACHE` to a short path if needed. `TEST_PYTHON` selects the editor test's Python executable.

## Limits

One Python file per session; no merge handling, persistence, automatic reconnect, bidirectional editing, or live cursors. Snapshot watching is host-to-guest; switch roles in a new session to share the other direction. The benchmark runs trusted local code with your permissions; it is not a sandbox. Passing cases only support the inputs checked. External side effects are not compared. See the shared format for supported inputs and execution limits.
