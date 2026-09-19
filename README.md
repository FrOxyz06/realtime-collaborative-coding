# Collab Review

A VS Code extension for reviewing Python changes from another person. Share one file, let a guest propose an edit, inspect the diff, then run a before/after benchmark before accepting it.

Sessions exchange proposals and status over HTTP. This is a review workflow, not simultaneous keystroke editing.

## Run it

Requires Node.js 22+, Python 3.10+, and VS Code 1.100+.

```sh
npm ci
npm run compile
code --extensionDevelopmentPath="/absolute/path/to/this/repo"
```

Open this repo as one workspace folder in the new window. Set **Collab: Python Path** if needed. Use the Command Palette for these commands.

## Two-window demo

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

`session.cjs` handles short-lived access and proposal status using Node's built-in HTTP server. `proposal.cjs` validates paths and hashes. `extension.ts` handles review and editor changes. `benchmark.py` and `benchmark.cjs` are shared with [Performance Analyzer](https://github.com/FrOxyz06/ai-code-performance-analyzer-vscode). Both accept the same [benchmark format](BENCHMARK.md); neither extension needs the other installed.

A changed original, dirty editor, failed behavior check, expired session, or path outside the workspace blocks acceptance. Each session permits at most 20 proposals. The owner reviews only one proposal at a time.

## Tests

```sh
npm test
npm run test:python
npm run test:editor
```

Tests exercise real HTTP clients, access expiry, wrong tokens, file scope, stale proposals, path checks, and the Node/Python bridge. The editor test launches VS Code 1.138.0 and exercises review, benchmarking, apply, Undo, and a guest proposal through a real session. Dialog answers are automated. On Linux use `xvfb-run -a npm run test:editor`. On Windows, set `VSCODE_TEST_CACHE` to a short path if needed. `TEST_PYTHON` selects the editor test's Python executable.

## Limits

One Python file per session, no merge handling, persistence, reconnect support, or live cursors. The benchmark runs trusted local code with your permissions; it is not a sandbox. Passing cases only support the inputs checked. External side effects are not compared. See the shared format for supported inputs and execution limits.
