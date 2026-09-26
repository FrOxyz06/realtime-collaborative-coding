const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { hash } = require('./proposal.cjs');
const { runtimeWinner, verifyComparison, comparisonReport } = require('./comparison.cjs');
const { runBenchmark } = require('./benchmark.cjs');

const item = () => ({ passed: true, name: 'sample', timingNote: 'measurable', beforeMs: 2, afterMs: 1,
    before: { medianMs: 2, minMs: 1.9, maxMs: 2.1, peakBytes: 100 },
    after: { medianMs: 1, minMs: 0.9, maxMs: 1.1, peakBytes: 200 } });

test('comparison has no runtime winner on mismatches, noisy or overlapping samples', () => {
    assert.equal(runtimeWinner(item(), true), 'friend');
    assert.equal(runtimeWinner(item(), false), 'inconclusive');
    assert.equal(runtimeWinner({ ...item(), timingNote: 'noisy' }, true), 'inconclusive');
    assert.equal(runtimeWinner({ ...item(), timingNote: 'too short' }, true), 'inconclusive');
    const overlap = item(); overlap.after.maxMs = 2;
    assert.equal(runtimeWinner(overlap, true), 'inconclusive');
    const near = item(); near.after = { medianMs: 1.99, minMs: 1.98, maxMs: 2, peakBytes: 1 };
    assert.equal(runtimeWinner(near, true), 'inconclusive');
    const reversed = item(); [reversed.before, reversed.after] = [reversed.after, reversed.before];
    assert.equal(runtimeWinner(reversed, true), 'yours');
});

test('result provenance must match both source snapshots', () => {
    const result = { sourceHashes: { before: hash('a'), after: hash('b') }, cases: [item()] };
    verifyComparison(result, 'a', 'b');
    assert.throws(() => verifyComparison(result, 'changed', 'b'), /snapshots/);
});

test('report labels the two solutions and exposes runtime/memory tradeoffs', () => {
    const text = comparisonReport({ target: 'example.py', revision: 3, yourHash: hash('a'), friendHash: hash('b'),
        changedDuringRun: true, result: { passed: true, cases: [item()] } });
    assert.match(text, /revision 3/);
    assert.match(text, /Observed lower runtime: friend/);
    assert.match(text, /yours 100 bytes; friend 200 bytes/);
    assert.match(text, /changed during the run/);
});

test('real Python solutions compare with source hashes and supplied correctness cases', async () => {
    const yours = fs.readFileSync('deduplicate.py', 'utf8');
    const friend = fs.readFileSync('deduplicate-fast.py', 'utf8');
    const config = JSON.parse(fs.readFileSync('deduplicate-benchmark.json', 'utf8'));
    const result = await runBenchmark(process.env.TEST_PYTHON || 'python', { ...config, before: yours, after: friend }, process.cwd());
    verifyComparison(result, yours, friend);
    assert.equal(result.passed, true, result.error);
    assert.ok(result.cases.every(c => c.before.peakBytes >= 0 && c.after.peakBytes >= 0));
});
