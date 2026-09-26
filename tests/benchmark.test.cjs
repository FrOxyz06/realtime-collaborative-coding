const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runBenchmark, report } = require('../src/benchmark.cjs');

test('Node bridge runs the actual Python benchmark with example files', async () => {
    const request = { ...JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../examples/benchmark.json'))), before: fs.readFileSync(require('node:path').join(__dirname, '../examples/example.py'), 'utf8'), after: fs.readFileSync(require('node:path').join(__dirname, '../examples/candidate.py'), 'utf8') };
    const result = await runBenchmark(process.env.TEST_PYTHON || 'python', request, process.cwd());
    assert.equal(result.passed, true, result.error);
    assert.equal(result.cases.length, 3);
    assert.match(report(result), /All supplied cases matched/);
});
test('missing Python produces an actionable failure', async () => {
    await assert.rejects(runBenchmark('nonexistent-python-command-92837', {}, process.cwd()));
});
