# Collab Review

A small VS Code extension for sharing Python edits as proposals. The file owner reviews a diff, runs a before/after benchmark, then accepts or rejects the change.

This first version uses proposal files. It does **not** have live sessions, accounts, remote permissions, or real-time editing yet.

## Setup

Requires Node.js 22+, Python 3.10+, and VS Code 1.100+.

```sh
npm ci
npm run compile
code --extensionDevelopmentPath="/absolute/path/to/this/repo"
```

Replace the path with your checkout. In the new VS Code window, open this repo as a single workspace folder. If `python` is not on your PATH, set **Collab: Python Path** to your Python executable.

## Try it

1. Open `example.py`, the original file.
2. Run **Collab: Create Proposal** from the Command Palette. Pick `candidate.py` and save `change.collab-proposal.json`.
3. Share that JSON file with someone who has the same original file. For a local demo, review it yourself.
4. Run **Collab: Review Proposal** and open the JSON file. The proposed side of the diff is read-only.
5. Run **Collab: Benchmark Proposal** and choose `benchmark.json`. Review the code before approving execution.
6. Read the results in the **Collab Benchmark** output panel. Run **Collab: Accept Proposal** to apply it, or **Collab: Reject Proposal** to dismiss it.

Accepting changes the editor buffer; you still review and save it. Undo works. A changed original, a dirty editor, a failed benchmark, or a target outside the workspace blocks acceptance.

## Performance extension compatibility

This repo and [Performance Analyzer](https://github.com/FrOxyz06/ai-code-performance-analyzer-vscode) contain the same benchmark runner and use the same `benchmark.json`. Neither extension needs the other installed. See [BENCHMARK.md](BENCHMARK.md) for the format and limits.

## Tests

```sh
npm test
npm run test:python
```

The Node tests cover proposal validation, path checks, the review/accept flow with a VS Code mock, and the real Node-to-Python bridge. The Python tests cover behavior mismatches, expected results, repeated calls, errors, and timeouts.

## Limits

One Python file and one pending review at a time. No merge handling: if the original changes, create a fresh proposal. Benchmarks run trusted local code with your permissions, not in a sandbox. Passing cases are evidence for those inputs, not proof of correctness. A slower but correct change can still be accepted.
