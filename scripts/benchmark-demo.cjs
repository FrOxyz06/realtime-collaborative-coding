// Offline two-client demonstration. No real invitation or source text is saved.
const fs = require('node:fs/promises');
const path = require('node:path');
const { hostSession, snapshotRequest } = require('../session.cjs');
const { runBenchmark } = require('../benchmark.cjs');
const { hash } = require('../proposal.cjs');
const { verifyComparison, comparisonReport } = require('../comparison.cjs');

async function main() {
    const root = path.resolve(__dirname, '..');
    const yours = await fs.readFile(path.join(root, 'deduplicate.py'), 'utf8');
    const optimized = await fs.readFile(path.join(root, 'deduplicate-fast.py'), 'utf8');
    const host = await hostSession('deduplicate.py', yours);
    try {
        const independentCopy = await snapshotRequest(host.invite);
        host.setLive(true); host.publish(optimized);
        const friend = await snapshotRequest(host.invite);
        if (independentCopy.source !== yours) throw new Error('Copy changed unexpectedly');
        const cases = [0, 100, 12000].map(size => {
            const input = Array.from({ length: size }, (_, i) => i % 3000);
            return { name: `${size} integers`, args: [input], expected: [...new Set(input)] };
        });
        const result = await runBenchmark(process.env.TEST_PYTHON || 'python', {
            schemaVersion: 1, function: 'unique', repeats: 7, cases, before: yours, after: friend.source
        }, root);
        verifyComparison(result, yours, friend.source);
        if (!result.passed) throw new Error('Behavior did not match the supplied expected results');
        const record = { schemaVersion: 1, target: friend.target, revision: friend.revision,
            yourHash: hash(yours), friendHash: friend.hash, sharedAt: friend.updatedAt, changedDuringRun: false, result };
        const output = path.resolve(process.argv[2] || path.join(root, 'docs', 'comparison-demo.json'));
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n');
        console.log(comparisonReport(record));
    } finally { host.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
